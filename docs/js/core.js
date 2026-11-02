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

  // エンドツーエンド暗号化（e1）：ブラウザで AES-GCM 暗号化した中身を不透明な文字列（ct）として保存するだけ。
  // サーバーは鍵を持たず、ct の中身は解釈しない。平文で持つのは id・adminToken・日時・v・deleteAfter のみ。
  var ENC_V = 'e1';
  var CT_RE = /^[A-Za-z0-9_-]+$/;
  var CT_MIN = 38; // IV 12バイト + 認証タグ 16バイト の base64url 長
  var CT_MAX = { event: 120000, answer: 30000 };

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

  // 時間指定のある候補は 30分マス単位で回答する。1日 = 48マス。
  // votes = { 'YYYY-MM-DD': '48文字（3=◎ 2=○ 1=△ 0=× -=未回答）', '<時間なし候補ID>': 0〜3 }
  function toIdx(t) { return +t.slice(0, 2) * 2 + Math.floor(+t.slice(3, 5) / 30); }
  function toEndIdx(t) { var m = +t.slice(0, 2) * 60 + +t.slice(3, 5); return Math.ceil(m / 30); }
  function cellMasks(candidates) {
    var masks = {};
    candidates.forEach(function (c) {
      if (!c.date || !c.start) return;
      var m = masks[c.date] || (masks[c.date] = []);
      var a = toIdx(c.start), b = c.end ? toEndIdx(c.end) : a + 1;
      for (var i = a; i < Math.min(b, 48); i++) m[i] = true;
    });
    return masks;
  }

  function sanitizeVotes(votes, candidates) {
    var out = {};
    votes = votes || {};
    var masks = cellMasks(candidates);
    Object.keys(masks).forEach(function (date) {
      var v = votes[date];
      if (typeof v !== 'string') return;
      var s = '', any = false;
      for (var i = 0; i < 48; i++) {
        var ch = v.charAt(i);
        if (masks[date][i] && '0123'.indexOf(ch) >= 0 && ch !== '') { s += ch; any = true; } else s += '-';
      }
      if (any) out[date] = s;
    });
    candidates.forEach(function (c) {
      if (c.date && c.start) return;
      var v = votes[c.id];
      if (v === 0 || v === 1 || v === 2 || v === 3) out[c.id] = v;
    });
    return out;
  }

  function sanitizeConfirmed(x, candidates) {
    if (!x) return null;
    var date = DATE_RE.test(x.date) ? x.date : '';
    var label = str(x.label, LIMITS.label);
    if (date) {
      if (!candidates.some(function (c) { return c.date === date; })) fail('候補にない日付です');
      var start = TIME_RE.test(x.start) ? x.start : '';
      var end = start && TIME_RE.test(x.end) && x.end > start ? x.end : '';
      return { date: date, start: start, end: end, label: '' };
    }
    if (label && candidates.some(function (c) { return !c.date && c.label === label; })) return { date: '', start: '', end: '', label: label };
    fail('決定する日程が正しくありません');
  }

  function isEnc(data) { return !!data && data.v === ENC_V; }

  function sanitizeBlob(b, kind) {
    if (!b || typeof b !== 'object' || b.v !== ENC_V) fail('データの形式が正しくありません。ページを再読み込みしてください');
    var ct = b.ct;
    if (typeof ct !== 'string' || ct.length < CT_MIN || !CT_RE.test(ct)) fail('データの形式が正しくありません。ページを再読み込みしてください');
    if (ct.length > CT_MAX[kind]) fail('データが大きすぎます。内容を減らしてください');
    var out = { v: ENC_V, ct: ct };
    if (kind === 'event') out.deleteAfter = DATE_RE.test(b.deleteAfter) ? b.deleteAfter : '';
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
        var id;
        if (p.blob !== undefined) {
          var enc = sanitizeBlob(p.blob, 'event');
          do { id = randomId(10); } while (store.getEvent(id));
          var tk = randomId(24);
          enc.createdAt = now();
          enc.updatedAt = enc.createdAt;
          store.putEvent(id, tk, enc);
          return { id: id, adminToken: tk, event: publicEvent(id, enc) };
        }
        var ev = sanitizeEvent(p.event);
        do { id = randomId(10); } while (store.getEvent(id));
        var token = randomId(24);
        ev.confirmed = null;
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
        var res = { event: publicEvent(p.id, rec.data), answers: answers, apiVersion: 3 };
        if (p.adminToken) res.isAdmin = p.adminToken === rec.adminToken;
        return res;
      },

      update: function (p) {
        var rec = loadAdmin(p);
        if (isEnc(rec.data)) {
          var enc = sanitizeBlob(p.blob, 'event');
          rec.data.ct = enc.ct;
          rec.data.deleteAfter = enc.deleteAfter;
          save(p.id, rec);
          return { event: publicEvent(p.id, rec.data) };
        }
        if (p.blob !== undefined) fail('この日程調整は暗号化されていない形式です。ページを再読み込みしてください');
        var ev = sanitizeEvent(p.event, rec.data);
        rec.data.title = ev.title;
        rec.data.memo = ev.memo;
        rec.data.candidates = ev.candidates;
        rec.data.deadline = ev.deadline;
        try { rec.data.confirmed = sanitizeConfirmed(rec.data.confirmed, ev.candidates); } catch (e) { rec.data.confirmed = null; }
        delete rec.data.confirmedId;
        save(p.id, rec);
        return { event: publicEvent(p.id, rec.data) };
      },

      confirm: function (p) {
        var rec = loadAdmin(p);
        if (isEnc(rec.data)) fail('ページを再読み込みしてから操作してください');
        rec.data.confirmed = sanitizeConfirmed(p.confirmed, rec.data.candidates);
        delete rec.data.confirmedId;
        save(p.id, rec);
        return { event: publicEvent(p.id, rec.data) };
      },

      setClosed: function (p) {
        var rec = loadAdmin(p);
        if (isEnc(rec.data)) fail('ページを再読み込みしてから操作してください');
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
        if (isEnc(rec.data)) return answerEnc(p);
        if (p.blob !== undefined) fail('この日程調整は暗号化されていない形式です。ページを再読み込みしてください');
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

    // 暗号化イベントへの回答：受付終了・名前・票の検証は鍵を持つブラウザ側で行う
    function answerEnc(p) {
      if (p.blob === undefined) fail('ページを再読み込みしてから回答してください');
      var enc = sanitizeBlob(p.blob, 'answer');
      if (typeof p.answerId !== 'string' || !ID_RE.test(p.answerId)) fail('回答IDが正しくありません');
      var answers = store.listAnswers(p.id);
      var existing = null;
      for (var i = 0; i < answers.length; i++) if (answers[i].id === p.answerId) existing = answers[i];
      if (!existing && answers.length >= LIMITS.answers) fail('回答数が上限に達しています');
      var t = now();
      var data = { v: ENC_V, id: p.answerId, ct: enc.ct, createdAt: existing ? existing.createdAt : t, updatedAt: t };
      store.putAnswer(p.id, data.id, data);
      return { answer: data };
    }

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

  return {
    createRouter: createRouter, randomId: randomId, cellMasks: cellMasks, toIdx: toIdx, toEndIdx: toEndIdx, LIMITS: LIMITS,
    // 暗号化イベントではブラウザ側で同じ検証を行うために公開する
    ENC_V: ENC_V, ID_RE: ID_RE, DATE_RE: DATE_RE, str: str,
    sanitizeEvent: sanitizeEvent, sanitizeVotes: sanitizeVotes, sanitizeConfirmed: sanitizeConfirmed,
  };
})();
