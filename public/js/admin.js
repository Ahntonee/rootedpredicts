/**
 * Rooted Predictions Admin — Shared Utilities
 */
(function () {
  'use strict';

  // Cached current admin user (set after requireAdmin resolves)
  let _currentUser = null;

  // ── Auth guard — admin only ───────────────────────────────
  async function requireAdmin() {
    try {
      const res  = await fetch('/api/auth/me', { credentials: 'include' });
      const json = await res.json();
      if (!json.success) {
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        return null;
      }
      if (json.data.role !== 'admin') {
        window.location.href = '/dashboard.html';
        return null;
      }
      _currentUser = json.data;
      // Inject the effective admin_role into the user object (null → superadmin)
      _currentUser.effectiveRole = _currentUser.admin_role || 'superadmin';
      return _currentUser;
    } catch(e) {
      window.location.href = '/login.html';
      return null;
    }
  }

  // ── Permission check ──────────────────────────────────────
  // Returns true if the current admin is allowed to do `action`
  const PERMISSIONS = {
    // superadmin can do everything; editor can do most content things; viewer is read-only
    delete_prediction:  ['superadmin'],
    manage_users:       ['superadmin'],
    manage_admins:      ['superadmin'],
    manage_site_stats:  ['superadmin'],
    edit_seo:           ['superadmin', 'editor'],
    write_predictions:  ['superadmin', 'editor'],
    manage_blog:        ['superadmin', 'editor'],
    manage_leagues:     ['superadmin', 'editor'],
  };

  function can(action) {
    if (!_currentUser) return false;
    const role = _currentUser.effectiveRole;
    if (role === 'superadmin') return true;
    const allowed = PERMISSIONS[action] || [];
    return allowed.includes(role);
  }

  // ── API helper ────────────────────────────────────────────
  async function api(method, url, body) {
    try {
      const opts = { method, credentials: 'include', headers: {} };
      if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      const res  = await fetch(url, opts);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (_) { return { success: false, message: `Server error ${res.status}: ${text.slice(0, 120)}` }; }
    } catch (e) {
      return { success: false, message: e.message || 'Network error' };
    }
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
    setTimeout(() => el.remove(), 3500);
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

  function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  // ── Result / role badge ───────────────────────────────────
  function badge(result) {
    const map = {
      won:          'badge-won',
      lost:         'badge-lost',
      pending:      'badge-pending',
      void:         'badge-pending',
      free:         'badge-free',
      vip:          'badge-vip',
      active:       'badge-won',
      admin:        'badge-vip',
      user:         'badge-free',
      superadmin:   'badge-vip',
      editor:       'badge-won',
      viewer:       'badge-pending',
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
  function buildSidebar(user) {
    // user arg is optional — fall back to cached _currentUser
    const u = user || _currentUser;
    const el = document.getElementById('admin-sidebar');
    if (!el) return;

    const effectiveRole = (u && (u.effectiveRole || u.admin_role)) || 'superadmin';
    const isSuperAdmin  = effectiveRole === 'superadmin';
    const isEditor      = effectiveRole === 'editor' || isSuperAdmin;
    const displayName   = u ? (u.username || u.name || u.email) : 'Admin';
    const roleLabel     = { superadmin: 'Super Admin', editor: 'Editor', viewer: 'Viewer' }[effectiveRole] || effectiveRole;

    el.innerHTML = `
      <a href="/admin/index.html" class="admin-logo">
        <img src="/images/logo.png" alt="Rooted Predictions" class="admin-logo-img">
        <span class="admin-logo-badge">Admin</span>
      </a>

      <!-- Current user chip -->
      <div style="padding:10px 14px 14px;border-bottom:1px solid var(--border);margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--red);display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.9rem;font-weight:700;flex-shrink:0;">
            ${displayName.charAt(0).toUpperCase()}
          </div>
          <div style="min-width:0;">
            <div style="font-size:0.85rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayName}</div>
            <div style="font-size:0.7rem;padding:2px 8px;border-radius:50px;display:inline-block;margin-top:2px;
              background:${isSuperAdmin ? 'rgba(233,69,96,0.15)' : isEditor ? 'rgba(22,163,74,0.12)' : 'rgba(100,100,100,0.12)'};
              color:${isSuperAdmin ? 'var(--red)' : isEditor ? 'var(--green)' : 'var(--muted)'};
              font-weight:600;">${roleLabel}</div>
          </div>
        </div>
      </div>

      <nav class="admin-nav">
        <div class="admin-nav-section">Overview</div>
        <a href="/admin/index.html"       class="admin-nav-link"><span class="material-icons-round">dashboard</span>Dashboard</a>

        <div class="admin-nav-section">Content</div>
        <a href="/admin/predictions.html" class="admin-nav-link"><span class="material-icons-round">sports_soccer</span>Predictions</a>
        <a href="/admin/analytics.html"   class="admin-nav-link"><span class="material-icons-round">insights</span>Intelligence</a>
        ${isEditor ? `<a href="/admin/blog.html" class="admin-nav-link"><span class="material-icons-round">article</span>Blog Posts</a>` : ''}
        <a href="/leaderboard.html"       class="admin-nav-link" target="_blank"><span class="material-icons-round">leaderboard</span>Leaderboard</a>

        <div class="admin-nav-section">Management</div>
        ${isSuperAdmin ? `<a href="/admin/users.html"   class="admin-nav-link"><span class="material-icons-round">people</span>Users</a>` : ''}
        ${isEditor     ? `<a href="/admin/leagues.html" class="admin-nav-link"><span class="material-icons-round">emoji_events</span>Leagues</a>` : ''}
        ${isSuperAdmin ? `<a href="/admin/admins.html"  class="admin-nav-link"><span class="material-icons-round">admin_panel_settings</span>Admin Accounts</a>` : ''}

        <div class="admin-nav-section">Settings</div>
        ${isEditor ? `<a href="/admin/pages.html" class="admin-nav-link"><span class="material-icons-round">pages</span>Site Pages</a>
        <a href="/admin/seo.html"        class="admin-nav-link"><span class="material-icons-round">travel_explore</span>SEO Settings</a>
        <a href="/admin/sync.html"       class="admin-nav-link"><span class="material-icons-round">sync</span>Data Sync</a>` : ''}

        <div class="admin-nav-section">Account</div>
        <a href="/admin/audit.html"      class="admin-nav-link"><span class="material-icons-round">history</span>Audit Log</a>
        <a href="/admin/profile.html"    class="admin-nav-link"><span class="material-icons-round">manage_accounts</span>My Profile</a>
      </nav>

      <div class="admin-nav-bottom">
        <a href="/index.html" class="admin-nav-link"><span class="material-icons-round">open_in_new</span>View Site</a>
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

  window.Admin = {
    requireAdmin, can,
    api, toast,
    showModal, hideModal, confirm,
    fmtDate, fmtDateTime, badge,
    buildSidebar,
  };
})();
