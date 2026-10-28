/* API クライアント。apiUrl 未設定ならブラウザ内保存のデモモードで動く */
var Api = (function () {
  var cfg = window.APP_CONFIG || {};
  var url = (cfg.apiUrl || '').trim();
  var demo = !url;

  var LS_KEY = 'pittan.demo.db';
  function readDb() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || { events: {}, answers: {} };
    } catch (e) {
      return { events: {}, answers: {} };
    }
  }
  function writeDb(db) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
  }
  var localStore = {
    getEvent: function (id) { var e = readDb().events[id]; return e ? JSON.parse(JSON.stringify(e)) : null; },
    putEvent: function (id, adminToken, data) { var db = readDb(); db.events[id] = { adminToken: adminToken, data: data }; writeDb(db); },
    deleteEvent: function (id) { var db = readDb(); delete db.events[id]; delete db.answers[id]; writeDb(db); },
    listAnswers: function (eid) { var m = readDb().answers[eid] || {}; return Object.keys(m).map(function (k) { return m[k]; }); },
    putAnswer: function (eid, aid, data) { var db = readDb(); (db.answers[eid] = db.answers[eid] || {})[aid] = data; writeDb(db); },
    deleteAnswer: function (eid, aid) { var db = readDb(); if (db.answers[eid]) delete db.answers[eid][aid]; writeDb(db); },
  };
  var localRouter = PittanCore.createRouter(localStore);

  function call(action, params) {
    var body = Object.assign({ action: action }, params || {});
    if (demo) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try { resolve(localRouter.handle(JSON.parse(JSON.stringify(body)))); } catch (e) { reject(e); }
        }, 150);
      });
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    })
      .then(function (res) {
        if (!res.ok) throw new Error('通信エラー（' + res.status + '）');
        return res.json();
      }, function () {
        throw new Error('サーバーに接続できませんでした。通信環境を確認してください');
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'エラーが発生しました');
        return j.data;
      });
  }

  return { call: call, isDemo: demo };
})();
