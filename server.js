// server.js
// Rooted Predictions — Main Express application entry point

'use strict';

require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const { randomUUID } = require('crypto');

const db        = require('./config/db');
const { startScheduler } = require('./services/scheduler');
const fs        = require('fs');

// Ensure payment-proof upload directory exists on startup
fs.mkdirSync(path.join(__dirname, 'uploads', 'payment-proofs'), { recursive: true });

// Route imports
const leagueRoutes     = require('./routes/leagues');
const predictionRoutes = require('./routes/predictions');
const syncRoutes       = require('./routes/sync');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'www.googletagmanager.com', 'www.google-analytics.com'],
      // Allow inline event handlers (onclick="...") used throughout the app.
      // Without this, Helmet defaults script-src-attr to 'none', silently
      // disabling every inline onclick (edit/delete buttons, modal closes, tabs).
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
      fontSrc:     ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'https:', 'media.api-sports.io'],
      connectSrc:  ["'self'", 'www.googletagmanager.com', 'www.google-analytics.com', 'analytics.google.com', 'stats.g.doubleclick.net'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.SITE_URL : '*',
  credentials: true,
}));

// ── Rate limiting
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many auth attempts. Try again in 15 minutes.' },
});
// Admin and sync routes get a separate high-capacity limiter so dashboard
// operations (sync, auto-predict, bulk edits) never hit the public quota.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 2000,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many admin requests. Please slow down.' },
});

