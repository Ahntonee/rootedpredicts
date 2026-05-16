/**
 * AfroPredict Admin — Shared Utilities
 */
(function () {
  'use strict';

  // ── Auth guard — admin only ───────────────────────────────
  async function requireAdmin() {
    try {
      const res  = await fetch('/api/auth/me', { credentials: 'include' });
      const json = await res.json();
      if (!json.success) {
        // Not logged in at all — go to login
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        return null;
      }
      if (json.data.role !== 'admin') {
        // Logged in but not admin — go to their dashboard, not login
        window.location.href = '/dashboard.html';
        return null;
      }
      return json.data;
    } catch(e) {
      window.location.href = '/login.html';
      return null;
    }
  }

  // ── API helper ────────────────────────────────────────────
  async function api(method, url, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res  = await fetch(url, opts);
    return res.json();
  }

  // ── Toast notification ────────────────────────────────────
  function toast(message, type) {
    type = type || 'success';
    const colors = { success:'var(--green)', error:'var(--red)', info:'var(--midnight)' };
    const icons  = { success:'check_circle', error:'error', info:'info' };
    const el = document.createElement('div');
    el.className = 'admin-toast';
    el.style.background = colors[type] || colors.success;
    el.innerHTML = `<span class="material-icons-round" style="font-size:1rem;">${icons[type]||'check_circle'}</span>${message}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ── Modal helpers ─────────────────────────────────────────
  function showModal(id)  { document.getElementById(id).style.display = 'flex'; }
  function hideModal(id)  { document.getElementById(id).style.display = 'none'; }

  // ── Confirm dialog ────────────────────────────────────────
  function confirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal" style="max-width:380px;">
        <div class="admin-modal-header">
          <span class="admin-modal-title">Confirm Action</span>
        </div>
        <div class="admin-modal-body">
          <p style="font-size:0.9rem;color:var(--text-soft);">${message}</p>
        </div>
        <div class="admin-modal-footer">
          <button class="btn btn-outline btn-sm" id="conf-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="conf-ok" style="background:var(--red);">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('conf-cancel').onclick = () => overlay.remove();
    document.getElementById('conf-ok').onclick = () => { overlay.remove(); onConfirm(); };
  }

  // ── Format date ───────────────────────────────────────────
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  }

  // ── Result badge ──────────────────────────────────────────
  function badge(result) {
    const map = {
      won:     'badge-won',
      lost:    'badge-lost',
      pending: 'badge-pending',
      void:    'badge-pending',
      free:    'badge-free',
      vip:     'badge-vip',
      active:  'badge-won',
      admin:   'badge-vip',
      user:    'badge-free',
    };
    return `<span class="badge ${map[result]||'badge-pending'}">${result.toUpperCase()}</span>`;
  }

  // ── Set active nav link ───────────────────────────────────
  function setActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.admin-nav-link').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === path);
    });
  }

  // ── Build sidebar HTML ────────────────────────────────────
  function buildSidebar() {
    const el = document.getElementById('admin-sidebar');
    if (!el) return;
    el.innerHTML = `
      <a href="/admin/index.html" class="admin-logo">
        <span class="logo-mark" style="font-size:0.85rem;padding:4px 8px;">AP</span>
        <span class="admin-logo-text">AfroPredict</span>
        <span class="admin-logo-badge">Admin</span>
      </a>
      <nav class="admin-nav">
        <div class="admin-nav-section">Overview</div>
        <a href="/admin/index.html"       class="admin-nav-link"><span class="material-icons-round">dashboard</span>Dashboard</a>
        <div class="admin-nav-section">Content</div>
        <a href="/admin/predictions.html" class="admin-nav-link"><span class="material-icons-round">sports_soccer</span>Predictions</a>
        <a href="/admin/blog.html"        class="admin-nav-link"><span class="material-icons-round">article</span>Blog Posts</a>
        <div class="admin-nav-section">Management</div>
        <a href="/admin/users.html"       class="admin-nav-link"><span class="material-icons-round">people</span>Users</a>
        <a href="/admin/leagues.html"     class="admin-nav-link"><span class="material-icons-round">emoji_events</span>Leagues</a>
        <div class="admin-nav-section">Settings</div>
        <a href="/admin/seo.html"         class="admin-nav-link"><span class="material-icons-round">travel_explore</span>SEO Settings</a>
        <a href="/admin/sync.html"        class="admin-nav-link"><span class="material-icons-round">sync</span>Data Sync</a>
      </nav>
      <div class="admin-nav-bottom">
        <a href="/index.html"  class="admin-nav-link"><span class="material-icons-round">open_in_new</span>View Site</a>
        <button id="admin-logout" class="admin-nav-link" style="width:100%;background:none;border:none;cursor:pointer;text-align:left;">
          <span class="material-icons-round">logout</span>Log Out
        </button>
      </div>
    `;
    setActiveNav();
    document.getElementById('admin-logout').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method:'POST', credentials:'include' });
      window.location.href = '/login.html';
    });
  }

  window.Admin = { requireAdmin, api, toast, showModal, hideModal, confirm, fmtDate, badge, buildSidebar };
})();
