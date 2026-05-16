/**
 * AfroPredict — Main JavaScript
 * Handles: dark mode, mobile nav, league filter dropdown,
 *          date navigation, market tabs, confidence bars
 */
'use strict';

/* ── Dark Mode ─────────────────────────────────────────────── */
(function initTheme() {
  const saved = localStorage.getItem('g33_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('g33_theme', next);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
}

/* ── Mobile Nav ────────────────────────────────────────────── */
function initMobileNav() {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('mainNav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  // Close nav when a link is clicked
  nav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => nav.classList.remove('open'));
  });
}

/* ── Theme icon sync ───────────────────────────────────────── */
function syncThemeIcon() {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  const theme = document.documentElement.getAttribute('data-theme');
  icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

/* ── League Filter Dropdown ────────────────────────────────── */
const LEAGUE_DATA = [
  { id: 'all', name: 'All Leagues', continent: null, logo: null },
  // Popular (pinned)
  { id: 39,  name: 'Premier League',        country: 'England',   continent: 'Popular', logo: null },
  { id: 140, name: 'La Liga',               country: 'Spain',     continent: 'Popular', logo: null },
  { id: 135, name: 'Serie A',               country: 'Italy',     continent: 'Popular', logo: null },
  { id: 78,  name: 'Bundesliga',            country: 'Germany',   continent: 'Popular', logo: null },
  { id: 61,  name: 'Ligue 1',              country: 'France',    continent: 'Popular', logo: null },
  { id: 2,   name: 'Champions League',      country: 'Europe',    continent: 'Popular', logo: null },
  { id: 3,   name: 'Europa League',         country: 'Europe',    continent: 'Popular', logo: null },
  { id: 1,   name: 'FIFA World Cup',        country: 'World',     continent: 'Popular', logo: null },
  { id: 6,   name: 'AFCON',                country: 'Africa',    continent: 'Popular', logo: null },
  { id: 253, name: 'MLS',                  country: 'USA',       continent: 'Popular', logo: null },
  { id: 71,  name: 'Brazilian Serie A',     country: 'Brazil',    continent: 'Popular', logo: null },
  { id: 323, name: 'Indian Super League',   country: 'India',     continent: 'Popular', logo: null },
  // Europe
  { id: 88,  name: 'Eredivisie',           country: 'Netherlands', continent: 'Europe', logo: null },
  { id: 94,  name: 'Primeira Liga',        country: 'Portugal',    continent: 'Europe', logo: null },
  { id: 144, name: 'Jupiler Pro League',   country: 'Belgium',     continent: 'Europe', logo: null },
  { id: 203, name: 'Süper Lig',           country: 'Turkey',      continent: 'Europe', logo: null },
  { id: 218, name: 'Scottish Premiership', country: 'Scotland',    continent: 'Europe', logo: null },
  // Africa
  { id: 12,  name: 'NPFL',                country: 'Nigeria',     continent: 'Africa', logo: null },
  { id: 496, name: 'Ghana Premier League', country: 'Ghana',       continent: 'Africa', logo: null },
  { id: 360, name: 'DStv Premiership',    country: 'South Africa', continent: 'Africa', logo: null },
  // Americas
  { id: 262, name: 'Liga MX',             country: 'Mexico',      continent: 'Americas', logo: null },
  { id: 239, name: 'Argentine Primera',   country: 'Argentina',   continent: 'Americas', logo: null },
  { id: 281, name: 'Chilean Primera',     country: 'Chile',       continent: 'Americas', logo: null },
  // Asia
  { id: 292, name: 'K League 1',         country: 'South Korea',  continent: 'Asia', logo: null },
  { id: 98,  name: 'J1 League',          country: 'Japan',        continent: 'Asia', logo: null },
  { id: 307, name: 'Saudi Pro League',   country: 'Saudi Arabia', continent: 'Asia', logo: null },
];

const CONTINENTS = ['Popular', 'Europe', 'Africa', 'Americas', 'Asia'];
const CONTINENT_ICONS = {
  Popular: 'star', Europe: 'public', Africa: 'terrain',
  Americas: 'language', Asia: 'travel_explore'
};

function buildLeagueDropdown(container) {
  if (!container) return;

  const btn = container.querySelector('.league-filter-btn');
  const dropdown = container.querySelector('.league-dropdown');
  const searchInput = container.querySelector('.league-search');
  const list = container.querySelector('.league-list');
  if (!btn || !dropdown || !searchInput || !list) return;

  // Restore saved selection
  const saved = localStorage.getItem('g33_league_filter') || 'all';

  function renderList(filter = '') {
    list.innerHTML = '';
    const q = filter.toLowerCase();

    // All Leagues option
    if ('all leagues'.includes(q)) {
      const el = document.createElement('div');
      el.className = 'league-option' + (saved === 'all' ? ' selected' : '');
      el.dataset.id = 'all';
      el.innerHTML = `<span class="material-icons-round" style="font-size:1rem;color:var(--muted)">public</span> All Leagues`;
      list.appendChild(el);
    }

    CONTINENTS.forEach(continent => {
      const items = LEAGUE_DATA.filter(l =>
        l.continent === continent && (
          l.name.toLowerCase().includes(q) ||
          (l.country && l.country.toLowerCase().includes(q))
        )
      );
      if (!items.length) return;

      const groupTitle = document.createElement('div');
      groupTitle.className = 'league-group-title';
      groupTitle.innerHTML = `<span class="material-icons-round">${CONTINENT_ICONS[continent]}</span>${continent}`;
      list.appendChild(groupTitle);

      items.forEach(league => {
        const el = document.createElement('div');
        el.className = 'league-option' + (String(league.id) === String(saved) ? ' selected' : '');
        el.dataset.id = league.id;
        el.dataset.name = league.name;
        el.innerHTML = `
          <span class="material-icons-round" style="font-size:0.9rem;color:var(--muted);flex-shrink:0">sports_soccer</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${league.name}</span>
          ${league.country ? `<span style="font-size:0.72rem;color:var(--muted)">${league.country}</span>` : ''}
        `;
        list.appendChild(el);
      });
    });
  }

  function updateBtnLabel() {
    const sel = LEAGUE_DATA.find(l => String(l.id) === String(saved));
    const label = btn.querySelector('.league-filter-label');
    if (label) label.textContent = sel ? sel.name : 'All Leagues';
  }

  renderList();
  updateBtnLabel();

  // Toggle open
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
    if (isOpen) setTimeout(() => searchInput.focus(), 50);
  });

  // Search
  searchInput.addEventListener('input', () => renderList(searchInput.value));

  // Select league
  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.league-option');
    if (!opt) return;
    const id = opt.dataset.id;
    const name = opt.dataset.name || 'All Leagues';
    localStorage.setItem('g33_league_filter', id);
    dropdown.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    // Dispatch event so page can react
    window.dispatchEvent(new CustomEvent('leagueFilterChange', { detail: { id, name } }));
    // Re-render with new selection
    location.reload(); // Simple reload — Phase 3 will handle dynamic filtering via API
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      dropdown.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ── Market Tabs ───────────────────────────────────────────── */
function initMarketTabs() {
  document.querySelectorAll('.market-tabs').forEach(tabsEl => {
    tabsEl.querySelectorAll('.market-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabsEl.querySelectorAll('.market-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const market = tab.dataset.market;
        localStorage.setItem('g33_market_filter', market);
        window.dispatchEvent(new CustomEvent('marketFilterChange', { detail: { market } }));
      });
    });
    // Restore saved
    const saved = localStorage.getItem('g33_market_filter') || 'all';
    const active = tabsEl.querySelector(`[data-market="${saved}"]`);
    if (active) {
      tabsEl.querySelectorAll('.market-tab').forEach(t => t.classList.remove('active'));
      active.classList.add('active');
    }
  });
}