app.use('/api/admin', adminLimiter);
app.use('/api/sync',  adminLimiter);
app.use('/api/',      apiLimiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Request ID — attach to every request for log correlation
app.use((req, _res, next) => { req.id = randomUUID(); next(); });

// ── General middleware
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Raw body preserved for Stripe webhook; admin blog/pages routes get a 10 MB
// limit to support base64 embedded images; all other routes stay at 10 KB.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhooks/stripe') {
    return express.raw({ type: 'application/json' })(req, res, next);
  }
  const large = req.originalUrl.startsWith('/api/admin/blog') ||
                req.originalUrl.startsWith('/api/admin/pages') ||
                req.originalUrl.startsWith('/api/pages')       ||
                req.originalUrl.startsWith('/api/marketing/ads') ||
                req.originalUrl.startsWith('/api/marketing/seo-pages') ||
                req.originalUrl === '/api/subscriptions/manual/submit';
  express.json({ limit: large ? '10mb' : '10kb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── SEO: Bot detection + dynamic rendering
// Googlebot crawls in two waves: Wave 1 (raw HTML, no JS) and Wave 2 (JS,
// possibly days later). Since the site is CSR, Wave 1 sees empty containers.
// For known search bots we inject server-rendered prediction cards and
// JSON-LD structured data before serving the HTML. Regular browsers skip
// this path entirely and get the normal CSR experience.

function isSearchBot(req) {
  const ua = req.headers['user-agent'] || '';
  return /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|applebot|facebot|ia_archiver/i.test(ua);
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildBotPredCard(p) {
  const confClass = p.confidence_score >= 80 ? 'high' : p.confidence_score >= 65 ? 'medium' : 'low';
  const matchTime = p.match_date
    ? new Date(p.match_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : '';
  return `<article class="pred-card" data-id="${p.id}" data-market="${escHtml(p.market)}" data-league="${p.league_id || ''}">
  <div class="pred-card-header">
    <div class="pred-league"><span class="league-name">${escHtml(p.league_name || 'League')} &middot; ${escHtml(p.league_country || '')}</span></div>
    <div class="pred-meta"><span class="badge badge-free">FREE</span></div>
  </div>
  <div class="pred-card-body">
    <div class="pred-teams">
      <div class="pred-team"><span class="team-name">${escHtml(p.home_team)}</span></div>
      <div class="vs-divider">VS<span class="vs-time">${matchTime} UTC</span></div>
      <div class="pred-team"><span class="team-name">${escHtml(p.away_team)}</span></div>
    </div>
    <div class="pred-tip-row">
      <span class="tip-label">Our Tip</span>
      <span class="tip-value">${escHtml(p.tip || 'TBD')}</span>
      ${p.odds ? `<span class="tip-odds">@ ${parseFloat(p.odds).toFixed(2)}</span>` : ''}
    </div>
    ${p.confidence_score
      ? `<div class="confidence-bar-wrap">
           <span class="confidence-label">Confidence</span>
           <div class="confidence-track"><div class="confidence-fill ${confClass}" style="width:${p.confidence_score}%;"></div></div>
           <span class="confidence-pct">${p.confidence_score}%</span>
         </div>`
      : ''}
  </div>
</article>`;
}

async function prerenderPage(req, res, next, file, containerId) {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
    const [preds] = await db.query(`
      SELECT p.id, p.slug, p.home_team, p.away_team, p.match_date,
             p.tip, p.market, p.odds, p.confidence_score, p.league_id,
             l.name AS league_name, l.country AS league_country
      FROM predictions p
      LEFT JOIN leagues l ON l.id = p.league_id
      WHERE DATE(p.match_date) = CURDATE()
        AND p.published_at IS NOT NULL
      ORDER BY p.confidence_score DESC
      LIMIT 30
    `);

    if (preds.length) {
      const cardsHtml = preds.map(buildBotPredCard).join('\n');
      html = html.replace(`<div id="${containerId}">`, `<div id="${containerId}">\n${cardsHtml}`);

      const BASE = process.env.SITE_URL || 'https://www.rootedpredict.com';
      const today = new Date().toISOString().split('T')[0];
      const schema = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'name': `Football Predictions for ${today}`,
        'description': 'Free football predictions and betting tips updated daily.',
        'url': `${BASE}/predictions.html`,
        'numberOfItems': preds.length,
        'itemListElement': preds.map((p, i) => ({
          '@type': 'ListItem',
          'position': i + 1,
          'name': `${p.home_team} vs ${p.away_team} — ${p.tip || 'Prediction'}`,
          'url': `${BASE}/prediction/${p.slug || p.id}`,
          'description': `${p.market || ''} tip: ${p.tip || ''}${p.odds ? ` at odds ${p.odds}` : ''}`,
        })),
      });
      html = html.replace('</head>', `<script type="application/ld+json">${schema}</script>\n</head>`);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[PRERENDER]', e.message);
    next();
  }
}

// Bot pre-render routes — must come BEFORE express.static()
app.get(['/', '/index.html'], (req, res, next) => {
  if (!isSearchBot(req)) return next();
  return prerenderPage(req, res, next, 'index.html', 'free-picks-list');
});
app.get('/predictions.html', (req, res, next) => {
  if (!isSearchBot(req)) return next();
  return prerenderPage(req, res, next, 'predictions.html', 'picks-list');
});

// ── SEO Tips pages — served at /tips/:slug for every visitor (and bots)

function buildSeoFormDots(formStr) {
  if (!formStr) return '';
  return formStr.split('').slice(0, 5).map(c => {
    const cls = c === 'W' ? 'form-dot-w' : c === 'L' ? 'form-dot-l' : c === 'D' ? 'form-dot-d' : 'form-dot-u';
    return `<div class="form-dot ${cls}"></div>`;
  }).join('');
}

function buildSeoTeamLogo(logoUrl, teamName) {
  const letter = escHtml((teamName || '?')[0].toUpperCase());
  if (logoUrl) {
    return `<img class="match-logo" src="${escHtml(logoUrl)}" alt="${escHtml(teamName)}" onerror="this.outerHTML='<div class=\\'match-logo-fallback\\'>${letter}</div>'">`;
  }
  return `<div class="match-logo-fallback">${letter}</div>`;
}

function buildSeoMatchCard(p) {
  const matchTime = p.match_date
    ? new Date(p.match_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : '--:--';
  const oddsPill  = p.odds ? `<div class="match-odds-pill">${parseFloat(p.odds).toFixed(2)}</div>` : '';
  const tipPill   = p.tip  ? `<div class="match-tip-pill">🔥 ${escHtml(p.tip)}</div>` : '';
  return `<div class="match-card">
  <div class="match-team-row">
    <div class="match-team-home">
      <div class="match-team-info-home">
        <div class="match-team-name">${escHtml(p.home_team)}</div>
        <div class="match-form-dots">${buildSeoFormDots(p.home_form)}</div>
      </div>
      ${buildSeoTeamLogo(p.home_team_logo, p.home_team)}
    </div>
    <div class="match-time-center">
      <div class="match-time-pill">${escHtml(matchTime)} UTC</div>
    </div>
    <div class="match-team-away">
      ${buildSeoTeamLogo(p.away_team_logo, p.away_team)}
      <div class="match-team-info-away">
        <div class="match-team-name">${escHtml(p.away_team)}</div>
        <div class="match-form-dots">${buildSeoFormDots(p.away_form)}</div>
      </div>
    </div>
  </div>
  <div class="match-pills-row">
    <div class="match-pills-left"></div>
    <div class="match-pills-center">${oddsPill}${tipPill}</div>
    <div class="match-pills-right"></div>
  </div>
</div>`;
}

function buildSeoPicksHtml(preds) {
  const LEAGUE_PRIORITY = [2, 3, 848, 39, 140, 135, 78, 61, 94, 88, 203, 307, 253, 292];
  const leagueMap = {};
  preds.forEach(p => {
    const key = p.league_id || p.league_name || 'Other';
    if (!leagueMap[key]) leagueMap[key] = { id: p.league_id, name: p.league_name, country: p.league_country, preds: [] };
    leagueMap[key].preds.push(p);
  });
  const sorted = Object.values(leagueMap).sort((a, b) => {
    const ai = LEAGUE_PRIORITY.indexOf(a.id), bi = LEAGUE_PRIORITY.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return sorted.map(lg => {
    const country = lg.country ? `<span style="color:var(--muted);margin-right:4px;">${escHtml(lg.country)}:</span>` : '';
    return `<div class="match-league-group">
  <div class="pick-league-row">${country}<strong>${escHtml(lg.name || 'League')}</strong></div>
  ${lg.preds.map(buildSeoMatchCard).join('\n')}
</div>`;
  }).join('\n');
}

app.get('/tips/:slug', async (req, res) => {
  try {
    const [[page]] = await db.query(
      `SELECT * FROM seo_pages WHERE slug = ? AND status = 'published'`,
      [req.params.slug]
    );
    if (!page) return res.status(404).send('Page not found');

    const [preds] = await db.query(`
      SELECT p.id, p.home_team, p.away_team, p.match_date,
             p.tip, p.market, p.odds, p.confidence_score, p.league_id,
             p.home_team_logo, p.away_team_logo, p.home_form, p.away_form,
             l.name AS league_name, l.country AS league_country
      FROM predictions p
      LEFT JOIN leagues l ON l.id = p.league_id
      WHERE DATE(p.match_date) = CURDATE() AND p.published_at IS NOT NULL
      ORDER BY p.confidence_score DESC LIMIT 30
    `);
    const BASE = process.env.SITE_URL || 'https://www.rootedpredict.com';
    const picksHtml = buildSeoPicksHtml(preds);
    const noPicksMsg = '<p style="color:var(--muted);text-align:center;padding:40px 0;">No predictions today yet — check back soon.</p>';
    const schema = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      'headline': page.title,
      'description': page.meta_description || '',
      'url': `${BASE}/tips/${page.slug}`,
      'publisher': { '@type': 'Organization', 'name': 'Rooted Predictions', 'url': BASE },
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="p:domain_verify" content="2c1d89fb46ea0935171c081295db273c"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(page.title)}</title>
  <meta name="description" content="${escHtml(page.meta_description || '')}">
  ${page.meta_keywords ? `<meta name="keywords" content="${escHtml(page.meta_keywords)}">` : ''}
  <link rel="canonical" href="${BASE}/tips/${escHtml(page.slug)}">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Bai+Jamjuree:wght@400;500;600;700&family=Open+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <script type="application/ld+json">${schema}</script>
  <style>
    .seo-hero { background: var(--navy); padding: 28px 0 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .seo-hero-inner { max-width: 820px; }
    .seo-hero h1 { font-family: var(--font-head); font-size: clamp(1.5rem,4vw,2.2rem); font-weight: 900; color: #fff; margin-bottom: 8px; line-height: 1.25; }
    .seo-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.55); margin-bottom: 24px; }
    .seo-article-content { background: #fff; color: #1a2332; border-radius: 12px; padding: 24px 28px; line-height: 1.85; font-family: 'Open Sans', sans-serif; margin-bottom: 24px; }
    .seo-article-content h2, .seo-article-content h3 { color: #0B2A1A; margin: 1.2em 0 0.5em; }
    .seo-article-content a { color: #1A8A44; }
    .seo-article-content ol, .seo-article-content ul { padding-left: 1.5em; margin: 0.5em 0 0.8em; }
    .seo-article-content li { margin-bottom: 4px; }
    .seo-article-content ol > li { list-style-type: decimal; }
    .seo-article-content ul > li { list-style-type: disc; }
    .seo-picks-header { font-family: var(--font-head); font-size: 1.5rem; font-weight: 900; color: var(--text); letter-spacing: 0.04em; padding: 18px 20px 12px; border-bottom: 1px solid var(--border); }
  </style>
</head>
<body>
<header class="site-header" id="site-header"></header>

<!-- Hero banner matching predictions.html style -->
<div class="seo-hero">
  <div class="container">
    <div class="seo-hero-inner">
      <h1>${escHtml(page.title)}</h1>
      <p class="seo-hero-sub">Free predictions across top leagues — updated daily</p>
    </div>
  </div>
</div>

<main>
  <div class="container" style="padding-top:24px;padding-bottom:60px;">

    <!-- Two-column layout: picks + sidebar -->
    <div class="pred-layout">
      <div class="pred-main">

        <!-- Article content -->
        ${page.content ? `<div class="seo-article-content">${page.content}</div>` : ''}

        <!-- Predictions -->
        <div class="picks-wrap">
          <div class="seo-picks-header">FREE PICKS</div>
          <div id="seo-picks-list" style="padding:12px 16px 16px;">
            ${picksHtml || noPicksMsg}
          </div>
        </div>

      </div><!-- /pred-main -->

      <!-- Right sidebar -->
      <aside class="pred-aside" id="pred-sidebar">
        <div class="aside-card aside-ad-slot" id="ad-slot-sidebar">
          <div style="font-size:0.7rem;color:var(--muted);text-align:center;letter-spacing:0.06em;">ADVERTISEMENT</div>
        </div>
        <div class="aside-card" id="aside-blog">
          <div class="aside-card-header">Sponsored Posts</div>
          <div id="aside-blog-list">
            <div class="pick-skeleton" style="margin:0 0 10px;"><div class="skel" style="height:14px;width:70%;margin-bottom:6px;"></div><div class="skel" style="height:12px;width:50%;"></div></div>
            <div class="pick-skeleton" style="margin:0 0 10px;"><div class="skel" style="height:14px;width:65%;margin-bottom:6px;"></div><div class="skel" style="height:12px;width:45%;"></div></div>
            <div class="pick-skeleton" style="margin:0;"><div class="skel" style="height:14px;width:75%;margin-bottom:6px;"></div><div class="skel" style="height:12px;width:55%;"></div></div>
          </div>
        </div>
      </aside>

    </div><!-- /pred-layout -->

  </div>
</main>
<footer class="site-footer" id="site-footer"></footer>
<script src="/js/app.js"></script>
<script>
// Load sidebar blog posts
(function() {
  var blogList = document.getElementById('aside-blog-list');
  if (!blogList) return;
  fetch('/api/blog?limit=1&category=Sponsored+Post')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var posts = (data.data && data.data.posts) || data.posts || [];
      if (!posts.length) { blogList.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;padding:8px 0;">No articles yet.</p>'; return; }
      blogList.innerHTML = posts.map(function(post) {
        var slug = post.slug || post.id;
        var thumb = post.has_image
          ? '<img class="aside-blog-thumb" src="/api/blog/' + post.id + '/image" alt="" loading="lazy" width="80" height="80" onerror="this.outerHTML=\'<div class=\\\'aside-blog-thumb-ph\\\'></div>\'">'
          : '<div class="aside-blog-thumb-ph"></div>';
        return '<a class="aside-blog-item" href="/blog/' + slug + '">' + thumb + '<div class="aside-blog-body"><div class="aside-blog-badge">' + (post.category || 'Blog') + '</div><div class="aside-blog-title">' + post.title + '</div></div></a>';
      }).join('');
    }).catch(function(){});
})();
</script>
</body>
</html>`);
  } catch (e) {
    console.error('[SEO TIPS PAGE]', e.message);
    res.status(500).send('Server error');
  }
});

// ── Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0,
  etag: true,
  lastModified: true,
}));

// ── API Routes
app.get('/api/health', (req, res) => res.json({
  success: true, message: 'Rooted Predictions API running',
  environment: process.env.NODE_ENV, timestamp: new Date().toISOString()
}));

app.get('/api/status', async (req, res) => {
  try {
    const [leagues] = await db.query('SELECT COUNT(*) AS c FROM leagues');
    const [preds]   = await db.query('SELECT COUNT(*) AS c FROM predictions');
    res.json({
      success: true, message: 'Rooted Predictions backend operational',
      database: 'connected',
      leagues:     leagues[0].c,
      predictions: preds[0].c,
      version: '2.0.0',
    });
  } catch(e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ── Sitemap cache — regenerated at most once per hour
let sitemapCache = null; // { xml: string, generatedAt: number }
const SITEMAP_TTL = 60 * 60 * 1000; // 1 hour

app.get('/sitemap.xml', async (req, res) => {
  if (sitemapCache && Date.now() - sitemapCache.generatedAt < SITEMAP_TTL) {
    res.set('Content-Type', 'application/xml');
    return res.send(sitemapCache.xml);
  }
  const BASE = process.env.SITE_URL || 'https://www.rootedpredict.com';
  const today = new Date().toISOString().split('T')[0];

  const staticPages = [
    { url: '/',               changefreq: 'daily',   priority: '1.0' },
    { url: '/predictions.html', changefreq: 'daily',   priority: '0.9' },
    { url: '/leagues.html',   changefreq: 'weekly',  priority: '0.7' },
    { url: '/leaderboard.html', changefreq: 'daily', priority: '0.7' },
    { url: '/blog.html',      changefreq: 'weekly',  priority: '0.7' },
    { url: '/pricing.html',   changefreq: 'monthly', priority: '0.8' },
    { url: '/about.html',     changefreq: 'monthly', priority: '0.5' },
    { url: '/contact.html',   changefreq: 'monthly', priority: '0.4' },
    { url: '/privacy.html',   changefreq: 'yearly',  priority: '0.3' },
    { url: '/terms.html',     changefreq: 'yearly',  priority: '0.3' },
  ];

  try {
    const [blogs] = await db.query(
      `SELECT slug, updated_at FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC LIMIT 500`
    );
    const [preds] = await db.query(
      `SELECT slug, updated_at FROM predictions WHERE published_at IS NOT NULL ORDER BY match_date DESC LIMIT 500`
    );
    const [seoPages] = await db.query(
      `SELECT slug, updated_at FROM seo_pages WHERE status = 'published' ORDER BY updated_at DESC LIMIT 200`
    ).catch(() => [[]]);

    const urlTags = [
      ...staticPages.map(p => `
  <url>
    <loc>${BASE}${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`),
      ...blogs.map(b => `
  <url>
    <loc>${BASE}/blog/${b.slug}</loc>
    <lastmod>${b.updated_at ? new Date(b.updated_at).toISOString().split('T')[0] : today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`),
      ...preds.map(p => `
  <url>
    <loc>${BASE}/prediction/${p.slug}</loc>
    <lastmod>${p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`),
      ...(seoPages || []).map(p => `
  <url>
    <loc>${BASE}/tips/${p.slug}</loc>
    <lastmod>${p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlTags.join('')}
</urlset>`;
    sitemapCache = { xml, generatedAt: Date.now() };
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (e) {
    res.status(500).send('Sitemap generation error');
  }
});

// Phase 3 routes
app.use('/api/leagues',     leagueRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/sync',        syncRoutes);

// Future phases (uncommented as built):
// Phase 4 — Auth & Users (active)
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));

// Phase 6+
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/comments',      require('./routes/comments'));
app.use('/api/blog',          require('./routes/blog'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/admin/analytics', require('./routes/analytics'));
app.use('/api/analytics',       require('./routes/pageviews'));
app.use('/api/safe-picks',      require('./routes/safepicks'));
app.use('/api/newsletter',    require('./routes/newsletter'));
app.use('/api/pages',         require('./routes/pages'));
app.use('/api/webhooks',      require('./routes/webhooks'));
app.use('/api/marketing',    require('./routes/marketing'));

// ── Block invalid admin paths — only /admin/index.html is valid
const VALID_ADMIN_PATHS = [
  '/admin/index.html',
  '/admin/predictions.html',
  '/admin/analytics.html',
  '/admin/blog.html',
  '/admin/users.html',
  '/admin/leagues.html',
  '/admin/sync.html',
  '/admin/seo.html',
  '/admin/pages.html',
  '/admin/payments.html',
  '/admin/newsletter.html',
  '/admin/audit.html',
  '/admin/admins.html',
  '/admin/profile.html',
  '/admin/seo-pages.html',
  '/admin/backlinks.html',
  '/admin/ads.html',
  '/admin/announcements.html',
];
app.get('/admin', (req, res) => res.status(404).send(adminErrorPage()));
app.get('/admin/{*path}', (req, res, next) => {
  const p = req.path.replace(/\/$/, '');
  if (VALID_ADMIN_PATHS.includes(p) || p.startsWith('/admin/css/') || p.startsWith('/admin/js/')) {
    return next();
  }
  res.status(404).send(adminErrorPage());
});

function adminErrorPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>404 Not Found</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0F3460;color:#fff;font-family:sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;text-align:center;}
  h1{color:#E94560;font-size:4rem;font-weight:900;}
  p{color:rgba(255,255,255,0.5);font-size:0.95rem;}
  a{color:rgba(255,255,255,0.4);font-size:0.85rem;text-decoration:none;}
  a:hover{color:rgba(255,255,255,0.6);}
</style>
</head><body>
  <h1>404</h1>
  <p>Page not found.</p>
  <a href="/">Return to homepage</a>
</body></html>`;
}

// ── Pretty prediction detail URL → serve the detail page
app.get('/prediction/:slug', async (req, res) => {
  if (!isSearchBot(req)) {
    return res.sendFile(path.join(__dirname, 'public', 'prediction-detail.html'));
  }
  try {
    const [rows] = await db.query(
      `SELECT p.*, l.name AS league_name, l.country AS league_country
       FROM predictions p
       LEFT JOIN leagues l ON l.id = p.league_id
       WHERE p.slug = ? OR CAST(p.id AS CHAR) = ? LIMIT 1`,
      [req.params.slug, req.params.slug]
    );
    if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'prediction-detail.html'));
    const p = rows[0];
    let html = fs.readFileSync(path.join(__dirname, 'public', 'prediction-detail.html'), 'utf8');
    const BASE = process.env.SITE_URL || 'https://www.rootedpredict.com';
    const schema = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      'name': `${p.home_team} vs ${p.away_team}`,
      'startDate': p.match_date ? new Date(p.match_date).toISOString() : undefined,
      'description': `${p.market || '1X2'} prediction: ${p.tip || 'TBD'}${p.odds ? ` at odds ${p.odds}` : ''}. Confidence: ${p.confidence_score || 'N/A'}%.`,
      'url': `${BASE}/prediction/${req.params.slug}`,
      'location': { '@type': 'Place', 'name': p.league_name || 'Football Match' },
      'competitor': [
        { '@type': 'SportsTeam', 'name': p.home_team },
        { '@type': 'SportsTeam', 'name': p.away_team },
      ],
    });
    html = html.replace('</head>', `<script type="application/ld+json">${schema}</script>\n</head>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[PRERENDER slug]', e.message);
    res.sendFile(path.join(__dirname, 'public', 'prediction-detail.html'));
  }
});

// ── Pretty blog post URL → serve the blog post page
app.get('/blog/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blog-post.html'));
});

// ── SPA fallback for public pages
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) res.status(200).send(`
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
      <title>Rooted Predictions</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1A1A2E;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px}h1{color:#E94560;font-size:2rem}a{color:#E94560}</style>
      </head><body><h1>Rooted Predictions</h1><p>Precision Tips. Global Reach. Real Results.</p>
      <p>Backend operational. Frontend loading...</p>
      <p>API: <a href="/api/status">/api/status</a></p></body></html>
    `);
  });
});

// ── Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  // Expose real error messages for admin/sync API routes so operators can diagnose issues
  const isAdminRoute = req.path.startsWith('/api/admin') || req.path.startsWith('/api/sync') || req.path.startsWith('/api/analytics') || req.path.startsWith('/api/safe-picks');
  const message = (process.env.NODE_ENV === 'production' && !isAdminRoute) ? 'An error occurred.' : err.message;
  res.status(err.status || 500).json({ success: false, message });
});

// ── Start server
app.listen(PORT, () => {
  console.log('\n==============================================');
  console.log(`  Rooted Predictions — ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  console.log(`  Status: http://localhost:${PORT}/api/status`);
  console.log('==============================================\n');

  // Restore today's API quota from DB so restarts don't reset the guard
  require('./services/apiFootball').initQuotaFromDb().catch(() => {});

  // In PM2 cluster mode each worker gets its own process, so the cron scheduler
  // would fire once per CPU core. Restrict it to worker 0 (or any non-clustered
  // run like local dev where pm_id is undefined).
  const workerId = process.env.pm_id !== undefined ? parseInt(process.env.pm_id, 10) : 0;
  if (workerId === 0) {
    startScheduler();
  } else {
    console.log(`[SCHEDULER] Worker ${workerId} — scheduler runs in worker 0 only`);
  }
});

module.exports = app;
