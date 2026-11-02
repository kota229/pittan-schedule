// node test/core.test.js — Code.gs（コア＋GASストア）をスタブ環境で動かして一通りの操作を検証
const assert = require('assert');
const { makeGas } = require('./gas-harness');
const { ctx, sheets } = makeGas();

const post = p => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(p) } }).body);
const ok = p => { const r = post(p); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
const ng = (p, re) => { const r = post(p); assert.ok(!r.ok, 'expected error'); assert.match(r.error, re); };

assert.ok(JSON.parse(ctx.doGet({ parameter: {} }).body).ok);
ng({ action: 'create', event: { title: '', candidates: [{ date: '2026-11-03' }] } }, /イベント名/);
ng({ action: 'create', event: { title: 'x', candidates: [] } }, /候補/);
const c = ok({ action: 'create', event: { title: '忘年会', memo: 'm', candidates: [
  { date: '2026-11-03', start: '19:00', end: '21:00' }, { date: '2026-11-04' }, { label: '平日夜' }, { date: 'bad' } ] } });
assert.strictEqual(c.event.candidates.length, 3);
const id = c.id, tok = c.adminToken;
const [c1, c2, c3] = c.event.candidates.map(x => x.id);

// 11/3 19:00-21:00 → マス 38〜41。範囲外のマスや不正文字は '-' に
const day = '-'.repeat(36) + '2233' + '3210' + '-'.repeat(8);
const a1 = ok({ action: 'answer', id, answer: { name: '山田', comment: 'よろ', votes: { '2026-11-03': day, [c2]: 1, [c3]: 3, bogus: 2, [c1]: 2 } } }).answer;
assert.strictEqual(a1.votes['2026-11-03'], '-'.repeat(38) + '3332' + '-'.repeat(6));
assert.deepStrictEqual(Object.keys(a1.votes).sort(), ['2026-11-03', c2, c3].sort());
ok({ action: 'answer', id, answer: { name: '佐藤', votes: { '2026-11-03': 'x'.repeat(48) } } });
ok({ action: 'answer', id, answer: { id: a1.id, name: '山田太郎', votes: { [c2]: 0 } } });
let g = ok({ action: 'get', id });
assert.strictEqual(g.answers.length, 2);
assert.strictEqual(g.answers[0].name, '山田太郎');
assert.ok(!('adminToken' in g.event));
assert.strictEqual(g.isAdmin, undefined);
assert.strictEqual(ok({ action: 'get', id, adminToken: tok }).isAdmin, true);
assert.strictEqual(ok({ action: 'get', id, adminToken: 'zzz' }).isAdmin, false);

ng({ action: 'update', id, adminToken: 'bad', event: { title: 'x', candidates: [{ date: '2026-11-03' }] } }, /管理用URL/);
ng({ action: 'confirm', id, adminToken: tok, confirmed: { date: '2026-12-31' } }, /候補にない/);
ok({ action: 'confirm', id, adminToken: tok, confirmed: { date: '2026-11-04', start: '19:30', end: '20:30' } });
assert.deepStrictEqual(ok({ action: 'get', id }).event.confirmed, { date: '2026-11-04', start: '19:30', end: '20:30', label: '' });
assert.strictEqual(ok({ action: 'get', id }).apiVersion, 3);
// 編集で確定候補を消すと確定解除
const up = ok({ action: 'update', id, adminToken: tok, event: { title: '忘年会2', candidates: [{ id: c1, date: '2026-11-03', start: '19:00' }, { date: '2026-11-10' }] } });
assert.strictEqual(up.event.confirmed, null);
assert.strictEqual(up.event.candidates[0].id, c1);

ok({ action: 'setClosed', id, adminToken: tok, closed: true });
ng({ action: 'answer', id, answer: { name: 'x', votes: {} } }, /終了/);
ok({ action: 'answer', id, adminToken: tok, answer: { name: '幹事代理', votes: {} } });
ok({ action: 'setClosed', id, adminToken: tok, closed: false });
ok({ action: 'deleteAnswer', id, answerId: a1.id });
assert.strictEqual(ok({ action: 'get', id }).answers.length, 2);

const c2ev = ok({ action: 'create', event: { title: '別件', candidates: [{ date: '2026-12-01' }] } });
ok({ action: 'answer', id: c2ev.id, answer: { name: 'A', votes: {} } });
ok({ action: 'remove', id, adminToken: tok });
ng({ action: 'get', id }, /見つかりません/);
assert.strictEqual(ok({ action: 'get', id: c2ev.id }).answers.length, 1);
assert.strictEqual(sheets.answers.rows.length, 2); // ヘッダー + 別件の1件
ng({ action: 'nope' }, /不明/);
ng({ action: 'get', id: '../x' }, /URL/);
console.log('all tests passed');
