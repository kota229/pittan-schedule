// このファイルは自動生成です（node tools/build-gas.js）。Apps Script エディタにこの内容をすべて貼り付けてください。

/*
 * 日程調整のサーバーロジック（共通コア）
 * ブラウザ（デモモード）と Google Apps Script の両方で同じコードを使う。
 * gas/Code.gs は tools/build-gas.js でこのファイルから生成される。
 */
var PittanCore = (function () {
  var LIMITS = {
    title: 100,
    memo: 2000,
    candidates: 100,
    label: 60,
    name: 40,
    comment: 500,
    answers: 300,
  };
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^\d{2}:\d{2}$/;
  var CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

  function randomId(len) {
    var s = '';
    for (var i = 0; i < len; i++) s += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
    return s;
  }

  function fail(msg) {
    throw new Error(msg);
  }

  function str(v, max) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/\r\n?/g, '\n').trim().slice(0, max);
  }

  function sanitizeCandidates(list, prev) {
    if (!Array.isArray(list)) fail('候補日程の形式が正しくありません');
    if (list.length === 0) fail('候補日程を1つ以上入れてください');
    if (list.length > LIMITS.candidates) fail('候補日程は' + LIMITS.candidates + '件までです');
    var used = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var date = DATE_RE.test(c.date) ? c.date : '';
      var start = date && TIME_RE.test(c.start) ? c.start : '';
      var end = start && TIME_RE.test(c.end) && c.end > start ? c.end : '';
      var label = str(c.label, LIMITS.label);
      if (!date && !label) continue;
      var id = typeof c.id === 'string' && ID_RE.test(c.id) && !used[c.id] ? c.id : '';
      while (!id || used[id]) id = 'c' + randomId(6);
      used[id] = true;
      out.push({ id: id, date: date, start: start, end: end, label: label });
    }
    if (out.length === 0) fail('候補日程を1つ以上入れてください');
    return out;
  }

  function sanitizeEvent(input, prev) {
    input = input || {};
    var title = str(input.title, LIMITS.title);
    if (!title) fail('イベント名を入力してください');
    var deadline = DATE_RE.test(input.deadline) ? input.deadline : '';
    return {
      title: title,
      memo: str(input.memo, LIMITS.memo),
      candidates: sanitizeCandidates(input.candidates, prev),
      deadline: deadline,
    };
  }

  function sanitizeVotes(votes, candidates) {
    var out = {};
    votes = votes || {};
    for (var i = 0; i < candidates.length; i++) {
      var v = votes[candidates[i].id];
      if (v === 0 || v === 1 || v === 2) out[candidates[i].id] = v;
    }
    return out;
  }

  function publicEvent(id, data) {
    var e = JSON.parse(JSON.stringify(data));
    e.id = id;
    return e;
  }

  /**
   * store: {
   *   getEvent(id) -> {adminToken, data} | null
   *   putEvent(id, adminToken, data)
   *   deleteEvent(id)            // 回答も含めて削除
   *   listAnswers(eventId) -> [data]
   *   putAnswer(eventId, answerId, data)
   *   deleteAnswer(eventId, answerId)
   * }
   */
  function createRouter(store, now) {
    now = now || function () { return new Date().toISOString(); };

    function load(id) {
      if (typeof id !== 'string' || !ID_RE.test(id)) fail('URLが正しくありません');
      var rec = store.getEvent(id);
      if (!rec) fail('この日程調整は見つかりません（削除された可能性があります）');
      return rec;
    }

    function loadAdmin(p) {
      var rec = load(p.id);
      if (!p.adminToken || p.adminToken !== rec.adminToken) fail('管理用URLが正しくありません');
      return rec;
    }

    function save(id, rec) {
      rec.data.updatedAt = now();
      store.putEvent(id, rec.adminToken, rec.data);
    }

    var actions = {
      create: function (p) {
        var ev = sanitizeEvent(p.event);
        var id;
        do { id = randomId(10); } while (store.getEvent(id));
        var token = randomId(24);
        ev.confirmedId = '';
        ev.closed = false;
        ev.createdAt = now();
        ev.updatedAt = ev.createdAt;
        store.putEvent(id, token, ev);
        return { id: id, adminToken: token, event: publicEvent(id, ev) };
      },

      get: function (p) {
        var rec = load(p.id);
        var answers = store.listAnswers(p.id).sort(function (a, b) {
          return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
        });
        var res = { event: publicEvent(p.id, rec.data), answers: answers };
        if (p.adminToken) res.isAdmin = p.adminToken === rec.adminToken;
        return res;
      },

      update: function (p) {
        var rec = loadAdmin(p);
        var ev = sanitizeEvent(p.event, rec.data);
        rec.data.title = ev.title;
        rec.data.memo = ev.memo;
        rec.data.candidates = ev.candidates;
        rec.data.deadline = ev.deadline;
        var exists = ev.candidates.some(function (c) { return c.id === rec.data.confirmedId; });
        if (!exists) rec.data.confirmedId = '';
        save(p.id, rec);
        return { event: publicEvent(p.id, rec.data) };
      },

      confirm: function (p) {
        var rec = loadAdmin(p);
        var cid = p.candidateId || '';
        if (cid && !rec.data.candidates.some(function (c) { return c.id === cid; })) fail('候補が見つかりません');
        rec.data.confirmedId = cid;
        save(p.id, rec);
        return { event: publicEvent(p.id, rec.data) };
      },

      setClosed: function (p) {
        var rec = loadAdmin(p);
        rec.data.closed = !!p.closed;
        save(p.id, rec);
        return { event: publicEvent(p.id, rec.data) };
      },

      remove: function (p) {
        loadAdmin(p);
        store.deleteEvent(p.id);
        return { removed: true };
      },

      answer: function (p) {
        var rec = load(p.id);
        var isAdmin = !!p.adminToken && p.adminToken === rec.adminToken;
        if (rec.data.closed && !isAdmin) fail('この日程調整は回答の受付を終了しています');
        var a = p.answer || {};
        var name = str(a.name, LIMITS.name);
        if (!name) fail('お名前を入力してください');
        var answers = store.listAnswers(p.id);
        var existing = null;
        if (a.id) {
          for (var i = 0; i < answers.length; i++) if (answers[i].id === a.id) existing = answers[i];
          if (!existing) fail('編集しようとした回答が見つかりません。再読み込みしてください');
        } else if (answers.length >= LIMITS.answers) {
          fail('回答数が上限に達しています');
        }
        var t = now();
        var data = {
          id: existing ? existing.id : 'a' + randomId(10),
          name: name,
          comment: str(a.comment, LIMITS.comment),
          votes: sanitizeVotes(a.votes, rec.data.candidates),
          createdAt: existing ? existing.createdAt : t,
          updatedAt: t,
        };
        store.putAnswer(p.id, data.id, data);
        return { answer: data };
      },

      deleteAnswer: function (p) {
        var rec = load(p.id);
        var isAdmin = !!p.adminToken && p.adminToken === rec.adminToken;
        if (rec.data.closed && !isAdmin) fail('この日程調整は回答の受付を終了しています');
        if (typeof p.answerId !== 'string' || !ID_RE.test(p.answerId)) fail('回答IDが正しくありません');
        store.deleteAnswer(p.id, p.answerId);
        return { removed: true };
      },
    };

    var readOnly = { get: true };

    return {
      isWrite: function (action) { return !readOnly[action]; },
      handle: function (p) {
        p = p || {};
        var fn = actions[p.action];
        if (!fn) fail('不明な操作です: ' + p.action);
        return fn(p);
      },
    };
  }

  return { createRouter: createRouter, randomId: randomId, LIMITS: LIMITS };
})();

