// gas/Code.gs を SpreadsheetApp などの最小スタブ上で動かすためのテスト用ハーネス
const fs = require('fs'); const vm = require('vm');
const code = fs.readFileSync(__dirname + '/../gas/Code.gs', 'utf8');

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

function makeGas() {
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
  return { ctx, sheets, post };
}

module.exports = { makeGas };
