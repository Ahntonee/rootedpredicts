/**
 * Rooted Predictions — Main Frontend Application
 * Handles: header, footer, dark mode, league filter dropdown (live API data),
 * prediction card rendering, market tabs, date navigation
 */
(function () {
  'use strict';

  // ── Theme init (before DOM to prevent flash)
  const saved = localStorage.getItem('afro_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  // ── Continent icons
  const CONTINENT_ICONS = {
    'World':    'public',
    'Europe':   'euro_symbol',
    'Africa':   'brightness_5',
    'Americas': 'language',
    'Asia':     'temple_hindu',
    'Oceania':  'waves',
  };

  // ── Fallback league data (used when API not yet connected)
  const FALLBACK_LEAGUES = [
    { id: 1,  api_league_id: 39,  name: 'Premier League',      country: 'England', continent: 'Europe',   logo_url: 'https://media.api-sports.io/football/leagues/39.png',  is_popular: 1 },
    { id: 2,  api_league_id: 140, name: 'La Liga',             country: 'Spain',   continent: 'Europe',   logo_url: 'https://media.api-sports.io/football/leagues/140.png', is_popular: 1 },
    { id: 3,  api_league_id: 135, name: 'Serie A',             country: 'Italy',   continent: 'Europe',   logo_url: 'https://media.api-sports.io/football/leagues/135.png', is_popular: 1 },
    { id: 4,  api_league_id: 78,  name: 'Bundesliga',          country: 'Germany', continent: 'Europe',   logo_url: 'https://media.api-sports.io/football/leagues/78.png',  is_popular: 1 },
    { id: 5,  api_league_id: 61,  name: 'Ligue 1',            country: 'France',  continent: 'Europe',   logo_url: 'https://media.api-sports.io/football/leagues/61.png',  is_popular: 1 },
    { id: 6,  api_league_id: 2,   name: 'Champions League',   country: 'World',   continent: 'World',    logo_url: 'https://media.api-sports.io/football/leagues/2.png',   is_popular: 1 },
    { id: 7,  api_league_id: 3,   name: 'Europa League',      country: 'World',   continent: 'World',    logo_url: 'https://media.api-sports.io/football/leagues/3.png',   is_popular: 1 },
    { id: 8,  api_league_id: 253, name: 'MLS',                country: 'USA',     continent: 'Americas', logo_url: 'https://media.api-sports.io/football/leagues/253.png', is_popular: 1 },
    { id: 9,  api_league_id: 71,  name: 'Brazilian Serie A',  country: 'Brazil',  continent: 'Americas', logo_url: 'https://media.api-sports.io/football/leagues/71.png',  is_popular: 1 },
    { id: 10, api_league_id: 323, name: 'Indian Super League',country: 'India',   continent: 'Asia',     logo_url: 'https://media.api-sports.io/football/leagues/323.png', is_popular: 1 },
    { id: 11, api_league_id: 6,   name: 'AFCON',              country: 'Africa',  continent: 'Africa',   logo_url: 'https://media.api-sports.io/football/leagues/6.png',   is_popular: 1 },
  ];

  // ── League cache
  let cachedLeagues  = null;
  let leagueLoadedAt = 0;
  const CACHE_TTL    = 5 * 60 * 1000; // 5 minutes

  async function fetchLeagues() {
    const now = Date.now();
    if (cachedLeagues && (now - leagueLoadedAt) < CACHE_TTL) return cachedLeagues;
    try {
      const res  = await fetch('/api/leagues?grouped=true');
      const json = await res.json();
      if (json.success && json.data) {
        // Convert grouped object to flat array for the dropdown
        const flat = [];
        Object.values(json.data).forEach(leagueArr => flat.push(...leagueArr));
        cachedLeagues  = flat.length ? flat : FALLBACK_LEAGUES;
        leagueLoadedAt = now;
        return cachedLeagues;
      }
    } catch (e) {
      console.warn('[Rooted Predictions] League API unavailable, using fallback:', e.message);
    }
    cachedLeagues = FALLBACK_LEAGUES;
    return cachedLeagues;
  }

  // ── Prediction stats cache
  let statsCache = null;
  async function fetchStats() {
    if (statsCache) return statsCache;
    try {
      const res  = await fetch('/api/predictions/stats?period=month');
      const json = await res.json();
      if (json.success) { statsCache = json.data; return statsCache; }
    } catch(e) {}
    return { total: 24, won: 18, lost: 3, pending: 3, accuracy: 78.4 };
  }

  // ── Inject site header
  function injectHeader() {
    const el = document.getElementById('site-header');
    if (!el) return;

    const path = window.location.pathname;
    const active = href => path === href || path.startsWith(href.replace('.html','')) ? 'active' : '';

    el.innerHTML = `
      <div class="ticker-wrap">
        <div class="ticker-label"><span class="material-icons-round">sports_soccer</span>LIVE</div>
        <div style="overflow:hidden;flex:1;">
          <div class="ticker-track">
            <span class="ticker-item"><span class="live-dot"></span>Arsenal vs Chelsea <span class="score">2 - 1</span> 74'</span>
            <span class="ticker-item"><span class="live-dot"></span>Real Madrid vs Barcelona <span class="score">0 - 0</span> 45'</span>
            <span class="ticker-item">Man City vs Liverpool <span class="score">FT 3 - 1</span></span>
            <span class="ticker-item">PSG vs Monaco <span class="score">FT 2 - 0</span></span>
            <span class="ticker-item"><span class="live-dot"></span>Bayern vs Dortmund <span class="score">1 - 2</span> 61'</span>
            <span class="ticker-item">Juventus vs Inter Milan <span class="score">FT 1 - 1</span></span>
            <span class="ticker-item"><span class="live-dot"></span>Arsenal vs Chelsea <span class="score">2 - 1</span> 74'</span>
            <span class="ticker-item"><span class="live-dot"></span>Real Madrid vs Barcelona <span class="score">0 - 0</span> 45'</span>
            <span class="ticker-item">Man City vs Liverpool <span class="score">FT 3 - 1</span></span>
            <span class="ticker-item">PSG vs Monaco <span class="score">FT 2 - 0</span></span>
          </div>
        </div>
      </div>
      <div class="container">
        <div class="header-inner">
          <a href="/index.html" class="site-logo">
            <img src="/images/logo.png" alt="Rooted Predictions" class="site-logo-img">
          </a>
          <nav class="main-nav" id="main-nav">
            <a href="/index.html"           class="nav-link ${active('/index.html')}">Home</a>
            <a href="/predictions.html"     class="nav-link ${active('/predictions.html')}">Predictions</a>
            <a href="/leagues.html"         class="nav-link ${active('/leagues.html')}">Leagues</a>
            <a href="/leaderboard.html"     class="nav-link ${active('/leaderboard.html')}">Leaderboard</a>
            <a href="/blog.html"            class="nav-link ${active('/blog.html')}">Blog</a>
          </nav>
          <div class="header-actions">
            <button class="theme-toggle" id="theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
              <span class="material-icons-round" id="theme-icon">light_mode</span>
            </button>
            <a href="/login.html" class="btn-login">Log In</a>
            <a href="https://t.me/rootedpredictions" target="_blank" rel="noopener noreferrer" class="btn-telegram">
              <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.695l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.864z"/></svg>
              Telegram
            </a>
            <button class="nav-toggle" id="nav-toggle" aria-label="Toggle navigation">
              <span class="material-icons-round">menu</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon   = document.getElementById('theme-icon');
    updateThemeIcon(themeIcon);
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('afro_theme', next);
      updateThemeIcon(themeIcon);
    });

    // Mobile nav
    document.getElementById('nav-toggle').addEventListener('click', () => {
      document.getElementById('main-nav').classList.toggle('open');
    });
  }

  function updateThemeIcon(el) {
    el.textContent = document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'light_mode' : 'dark_mode';
  }

  // ── Inject site footer
  function injectFooter() {
    const el = document.getElementById('site-footer');
    if (!el) return;

    el.innerHTML = `
      <div class="container">
        <div class="gambling-notice">
          <p><strong>Responsible Gambling Notice:</strong> Rooted Predictions provides football predictions for informational and entertainment purposes only. We do not guarantee any results. Please gamble responsibly. Only bet what you can afford to lose. If gambling is causing you problems, visit <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer" style="color:var(--red);">BeGambleAware.org</a> or call <strong style="color:#fff;">0808 8020 133</strong>.</p>
        </div>
        <div class="footer-top">
          <div class="footer-brand">
            <a href="/index.html" class="site-logo" style="margin-bottom:0;">
              <img src="/images/logo.png" alt="Rooted Predictions" class="site-logo-img">
            </a>
            <p>Precision football predictions powered by data. Free daily tips for the Premier League, La Liga, and Champions League. Bet smarter. Every single day.</p>
          </div>
          <div class="footer-col">
            <h4>Predictions</h4>
            <ul class="footer-links">
              <li><a href="/predictions.html">Today's Tips</a></li>
              <li><a href="/predictions.html?market=over-2-5">Over 2.5 Goals</a></li>
              <li><a href="/predictions.html?market=btts">BTTS Tips</a></li>
              <li><a href="/predictions.html?market=1x2">1X2 Predictions</a></li>
              <li><a href="/predictions.html?market=correct-score">Correct Score</a></li>
              <li><a href="/leaderboard.html">Leaderboard</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Company</h4>
            <ul class="footer-links">
              <li><a href="/about.html">About Rooted Predictions</a></li>
              <li><a href="/blog.html">Blog</a></li>
              <li><a href="/contact.html">Contact Us</a></li>
              <li><a href="/leagues.html">All Leagues</a></li>
              <li><a href="https://t.me/rootedpredictions" target="_blank" rel="noopener">Telegram Channel</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <ul class="footer-links">
              <li><a href="/privacy.html">Privacy Policy</a></li>
              <li><a href="/terms.html">Terms of Service</a></li>
              <li><a href="/register.html">Create Account</a></li>
              <li><a href="/login.html">Login</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>&copy; ${new Date().getFullYear()} Rooted Predictions. All rights reserved. Predictions for informational purposes only. 18+ only.</p>
          <p style="display:flex;align-items:center;gap:6px;">
            <span class="material-icons-round" style="font-size:0.9rem;color:var(--red);">lock</span>
            Secure &amp; Encrypted
          </p>
        </div>
      </div>
    `;
  }

  // ── League filter dropdown component
  async function initLeagueFilter(wrapperId) {
    const wrap = document.getElementById(wrapperId);
    if (!wrap) return;

    const savedId  = localStorage.getItem('afro_league') || 'all';
    let selected   = savedId;
    let allLeagues = [];

    wrap.innerHTML = `
      <div class="league-filter-wrap">
        <button class="league-filter-btn" id="league-btn-${wrapperId}" aria-haspopup="listbox" aria-expanded="false">
          <span class="material-icons-round">sports_soccer</span>
          <span id="league-label-${wrapperId}">All Leagues</span>
          <span class="material-icons-round chevron">expand_more</span>
        </button>
        <div class="league-dropdown" id="league-dd-${wrapperId}" role="listbox">
          <div class="league-search-wrap" style="position:relative;">
            <span class="material-icons-round league-search-icon">search</span>
            <input type="text" class="league-search" id="league-search-${wrapperId}"
              placeholder="Search leagues..." autocomplete="off" aria-label="Search leagues">
          </div>
          <div class="league-list" id="league-list-${wrapperId}">
            <div style="padding:20px;text-align:center;color:var(--muted);font-size:0.82rem;">
              <span class="material-icons-round" style="font-size:1.2rem;display:block;margin-bottom:4px;">hourglass_empty</span>
              Loading leagues...
            </div>
          </div>
        </div>
      </div>
    `;

    const btn    = document.getElementById(`league-btn-${wrapperId}`);
    const dd     = document.getElementById(`league-dd-${wrapperId}`);
    const search = document.getElementById(`league-search-${wrapperId}`);
    const list   = document.getElementById(`league-list-${wrapperId}`);
    const label  = document.getElementById(`league-label-${wrapperId}`);

    // Load leagues from API (with fallback)
    allLeagues = await fetchLeagues();

    // Set initial label
    if (savedId !== 'all') {
      const match = allLeagues.find(l => String(l.id) === savedId || String(l.api_league_id) === savedId);
      if (match) label.textContent = match.name;
    }

    function renderList(query) {
      const q = (query || '').toLowerCase().trim();

      const ALL_ITEM = { id: 'all', name: 'All Leagues', country: '', continent: '_top', logo_url: '' };
      const filtered = [ALL_ITEM, ...allLeagues].filter(l =>
        !q || l.name.toLowerCase().includes(q) || (l.country || '').toLowerCase().includes(q)
      );

      // Group by continent
      const groups = {};
      for (const l of filtered) {
        const g = l.continent || 'World';
        if (!groups[g]) groups[g] = [];
        groups[g].push(l);
      }

      list.innerHTML = '';
      const ORDER = ['_top', 'World', 'Europe', 'Africa', 'Americas', 'Asia', 'Oceania'];

      for (const g of ORDER) {
        if (!groups[g] || !groups[g].length) continue;
        if (g !== '_top') {
          const title = document.createElement('div');
          title.className = 'league-group-title';
          title.innerHTML = `<span class="material-icons-round" style="font-size:0.85rem;">${CONTINENT_ICONS[g]||'public'}</span>${g}`;
          list.appendChild(title);
        }
        for (const l of groups[g]) {
          const opt = document.createElement('div');
          opt.className = 'league-option' + (String(l.id) === selected ? ' selected' : '');
          opt.setAttribute('role', 'option');
          opt.dataset.id   = l.id;
          opt.dataset.name = l.name;
          if (l.logo_url) {
            opt.innerHTML = `<img src="${l.logo_url}" class="league-option-logo" alt="${l.name}" loading="lazy" onerror="this.style.display='none'">`;
          } else {
            opt.innerHTML = `<span class="material-icons-round" style="font-size:1rem;color:var(--muted);">sports_soccer</span>`;
          }
          opt.innerHTML += `<span>${l.name}</span>`;
          if (l.country && l.id !== 'all') {
            opt.innerHTML += `<span style="margin-left:auto;font-size:0.72rem;color:var(--muted);">${l.country}</span>`;
          }
          opt.addEventListener('click', () => {
            selected = String(l.id);
            label.textContent = l.name;
            localStorage.setItem('afro_league', selected);
            closeDD();
            renderList('');
            document.dispatchEvent(new CustomEvent('leagueChanged', { detail: { id: selected, name: l.name } }));
          });
          list.appendChild(opt);
        }
      }

      if (!list.children.length) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:0.82rem;">No leagues found</div>`;
      }
    }

    function openDD()  { dd.classList.add('open'); btn.setAttribute('aria-expanded','true'); search.focus(); renderList(''); }
    function closeDD() { dd.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }

    btn.addEventListener('click', e => { e.stopPropagation(); dd.classList.contains('open') ? closeDD() : openDD(); });
    search.addEventListener('input', () => renderList(search.value));
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) closeDD(); });

    renderList('');
  }

  // ── Build date nav bar
  function buildDateNav(containerId, onSelect) {
    const nav = document.getElementById(containerId);
    if (!nav) return;
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let i = -1; i <= 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const btn = document.createElement('button');
      btn.className = 'date-btn' + (i === 0 ? ' active' : '');
      const dayLabel = i === 0 ? 'Today' : i === -1 ? 'Yest' : days[d.getDay()];
      btn.innerHTML  = `<span class="day-name">${dayLabel}</span><span class="day-num">${d.getDate()}</span>`;
      btn.dataset.date = d.toISOString().split('T')[0];
      btn.addEventListener('click', function () {
        nav.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        if (onSelect) onSelect(this.dataset.date);
      });
      nav.appendChild(btn);
    }
  }

  // ── Render prediction cards from API data
  function renderPredictionCard(pred) {
    const isLocked = false;
    const confClass = pred.confidence_score >= 80 ? 'high' : pred.confidence_score >= 65 ? 'medium' : 'low';
    const confWidth = pred.confidence_score || 0;

    const resultBadge = pred.result && pred.result !== 'pending'
      ? `<span class="badge badge-${pred.result}" style="margin-left:4px;">
           <span class="material-icons-round">${pred.result==='won'?'check_circle':'cancel'}</span>
           ${pred.result.toUpperCase()}
         </span>` : '';

    const strongBadge = pred.confidence_score >= 85
      ? `<span class="badge badge-strong" style="margin-left:4px;">
           <span class="material-icons-round">local_fire_department</span>Strong Pick
         </span>` : '';

    const tipRow = isLocked
      ? `<div class="vip-lock-overlay">
           <div class="pred-tip-row lock-blur">
             <span class="tip-label">Our Tip</span>
             <span class="tip-value">VIP Pick</span>
             <span class="tip-odds">@ --.--</span>
           </div>
           <div class="vip-unlock-cta">
             <span class="material-icons-round">lock</span>
             <p>VIP tip — unlock from $4.89/month</p>
             <a href="/pricing.html" class="btn btn-primary btn-sm">Unlock VIP</a>
           </div>
         </div>`
      : `<div class="pred-tip-row">
           <span class="tip-label">Our Tip</span>
           <span class="tip-value">${pred.tip || 'TBD'}</span>
           <span class="tip-odds">${pred.odds ? '@ ' + parseFloat(pred.odds).toFixed(2) : ''}</span>
         </div>`;

    const logoOrPlaceholder = (logo, name) => logo
      ? `<img src="${logo}" class="team-logo" alt="${name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="team-logo-placeholder" style="display:none;"><span class="material-icons-round">sports_soccer</span></div>`
      : `<div class="team-logo-placeholder"><span class="material-icons-round">sports_soccer</span></div>`;

    const matchTime = pred.match_date
      ? new Date(pred.match_date).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone: 'UTC' })
      : '';

    return `
      <article class="pred-card"
               data-market="${pred.market||''}"
               data-league="${pred.league_id||''}"
               data-continent="${pred.continent||''}"
               data-id="${pred.id}">
        <div class="pred-card-header">
          <div class="pred-league">
            ${pred.league_logo
              ? `<img src="${pred.league_logo}" class="league-logo" alt="${pred.league_name||''}" loading="lazy" onerror="this.style.display='none'">`
              : `<span class="material-icons-round" style="font-size:1rem;color:var(--muted);">sports_soccer</span>`}
            <span class="league-name">${pred.league_name||'League'} &middot; ${pred.league_country||''}</span>
          </div>
          <div class="pred-meta">
            <span class="badge badge-free">
              <span class="material-icons-round">lock_open</span>FREE
            </span>
            ${resultBadge}
          </div>
        </div>
        <div class="pred-card-body">
          <div class="pred-teams">
            <div class="pred-team">
              ${logoOrPlaceholder(pred.home_team_logo, pred.home_team)}
              <span class="team-name">${pred.home_team}</span>
            </div>
            <div class="vs-divider">VS<span class="vs-time">${matchTime} UTC</span></div>
            <div class="pred-team">
              ${logoOrPlaceholder(pred.away_team_logo, pred.away_team)}
              <span class="team-name">${pred.away_team}</span>
            </div>
          </div>
          ${tipRow}
          ${pred.confidence_score
            ? `<div class="confidence-bar-wrap">
                 <span class="confidence-label">Confidence</span>
                 <div class="confidence-track">
                   <div class="confidence-fill ${confClass}" style="width:${confWidth}%;"></div>
                 </div>
                 <span class="confidence-pct">${confWidth}%</span>
                 ${strongBadge}
               </div>`
            : ''}
        </div>
        <div class="affiliate-strip">
          <span class="affiliate-label">Bet on</span>
          <div class="affiliate-links">
            <a href="https://www.bet365.com?utm_source=rootedpredictions&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">Bet365</a>
            <a href="https://www.betway.com?utm_source=rootedpredictions&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">Betway</a>
            <a href="https://www.sportybet.com?utm_source=rootedpredictions&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">SportyBet</a>
            <a href="https://www.bet9ja.com?utm_source=rootedpredictions&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">Bet9ja</a>
          </div>
        </div>
      </article>
    `;
  }

  // ── Load and render predictions from API
  async function loadPredictions(containerId, params = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--muted);">
        <span class="material-icons-round" style="font-size:2.5rem;display:block;margin-bottom:8px;animation:spin 1s linear infinite;">sports_soccer</span>
        Loading predictions...
      </div>`;

    try {
      const query = new URLSearchParams(params).toString();
      const res   = await fetch(`/api/predictions?${query}`);
      const json  = await res.json();

      if (!json.success || !json.data || !json.data.predictions.length) {
        container.innerHTML = `
          <div style="padding:48px;text-align:center;">
            <span class="material-icons-round" style="font-size:3rem;color:var(--border);display:block;margin-bottom:12px;">sports_soccer</span>
            <p style="font-size:0.9rem;color:var(--muted);">No predictions found for this filter.</p>
            <a href="/predictions.html" class="btn btn-outline btn-sm" style="margin-top:12px;">View All Tips</a>
          </div>`;
        return;
      }

      container.innerHTML = json.data.predictions
        .map(p => renderPredictionCard(p))
        .join('');

    } catch (e) {
      console.warn('[Rooted Predictions] Predictions API unavailable:', e.message);
      container.innerHTML = `
        <div style="padding:32px;text-align:center;">
          <span class="material-icons-round" style="font-size:2rem;color:var(--muted);display:block;margin-bottom:8px;">wifi_off</span>
          <p style="font-size:0.85rem;color:var(--muted);">Could not load live predictions. <a href="javascript:location.reload()" style="color:var(--red);">Retry</a></p>
        </div>`;
    }
  }

  // ── Update live stats bar
  async function updateStatsBar() {
    const stats = await fetchStats();
    const els = {
      'stat-tips':     stats.total || 24,
      'stat-accuracy': (stats.accuracy || 78.4) + '%',
      'stat-won':      stats.won || 312,
    };
    Object.entries(els).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
  }

  // ── Ensure auth.js is loaded on every page that uses app.js ──
  // This means individual pages don't need to include auth.js separately.
  function ensureAuthLoaded(callback) {
    if (window.AfroAuth) { callback(); return; }
    // Listen for the ready event auth.js fires on load
    document.addEventListener('afroauth:ready', callback, { once: true });
    // Only inject the script if it isn't already in the DOM
    if (!document.querySelector('script[src="/js/auth.js"]')) {
      const s  = document.createElement('script');
      s.src    = '/js/auth.js';
      s.async  = false;
      document.head.appendChild(s);
    }
  }

  // ── Init on DOM ready
  document.addEventListener('DOMContentLoaded', async () => {
    injectHeader();
    injectFooter();

    // Check auth state AFTER header is injected so updateHeaderForUser finds .header-actions
    ensureAuthLoaded(() => window.AfroAuth.checkAuthState());

    // Init league filters
    ['league-filter-home', 'league-filter-predictions'].forEach(id => {
      if (document.getElementById(id)) initLeagueFilter(id);
    });

    // Build date navs
    if (document.getElementById('date-nav-home')) {
      buildDateNav('date-nav-home', date => {
        if (document.getElementById('predictions-grid')) {
          loadPredictions('predictions-grid', { date });
        }
      });
    }
    if (document.getElementById('date-nav-pred')) {
      buildDateNav('date-nav-pred', date => {
        if (document.getElementById('pred-list')) {
          loadPredictions('pred-list', { date });
        }
      });
    }

    // Load live predictions if grid exists
    if (document.getElementById('predictions-grid')) {
      loadPredictions('predictions-grid', { limit: 10 });
    }
    if (document.getElementById('pred-list')) {
      loadPredictions('pred-list', { limit: 20 });
    }

    // Update stats bar
    updateStatsBar();

    // Market tab filtering
    document.querySelectorAll('.market-tabs .market-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        const parent = this.closest('.market-tabs');
        parent.querySelectorAll('.market-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
      });
    });

    // League change event — reload predictions
    document.addEventListener('leagueChanged', e => {
      const leagueId = e.detail.id === 'all' ? null : e.detail.id;
      const params   = leagueId ? { league: leagueId } : {};
      if (document.getElementById('predictions-grid')) loadPredictions('predictions-grid', params);
      if (document.getElementById('pred-list'))        loadPredictions('pred-list', params);
    });
  });

  // Expose globals
  window.Rooted Predictions = {
    loadPredictions,
    renderPredictionCard,
    buildDateNav,
    initLeagueFilter,
    fetchLeagues,
    fetchStats,
  };
})();
