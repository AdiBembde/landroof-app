/*
 * Show / hide password ("eye") button for every <input type="password"> on the page.
 * The button appears when the field is focused or has text. Clicking it switches the field
 * between hidden and visible text; the field goes back to hidden when its form is reset.
 * Used by both the website and the admin panel (no inline JS, so it works under the strict CSP).
 */
(function () {
  'use strict';

  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function setVisible(input, btn, visible) {
    input.type = visible ? 'text' : 'password';
    btn.innerHTML = visible ? EYE_OFF : EYE;
    btn.setAttribute('aria-pressed', String(visible));
    btn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    btn.title = visible ? 'Hide password' : 'Show password';
  }

  function enhance(input) {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = '1';

    input.classList.add('pw-input'); // lets the CSS hide the browser's own reveal button even while shown as text
    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.tabIndex = 0;
    setVisible(input, btn, false);
    wrap.appendChild(btn);

    var syncHasValue = function () { wrap.classList.toggle('has-value', input.value.length > 0); };
    input.addEventListener('input', syncHasValue);

    // Keep the cursor in the field when the button is clicked
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      var pos = input.selectionStart;
      setVisible(input, btn, input.type === 'password');
      input.focus();
      try { input.setSelectionRange(pos, pos); } catch (_) { /* not supported for this type */ }
    });

    // Back to hidden whenever the form is cleared
    if (input.form) {
      input.form.addEventListener('reset', function () {
        setTimeout(function () { setVisible(input, btn, false); syncHasValue(); }, 0);
      });
    }
    syncHasValue();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('input[type="password"]'), enhance);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /** Hides every revealed password inside a container (e.g. when a sign-in box is reopened) */
  function hideAll(container) {
    Array.prototype.forEach.call((container || document).querySelectorAll('.pw-wrap'), function (wrap) {
      var input = wrap.querySelector('input'), btn = wrap.querySelector('.pw-toggle');
      if (input && btn && input.type === 'text') setVisible(input, btn, false);
    });
  }

  window.LRPasswordToggle = { enhance: enhance, init: init, hideAll: hideAll };
})();
