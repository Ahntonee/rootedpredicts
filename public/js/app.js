/**
 * Rooted Predictions — Main Frontend Application
 * Handles: header, footer, dark mode, league filter dropdown (live API data),
 * prediction card rendering, market tabs, date navigation
 */
(function () {
  'use strict';

  // ── Theme init (before DOM to prevent flash)
  const saved = localStorage.getItem('afro_theme') || 'light';
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
      const res  = await fetch('/api/predictions/stats');  // all-time, live
      const json = await res.json();
      if (json.success) { statsCache = json.data; return statsCache; }
    } catch(e) {}
    return {};  // no fake fallback — render real or empty state
  }

  // ── Inject site header
  function injectHeader() {
    const el = document.getElementById('site-header');
    if (!el) return;

    const path = window.location.pathname;
    const active = href => {
      if (href === '/') return (path === '/' || path === '/index.html') ? 'active' : '';
      return path === href || path.startsWith(href.replace('.html','')) ? 'active' : '';
    };

    el.innerHTML = `
      <div class="ticker-wrap" id="ticker-wrap" style="display:none;">
        <div class="ticker-label" id="ticker-label"><span class="material-icons-round">sports_soccer</span>TODAY</div>
        <div style="overflow:hidden;flex:1;">
          <div class="ticker-track" id="ticker-track"></div>
        </div>
      </div>
      <div class="container">
        <div class="header-inner">
          <a href="/" class="site-logo">
            <img src="/images/logo.png" alt="Rooted Predictions" class="site-logo-img" fetchpriority="high" decoding="async">
          </a>
          <nav class="main-nav" id="main-nav">
            <a href="/"           class="nav-link ${active('/index.html')}">Home</a>
            <a href="/predictions.html"     class="nav-link ${active('/predictions.html')}">Predictions</a>
            <a href="/blog.html"            class="nav-link ${active('/blog.html')}">Blog</a>
            <a href="/pricing.html"         class="nav-link ${active('/pricing.html')}">Subscription</a>
            <a href="/about.html"           class="nav-link ${active('/about.html')}">About</a>
          </nav>
          <div class="header-actions">
            <button class="theme-toggle" id="theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
              <span class="material-icons-round" id="theme-icon">light_mode</span>
            </button>
            <a href="/login.html" class="btn-login">Log In</a>
            <a href="/register.html" class="btn-join">Join Free</a>
            <a href="https://t.me/rootedpredict" target="_blank" rel="noopener noreferrer" class="btn-telegram">
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

    // Mobile nav — slide drawer
    var navBackdrop = document.createElement('div');
    navBackdrop.className = 'nav-backdrop';
    navBackdrop.id = 'nav-backdrop';
    document.body.appendChild(navBackdrop);

    var mainNav = document.getElementById('main-nav');
    var navToggle = document.getElementById('nav-toggle');
    var navIcon = navToggle.querySelector('.material-icons-round');

    function openNav() {
      mainNav.classList.add('open');
      navBackdrop.classList.add('open');
      navIcon.textContent = 'close';
      document.body.style.overflow = 'hidden';
    }
    function closeNav() {
      mainNav.classList.remove('open');
      navBackdrop.classList.remove('open');
      navIcon.textContent = 'menu';
      document.body.style.overflow = '';
    }

    navToggle.addEventListener('click', () => {
      mainNav.classList.contains('open') ? closeNav() : openNav();
    });

    // Close on backdrop click
    navBackdrop.addEventListener('click', closeNav);

    // Close on any nav link click
    mainNav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', closeNav);
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

          <!-- Brand -->
          <div class="footer-brand">
            <a href="/" class="site-logo" style="margin-bottom:0;">
              <img src="/images/logo.png" alt="Rooted Predictions" class="site-logo-img" fetchpriority="high" decoding="async">
            </a>
            <p>Rooted Predictions is an online service that provides the most accurate football predictions, soccer betting tips and daily winning picks to users worldwide.</p>
            <div class="footer-social-row">
              <a href="https://t.me/rootedpredict" target="_blank" rel="noopener" class="footer-social-btn tg">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.695l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.864z"/></svg>
                Telegram Channel
              </a>
            </div>
          </div>

          <!-- Business Links -->
          <div class="footer-col">
            <h4>Business Links</h4>
            <ul class="footer-links">
              <li><a href="/pricing.html">VIP Packages</a></li>
              <li><a href="/predictions.html?result=won&all_dates=1">Recent Winnings</a></li>
              <li><a href="/leaderboard.html">Leaderboard</a></li>
              <li><a href="/blog.html">Blog</a></li>
            </ul>
          </div>

          <!-- Other Links -->
          <div class="footer-col">
            <h4>Other Links</h4>
            <ul class="footer-links">
              <li><a href="/predictions.html">Today's Tips</a></li>
              <li><a href="/predictions.html?market=over-2-5">Over 2.5 Goals</a></li>
              <li><a href="/predictions.html?market=btts">BTTS Tips</a></li>
              <li><a href="/privacy.html">Privacy Policy</a></li>
              <li><a href="/terms.html">Terms &amp; Conditions</a></li>
              <li><a href="/register.html" id="footer-register-link">Create Account</a></li>
            </ul>
          </div>

          <!-- Contact -->
          <div class="footer-col">
            <h4>Contact</h4>
            <div class="footer-contact-item">
              <span class="material-icons-round">email</span>
              <div>
                <span class="footer-contact-label">Email Us</span>
                <a href="mailto:support@rootedpredict.com">support@rootedpredict.com</a>
                <a href="mailto:rootedpredict@gmail.com" style="display:block;margin-top:2px;">rootedpredict@gmail.com</a>
              </div>
            </div>
            <div class="footer-contact-item">
              <svg viewBox="0 0 24 24" fill="#2AABEE" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;flex-shrink:0;"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.695l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.864z"/></svg>
              <div>
                <span class="footer-contact-label">Adverts &amp; Enquiries</span>
                <a href="https://t.me/rootedpredictsupport" target="_blank" rel="noopener">For adverts and enquiries</a>
              </div>
            </div>
            <div class="footer-tg-placement">
              <strong style="font-size:0.72rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.07em;">Textlink / Guestpost Placement:</strong><br>
              <a href="https://t.me/rootedpredictsupport" target="_blank" rel="noopener">Contact via Telegram</a>
            </div>
          </div>

        </div>

        <!-- Partner sites bar (populated dynamically) -->
        <div id="footer-partners-bar"></div>


        <div class="footer-bottom">
          <p>&copy; ${new Date().getFullYear()} Rooted Predictions. All rights reserved. Predictions for informational purposes only. 18+ only.</p>
          <p style="display:flex;align-items:center;gap:6px;">
            <span class="material-icons-round" style="font-size:0.9rem;color:var(--red);">lock</span>
            Secure &amp; Encrypted
          </p>
        </div>
      </div>
    `;

    // Inject partner backlinks as a centred full-width bar
    (async function injectBacklinks() {
      try {
        var r = await fetch('/api/marketing/backlinks/active');
        var j = await r.json();
        if (!j.success || !j.data || !j.data.length) return;
        var slot = el.querySelector('#footer-partners-bar');
        if (!slot) return;
        slot.style.cssText = 'background:rgba(255,255,255,0.07);border-radius:8px;padding:16px 24px;margin-bottom:16px;text-align:center;';
        slot.innerHTML = '<h4 style="font-family:var(--font-head);font-size:0.8rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--yellow);margin-bottom:10px;">Partner Sites</h4>' +
          '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px 24px;">' +
          j.data.map(function(bl) {
            return '<a href="' + escUrl(bl.url) + '" target="_blank" rel="noopener sponsored" style="font-size:0.82rem;color:rgba(255,255,255,0.55);transition:color 0.15s;" onmouseover="this.style.color=\'var(--yellow)\'" onmouseout="this.style.color=\'rgba(255,255,255,0.55)\'">' + escText(bl.name) + '</a>';
          }).join('') +
          '</div>';
      } catch (_) {}
    })();

  }

  // ── Cookie consent toast
  function initCookieConsent() {
    if (localStorage.getItem('rp_cookie_consent')) return;
    var toast = document.createElement('div');
    toast.id = 'cookie-toast';
    toast.style.cssText = [
      'position:fixed','bottom:24px','left:50%','transform:translateX(-50%) translateY(20px)',
      'z-index:9100','max-width:480px','width:calc(100% - 32px)',
      'background:#1a2235','border:1px solid rgba(255,255,255,0.1)',
      'border-radius:14px','padding:18px 20px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.45)',
      'display:flex','align-items:center','gap:14px','flex-wrap:wrap',
      'opacity:0','transition:opacity 0.35s ease,transform 0.35s ease',
    ].join(';');
    toast.innerHTML = `
      <span style="font-size:1.4rem;flex-shrink:0;">🍪</span>
      <p style="margin:0;font-size:0.82rem;color:rgba(255,255,255,0.75);flex:1;min-width:180px;line-height:1.5;">
        We use cookies to improve your experience. See our
        <a href="/privacy.html" style="color:#e94560;text-decoration:underline;">Privacy Policy</a>.
      </p>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button id="cookie-decline" style="padding:7px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.6);font-size:0.78rem;cursor:pointer;white-space:nowrap;">Decline</button>
        <button id="cookie-accept" style="padding:7px 16px;border-radius:8px;border:none;background:#e94560;color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;">Accept All</button>
      </div>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    function dismiss(val) {
      localStorage.setItem('rp_cookie_consent', val);
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => toast.remove(), 400);
    }
    document.getElementById('cookie-accept').onclick  = () => dismiss('accepted');
    document.getElementById('cookie-decline').onclick = () => dismiss('declined');
  }

  // ── Telegram channel popup
  function initTelegramPopup() {
    var overlay = document.createElement('div');
    overlay.id = 'tg-popup-overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:9200',
      'background:rgba(0,0,0,0.65)','backdrop-filter:blur(4px)',
      'display:flex','align-items:center','justify-content:center',
      'padding:16px','opacity:0','transition:opacity 0.3s ease',
    ].join(';');
    overlay.innerHTML = `
      <div id="tg-popup-card" style="
        background:linear-gradient(160deg,#0d1f3c 0%,#0e2744 60%,#0a3060 100%);
        border:1px solid rgba(42,171,238,0.3);
        border-radius:20px;max-width:400px;width:100%;
        padding:32px 28px 28px;text-align:center;position:relative;
        box-shadow:0 20px 60px rgba(0,0,0,0.6);
        transform:translateY(24px);transition:transform 0.35s ease;">
        <button id="tg-popup-close" style="
          position:absolute;top:12px;right:14px;background:rgba(255,255,255,0.1);
          border:none;color:#fff;width:30px;height:30px;border-radius:50%;
          font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;
          line-height:1;">✕</button>
        <div style="margin-bottom:16px;">
          <img src="/images/logo.png" alt="Rooted Predictions" style="width:72px;height:72px;object-fit:contain;margin:0 auto 10px;display:block;border-radius:14px;">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;color:#2AABEE;text-transform:uppercase;margin-bottom:6px;">Join Our Community</div>
          <h2 style="color:#fff;font-size:1.45rem;font-weight:800;margin:0 0 8px;line-height:1.2;">Get Free Daily Tips<br>on Telegram</h2>
          <p style="color:rgba(255,255,255,0.65);font-size:0.84rem;line-height:1.55;margin:0 0 20px;">
            Join <strong style="color:#fff;">thousands of winners</strong> getting our top football predictions, expert picks &amp; winning tips — free, every day.
          </p>
        </div>
        <a href="https://t.me/rootedpredict" target="_blank" rel="noopener" id="tg-popup-join"
          style="display:flex;align-items:center;justify-content:center;gap:10px;
          background:#2AABEE;color:#fff;font-weight:800;font-size:0.95rem;
          padding:14px 24px;border-radius:50px;text-decoration:none;margin-bottom:12px;
          box-shadow:0 4px 18px rgba(42,171,238,0.4);transition:background 0.2s;">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;flex-shrink:0;"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.695l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.864z"/></svg>
          Join Free on Telegram
        </a>
        <button id="tg-popup-later" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:0.78rem;cursor:pointer;padding:4px;">Maybe later</button>
      </div>`;
    document.body.appendChild(overlay);

    function close() {
      overlay.style.opacity = '0';
      document.getElementById('tg-popup-card').style.transform = 'translateY(24px)';
      setTimeout(() => overlay.remove(), 350);
    }

    setTimeout(() => {
      overlay.style.opacity = '1';
      document.getElementById('tg-popup-card').style.transform = 'translateY(0)';
    }, 50);

    document.getElementById('tg-popup-close').onclick  = () => close();
    document.getElementById('tg-popup-later').onclick  = () => close();
    document.getElementById('tg-popup-join').onclick   = () => close();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
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

    // Live / finished / upcoming status from synced data
    const FIN_ST  = ['FT','AET','PEN'];
    const LIVE_ST = ['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'];
    const st        = pred.status_short;
    const hasScore  = pred.home_score != null && pred.away_score != null;
    const isFinished = FIN_ST.includes(st) && hasScore;
    const isLive     = LIVE_ST.includes(st) && hasScore;

    // Centre of the card: live score / FT score / kickoff time
    let centerDisplay;
    if (isLive) {
      centerDisplay = `<div class="vs-divider"><span style="font-family:var(--font-head);font-size:1.45rem;font-weight:800;color:var(--text);">${pred.home_score} - ${pred.away_score}</span><span class="vs-time" style="color:var(--red);font-weight:700;display:flex;align-items:center;gap:4px;justify-content:center;"><span class="live-dot"></span>LIVE${pred.elapsed?" "+pred.elapsed+"'":''}</span></div>`;
    } else if (isFinished) {
      centerDisplay = `<div class="vs-divider"><span style="font-family:var(--font-head);font-size:1.45rem;font-weight:800;color:var(--text);">${pred.home_score} - ${pred.away_score}</span><span class="vs-time">FT</span></div>`;
    } else {
      centerDisplay = `<div class="vs-divider">VS<span class="vs-time">${matchTime} UTC</span></div>`;
    }

    const liveBadge = isLive
      ? `<span class="badge" style="background:rgba(231,76,60,0.12);color:var(--red);"><span class="live-dot"></span>LIVE</span>`
      : '';

    return `
      <article class="pred-card"
               data-market="${marketSlug(pred.market)}"
               data-league="${pred.league_id||''}"
               data-continent="${pred.continent||''}"
               data-id="${pred.id}"
               ${pred.slug ? `style="cursor:pointer;" onclick="if(!event.target.closest('a'))location.href='/prediction/${pred.slug}'"` : ''}>
        <div class="pred-card-header">
          <div class="pred-league">
            ${pred.league_logo
              ? `<img src="${pred.league_logo}" class="league-logo" alt="${pred.league_name||''}" loading="lazy" onerror="this.style.display='none'">`
              : `<span class="material-icons-round" style="font-size:1rem;color:var(--muted);">sports_soccer</span>`}
            <span class="league-name">${pred.league_name||'League'} &middot; ${pred.league_country||''}</span>
          </div>
          <div class="pred-meta">
            ${liveBadge || `<span class="badge badge-free">
              <span class="material-icons-round">lock_open</span>FREE
            </span>`}
            ${resultBadge}
          </div>
        </div>
        <div class="pred-card-body">
          <div class="pred-teams">
            <div class="pred-team">
              ${logoOrPlaceholder(pred.home_team_logo, pred.home_team)}
              <span class="team-name">${pred.home_team}</span>
            </div>
            ${centerDisplay}
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
            <a href="https://www.bet365.com?utm_source=rootedpredict&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">Bet365</a>
            <a href="https://www.betway.com?utm_source=rootedpredict&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">Betway</a>
            <a href="https://www.sportybet.com?utm_source=rootedpredict&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">SportyBet</a>
            <a href="https://www.bet9ja.com?utm_source=rootedpredict&utm_medium=prediction&utm_campaign=tip" target="_blank" rel="noopener noreferrer sponsored" class="affiliate-link">Bet9ja</a>
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
        if (containerId === 'pred-list') updatePredictionCounts([], 0);
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

      if (containerId === 'pred-list') {
        updatePredictionCounts(json.data.predictions, json.data.pagination.total);
      }

      // While any match is in-play, auto-refresh this list to keep scores live
      const LIVE_ST = ['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'];
      const anyLive = json.data.predictions.some(p => LIVE_ST.includes(p.status_short) && p.home_score != null);
      clearTimeout(window.__livePoll);
      if (anyLive) window.__livePoll = setTimeout(() => loadPredictions(containerId, params), 60000);

    } catch (e) {
      console.warn('[Rooted Predictions] Predictions API unavailable:', e.message);
      container.innerHTML = `
        <div style="padding:32px;text-align:center;">
          <span class="material-icons-round" style="font-size:2rem;color:var(--muted);display:block;margin-bottom:8px;">wifi_off</span>
          <p style="font-size:0.85rem;color:var(--muted);">Could not load live predictions. <a href="javascript:location.reload()" style="color:var(--red);">Retry</a></p>
        </div>`;
    }
  }

  // ── Normalise a DB market value to the tab slug used in the UI
  function marketSlug(m) {
    m = (m || '').toLowerCase();
    if (m === '1x2') return '1x2';
    if (m.includes('over') || m.includes('under')) return 'over-2-5';
    if (m === 'btts') return 'btts';
    return m;
  }

  // ── Update the predictions-page count + market tab counts from real data
  function updatePredictionCounts(preds, total) {
    const countEl = document.getElementById('pred-count');
    if (countEl) countEl.textContent = total + (total === 1 ? ' prediction' : ' predictions');
    const tabs = document.getElementById('market-tabs-pred');
    if (!tabs) return;
    const counts = { '1x2': 0, 'over-2-5': 0 };
    preds.forEach(p => { const s = marketSlug(p.market); if (counts[s] !== undefined) counts[s]++; });
    tabs.querySelectorAll('.market-tab').forEach(tab => {
      const m = tab.dataset.market, span = tab.querySelector('.tab-count');
      if (span) span.textContent = (m === 'all') ? preds.length : (counts[m] || 0);
    });
  }

  // ── Header ticker: real today's matches with live scores / FT scores / kickoff
  async function populateTicker() {
    const track = document.getElementById('ticker-track');
    const wrap  = document.getElementById('ticker-wrap');
    const label = document.getElementById('ticker-label');
    if (!track || !wrap) return;
    const FIN_ST  = ['FT','AET','PEN'];
    const LIVE_ST = ['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'];
    try {
      // today's published matches (any status), limit high enough to cover the day
      const res  = await fetch('/api/predictions?limit=40');
      const json = await res.json();
      let allPreds = (json.success && json.data && json.data.predictions) || [];
      // Deduplicate: keep only the highest-confidence prediction per match
      const seen = {};
      allPreds.forEach(p => {
        const key = `${p.home_team}|${p.away_team}`;
        if (!seen[key] || (p.confidence_score || 0) > (seen[key].confidence_score || 0)) seen[key] = p;
      });
      const preds = Object.values(seen);
      if (!preds.length) { wrap.style.display = 'none'; clearTimeout(window.__tickerPoll); return; }

      const now = Date.now();
      let anyLive = false;
      const item = p => {
        const hasScore = p.home_score != null && p.away_score != null;
        const matchTime = new Date(p.match_date).getTime();
        const isPast = matchTime < now;
        let mid;
        if (LIVE_ST.includes(p.status_short) && hasScore) {
          anyLive = true;
          mid = `<span class="live-dot"></span><span class="score" style="color:var(--red);">${p.home_score}-${p.away_score}</span>${p.elapsed ? " " + p.elapsed + "'" : ''}`;
        } else if (FIN_ST.includes(p.status_short) && hasScore) {
          mid = `<span class="score">${p.home_score}-${p.away_score}</span> FT`;
        } else if (isPast) {
          // Match time has passed but no score synced yet — show FT placeholder
          mid = hasScore
            ? `<span class="score">${p.home_score}-${p.away_score}</span> FT`
            : `<span class="score" style="color:var(--muted);">FT</span>`;
        } else {
          const d = new Date(p.match_date);
          mid = `<span class="score">${isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>`;
        }
        return `<span class="ticker-item">${p.home_team} vs ${p.away_team} ${mid}</span>`;
      };
      const html = preds.map(item).join('');
      track.innerHTML = html + html;   // duplicate for seamless marquee
      wrap.style.display = '';
      if (label) label.innerHTML = anyLive
        ? '<span class="live-dot"></span>LIVE'
        : '<span class="material-icons-round">sports_soccer</span>TODAY';

      // Refresh every 60s while any match is in-play
      clearTimeout(window.__tickerPoll);
      if (anyLive) window.__tickerPoll = setTimeout(populateTicker, 60000);
    } catch (e) {
      wrap.style.display = 'none';
    }
  }

  // ── Populate all live stat displays (hero + stats bar) from real data only
  async function updateStatsBar() {
    const s = await fetchStats();
    const d = s.display || {};
    // Override-aware display strings; fall back to live values, never a fake number
    const accuracy = d.accuracy || ((s.accuracy !== null && s.accuracy !== undefined) ? s.accuracy + '%' : 'New');
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };

    // Hero stat boxes (homepage)
    set('hero-accuracy', accuracy);
    set('hero-leagues',  d.leagues_covered != null ? d.leagues_covered : (s.leagues_covered != null ? s.leagues_covered : 0));
    set('hero-members',  d.members != null ? d.members : (s.members != null ? s.members : 0));
    // Live stats bar (where present)
    set('stat-tips',     d.predictions != null ? d.predictions : (s.total != null ? s.total : 0));
    set('stat-accuracy', accuracy);
    set('stat-won',      s.won != null ? s.won : 0);

    // Homepage sidebar "Track Record" widget (real settled results)
    set('hs-won', s.won != null ? s.won : 0);
    set('hs-lost', s.lost != null ? s.lost : 0);
    set('hs-pending', s.pending != null ? s.pending : 0);
    set('hs-rate', accuracy);

    // If an admin set a custom "Published Predictions" value, reflect it on the predictions page
    if (s.overrides && s.overrides.predictions) {
      set('pred-count', s.overrides.predictions + ' predictions');
    }
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

  // ── Escape helpers (used by backlinks + ad injection)
  function escText(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escUrl(s)  { try { var u = new URL(String(s||'')); return ['http:','https:'].includes(u.protocol) ? u.href : '#'; } catch(_){ return '#'; } }

  // ── Inject ads into placement slots on the current page
  function buildAdWrap(ad) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:12px 0;';
    if (ad.type === 'banner' && ad.image_data) {
      wrap.innerHTML = '<a href="/api/marketing/ads/'+ad.id+'/click" target="_blank" rel="noopener sponsored">' +
        '<img src="'+ad.image_data+'" alt="'+escText(ad.name)+'" loading="lazy" decoding="async" width="400" height="200" style="max-width:100%;height:auto;display:block;border-radius:8px;aspect-ratio:2/1;"></a>';
    } else if (ad.type === 'code' && ad.content) {
      wrap.innerHTML = ad.content;
    } else if (ad.type === 'text' && ad.link_url) {
      wrap.innerHTML = '<a href="/api/marketing/ads/'+ad.id+'/click" target="_blank" rel="noopener sponsored" ' +
        'style="font-size:0.85rem;color:var(--text-soft);text-decoration:underline;">'+escText(ad.name)+'</a>';
    }
    return wrap;
  }

  async function injectAds() {
    var placements = ['header','between-cards','sidebar','footer','blog'];
    var slots = placements.filter(function(p){ return !!document.getElementById('ad-slot-'+p); });
    if (!slots.length) return;
    try {
      var allAds = [];
      for (var i = 0; i < slots.length; i++) {
        var r = await fetch('/api/marketing/ads/placement/' + slots[i]);
        var j = await r.json();
        if (j.success && j.data) {
          j.data.forEach(function(ad) { ad._slot = slots[i]; allAds.push(ad); });
        }
      }
      allAds.forEach(function(ad) {
        var slot = document.getElementById('ad-slot-' + ad._slot);
        if (!slot) return;
        var wrap = buildAdWrap(ad);
        if (wrap.innerHTML) {
          slot.appendChild(wrap);
          fetch('/api/marketing/ads/'+ad.id+'/impression', {method:'POST'}).catch(function(){});
        }
      });
      // Mirror sidebar ads to the mobile-only slot (sidebar is hidden on small screens)
      var mobileSlot = document.getElementById('ad-slot-mobile');
      if (mobileSlot) {
        allAds.filter(function(ad){ return ad._slot === 'sidebar'; }).forEach(function(ad) {
          var wrap = buildAdWrap(ad);
          if (wrap.innerHTML) mobileSlot.appendChild(wrap);
        });
      }
    } catch(_) {}
  }

  // ── Init on DOM ready
  document.addEventListener('DOMContentLoaded', async () => {
    injectHeader();
    injectFooter();
    initCookieConsent();
    setTimeout(initTelegramPopup, 3000);

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
          loadPredictions('pred-list', { date, limit: 50 });
        }
      });
    }

    // Load live predictions if grid exists — homepage shows up to 20 from today
    // onwards so it's never empty (even when today's fixtures are done)
    if (document.getElementById('predictions-grid')) {
      loadPredictions('predictions-grid', { limit: 20, upcoming: 1 });
    }
    if (document.getElementById('pred-list')) {
      loadPredictions('pred-list', { limit: 50 });
    }

    // Update stats bar + live "today" ticker from real data
    updateStatsBar();
    populateTicker();
    injectAds();

    // Market tab filtering
    document.querySelectorAll('.market-tabs .market-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        const parent = this.closest('.market-tabs');
        parent.querySelectorAll('.market-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
      });
    });

    // Homepage category pills → auto-filter the predictions list by category
    document.querySelectorAll('#category-tabs-home .market-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        const cat = this.dataset.category || 'free';
        if (document.getElementById('predictions-grid')) {
          loadPredictions('predictions-grid', { category: cat, limit: 20, upcoming: 1 });
        }
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
  window.RootedPredictions = {
    loadPredictions,
    renderPredictionCard,
    buildDateNav,
    initLeagueFilter,
    fetchLeagues,
    fetchStats,
  };
})();
