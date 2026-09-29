// My Drafts in Home Tasks (docs/modules/DRAFT_TASKS.md): each draft task
// opens its module on that draft, ready to edit. Purchase Order and Sales
// Order learnt to open an entry from a task; Job Order Request learnt to
// open a draft batch (its approval tasks name a line). GRN and JV stand in
// for the screens that already opened entries from tasks; GRN now also
// waits for the permissions before opening one.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/draftTasks.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = '2026-09-10';
const ok = r => { assert.equal(r.success, true, r.error); return r; };

async function seed() {
  const f = baseFixture();
  f.vendors.V1.DefaultCurrency = 'AED';
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' } };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'AED' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 12, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.boms = { B1: { ParentItemID: 'FG1', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 2 }] } };
  await reset(f);
  const ids = {};
  ids.PURCHASEORDER = ok(await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: D, CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 2, UOM: 'box', UnitPrice: 8 }] } })).poId;
  ids.SALESORDER = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Description: 'Order for Retail', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 6, UnitPrice: 12 }] } })).soId;
  ids.JOBORDERREQUEST = ok(await call('u-admin', 'saveDraftJobOrderBatch', { header: { Origin: 'Production', CompanyID: 'C1', CostCenterID: 'CC1', JODate: D,
    Description: 'Panel run', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 5 }] } })).batchId;
  ids.GRN = ok(await call('u-admin', 'saveGrnDraft', { TransactionDate: D, Description: 'Steel receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, UnitCost: 5, Description: 'x' }] })).grnId;
  ids.JV = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 1, Description: 'a' }, { AccountCode: '1100', Credit: 1, Description: 'b' }] } })).jvId;
  return ids;
}

(async () => {
  const ids = await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8145);
  const browser = await chromium.launch();

  const tasks = await call('u-admin', 'getMyDraftsForUser', {});
  await check('the five drafts are the saver\'s tasks, each naming its module and document', async () => {
    assert.deepEqual(tasks.map(t => t.ModuleID + ':' + t.DocumentID).sort(), Object.entries(ids).map(([m, id]) => m + ':' + id).sort());
  });

  // As the shell's Home task does: openModule(id, { OpenEntryId }), after the
  // module has loaded once. Reference data (and, on the screens that wait for
  // them, the permissions) are held back so the entry list arrives first.
  async function openFromTask(module, holdPermissions) {
    const task = tasks.find(t => t.ModuleID === module);
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8145/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    for (const fn of ['getActiveCompanies', 'getActiveOrgUnits'].concat(holdPermissions === false ? [] : ['getModulePermissionsForUser'])) {
      await page.route('**/' + fn, async route => { await new Promise(r => setTimeout(r, 2000)); await route.continue(); });
    }
    await page.evaluate(([m, id]) => openModule(m, { OpenEntryId: id }), [module, task.DocumentID]);
    return page;
  }
  const done = async page => { assert.deepEqual(page.__dialogs, []); assert.deepEqual(page.__errors, []); await page.close(); };

  await check('Purchase Order: the task opens the draft for editing, with its company, cost center and vendor', async () => {
    const page = await openFromTask('PURCHASEORDER');
    await page.waitForSelector('#po-edit-view:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.inputValue('#po-form-company'), 'C1');
    assert.equal(await page.inputValue('#po-form-costcenter'), 'CC1');
    assert.equal(await page.inputValue('#po-form-vendor'), 'V1');
    assert.ok(await page.isVisible('#po-save-btn'), 'Save shown (permissions waited for)');
    await done(page);
  });

  await check('Sales Order: the task opens the draft for editing, with its customer and description', async () => {
    const page = await openFromTask('SALESORDER');
    await page.waitForSelector('#so-entry-view:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.inputValue('#so-form-description'), 'Order for Retail');
    assert.equal(await page.inputValue('#so-form-company'), 'C1');
    assert.equal(await page.inputValue('#so-form-customer'), 'CU1');
    assert.equal(await page.inputValue('#so-form-costcenter'), 'CC1');
    assert.ok(await page.isVisible('#so-save-draft-btn'));
    await done(page);
  });

  await check('Job Order Request: the task opens the draft batch for editing', async () => {
    const page = await openFromTask('JOBORDERREQUEST');
    await page.waitForSelector('#jo-batch-edit-view:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.inputValue('#jo-form-description'), 'Panel run');
    assert.equal(await page.inputValue('#jo-form-company'), 'C1');
    assert.equal(await page.inputValue('#jo-form-costcenter'), 'CC1');
    assert.ok(await page.isVisible('#jo-save-batch-btn'), 'Save shown (permissions waited for)');
    await done(page);
  });

  for (const [module, view, desc, text, save, holdPermissions] of [
    ['GRN', '#grn-entry-view', '#grn-form-description', 'Steel receipt', '#grn-save-draft-btn', true],
    ['JV', '#jv-entry-view', '#jv-form-description', 'Accrual', '#jv-save-draft-btn', false]
  ]) {
    await check(module + ': the task opens the draft for editing', async () => {
      const page = await openFromTask(module, holdPermissions);
      await page.waitForSelector(view + ':not(.hidden)', { timeout: 30000 });
      await page.waitForTimeout(2500);
      assert.equal(await page.inputValue(desc), text);
      assert.ok(await page.isVisible(save));
      await done(page);
    });
  }

  await check('Purchase Order: a draft deleted since says so and stays on the list', async () => {
    ok(await call('u-admin', 'deleteDraftPurchaseOrder', { poId: ids.PURCHASEORDER }));
    const page = await openFromTask('PURCHASEORDER');
    await page.waitForFunction(() => window.__rpcLog.filter(c => c.name === 'getModulePermissionsForUser').length >= 2, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    assert.deepEqual(page.__dialogs, ['That Purchase Order could not be found — it may have been deleted.']);
    assert.ok(await page.isVisible('#po-list-view'));
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
