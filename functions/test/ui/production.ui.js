// Production Entry opened before its lists have loaded (owner, 2026-10-24;
// docs/modules/UX_ROUND2.md item 4): the item names showed "not found" and
// the Job Order "not linked". The item list is slowed on purpose here; the
// entry waits for it. A posted entry's Job Order (no longer open for
// production) still shows, by number.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/production.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.items.FG2 = { ItemCode: 'FG-002', ItemName: 'Door', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.jobOrderBatches = {
    JB1: { Origin: 'Production', CompanyID: 'C1', CostCenterID: 'CC1', Status: 'Submitted', BatchNumber: 'JOB-26-01-000001', CreatedAt: '2026-09-01' },
    JB2: { Origin: 'Production', CompanyID: 'C1', CostCenterID: 'CC1', Status: 'Submitted', BatchNumber: 'JOB-26-01-000002', CreatedAt: '2026-09-02' }
  };
  f.jobOrderLines = {
    JL1: { ParentBatchID: 'JB1', LineNumber: 1, ItemCode: 'FG-001', OrderedQuantity: 4, Status: 'Accepted', SubJONumber: 'JOB-26-01-000001/01' },
    JL2: { ParentBatchID: 'JB2', LineNumber: 1, ItemCode: 'FG-002', OrderedQuantity: 9, Status: 'Accepted', SubJONumber: 'JOB-26-01-000002/01' }
  };
  await reset(f);
  const line = o => Object.assign({ ItemID: 'FG1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 4, UnitCost: 12, Description: 'Run', CostCenterID: 'CC1' }, o);
  const save = async (lines, extra) => {
    const s = await call('u-admin', 'saveProductionDraft', { prodData: Object.assign({ TransactionDate: '2026-09-10', Description: 'Panel run', CompanyID: 'C1', Lines: lines }, extra) });
    assert.equal(s.success, true, s.error);
    return s.prodId;
  };
  // Posted, which completes JB1; and a draft on JB2, still open.
  const posted = await save([line()], { JobOrderID: 'JB1', Description: 'Posted run' });
  assert.equal((await call('u-admin', 'postProduction', { prodId: posted })).success, true);
  await save([line({ ItemID: 'FG2', EnteredQuantity: 3 })], { JobOrderID: 'JB2', Description: 'Draft run' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8157);
  const browser = await chromium.launch();
  async function open(slowItemsMs) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    // The item list answers late, after the entries list.
    await page.route('**/us-central1/getActiveItems', async route => { await new Promise(r => setTimeout(r, slowItemsMs)); route.continue(); });
    await page.goto('http://127.0.0.1:8157/?module=PRODUCTION&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const openRow = async (page, description) => {
    const row = page.locator('#prd-table-body tr', { hasText: description });
    await row.waitFor({ timeout: 30000 });
    await row.locator('.prd-open').click();
  };
  const names = page => page.$$eval('#prd-grid-body .prd-item-name', tds => tds.map(td => td.textContent.trim()).filter(Boolean));

  await check('a posted entry opened before the items arrive: its item named, its completed Job Order shown by number', async () => {
    const page = await open(2500);
    await openRow(page, 'Posted run');
    await page.waitForSelector('#prd-entry-view:not(.hidden)', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('prd-form-joborder').value !== '', null, { timeout: 15000 });
    assert.deepEqual(await names(page), ['Panel']);
    assert.equal(await page.inputValue('#prd-form-joborder'), 'JB1');
    assert.equal(await page.$eval('#prd-form-joborder', s => s.selectedOptions[0].textContent), 'JOB-26-01-000001 (no longer open for production)');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('a draft opened before the items arrive: its item named, its open Job Order selected', async () => {
    const page = await open(2500);
    await openRow(page, 'Draft run');
    await page.waitForSelector('#prd-entry-view:not(.hidden)', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('prd-form-joborder').value === 'JB2', null, { timeout: 15000 });
    assert.deepEqual(await names(page), ['Door']);
    assert.ok(!(await page.$eval('#prd-form-joborder', s => s.selectedOptions[0].textContent)).includes('no longer open'));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
