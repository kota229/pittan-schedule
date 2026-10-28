(function () {
  'use strict';

  var $app = document.getElementById('app');
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var MARKS = [
    { v: 2, sym: '○', name: '参加可', cls: 'yes' },
    { v: 1, sym: '△', name: '未定', cls: 'maybe' },
    { v: 0, sym: '×', name: '不可', cls: 'no' },
  ];
  var MK = { 3: MARKS[0], 2: MARKS[0], 1: MARKS[1], 0: MARKS[2] }; // 旧データの◎(3)は○として表示

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
    var today = todayYmd();
    // days: { 'YYYY-MM-DD': { alldayId, slots: [{id,start,end}] } }  id は編集時に既存回答を引き継ぐため
    var st = {
      days: {},
      free: [],
      useTime: true,
      defaults: [{ start: '19:00', end: '21:00' }],
      month: new Date(now.getFullYear(), now.getMonth(), 1),
    };
    if (editing) {
      st.useTime = ev.candidates.some(function (c) { return c.start; });
      sortCands(ev.candidates).forEach(function (c) {
        if (!c.date) { st.free.push({ id: c.id, label: c.label }); return; }
        var d = st.days[c.date] || (st.days[c.date] = { alldayId: '', slots: [] });
        if (c.start) d.slots.push({ id: c.id, start: c.start, end: c.end });
        else d.alldayId = c.id;
      });
      var firstDate = Object.keys(st.days).sort()[0];
      if (firstDate) { var d0 = parseYmd(firstDate); st.month = new Date(d0.getFullYear(), d0.getMonth(), 1); }
      var firstSlot = ev.candidates.filter(function (c) { return c.start; })[0];
      if (firstSlot) st.defaults = [{ start: firstSlot.start, end: firstSlot.end }];
    }

    $app.innerHTML =
      '<div class="page-head"><a href="' + (editing ? '#/e/' + esc(ev.id) : '#/') + '" class="back">‹ 戻る</a>' +
      '<h1>' + (editing ? '日程調整を編集' : '日程調整をつくる') + '</h1></div>' +
      '<form id="f" class="form" novalidate>' +
      '<section class="card"><h2 class="sec"><span class="sec-num">1</span>イベントの内容</h2>' +
      '<label class="field"><span class="lbl">イベント名 <em>必須</em></span>' +
      '<input id="title" maxlength="100" placeholder="例）忘年会、打ち合わせ" value="' + esc(editing ? ev.title : '') + '"></label>' +
      '<label class="field last"><span class="lbl">メモ（任意）</span>' +
      '<textarea id="memo" rows="3" maxlength="2000" placeholder="場所・会費・連絡事項など">' + esc(editing ? ev.memo : '') + '</textarea></label></section>' +

      '<section class="card"><h2 class="sec"><span class="sec-num">2</span>候補の日付を選ぶ</h2>' +
      '<p class="hint">日付をタップで選択／もう一度タップで解除。曜日をタップすると、その月の同じ曜日をまとめて選べます。</p>' +
      '<div id="cal" class="cal"></div></section>' +

      '<section class="card"><h2 class="sec"><span class="sec-num">3</span>時間を設定する</h2>' +
      '<div class="seg big" id="modeSeg"><button type="button" data-mode="0">日付のみ（時間なし）</button><button type="button" data-mode="1">時間を指定する</button></div>' +
      '<div id="defaults"></div>' +
      '<div id="dayList"></div></section>' +

      '<section class="card"><h2 class="sec"><span class="sec-num">4</span>その他の設定</h2>' +
      '<div class="field"><span class="lbl">自由入力の候補（任意）</span>' +
      '<div class="free-add"><input id="freeText" maxlength="60" placeholder="例）12月前半の平日夜">' +
      '<button type="button" class="btn" id="freeAdd">追加</button></div><ul id="freeList" class="cand-list"></ul></div>' +
      '<label class="field last"><span class="lbl">回答の締切（任意）</span>' +
      '<input type="date" id="deadline" value="' + esc(editing ? ev.deadline : '') + '"></label></section>' +

      '<section class="card summary"><div class="sum-head"><h2>候補の一覧 <span class="count" id="candCount">0件</span></h2>' +
      '<button type="button" class="link-btn" id="clearAll">すべてクリア</button></div>' +
      '<p class="hint">参加者にはこの内容で表示されます。</p>' +
      '<ol id="preview" class="preview"></ol>' +
      (editing ? '<p class="hint warn">※候補を削除・時間を変更すると、その候補へのこれまでの回答は表示されなくなります。</p>' : '') +
      '<button type="submit" class="btn primary lg block" id="submit">' + (editing ? '変更を保存する' : '作成してURLを発行する') + '</button></section>' +
      '</form>';

    var $cal = document.getElementById('cal');
    var $defaults = document.getElementById('defaults');
    var $dayList = document.getElementById('dayList');

    function sortedDates() { return Object.keys(st.days).sort(); }
    function copySlots(list) { return list.map(function (s) { return { id: '', start: s.start, end: s.end }; }); }
    function slotError(s) {
      if (!s.start) return '開始時刻を選んでください';
      if (s.end && s.end <= s.start) return '終了は開始より後にしてください';
      return '';
    }
    function dupIndex(slots) {
      var seen = {}, dup = {};
      slots.forEach(function (s, i) { var k = s.start + '-' + s.end; if (seen[k]) dup[i] = true; seen[k] = true; });
      return dup;
    }
    function slotProblem(slots, i) { return slotError(slots[i]) || (dupIndex(slots)[i] ? '同じ時間帯が重複しています' : ''); }

    function buildCandidates() {
      var out = [];
      sortedDates().forEach(function (date) {
        var d = st.days[date];
        if (!st.useTime || !d.slots.length) {
          out.push({ id: d.alldayId, date: date, start: '', end: '', label: '' });
          return;
        }
        d.slots.forEach(function (s, i) {
          if (!slotProblem(d.slots, i)) out.push({ id: s.id, date: date, start: s.start, end: s.end, label: '' });
        });
      });
      out = sortCands(out);
      st.free.forEach(function (f) { out.push({ id: f.id, date: '', start: '', end: '', label: f.label }); });
      return out;
    }
    function countErrors() {
      if (!st.useTime) return 0;
      var n = 0;
      sortedDates().forEach(function (date) {
        var slots = st.days[date].slots;
        slots.forEach(function (s, i) { if (slotProblem(slots, i)) n++; });
      });
      return n;
    }

    function timeSelect(value, allowEmpty) {
      var h = value ? value.slice(0, 2) : '', m = value ? value.slice(3, 5) : '';
      var hs = '<select class="ts-h" aria-label="時">' + (allowEmpty ? '<option value="">--</option>' : '');
      for (var i = 0; i < 24; i++) hs += '<option' + (pad(i) === h ? ' selected' : '') + '>' + pad(i) + '</option>';
      hs += '</select>';
      var ms = '<select class="ts-m" aria-label="分"' + (allowEmpty && !value ? ' disabled' : '') + '>';
      for (var j = 0; j < 60; j += 30) ms += '<option' + (pad(j) === m ? ' selected' : '') + '>' + pad(j) + '</option>';
      ms += '</select>';
      return '<span class="ts">' + hs + '<b>:</b>' + ms + '</span>';
    }
    function readTime(wrap) {
      var h = wrap.querySelector('.ts-h').value, m = wrap.querySelector('.ts-m').value;
      return h ? h + ':' + (m || '00') : '';
    }
    function slotRow(s, attrs, err) {
      return '<div class="slot' + (err ? ' bad' : '') + '" ' + attrs + '>' +
        '<span class="ts-wrap" data-k="start">' + timeSelect(s.start, false) + '</span><span class="tilde">〜</span>' +
        '<span class="ts-wrap" data-k="end">' + timeSelect(s.end, true) + '</span>' +
        '<button type="button" class="icon-btn" data-act="del" title="この時間帯を削除">×</button>' +
        (err ? '<div class="slot-err">' + esc(err) + '</div>' : '') + '</div>';
    }
    function bindSlotRows(root, getList, after) {
      root.querySelectorAll('.slot').forEach(function (row) {
        var list = getList(row);
        var i = +row.getAttribute('data-i');
        row.querySelectorAll('.ts-wrap').forEach(function (w) {
          w.querySelectorAll('select').forEach(function (sel) {
            sel.onchange = function () { list[i][w.getAttribute('data-k')] = readTime(w); if ('id' in list[i]) list[i].id = ''; after(); };
          });
        });
        row.querySelector('[data-act="del"]').onclick = function () { list.splice(i, 1); after(); };
      });
    }

    function renderCal() {
      var m = st.month;
      var first = new Date(m.getFullYear(), m.getMonth(), 1);
      var start = new Date(first); start.setDate(1 - first.getDay());
      var html = '<div class="cal-head"><button type="button" class="nav-btn" id="prevM" aria-label="前の月">‹</button>' +
        '<b>' + m.getFullYear() + '年 ' + (m.getMonth() + 1) + '月</b>' +
        '<button type="button" class="nav-btn" id="nextM" aria-label="次の月">›</button></div><div class="cal-grid">';
      WD.forEach(function (w, i) {
        html += '<button type="button" class="wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '" data-wd="' + i + '" title="' + w + '曜日をまとめて選択">' + w + '</button>';
      });
      for (var i = 0; i < 42; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        if (i >= 35 && d.getMonth() !== m.getMonth()) break;
        var key = ymd(d);
        var cls = ['day'];
        if (d.getMonth() !== m.getMonth()) cls.push('other');
        if (key === today) cls.push('today');
        if (st.days[key]) cls.push('on');
        if (d.getDay() === 0) cls.push('sun');
        if (d.getDay() === 6) cls.push('sat');
        var past = key < today;
        if (past) cls.push('past');
        var n = st.days[key] && st.useTime ? st.days[key].slots.length : 0;
        html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + key + '"' + (past ? ' disabled' : '') +
          ' aria-pressed="' + (st.days[key] ? 'true' : 'false') + '"><span>' + d.getDate() + '</span>' +
          (n > 1 ? '<i>' + n + '枠</i>' : '') + '</button>';
      }
      $cal.innerHTML = html + '</div><div class="cal-legend"><span><span class="lg on"></span>選択中</span><span><span class="lg today"></span>今日</span>' +
        '<span class="sel-n">選択中：<b>' + sortedDates().length + '日</b></span></div>';
      document.getElementById('prevM').onclick = function () { st.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderCal(); };
      document.getElementById('nextM').onclick = function () { st.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderCal(); };
      $cal.querySelectorAll('[data-date]').forEach(function (b) {
        b.onclick = function () { toggleDate(b.getAttribute('data-date')); };
      });
      $cal.querySelectorAll('[data-wd]').forEach(function (b) {
        b.onclick = function () { toggleWeekday(+b.getAttribute('data-wd')); };
      });
    }

    function addDate(date) { if (!st.days[date]) st.days[date] = { alldayId: '', slots: copySlots(st.defaults) }; }
    function toggleDate(date) {
      if (st.days[date]) delete st.days[date]; else addDate(date);
      renderAll();
    }
    function toggleWeekday(wd) {
      var m = st.month, dates = [];
      for (var d = new Date(m.getFullYear(), m.getMonth(), 1); d.getMonth() === m.getMonth(); d.setDate(d.getDate() + 1)) {
        if (d.getDay() === wd && ymd(d) >= today) dates.push(ymd(d));
      }
      if (!dates.length) return;
      var allOn = dates.every(function (k) { return st.days[k]; });
      dates.forEach(function (k) { if (allOn) delete st.days[k]; else addDate(k); });
      renderAll();
    }

    function renderMode() {
      document.querySelectorAll('#modeSeg button').forEach(function (b) {
        b.classList.toggle('on', +b.getAttribute('data-mode') === (st.useTime ? 1 : 0));
      });
    }

    function renderDefaults() {
      if (!st.useTime) { $defaults.innerHTML = ''; return; }
      $defaults.innerHTML = '<div class="defaults"><div class="def-head"><b>基本の時間帯</b><span class="hint">これから選ぶ日付に自動で入ります</span></div>' +
        st.defaults.map(function (s, i) { return slotRow(s, 'data-i="' + i + '"', slotProblem(st.defaults, i)); }).join('') +
        '<div class="def-actions"><button type="button" class="link-btn" id="addDef">＋ 時間帯を追加</button>' +
        '<button type="button" class="btn sm" id="applyAll"' + (sortedDates().length ? '' : ' disabled') + '>選択中の全日付をこの時間にする</button></div></div>';
      bindSlotRows($defaults, function () { return st.defaults; }, function () {
        if (!st.defaults.length) st.defaults.push({ start: '19:00', end: '21:00' });
        renderDefaults();
      });
      document.getElementById('addDef').onclick = function () {
        var last = st.defaults[st.defaults.length - 1] || { start: '12:00', end: '13:00' };
        st.defaults.push({ start: last.start, end: last.end });
        renderDefaults();
      };
      document.getElementById('applyAll').onclick = function () {
        if (st.defaults.some(function (s, i) { return slotProblem(st.defaults, i); })) { toast('基本の時間帯にエラーがあります', true); return; }
        var dates = sortedDates();
        confirmDialog('選択中の ' + dates.length + ' 日すべての時間帯を、基本の時間帯で置き換えますか？', '置き換える').then(function (ok) {
          if (!ok) return;
          dates.forEach(function (k) { st.days[k].slots = copySlots(st.defaults); });
          renderAll();
          toast('全日付に反映しました');
        });
      };
    }

    function renderDayList() {
      var dates = sortedDates();
      if (!dates.length) {
        $dayList.innerHTML = '<p class="empty-box">②のカレンダーで日付を選ぶと、ここに日付ごとの時間が表示されます。</p>';
        return;
      }
      $dayList.innerHTML = '<div class="day-list-head">日付ごとの時間（個別に変更できます）</div>' + dates.map(function (date) {
        var d = st.days[date];
        var body;
        if (!st.useTime) {
          body = '<span class="allday">時間指定なし</span>';
        } else {
          body = (d.slots.length ? d.slots.map(function (s, i) {
            return slotRow(s, 'data-date="' + date + '" data-i="' + i + '"', slotProblem(d.slots, i));
          }).join('') : '<span class="allday">時間帯なし（日付のみの候補になります）</span>') +
            '<button type="button" class="link-btn" data-add-slot="' + date + '">＋ 時間帯を追加</button>';
        }
        return '<div class="day-card"><div class="day-card-head"><b class="' + candCls({ date: date }) + '">' + esc(fmtDate(date)) + '</b>' +
          '<button type="button" class="link-btn danger-text" data-del-date="' + date + '">この日を外す</button></div>' + body + '</div>';
      }).join('');
      bindSlotRows($dayList, function (row) { return st.days[row.getAttribute('data-date')].slots; }, renderAll);
      $dayList.querySelectorAll('[data-add-slot]').forEach(function (b) {
        b.onclick = function () {
          var slots = st.days[b.getAttribute('data-add-slot')].slots;
          var last = slots[slots.length - 1] || st.defaults[0] || { start: '12:00', end: '13:00' };
          slots.push({ id: '', start: last.start, end: last.end });
          renderAll();
        };
      });
      $dayList.querySelectorAll('[data-del-date]').forEach(function (b) {
        b.onclick = function () { delete st.days[b.getAttribute('data-del-date')]; renderAll(); };
      });
    }

    function renderFree() {
      var $fl = document.getElementById('freeList');
      $fl.innerHTML = st.free.map(function (f, i) {
        return '<li><span>' + esc(f.label) + '</span><button type="button" class="icon-btn" data-del-free="' + i + '" title="削除">×</button></li>';
      }).join('');
      $fl.style.display = st.free.length ? '' : 'none';
      $fl.querySelectorAll('[data-del-free]').forEach(function (b) {
        b.onclick = function () { st.free.splice(+b.getAttribute('data-del-free'), 1); renderFree(); renderPreview(); };
      });
    }

    function renderPreview() {
      var list = buildCandidates();
      var errs = countErrors();
      document.getElementById('candCount').textContent = list.length + '件';
      var $p = document.getElementById('preview');
      $p.innerHTML = list.length ? list.map(function (c) {
        return '<li class="' + candCls(c) + '">' + esc(fmtCand(c)) + '</li>';
      }).join('') : '<li class="none">まだ候補がありません</li>';
      if (errs) $p.insertAdjacentHTML('beforeend', '<li class="none err-text">※ 入力エラーのある時間帯 ' + errs + ' 件は含まれていません</li>');
    }

    function renderAll() { renderCal(); renderMode(); renderDefaults(); renderDayList(); renderFree(); renderPreview(); }

    document.querySelectorAll('#modeSeg button').forEach(function (b) {
      b.onclick = function () {
        st.useTime = b.getAttribute('data-mode') === '1';
        if (st.useTime) sortedDates().forEach(function (k) { if (!st.days[k].slots.length) st.days[k].slots = copySlots(st.defaults); });
        renderAll();
      };
    });
    document.getElementById('clearAll').onclick = function () {
      confirmDialog('選択した日付と自由入力の候補をすべてクリアしますか？', 'クリアする', true).then(function (ok) {
        if (ok) { st.days = {}; st.free = []; renderAll(); }
      });
    };
    var $free = document.getElementById('freeText');
    function freeAdd() {
      var v = $free.value.trim();
      if (!v) return;
      if (!st.free.some(function (f) { return f.label === v; })) st.free.push({ id: '', label: v });
      $free.value = '';
      renderFree(); renderPreview();
    }
    document.getElementById('freeAdd').onclick = freeAdd;
    $free.onkeydown = function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); freeAdd(); } };

    document.getElementById('f').onsubmit = function (e) {
      e.preventDefault();
      var title = document.getElementById('title').value.trim();
      if (!title) { toast('イベント名を入力してください', true); document.getElementById('title').focus(); return; }
      if (countErrors()) { toast('時間帯の入力エラーを直してください', true); $dayList.scrollIntoView({ behavior: 'smooth' }); return; }
      var candidates = buildCandidates();
      if (!candidates.length) { toast('候補日程を1つ以上選んでください', true); $cal.scrollIntoView({ behavior: 'smooth' }); return; }
      var payload = {
        title: title,
        memo: document.getElementById('memo').value,
        deadline: document.getElementById('deadline').value,
        candidates: candidates,
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

  /* ---------- タイムライン（30分マス）共通 ---------- */
  function idxTime(i) { return pad(Math.floor(i / 2)) + ':' + (i % 2 ? '30' : '00'); }
  function buildGrid(ev) {
    var masks = PittanCore.cellMasks(ev.candidates);
    var dates = Object.keys(masks).sort();
    var lo = 48, hi = 0;
    dates.forEach(function (d) {
      masks[d].forEach(function (on, i) { if (on) { lo = Math.min(lo, i); hi = Math.max(hi, i + 1); } });
    });
    var untimed = sortCands(ev.candidates.filter(function (c) { return !(c.date && c.start); }));
    return { dates: dates, masks: masks, lo: lo, hi: hi, untimed: untimed };
  }
  function voteAt(a, date, i) {
    var s = a.votes && a.votes[date];
    if (typeof s !== 'string') return -1;
    var ch = s.charAt(i);
    return ch >= '0' && ch <= '3' ? +ch : -1;
  }
  function voteOf(a, cid) {
    var v = a.votes ? a.votes[cid] : undefined;
    return v === 0 || v === 1 || v === 2 || v === 3 ? v : -1;
  }
  function rowRange(g, date, i) {
    // i を含む連続した候補マスの範囲
    var m = g.masks[date], s = i, e = i + 1;
    while (s > 0 && m[s - 1]) s--;
    while (e < 48 && m[e]) e++;
    return { s: s, e: e };
  }
  function gridHtml(g, cellFn, opts) {
    opts = opts || {};
    var h = '<div class="tl-wrap"><table class="tl' + (opts.cls ? ' ' + opts.cls : '') + '"><thead><tr><th class="tl-lab">' + (opts.corner || '') + '</th>';
    for (var i = g.lo; i < g.hi; i++) {
      h += '<th class="tl-h' + (i % 2 ? ' half' : '') + '" data-col="' + i + '">' + (i % 2 ? '' : '<span>' + (i / 2) + '</span>') + '</th>';
    }
    h += '</tr></thead><tbody>';
    g.dates.forEach(function (date) {
      h += '<tr><th class="tl-lab" data-row="' + date + '"><span class="' + candCls({ date: date }) + '">' + esc(fmtDate(date)) + '</span></th>';
      for (var i = g.lo; i < g.hi; i++) {
        h += g.masks[date][i] ? cellFn(date, i) : '<td class="off' + (i % 2 ? ' half' : '') + '"></td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
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

  function cellStats(answers, date, i) {
    var st = { 3: [], 2: [], 1: [], 0: [], none: [] };
    answers.forEach(function (a) { var v = voteAt(a, date, i); (v < 0 ? st.none : st[v === 3 ? 2 : v]).push(a.name); });
    return st;
  }
  function candStats(answers, cid) {
    var st = { 3: [], 2: [], 1: [], 0: [], none: [] };
    answers.forEach(function (a) { var v = voteOf(a, cid); (v < 0 ? st.none : st[v === 3 ? 2 : v]).push(a.name); });
    return st;
  }
  function bestSlots(g, answers) {
    var runs = [];
    var key = function (st) { return st[3].length + '/' + st[2].length + '/' + st[1].length; };
    g.dates.forEach(function (date) {
      var cur = null;
      for (var i = 0; i <= 48; i++) {
        var on = i < 48 && g.masks[date][i];
        var st = on ? cellStats(answers, date, i) : null;
        if (cur && (!on || key(st) !== cur.key)) { runs.push(cur); cur = null; }
        if (on && !cur) cur = { date: date, s: i, e: i + 1, st: st, key: key(st) };
        else if (on) cur.e = i + 1;
      }
    });
    g.untimed.forEach(function (c) { runs.push({ cand: c, st: candStats(answers, c.id) }); });
    runs.forEach(function (r) { r.ok = r.st[3].length + r.st[2].length; });
    return runs.filter(function (r) { return r.ok > 0; }).sort(function (a, b) {
      return b.ok - a.ok || b.st[3].length - a.st[3].length || b.st[1].length - a.st[1].length ||
        ((b.e - b.s) || 0) - ((a.e - a.s) || 0) || ((a.date || '') < (b.date || '') ? -1 : 1);
    }).slice(0, 5);
  }
  function runLabel(r) {
    if (r.cand) return fmtCand(r.cand);
    return fmtDate(r.date) + ' ' + idxTime(r.s) + '〜' + idxTime(r.e);
  }
  function runConfirmed(r) {
    if (r.cand) return r.cand.date ? { date: r.cand.date } : { label: r.cand.label };
    return { date: r.date, start: idxTime(r.s), end: idxTime(r.e) };
  }
  function namesLine(st) {
    return MARKS.map(function (m) {
      return st[m.v].length ? '<span class="nm ' + m.cls + '"><b>' + m.sym + ' ' + m.name + '</b> ' + st[m.v].map(esc).join('、') + '</span>' : '';
    }).join('') + (st.none.length ? '<span class="nm none"><b>未回答</b> ' + st.none.map(esc).join('、') + '</span>' : '');
  }
  function isFixedCell(ev, date, i) {
    var c = ev.confirmed;
    if (!c || c.date !== date) return false;
    if (!c.start) return true;
    var a = PittanCore.toIdx(c.start), b = c.end ? PittanCore.toEndIdx(c.end) : a + 1;
    return i >= a && i < b;
  }

  function rangeDialog(g, date, s, e) {
    var r = rowRange(g, date, s);
    return new Promise(function (resolve) {
      var opt = function (from, to, sel) {
        var h = '';
        for (var i = from; i <= to; i++) h += '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + idxTime(i) + '</option>';
        return h;
      };
      var wrap = document.createElement('div');
      wrap.className = 'modal-bg';
      wrap.innerHTML = '<div class="modal"><h2>この時間で決定しますか？</h2><p><b>' + esc(fmtDate(date)) + '</b></p>' +
        '<div class="slot"><span class="ts"><select id="rdS">' + opt(r.s, r.e - 1, s) + '</select></span><span class="tilde">〜</span>' +
        '<span class="ts"><select id="rdE">' + opt(r.s + 1, r.e, e) + '</select></span></div>' +
        '<p class="hint">参加者のページに「決定」として表示されます。</p><div class="row end">' +
        '<button class="btn ghost" data-r="0">キャンセル</button><button class="btn primary" data-r="1">決定する</button></div></div>';
      wrap.addEventListener('click', function (ev) {
        var k = ev.target.getAttribute('data-r');
        if (ev.target !== wrap && k === null) return;
        var ss = +wrap.querySelector('#rdS').value, ee = +wrap.querySelector('#rdE').value;
        if (k === '1' && ee <= ss) { toast('終了は開始より後にしてください', true); return; }
        document.body.removeChild(wrap);
        resolve(k === '1' ? { date: date, start: idxTime(ss), end: idxTime(ee) } : null);
      });
      document.body.appendChild(wrap);
    });
  }

  function renderEvent(res, token, opts) {
    var ev = res.event;
    var answers = res.answers;
    var isAdmin = !!token;
    var mine = Mem.mine(ev.id);
    var g = buildGrid(ev);
    var confirmed = ev.confirmed || null;
    var expired = ev.deadline && ev.deadline < todayYmd();
    var closed = ev.closed || expired;
    var total = answers.length;
    document.title = ev.title + '｜ぴったん';

    var html = '';
    if (res.apiVersion !== 2) {
      html += '<div class="card warn-box">サーバー（Apps Script）が古いバージョンです。README の「サーバー側のコードを更新したとき」の手順で更新してください。更新するまで時間帯の回答が保存されません。</div>';
    }
    if (confirmed) {
      html += '<div class="confirmed"><div class="c-label">日程が決まりました</div><div class="c-date">' + esc(fmtCand(confirmed)) + '</div>' +
        (confirmed.date ? '<div class="share-btns center"><a class="btn" target="_blank" rel="noopener" href="' + esc(gcalUrl(ev, confirmed)) + '">Googleカレンダーに追加</a>' +
          '<button class="btn ghost" id="ics">カレンダー用ファイル(.ics)</button></div>' : '') + '</div>';
    }
    html += '<div class="card ev-head"><h1>' + esc(ev.title) + '</h1>' +
      (ev.memo ? '<div class="memo">' + linkify(ev.memo) + '</div>' : '') +
      '<div class="meta"><span>回答 ' + total + '人</span>' +
      (ev.deadline ? '<span>締切 ' + esc(fmtDate(ev.deadline)) + (expired ? '（終了）' : '') + '</span>' : '') +
      (ev.closed ? '<span class="chip gray">受付終了</span>' : '') +
      (isAdmin ? '<span class="chip">幹事</span>' : '') + '</div></div>';

    // 回答ボタン（上に置く）
    if (closed && !isAdmin) {
      html += '<div class="card center closed-msg">' + (ev.closed ? 'この日程調整は回答の受付を終了しました。' : '回答の締切を過ぎています。') + '</div>';
    } else {
      html += '<div id="answerArea"><button class="btn primary lg block" id="openAnswer">出欠を入力する</button></div>';
    }

    // おすすめ
    var best = bestSlots(g, answers);
    if (best.length) {
      html += '<div class="card"><h2>みんなの都合がいい時間</h2><ol class="best">' + best.map(function (r, k) {
        return '<li><div class="best-main"><b>' + esc(runLabel(r)) + '</b>' +
          (confirmed && JSON.stringify(runConfirmed(r)) === JSON.stringify({ date: confirmed.date, start: confirmed.start, end: confirmed.end }) ? '<span class="tag">決定</span>' : '') +
          '<span class="best-n"><span class="yes">○ ' + r.ok + '人</span>' +
          (r.st[1].length ? '<span class="maybe">△ ' + r.st[1].length + '</span>' : '') + '<span class="of">/ ' + total + '人</span></span></div>' +
          (isAdmin ? '<button class="mini-btn" data-best="' + k + '">この時間で決定</button>' : '') + '</li>';
      }).join('') + '</ol><p class="hint">○の人数が多い順です。</p></div>';
    }

    // みんなの回答：日付ごとに「○の人数」行＋参加者ごとの行
    html += '<div class="card"><div class="table-head"><h2>みんなの回答</h2></div>';
    if (g.dates.length) {
      var maxOk = 0;
      g.dates.forEach(function (d) {
        for (var i = g.lo; i < g.hi; i++) if (g.masks[d][i]) { var s0 = cellStats(answers, d, i); maxOk = Math.max(maxOk, s0[3].length + s0[2].length); }
      });
      var off = function (i) { return '<td class="off' + (i % 2 ? ' half' : '') + '"></td>'; };
      html += '<div class="tl-wrap"><table class="tl result-tl matrix">';
      g.dates.forEach(function (date) {
        html += '<tbody class="day-group"><tr class="day-head"><th class="tl-lab"><span class="' + candCls({ date: date }) + '">' + esc(fmtDate(date)) + '</span></th>';
        for (var i = g.lo; i < g.hi; i++) html += '<th class="tl-h' + (i % 2 ? ' half' : '') + '">' + (i % 2 ? '' : '<span>' + (i / 2) + '</span>') + '</th>';
        html += '</tr><tr class="sum-row"><th class="tl-lab"><small>○の人数</small></th>';
        for (var j = g.lo; j < g.hi; j++) {
          if (!g.masks[date][j]) { html += off(j); continue; }
          var st = cellStats(answers, date, j);
          var okN = st[3].length + st[2].length;
          var ratio = total ? okN / total : 0;
          var bg = okN ? 'background:rgba(20,163,139,' + (0.15 + 0.8 * ratio).toFixed(2) + ');' + (ratio > 0.55 ? 'color:#fff;' : '') : '';
          html += '<td class="cell hm' + (j % 2 ? ' half' : '') + (isFixedCell(ev, date, j) ? ' fixed' : '') + (okN && okN === maxOk ? ' top' : '') +
            '" style="' + bg + '" data-d="' + date + '" data-i="' + j + '">' + okN + '</td>';
        }
        html += '</tr>';
        answers.forEach(function (a) {
          html += '<tr class="p-row"><th class="tl-lab pname"><button class="pn' + (mine.indexOf(a.id) >= 0 ? ' me' : '') + '" data-edit="' + esc(a.id) + '" title="タップで回答を修正">' + esc(a.name) + '</button></th>';
          for (var k = g.lo; k < g.hi; k++) {
            if (!g.masks[date][k]) { html += off(k); continue; }
            var v = voteAt(a, date, k);
            var m = v < 0 ? null : MK[v];
            html += '<td class="cell ' + (m ? m.cls : 'none') + (k % 2 ? ' half' : '') + '" data-d="' + date + '" data-i="' + k + '">' + (m ? m.sym : '') + '</td>';
          }
          html += '</tr>';
        });
        html += '</tbody>';
      });
      html += '</table></div>';
      html += '<div class="tl-legend">' + MARKS.map(function (m) { return '<span><span class="sw ' + m.cls + '">' + m.sym + '</span>' + m.name + '</span>'; }).join('') +
        '<span><span class="sw top"></span>○が最多</span>' + (confirmed ? '<span><span class="sw fixed"></span>決定</span>' : '') + '</div>';
      html += '<div id="cellInfo" class="cell-info hint">マスをタップすると、その時間の○△×の内訳が表示されます。名前をタップすると回答を修正できます。</div>';
    }
    if (g.untimed.length) {
      html += '<table class="result untimed"><tbody>' + g.untimed.map(function (c) {
        var st = candStats(answers, c.id);
        var isFix = confirmed && ((c.date && confirmed.date === c.date && !confirmed.start) || (!c.date && confirmed.label === c.label));
        return '<tr' + (isFix ? ' class="fixed"' : '') + '><th class="' + candCls(c) + '">' + esc(fmtCand(c)) + (isFix ? '<span class="tag">決定</span>' : '') + '</th><td>' + namesLine(st) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    html += (answers.length ? '' : '<p class="empty">まだ回答がありません。最初の回答をどうぞ！</p>') +
      '<div class="row end"><button class="link-btn" id="reload">↻ 最新の状態に更新</button></div></div>';

    var withComment = answers.filter(function (a) { return a.comment; });
    if (withComment.length) {
      html += '<div class="card"><h2>コメント</h2><ul class="comments">' + withComment.map(function (a) {
        return '<li><b>' + esc(a.name) + '</b><p>' + linkify(a.comment) + '</p></li>';
      }).join('') + '</ul></div>';
    }

    if (isAdmin) {
      html += '<div class="card admin"><h2>幹事メニュー</h2><div class="admin-btns">' +
        '<a class="btn" href="#/e/' + esc(ev.id) + '/edit">候補・内容を編集</a>' +
        '<button class="btn" id="toggleClose">' + (ev.closed ? '回答の受付を再開' : '回答の受付を終了') + '</button>' +
        (confirmed ? '<button class="btn" id="unconfirm">決定を取り消す</button>' : '') +
        '<button class="btn" id="copyAdmin">幹事用URLをコピー</button>' +
        '<button class="btn danger-ghost" id="removeEv">削除</button></div>' +
        '<p class="hint">日程の決定は「みんなの都合がいい時間」の「この時間で決定」か、集計のマスをタップして行えます。</p></div>';
    }

    html += '<div class="card">' + shareBox(eventUrl(ev.id), 'このページのURLを共有', ev) + '</div>';
    $app.innerHTML = html;
    bindShare($app);

    var reload = function () { eventView(ev.id, {}); };
    var doConfirm = function (c) {
      return Api.call('confirm', { id: ev.id, adminToken: token, confirmed: c }).then(function () {
        toast(c ? '日程を決定しました' : '決定を取り消しました'); reload();
      }, function (e) { toast(e.message, true); });
    };

    document.getElementById('reload').onclick = reload;
    var icsBtn = document.getElementById('ics');
    if (icsBtn) icsBtn.onclick = function () { downloadIcs(ev, confirmed); };

    $app.querySelectorAll('.result-tl td.cell').forEach(function (td) {
      td.onclick = function () {
        var date = td.getAttribute('data-d'), i = +td.getAttribute('data-i');
        $app.querySelectorAll('.result-tl td.sel').forEach(function (x) { x.classList.remove('sel'); });
        td.classList.add('sel');
        var info = document.getElementById('cellInfo');
        info.className = 'cell-info';
        info.innerHTML = '<b>' + esc(fmtDate(date)) + ' ' + idxTime(i) + '〜' + idxTime(i + 1) + '</b><div>' + namesLine(cellStats(answers, date, i)) + '</div>' +
          (isAdmin ? '<button class="mini-btn" id="cellConfirm">この時間帯で決定…</button>' : '');
        var cb = document.getElementById('cellConfirm');
        if (cb) cb.onclick = function () {
          rangeDialog(g, date, i, i + 1).then(function (c) { if (c) doConfirm(c); });
        };
      };
    });

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
      $app.querySelectorAll('[data-best]').forEach(function (b) {
        b.onclick = function () {
          var r = best[+b.getAttribute('data-best')];
          if (r.cand) {
            confirmDialog('「' + runLabel(r) + '」に決定しますか？\n参加者のページにも表示されます。', '決定する').then(function (ok) { if (ok) doConfirm(runConfirmed(r)); });
          } else {
            rangeDialog(g, r.date, r.s, r.e).then(function (c) { if (c) doConfirm(c); });
          }
        };
      });
      var act = function (action, params, msg) {
        return Api.call(action, Object.assign({ id: ev.id, adminToken: token }, params)).then(function () {
          toast(msg); reload();
        }, function (e) { toast(e.message, true); });
      };
      var un = document.getElementById('unconfirm');
      if (un) un.onclick = function () { doConfirm(null); };
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

  /* ---------- 回答フォーム（ドラッグで塗る） ---------- */
  function answerForm(ev, existing, token, onDone) {
    var area = document.getElementById('answerArea');
    if (!area) return;
    var g = buildGrid(ev);
    // cells[date][i] / un[cid] = 0..2。最初はすべて○（参加可）で、都合の悪い所だけ×や△にしてもらう
    var norm = function (v) { return v < 0 || v === 3 ? 2 : v; };
    var cells = {}, un = {};
    g.dates.forEach(function (d) {
      cells[d] = [];
      for (var i = 0; i < 48; i++) cells[d][i] = norm(existing ? voteAt(existing, d, i) : -1);
    });
    g.untimed.forEach(function (c) { un[c.id] = norm(existing ? voteOf(existing, c.id) : -1); });
    var mode = 0;

    var palette = '<div class="palette" id="palette">' + MARKS.map(function (m) {
      return '<button type="button" class="pal ' + m.cls + '" data-mode="' + m.v + '"><span>' + m.sym + '</span>' + m.name + '</button>';
    }).join('') + '</div>';

    area.innerHTML = '<form class="card answer" id="af" novalidate><h2>' + (existing ? esc(existing.name) + ' さんの回答を修正' : '出欠を入力') + '</h2>' +
      '<label class="field"><span class="lbl">お名前 <em>必須</em></span><input id="aName" maxlength="40" value="' + esc(existing ? existing.name : Mem.name()) + '" placeholder="例）山田"></label>' +
      '<div class="field"><span class="lbl">都合の悪い時間を × にしてください</span>' +
      '<p class="hint">最初はすべて <b class="c-yes">○（参加可）</b> になっています。① 下のボタンで ×（または △・○）を選ぶ → ② マスをなぞる（ドラッグ）とまとめて変わります。日付や時刻の見出しをタップすると、その行・列をまとめて変えられます。</p>' +
      '<div class="palette-wrap">' + palette + '</div>' +
      (g.dates.length ? gridHtml(g, function (date, i) {
        var v = cells[date][i];
        return '<td class="cell ' + (v < 0 ? 'none' : MK[v].cls) + (i % 2 ? ' half' : '') + '" data-d="' + date + '" data-i="' + i + '">' + (v < 0 ? '' : MK[v].sym) + '</td>';
      }, { cls: 'paint', corner: '<span class="hint">時</span>' }) : '') +
      (g.untimed.length ? '<ul class="vote-list">' + g.untimed.map(function (c) {
        return '<li><span class="vl ' + candCls(c) + '">' + esc(fmtCand(c)) + '</span><span class="seg vote" data-cid="' + esc(c.id) + '">' +
          MARKS.map(function (m) { return '<button type="button" class="' + m.cls + '" data-v="' + m.v + '" aria-label="' + m.name + '">' + m.sym + '</button>'; }).join('') +
          '</span></li>';
      }).join('') + '</ul>' : '') +
      '<div class="row end"><button type="button" class="link-btn" id="resetYes">すべて○に戻す</button></div></div>' +
      '<label class="field"><span class="lbl">コメント（任意）</span><textarea id="aComment" rows="2" maxlength="500" placeholder="例）19時以降なら参加できます">' + esc(existing ? existing.comment : '') + '</textarea></label>' +
      '<button type="submit" class="btn primary lg block" id="aSubmit">' + (existing ? '回答を更新する' : '回答する') + '</button>' +
      '<div class="row between"><button type="button" class="link-btn" id="aCancel">キャンセル</button>' +
      (existing ? '<button type="button" class="link-btn danger-text" id="aDelete">この回答を削除</button>' : '') + '</div></form>';

    var table = area.querySelector('table.tl');

    function paintTd(td, v) {
      var d = td.getAttribute('data-d'), i = +td.getAttribute('data-i');
      cells[d][i] = v;
      td.className = 'cell ' + (v < 0 ? 'none' : MK[v].cls) + (i % 2 ? ' half' : '');
      td.textContent = v < 0 ? '' : MK[v].sym;
    }
    function paintUntimed() {
      area.querySelectorAll('.seg.vote').forEach(function (seg) {
        var cid = seg.getAttribute('data-cid');
        seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', un[cid] === +b.getAttribute('data-v')); });
      });
    }
    function setMode(m) {
      mode = m;
      area.querySelectorAll('.pal').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === String(m)); });
    }
    area.querySelectorAll('.pal').forEach(function (b) {
      b.onclick = function () { setMode(+b.getAttribute('data-mode')); };
    });

    if (table) {
      var painting = false;
      var cellFromPoint = function (x, y) {
        var el = document.elementFromPoint(x, y);
        return el && el.closest ? el.closest('table.paint td.cell') : null;
      };
      table.addEventListener('pointerdown', function (e) {
        if (mode === 'move') return;
        var td = e.target.closest('td.cell');
        if (!td) return;
        e.preventDefault();
        painting = true;
        paintTd(td, mode);
      });
      document.addEventListener('pointermove', function onMove(e) {
        if (!document.body.contains(table)) { document.removeEventListener('pointermove', onMove); return; }
        if (!painting) return;
        var td = cellFromPoint(e.clientX, e.clientY);
        if (td) paintTd(td, mode);
      });
      var stop = function () { painting = false; };
      document.addEventListener('pointerup', stop);
      document.addEventListener('pointercancel', stop);
      // 見出しで行・列をまとめて塗る
      table.querySelectorAll('th.tl-lab[data-row]').forEach(function (th) {
        th.onclick = function () {
          if (mode === 'move') return;
          table.querySelectorAll('td.cell[data-d="' + th.getAttribute('data-row') + '"]').forEach(function (td) { paintTd(td, mode); });
         
        };
      });
      table.querySelectorAll('th.tl-h').forEach(function (th) {
        th.onclick = function () {
          if (mode === 'move') return;
          table.querySelectorAll('td.cell[data-i="' + th.getAttribute('data-col') + '"]').forEach(function (td) { paintTd(td, mode); });
         
        };
      });
    }
    area.querySelectorAll('.seg.vote button').forEach(function (b) {
      b.onclick = function () { un[b.parentNode.getAttribute('data-cid')] = +b.getAttribute('data-v'); paintUntimed(); };
    });
    document.getElementById('resetYes').onclick = function () {
      area.querySelectorAll('table.paint td.cell').forEach(function (td) { paintTd(td, 2); });
      g.untimed.forEach(function (c) { un[c.id] = 2; });
      paintUntimed();
    };
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

    function payloadVotes() {
      var votes = {};
      g.dates.forEach(function (d) {
        var s = '';
        for (var i = 0; i < 48; i++) s += cells[d][i] < 0 ? '-' : String(cells[d][i]);
        if (/[0-3]/.test(s)) votes[d] = s;
      });
      g.untimed.forEach(function (c) { if (un[c.id] >= 0) votes[c.id] = un[c.id]; });
      return votes;
    }
    document.getElementById('af').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('aName').value.trim();
      if (!name) { toast('お名前を入力してください', true); document.getElementById('aName').focus(); return; }
      var go = function () {
        var btn = document.getElementById('aSubmit');
        busy(btn, true);
        Api.call('answer', {
          id: ev.id,
          adminToken: token || undefined,
          answer: { id: existing ? existing.id : undefined, name: name, comment: document.getElementById('aComment').value, votes: payloadVotes() },
        }).then(function (r) {
          Mem.addMine(ev.id, r.answer.id);
          if (!existing) Mem.setName(name);
          toast(existing ? '回答を更新しました' : '回答しました。ありがとうございます！');
          onDone();
        }, function (err) { busy(btn, false); toast(err.message, true); });
      };
      go();
    };

    setMode(0);
    paintUntimed();
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
      'UID:' + ev.id + '-' + (c.date || '') + (c.start || '').replace(':', '') + '@pittan', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
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
