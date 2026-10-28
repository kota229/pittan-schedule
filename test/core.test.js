// node test/core.test.js — Code.gs（コア＋GASストア）をスタブ環境で動かして一通りの操作を検証
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const code = fs.readFileSync(__dirname + '/../gas/Code.gs', 'utf8');

// --- SpreadsheetApp の最小スタブ ---
function makeSheet(name) {
  const rows = [];
  const sh = {
    name, rows,
    getLastRow: () => rows.length,
    getRange(a, b, c, d) {
      if (typeof a === 'string') return { setNumberFormat() {} };
      const r0 = a, c0 = b, nr = c || 1, nc = d || 1;
      return {
        setValues(v) { for (let i = 0; i < nr; i++) { rows[r0 - 1 + i] = rows[r0 - 1 + i] || []; for (let j = 0; j < nc; j++) rows[r0 - 1 + i][c0 - 1 + j] = v[i][j]; } return this; },
        setFontWeight() { return this; },
        getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((rows[r0 - 1 + i] || [])[c0 - 1 + j] ?? ''); o.push(row); } return o; },
        getValue() { return (rows[r0 - 1] || [])[c0 - 1] ?? ''; },
        createTextFinder(val) {
          const f = { matchEntireCell() { return f; }, matchCase() { return f; },
            findAll() { const out = []; for (let i = 0; i < nr; i++) if ((rows[r0 - 1 + i] || [])[c0 - 1] === val) out.push({ getRow: () => r0 + i }); return out; } };
          return f;
        },
      };
    },
    appendRow(r) { rows.push(r.slice()); },
    deleteRow(n) { rows.splice(n - 1, 1); },
    setFrozenRows() {},
  };
  return sh;
}
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), getSheets: () => Object.values(sheets), deleteSheet() {}, getUrl: () => 'x', getId: () => 'id' };
const props = {};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => null, openById: () => ss, create: () => ss, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => (props[k] = v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return { body: s }; } }) },
  Logger: { log() {} }, console,
};
vm.createContext(ctx); vm.runInContext(code, ctx);

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

const a1 = ok({ action: 'answer', id, answer: { name: '山田', comment: 'よろ', votes: { [c1]: 2, [c2]: 1, [c3]: 0, bogus: 2 } } }).answer;
assert.deepStrictEqual(Object.keys(a1.votes).sort(), [c1, c2, c3].sort());
ok({ action: 'answer', id, answer: { name: '佐藤', votes: { [c1]: 2 } } });
ok({ action: 'answer', id, answer: { id: a1.id, name: '山田太郎', votes: { [c1]: 0 } } });
let g = ok({ action: 'get', id });
assert.strictEqual(g.answers.length, 2);
assert.strictEqual(g.answers[0].name, '山田太郎');
assert.ok(!('adminToken' in g.event));
assert.strictEqual(g.isAdmin, undefined);
assert.strictEqual(ok({ action: 'get', id, adminToken: tok }).isAdmin, true);
assert.strictEqual(ok({ action: 'get', id, adminToken: 'zzz' }).isAdmin, false);

ng({ action: 'update', id, adminToken: 'bad', event: { title: 'x', candidates: [{ date: '2026-11-03' }] } }, /管理用URL/);
ok({ action: 'confirm', id, adminToken: tok, candidateId: c2 });
assert.strictEqual(ok({ action: 'get', id }).event.confirmedId, c2);
// 編集で確定候補を消すと確定解除
const up = ok({ action: 'update', id, adminToken: tok, event: { title: '忘年会2', candidates: [{ id: c1, date: '2026-11-03', start: '19:00' }, { date: '2026-11-10' }] } });
assert.strictEqual(up.event.confirmedId, '');
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
