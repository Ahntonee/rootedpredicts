/**
 * Rooted Predictions — Content Protection
 * Disables right-click, text selection, and developer tool shortcuts globally.
 * Does NOT affect input fields, textareas, or select elements.
 */
(function () {
  'use strict';

  const EXEMPT = ['INPUT', 'TEXTAREA', 'SELECT'];

  // Disable right-click context menu
  document.addEventListener('contextmenu', function (e) {
    if (!EXEMPT.includes(e.target.tagName)) e.preventDefault();
  });

  // Disable text selection via mouse drag
  document.addEventListener('selectstart', function (e) {
    if (!EXEMPT.includes(e.target.tagName)) e.preventDefault();
  });

  // Disable keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if (EXEMPT.includes(document.activeElement && document.activeElement.tagName)) return;

    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+C, Ctrl+A, Ctrl+U, Ctrl+S, Ctrl+P
    if (ctrl && ['c', 'a', 'u', 's', 'p'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }

    // F12 — DevTools
    if (e.key === 'F12') e.preventDefault();

    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C — DevTools
    if (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });

  // Disable drag-to-select on images
  document.addEventListener('dragstart', function (e) {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });
})();