/* ── Date Navigation ───────────────────────────────────────── */
function initDateNav() {
  const navEl = document.querySelector('.date-nav');
  if (!navEl) return;

  const today = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const saved = localStorage.getItem('g33_date_filter') || today.toISOString().split('T')[0];

  // Build 7-day window: yesterday + today + 5 ahead
  for (let i = -1; i <= 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const btn = document.createElement('button');
    btn.className = 'date-btn' + (iso === saved ? ' active' : '');
    btn.dataset.date = iso;
    btn.innerHTML = `
      <span class="day-name">${i === 0 ? 'Today' : i === -1 ? 'Yest' : days[d.getDay()]}</span>
      <span class="day-num">${d.getDate()}</span>
    `;
    btn.addEventListener('click', () => {
      navEl.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem('g33_date_filter', iso);
      window.dispatchEvent(new CustomEvent('dateFilterChange', { detail: { date: iso } }));
    });
    navEl.appendChild(btn);
  }
}

/* ── Confidence Bars ───────────────────────────────────────── */
function animateConfidenceBars() {
  document.querySelectorAll('.confidence-fill').forEach(bar => {
    const pct = parseInt(bar.dataset.pct) || 0;
    bar.style.width = '0%';
    bar.classList.remove('high', 'medium', 'low');
    bar.classList.add(pct >= 70 ? 'high' : pct >= 50 ? 'medium' : 'low');
    requestAnimationFrame(() => {
      setTimeout(() => { bar.style.width = pct + '%'; }, 100);
    });
  });
}

/* ── Form visibility toggle (password) ────────────────────── */
function initPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.querySelector('.material-icons-round').textContent = isText ? 'visibility' : 'visibility_off';
    });
  });
}

/* ── Smooth scroll for anchor links ────────────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
}

/* ── Flash messages ────────────────────────────────────────── */
function initFlashMessages() {
  document.querySelectorAll('.flash-message').forEach(msg => {
    setTimeout(() => {
      msg.style.opacity = '0';
      msg.style.transition = 'opacity 0.5s';
      setTimeout(() => msg.remove(), 500);
    }, 4000);
  });
}

/* ── Init everything on DOM ready ──────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  syncThemeIcon();
  initMobileNav();
  initMarketTabs();
  initDateNav();
  animateConfidenceBars();
  initPasswordToggles();
  initSmoothScroll();
  initFlashMessages();

  // Init all league filter dropdowns on the page
  document.querySelectorAll('.league-filter-wrap').forEach(buildLeagueDropdown);

  // Theme toggle button
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
});
