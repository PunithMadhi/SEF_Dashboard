// Minimal stand-ins for the Apps Script services Code.gs uses, backed by a plain JSON state object.
// Loaded by run-code-gs.js inside macOS JavaScriptCore (jsc); see mock_server.py.

var __state; // { sheets: { name: [[cell, ...], ...] }, cache: { key: value } }

function __sheet(name) {
  var rows = __state.sheets[name];
  return {
    getLastRow: function () {
      var n = rows.length;
      while (n > 0 && rows[n - 1].every(function (c) { return c === ''; })) n--;
      return n;
    },
    getRange: function (row, col, numRows, numCols) {
      return {
        setNumberFormat: function () { return this; },
        getValues: function () {
          var out = [];
          for (var r = 0; r < numRows; r++) {
            var src = rows[row - 1 + r] || [], line = [];
            for (var c = 0; c < numCols; c++) line.push(src[col - 1 + c] == null ? '' : src[col - 1 + c]);
            out.push(line);
          }
          return out;
        },
        setValues: function (values) {
          if (values.length !== numRows || values.some(function (v) { return v.length !== numCols; })) throw new Error('Range size mismatch');
          for (var r = 0; r < numRows; r++) {
            while (rows.length < row + r) rows.push([]);
            for (var c = 0; c < numCols; c++) {
              var v = String(values[r][c]);
              // Google Sheets treats a leading apostrophe as "store as text" and does not keep it.
              if (v.charAt(0) === "'") v = v.slice(1);
              else if (/^[=+\-@]/.test(v)) throw new Error('Unescaped formula-like value written: ' + v);
              rows[row - 1 + r][col - 1 + c] = v;
            }
          }
          return this;
        },
      };
    },
    clearContents: function () { rows.length = 0; return this; },
    setFrozenRows: function () { return this; },
  };
}

var SpreadsheetApp = {
  getActiveSpreadsheet: function () {
    return {
      getSheetByName: function (name) { return __state.sheets[name] ? __sheet(name) : null; },
      insertSheet: function (name) { __state.sheets[name] = []; return __sheet(name); },
    };
  },
};

var LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };

var CacheService = {
  getScriptCache: function () {
    return {
      get: function (k) { return __state.cache[k] == null ? null : __state.cache[k]; },
      put: function (k, v) { __state.cache[k] = String(v); },
    };
  },
};

var Session = { getScriptTimeZone: function () { return 'Asia/Kolkata'; } };

var Utilities = {
  formatDate: function (d) {
    var t = new Date(d.getTime() + 330 * 60000), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' +
      p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
  },
};

var ContentService = {
  MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
  createTextOutput: function (s) {
    return { content: s, mime: 'text/plain', setMimeType: function (m) { this.mime = m; return this; } };
  },
};
