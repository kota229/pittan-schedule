// node test/crypto.test.js — エンドツーエンド暗号化（docs/js/secure.js）と、それを受ける Code.gs の検証
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const { makeGas } = require('./gas-harness');

// ブラウザ側コード（core.js + secure.js）を Node の Web Crypto で動かす
const browser = { crypto: globalThis.crypto, TextEncoder, TextDecoder, console };
vm.createContext(browser);
for (const f of ['core.js', 'secure.js']) vm.runInContext(fs.readFileSync(__dirname + '/../docs/js/' + f, 'utf8'), browser);
const S = browser.PittanSecure;

// サーバー（Code.gs）につなぎ、送信ペイロードを fetch と同じ形（JSON 文字列）で記録する
function connect(gas) {
  const sent = [];
  const call = (action, params) => {
    const body = JSON.stringify(Object.assign({ action }, params || {}));
    sent.push(body);
    const r = gas.post(JSON.parse(body));
    return r.ok ? Promise.resolve(r.data) : Promise.reject(new Error(r.error));
  };
  return { sent, call, repo: () => S.createRepo(call, { today: () => '2026-11-02' }) };
}
// vm 内のオブジェクトは別レルムなので JSON を通して比較する
const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const rejects = (p, re) => p.then(() => assert.fail('expected rejection'), e => assert.match(e.message, re));
const URL_ERR = /URLが不完全か、正しくありません/;