/* ===== Google Apps Script 側（スプレッドシート保存＋Web API） ===== */

var SHEET_NAME_EVENTS = 'events';
var SHEET_NAME_ANSWERS = 'answers';

/** 最初に一度だけエディタから実行して、権限の承認とデータ用シートの作成を行う */
function setup() {
  var ss = getSpreadsheet_();
  gasStore_();
  Logger.log('データ保存先: ' + ss.getUrl());
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.action) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, data: { service: 'pittan', version: 1 } }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return respond_(p);
}

function doPost(e) {
  var p = {};
  try {
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    p = {};
  }
  return respond_(p);
}

function respond_(p) {
  var out;
  var lock = null;
  try {
    var router = PittanCore.createRouter(gasStore_());
    if (router.isWrite(p.action)) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    out = { ok: true, data: router.handle(p) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (lock) {
      SpreadsheetApp.flush();
      lock.releaseLock();
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  var active = null;
  try {
    active = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    active = null;
  }
  if (active) return active;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      /* 削除されていたら作り直す */
    }
  }
  var ss = SpreadsheetApp.create('日程調整データ（ぴったん）');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function sheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.getRange('A:Z').setNumberFormat('@');
    sh.setFrozenRows(1);
    var first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
    if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  }
  return sh;
}

function findRows_(sh, col, value) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh
    .getRange(2, col, last - 1, 1)
    .createTextFinder(value)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll()
    .map(function (r) { return r.getRow(); });
}

function gasStore_() {
  var ss = getSpreadsheet_();
  var ev = sheet_(ss, SHEET_NAME_EVENTS, ['id', 'adminToken', 'data', 'createdAt', 'updatedAt']);
  var an = sheet_(ss, SHEET_NAME_ANSWERS, ['eventId', 'answerId', 'data', 'createdAt', 'updatedAt']);

  function deleteRows(sh, rows) {
    rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  }

  return {
    getEvent: function (id) {
      var rows = findRows_(ev, 1, id);
      if (!rows.length) return null;
      var v = ev.getRange(rows[0], 1, 1, 3).getValues()[0];
      return { adminToken: String(v[1]), data: JSON.parse(v[2]) };
    },
    putEvent: function (id, adminToken, data) {
      var row = [id, adminToken, JSON.stringify(data), data.createdAt || '', data.updatedAt || ''];
      var rows = findRows_(ev, 1, id);
      if (rows.length) ev.getRange(rows[0], 1, 1, row.length).setValues([row]);
      else ev.appendRow(row);
    },
    deleteEvent: function (id) {
      deleteRows(an, findRows_(an, 1, id));
      deleteRows(ev, findRows_(ev, 1, id));
    },
    listAnswers: function (eventId) {
      var rows = findRows_(an, 1, eventId);
      return rows.map(function (r) { return JSON.parse(an.getRange(r, 3).getValue()); });
    },
    putAnswer: function (eventId, answerId, data) {
      var row = [eventId, answerId, JSON.stringify(data), data.createdAt || '', data.updatedAt || ''];
      var rows = findRows_(an, 2, answerId).filter(function (r) { return an.getRange(r, 1).getValue() === eventId; });
      if (rows.length) an.getRange(rows[0], 1, 1, row.length).setValues([row]);
      else an.appendRow(row);
    },
    deleteAnswer: function (eventId, answerId) {
      deleteRows(an, findRows_(an, 2, answerId).filter(function (r) { return an.getRange(r, 1).getValue() === eventId; }));
    },
  };
}
