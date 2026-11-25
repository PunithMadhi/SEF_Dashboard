/*!
 * Wireframe review kit — Figma-style comments for plain HTML prototypes.
 * Plain JavaScript, no build step. All UI lives in a Shadow DOM root.
 *
 * Usage:
 *   <script src="review-kit/review-kit.js" data-endpoint="https://script.google.com/macros/s/…/exec" data-project="sparc" defer></script>
 * or set window.reviewKitConfig = { endpoint, project } before this script runs,
 * or call window.initReviewKit({ endpoint, project }) yourself.
 *
 * Page awareness: define window.reviewKitAdapter = { getPage(), goTo(key) } (see README).
 * All user-supplied text is rendered with textContent only.
 */
(function () {
  'use strict';

  var currentScript = document.currentScript;
  var started = false;

  /* ------------------------------------------------------------------ config */

  function resolveConfig(opts) {
    var ds = (currentScript && currentScript.dataset) || {};
    var g = window.reviewKitConfig || {};
    var endpoint = (opts && opts.endpoint) || ds.endpoint || g.endpoint || '';
    var project = (opts && opts.project) || ds.project || g.project || 'prototype';
    // Local development always talks to the mock server, so testing never writes to the real sheet.
    // Override with localStorage 'review-kit-endpoint' if you really want another endpoint locally.
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) endpoint = getItem('localStorage', 'review-kit-endpoint') || 'http://localhost:8787/exec';
    return { endpoint: endpoint, project: project };
  }

  window.initReviewKit = function (opts) {
    if (started) return;
    var cfg = resolveConfig(opts);
    if (!/^https?:\/\//.test(cfg.endpoint)) {
      console.warn('[review-kit] No endpoint configured; comments are disabled.');
      return;
    }
    started = true;
    start(cfg);
  };

  /* ------------------------------------------------------------ constants */

  var C = {
    accent: '#C9501C', accentDark: '#9A3D14', accentSoft: '#FBE3D3', ink: '#1B2733', muted: '#5B6B7B',
    line: '#E2E7ED', canvas: '#F3F5F8', grey: '#9AA4B0', amber: '#C77C02', green: '#2E8540',
  };
  var STATUSES = ['Open', 'In progress', 'Resolved'];
  var PRIORITIES = ['Low', 'Medium', 'High'];
  var STATUS_COL = { 'Open': C.accent, 'In progress': C.amber, 'Resolved': C.green };
  var NAME_KEY = 'review-kit-name';
  var PREFS_KEY = 'review-kit-prefs';
  var OPEN_KEY = 'review-kit-open';
  var REVIEW_HEADERS = ['Comment ID', 'Project', 'Page', 'Role', 'Element', 'Comment', 'Author', 'Time',
    'Priority', 'Status', 'Resolved by', 'Resolved at', 'Resolution note', 'Status history', 'Replies',
    'Open in prototype'];

  /* --------------------------------------------------------------- helpers */

  function store(kind) {
    try { return window[kind]; } catch (e) { return null; }
  }
  function getItem(kind, k) { try { var s = store(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function setItem(kind, k, v) { try { var s = store(kind); if (s) s.setItem(k, v); } catch (e) { /* ignore */ } }
  function removeItem(kind, k) { try { var s = store(kind); if (s) s.removeItem(k); } catch (e) { /* ignore */ } }

  // DOM builder. Strings become text nodes; never parses HTML.
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function num(id) { var m = /-(\d+)$/.exec(id || ''); return m ? m[1] : '?'; }
  function select(options, value, onchange, label) {
    return h('select', { 'aria-label': label, onchange: function (e) { onchange(e.target.value); } },
      options.map(function (o) {
        var v = typeof o === 'string' ? o : o.value, t = typeof o === 'string' ? o : o.label;
        var opt = h('option', { value: v }, [t]);
        if (v === value) opt.selected = true;
        return opt;
      }));
  }

  /* ---------------------------------------------------------------- styles */

  var STYLE = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.layer{position:fixed;inset:0;pointer-events:none}',
    '.hl{position:fixed;border:2px solid ' + C.accent + ';background:rgba(201,80,28,.08);border-radius:3px;pointer-events:none;display:none}',
    '.banner{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:' + C.ink + ';color:#fff;font-size:12.5px;padding:7px 14px;border-radius:999px;pointer-events:none;display:none;box-shadow:0 4px 14px rgba(0,0,0,.2);white-space:nowrap}',
    '.fab{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;pointer-events:auto}',
    '.fab.shift{right:396px}',
    '@media (max-width:560px){.fab.shift{display:none}}',
    '.fab button{position:relative;width:44px;height:44px;border-radius:50%;border:1px solid ' + C.line + ';background:#fff;font-size:19px;cursor:pointer;box-shadow:0 4px 14px rgba(18,48,90,.18);display:grid;place-items:center;padding:0}',
    '.fab button:hover{border-color:' + C.accent + '}',
    '.fab button.on{background:' + C.accent + ';border-color:' + C.accent + '}',
    '.fab button.off{opacity:.45}',
    '.badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:' + C.accent + ';color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center}',
    '.pin{position:fixed;width:26px;height:26px;margin:-26px 0 0 0;border-radius:13px 13px 13px 2px;background:' + C.accent + ';color:#fff;border:2px solid #fff;font-size:11.5px;font-weight:700;display:grid;place-items:center;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.28);padding:0}',
    '.pin.resolved{background:' + C.green + '}',
    '.pin.lost{background:' + C.grey + '}',
    '.pin.active{outline:3px solid ' + C.accentSoft + '}',
    '.card{position:fixed;width:320px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;color:' + C.ink + ';border:1px solid ' + C.line + ';border-radius:10px;box-shadow:0 12px 32px rgba(18,48,90,.22);pointer-events:auto;font-size:13px;line-height:1.4}',
    '.card .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';font-weight:600}',
    '.card .hd .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.card .bd{padding:10px 12px;display:flex;flex-direction:column;gap:10px}',
    '.x{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:' + C.muted + ';padding:2px 4px}',
    'textarea,input[type=text],select{width:100%;border:1px solid ' + C.line + ';border-radius:6px;padding:7px 8px;font-size:13px;color:' + C.ink + ';background:#fff}',
    'textarea{min-height:70px;resize:vertical}',
    'textarea:focus,input:focus,select:focus{outline:2px solid ' + C.accentSoft + ';border-color:' + C.accent + '}',
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.btn{border:1px solid ' + C.line + ';background:#fff;color:' + C.ink + ';border-radius:6px;padding:6px 11px;font-size:12.5px;cursor:pointer;font-weight:500}',
    '.btn:hover{border-color:' + C.accent + '}',
    '.btn.primary{background:' + C.accent + ';border-color:' + C.accent + ';color:#fff}',
    '.btn.sel{background:' + C.accentSoft + ';border-color:' + C.accent + ';color:' + C.accentDark + ';font-weight:600}',
    '.btn:disabled{opacity:.5;cursor:default}',
    '.muted{color:' + C.muted + ';font-size:11.5px}',
    '.chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:' + C.canvas + ';color:' + C.ink + '}',
    '.dot{width:7px;height:7px;border-radius:50%}',
    '.msg{white-space:pre-wrap;word-wrap:break-word}',
    '.reply{border-left:3px solid ' + C.line + ';padding-left:8px}',
    '.sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:' + C.muted + '}',
    '.hist{font-size:11.5px;color:' + C.muted + ';display:flex;flex-direction:column;gap:3px}',
    '.note{background:' + C.canvas + ';border-radius:6px;padding:7px 9px;font-size:12px;color:' + C.muted + '}',
    '.panel{position:fixed;top:0;right:0;bottom:0;width:380px;max-width:100vw;background:#fff;color:' + C.ink + ';border-left:1px solid ' + C.line + ';box-shadow:-8px 0 28px rgba(18,48,90,.16);pointer-events:auto;display:flex;flex-direction:column;font-size:13px}',
    '.panel .hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid ' + C.line + ';font-weight:600;font-size:14px}',
    '.panel .flt{padding:10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:6px;border-bottom:1px solid ' + C.line + '}',
    '.panel .flt .wide{grid-column:1/-1}',
    '.panel .list{flex:1;overflow:auto}',
    '.item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid ' + C.line + ';background:#fff;padding:10px 14px;cursor:pointer;font-size:12.5px;color:' + C.ink + '}',
    '.item:hover{background:' + C.canvas + '}',
    '.item .top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px}',
    '.item .txt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.num{display:inline-grid;place-items:center;min-width:22px;height:20px;border-radius:10px 10px 10px 2px;background:' + C.accent + ';color:#fff;font-size:10.5px;font-weight:700;padding:0 4px}',
    '.num.resolved{background:' + C.green + '}',
    '.lostTag{font-size:10.5px;font-weight:600;color:' + C.muted + ';background:' + C.canvas + ';border-radius:4px;padding:1px 6px}',
    '.panel .ft{padding:10px 14px;border-top:1px solid ' + C.line + ';display:flex;gap:8px;align-items:center;justify-content:space-between}',
    '.empty{padding:24px 14px;color:' + C.muted + ';text-align:center}',
    '.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:' + C.ink + ';color:#fff;padding:8px 14px;border-radius:8px;font-size:12.5px;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.25);max-width:90vw}',
    '.modal{position:fixed;inset:0;background:rgba(27,39,51,.35);display:grid;place-items:center;pointer-events:auto}',
    '.modal .card{position:static}',
    'label.chk{display:flex;gap:6px;align-items:center;font-size:12px;color:' + C.ink + ';cursor:pointer}',
    '@media (max-width:560px){.card.sheet{left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto}}',
  ].join('\n');

  /* ----------------------------------------------------------------- start */

  function start(cfg) {
    hideNetlifyToolbar();

    var state = {
      threads: [], name: getItem('localStorage', NAME_KEY) || '',
      mode: false, showPins: true, showResolved: false,
      openId: null, openStay: false, openMsg: '', panel: false,
      filters: { page: '', author: '', status: '', priority: '', q: '' },
      lost: {}, pendingOpen: null, loading: false,
    };
    try { var prefs = JSON.parse(getItem('localStorage', PREFS_KEY) || '{}'); if (prefs.showResolved) state.showResolved = true; if (prefs.showPins === false) state.showPins = false; } catch (e) { /* ignore */ }
    var fromNav = getItem('sessionStorage', OPEN_KEY);
    if (fromNav) { state.pendingOpen = fromNav; removeItem('sessionStorage', OPEN_KEY); }

    /* ---------- shadow root ---------- */
    var host = h('div', { id: 'review-kit-root', style: 'position:fixed;inset:0;pointer-events:none;z-index:2147483000' });
    var root = host.attachShadow({ mode: 'open' });
    root.appendChild(h('style', null, [STYLE]));
    var layer = h('div', { class: 'layer' });
    var hl = h('div', { class: 'hl' });
    var banner = h('div', { class: 'banner' }, ['Comment mode — click anything to comment · Esc to exit']);
    var pinsLayer = h('div', { class: 'layer' });
    var popLayer = h('div', { class: 'layer' });
    var btnMode = h('button', { type: 'button', title: 'Comment mode (C)', 'aria-label': 'Toggle comment mode', onclick: function () { setMode(!state.mode); } }, ['💬']);
    var badge = h('span', { class: 'badge' }, ['0']);
    var btnPanel = h('button', { type: 'button', title: 'All comments', 'aria-label': 'All comments', onclick: function () { state.panel = !state.panel; renderPanel(); } }, ['☰', badge]);
    var btnPins = h('button', { type: 'button', title: 'Show or hide pins', 'aria-label': 'Show or hide pins', onclick: function () { state.showPins = !state.showPins; savePrefs(); renderFab(); schedule(); } }, ['👁']);
    var fab = h('div', { class: 'fab' }, [btnMode, btnPanel, btnPins]);
    var panelLayer = h('div', { class: 'layer' });
    var toastLayer = h('div', { class: 'layer' });
    layer.appendChild(hl);
    root.appendChild(layer);
    root.appendChild(pinsLayer);
    root.appendChild(banner);
    root.appendChild(popLayer);
    root.appendChild(panelLayer);
    root.appendChild(fab);
    root.appendChild(toastLayer);
    document.body.appendChild(host);

    var cursorStyle = null;

    function savePrefs() { setItem('localStorage', PREFS_KEY, JSON.stringify({ showResolved: state.showResolved, showPins: state.showPins })); }

    function toast(text) {
      clear(toastLayer);
      var t = h('div', { class: 'toast', role: 'status' }, [text]);
      toastLayer.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
    }

    /* ---------- page awareness ---------- */
    function page() {
      var a = window.reviewKitAdapter;
      if (a && typeof a.getPage === 'function') {
        try { var p = a.getPage(); if (p && p.key) return { key: String(p.key), label: String(p.label || p.key), role: String(p.role || '') }; } catch (e) { /* fall through */ }
      }
      return { key: location.pathname, label: document.title || location.pathname, role: '' };
    }
    function goTo(key) {
      var a = window.reviewKitAdapter;
      if (a && typeof a.goTo === 'function') {
        try { return a.goTo(key) !== false; } catch (e) { return false; }
      }
      if (key && key.charAt(0) === '/' && key !== location.pathname) { location.href = key; return true; }
      return key === location.pathname;
    }

    /* ---------- network ---------- */
    function setThreads(list) {
      state.threads = Array.isArray(list) ? list : [];
      renderFab();
      if (state.pendingOpen && byId(state.pendingOpen)) { var id = state.pendingOpen; state.pendingOpen = null; openThread(id, { navigate: true }); }
      else { renderThread(); renderPanel(); }
      schedule();
    }
    function load() {
      if (state.loading) return;
      state.loading = true;
      var url = cfg.endpoint + (cfg.endpoint.indexOf('?') < 0 ? '?' : '&') + 'action=list&project=' + encodeURIComponent(cfg.project);
      fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok) setThreads(res.threads);
      }).catch(function () { /* offline or endpoint down: keep what we have */ }).then(function () { state.loading = false; });
    }
    function post(payload) {
      var body = Object.assign({ project: cfg.project, author: state.name }, payload);
      return fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'Could not save');
          setThreads(res.threads);
          return res;
        });
    }
    function byId(id) { for (var i = 0; i < state.threads.length; i++) if (state.threads[i].id === id) return state.threads[i]; return null; }

    /* ---------- name ---------- */
    function ensureName(then) {
      if (state.name) return then();
      var input = h('input', { type: 'text', maxlength: '60', placeholder: 'e.g. Priya (SEF)', 'aria-label': 'Your name' });
      var save = function () {
        var v = norm(input.value).slice(0, 60);
        if (!v) { input.focus(); return; }
        state.name = v; setItem('localStorage', NAME_KEY, v);
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        then();
      };
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); e.stopPropagation(); });
      var modal = h('div', { class: 'modal' }, [h('div', { class: 'card', role: 'dialog', 'aria-label': 'Your name' }, [
        h('div', { class: 'hd' }, [h('span', { class: 't' }, ['What should we call you?'])]),
        h('div', { class: 'bd' }, [
          h('div', { class: 'muted' }, ['Your name is shown with your comments and saved on this device.']),
          input,
          h('div', { class: 'row', style: 'justify-content:flex-end' }, [
            h('button', { type: 'button', class: 'btn', onclick: function () { modal.parentNode.removeChild(modal); } }, ['Cancel']),
            h('button', { type: 'button', class: 'btn primary', onclick: save }, ['Continue']),
          ]),
        ]),
      ])]);
      root.appendChild(modal);
      setTimeout(function () { input.focus(); }, 0);
    }

    /* ---------- element targeting ---------- */
    function isOwn(node) { return node === host || (node && host.contains && host.contains(node)); }
    function cssPath(el) {
      var parts = [];
      for (var n = el, depth = 0; n && n.nodeType === 1 && n !== document.documentElement && depth < 30; n = n.parentElement, depth++) {
        if (n.id && n !== el) { parts.unshift('#' + CSS.escape(n.id)); break; }
        if (n === document.body) { parts.unshift('body'); break; }
        var tag = n.localName, i = 1;
        for (var s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === tag) i++;
        parts.unshift(tag + ':nth-of-type(' + i + ')');
      }
      return parts.join(' > ');
    }
    function textOf(el) { return norm(el.textContent).slice(0, 80); }
    function isScroller(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      var cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    }
    function scrollerOf(el) { for (var n = el.parentElement; n; n = n.parentElement) if (isScroller(n)) return n; return null; }
    function describe(el, x, y) {
      var anchor = (el.closest && el.closest('[data-review-id]')) || el;
      var r = anchor.getBoundingClientRect();
      var sc = scrollerOf(anchor), fx, fy;
      if (sc) {
        var sr = sc.getBoundingClientRect();
        fx = (x - sr.left + sc.scrollLeft) / Math.max(1, sc.scrollWidth);
        fy = (y - sr.top + sc.scrollTop) / Math.max(1, sc.scrollHeight);
      } else {
        var de = document.documentElement;
        fx = (x + window.scrollX) / Math.max(1, de.scrollWidth);
        fy = (y + window.scrollY) / Math.max(1, de.scrollHeight);
      }
      var t = {
        rid: anchor.getAttribute('data-review-id') || '',
        id: anchor.id || '',
        sel: cssPath(anchor),
        tag: anchor.localName,
        text: textOf(anchor),
        ox: r.width ? (x - r.left) / r.width : 0.5,
        oy: r.height ? (y - r.top) / r.height : 0.5,
        sc: sc ? (sc.id ? '#' + CSS.escape(sc.id) : cssPath(sc)) : '',
        fx: round(fx), fy: round(fy),
      };
      t.ox = round(t.ox); t.oy = round(t.oy);
      var label = t.rid ? '[' + t.rid + ']' : t.tag + (t.id ? '#' + t.id : '');
      var txt = '';
      for (var n = el; n && n !== document.body && !txt; n = n.parentElement) txt = norm(n.textContent).slice(0, 50);
      return { target: t, element: (label + (txt ? ' "' + txt + '"' : '')).slice(0, 300) };
    }
    function round(v) { return Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000; }
    function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
    function findAnchor(t) {
      if (t.rid) { var a = q('[data-review-id="' + CSS.escape(t.rid) + '"]'); if (a) return a; }
      if (t.id) { var b = document.getElementById(t.id); if (b) return b; }
      var weak = null;
      if (t.sel) {
        var c = q(t.sel);
        if (c && !isOwn(c)) { if (!t.text || textOf(c) === t.text) return c; weak = c; }
      }
      if (t.tag && t.text) {
        var all = document.getElementsByTagName(t.tag);
        for (var i = 0; i < all.length; i++) if (!isOwn(all[i]) && textOf(all[i]) === t.text) return all[i];
      }
      return weak;
    }
    function parseTarget(th) {
      if (th._t !== undefined) return th._t;
      try { th._t = JSON.parse(th.target || 'null'); } catch (e) { th._t = null; }
      return th._t;
    }
    var anchorCache = {};
    function anchorFor(th) {
      var c = anchorCache[th.id];
      if (c && c.isConnected) return c;
      var t = parseTarget(th);
      var el = t ? findAnchor(t) : null;
      if (el) anchorCache[th.id] = el; else delete anchorCache[th.id];
      return el;
    }
    // Visible area of an element after clipping by its scrolling / overflow-hidden ancestors.
    function clipRect(el) {
      var r = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        var cs = getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          var b = n.getBoundingClientRect();
          r = { left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) };
        }
      }
      return r;
    }
    function fallbackPoint(t) {
      var sc = t.sc ? q(t.sc) : null;
      if (sc) {
        var sr = sc.getBoundingClientRect();
        return { x: sr.left + t.fx * sc.scrollWidth - sc.scrollLeft, y: sr.top + t.fy * sc.scrollHeight - sc.scrollTop };
      }
      var de = document.documentElement;
      return { x: t.fx * de.scrollWidth - window.scrollX, y: t.fy * de.scrollHeight - window.scrollY };
    }
    function pointFor(th) {
      var t = parseTarget(th);
      if (!t) return null;
      var el = anchorFor(th);
      if (el) {
        var r = el.getBoundingClientRect();
        if (r.width || r.height) {
          var p = { x: r.left + t.ox * r.width, y: r.top + t.oy * r.height, found: true };
          var cr = clipRect(el);
          p.hidden = p.x < cr.left - 1 || p.x > cr.right + 1 || p.y < cr.top - 1 || p.y > cr.bottom + 1;
          return p;
        }
      }
      if (typeof t.fx !== 'number' || typeof t.fy !== 'number') return { found: false, hidden: true, x: 0, y: 0 };
      var f = fallbackPoint(t);
      return { x: f.x, y: f.y, found: false, hidden: false };
    }

    /* ---------- pins ---------- */
    var pinEls = {};
    var raf = 0, rafTimer = 0;
    // requestAnimationFrame, with a timer fallback for when the browser isn't painting frames.
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(runPins);
      rafTimer = setTimeout(runPins, 150);
    }
    function runPins() {
      if (!raf) return;
      cancelAnimationFrame(raf); clearTimeout(rafTimer);
      renderPins();
    }
    function visibleThreads(pg) {
      return state.threads.filter(function (t) { return t.pageKey === pg.key; });
    }
    function renderPins() {
      raf = 0;
      var pg = page();
      var seen = {};
      var lost = {};
      var open = state.openId && byId(state.openId);
      if (open && open.pageKey !== pg.key && !state.openStay) closeThread();
      visibleThreads(pg).forEach(function (th) {
        var p = pointFor(th);
        if (!p) return;
        if (!p.found) lost[th.id] = true;
        var isOpen = th.id === state.openId;
        var show = state.showPins && (th.status !== 'Resolved' || state.showResolved || isOpen);
        if (!p.found && !isOpen) show = false; // grey fallback pin only while its thread is open
        if (p.hidden) show = false;
        if (!show) return;
        seen[th.id] = true;
        var el = pinEls[th.id];
        if (!el) {
          el = h('button', { type: 'button', class: 'pin', onclick: function (e) { e.stopPropagation(); openThread(th.id); } });
          pinsLayer.appendChild(el);
          pinEls[th.id] = el;
        }
        el.textContent = num(th.id);
        el.className = 'pin' + (th.status === 'Resolved' ? ' resolved' : '') + (!p.found ? ' lost' : '') + (isOpen ? ' active' : '');
        el.title = '#' + num(th.id) + ' · ' + th.author + ': ' + th.text.slice(0, 80);
        el.style.left = Math.round(p.x) + 'px';
        el.style.top = Math.round(p.y) + 'px';
        if (isOpen) positionThreadCard(p);
      });
      Object.keys(pinEls).forEach(function (id) { if (!seen[id]) { pinEls[id].parentNode.removeChild(pinEls[id]); delete pinEls[id]; } });
      var lostChanged = JSON.stringify(lost) !== JSON.stringify(state.lost);
      state.lost = lost;
      if (lostChanged && state.panel) renderPanel();
      if (open && !seen[open.id]) positionThreadCard(null);
    }

    /* ---------- comment mode ---------- */
    var hoverEl = null;
    function setMode(on) {
      state.mode = on;
      if (on) {
        if (!cursorStyle) {
          cursorStyle = h('style', null, ['html.rk-commenting, html.rk-commenting * { cursor: crosshair !important; }']);
          document.head.appendChild(cursorStyle);
        }
        document.documentElement.classList.add('rk-commenting');
      } else {
        document.documentElement.classList.remove('rk-commenting');
        hl.style.display = 'none';
        hoverEl = null;
        closeComposer();
      }
      banner.style.display = on ? 'block' : 'none';
      renderFab();
    }
    // Skip the kit itself and overlays injected by browser extensions (custom elements such as <grammarly-popups>).
    function pointTarget(e) {
      var els = document.elementsFromPoint(e.clientX, e.clientY);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (isOwn(el) || el === document.documentElement) continue;
        if (el.localName.indexOf('-') > 0 && !(el.closest && el.closest('#root'))) continue;
        return el;
      }
      return null;
    }
    function fromKit(e) {
      var path = e.composedPath ? e.composedPath() : [];
      return path.indexOf(host) >= 0;
    }
    window.addEventListener('mousemove', function (e) {
      if (!state.mode || composer) return;
      var el = pointTarget(e);
      hoverEl = el;
      if (!el) { hl.style.display = 'none'; return; }
      var r = el.getBoundingClientRect();
      hl.style.display = 'block';
      hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px';
      hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px';
    }, true);
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (!state.mode || fromKit(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (type === 'click' || type === 'contextmenu') {
          var el = pointTarget(e) || (e.target && e.target.nodeType === 1 ? e.target : null);
          if (el) openComposer(el, e.clientX, e.clientY);
        }
      }, true);
    });

    /* ---------- composer ---------- */
    var composer = null;
    function closeComposer() { if (composer) { composer.el.parentNode && composer.el.parentNode.removeChild(composer.el); composer = null; } }
    function openComposer(el, x, y) {
      closeComposer();
      closeThread();
      var desc = describe(el, x, y);
      var pr = 'Medium';
      var text = h('textarea', { maxlength: '2000', placeholder: 'Add a comment…', 'aria-label': 'Comment' });
      var postBtn = h('button', { type: 'button', class: 'btn primary' }, ['Post comment']);
      var card = h('div', { class: 'card sheet', role: 'dialog', 'aria-label': 'New comment' }, [
        h('div', { class: 'bd' }, [
          text,
          h('div', { class: 'row' }, [
            h('span', { class: 'muted' }, ['Priority']),
            h('div', { style: 'width:110px' }, [select(PRIORITIES, pr, function (v) { pr = v; }, 'Priority')]),
            h('span', { style: 'flex:1' }),
            h('button', { type: 'button', class: 'btn', onclick: closeComposer }, ['Cancel']),
            postBtn,
          ]),
        ]),
      ]);
      var submit = function () {
        var v = text.value.trim();
        if (!v) { text.focus(); return; }
        ensureName(function () {
          postBtn.disabled = true;
          var pg = page();
          post({ action: 'comment', text: v.slice(0, 2000), priority: pr, pageKey: pg.key.slice(0, 200), page: pg.label.slice(0, 200),
            role: pg.role.slice(0, 60), element: desc.element, target: JSON.stringify(desc.target).slice(0, 2000), url: location.href.slice(0, 500) })
            .then(function () { closeComposer(); toast('Comment posted'); hl.style.display = 'none'; })
            .catch(function (err) { postBtn.disabled = false; toast(err.message || 'Could not post the comment'); });
        });
      };
      postBtn.addEventListener('click', submit);
      text.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        if (e.key === 'Escape') closeComposer();
      });
      popLayer.appendChild(card);
      place(card, x, y);
      composer = { el: card };
      setTimeout(function () { text.focus(); }, 0);
    }
    function place(card, x, y) {
      var w = card.offsetWidth || 320, hgt = card.offsetHeight || 160;
      var left = x + 14, top = y - 10;
      if (left + w > window.innerWidth - 12) left = Math.max(12, x - w - 14);
      if (top + hgt > window.innerHeight - 12) top = Math.max(12, window.innerHeight - hgt - 12);
      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(Math.max(12, top)) + 'px';
    }

    /* ---------- thread ---------- */
    var threadCard = null;
    function closeThread() {
      state.openId = null; state.openStay = false; state.openMsg = '';
      if (threadCard && threadCard.parentNode) threadCard.parentNode.removeChild(threadCard);
      threadCard = null;
      schedule();
    }
    function openThread(id, opts) {
      opts = opts || {};
      var th = byId(id);
      if (!th) { state.pendingOpen = id; return; }
      closeComposer();
      state.openId = id; state.openStay = false; state.openMsg = '';
      if (th.pageKey !== page().key && opts.navigate !== false) {
        setItem('sessionStorage', OPEN_KEY, id);
        var ok = goTo(th.pageKey);
        if (!ok) {
          removeItem('sessionStorage', OPEN_KEY);
          state.openStay = true;
          state.openMsg = 'This screen can’t be opened directly. Showing the comment here.';
        } else if (th.pageKey === page().key) {
          removeItem('sessionStorage', OPEN_KEY);
        }
      }
      renderThread();
      schedule();
    }
    function chip(text, color) { return h('span', { class: 'chip' }, [color ? h('span', { class: 'dot', style: 'background:' + color }) : null, text]); }
    function renderThread() {
      var th = state.openId && byId(state.openId);
      if (!th) { if (threadCard) closeThread(); return; }
      var reply = h('textarea', { maxlength: '2000', placeholder: 'Reply…', 'aria-label': 'Reply', style: 'min-height:54px' });
      var replyBtn = h('button', { type: 'button', class: 'btn primary' }, ['Reply']);
      var noteBox = h('div', { style: 'display:none', class: 'row' });
      var busy = function (p, btns) {
        btns.forEach(function (b) { b.disabled = true; });
        return p.catch(function (err) { toast(err.message || 'Could not save'); btns.forEach(function (b) { b.disabled = false; }); });
      };
      replyBtn.addEventListener('click', function () {
        var v = reply.value.trim();
        if (!v) { reply.focus(); return; }
        ensureName(function () { busy(post({ action: 'reply', commentId: th.id, text: v.slice(0, 2000) }), [replyBtn]); });
      });
      reply.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) replyBtn.click(); });
      var statusBtns = STATUSES.map(function (s) {
        var b = h('button', { type: 'button', class: 'btn' + (th.status === s ? ' sel' : '') }, [s]);
        b.addEventListener('click', function () {
          if (s === th.status) return;
          if (s === 'Resolved') { showResolveNote(); return; }
          ensureName(function () { busy(post({ action: 'status', commentId: th.id, status: s }), statusBtns); });
        });
        return b;
      });
      function showResolveNote() {
        clear(noteBox);
        var note = h('input', { type: 'text', maxlength: '500', placeholder: 'Resolution note (optional)', 'aria-label': 'Resolution note' });
        var ok = h('button', { type: 'button', class: 'btn primary' }, ['Resolve']);
        ok.addEventListener('click', function () {
          ensureName(function () { busy(post({ action: 'status', commentId: th.id, status: 'Resolved', note: norm(note.value).slice(0, 500) }), [ok]); });
        });
        note.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') ok.click(); });
        noteBox.appendChild(h('div', { style: 'flex:1;min-width:150px' }, [note]));
        noteBox.appendChild(ok);
        noteBox.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { noteBox.style.display = 'none'; } }, ['Cancel']));
        noteBox.style.display = 'flex';
        note.focus();
      }
      var lost = !!state.lost[th.id];
      var card = h('div', { class: 'card sheet', role: 'dialog', 'aria-label': 'Comment #' + num(th.id) }, [
        h('div', { class: 'hd' }, [
          h('span', { class: 'num' + (th.status === 'Resolved' ? ' resolved' : '') }, [num(th.id)]),
          h('span', { class: 't' }, [th.page || th.pageKey]),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: closeThread }, ['×']),
        ]),
        h('div', { class: 'bd' }, [
          state.openMsg ? h('div', { class: 'note' }, [state.openMsg]) : null,
          lost && th.pageKey === page().key ? h('div', { class: 'note' }, ['Not visible now — the pin shows its last known position.']) : null,
          h('div', null, [
            h('div', { class: 'row', style: 'gap:6px;margin-bottom:4px' }, [h('b', null, [th.author]), h('span', { class: 'muted' }, [th.time])]),
            h('div', { class: 'msg' }, [th.text]),
            th.element ? h('div', { class: 'muted', style: 'margin-top:4px' }, ['On: ' + th.element]) : null,
          ]),
          th.replies.length ? h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, th.replies.map(function (r) {
            return h('div', { class: 'reply' }, [
              h('div', { class: 'row', style: 'gap:6px' }, [h('b', null, [r.author]), h('span', { class: 'muted' }, [r.time])]),
              h('div', { class: 'msg' }, [r.text]),
            ]);
          })) : null,
          reply,
          h('div', { class: 'row', style: 'justify-content:flex-end' }, [replyBtn]),
          h('div', { class: 'sec' }, ['Status']),
          h('div', { class: 'row', style: 'gap:6px' }, statusBtns),
          noteBox,
          th.status === 'Resolved' && th.resolutionNote ? h('div', { class: 'note' }, ['Resolution: ' + th.resolutionNote]) : null,
          h('div', { class: 'row' }, [
            h('span', { class: 'sec' }, ['Priority']),
            h('div', { style: 'width:120px' }, [select(PRIORITIES, th.priority, function (v) {
              ensureName(function () { post({ action: 'priority', commentId: th.id, priority: v }).catch(function (err) { toast(err.message); renderThread(); }); });
            }, 'Priority')]),
          ]),
          th.history.length ? h('div', null, [
            h('div', { class: 'sec', style: 'margin-bottom:4px' }, ['History']),
            h('div', { class: 'hist' }, th.history.map(function (x) {
              return h('div', null, [x.time + ' · ' + x.author + ' · ' + (x.type === 'status' ? 'Status' : 'Priority') + ' → ' + x.value + (x.note ? ' (' + x.note + ')' : '')]);
            })),
          ]) : null,
        ]),
      ]);
      card.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeThread(); });
      if (threadCard && threadCard.parentNode) {
        card.style.left = threadCard.style.left; card.style.top = threadCard.style.top;
        threadCard.parentNode.replaceChild(card, threadCard);
      } else popLayer.appendChild(card);
      threadCard = card;
      positionThreadCard(null);
      schedule();
    }
    var lastPinPos = '';
    function positionThreadCard(p) {
      if (!threadCard) return;
      if (p) {
        var key = Math.round(p.x) + ',' + Math.round(p.y);
        if (key === lastPinPos && threadCard.style.left) return;
        lastPinPos = key;
        place(threadCard, p.x + 16, p.y - 20);
      } else if (!threadCard.style.left) {
        threadCard.style.left = Math.max(12, (window.innerWidth - (threadCard.offsetWidth || 320)) / 2) + 'px';
        threadCard.style.top = '80px';
      }
    }

    /* ---------- all comments panel ---------- */
    function uniq(list) { var o = {}, out = []; list.forEach(function (v) { if (v && !o[v]) { o[v] = 1; out.push(v); } }); return out.sort(); }
    function filtered() {
      var f = state.filters, qv = f.q.toLowerCase();
      return state.threads.filter(function (t) {
        if (f.page && t.pageKey !== f.page) return false;
        if (f.author && t.author !== f.author) return false;
        if (f.status && t.status !== f.status) return false;
        if (f.priority && t.priority !== f.priority) return false;
        if (qv) {
          var hay = [t.text, t.author, t.page, t.element].concat(t.replies.map(function (r) { return r.text + ' ' + r.author; })).join(' ').toLowerCase();
          if (hay.indexOf(qv) < 0) return false;
        }
        return true;
      });
    }
    var panelEl = null, panelList = null, panelCount = null, searchBox = null;
    function renderPanel() {
      renderFab();
      if (!state.panel) { if (panelEl) { panelEl.parentNode.removeChild(panelEl); panelEl = null; } return; }
      if (!panelEl) buildPanel();
      fillPanelList();
    }
    function buildPanel() {
      var f = state.filters;
      var pages = {};
      state.threads.forEach(function (t) { pages[t.pageKey] = t.page || t.pageKey; });
      var pageOpts = [{ value: '', label: 'All pages' }].concat(Object.keys(pages).sort().map(function (k) { return { value: k, label: pages[k] }; }));
      var authorOpts = [{ value: '', label: 'All authors' }].concat(uniq(state.threads.map(function (t) { return t.author; })));
      var set = function (k) { return function (v) { f[k] = v; fillPanelList(); }; };
      searchBox = h('input', { type: 'text', placeholder: 'Search comments', 'aria-label': 'Search comments', value: f.q });
      searchBox.addEventListener('input', function () { f.q = searchBox.value; fillPanelList(); });
      searchBox.addEventListener('keydown', function (e) { e.stopPropagation(); });
      panelCount = h('span', { class: 't' }, ['All comments']);
      panelList = h('div', { class: 'list' });
      var who = h('span', { class: 'muted' }, [state.name ? 'Commenting as ' + state.name : 'Name not set yet']);
      var change = h('button', { type: 'button', class: 'btn', style: 'padding:3px 8px;font-size:11.5px' }, ['Change name']);
      change.addEventListener('click', function () { state.name = ''; removeItem('localStorage', NAME_KEY); ensureName(function () { who.textContent = 'Commenting as ' + state.name; }); });
      panelEl = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'All comments' }, [
        h('div', { class: 'hd' }, [panelCount, h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: function () { state.panel = false; renderPanel(); } }, ['×'])]),
        h('div', { class: 'flt' }, [
          h('div', { class: 'wide' }, [searchBox]),
          select(pageOpts, f.page, set('page'), 'Filter by page'),
          select(authorOpts, f.author, set('author'), 'Filter by author'),
          select([{ value: '', label: 'All statuses' }].concat(STATUSES), f.status, set('status'), 'Filter by status'),
          select([{ value: '', label: 'All priorities' }].concat(PRIORITIES), f.priority, set('priority'), 'Filter by priority'),
          h('label', { class: 'chk wide' }, [h('input', { type: 'checkbox', checked: state.showResolved, onchange: function (e) { state.showResolved = e.target.checked; savePrefs(); schedule(); } }), 'Show resolved pins']),
        ]),
        panelList,
        h('div', { class: 'ft' }, [h('div', { class: 'row', style: 'gap:6px' }, [who, change]), h('button', { type: 'button', class: 'btn', onclick: downloadCsv }, ['Download CSV'])]),
      ]);
      panelLayer.appendChild(panelEl);
    }
    function fillPanelList() {
      if (!panelList) return;
      var list = filtered(), pg = page();
      panelCount.textContent = 'All comments (' + list.length + (list.length !== state.threads.length ? ' of ' + state.threads.length : '') + ')';
      clear(panelList);
      if (!list.length) { panelList.appendChild(h('div', { class: 'empty' }, [state.threads.length ? 'No comments match these filters.' : 'No comments yet. Turn on 💬 comment mode and click anything.'])); return; }
      list.slice().reverse().forEach(function (t) {
        var here = t.pageKey === pg.key;
        panelList.appendChild(h('button', { type: 'button', class: 'item', onclick: function () { openThread(t.id, { navigate: true }); } }, [
          h('div', { class: 'top' }, [
            h('span', { class: 'num' + (t.status === 'Resolved' ? ' resolved' : '') }, [num(t.id)]),
            h('b', null, [t.author]),
            h('span', { class: 'muted' }, [t.time]),
          ]),
          h('div', { class: 'txt' }, [t.text]),
          h('div', { class: 'top', style: 'margin:6px 0 0' }, [
            chip(t.status, STATUS_COL[t.status]),
            chip(t.priority + ' priority'),
            t.replies.length ? h('span', { class: 'muted' }, [t.replies.length + (t.replies.length === 1 ? ' reply' : ' replies')]) : null,
            here && state.lost[t.id] ? h('span', { class: 'lostTag' }, ['Not visible now']) : null,
            !here ? h('span', { class: 'muted' }, [t.page || t.pageKey]) : null,
          ]),
        ]));
      });
    }

    /* ---------- CSV (same layout as the sheet's Review tab) ---------- */
    function csvRows() {
      var maxR = 0;
      state.threads.forEach(function (t) { if (t.replies.length > maxR) maxR = t.replies.length; });
      var header = REVIEW_HEADERS.slice();
      for (var i = 1; i <= maxR; i++) header.push('Reply ' + i, 'Reply ' + i + ' by', 'Reply ' + i + ' time');
      return [header].concat(state.threads.map(function (t) {
        var hist = t.history.map(function (x) { return x.time + ' · ' + x.author + ' · ' + (x.type === 'status' ? 'Status' : 'Priority') + ' → ' + x.value + (x.note ? ' (' + x.note + ')' : ''); }).join('\n');
        var link = t.url ? t.url.split('#')[0] + '#review=' + encodeURIComponent(t.id) : '';
        var row = [t.id, t.project, t.page, t.role, t.element, t.text, t.author, t.time, t.priority, t.status, t.resolvedBy, t.resolvedAt, t.resolutionNote, hist, String(t.replies.length), link];
        for (var j = 0; j < maxR; j++) { var r = t.replies[j]; row.push(r ? r.text : '', r ? r.author : '', r ? r.time : ''); }
        return row;
      }));
    }
    function csvCell(v) {
      var s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheets running it as a formula
      return '"' + s.replace(/"/g, '""') + '"';
    }
    function downloadCsv() {
      var csv = '﻿' + csvRows().map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
      var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = 'review-' + cfg.project + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
    window.__reviewKitCsv = function () { return csvRows().map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); };

    /* ---------- fab ---------- */
    function renderFab() {
      btnMode.className = state.mode ? 'on' : '';
      btnMode.setAttribute('aria-pressed', state.mode ? 'true' : 'false');
      btnPanel.className = state.panel ? 'on' : '';
      fab.className = 'fab' + (state.panel ? ' shift' : '');
      btnPins.className = state.showPins ? '' : 'off';
      btnPins.setAttribute('aria-pressed', state.showPins ? 'true' : 'false');
      var open = state.threads.filter(function (t) { return t.status !== 'Resolved'; }).length;
      badge.textContent = String(open);
      badge.style.display = open ? 'grid' : 'none';
    }

    /* ---------- keyboard ---------- */
    function typing(e) {
      var t = (e.composedPath && e.composedPath()[0]) || e.target;
      if (!t || t.nodeType !== 1) return false;
      var tag = t.localName;
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (composer) { closeComposer(); return; }
        if (state.openId) { closeThread(); return; }
        if (state.mode) { setMode(false); return; }
        if (state.panel) { state.panel = false; renderPanel(); }
        return;
      }
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e)) {
        e.preventDefault();
        setMode(!state.mode);
      }
    }, true);

    /* ---------- deep links ---------- */
    function checkHash() {
      var m = /^#review=(.+)$/.exec(location.hash);
      if (!m) return;
      var id = decodeURIComponent(m[1]);
      if (byId(id)) openThread(id, { navigate: true }); else state.pendingOpen = id;
    }
    window.addEventListener('hashchange', function () { checkHash(); schedule(); });

    /* ---------- keep pins attached ---------- */
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.body);
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) if (!isOwn(records[i].target)) { schedule(); return; }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });

    /* ---------- polling ---------- */
    setInterval(load, 20000);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });

    renderFab();
    checkHash();
    load();
  }

  function hideNetlifyToolbar() {
    try { sessionStorage.setItem('ntl-drawer-initial-state', 'hidden'); } catch (e) { /* ignore */ }
    var zap = function () { var el = document.querySelector('body div[data-netlify-site-id]'); if (el) el.parentNode.removeChild(el); };
    zap();
    var mo = new MutationObserver(zap);
    mo.observe(document.body, { childList: true });
    setTimeout(function () { mo.disconnect(); }, 30000);
  }

  /* ---------------------------------------------------------- auto start */

  function auto() {
    if (currentScript && currentScript.hasAttribute('data-manual')) return;
    window.initReviewKit();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
