// public/js/pricing.js
// Rooted Predictions — Pricing page: payment flow (Paystack + Bank Transfer)
(function () {
  'use strict';

  var _sessionUser = null;
  var _selectedPlan = null;
  var _paymentQuote = null;
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

    if (!_paymentQuote || _paymentQuote.plan !== plan) return;
    document.getElementById('bm-plan-label').textContent = (plan === 'standard' ? 'Standard Plan' : 'Deluxe Plan') + (_paymentQuote.duration === 'biweekly' ? ' - Bi-weekly (14 days)' : ' - Monthly (30 days)');
    document.getElementById('bm-amount').textContent = _paymentQuote.currency + ' ' + Number(_paymentQuote.amount).toLocaleString('en-NG');
    var destination = _paymentQuote.destination;
    document.getElementById('bm-title').textContent = destination.label;
    document.getElementById('bm-provider-label').textContent = _paymentQuote.method === 'usdt' ? 'Network' : 'Provider';
    document.getElementById('bm-number-label').textContent = _paymentQuote.method === 'usdt' ? 'Wallet address' : 'Account number';
    document.getElementById('bm-bank-name').textContent = destination.network || [destination.provider, destination.country].filter(Boolean).join(' - ');
    document.getElementById('bm-instructions').textContent = _paymentQuote.method === 'usdt' ? 'Send USDT only on the ' + destination.network + ' network to this address. Upload your transfer receipt for verification.' : 'Pay the exact amount in ' + _paymentQuote.currency + ' to the account shown, then upload your receipt for verification.';
    if (destination.international) {
      document.getElementById('bm-title').textContent = 'International MoMo transfer';
      document.getElementById('bm-instructions').textContent = 'Send a transfer to the MoMo account shown above. The receiving account must receive ' + _paymentQuote.currency + ' ' + Number(_paymentQuote.amount).toLocaleString('en-NG') + '. Check that your payment service supports transfers to this Nigerian MoMo account before paying, then upload your receipt. You can also choose USDT on the BEP-20 network.';
    }
    document.getElementById('bm-acct-name').textContent = _paymentQuote.destination.account_name || '—';
    document.getElementById('bm-acct-number').textContent = _paymentQuote.destination.account_number;
    document.getElementById('bm-sort-row').style.display = 'none';

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

    var reader = new FileReader();
    reader.onload = async function(e) {
      try {
        var json = await apiFetch('POST', '/api/subscriptions/manual/submit', {
          plan:       _selectedPlan,
          quoteToken: _paymentQuote && _paymentQuote.token,
          imageData:  e.target.result,
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

  function updatePaymentMethods() {
    var select = document.getElementById('payment-method');
    if (!select || !select.options) return;
    var country = String(_sessionUser && _sessionUser.country || '').trim().toUpperCase();
    var foreign = country && country !== 'NG' && country !== 'NIGERIA';
    Array.from(select.options).forEach(function(option) {
      if (option.value === 'moniepoint') { option.hidden = !!foreign; option.disabled = !!foreign; }
    });
    if (foreign && select.value === 'moniepoint') select.value = 'paystack';
  }

  function applyMembership(user) {
    var tier = user && user.membership_tier || 'free';
    var admin = user && user.role === 'admin';
    var subscribed = tier === 'standard' || tier === 'deluxe';
    var banner = document.getElementById('vip-active-banner');
    if (banner) banner.style.display = subscribed ? 'block' : 'none';
    document.querySelectorAll('.pay-btn').forEach(function(btn) {
      var upgrade = tier === 'standard' && btn.dataset.plan === 'deluxe';
      btn.disabled = !!admin || (subscribed && !upgrade);
      btn.textContent = admin ? 'Admin Account' : upgrade ? 'Upgrade to Deluxe' : subscribed ? 'Already subscribed' : 'Get ' + (btn.dataset.plan === 'standard' ? 'Standard' : 'Deluxe') + ' VIP';
      btn.style.opacity = btn.disabled ? '0.6' : '1';
      btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    if (!document.getElementById('spin-style')) {
      var s = document.createElement('style');
      s.id = 'spin-style';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    // Load bank details once in background & preserve Paystack in dropdown
    apiFetch('GET', '/api/subscriptions/bank-details').then(function(json) {
      if (json.success) {
        _bankDetails = json.data;
        var methodSelect = document.getElementById('payment-method');
        if (methodSelect && json.data.methods) {
          var currentVal = methodSelect.value || 'paystack';
          methodSelect.textContent = '';
          var paystackOpt = document.createElement('option');
          paystackOpt.value = 'paystack';
          paystackOpt.textContent = 'Paystack (Card, Mobile Money, Bank Transfer)';
          methodSelect.appendChild(paystackOpt);
          Object.entries(json.data.methods).forEach(function(entry) {
            var option = document.createElement('option');
            option.value = entry[0];
            option.disabled = !entry[1].enabled;
            option.textContent = (entry[0] === 'momo' ? 'MoMo / International transfer' : entry[1].label) + (entry[1].enabled ? ' (' + entry[1].currency + ')' : ' — unavailable');
            methodSelect.appendChild(option);
          });
          methodSelect.value = currentVal;
        }
        updatePaymentMethods();
        if (document.getElementById('bank-modal') &&
            document.getElementById('bank-modal').style.display === 'flex' &&
            _selectedPlan) {
          showBankModal(_selectedPlan);
        }
      }
    }).catch(function() {});

    // Check session once on load
    getSessionUser().then(function(user) {
      _sessionUser = user;
      updatePaymentMethods();
      if (window.PricingCurrency) window.PricingCurrency.setCountry(user && user.country);
      applyMembership(user);
    });

    // Wire up all pay buttons
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

        applyMembership(user);
        if (btn.disabled) return;

        var selectedMethod = document.getElementById('payment-method').value;
        var durationSelect = document.getElementById(btn.dataset.durationSelect || 'pricing-duration');
        var durationVal = durationSelect ? durationSelect.value : 'monthly';

        // ── Paystack Checkout (Inline Popup Modal) ───────────────
        if (selectedMethod === 'paystack') {
          try {
            setButtonLoading(btn, true);
            var selectedCurrency = (document.getElementById('pricing-currency') || {}).value || 'NGN';
            var initRes = await apiFetch('POST', '/api/subscriptions/paystack/initialize', {
              plan:     btn.dataset.plan,
              duration: durationVal,
              currency: selectedCurrency,
            });

            if (!initRes.success || !initRes.data) {
              throw new Error(initRes.message || 'Unable to start Paystack checkout.');
            }

            var payData = initRes.data;

            // If Paystack Inline SDK is loaded, open popup modal directly on-site
            if (window.PaystackPop && payData.access_code) {
              var handleSuccess = function(response) {
                setButtonLoading(btn, true);
                var ref = (response && (response.reference || response.trxref)) || payData.reference;
                apiFetch('POST', '/api/subscriptions/paystack/verify', { reference: ref })
                  .then(function(vRes) {
                    if (vRes.success) {
                      showToast('Payment verified! VIP active.', 'success');
                      setTimeout(function() { window.location.href = '/dashboard.html?vip=success'; }, 1000);
                    } else {
                      showToast(vRes.message || 'Verification pending.', 'error');
                      setButtonLoading(btn, false);
                    }
                  })
                  .catch(function() {
                    showToast('Verification error. Please check dashboard.', 'error');
                    setButtonLoading(btn, false);
                  });
              };

              var handleClose = function() {
                setButtonLoading(btn, false);
                applyMembership(user);
              };

              var popupConfig = {
                access_code: payData.access_code,
                callback:    handleSuccess,
                onSuccess:   handleSuccess,
                onClose:     handleClose,
                onCancel:    handleClose
              };

              if (payData.public_key && typeof payData.public_key === 'string' && payData.public_key.trim().length > 5) {
                popupConfig.key = payData.public_key.trim();
              }

              var handler = PaystackPop.setup(popupConfig);
              handler.openIframe();
            } else if (payData.url) {
              // Fallback redirect if inline SDK fails to load
              window.location.href = payData.url;
            } else {
              throw new Error('Paystack checkout initialization failed.');
            }
          } catch (err) {
            showToast(err.message, 'error');
            setButtonLoading(btn, false);
            applyMembership(user);
          }
          return;
        }

        // ── Manual Bank Transfer / USDT ──────────────────────────
        try {
          setButtonLoading(btn, true);
          var quote = await apiFetch('POST', '/api/subscriptions/manual/quote', {
            plan: btn.dataset.plan,
            method: selectedMethod,
            duration: durationVal
          });
          if (!quote.success) throw new Error(quote.message || 'Unable to load payment details.');
          _paymentQuote = quote.data;
          showBankModal(btn.dataset.plan);
        } catch (error) { showToast(error.message, 'error'); }
        finally { setButtonLoading(btn, false); applyMembership(user); }
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