// docs/js/core.js と gas/store.gs.js を連結して、貼り付け用の gas/Code.gs を生成する
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'docs/js/core.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'gas/store.gs.js'), 'utf8');
const header = '// このファイルは自動生成です（node tools/build-gas.js）。Apps Script エディタにこの内容をすべて貼り付けてください。\n\n';
fs.writeFileSync(path.join(root, 'gas/Code.gs'), header + core + '\n' + store);
console.log('gas/Code.gs generated');
