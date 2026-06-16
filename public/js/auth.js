/**
 * Rooted Predictions — Frontend Auth Helper
 * Handles login state, role-based UI rendering, and auth API calls.
 * Included on every authenticated page.
 */
(function () {
  'use strict';

  // ── Check if user is logged in and update header ──────────
  async function checkAuthState() {
    try {
      const res  = await fetch('/api/auth/me', { credentials: 'include' });
      const json = await res.json();

      if (json.success && json.data) {
        const user = json.data;
        window.currentUser = user;
        updateHeaderForUser(user);
        return user;
      }
    } catch (e) {
      // Not logged in or API not available
    }
    window.currentUser = null;
    return null;
  }

  // ── Update header buttons based on auth state ─────────────
  function updateHeaderForUser(user) {
    // Replace "Log In" + "Get VIP" with user menu
    const actions = document.querySelector('.header-actions');
    if (!actions) return;

    const isVip   = user.role === 'vip' || user.role === 'admin';
    const initials = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) : 'U';

    // Find and replace login/vip buttons
    const loginBtn = actions.querySelector('.btn-login');
    const joinBtn  = actions.querySelector('.btn-join');
    const vipBtn   = actions.querySelector('.btn-vip');

    if (loginBtn) loginBtn.style.display = 'none';
    if (joinBtn)  joinBtn.style.display  = 'none';
    if (vipBtn && !isVip) {
      vipBtn.style.display = 'none';
    }

    // Swap footer login/register links for logout
    const footerLogin    = document.getElementById('footer-login-link');
    const footerRegister = document.getElementById('footer-register-link');
    if (footerLogin) {
      footerLogin.textContent = 'Logout';
      footerLogin.href = '#';
      footerLogin.style.color = 'var(--red)';
      footerLogin.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.replace('/index.html');
      });
    }
    if (footerRegister) footerRegister.style.display = 'none';

    // Insert user avatar dropdown
    const existing = document.getElementById('user-menu-wrap');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id    = 'user-menu-wrap';
    wrap.style.cssText = 'position:relative;display:flex;align-items:center;gap:8px;';
    wrap.innerHTML = `
      ${isVip
        ? `<span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:var(--red);background:rgba(233,69,96,0.12);border:1px solid rgba(233,69,96,0.25);border-radius:4px;padding:2px 7px;text-transform:uppercase;">VIP</span>`
        : `<span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:#22c55e;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);border-radius:4px;padding:2px 7px;text-transform:uppercase;">FREE</span>`
      }
      <button id="user-avatar-btn" style="width:36px;height:36px;border-radius:50%;background:var(--red);border:none;color:#fff;font-weight:700;font-size:0.85rem;cursor:pointer;flex-shrink:0;">
        ${initials}
      </button>
      <div id="user-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;width:200px;background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:600;overflow:hidden;">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border);">
          <div style="font-weight:600;font-size:0.875rem;color:var(--text);">${user.name}</div>
          <div style="font-size:0.75rem;color:var(--muted);">${user.email}</div>
          <span style="font-size:0.68rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${isVip?'var(--red)':'var(--muted)'};">${user.role.toUpperCase()}</span>
        </div>
        <a href="/dashboard.html" style="display:flex;align-items:center;gap:8px;padding:10px 14px;text-decoration:none;color:var(--text);font-size:0.85rem;" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
          <span class="material-icons-round" style="font-size:1rem;color:var(--muted);">dashboard</span>Dashboard
        </a>
        <a href="/bookmarks.html" style="display:flex;align-items:center;gap:8px;padding:10px 14px;text-decoration:none;color:var(--text);font-size:0.85rem;" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
          <span class="material-icons-round" style="font-size:1rem;color:var(--muted);">bookmark</span>Bookmarks
        </a>
        <a href="/bet-history.html" style="display:flex;align-items:center;gap:8px;padding:10px 14px;text-decoration:none;color:var(--text);font-size:0.85rem;" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
          <span class="material-icons-round" style="font-size:1rem;color:var(--muted);">history</span>Bet History
        </a>
        <a href="/profile.html" style="display:flex;align-items:center;gap:8px;padding:10px 14px;text-decoration:none;color:var(--text);font-size:0.85rem;" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
          <span class="material-icons-round" style="font-size:1rem;color:var(--muted);">manage_accounts</span>Profile
        </a>
        ${user.role === 'admin' ? `
        <a href="/admin/index.html" style="display:flex;align-items:center;gap:8px;padding:10px 14px;text-decoration:none;color:var(--text);font-size:0.85rem;" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
          <span class="material-icons-round" style="font-size:1rem;color:var(--red);">admin_panel_settings</span>Admin Panel
        </a>` : ''}
        <div style="border-top:1px solid var(--border);padding:4px 0;">
          <button id="logout-btn" style="width:100%;display:flex;align-items:center;gap:8px;padding:10px 14px;background:none;border:none;color:var(--red);font-size:0.85rem;cursor:pointer;font-family:var(--font-body);" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
            <span class="material-icons-round" style="font-size:1rem;">logout</span>Log Out
          </button>
        </div>
      </div>
    `;

    // Insert before toggle button
    const toggle = actions.querySelector('.nav-toggle');
    if (toggle) actions.insertBefore(wrap, toggle);
    else actions.appendChild(wrap);

    // Dropdown toggle
    document.getElementById('user-avatar-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('user-dropdown');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });

    // Close on outside click
    document.addEventListener('click', () => {
      const dd = document.getElementById('user-dropdown');
      if (dd) dd.style.display = 'none';
    });

    // Logout handler
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.currentUser = null;
      window.location.href = '/index.html';
    });
  }

  // ── Redirect to login if not authenticated ────────────────
  async function requireAuth(redirectTo) {
    const user = await checkAuthState();
    if (!user) {
      const returnUrl = redirectTo || window.location.pathname;
      window.location.href = `/login.html?redirect=${encodeURIComponent(returnUrl)}`;
      return null;
    }
    return user;
  }

  // ── Redirect to login if not VIP ──────────────────────────
  async function requireVip() {
    const user = await requireAuth();
    if (!user) return null;
    if (user.role !== 'vip' && user.role !== 'admin') {
      window.location.href = '/pricing.html';
      return null;
    }
    return user;
  }

  // ── Bookmark toggle ───────────────────────────────────────
  async function toggleBookmark(predictionId, btn) {
    if (!window.currentUser) {
      window.location.href = '/login.html';
      return;
    }

    const isBookmarked = btn.dataset.bookmarked === 'true';

    try {
      if (isBookmarked) {
        await fetch(`/api/users/bookmarks/prediction/${predictionId}`, {
          method: 'DELETE', credentials: 'include'
        });
        btn.dataset.bookmarked = 'false';
        btn.querySelector('.material-icons-round').textContent = 'bookmark_border';
        btn.title = 'Add bookmark';
      } else {
        await fetch('/api/users/bookmarks', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prediction_id: predictionId }),
        });
        btn.dataset.bookmarked = 'true';
        btn.querySelector('.material-icons-round').textContent = 'bookmark';
        btn.title = 'Remove bookmark';
      }
    } catch (e) {
      console.error('[AUTH] Bookmark toggle failed:', e.message);
    }
  }

  // Expose globally — fire event so app.js knows auth.js is ready
  window.AfroAuth = { checkAuthState, requireAuth, requireVip, toggleBookmark };
  document.dispatchEvent(new CustomEvent('afroauth:ready'));
})();
