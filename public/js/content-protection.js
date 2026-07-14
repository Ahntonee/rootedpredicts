/**
 * Rooted Predictions — Content Protection
 * Text selection and copying are allowed.
 * Only image drag and DevTools shortcuts remain blocked.
 */
(function () {
  'use strict';

  // Disable drag on images only
  document.addEventListener('dragstart', function (e) {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });

  // Block DevTools shortcuts only (F12, Ctrl+Shift+I/J/C)
  document.addEventListener('keydown', function (e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F12') e.preventDefault();
    if (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });
})();
