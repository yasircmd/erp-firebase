// Stock Ledger Report: open an entry from a row, then Back (owner,
// 2026-10-03): the report comes back with its company, item, location and
// dates as they were, and already run. It used to come back empty.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/stockLedgerBack.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, today } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 7, UnitCost: 5, Description: 'in' }] });
  const posted = await call('u-admin', 'postGrn', { grnId: g.grnId });
  assert.equal(posted.success, true, posted.error);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8162);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());
  await page.goto('http://127.0.0.1:8162/?module=STOCKLEDGER&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#sl-location option').length > 1 && document.querySelectorAll('#sl-item-datalist option').length > 0, null, { timeout: 30000 });

  await check('Back from an entry reopens the report with its filters, already run', async () => {
    await page.selectOption('#sl-company', 'C1');
    await page.fill('#sl-item-input', 'RM-001 — Steel Sheet');
    await page.selectOption('#sl-location', 'WH2');
    await page.fill('#sl-from-date', '2020-01-01');
    await page.fill('#sl-to-date', today);
    await page.click('#sl-run-btn');
    await page.waitForSelector('#sl-results:not(.hidden) .sl-open-entry', { timeout: 20000 });
    await page.click('#sl-table-body .sl-open-entry');
    await page.waitForSelector('#grn-back-chain-btn:not(.hidden)', { timeout: 30000 });
    await page.click('#grn-back-chain-btn');
    await page.waitForSelector('#sl-results:not(.hidden) .sl-open-entry', { timeout: 30000 });
    const f = await page.evaluate(() => ({
      company: document.getElementById('sl-company').value, item: document.getElementById('sl-item-input').value,
      location: document.getElementById('sl-location').value, from: document.getElementById('sl-from-date').value,
      to: document.getElementById('sl-to-date').value
    }));
    assert.deepEqual(f, { company: 'C1', item: 'RM-001 — Steel Sheet', location: 'WH2', from: '2020-01-01', to: today });
    assert.match(await page.textContent('#sl-table-body'), new RegExp(posted.grnNumber || 'GRN-'));
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
