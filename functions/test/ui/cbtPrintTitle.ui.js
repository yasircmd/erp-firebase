// CBT prints (owner, 2026-11-03): a Cash Receipt prints as CASH RECEIPT and
// a Bank Receipt as BANK RECEIPT (they printed as "PAYMENT RECEIPT");
// payments keep their voucher title. A line on a customer's or vendor's
// account prints the party's code and name, and one party heads the print
// (Received from / Paid to).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/cbtPrintTitle.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, reset, baseFixture, call } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  await reset(f);
  // A saved Bank Receipt from the customer (no allocation: an advance).
  const saved = await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Receipt', SelectedAccountCode: '1100', JVDate: '2026-10-10', Description: 'Advance',
    CompanyID: 'C1', CostCenterID: 'CC1', OppositeLines: [{ AccountCode: '1200', Amount: 300, Description: 'Advance for order', PartyType: 'Customer', PartyID: 'CU1', Allocations: [] }] } });
  assert.equal(saved.success, true, saved.error);
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
  await check('a receipt from a customer prints the customer\'s code and name, on its line and as Received from', async () => {
    await page.click('#cbt-back-btn').catch(() => {});
    await page.reload();
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('.cbt-open', { timeout: 30000 });
    await page.click('.cbt-open');
    await page.waitForSelector('#cbt-entry-view:not(.hidden)', { timeout: 30000 });
    await page.waitForFunction(() => /Retail Co/.test(document.getElementById('cbt-grid-body').textContent), null, { timeout: 30000 }); // the party list is in
    await page.evaluate(() => { const b = document.getElementById('cbt-print-btn'); b.classList.remove('hidden'); b.click(); });
    const doc = await page.textContent('#cbt-print-document');
    assert.match(doc, /BANK RECEIPT/);
    assert.match(doc, /Received from: C001 — Retail Co/);
    assert.deepEqual(await page.$$eval('#cbt-print-document .cbt-print-party', c => c.map(x => x.textContent)), ['C001 — Retail Co']);
    assert.ok((await page.$$eval('#cbt-print-document th', t => t.map(x => x.textContent))).includes('Customer / Vendor'));
    assert.deepEqual(errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
