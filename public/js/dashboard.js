/**
 * AfroPredict — Dashboard Shared Utilities
 * Included on: bookmarks.html, bet-history.html
 */
(function () {
  'use strict';

  // Format currency
  function formatCurrency(amount, currency) {
    currency = currency || 'USD';
    const n = parseFloat(amount || 0);
    return (n >= 0 ? '+' : '') + new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2
    }).format(Math.abs(n)).replace(/^[+-]/, (n >= 0 ? '+' : '-'));
  }

  // Format date nicely
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  // Result badge HTML
  function resultBadge(result) {
    const map = {
      won:     '<span class="badge badge-won"><span class="material-icons-round">check_circle</span>WON</span>',
      lost:    '<span class="badge badge-lost"><span class="material-icons-round">cancel</span>LOST</span>',
      pending: '<span class="badge badge-pending">PENDING</span>',
      void:    '<span class="badge badge-pending">VOID</span>',
    };
    return map[result] || map.pending;
  }

  // Show toast notification
  function toast(message, type) {
    type = type || 'success';
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;
      border-radius:8px;font-size:0.875rem;font-weight:600;display:flex;align-items:center;gap:8px;
      background:${type==='success'?'var(--green)':type==='error'?'var(--red)':'var(--midnight)'};
      color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:slideIn 0.2s ease;`;
    el.innerHTML = `<span class="material-icons-round" style="font-size:1rem;">${type==='success'?'check_circle':'error'}</span>${message}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // Expose globally
  window.DashUtils = { formatCurrency, formatDate, resultBadge, toast };
})();
