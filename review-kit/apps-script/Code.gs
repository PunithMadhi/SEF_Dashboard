/**
 * Wireframe review kit — Google Apps Script backend.
 *
 * Bind this script to a Google Sheet (Extensions → Apps Script), then deploy it
 * as a web app (Execute as: Me, Who has access: Anyone). See review-kit/README.md.
 *
 * GET  ?action=list&project=X  → { ok: true, threads }
 * GET  (no action)             → "Review kit endpoint is running."
 * POST text/plain JSON body     → { ok: true, threads } after applying the action
 *      actions: comment | reply | status | priority
 */

var LOG_SHEET = 'Log';
var REVIEW_SHEET = 'Review';
var LOG_HEADERS = ['Event ID', 'Comment ID', 'Type', 'Time', 'Author', 'Text', 'Status', 'Priority',
  'Project', 'Page key', 'Page', 'Role', 'Element', 'Target', 'Prototype URL'];
var REVIEW_HEADERS = ['Comment ID', 'Project', 'Page', 'Role', 'Element', 'Comment', 'Author', 'Time',
  'Priority', 'Status', 'Resolved by', 'Resolved at', 'Resolution note', 'Status history', 'Replies',
  'Open in prototype'];

var ACTIONS = ['comment', 'reply', 'status', 'priority'];
var STATUSES = ['Open', 'In progress', 'Resolved'];
var PRIORITIES = ['Low', 'Medium', 'High'];
var MAX = { project: 60, author: 60, text: 2000, note: 500, pageKey: 200, page: 200, role: 60,
  element: 300, target: 2000, url: 500, commentId: 80 };
var WRITES_PER_MINUTE = 120;

/* ---------- entry points ---------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'list') return ContentService.createTextOutput('Review kit endpoint is running.');
  try {
    var project = clean_(p.project, 'project', true);
    return json_({ ok: true, threads: threadsFor_(readLog_(), project) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (ACTIONS.indexOf(body.action) < 0) throw new Error('Unknown action');
    lock.waitLock(10000);
    rateLimit_();
    var rows = readLog_();
    var project = clean_(body.project, 'project', true);
    var author = clean_(body.author, 'author', true);
    var now = now_();
    var row;
    if (body.action === 'comment') {
      var text = clean_(body.text, 'text', true);
      var priority = oneOf_(body.priority || 'Medium', PRIORITIES, 'priority');
      row = [eventId_(rows), nextCommentId_(rows, project), 'comment', now, author, text, 'Open', priority,
        project, clean_(body.pageKey, 'pageKey'), clean_(body.page, 'page'), clean_(body.role, 'role'),
        clean_(body.element, 'element'), clean_(body.target, 'target'), clean_(body.url, 'url')];
    } else {
      var id = clean_(body.commentId, 'commentId', true);
      var base = findComment_(rows, project, id);
      if (!base) throw new Error('Comment not found');
      var t = '', st = '', pr = '';
      if (body.action === 'reply') t = clean_(body.text, 'text', true);
      if (body.action === 'status') { st = oneOf_(body.status, STATUSES, 'status'); t = clean_(body.note, 'note'); }
      if (body.action === 'priority') pr = oneOf_(body.priority, PRIORITIES, 'priority');
      row = [eventId_(rows), id, body.action, now, author, t, st, pr, project,
        base[9], base[10], base[11], base[12], '', base[14]];
    }
    appendLog_(row);
    rows.push(row);
    rebuildReview_(rows);
    return json_({ ok: true, threads: threadsFor_(rows, project) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/* ---------- validation ---------- */

function clean_(v, field, required) {
  var s = v == null ? '' : String(v).trim();
  if (required && !s) throw new Error('Missing ' + field);
  if (s.length > MAX[field]) throw new Error(field + ' is too long (max ' + MAX[field] + ')');
  return s;
}

function oneOf_(v, list, field) {
  if (list.indexOf(v) < 0) throw new Error('Invalid ' + field);
  return v;
}

function rateLimit_() {
  var cache = CacheService.getScriptCache();
  var key = 'rk-writes-' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  if (n > WRITES_PER_MINUTE) throw new Error('Too many comments right now. Try again in a minute.');
  cache.put(key, String(n), 120);
}

