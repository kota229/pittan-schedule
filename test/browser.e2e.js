// node test/browser.e2e.js — Playwright で画面の一連の流れを確認する（要 playwright）
// docs/ を https://pittan.pages.dev/ として配信し、GAS は test/gas-harness.js（Code.gs をスタブ上で実行）でモックする。
// 全リクエストを記録し、鍵や入力内容が外部へ送られていないことも検査する。
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const { makeGas } = require('./gas-harness');

const ROOT = path.join(__dirname, '..', 'docs');
const API = /^https:\/\/script\.google\.com\/macros\//;
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.xml': 'application/xml', '.txt': 'text/plain', '.html': 'text/html' };
const SECRET = ['極秘の打ち上げ', '恵比寿のお店', '参加者ハナコ', 'ごめんなさい'];

// 同じモック GAS を共有する別々のブラウザコンテキスト（＝別の人の端末）を作れるようにする
async function setup(browser, demo, shared) {
  const gas = shared ? shared.gas : makeGas();
  const log = shared ? shared.log : [];
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    const req = route.request();
    const url = req.url();
    log.push({ url, body: req.postData() || '' });
    if (API.test(url)) {
      const r = gas.post(JSON.parse(req.postData() || '{}'));
      return route.fulfill({ body: JSON.stringify(r), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    const m = url.match(/^https:\/\/(pittan\.pages\.dev|kota229\.github\.io)(\/[^?#]*)/);
    if (!m) return route.fulfill({ status: 404, body: '' }); // 外部への通信は発生しないはず
    let p = m[2].replace(/^\/pittan-schedule/, '');
    if (p.endsWith('/')) p += 'index.html';
    if (demo && p.endsWith('config.js')) return route.fulfill({ body: "window.APP_CONFIG={apiUrl:''};", contentType: 'text/javascript' });
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  return { gas, log, ctx };
}

async function newPage(ctx) {
  const pg = await ctx.newPage();
  pg.on('pageerror', e => { throw e; });
  pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console:', m.text()); });
  return pg;
}

async function run(browser, demo) {
  const label = demo ? 'demo' : 'mock-gas';
  const { gas, log, ctx } = await setup(browser, demo);

  // 1. 幹事が作成
  const owner = await newPage(ctx);
  await owner.goto('https://pittan.pages.dev/#/new');
  await owner.fill('#title', '極秘の打ち上げ');
  await owner.fill('#memo', '恵比寿のお店');
  await owner.locator('#cal [data-date]:not([disabled])').nth(3).click();
  await owner.locator('#cal [data-date]:not([disabled])').nth(5).click();
  await owner.click('#submit');
  await owner.waitForSelector('.done');
  assert.match(await owner.textContent('.done'), /このURLをなくすと、運営者も含め誰も内容を復元できません。必ず保存してください。/);
  const shareUrl = await owner.locator('.url-row input').first().inputValue();
  const adminUrl = await owner.locator('.admin-url input').inputValue();
  const m = shareUrl.match(/#\/e\/([A-Za-z0-9]+)\.([A-Za-z0-9_-]{22})$/);
  assert.ok(m, 'share url has key: ' + shareUrl);
  const [, id, key] = m;
  assert.match(adminUrl, new RegExp('#/e/' + id + '\\.' + key + '/admin/[A-Za-z0-9]+$'));

  // 2. 参加者が参加者用URLで回答（別ページ。デモモード以外は別ブラウザ相当）
  // デモモードはデータがブラウザ内にしかないため同じコンテキストで確認する
  const gctx = demo ? ctx : (await setup(browser, false, { gas, log })).ctx;
  const guest = await newPage(gctx);
  await guest.goto(shareUrl);
  await guest.waitForSelector('#openAnswer');
  assert.strictEqual(await guest.title(), '極秘の打ち上げ｜ぴったん');
  await guest.click('#openAnswer');
  await guest.fill('#aName', '参加者ハナコ');
  await guest.fill('#aComment', 'ごめんなさい');
  await guest.click('#aSubmit');
  await guest.waitForSelector('text=参加者ハナコ');

  // 3. 幹事が管理者URLで開いて編集
  const actx = demo ? ctx : (await setup(browser, false, { gas, log })).ctx;
  const admin = await newPage(actx);
  await admin.goto(adminUrl);
  await admin.waitForSelector('text=候補・内容を編集');
  assert.ok(!admin.url().includes('/admin/'), 'admin token removed from hash');
  assert.ok(admin.url().endsWith('#/e/' + id + '.' + key));
  await admin.click('text=候補・内容を編集');
  await admin.waitForSelector('#title');
  await admin.fill('#title', '極秘の打ち上げ（改）');
  await admin.click('#submit');
  await admin.waitForSelector('text=極秘の打ち上げ（改）');
  await admin.click('#toggleClose');
  await admin.waitForSelector('text=回答の受付を再開');

  // 4. 結果表示（参加者側で再読み込み）
  await guest.reload();
  await guest.waitForSelector('text=極秘の打ち上げ（改）');
  assert.ok(await guest.isVisible('text=参加者ハナコ'));
  if (!demo) {
    assert.ok(await guest.isVisible('text=回答の受付を終了しました'));
    assert.strictEqual(await guest.locator('#openAnswer').count(), 0);
    assert.strictEqual(await guest.locator('text=候補・内容を編集').count(), 0); // 参加者には幹事操作が出ない
  }
  await guest.screenshot({ path: path.join(process.env.SHOT_DIR || require('os').tmpdir(), label + '-result.png'), fullPage: true });

  // 5. 鍵なし・鍵違いはわかりやすいエラー
  const bad = await newPage(gctx);
  await bad.goto('https://pittan.pages.dev/#/e/' + id);
  await bad.waitForSelector('.err-text');
  assert.match(await bad.textContent('.err-text'), /URLが不完全か、正しくありません。共有されたURLを最初から最後までコピーして開いてください/);
  await bad.goto('https://pittan.pages.dev/#/e/' + id + '.' + (key[0] === 'A' ? 'B' : 'A') + key.slice(1));
  await bad.waitForSelector('.err-text');
  assert.match(await bad.textContent('.err-text'), /URLが不完全か、正しくありません/);
  assert.ok(!(await bad.content()).includes('極秘'));

  // 6. 旧URL（GitHub Pages）からの転送で鍵（ハッシュ）が引き継がれる
  const redir = await newPage(ctx);
  await redir.goto('https://kota229.github.io/pittan-schedule/#/e/' + id + '.' + key);
  await redir.waitForSelector('text=極秘の打ち上げ（改）');
  assert.strictEqual(redir.url(), 'https://pittan.pages.dev/#/e/' + id + '.' + key);

  // 7. 旧形式（平文・鍵なしURL）の既存イベント
  if (!demo) {
    const old = gas.post({ action: 'create', event: { title: '旧形式のイベント', candidates: [{ date: '2026-12-20' }] } }).data;
    const lp = await newPage(ctx);
    await lp.goto('https://pittan.pages.dev/#/e/' + old.id);
    await lp.waitForSelector('#openAnswer');
    assert.strictEqual(await lp.title(), '旧形式のイベント｜ぴったん');
    await lp.click('#openAnswer');
    await lp.fill('#aName', '旧の人');
    await lp.click('#aSubmit');
    await lp.waitForSelector('text=旧の人');
  } else {
    // デモモードの保存内容（localStorage）にも平文・鍵が残らない
    const db = await owner.evaluate(() => localStorage.getItem('pittan.demo.db'));
    for (const s of SECRET.concat([key])) assert.ok(!db.includes(s), 'demo db contains ' + s);
  }

  // 8. 全リクエストの検査：鍵・入力内容が URL やボディに含まれない、外部へ送られていない
  for (const r of log) {
    for (const s of SECRET.concat([key, '極秘の打ち上げ（改）'])) {
      assert.ok(!r.url.includes(s) && !r.body.includes(s), label + ': leaked "' + s + '" in ' + r.url);
    }
    assert.match(r.url, /^https:\/\/(pittan\.pages\.dev|kota229\.github\.io|script\.google\.com)\//, 'unexpected request: ' + r.url);
  }
  const apiCalls = log.filter(r => API.test(r.url));
  assert.ok(demo ? apiCalls.length === 0 : apiCalls.length > 5);
  if (!demo) {
    const sheetText = JSON.stringify(gas.sheets);
    for (const s of SECRET.concat([key])) assert.ok(!sheetText.includes(s), 'sheet contains ' + s);
  }
  await ctx.close();
  if (gctx !== ctx) await gctx.close();
  if (actx !== ctx) await actx.close();
  console.log(label + ': ok (' + log.length + ' requests checked)');
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, false);
    await run(browser, true);
    console.log('browser e2e passed');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
