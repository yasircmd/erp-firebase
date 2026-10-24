// Stock Availability: what the reserved quantity is for (owner, 2026-10-24;
// docs/modules/UX_ROUND2.md item 24): the reserved figure opens the row's
// reserving Sales Orders, and an order opens from there; a user who may not
// open Sales Orders sees them listed, not as links.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/stockAvailability.ui.js
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
  f.priceListLines = { L1: { ItemCode: 'RM-001', UnitPrice: 9 } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 4, TotalValue: 40 } } }, reservations: {
    R1: { ItemID: 'I1', WarehouseID: 'WH1', Quantity: 3, Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'L1' },
    R2: { ItemID: 'I1', WarehouseID: 'WH1', Quantity: 2, Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO2', SourceLineID: 'L1' } } };
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Example Buyer LLC', Status: 'Active' } };
  const line = q => [{ LineID: 'L1', ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: q, UnitPrice: 9, LineTotal: 9 * q, ReservedQuantity: q }];
  f.salesOrders = {
    SO1: { SONumber: 'SO-26-01-000011', SODate: '2026-10-01', CompanyID: 'C1', CustomerID: 'CU1', Status: 'Reserved', Lines: line(3) },
    SO2: { SONumber: 'SO-26-01-000012', SODate: '2026-10-02', CompanyID: 'C1', CustomerID: 'CU1', Status: 'Reserved', Lines: line(2) }
  };
  f.permissions.SALESORDER.access = ['Admin'];
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8160);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8160/?module=STOCKAVAILABILITY&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#sa-table-body tr:has-text("RM-001")', { timeout: 30000 });
    return page;
  }

  await check('the reserved figure lists its Sales Orders; one opens', async () => {
    const page = await open('u-admin');
    assert.equal((await page.textContent('.sa-reserved-btn')).trim(), '5.00');
    await page.click('.sa-reserved-btn');
    const rows = await page.$$eval('.sa-reserved-row tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /SO-26-01-000011 .*Example Buyer LLC 3\.00/);
    assert.match(rows[1], /SO-26-01-000012 .*2\.00/);
    // Clicked again: closed.
    await page.click('.sa-reserved-btn');
    assert.equal(await page.$('.sa-reserved-row'), null);
    await page.click('.sa-reserved-btn');
    await page.click('.sa-open-so:has-text("SO-26-01-000012")');
    await page.waitForSelector('#so-entry-view:not(.hidden)', { timeout: 30000 });
    assert.equal((await page.textContent('#so-entry-title')).trim(), 'SO-26-01-000012');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('without access to Sales Orders: listed, not links', async () => {
    const page = await open('u-viewer');
    await page.click('.sa-reserved-btn');
    await page.waitForSelector('.sa-reserved-row');
    assert.equal(await page.locator('.sa-open-so').count(), 0);
    assert.match(await page.textContent('.sa-reserved-row'), /SO-26-01-000011/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