/* ---------- sheet access ---------- */

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    writeText_(sh, 1, [headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Every cell is written as plain text; a leading apostrophe stops Sheets reading = + - @ as a formula.
function safe_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function writeText_(sh, startRow, values) {
  if (!values.length) return;
  var range = sh.getRange(startRow, 1, values.length, values[0].length);
  range.setNumberFormat('@');
  range.setValues(values.map(function (r) { return r.map(safe_); }));
}

function readLog_() {
  var sh = sheet_(LOG_SHEET, LOG_HEADERS);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, LOG_HEADERS.length).getValues().map(function (r) {
    return r.map(function (c) { return c == null ? '' : String(c); });
  });
}

function appendLog_(row) {
  var sh = sheet_(LOG_SHEET, LOG_HEADERS);
  writeText_(sh, sh.getLastRow() + 1, [row]);
}

/* ---------- ids and time ---------- */

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function eventId_(rows) { return 'E' + (rows.length + 1); }

function nextCommentId_(rows, project) {
  var max = 0, prefix = project + '-';
  rows.forEach(function (r) {
    if (r[2] === 'comment' && r[8] === project && r[1].indexOf(prefix) === 0) {
      var n = Number(r[1].slice(prefix.length));
      if (n > max) max = n;
    }
  });
  return prefix + (max + 1);
}

function findComment_(rows, project, id) {
  for (var i = 0; i < rows.length; i++) if (rows[i][2] === 'comment' && rows[i][8] === project && rows[i][1] === id) return rows[i];
  return null;
}

/* ---------- threads (Log → one object per comment) ---------- */

function buildThreads_(rows) {
  var byId = {}, order = [];
  rows.forEach(function (r) {
    var key = r[8] + '\u0000' + r[1];
    if (r[2] === 'comment') {
      byId[key] = { id: r[1], project: r[8], pageKey: r[9], page: r[10], role: r[11], element: r[12],
        target: r[13], url: r[14], author: r[4], time: r[3], text: r[5], status: r[6] || 'Open',
        priority: r[7] || 'Medium', resolvedBy: '', resolvedAt: '', resolutionNote: '', replies: [], history: [] };
      order.push(key);
      return;
    }
    var t = byId[key];
    if (!t) return;
    if (r[2] === 'reply') t.replies.push({ author: r[4], time: r[3], text: r[5] });
    if (r[2] === 'status') {
      t.status = r[6];
      t.history.push({ type: 'status', value: r[6], author: r[4], time: r[3], note: r[5] });
      if (r[6] === 'Resolved') { t.resolvedBy = r[4]; t.resolvedAt = r[3]; t.resolutionNote = r[5]; }
      else { t.resolvedBy = ''; t.resolvedAt = ''; t.resolutionNote = ''; }
    }
    if (r[2] === 'priority') {
      t.priority = r[7];
      t.history.push({ type: 'priority', value: r[7], author: r[4], time: r[3], note: '' });
    }
  });
  return order.map(function (k) { return byId[k]; });
}

function threadsFor_(rows, project) {
  return buildThreads_(rows).filter(function (t) { return t.project === project; });
}

/* ---------- Review tab (rebuilt from Log after every change) ---------- */

function historyText_(t) {
  return t.history.map(function (h) {
    return h.time + ' · ' + h.author + ' · ' + (h.type === 'status' ? 'Status' : 'Priority') + ' → ' + h.value +
      (h.note ? ' (' + h.note + ')' : '');
  }).join('\n');
}

function reviewLink_(t) {
  return t.url ? t.url.split('#')[0] + '#review=' + encodeURIComponent(t.id) : '';
}

function reviewRows_(threads) {
  var maxReplies = 0;
  threads.forEach(function (t) { if (t.replies.length > maxReplies) maxReplies = t.replies.length; });
  var header = REVIEW_HEADERS.slice();
  for (var i = 1; i <= maxReplies; i++) header.push('Reply ' + i, 'Reply ' + i + ' by', 'Reply ' + i + ' time');
  var rows = threads.map(function (t) {
    var row = [t.id, t.project, t.page, t.role, t.element, t.text, t.author, t.time, t.priority, t.status,
      t.resolvedBy, t.resolvedAt, t.resolutionNote, historyText_(t), String(t.replies.length), reviewLink_(t)];
    for (var j = 0; j < maxReplies; j++) {
      var r = t.replies[j];
      row.push(r ? r.text : '', r ? r.author : '', r ? r.time : '');
    }
    return row;
  });
  return [header].concat(rows);
}

function rebuildReview_(logRows) {
  var sh = sheet_(REVIEW_SHEET, REVIEW_HEADERS);
  sh.clearContents();
  writeText_(sh, 1, reviewRows_(buildThreads_(logRows)));
  sh.setFrozenRows(1);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
