// public/js/pricing.js
// Rooted Predictions — Pricing page: bank-transfer payment flow
(function () {
  'use strict';

  var _selectedPlan = null;
  var _bankDetails  = null;

  async function apiFetch(method, url, body) {
    var opts = { method: method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var res = await fetch(url, opts);
    return res.json();
  }

  function showToast(msg, type) {
    type = type || 'success';
    var colors = { success: '#22c55e', error: '#e94560', info: '#3b82f6' };
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:' + (colors[type] || colors.success) + ';' +
      'color:#fff;padding:12px 20px;border-radius:8px;font-size:0.875rem;font-weight:600;' +
      'display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);max-width:360px;';
    el.innerHTML = '<span class="material-icons-round" style="font-size:1.1rem;">' + (type === 'error' ? 'error' : 'check_circle') + '</span>' + msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 5000);
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

  // ── Bank Details Modal ────────────────────────────────────────
  function showBankModal(plan) {
    _selectedPlan = plan;
    var el = document.getElementById('bank-modal');
    if (!el) return;

    var amounts = { monthly: '8,000', quarterly: '20,800', annual: '64,000' };
    var planLabels = { monthly: 'Monthly VIP', quarterly: 'Quarterly VIP', annual: 'Annual VIP' };
    document.getElementById('bm-plan-label').textContent  = planLabels[plan] || plan;
    document.getElementById('bm-amount').textContent      = '₦' + (amounts[plan] || '');

    if (_bankDetails) {
      document.getElementById('bm-bank-name').textContent    = _bankDetails.bank_name      || 'Loading...';
      document.getElementById('bm-acct-name').textContent    = _bankDetails.account_name   || 'Loading...';
      document.getElementById('bm-acct-number').textContent  = _bankDetails.account_number || 'Loading...';
      var sortRow = document.getElementById('bm-sort-row');
      if (_bankDetails.sort_code) {
        document.getElementById('bm-sort-code').textContent = _bankDetails.sort_code;
        if (sortRow) sortRow.style.display = '';
      } else {
        if (sortRow) sortRow.style.display = 'none';
      }
    }

    el.style.display = 'flex';
  }

  function hideBankModal() {
    var el = document.getElementById('bank-modal');
    if (el) el.style.display = 'none';
  }

  // ── Upload Modal ──────────────────────────────────────────────
  function showUploadModal() {
    hideBankModal();
    var el = document.getElementById('upload-modal');
    if (el) {
      document.getElementById('um-preview').style.display = 'none';
      document.getElementById('um-preview').src = '';
      document.getElementById('um-file').value  = '';
      document.getElementById('um-status').textContent = '';
      document.getElementById('um-status').style.color = '';
      el.style.display = 'flex';
    }
  }

  function hideUploadModal() {
    var el = document.getElementById('upload-modal');
    if (el) el.style.display = 'none';
  }

  function handleFileChange(evt) {
    var file = evt.target.files[0];
    if (!file) return;

    var allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.indexOf(file.type) === -1) {
      document.getElementById('um-status').textContent = 'Only JPEG, PNG, WebP, or GIF images are allowed.';
      document.getElementById('um-status').style.color = '#e94560';
      evt.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      document.getElementById('um-status').textContent = 'Image must be under 5 MB.';
      document.getElementById('um-status').style.color = '#e94560';
      evt.target.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      var preview = document.getElementById('um-preview');
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
    document.getElementById('um-status').textContent = '';
  }

  async function submitProof() {
    var fileInput = document.getElementById('um-file');
    var statusEl  = document.getElementById('um-status');
    var submitBtn = document.getElementById('um-submit-btn');

    if (!fileInput.files[0]) {
      statusEl.textContent = 'Please select an image first.';
      statusEl.style.color = '#e94560';
      return;
    }
    if (!_selectedPlan) {
      statusEl.textContent = 'No plan selected. Please close and try again.';
      statusEl.style.color = '#e94560';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    statusEl.textContent  = '';

    // Convert file to base64
    var reader = new FileReader();
    reader.onload = async function(e) {
      try {
        var json = await apiFetch('POST', '/api/subscriptions/manual/submit', {
          plan:      _selectedPlan,
          imageData: e.target.result,
        });

        if (json.success) {
          hideUploadModal();
          showSuccessModal();
        } else {
          statusEl.textContent = json.message || 'Submission failed. Please try again.';
          statusEl.style.color = '#e94560';
          submitBtn.disabled   = false;
          submitBtn.textContent = 'Submit for Verification';
        }
      } catch (err) {
        statusEl.textContent = 'Network error. Please check your connection.';
        statusEl.style.color = '#e94560';
        submitBtn.disabled   = false;
        submitBtn.textContent = 'Submit for Verification';
      }
    };
    reader.readAsDataURL(fileInput.files[0]);
  }

  // ── Success Modal ─────────────────────────────────────────────
  function showSuccessModal() {
    var el = document.getElementById('success-modal');
    if (el) el.style.display = 'flex';
  }

  function hideSuccessModal() {
    var el = document.getElementById('success-modal');
    if (el) el.style.display = 'none';
  }

  // ── Session / Status ──────────────────────────────────────────
  async function getSessionUser() {
    try {
      var json = await apiFetch('GET', '/api/auth/me');
      return (json.success && json.data) ? json.data : null;
    } catch (e) {
      return null;
    }
  }

  async function loadSubscriptionStatus() {
    var json = await apiFetch('GET', '/api/subscriptions/status');
    if (!json.success || !json.data) return;
    var sub = json.data;
    if (sub.status === 'active' || sub.status === 'trialing') {
      var banner = document.getElementById('vip-active-banner');
      var label  = document.getElementById('vip-expires-label');
      if (banner) banner.style.display = 'block';
      if (label && sub.expires_at) {
        var exp = new Date(sub.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        label.textContent = sub.status === 'trialing'
          ? 'Trial ends ' + new Date(sub.trial_ends_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
          : 'Active until ' + exp;
      }
      document.querySelectorAll('.pay-btn').forEach(function(btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons-round">check_circle</span> Already Subscribed';
        btn.style.opacity = '0.6';
        btn.style.cursor  = 'not-allowed';
      });
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    if (!document.getElementById('spin-style')) {
      var s = document.createElement('style');
      s.id = 'spin-style';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    // Load bank details once in background
    apiFetch('GET', '/api/subscriptions/bank-details').then(function(json) {
      if (json.success) {
        _bankDetails = json.data;
        // Refresh if modal is already open
        if (document.getElementById('bank-modal') &&
            document.getElementById('bank-modal').style.display === 'flex' &&
            _selectedPlan) {
          showBankModal(_selectedPlan);
        }
      }
    }).catch(function() {});

    // Check session once on load
    getSessionUser().then(function(user) {
      if (user) loadSubscriptionStatus();
    });

    // Wire up all pay buttons to show bank modal
    document.querySelectorAll('.pay-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (btn.disabled) return;

        setButtonLoading(btn, true);
        var user = await getSessionUser();
        setButtonLoading(btn, false);

        if (!user) {
          showToast('Please log in or create an account to subscribe.', 'info');
          setTimeout(function() {
            window.location.href = '/login.html?redirect=' + encodeURIComponent('/pricing.html');
          }, 1200);
          return;
        }

        showBankModal(btn.dataset.plan);
      });
    });

    // Bank modal: "I Have Made Payment" button
    var paidBtn = document.getElementById('bm-paid-btn');
    if (paidBtn) paidBtn.addEventListener('click', showUploadModal);

    // Bank modal: Cancel
    var bmCancelBtn = document.getElementById('bm-cancel-btn');
    if (bmCancelBtn) bmCancelBtn.addEventListener('click', hideBankModal);

    // Upload modal: file change
    var fileInput = document.getElementById('um-file');
    if (fileInput) fileInput.addEventListener('change', handleFileChange);

    // Upload modal: submit
    var umSubmitBtn = document.getElementById('um-submit-btn');
    if (umSubmitBtn) umSubmitBtn.addEventListener('click', submitProof);

    // Upload modal: back / cancel
    var umBackBtn   = document.getElementById('um-back-btn');
    if (umBackBtn) umBackBtn.addEventListener('click', function() { hideUploadModal(); showBankModal(_selectedPlan); });

    var umCancelBtn = document.getElementById('um-cancel-btn');
    if (umCancelBtn) umCancelBtn.addEventListener('click', hideUploadModal);

    // Success modal: close
    var smCloseBtn = document.getElementById('sm-close-btn');
    if (smCloseBtn) smCloseBtn.addEventListener('click', hideSuccessModal);

    // Close modals on backdrop click
    ['bank-modal', 'upload-modal', 'success-modal'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', function(e) {
          if (e.target === el) el.style.display = 'none';
        });
      }
    });

    // Copy account number to clipboard
    var copyBtn = document.getElementById('bm-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var num = document.getElementById('bm-acct-number').textContent.trim();
        if (num && navigator.clipboard) {
          navigator.clipboard.writeText(num).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
          });
        }
      });
    }

    // Show cancelled toast if redirected back
    var params = new URLSearchParams(window.location.search);
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
