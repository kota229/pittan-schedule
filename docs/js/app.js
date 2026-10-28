(function () {
  'use strict';

  var $app = document.getElementById('app');
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var MARK = { 2: '○', 1: '△', 0: '×' };
  var MARK_CLASS = { 2: 'yes', 1: 'maybe', 0: 'no' };

  /* ---------- 小物 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function linkify(s) {
    return esc(s).replace(/https?:\/\/[^\s<>"']+/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayYmd() { return ymd(new Date()); }
  function fmtDate(s, withYear) {
    var d = parseYmd(s);
    var y = withYear || d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '/' : '';
    return y + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')';
  }
  function fmtCand(c) {
    var s = '';
    if (c.date) {
      s = fmtDate(c.date);
      if (c.start) s += ' ' + c.start + (c.end ? '〜' + c.end : '〜');
      if (c.label) s += ' ' + c.label;
    } else {
      s = c.label;
    }
    return s;
  }
  function candCls(c) {
    if (!c.date) return '';
    var d = parseYmd(c.date).getDay();
    return d === 0 ? 'sun' : d === 6 ? 'sat' : '';
  }
  function sortCands(list) {
    return list.slice().sort(function (a, b) {
      var ka = (a.date || '9999') + (a.start || '') + (a.end || '');
      var kb = (b.date || '9999') + (b.start || '') + (b.end || '');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }
  function baseUrl() { return location.href.split('#')[0]; }
  function eventUrl(id) { return baseUrl() + '#/e/' + id; }
  function adminUrl(id, token) { return baseUrl() + '#/e/' + id + '/admin/' + token; }

  /* ---------- ブラウザ内の記憶 ---------- */
  function lsGet(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var Mem = {
    adminToken: function (id) { return lsGet('pittan.admin', {})[id] || ''; },
    setAdmin: function (id, token) { var m = lsGet('pittan.admin', {}); m[id] = token; lsSet('pittan.admin', m); },
    mine: function (id) { return lsGet('pittan.mine', {})[id] || []; },
    addMine: function (id, aid) { var m = lsGet('pittan.mine', {}); var l = m[id] || []; if (l.indexOf(aid) < 0) l.push(aid); m[id] = l; lsSet('pittan.mine', m); },
    name: function () { return lsGet('pittan.name', ''); },
    setName: function (n) { lsSet('pittan.name', n); },
    recent: function () { return lsGet('pittan.recent', []); },
    touch: function (ev) {
      var l = Mem.recent().filter(function (r) { return r.id !== ev.id; });
      l.unshift({ id: ev.id, title: ev.title, at: Date.now() });
      lsSet('pittan.recent', l.slice(0, 30));
    },
    forget: function (id) {
      lsSet('pittan.recent', Mem.recent().filter(function (r) { return r.id !== id; }));
      var m = lsGet('pittan.admin', {}); delete m[id]; lsSet('pittan.admin', m);
    },
  };

  /* ---------- UI 共通 ---------- */
  var toastTimer;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }
  function copy(text, label) {
    var done = function () { toast((label || 'URL') + 'をコピーしました'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }
  function loading(msg) {
    $app.innerHTML = '<div class="loading"><div class="spinner"></div><p>' + esc(msg || '読み込み中…') + '</p></div>';
  }
  function errorView(msg) {
    $app.innerHTML = '<div class="card center"><p class="err-text">' + esc(msg) + '</p><a class="btn" href="#/">トップへ戻る</a></div>';
  }
  function busy(btn, on, text) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span>' + esc(text || '送信中…'); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }
  function confirmDialog(msg, okLabel, danger) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal-bg';
      wrap.innerHTML = '<div class="modal" role="dialog"><p>' + esc(msg).replace(/\n/g, '<br>') + '</p><div class="row end">' +
        '<button class="btn ghost" data-r="0">キャンセル</button>' +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-r="1">' + esc(okLabel || 'OK') + '</button></div></div>';
      wrap.addEventListener('click', function (e) {
        var r = e.target.getAttribute('data-r');
        if (e.target === wrap || r !== null) { document.body.removeChild(wrap); resolve(r === '1'); }
      });
      document.body.appendChild(wrap);
      wrap.querySelector('[data-r="1"]').focus();
    });
  }

  /* ---------- ルーター ---------- */
  function route() {
    window.scrollTo(0, 0);
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'new') return formView(null);
    if (parts[0] === 'e' && parts[1]) {
      var id = parts[1];
      if (parts[2] === 'admin' && parts[3]) {
        Mem.setAdmin(id, parts[3]);
        history.replaceState(null, '', '#/e/' + id);
        return eventView(id, { adminLanding: true });
      }
      if (parts[2] === 'edit') return editView(id);
      if (parts[2] === 'done') return doneView(id);
      return eventView(id, {});
    }
    return homeView();
  }
  window.addEventListener('hashchange', route);

  /* ---------- トップ ---------- */
  function homeView() {
    document.title = 'ぴったん｜かんたん日程調整';
    var recent = Mem.recent();
    var html = '<section class="hero">' +
      '<h1>みんなの都合、<br class="sp">ぴったり合わせよう。</h1>' +
      '<p>候補日を選んでURLを送るだけ。<br class="sp">参加者は登録なしで ○△× を入れられます。</p>' +
      '<a class="btn primary lg" href="#/new">＋ 日程調整をつくる</a>' +
      '</section>' +
      '<section class="steps">' +
      step(1, '候補日を選ぶ', 'カレンダーをタップして候補日と時間を入れます') +
      step(2, 'URLを共有', 'LINEやメールで参加者にURLを送ります') +
      step(3, 'みんなが回答', '各自が ○△× とコメントを入力します') +
      step(4, '日程を決定', '集計を見て、いちばん都合の良い日に決定！') +
      '</section>';
    if (recent.length) {
      html += '<section class="card"><h2>最近の日程調整</h2><ul class="recent">' + recent.map(function (r) {
        var admin = Mem.adminToken(r.id);
        return '<li><a href="#/e/' + esc(r.id) + '">' + esc(r.title) + '</a>' +
          (admin ? '<span class="chip">幹事</span>' : '') +
          '<button class="icon-btn" data-forget="' + esc(r.id) + '" title="履歴から消す">×</button></li>';
      }).join('') + '</ul><p class="hint">この端末で作成・閲覧したものだけが表示されます。</p></section>';
    }
    $app.innerHTML = html;
    $app.querySelectorAll('[data-forget]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-forget');
        var msg = Mem.adminToken(id) ? 'この端末の履歴から消しますか？\n（管理用URLを保存していないと、あとで編集できなくなります）' : 'この端末の履歴から消しますか？';
        confirmDialog(msg, '消す', true).then(function (ok) { if (ok) { Mem.forget(id); homeView(); } });
      };
    });
  }
  function step(n, t, d) {
    return '<div class="step"><span class="num">' + n + '</span><div><b>' + t + '</b><p>' + d + '</p></div></div>';
  }

  /* ---------- 作成・編集フォーム ---------- */
  function editView(id) {
    var token = Mem.adminToken(id);
    if (!token) return errorView('編集するには、幹事用（管理用）URLを開いてください。');
    loading();
    Api.call('get', { id: id, adminToken: token }).then(function (res) {
      if (!res.isAdmin) return errorView('管理用URLが正しくありません。');
      formView(res.event, token);
    }, function (e) { errorView(e.message); });
  }

  function formView(ev, token) {
    var editing = !!ev;
    document.title = (editing ? '日程調整を編集' : '日程調整をつくる') + '｜ぴったん';
    var now = new Date();
    var st = {
      candidates: editing ? sortCands(ev.candidates) : [],
      useTime: false,
      slots: [{ start: '19:00', end: '21:00' }],
      month: new Date(now.getFullYear(), now.getMonth(), 1),
    };
    if (editing) {
      var firstDated = st.candidates.filter(function (c) { return c.date; })[0];
      if (firstDated) { var d0 = parseYmd(firstDated.date); st.month = new Date(d0.getFullYear(), d0.getMonth(), 1); }
      var timed = st.candidates.filter(function (c) { return c.start; })[0];
      if (timed) { st.useTime = true; st.slots = [{ start: timed.start, end: timed.end }]; }
    }

    $app.innerHTML =
      '<div class="page-head"><a href="' + (editing ? '#/e/' + esc(ev.id) : '#/') + '" class="back">‹ 戻る</a>' +
      '<h1>' + (editing ? '日程調整を編集' : '日程調整をつくる') + '</h1></div>' +
      '<form id="f" class="card form" novalidate>' +
      '<label class="field"><span class="lbl">イベント名 <em>必須</em></span>' +
      '<input id="title" maxlength="100" placeholder="例）忘年会、打ち合わせ" value="' + esc(editing ? ev.title : '') + '"></label>' +
      '<label class="field"><span class="lbl">メモ（任意）</span>' +
      '<textarea id="memo" rows="3" maxlength="2000" placeholder="場所・会費・連絡事項など">' + esc(editing ? ev.memo : '') + '</textarea></label>' +
      '<div class="field"><span class="lbl">候補日程 <em>必須</em></span>' +
      '<p class="hint">カレンダーの日付をタップすると候補に追加されます（もう一度タップで解除）。</p>' +
      '<div class="time-box">' +
      '<label class="switch"><input type="checkbox" id="useTime"' + (st.useTime ? ' checked' : '') + '><span></span>時間も指定する</label>' +
      '<div id="slots"></div></div>' +
      '<div id="cal" class="cal"></div>' +
      '<div class="free-add"><input id="freeText" maxlength="60" placeholder="自由入力で候補を追加（例：来月中旬の平日夜）">' +
      '<button type="button" class="btn ghost" id="freeAdd">追加</button></div>' +
      '<div class="cand-head"><b>選択中の候補 <span id="candCount">0</span>件</b>' +
      '<button type="button" class="link-btn" id="clearAll">すべて解除</button></div>' +
      '<ul id="candList" class="cand-list"></ul></div>' +
      '<label class="field"><span class="lbl">回答の締切（任意）</span>' +
      '<input type="date" id="deadline" value="' + esc(editing ? ev.deadline : '') + '"></label>' +
      (editing ?'<p class="hint warn">※候補を削除すると、その候補への回答も表示されなくなります。</p>' : '') +
      '<button type="submit" class="btn primary lg block" id="submit">' + (editing ? '変更を保存する' : '作成してURLを発行する') + '</button>' +
      '</form>';

    var $cal = document.getElementById('cal');
    var $slots = document.getElementById('slots');
    var $list = document.getElementById('candList');

    function validSlots() {
      if (!st.useTime) return [{ start: '', end: '' }];
      var out = st.slots.filter(function (s) { return s.start; }).map(function (s) {
        return { start: s.start, end: s.end && s.end > s.start ? s.end : '' };
      });
      return out.length ? out : [{ start: '', end: '' }];
    }

    function renderSlots() {
      if (!st.useTime) { $slots.innerHTML = ''; return; }
      $slots.innerHTML = st.slots.map(function (s, i) {
        return '<div class="slot"><input type="time" step="900" data-i="' + i + '" data-k="start" value="' + esc(s.start) + '">' +
          '<span>〜</span><input type="time" step="900" data-i="' + i + '" data-k="end" value="' + esc(s.end) + '">' +
          (st.slots.length > 1 ? '<button type="button" class="icon-btn" data-del-slot="' + i + '" title="この時間帯を削除">×</button>' : '') +
          '</div>';
      }).join('') + '<button type="button" class="link-btn" id="addSlot">＋ 時間帯を追加（1日に複数の候補）</button>' +
        '<p class="hint">ここで指定した時間で、タップした日付が候補になります。</p>';
      $slots.querySelectorAll('input').forEach(function (inp) {
        inp.onchange = function () { st.slots[+inp.dataset.i][inp.dataset.k] = inp.value; };
      });
      $slots.querySelectorAll('[data-del-slot]').forEach(function (b) {
        b.onclick = function () { st.slots.splice(+b.getAttribute('data-del-slot'), 1); renderSlots(); };
      });
      document.getElementById('addSlot').onclick = function () {
        var last = st.slots[st.slots.length - 1] || { start: '12:00', end: '13:00' };
        st.slots.push({ start: last.start, end: last.end });
        renderSlots();
      };
    }

    function renderCal() {
      var m = st.month;
      var first = new Date(m.getFullYear(), m.getMonth(), 1);
      var start = new Date(first); start.setDate(1 - first.getDay());
      var counts = {};
      st.candidates.forEach(function (c) { if (c.date) counts[c.date] = (counts[c.date] || 0) + 1; });
      var today = todayYmd();
      var html = '<div class="cal-head"><button type="button" class="icon-btn" id="prevM" aria-label="前の月">‹</button>' +
        '<b>' + m.getFullYear() + '年' + (m.getMonth() + 1) + '月</b>' +
        '<button type="button" class="icon-btn" id="nextM" aria-label="次の月">›</button></div><div class="cal-grid">';
      WD.forEach(function (w, i) { html += '<div class="wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>'; });
      for (var i = 0; i < 42; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        if (i >= 35 && d.getMonth() !== m.getMonth()) break;
        var key = ymd(d);
        var cls = ['day'];
        if (d.getMonth() !== m.getMonth()) cls.push('other');
        if (key < today) cls.push('past');
        if (key === today) cls.push('today');
        if (counts[key]) cls.push('on');
        if (d.getDay() === 0) cls.push('sun');
        if (d.getDay() === 6) cls.push('sat');
        html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + key + '">' + d.getDate() +
          (counts[key] > 1 ? '<i>' + counts[key] + '</i>' : '') + '</button>';
      }
      $cal.innerHTML = html + '</div>';
      document.getElementById('prevM').onclick = function () { st.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderCal(); };
      document.getElementById('nextM').onclick = function () { st.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderCal(); };
      $cal.querySelectorAll('[data-date]').forEach(function (b) {
        b.onclick = function () { toggleDate(b.getAttribute('data-date')); };
      });
    }

    function toggleDate(date) {
      var has = st.candidates.some(function (c) { return c.date === date; });
      if (has) {
        st.candidates = st.candidates.filter(function (c) { return c.date !== date; });
      } else {
        validSlots().forEach(function (s) { addCand({ date: date, start: s.start, end: s.end, label: '' }); });
      }
      renderAll();
    }

    function addCand(c) {
      var dup = st.candidates.some(function (x) {
        return x.date === c.date && x.start === c.start && x.end === c.end && x.label === c.label;
      });
      if (!dup) st.candidates.push(c);
      st.candidates = sortCands(st.candidates);
    }

    function renderList() {
      document.getElementById('candCount').textContent = st.candidates.length;
      if (!st.candidates.length) {
        $list.innerHTML = '<li class="empty">まだ候補がありません</li>';
        return;
      }
      $list.innerHTML = st.candidates.map(function (c, i) {
        return '<li><span class="' + candCls(c) + '">' + esc(fmtCand(c)) + '</span>' +
          '<button type="button" class="icon-btn" data-del="' + i + '" title="削除">×</button></li>';
      }).join('');
      $list.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () { st.candidates.splice(+b.getAttribute('data-del'), 1); renderAll(); };
      });
    }

    function renderAll() { renderCal(); renderList(); }

    document.getElementById('useTime').onchange = function (e) { st.useTime = e.target.checked; renderSlots(); };
    document.getElementById('clearAll').onclick = function () {
      if (!st.candidates.length) return;
      confirmDialog('選択中の候補をすべて解除しますか？', '解除する', true).then(function (ok) {
        if (ok) { st.candidates = []; renderAll(); }
      });
    };
    var $free = document.getElementById('freeText');
    function freeAdd() {
      var v = $free.value.trim();
      if (!v) return;
      addCand({ date: '', start: '', end: '', label: v });
      $free.value = '';
      renderAll();
    }
    document.getElementById('freeAdd').onclick = freeAdd;
    $free.onkeydown = function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); freeAdd(); } };

    document.getElementById('f').onsubmit = function (e) {
      e.preventDefault();
      var title = document.getElementById('title').value.trim();
      if (!title) { toast('イベント名を入力してください', true); document.getElementById('title').focus(); return; }
      if (!st.candidates.length) { toast('候補日程を1つ以上選んでください', true); return; }
      var payload = {
        title: title,
        memo: document.getElementById('memo').value,
        deadline: document.getElementById('deadline').value,
        candidates: st.candidates,
      };
      var btn = document.getElementById('submit');
      busy(btn, true, editing ? '保存中…' : '作成中…');
      var p = editing
        ? Api.call('update', { id: ev.id, adminToken: token, event: payload })
        : Api.call('create', { event: payload });
      p.then(function (res) {
        if (editing) {
          toast('保存しました');
          location.hash = '#/e/' + ev.id;
        } else {
          Mem.setAdmin(res.id, res.adminToken);
          Mem.touch(res.event);
          location.hash = '#/e/' + res.id + '/done';
        }
      }, function (err) { busy(btn, false); toast(err.message, true); });
    };

    renderSlots();
    renderAll();
    if (!editing) document.getElementById('title').focus();
  }

  /* ---------- 作成完了 ---------- */
  function doneView(id) {
    var token = Mem.adminToken(id);
    var url = eventUrl(id);
    var aurl = token ? adminUrl(id, token) : '';
    document.title = '作成しました｜ぴったん';
    $app.innerHTML = '<div class="card center done">' +
      '<div class="done-icon">✓</div><h1>日程調整を作成しました</h1>' +
      '<p>下のURLを参加者に共有してください。</p></div>' +
      '<div class="card">' + shareBox(url, '参加者用URL（みんなに送る）') + '</div>' +
      (aurl ? '<div class="card admin-url"><h2>幹事用URL（あなただけ）</h2>' +
        '<p class="hint warn">このURLから候補の編集・日程の決定・削除ができます。<b>他の人には送らず</b>、メモやブックマークに保存してください（この端末では自動で記憶されます）。</p>' +
        '<div class="url-row"><input readonly value="' + esc(aurl) + '"><button class="btn" data-copy-admin>コピー</button></div>' +
        '<a class="link-btn" href="mailto:?subject=' + encodeURIComponent('【幹事用】日程調整の管理URL') + '&body=' + encodeURIComponent(aurl) + '">自分にメールで送る</a></div>' : '') +
      '<a class="btn primary lg block" href="#/e/' + esc(id) + '">日程調整ページを開く</a>';
    bindShare($app);
    var b = $app.querySelector('[data-copy-admin]');
    if (b) b.onclick = function () { copy(aurl, '幹事用URL'); };
  }

  function shareBox(url, title, ev) {
    var text = (ev ? '「' + ev.title + '」の日程調整です。都合を入力してください。\n' : '') + url;
    return '<h2>' + esc(title) + '</h2><div class="url-row"><input readonly value="' + esc(url) + '">' +
      '<button class="btn primary" data-copy="' + esc(url) + '">コピー</button></div>' +
      '<div class="share-btns">' +
      '<a class="btn line" target="_blank" rel="noopener" href="https://line.me/R/msg/text/?' + encodeURIComponent(text) + '">LINEで送る</a>' +
      '<a class="btn ghost" href="mailto:?subject=' + encodeURIComponent((ev ? ev.title + ' ' : '') + '日程調整') + '&body=' + encodeURIComponent(text) + '">メールで送る</a>' +
      (navigator.share ? '<button class="btn ghost" data-native-share="' + esc(url) + '">その他</button>' : '') +
      '</div>';
  }
  function bindShare(root) {
    root.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { copy(b.getAttribute('data-copy')); }; });
    root.querySelectorAll('[data-native-share]').forEach(function (b) {
      b.onclick = function () { navigator.share({ url: b.getAttribute('data-native-share') }).catch(function () {}); };
    });
    root.querySelectorAll('.url-row input').forEach(function (i) { i.onfocus = function () { i.select(); }; });
  }

  /* ---------- 日程調整ページ（回答・集計） ---------- */
  function eventView(id, opts) {
    loading();
    var token = Mem.adminToken(id);
    Api.call('get', { id: id, adminToken: token || undefined }).then(function (res) {
      if (token && !res.isAdmin) {
        if (opts.adminLanding) toast('管理用URLが正しくありません', true);
        token = '';
      } else if (opts.adminLanding) {
        toast('幹事として開きました');
      }
      Mem.touch(res.event);
      renderEvent(res, token, opts);
    }, function (e) {
      if (/見つかりません/.test(e.message)) Mem.forget(id);
      errorView(e.message);
    });
  }

  function tally(ev, answers) {
    var t = {};
    ev.candidates.forEach(function (c) { t[c.id] = { 2: 0, 1: 0, 0: 0 }; });
    answers.forEach(function (a) {
      Object.keys(a.votes || {}).forEach(function (cid) { if (t[cid]) t[cid][a.votes[cid]]++; });
    });
    return t;
  }

  function renderEvent(res, token, opts) {
    var ev = res.event;
    var answers = res.answers;
    var isAdmin = !!token;
    var mine = Mem.mine(ev.id);
    var t = tally(ev, answers);
    var cands = sortCands(ev.candidates);
    var sortMode = opts.sort || 'date';
    var score = function (c) { return t[c.id][2] * 1000 + t[c.id][1]; };
    var best = Math.max.apply(null, cands.map(score));
    if (sortMode === 'popular') cands = cands.slice().sort(function (a, b) { return score(b) - score(a); });
    var confirmed = ev.confirmedId ? ev.candidates.filter(function (c) { return c.id === ev.confirmedId; })[0] : null;
    var expired = ev.deadline && ev.deadline < todayYmd();
    var closed = ev.closed || expired;
    document.title = ev.title + '｜ぴったん';

    var html = '';
    if (confirmed) {
      html += '<div class="confirmed"><div class="c-label">日程が決まりました</div><div class="c-date">' + esc(fmtCand(confirmed)) + '</div>' +
        (confirmed.date ? '<div class="share-btns center"><a class="btn" target="_blank" rel="noopener" href="' + esc(gcalUrl(ev, confirmed)) + '">Googleカレンダーに追加</a>' +
          '<button class="btn ghost" id="ics">カレンダー用ファイル(.ics)</button></div>' : '') + '</div>';
    }
    html += '<div class="card ev-head"><h1>' + esc(ev.title) + '</h1>' +
      (ev.memo ? '<div class="memo">' + linkify(ev.memo) + '</div>' : '') +
      '<div class="meta"><span>回答 ' + answers.length + '人</span>' +
      (ev.deadline ? '<span>締切 ' + esc(fmtDate(ev.deadline)) + (expired ? '（終了）' : '') + '</span>' : '') +
      (ev.closed ? '<span class="chip gray">受付終了</span>' : '') +
      (isAdmin ? '<span class="chip">幹事</span>' : '') + '</div></div>';

    if (isAdmin) {
      html += '<div class="card admin"><h2>幹事メニュー</h2><div class="admin-btns">' +
        '<a class="btn" href="#/e/' + esc(ev.id) + '/edit">候補・内容を編集</a>' +
        '<button class="btn" id="toggleClose">' + (ev.closed ? '回答の受付を再開' : '回答の受付を終了') + '</button>' +
        (confirmed ? '<button class="btn" id="unconfirm">決定を取り消す</button>' : '') +
        '<button class="btn" id="copyAdmin">幹事用URLをコピー</button>' +
        '<button class="btn danger-ghost" id="removeEv">削除</button></div>' +
        '<p class="hint">表の日程にある「決定」ボタンで日程を確定できます。</p></div>';
    }

    // 集計表
    html += '<div class="card"><div class="table-head"><h2>みんなの回答</h2>' +
      '<div class="seg small"><button class="' + (sortMode === 'date' ? 'on' : '') + '" data-sort="date">日付順</button>' +
      '<button class="' + (sortMode === 'popular' ? 'on' : '') + '" data-sort="popular">○が多い順</button></div></div>' +
      '<div class="table-wrap"><table class="result"><thead><tr><th class="sticky">日程</th>' +
      '<th class="n yes">○</th><th class="n maybe">△</th><th class="n no">×</th>' +
      answers.map(function (a) {
        return '<th class="name"><button class="name-btn' + (mine.indexOf(a.id) >= 0 ? ' me' : '') + '" data-edit="' + esc(a.id) + '" title="クリックで回答を編集">' + esc(a.name) + '</button></th>';
      }).join('') + '</tr></thead><tbody>' +
      cands.map(function (c) {
        var rowCls = [];
        if (best > 0 && score(c) === best) rowCls.push('best');
        if (confirmed && confirmed.id === c.id) rowCls.push('fixed');
        return '<tr class="' + rowCls.join(' ') + '"><th class="sticky"><span class="' + candCls(c) + '">' + esc(fmtCand(c)) + '</span>' +
          (confirmed && confirmed.id === c.id ? '<span class="tag">決定</span>' : (best > 0 && score(c) === best ? '<span class="tag best-tag">最多</span>' : '')) +
          (isAdmin && (!confirmed || confirmed.id !== c.id) ? '<button class="mini-btn" data-confirm="' + esc(c.id) + '">決定</button>' : '') + '</th>' +
          '<td class="n yes">' + t[c.id][2] + '</td><td class="n maybe">' + t[c.id][1] + '</td><td class="n no">' + t[c.id][0] + '</td>' +
          answers.map(function (a) {
            var v = a.votes ? a.votes[c.id] : undefined;
            return v === undefined ? '<td class="v none">−</td>' : '<td class="v ' + MARK_CLASS[v] + '">' + MARK[v] + '</td>';
          }).join('') + '</tr>';
      }).join('') +
      (answers.some(function (a) { return a.comment; }) ? '<tr class="comment-row"><th class="sticky">コメント</th><td colspan="3"></td>' +
        answers.map(function (a) { return '<td class="cmt">' + esc(a.comment) + '</td>'; }).join('') + '</tr>' : '') +
      '</tbody></table></div>' +
      (answers.length ? '<p class="hint">名前をタップすると、その回答を編集できます。</p>' : '<p class="empty">まだ回答がありません。最初の回答をどうぞ！</p>') +
      '<div class="row end"><button class="link-btn" id="reload">↻ 最新の状態に更新</button></div></div>';

    // 回答ボタン
    if (closed && !isAdmin) {
      html += '<div class="card center closed-msg">' + (ev.closed ? 'この日程調整は回答の受付を終了しました。' : '回答の締切を過ぎています。') + '</div>';
    } else {
      html += '<div id="answerArea"><button class="btn primary lg block" id="openAnswer">○△× で回答する</button></div>';
    }

    // コメント一覧
    var withComment = answers.filter(function (a) { return a.comment; });
    if (withComment.length) {
      html += '<div class="card"><h2>コメント</h2><ul class="comments">' + withComment.map(function (a) {
        return '<li><b>' + esc(a.name) + '</b><p>' + linkify(a.comment) + '</p></li>';
      }).join('') + '</ul></div>';
    }

    html += '<div class="card">' + shareBox(eventUrl(ev.id), 'このページのURLを共有', ev) + '</div>';
    $app.innerHTML = html;
    bindShare($app);

    var rerender = function (o) { renderEvent(res, token, Object.assign({}, opts, o, { adminLanding: false })); };
    var reload = function () { eventView(ev.id, { sort: sortMode }); };

    $app.querySelectorAll('[data-sort]').forEach(function (b) { b.onclick = function () { rerender({ sort: b.getAttribute('data-sort') }); }; });
    document.getElementById('reload').onclick = reload;
    var icsBtn = document.getElementById('ics');
    if (icsBtn) icsBtn.onclick = function () { downloadIcs(ev, confirmed); };

    var openAnswer = document.getElementById('openAnswer');
    if (openAnswer) openAnswer.onclick = function () { answerForm(ev, null, token, reload); };
    $app.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        if (closed && !isAdmin) { toast('回答の受付は終了しています', true); return; }
        var a = answers.filter(function (x) { return x.id === b.getAttribute('data-edit'); })[0];
        answerForm(ev, a, token, reload);
      };
    });

    if (isAdmin) {
      var act = function (action, params, msg) {
        return Api.call(action, Object.assign({ id: ev.id, adminToken: token }, params)).then(function () {
          toast(msg); reload();
        }, function (e) { toast(e.message, true); });
      };
      $app.querySelectorAll('[data-confirm]').forEach(function (b) {
        b.onclick = function () {
          var c = ev.candidates.filter(function (x) { return x.id === b.getAttribute('data-confirm'); })[0];
          confirmDialog('「' + fmtCand(c) + '」に決定しますか？\n参加者のページにも表示されます。', '決定する').then(function (ok) {
            if (ok) act('confirm', { candidateId: c.id }, '日程を決定しました');
          });
        };
      });
      var un = document.getElementById('unconfirm');
      if (un) un.onclick = function () { act('confirm', { candidateId: '' }, '決定を取り消しました'); };
      document.getElementById('toggleClose').onclick = function () {
        act('setClosed', { closed: !ev.closed }, ev.closed ? '受付を再開しました' : '受付を終了しました');
      };
      document.getElementById('copyAdmin').onclick = function () { copy(adminUrl(ev.id, token), '幹事用URL'); };
      document.getElementById('removeEv').onclick = function () {
        confirmDialog('この日程調整を削除しますか？\n回答もすべて消え、元に戻せません。', '削除する', true).then(function (ok) {
          if (!ok) return;
          Api.call('remove', { id: ev.id, adminToken: token }).then(function () {
            Mem.forget(ev.id); toast('削除しました'); location.hash = '#/';
          }, function (e) { toast(e.message, true); });
        });
      };
    }
  }

  /* ---------- 回答フォーム ---------- */
  function answerForm(ev, existing, token, onDone) {
    var area = document.getElementById('answerArea');
    if (!area) {
      // 受付終了後に幹事以外は開けない。幹事は回答エリアがあるので通常ここには来ない
      return;
    }
    var cands = sortCands(ev.candidates);
    var votes = {};
    if (existing) Object.keys(existing.votes || {}).forEach(function (k) { votes[k] = existing.votes[k]; });
    area.innerHTML = '<form class="card answer" id="af" novalidate><h2>' + (existing ? esc(existing.name) + ' さんの回答を編集' : '出欠を入力') + '</h2>' +
      '<label class="field"><span class="lbl">お名前 <em>必須</em></span><input id="aName" maxlength="40" value="' + esc(existing ? existing.name : Mem.name()) + '" placeholder="例）山田"></label>' +
      '<div class="field"><div class="cand-head"><span class="lbl">各日程のご都合</span><span class="bulk">' +
      '<button type="button" class="link-btn" data-all="2">すべて○</button><button type="button" class="link-btn" data-all="0">すべて×</button></span></div>' +
      '<ul class="vote-list">' + cands.map(function (c) {
        return '<li><span class="vl ' + candCls(c) + '">' + esc(fmtCand(c)) + '</span><span class="seg vote" data-cid="' + esc(c.id) + '">' +
          [2, 1, 0].map(function (v) {
            return '<button type="button" class="' + MARK_CLASS[v] + (votes[c.id] === v ? ' on' : '') + '" data-v="' + v + '" aria-label="' + MARK[v] + '">' + MARK[v] + '</button>';
          }).join('') + '</span></li>';
      }).join('') + '</ul></div>' +
      '<label class="field"><span class="lbl">コメント（任意）</span><textarea id="aComment" rows="2" maxlength="500" placeholder="例）19時以降なら参加できます">' + esc(existing ? existing.comment : '') + '</textarea></label>' +
      '<button type="submit" class="btn primary lg block" id="aSubmit">' + (existing ? '回答を更新する' : '回答する') + '</button>' +
      '<div class="row between"><button type="button" class="link-btn" id="aCancel">キャンセル</button>' +
      (existing ? '<button type="button" class="link-btn danger-text" id="aDelete">この回答を削除</button>' : '') + '</div></form>';

    function paint() {
      area.querySelectorAll('.seg.vote').forEach(function (seg) {
        var cid = seg.getAttribute('data-cid');
        seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', votes[cid] === +b.getAttribute('data-v')); });
      });
    }
    area.querySelectorAll('.seg.vote button').forEach(function (b) {
      b.onclick = function () { votes[b.parentNode.getAttribute('data-cid')] = +b.getAttribute('data-v'); paint(); };
    });
    area.querySelectorAll('[data-all]').forEach(function (b) {
      b.onclick = function () { var v = +b.getAttribute('data-all'); cands.forEach(function (c) { votes[c.id] = v; }); paint(); };
    });
    document.getElementById('aCancel').onclick = function () { onDone(); };
    var del = document.getElementById('aDelete');
    if (del) del.onclick = function () {
      confirmDialog(existing.name + ' さんの回答を削除しますか？', '削除する', true).then(function (ok) {
        if (!ok) return;
        Api.call('deleteAnswer', { id: ev.id, answerId: existing.id, adminToken: token || undefined }).then(function () {
          toast('回答を削除しました'); onDone();
        }, function (e) { toast(e.message, true); });
      });
    };
    document.getElementById('af').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('aName').value.trim();
      if (!name) { toast('お名前を入力してください', true); document.getElementById('aName').focus(); return; }
      var missing = cands.filter(function (c) { return votes[c.id] === undefined; }).length;
      var go = function () {
        var btn = document.getElementById('aSubmit');
        busy(btn, true);
        Api.call('answer', {
          id: ev.id,
          adminToken: token || undefined,
          answer: { id: existing ? existing.id : undefined, name: name, comment: document.getElementById('aComment').value, votes: votes },
        }).then(function (r) {
          Mem.addMine(ev.id, r.answer.id);
          if (!existing) Mem.setName(name);
          toast(existing ? '回答を更新しました' : '回答しました。ありがとうございます！');
          onDone();
        }, function (err) { busy(btn, false); toast(err.message, true); });
      };
      if (missing) {
        confirmDialog('未入力の日程が ' + missing + ' 件あります。このまま送信しますか？', '送信する').then(function (ok) { if (ok) go(); });
      } else go();
    };
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!existing && !Mem.name()) document.getElementById('aName').focus({ preventScroll: true });
  }

  /* ---------- カレンダー連携 ---------- */
  function calRange(c) {
    var d = c.date.replace(/-/g, '');
    if (!c.start) {
      var n = parseYmd(c.date); n.setDate(n.getDate() + 1);
      return { allDay: true, s: d, e: ymd(n).replace(/-/g, '') };
    }
    var end = c.end;
    if (!end) {
      var h = +c.start.slice(0, 2);
      end = h >= 23 ? '23:59' : pad(h + 1) + ':' + c.start.slice(3, 5);
    }
    return { allDay: false, s: d + 'T' + c.start.replace(':', '') + '00', e: d + 'T' + end.replace(':', '') + '00' };
  }
  function gcalUrl(ev, c) {
    var r = calRange(c);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title) +
      '&dates=' + r.s + '/' + r.e + '&ctz=Asia/Tokyo&details=' + encodeURIComponent((ev.memo ? ev.memo + '\n\n' : '') + eventUrl(ev.id));
  }
  function downloadIcs(ev, c) {
    var r = calRange(c);
    var escI = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, '\\$&'); };
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//pittan//JP', 'BEGIN:VEVENT',
      'UID:' + ev.id + '-' + c.id + '@pittan', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
      r.allDay ? 'DTSTART;VALUE=DATE:' + r.s : 'DTSTART;TZID=Asia/Tokyo:' + r.s,
      r.allDay ? 'DTEND;VALUE=DATE:' + r.e : 'DTEND;TZID=Asia/Tokyo:' + r.e,
      'SUMMARY:' + escI(ev.title), 'DESCRIPTION:' + escI((ev.memo ? ev.memo + '\n\n' : '') + eventUrl(ev.id)),
      'END:VEVENT', 'END:VCALENDAR'];
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'event.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /* ---------- 起動 ---------- */
  if (Api.isDemo) {
    var bn = document.getElementById('demoBanner');
    if (bn) bn.hidden = false;
  }
  route();
})();
