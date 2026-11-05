// One module title (owner, 2026-11-04: "the name is displaying two times"):
// with a module open, its name shows once, in the app bar (#app-title); the
// screen's own heading and its area line are hidden on screen, and kept in
// print. A sample of screens from each area.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/oneTitle.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

// [module, the name the app bar shows]
const SCREENS = [['CBT', 'Cash and Bank Transactions'], ['GRN', 'Goods Receipt'], ['SALESORDER', 'Sales Order'], ['PDCRECEIVED', 'PDC Received'],
  ['VENDORSOA', 'Vendor'], ['BUDGET', 'Budget'], ['PROJECTREPORT', 'Project Report'], ['DATARESET', 'Data Reset'], ['ITEMMASTER', 'Item']];

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8210);
  const browser = await chromium.launch();
  for (const [mod, name] of SCREENS) {
    await check(mod + ': the name once, in the app bar; the screen\'s own heading hidden on screen, kept in print', async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await onAppDialog(page, d => d.accept());
      await page.goto('http://127.0.0.1:8210/?module=' + mod + '&uid=u-admin');
      await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
      assert.ok((await page.textContent('#app-title')).includes(name), 'app bar: ' + await page.textContent('#app-title'));
      const shown = () => page.evaluate(() => Array.from(document.querySelectorAll('#module-container h2.text-2xl, #module-container div.uppercase.mb-1'))
        .filter(e => e.matches('h2') || (e.nextElementSibling && e.nextElementSibling.matches('h2.text-2xl'))).map(e => e.checkVisibility()));
      const onScreen = await shown();
      assert.ok(onScreen.length >= 1 && onScreen.every(v => v === false), 'heading and area line hidden: ' + JSON.stringify(onScreen));
      await page.emulateMedia({ media: 'print' });
      assert.ok((await page.evaluate(() => getComputedStyle(document.querySelector('#module-container h2.text-2xl')).display)) !== 'none', 'kept in print');
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
