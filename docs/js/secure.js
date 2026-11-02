/*
 * エンドツーエンド暗号化（e1）とデータ操作の窓口
 *
 * - 鍵：日程調整ごとに生成する AES-GCM 128bit 鍵。base64url（22文字）で URL のハッシュ（#/e/<id>.<鍵>）にだけ置く。
 *   ハッシュは HTTP リクエストに含まれないため、鍵がサーバー（GAS・スプレッドシート）に届くことはない。
 * - 暗号文：ct = base64url( IV(12バイト・毎回ランダム) || AES-GCM 暗号文 || 認証タグ(16バイト) )
 *   AAD（追加認証データ）で「イベント本体か、どの回答IDの回答か」を束縛し、暗号文の差し替えを検出する。
 * - サーバーには { v:'e1', ct, deleteAfter } だけを送る。中身の検証（必須項目・候補日・票・受付終了）は
 *   ブラウザ側で PittanCore の同じ関数を使って行う。
 * - v を持たない data は従来の平文データとして扱い、従来の API でそのまま読み書きする（後方互換）。
 *
 * 注意：鍵や復号結果を console・エラーメッセージ・サーバー送信データに含めないこと。
 */
var PittanSecure = (function () {
  'use strict';

  var V = 'e1';
  var KEY_BYTES = 16;
  var IV_BYTES = 12;
  var KEY_RE = /^[A-Za-z0-9_-]{22}$/;
  var URL_ERROR = 'URLが不完全か、正しくありません。共有されたURLを最初から最後までコピーして開いてください。';
  var AAD_EVENT = 'pittan/e1/event';
  function aadAnswer(answerId) { return 'pittan/e1/answer/' + answerId; }

  function cryptoObj() {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    if (!c || !c.subtle || !c.getRandomValues) throw new Error('このブラウザは暗号化に対応していません。最新のブラウザでお試しください');
    return c;
  }

  /* ---------- base64url ---------- */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_INV = {};
  for (var bi = 0; bi < B64.length; bi++) B64_INV[B64.charAt(bi)] = bi;

  function b64urlEncode(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt(n >> 18 & 63) + B64.charAt(n >> 12 & 63) + B64.charAt(n >> 6 & 63) + B64.charAt(n & 63);
    }
    var rest = bytes.length - i;
    if (rest === 1) {
      var n1 = bytes[i] << 16;
      out += B64.charAt(n1 >> 18 & 63) + B64.charAt(n1 >> 12 & 63);
    } else if (rest === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt(n2 >> 18 & 63) + B64.charAt(n2 >> 12 & 63) + B64.charAt(n2 >> 6 & 63);
    }
    return out;
  }
  function b64urlDecode(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('bad base64url');
    var len = Math.floor(s.length * 3 / 4);
    var out = new Uint8Array(len), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64_INV[s.charAt(i)];
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    return out;
  }

  function utf8(s) { return new TextEncoder().encode(s); }
  function fromUtf8(b) { return new TextDecoder('utf-8', { fatal: true }).decode(b); }

  function randomBytes(n) { return cryptoObj().getRandomValues(new Uint8Array(n)); }
  var ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  function randomId(prefix, len) {
    var s = prefix || '';
    while (s.length < (prefix || '').length + len) {
      var b = randomBytes(len * 2);
      for (var i = 0; i < b.length && s.length < (prefix || '').length + len; i++) {
        if (b[i] < 232) s += ID_CHARS.charAt(b[i] % ID_CHARS.length); // 232 = 58*4（偏りなし）
      }
    }
    return s;
  }

  /* ---------- 鍵・暗号化 ---------- */
  function generateKeyString() { return b64urlEncode(randomBytes(KEY_BYTES)); }
  function isKeyString(s) {
    if (typeof s !== 'string' || !KEY_RE.test(s)) return false;
    try { return b64urlDecode(s).length === KEY_BYTES; } catch (e) { return false; }
  }
  function importKey(keyString) {
    if (!isKeyString(keyString)) return Promise.reject(new Error(URL_ERROR));
    return cryptoObj().subtle.importKey('raw', b64urlDecode(keyString), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  function encrypt(key, obj, aad) {
    var iv = randomBytes(IV_BYTES);
    return cryptoObj().subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(aad), tagLength: 128 }, key, utf8(JSON.stringify(obj)))
      .then(function (buf) {
        var ct = new Uint8Array(buf);
        var all = new Uint8Array(IV_BYTES + ct.length);
        all.set(iv, 0);
        all.set(ct, IV_BYTES);
        return b64urlEncode(all);
      });
  }

  // 鍵違い・改ざん・形式不正はすべて同じメッセージにまとめる（原因の詳細や中身は出さない）
  function decrypt(key, ct, aad) {
    return Promise.resolve().then(function () {
      var all = b64urlDecode(ct);
      if (all.length < IV_BYTES + 16) throw new Error('short');
      return cryptoObj().subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, IV_BYTES), additionalData: utf8(aad), tagLength: 128 }, key, all.subarray(IV_BYTES));
    }).then(function (buf) {
      return JSON.parse(fromUtf8(new Uint8Array(buf)));
    }).then(null, function () {
      throw new Error(URL_ERROR);
    });
  }

  /* ---------- 中身の検証（旧サーバー処理をブラウザ側へ移したもの） ---------- */
  function cleanEvent(raw, fallbackConfirmed) {
    var Core = PittanCore;
    var ev = Core.sanitizeEvent(raw);
    var confirmed = raw && raw.confirmed !== undefined ? raw.confirmed : fallbackConfirmed;
    try { ev.confirmed = Core.sanitizeConfirmed(confirmed, ev.candidates); } catch (e) { ev.confirmed = null; }
    ev.closed = !!(raw && raw.closed);
    return ev;
  }
  function cleanAnswer(raw, candidates) {
    var Core = PittanCore;
    raw = raw || {};
    return {
      name: Core.str(raw.name, Core.LIMITS.name),
      comment: Core.str(raw.comment, Core.LIMITS.comment),
      votes: Core.sanitizeVotes(raw.votes, candidates),
    };
  }

  // 自動削除の目安日（平文で保存）：最後の候補日・締切のうち遅い方＋30日。日付のない候補だけなら今日＋180日。日単位。
  function addDays(ymd, n) {
    var p = ymd.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function deleteAfter(ev, today) {
    var last = '';
    ev.candidates.forEach(function (c) { if (c.date && c.date > last) last = c.date; });
    if (ev.deadline && ev.deadline > last) last = ev.deadline;
    if (!last) return addDays(today, 180);
    return addDays(last > today ? last : today, 30);
  }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* ---------- データ操作 ---------- */
  // call(action, params) -> Promise（サーバー or デモ用のローカルルーター）。暗号化イベントの鍵と復号済み内容はこの中だけに保持する。
  function createRepo(call, opts) {
    opts = opts || {};
    var today = opts.today || localToday;
    var ctx = {};   // id -> { key: CryptoKey, event: 復号済みの内容 }（暗号化イベント）
    var plain = {}; // id -> true（サーバーから平文データだと確認できた旧イベント）

    function need(id) {
      var c = ctx[id];
      if (!c) throw new Error(URL_ERROR);
      return c;
    }
    // 書き込み時：暗号化イベントなら ctx を返す。平文と確認済みなら null（旧 API を使う）。
    // どちらでもなければ（未読込・鍵なし）、平文の内容をサーバーへ送らないよう送信前に止める。
    function mode(id) {
      if (ctx[id]) return ctx[id];
      if (plain[id]) return null;
      throw new Error(URL_ERROR);
    }
    function withId(id, ev, encrypted) {
      var out = JSON.parse(JSON.stringify(ev));
      out.id = id;
      out.encrypted = !!encrypted;
      return out;
    }
    function sealEvent(key, ev) {
      return encrypt(key, ev, AAD_EVENT).then(function (ct) {
        return { v: V, ct: ct, deleteAfter: deleteAfter(ev, today()) };
      });
    }
    function saveEnc(id, adminToken, ev) {
      var c = need(id);
      return sealEvent(c.key, ev).then(function (blob) {
        return call('update', { id: id, adminToken: adminToken, blob: blob });
      }).then(function () {
        c.event = ev;
        return { event: withId(id, ev, true) };
      });
    }

    return {
      // 新規作成は常に暗号化する
      create: function (input) {
        return Promise.resolve().then(function () {
          var ev = cleanEvent(input, null);
          ev.confirmed = null;
          ev.closed = false;
          var keyString = generateKeyString();
          return importKey(keyString).then(function (key) {
            return sealEvent(key, ev).then(function (blob) {
              return call('create', { blob: blob });
            }).then(function (res) {
              ctx[res.id] = { key: key, event: ev };
              return { id: res.id, adminToken: res.adminToken, key: keyString, event: withId(res.id, ev, true) };
            });
          });
        });
      },

      get: function (id, keyString, adminToken) {
        return call('get', { id: id, adminToken: adminToken || undefined }).then(function (res) {
          var env = res.event || {};
          if (env.v === undefined) {
            // 旧来の平文データ
            delete ctx[id];
            plain[id] = true;
            res.event.encrypted = false;
            return res;
          }
          delete plain[id];
          if (env.v !== V || !keyString) throw new Error(URL_ERROR);
          return importKey(keyString).then(function (key) {
            return decrypt(key, env.ct, AAD_EVENT).then(function (raw) {
              var ev;
              try { ev = cleanEvent(raw, null); } catch (e) { throw new Error(URL_ERROR); }
              ctx[id] = { key: key, event: ev };
              var broken = 0;
              return Promise.all((res.answers || []).map(function (a) {
                if (!a || a.v !== V || typeof a.id !== 'string') { broken++; return null; }
                return decrypt(key, a.ct, aadAnswer(a.id)).then(function (plain) {
                  var x = cleanAnswer(plain, ev.candidates);
                  if (!x.name) { broken++; return null; }
                  x.id = a.id; x.createdAt = a.createdAt; x.updatedAt = a.updatedAt;
                  return x;
                }, function () { broken++; return null; });
              })).then(function (list) {
                var out = { event: withId(id, ev, true), answers: list.filter(Boolean), apiVersion: res.apiVersion, brokenAnswers: broken };
                if (res.isAdmin !== undefined) out.isAdmin = res.isAdmin;
                return out;
              });
            });
          });
        });
      },

      update: function (id, adminToken, input) {
        return Promise.resolve().then(function () {
          var c = mode(id);
          if (!c) return call('update', { id: id, adminToken: adminToken, event: input });
          var ev = cleanEvent(input, c.event.confirmed);
          ev.closed = c.event.closed;
          return saveEnc(id, adminToken, ev);
        });
      },

      confirm: function (id, adminToken, confirmed) {
        return Promise.resolve().then(function () {
          var c = mode(id);
          if (!c) return call('confirm', { id: id, adminToken: adminToken, confirmed: confirmed });
          var ev = JSON.parse(JSON.stringify(c.event));
          ev.confirmed = PittanCore.sanitizeConfirmed(confirmed, ev.candidates);
          return saveEnc(id, adminToken, ev);
        });
      },

      setClosed: function (id, adminToken, closed) {
        return Promise.resolve().then(function () {
          var c = mode(id);
          if (!c) return call('setClosed', { id: id, adminToken: adminToken, closed: closed });
          var ev = JSON.parse(JSON.stringify(c.event));
          ev.closed = !!closed;
          return saveEnc(id, adminToken, ev);
        });
      },

      remove: function (id, adminToken) {
        return call('remove', { id: id, adminToken: adminToken }).then(function (r) { delete ctx[id]; delete plain[id]; return r; });
      },

      // input: { id?, name, comment, votes }。isAdmin は受付終了後の回答可否（暗号化イベントはブラウザ側で判定）
      answer: function (id, adminToken, input, isAdmin) {
        return Promise.resolve().then(function () {
          var c = mode(id);
          if (!c) return call('answer', { id: id, adminToken: adminToken || undefined, answer: input });
          if (c.event.closed && !isAdmin) throw new Error('この日程調整は回答の受付を終了しています');
          var a = cleanAnswer(input, c.event.candidates);
          if (!a.name) throw new Error('お名前を入力してください');
          var answerId = input && typeof input.id === 'string' && PittanCore.ID_RE.test(input.id) ? input.id : randomId('a', 10);
          return encrypt(c.key, a, aadAnswer(answerId)).then(function (ct) {
            return call('answer', { id: id, adminToken: adminToken || undefined, answerId: answerId, blob: { v: V, ct: ct } });
          }).then(function (res) {
            var out = JSON.parse(JSON.stringify(a));
            out.id = answerId; out.createdAt = res.answer.createdAt; out.updatedAt = res.answer.updatedAt;
            return { answer: out };
          });
        });
      },

      deleteAnswer: function (id, adminToken, answerId, isAdmin) {
        return Promise.resolve().then(function () {
          var c = mode(id);
          if (c && c.event.closed && !isAdmin) throw new Error('この日程調整は回答の受付を終了しています');
          return call('deleteAnswer', { id: id, answerId: answerId, adminToken: adminToken || undefined });
        });
      },
    };
  }

  return {
    V: V,
    URL_ERROR: URL_ERROR,
    AAD_EVENT: AAD_EVENT,
    aadAnswer: aadAnswer,
    generateKeyString: generateKeyString,
    isKeyString: isKeyString,
    importKey: importKey,
    encrypt: encrypt,
    decrypt: decrypt,
    deleteAfter: deleteAfter,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    createRepo: createRepo,
  };
})();
