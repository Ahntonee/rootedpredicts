// public/js/pricing.js
// Rooted Predictions — Pricing page: payment button logic + subscription status check
(function () {
  'use strict';

  async function apiFetch(method, url, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    return res.json();
  }

  function showToast(msg, type) {
    type = type || 'success';
    const colors = { success: '#22c55e', error: '#e94560', info: '#3b82f6' };
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${colors[type]||colors.success};
      color:#fff;padding:12px 20px;border-radius:8px;font-size:0.875rem;font-weight:600;
      display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);max-width:360px;`;
    el.innerHTML = `<span class="material-icons-round" style="font-size:1.1rem;">${type==='error'?'error':'check_circle'}</span>${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function setButtonLoading(btn, loading) {
    if (loading) {
      btn.dataset.original = btn.innerHTML;
      btn.innerHTML = '<span class="material-icons-round" style="animation:spin 1s linear infinite;font-size:1rem;">refresh</span> Processing...';
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.original || btn.innerHTML;
      btn.disabled = false;
    }
  }

  async function handleStripe(plan, btn) {
    setButtonLoading(btn, true);
    try {
      const json = await apiFetch('POST', '/api/subscriptions/stripe/create-checkout', { plan });
      if (json.success && json.data?.url) {
        window.location.href = json.data.url;
      } else {
        showToast(json.message || 'Could not start checkout. Please try again.', 'error');
        setButtonLoading(btn, false);
      }
    } catch (e) {
      showToast('Network error. Please check your connection.', 'error');
      setButtonLoading(btn, false);
    }
  }

  async function handlePaystack(plan, btn) {
    setButtonLoading(btn, true);
    try {
      const json = await apiFetch('POST', '/api/subscriptions/paystack/initialize', { plan });
      if (json.success && json.data?.url) {
        window.location.href = json.data.url;
      } else {
        showToast(json.message || 'Could not start Paystack checkout.', 'error');
        setButtonLoading(btn, false);
      }
    } catch (e) {
      showToast('Network error. Please check your connection.', 'error');
      setButtonLoading(btn, false);
    }
  }

  async function checkPaystackReturn() {
    const params = new URLSearchParams(window.location.search);
    const ref    = params.get('reference') || params.get('trxref');
    if (!ref) return;

    const json = await apiFetch('POST', '/api/subscriptions/paystack/verify', { reference: ref });
    if (json.success) {
      showToast('VIP activated! Welcome to Rooted Predictions VIP.', 'success');
      setTimeout(() => window.location.href = '/dashboard.html?vip=success', 2500);
    } else {
      showToast(json.message || 'Payment verification failed.', 'error');
    }
    // Clean URL
    history.replaceState({}, '', '/pricing.html');
  }

  async function loadSubscriptionStatus() {
    const json = await apiFetch('GET', '/api/subscriptions/status');
    if (!json.success || !json.data) return;

    const sub = json.data;
    if (sub.status === 'active' || sub.status === 'trialing') {
      const banner = document.getElementById('vip-active-banner');
      const label  = document.getElementById('vip-expires-label');
      if (banner) banner.style.display = 'block';
      if (label && sub.expires_at) {
        const exp = new Date(sub.expires_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
        label.textContent = sub.status === 'trialing'
          ? `Trial ends ${new Date(sub.trial_ends_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`
          : `Active until ${exp}`;
      }
      // Disable all pay buttons if already subscribed
      document.querySelectorAll('.pay-btn').forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons-round">check_circle</span> Already Subscribed';
        btn.style.opacity = '0.6';
        btn.style.cursor  = 'not-allowed';
      });
    }
  }

  // Returns the current user from the session cookie, or null if not logged in.
  // httpOnly cookies are invisible to JS so we must ask the server.
  async function getSessionUser() {
    try {
      const json = await apiFetch('GET', '/api/auth/me');
      return json.success && json.data ? json.data : null;
    } catch (e) {
      return null;
    }
  }

  function init() {
    // Add spin keyframe if not present
    if (!document.getElementById('spin-style')) {
      const s = document.createElement('style');
      s.id = 'spin-style';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    // Handle Paystack return redirect
    checkPaystackReturn();

    // Check session once on load — show VIP status or enable buttons
    getSessionUser().then(user => {
      if (user) loadSubscriptionStatus();
    });

    // Wire up all pay buttons
    document.querySelectorAll('.pay-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;

        setButtonLoading(btn, true);
        const user = await getSessionUser();

        if (!user) {
          setButtonLoading(btn, false);
          showToast('Please log in or create an account to subscribe.', 'info');
          setTimeout(() => {
            window.location.href = '/login.html?redirect=' + encodeURIComponent('/pricing.html');
          }, 1200);
          return;
        }

        // User is logged in — proceed with payment (button stays loading)
        const plan     = btn.dataset.plan;
        const provider = btn.dataset.provider;

        if (provider === 'paystack') {
          handlePaystack(plan, btn);
        } else {
          handleStripe(plan, btn);
        }
      });
    });

    // Show cancelled toast if redirected back from Stripe
    const params = new URLSearchParams(window.location.search);
    if (params.get('cancelled') === '1') {
      showToast('Checkout cancelled. No charge was made.', 'info');
      history.replaceState({}, '', '/pricing.html');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
