/*
 * Declarative event handlers that work under a strict Content-Security-Policy.
 *
 * Instead of inline handlers (onclick="…"), which a strict CSP blocks, markup uses
 *   data-on-click="openModal('list-modal');return false"
 *   data-on-submit="handleAuth(event)"   data-on-input / data-on-change / data-on-error
 *
 * Each statement must be a call to a function the page registered with LRActions.register().
 * Arguments may only be literals ('text', 12, true, false, null) or `this` / `event`.
 * Nothing is ever eval'd, so injected markup can't run arbitrary code.
 * Also supported: `return false` (preventDefault) and event.stopPropagation() / event.preventDefault().
 */
(function () {
  'use strict';
  var registry = Object.create(null);

  function parseArgs(src, el, ev) {
    var args = [], i = 0, s = src.trim();
    while (i < s.length) {
      while (s[i] === ' ') i++;
      var ch = s[i], val;
      if (ch === "'" || ch === '"') {
        var end = i + 1, out = '';
        while (end < s.length && s[end] !== ch) {
          if (s[end] === '\\' && end + 1 < s.length) { out += s[end + 1]; end += 2; } else out += s[end++];
        }
        if (end >= s.length) throw new Error('Unterminated string');
        val = out; i = end + 1;
      } else {
        var m = /^(-?\d+(?:\.\d+)?|true|false|null|this|event)/.exec(s.slice(i));
        if (!m) throw new Error('Unsupported argument: ' + s.slice(i));
        var t = m[1];
        val = t === 'this' ? el : t === 'event' ? ev : t === 'true' ? true : t === 'false' ? false : t === 'null' ? null : Number(t);
        i += t.length;
      }
      args.push(val);
      while (s[i] === ' ') i++;
      if (i < s.length) {
        if (s[i] !== ',') throw new Error('Expected , in arguments: ' + src);
        i++;
      }
    }
    return args;
  }

  // Splits on ; outside of quotes
  function statements(code) {
    var out = [], cur = '', q = null;
    for (var i = 0; i < code.length; i++) {
      var c = code[i];
      if (q) { cur += c; if (c === '\\') { cur += code[++i] || ''; } else if (c === q) q = null; }
      else if (c === "'" || c === '"') { q = c; cur += c; }
      else if (c === ';') { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  var state = { stopped: false };

  function run(code, el, ev) {
    statements(code).forEach(function (stmt) {
      if (stmt === 'return false' || stmt === 'event.preventDefault()') { ev.preventDefault(); return; }
      if (stmt === 'event.stopPropagation()') { ev.stopPropagation(); state.stopped = true; return; }
      var m = /^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/.exec(stmt);
      if (!m || !registry[m[1]]) { console.error('[actions] Not allowed:', stmt); return; }
      try { registry[m[1]].apply(el, parseArgs(m[2], el, ev)); }
      catch (e) { console.error('[actions] ' + stmt, e); }
    });
  }

  function dispatch(type) {
    var attr = 'data-on-' + type;
    return function (ev) {
      state.stopped = false;
      // A handler that calls event.stopPropagation() must also stop our own bubbling walk
      var nativeStop = ev.stopPropagation;
      ev.stopPropagation = function () { state.stopped = true; nativeStop.call(ev); };
      var el = ev.target instanceof Element ? ev.target : ev.target.parentElement;
      // Walk up like normal bubbling, so nested handlers and stopPropagation behave as before
      while (el && el !== document.documentElement) {
        var code = el.getAttribute && el.getAttribute(attr);
        if (code) run(code, el, ev);
        if (state.stopped || type === 'error') break;
        el = el.parentElement;
      }
    };
  }

  ['click', 'submit', 'input', 'change'].forEach(function (type) {
    document.addEventListener(type, dispatch(type));
  });
  // error events (e.g. a broken <img>) don't bubble — listen in the capture phase
  document.addEventListener('error', dispatch('error'), true);

  window.LRActions = {
    register: function (fns) { Object.keys(fns).forEach(function (k) { registry[k] = fns[k]; }); },
  };

  // Small helpers used by both pages
  window.LRActions.register({
    /** <img data-on-error="logoFallback('inline')"> — hide a broken logo and show the text next to it */
    logoFallback: function (display) {
      this.style.display = 'none';
      if (this.nextElementSibling) this.nextElementSibling.style.display = display || 'inline';
    },
    /** Opens a hidden file input */
    clickEl: function (id) { var el = document.getElementById(id); if (el) el.click(); },
    scrollToTop: function () { window.scrollTo({ top: 0, behavior: 'smooth' }); },
  });
})();
