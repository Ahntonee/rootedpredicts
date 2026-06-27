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
      scriptSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      // Allow inline event handlers (onclick="...") used throughout the app.
      // Without this, Helmet defaults script-src-attr to 'none', silently
      // disabling every inline onclick (edit/delete buttons, modal closes, tabs).
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'https:', 'media.api-sports.io'],
      connectSrc:  ["'self'"],
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
                req.originalUrl.startsWith('/api/pages');
  express.json({ limit: large ? '10mb' : '10kb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
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
app.use('/api/pages',         require('./routes/pages'));
app.use('/api/webhooks',      require('./routes/webhooks'));

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
app.get('/prediction/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'prediction-detail.html'));
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
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'An error occurred.' : err.message,
  });
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

  // Start cron scheduler
  startScheduler();
});

module.exports = app;