(async () => {
  /* ---------- base64url ---------- */
  for (let n = 0; n < 40; n++) {
    const b = globalThis.crypto.getRandomValues(new Uint8Array(n));
    const s = S.b64urlEncode(b);
    assert.strictEqual(s, Buffer.from(b).toString('base64url'));
    assert.deepStrictEqual(Buffer.from(S.b64urlDecode(s)), Buffer.from(b));
  }

  /* ---------- 鍵 ---------- */
  const k1s = S.generateKeyString();
  assert.match(k1s, /^[A-Za-z0-9_-]{22}$/);
  assert.strictEqual(Buffer.from(k1s, 'base64url').length, 16); // 128bit
  assert.notStrictEqual(k1s, S.generateKeyString());
  assert.ok(S.isKeyString(k1s));
  for (const bad of ['', 'abc', k1s + 'A', k1s.slice(1), 'A'.repeat(21) + '!', null, undefined]) assert.ok(!S.isKeyString(bad));
  await rejects(S.importKey('short'), URL_ERR);
  const k1 = await S.importKey(k1s);
  const k2 = await S.importKey(S.generateKeyString());

  /* ---------- 暗号化→復号の往復 ---------- */
  const obj = { title: '忘年会🎉', memo: '場所は\n新宿', n: [1, 2, 3] };
  const ct = await S.encrypt(k1, obj, S.AAD_EVENT);
  assert.match(ct, /^[A-Za-z0-9_-]+$/);
  assert.ok(!ct.includes('忘年会') && !Buffer.from(ct, 'base64url').toString('utf8').includes('新宿'));
  same(await S.decrypt(k1, ct, S.AAD_EVENT), obj);

  /* ---------- IV は毎回ランダム（再利用なし） ---------- */
  const ivs = new Set(), cts = new Set();
  for (let i = 0; i < 300; i++) {
    const c = await S.encrypt(k1, obj, S.AAD_EVENT);
    ivs.add(Buffer.from(c, 'base64url').subarray(0, 12).toString('hex'));
    cts.add(c);
  }
  assert.strictEqual(ivs.size, 300);
  assert.strictEqual(cts.size, 300);

  /* ---------- 鍵違い・改ざん・AAD違い・形式不正の検出 ---------- */
  await rejects(S.decrypt(k2, ct, S.AAD_EVENT), URL_ERR);
  await rejects(S.decrypt(k1, ct, S.aadAnswer('aXXXXXXXXXX')), URL_ERR);
  const raw = Buffer.from(ct, 'base64url');
  for (const pos of [0, 11, 12, raw.length - 17, raw.length - 1]) { // IV・本文・認証タグのそれぞれを1ビット反転
    const t = Buffer.from(raw); t[pos] ^= 1;
    await rejects(S.decrypt(k1, t.toString('base64url'), S.AAD_EVENT), URL_ERR);
  }
  await rejects(S.decrypt(k1, raw.subarray(0, raw.length - 1).toString('base64url'), S.AAD_EVENT), URL_ERR);
  await rejects(S.decrypt(k1, 'AAAA', S.AAD_EVENT), URL_ERR);
  await rejects(S.decrypt(k1, '!!!', S.AAD_EVENT), URL_ERR);
  // エラーメッセージに鍵や中身を含めない
  try { await S.decrypt(k2, ct, S.AAD_EVENT); } catch (e) { assert.ok(!e.message.includes(k1s) && !e.message.includes('忘年会')); }

  /* ---------- 削除してよい日付（平文） ---------- */
  assert.strictEqual(S.deleteAfter({ candidates: [{ date: '2026-12-01' }, { date: '2026-12-24' }, { label: 'x' }], deadline: '' }, '2026-11-02'), '2027-01-31');
  assert.strictEqual(S.deleteAfter({ candidates: [{ date: '2026-12-01' }], deadline: '2027-01-10' }, '2026-11-02'), '2027-02-28');
  assert.strictEqual(S.deleteAfter({ candidates: [{ date: '2026-10-01' }], deadline: '' }, '2026-11-02'), '2026-12-31');
  assert.strictEqual(S.deleteAfter({ candidates: [{ label: '平日夜' }], deadline: '' }, '2026-11-02'), '2027-05-31');

  /* ---------- Code.gs 越しの一連の流れ（幹事・参加者・第三者） ---------- */
  const gas = makeGas();
  const net = connect(gas);
  const SECRET = ['秘密の忘年会', '新宿の居酒屋', '平日夜', '山田花子', '佐藤', 'よろしく', '幹事代理', '2026-12-03', '2026-12-04', '19:00'];

  const owner = net.repo();
  const created = await owner.create({ title: '秘密の忘年会', memo: '新宿の居酒屋', deadline: '2026-11-30',
    candidates: [{ date: '2026-12-03', start: '19:00', end: '21:00' }, { date: '2026-12-04' }, { label: '平日夜' }] });
  const { id, adminToken, key } = created;
  assert.ok(S.isKeyString(key));
  assert.strictEqual(created.event.title, '秘密の忘年会');
  assert.strictEqual(created.event.encrypted, true);
  const [c1, c2, c3] = created.event.candidates.map(c => c.id);

  // 参加者（別ブラウザ相当）：参加者用URLの鍵で開いて回答
  const guest = net.repo();
  let g = await guest.get(id, key);
  assert.strictEqual(g.event.title, '秘密の忘年会');
  assert.strictEqual(g.event.memo, '新宿の居酒屋');
  assert.strictEqual(g.isAdmin, undefined);
  const day = '-'.repeat(38) + '3210' + '-'.repeat(6);
  const a1 = (await guest.answer(id, '', { name: '山田花子', comment: 'よろしく', votes: { '2026-12-03': day, [c2]: 1, [c3]: 2, bogus: 2 } })).answer;
  assert.match(a1.id, /^a[A-Za-z0-9]{10}$/);
  await guest.answer(id, '', { name: '佐藤', votes: {} });
  await rejects(guest.answer(id, '', { name: '  ', votes: {} }), /お名前/);
  g = await guest.get(id, key);
  assert.strictEqual(g.answers.length, 2);
  assert.strictEqual(g.answers[0].name, '山田花子');
  assert.strictEqual(g.answers[0].votes['2026-12-03'], day);
  same(Object.keys(g.answers[0].votes).sort(), ['2026-12-03', c2, c3].sort()); // 候補にない票はブラウザ側で除外
  // 回答の修正：同じ ID で上書き、作成日時は維持
  const a1b = (await guest.answer(id, '', { id: a1.id, name: '山田花子', comment: '遅れます', votes: { [c2]: 0 } })).answer;
  assert.strictEqual(a1b.id, a1.id);
  g = await guest.get(id, key);
  assert.strictEqual(g.answers.length, 2);
  assert.strictEqual(g.answers[0].comment, '遅れます');
  assert.strictEqual(g.answers[0].createdAt, a1.createdAt);

  // 幹事（管理者URL・別ブラウザ相当）：編集・決定・受付終了
  const admin = net.repo();
  g = await admin.get(id, key, adminToken);
  assert.strictEqual(g.isAdmin, true);
  await admin.update(id, adminToken, { title: '秘密の忘年会', memo: '新宿の居酒屋', deadline: '',
    candidates: [{ id: c1, date: '2026-12-03', start: '19:00', end: '21:00' }, { id: c2, date: '2026-12-04' }, { id: c3, label: '平日夜' }] });
  await rejects(admin.confirm(id, adminToken, { date: '2027-01-01' }), /候補にない/);
  await admin.confirm(id, adminToken, { date: '2026-12-04' });
  await rejects(guest.update(id, 'wrong-token', { title: 'x', candidates: [{ date: '2026-12-03' }] }), /管理用URL/);
  await admin.setClosed(id, adminToken, true);
  g = await guest.get(id, key);
  same(g.event.confirmed, { date: '2026-12-04', start: '', end: '', label: '' });
  assert.strictEqual(g.event.closed, true);
  await rejects(guest.answer(id, '', { name: 'x', votes: {} }), /受付を終了/);
  await rejects(guest.deleteAnswer(id, '', a1.id, false), /受付を終了/);
  await admin.answer(id, adminToken, { name: '幹事代理', votes: {} }, true);
  // 編集で決定済みの候補を消すと決定解除（従来のサーバー処理と同じ）
  await admin.update(id, adminToken, { title: '秘密の忘年会', candidates: [{ id: c1, date: '2026-12-03', start: '19:00', end: '21:00' }] });
  g = await admin.get(id, key, adminToken);
  assert.strictEqual(g.event.confirmed, null);
  assert.strictEqual(g.event.closed, true);
  assert.strictEqual(g.answers.length, 3);

  /* ---------- 鍵なし・鍵違い・鍵の形式不正 ---------- */
  await rejects(net.repo().get(id, undefined), URL_ERR);
  await rejects(net.repo().get(id, ''), URL_ERR);
  await rejects(net.repo().get(id, S.generateKeyString()), URL_ERR);
  await rejects(net.repo().get(id, key.slice(0, 21)), URL_ERR);
  // 鍵を読み込んでいない（未取得・鍵なし）状態の書き込みは、平文を送る前にブラウザ側で止める
  const before = net.sent.length;
  await rejects(net.repo().answer(id, '', { name: '山田花子', votes: {} }), URL_ERR);
  await rejects(net.repo().update(id, adminToken, { title: '秘密の忘年会', candidates: [{ date: '2026-12-03' }] }), URL_ERR);
  const r3 = net.repo(); await rejects(r3.get(id, undefined), URL_ERR);
  await rejects(r3.answer(id, '', { name: '山田花子', votes: {} }), URL_ERR);
  await rejects(r3.confirm(id, adminToken, { date: '2026-12-03' }), URL_ERR);
  await rejects(r3.setClosed(id, adminToken, false), URL_ERR);
  assert.strictEqual(net.sent.length, before + 1); // 送ったのは get の1回だけ

  /* ---------- サーバーへ送ったデータに鍵・中身が含まれない ---------- */
  const keyForms = [key, Buffer.from(key, 'base64url').toString('base64'), Buffer.from(key, 'base64url').toString('hex')];
  for (const body of net.sent) {
    for (const k of keyForms) assert.ok(!body.includes(k), 'key leaked in payload: ' + body.slice(0, 80));
    for (const s of SECRET) assert.ok(!body.includes(s), 'plaintext leaked in payload: ' + s);
  }
  // 暗号化イベントへの送信は id / adminToken / answerId / blob(v, ct, deleteAfter) のみ
  const allowed = new Set(['action', 'id', 'adminToken', 'answerId', 'blob', 'v', 'ct', 'deleteAfter', 'baseUpdatedAt']);
  for (const body of net.sent) JSON.parse(body, (k, v) => { if (k !== '') assert.ok(allowed.has(k), 'unexpected field: ' + k); return v; });

  /* ---------- スプレッドシートに残るもの ---------- */
  const evRows = gas.sheets.events.rows.slice(1), anRows = gas.sheets.answers.rows.slice(1);
  for (const row of evRows.concat(anRows)) {
    const text = JSON.stringify(row);
    for (const k of keyForms) assert.ok(!text.includes(k));
    for (const s of SECRET) assert.ok(!text.includes(s), 'plaintext in sheet: ' + s);
  }
  assert.deepStrictEqual(Object.keys(JSON.parse(evRows[0][2])).sort(), ['createdAt', 'ct', 'deleteAfter', 'updatedAt', 'v']);
  assert.strictEqual(JSON.parse(evRows[0][2]).deleteAfter, '2027-01-31');
  for (const row of anRows) assert.deepStrictEqual(Object.keys(JSON.parse(row[2])).sort(), ['createdAt', 'ct', 'id', 'updatedAt', 'v']);

  /* ---------- サーバー側で暗号文を差し替えられても検出する ---------- */
  const r0 = JSON.parse(anRows[0][2]), r1 = JSON.parse(anRows[1][2]);
  const saved = anRows[1][2];
  anRows[1][2] = JSON.stringify(Object.assign({}, r1, { ct: r0.ct })); // 回答Aの暗号文を回答Bの行へ
  g = await net.repo().get(id, key);
  assert.strictEqual(g.answers.length, 2);
  assert.strictEqual(g.brokenAnswers, 1);
  anRows[1][2] = saved;
  const evSaved = evRows[0][2];
  evRows[0][2] = JSON.stringify(Object.assign(JSON.parse(evSaved), { ct: r0.ct })); // 回答の暗号文をイベント本体へ
  await rejects(net.repo().get(id, key), URL_ERR);
  evRows[0][2] = evSaved;
  assert.strictEqual((await net.repo().get(id, key)).answers.length, 3);

  /* ---------- サーバーの形式チェック・後方互換の拒否 ---------- */
  const ng = (p, re) => { const r = gas.post(p); assert.ok(!r.ok, 'expected error: ' + JSON.stringify(p).slice(0, 80)); assert.match(r.error, re); };
  ng({ action: 'answer', id, answer: { name: '旧フロント', votes: {} } }, /再読み込み/); // 暗号化イベントに平文は保存しない
  ng({ action: 'confirm', id, adminToken, confirmed: { date: '2026-12-03' } }, /再読み込み/);
  ng({ action: 'setClosed', id, adminToken, closed: false }, /再読み込み/);
  ng({ action: 'update', id, adminToken, event: { title: 'x', candidates: [{ date: '2026-12-03' }] } }, /形式/);
  ng({ action: 'create', blob: { v: 'e1', ct: 'short' } }, /形式/);
  ng({ action: 'create', blob: { v: 'e2', ct: 'A'.repeat(60) } }, /形式/);
  ng({ action: 'create', blob: { v: 'e1', ct: '<script>'.repeat(10) } }, /形式/);
  ng({ action: 'create', blob: { v: 'e1', ct: 'A'.repeat(60000) } }, /大きすぎ/);
  ng({ action: 'answer', id, answerId: 'a1', blob: { v: 'e1', ct: 'A'.repeat(30001) } }, /大きすぎ/);
  ng({ action: 'answer', id, answerId: '../x', blob: { v: 'e1', ct: 'A'.repeat(60) } }, /回答ID/);
  // 古い内容のままの上書き（別タブ・別端末）を検出する
  const tabA = net.repo(), tabB = net.repo();
  await tabA.get(id, key, adminToken); await tabB.get(id, key, adminToken);
  await new Promise(r => setTimeout(r, 5));
  await tabA.setClosed(id, adminToken, false);
  await rejects(tabB.setClosed(id, adminToken, true), /他の端末で内容が更新/);
  await tabA.setClosed(id, adminToken, true); // 自分の更新後は続けて操作できる
  ng({ action: 'update', id, adminToken, blob: { v: 'e1', ct: 'A'.repeat(60) } }, /他の端末/);
  ng({ action: 'create', blob: { v: 'e1', ct: 'A'.repeat(48001) } }, /大きすぎ/);
  ng({ action: 'update', id, adminToken: 'bad', blob: { v: 'e1', ct: 'A'.repeat(60) } }, /管理用URL/);
  assert.ok(!gas.post({ action: 'create', blob: { v: 'e1', ct: 'A'.repeat(60), deleteAfter: '<x>' } }).data.event.deleteAfter);

  /* ---------- 平文の旧データ（鍵なしURL）はこれまで通り読める・回答できる ---------- */
  const old = gas.post({ action: 'create', event: { title: '旧イベント', memo: 'm', candidates: [{ date: '2026-11-20' }, { label: '週末' }] } }).data;
  const legacy = net.repo();
  let lg = await legacy.get(old.id, undefined);
  assert.strictEqual(lg.event.title, '旧イベント');
  assert.strictEqual(lg.event.encrypted, false);
  // 鍵付きURLで平文が返ってきたら拒否（サーバーによる平文へのすり替え＝ダウングレード対策）
  await rejects(net.repo().get(old.id, S.generateKeyString()), URL_ERR);
  await rejects(net.repo().get(id, key).then(() => { // 暗号化イベントを平文に偽装されたケース
    const row = gas.sheets.events.rows.find(r => r[0] === id); const saved = row[2];
    row[2] = JSON.stringify({ title: '偽物', candidates: [{ id: 'c1', date: '2026-12-03' }], createdAt: 'x', updatedAt: 'x' });
    return net.repo().get(id, key).finally(() => { row[2] = saved; });
  }), URL_ERR);
  await legacy.answer(old.id, '', { name: '旧の人', votes: { [lg.event.candidates[1].id]: 2 } });
  lg = await legacy.get(old.id, undefined, old.adminToken);
  assert.strictEqual(lg.answers[0].name, '旧の人');
  await legacy.confirm(old.id, old.adminToken, { label: '週末' });
  await legacy.setClosed(old.id, old.adminToken, true);
  await rejects(legacy.answer(old.id, '', { name: 'x', votes: {} }), /受付を終了/); // 旧データはサーバー側で判定
  lg = await legacy.get(old.id, undefined);
  assert.strictEqual(lg.event.confirmed.label, '週末');
  assert.strictEqual(lg.event.closed, true);
  ng({ action: 'answer', id: old.id, answerId: 'aX', blob: { v: 'e1', ct: 'A'.repeat(60) } }, /暗号化されていない/);
  assert.ok(!('v' in JSON.parse(gas.sheets.events.rows.find(r => r[0] === old.id)[2]))); // 平文のまま（移行しない）

  /* ---------- デモモード（ブラウザ内ルーター）も同じ暗号化経路 ---------- */
  const mem = { events: {}, answers: {} };
  const local = browser.PittanCore.createRouter({
    getEvent: i => (mem.events[i] ? JSON.parse(JSON.stringify(mem.events[i])) : null),
    putEvent: (i, t, d) => { mem.events[i] = { adminToken: t, data: JSON.parse(JSON.stringify(d)) }; },
    deleteEvent: i => { delete mem.events[i]; delete mem.answers[i]; },
    listAnswers: e => Object.values(mem.answers[e] || {}).map(x => JSON.parse(JSON.stringify(x))),
    putAnswer: (e, a, d) => { (mem.answers[e] = mem.answers[e] || {})[a] = JSON.parse(JSON.stringify(d)); },
    deleteAnswer: (e, a) => { if (mem.answers[e]) delete mem.answers[e][a]; },
  });
  const demoCall = (a, p) => Promise.resolve().then(() => local.handle(Object.assign({ action: a }, JSON.parse(JSON.stringify(p)))));
  const demo = S.createRepo(demoCall);
  const d1 = await demo.create({ title: 'デモ秘密', candidates: [{ date: '2026-12-01' }] });
  await demo.answer(d1.id, '', { name: 'デモ太郎', votes: {} });
  assert.ok(!JSON.stringify(mem).includes('デモ秘密') && !JSON.stringify(mem).includes('デモ太郎') && !JSON.stringify(mem).includes(d1.key));
  assert.strictEqual((await S.createRepo(demoCall).get(d1.id, d1.key)).answers[0].name, 'デモ太郎');

  console.log('crypto tests passed');
})().catch(e => { console.error(e); process.exit(1); });
