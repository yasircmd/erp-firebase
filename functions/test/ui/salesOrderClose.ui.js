// Sales Order on screen after a delivery, and Close / Reopen (owner,
// 2026-11-02; docs/modules/SO_CLOSE.md): an opened order shows what was
// delivered and what is left (it showed Delivered 0); Claim only for what is
// left; Close with a reason (in-app prompt), the order then Closed; Reopen.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/salesOrderClose.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 5, TotalValue: 50 } } } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: '2026-10-10', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 6, UnitPrice: 20 }] } });
  await call('u-admin', 'confirmSalesOrder', { soId: s.soId });
  const lineId = (await val('salesOrders/' + s.soId)).Lines[0].LineID;
  const d = await call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: '2026-10-11', Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ SourceSOID: s.soId, SourceSOLineID: lineId, Quantity: 4, Description: 'Ship' }] } });
  assert.equal((await call('u-admin', 'postDeliveryNote', { dnId: d.dnId })).success, true);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8202);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.__errors = []; page.__answers = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, x => { page.__dialogs.push(x.message()); x.accept(page.__answers.shift()); });
  const T = { timeout: 30000 };
  await page.goto('http://127.0.0.1:8202/?module=SALESORDER&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, T);
  await page.waitForSelector('#so-table-body tr[data-doc-id]', T);
  const cells = () => page.$$eval('#so-grid-body tr:first-child td', tds => tds.slice(7, 11).map(t => t.textContent.trim()));
  const badge = () => page.textContent('#so-status-badge');
  const shown = id => page.isVisible(id);

  await check('an opened order shows what was delivered and what is left; Claim only for what is left', async () => {
    await page.click('#so-table-body tr[data-doc-id]');
    await page.waitForSelector('#so-entry-view:not(.hidden)', T);
    assert.deepEqual(await cells(), ['2.00', '4.00', '2.00', 'Partial'], 'Reserved, Delivered, Remaining, Status');
    assert.equal(await page.locator('#so-grid-body .so-claim-btn').count(), 0, 'the 2 left are reserved: nothing to claim');
    assert.deepEqual([await shown('#so-close-btn'), await shown('#so-reopen-btn')], [true, false]);
    assert.ok((await page.$$eval('#so-status-filter option', o => o.map(x => x.value))).includes('Closed'));
  });

  await check('Close with a reason: the order is Closed, its reason shown, nothing to claim or release; then Reopen', async () => {
    page.__answers.push('Customer cancelled the rest');
    await page.click('#so-close-btn');
    await page.waitForFunction(() => document.getElementById('so-status-badge').textContent === 'Closed', null, T);
    assert.match(page.__dialogs[0], /^Close this Sales Order\?/);
    assert.match(await page.textContent('#so-voucher-no-line'), /Closed .* by .*: Customer cancelled the rest/);
    assert.deepEqual(await cells(), ['0.00', '4.00', '2.00', 'Partial']);
    assert.equal(await page.locator('#so-grid-body .so-claim-btn, #so-grid-body .so-release-btn').count(), 0);
    assert.deepEqual([await shown('#so-close-btn'), await shown('#so-reopen-btn')], [false, true]);
    assert.equal((await val('salesOrders/' + s.soId)).Status, 'Closed');

    page.__answers.push('Customer wants it after all');
    await page.click('#so-reopen-btn');
    await page.waitForFunction(() => document.getElementById('so-status-badge').textContent === 'Partially Reserved', null, T);
    assert.equal(await page.locator('#so-grid-body .so-claim-btn').count(), 1, 'Claim reserves the 2 left again');
    assert.equal(await badge(), 'Partially Reserved');
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
