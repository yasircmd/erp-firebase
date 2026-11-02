// Master Data Import, Copy current records for items (fixed 2026-11-02;
// docs/modules/ITEM_USER_CODE.md): the sheet is pasted back in, so its Item
// Code column keeps the system code, beside the User Code column; elsewhere
// a copied item code still shows the user code, as before.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/masterImportItemCode.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.items.I1.UserCode = 'SS-1';
  f.items.I1.TaxCode = 'SR';
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8200);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());
  await page.goto('http://127.0.0.1:8200/?module=MASTERIMPORT&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.itemUserCode && window.itemUserCode('RM-001') === 'SS-1', null, { timeout: 30000 });

  await check('Copy current records (items): Item Code is the system code, User Code beside it, the tax code too', async () => {
    await page.selectOption('#mimp-master', 'ITEM');
    await page.check('#mimp-mode-update');
    await page.click('#mimp-copy-records');
    await page.waitForFunction(() => /records? copied/.test(document.getElementById('mimp-status').textContent), null, { timeout: 30000 });
    const rows = (await page.evaluate(() => navigator.clipboard.readText())).split('\n').map(l => l.split('\t'));
    const h = rows[0];
    const row = rows.find(r => r[h.indexOf('Item Name')] === 'Steel Sheet');
    assert.deepEqual([h[0], row[0], row[h.indexOf('User Code')], row[h.indexOf('Tax Code')]], ['Item Code', 'RM-001', 'SS-1', 'SR']);
  });

  await check('elsewhere a copied item code still shows the user code (the shell, as before)', async () => {
    await page.evaluate(() => navigator.clipboard.writeText('RM-001\tSteel Sheet'));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'SS-1\tSteel Sheet');
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
