// CBT print titles (owner, 2026-11-03): a Cash Receipt prints as CASH
// RECEIPT and a Bank Receipt as BANK RECEIPT (they printed as "PAYMENT
// RECEIPT"); payments keep their voucher title.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/cbtPrintTitle.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8209);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto('http://127.0.0.1:8209/?module=CBT&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.click('#cbt-new-btn');
  await page.selectOption('#cbt-form-company', 'C1');
  // The printed title of a new entry of each type (the Print button shows once saved; the print is the same).
  const titleOf = async type => {
    await page.click('.cbt-type-btn[data-type="' + type + '"]');
    await page.evaluate(() => { const b = document.getElementById('cbt-print-btn'); b.classList.remove('hidden'); b.click(); });
    return page.evaluate(() => document.querySelector('#cbt-print-document h2, #cbt-print-document h1, #cbt-print-document [data-title]') ? document.querySelector('#cbt-print-document h2, #cbt-print-document h1').textContent.trim() : document.getElementById('cbt-print-document').textContent);
  };
  await check('Cash Receipt prints as CASH RECEIPT, Bank Receipt as BANK RECEIPT; payments keep their voucher title', async () => {
    assert.match(await titleOf('Cash Receipt'), /^CASH RECEIPT$/);
    assert.match(await titleOf('Bank Receipt'), /^BANK RECEIPT$/);
    assert.match(await titleOf('Cash Payment'), /^CASH PAYMENT VOUCHER$/);
    assert.doesNotMatch(await page.textContent('#cbt-print-document'), /PAYMENT RECEIPT/);
    assert.deepEqual(errors, []);
  });
  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
