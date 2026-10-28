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
    return ContentService.createTextOutput(JSON.stringify({ ok: true, data: { service: 'pittan', version: 2 } }))
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
