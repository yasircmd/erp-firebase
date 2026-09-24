// PRODCONSUMPTION report through its screen's callable, fed by REAL
// postings from each source module (so it reads exactly what those
// modules store), not hand-built transaction records.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-WO'] = { AccountCode: '5200', AccountName: 'Stock Write-off', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.itemSubCategories = { SC1: { Name: 'Sheets', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1' } };
  f.items.I1.SubCategoryID = 'SC1';
  f.items.I1.WriteOffAccountID = 'A-WO';
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.stock = { ledger: { I1: { WH1: { Quantity: 100, AvgCost: 5, TotalValue: 500 } } } };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const L = { WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', Description: 'x', CostCenterID: 'CC1' };
async function issue(qty) {
  const s = ok(await call('u-admin', 'saveMaterialIssueDraft', { TransactionDate: D, Description: 'Issue', CompanyID: 'C1', EntryType: 'Issue', CostCenterID: 'CC1',
    Lines: [Object.assign({ ItemID: 'I1', EnteredQuantity: qty }, L)] }));
  ok(await call('u-admin', 'postMaterialIssue', { miId: s.miId }));
}
async function adjustDown(qty) {
  const s = ok(await call('u-admin', 'saveStockAdjustmentDraft', { TransactionDate: D, Description: 'Damage', CompanyID: 'C1',
    Lines: [Object.assign({ ItemID: 'I1', AdjustmentDirection: 'Decrease', EnteredQuantity: qty }, L)] }));
  ok(await call('u-admin', 'postStockAdjustment', { adjId: s.adjId }));
}
async function count(counted) {
  const s = ok(await call('u-admin', 'savePhysicalCountDraft', { pcData: { TransactionDate: D, Description: 'Count', CompanyID: 'C1',
    Lines: [Object.assign({ ItemID: 'I1', CountedQuantity: counted }, L)] } }));
  ok(await call('u-admin', 'postPhysicalCount', { pcId: s.pcId }));
  return s.pcId;
}
async function produce(qty, cost) {
  const s = ok(await call('u-admin', 'saveProductionDraft', { prodData: { TransactionDate: D, Description: 'Run', CompanyID: 'C1',
    Lines: [Object.assign({ ItemID: 'FG1', EnteredQuantity: qty, UnitCost: cost }, L)] } }));
  ok(await call('u-admin', 'postProduction', { prodId: s.prodId }));
  return s.prodId;
}
const report = (type, extra, uid) => call(uid || 'u-admin', 'getProductionConsumptionReport', {
  params: Object.assign({ CompanyID: 'C1', ReportType: type, FromDate: '2026-09-01', ToDate: '2026-09-30' }, extra || {})
});
const rows = (r) => r.Rows.map(x => [x.ItemCode, x.Category, x.SubCategoryName, x.UOMCode, x.Quantity, x.Value]);

test('Production: net of reversals, valued, grouped by category', async () => {
  await reset(fixture());
  await produce(10, 12);
  const p2 = await produce(4, 12);
  ok(await call('u-admin', 'reverseProduction', { prodId: p2, reversalDate: D }));
  const r = await report('Production');
  assert.deepEqual(rows(r), [['FG-001', 'FinishedGood', '(No Sub-Category)', 'PCS', 10, 120]]);
  assert.equal(r.GrandTotalValue, 120);
});

test('Consumption: Material Issue + Stock Adjustment decrease + Physical Count shortfall, from real postings', async () => {
  await reset(fixture());
  await issue(3);        // 100 -> 97, 15
  await adjustDown(2);   // 97 -> 95, 10
  await count(91);       // 95 -> 91, shortfall 4 = 20
  const r = await report('Consumption');
  assert.deepEqual(rows(r), [['RM-001', 'RawMaterial', 'Sheets', 'PCS', 9, 45]]);
  assert.equal(r.GrandTotalValue, 45);
});

test('Consumption: a reversed Physical Count nets to zero', async () => {
  await reset(fixture());
  await issue(3);
  const pc = await count(90);  // 97 -> 90, shortfall 7
  ok(await call('u-admin', 'reversePhysicalCount', { pcId: pc, reversalDate: D }));
  const r = await report('Consumption');
  assert.deepEqual(rows(r), [['RM-001', 'RawMaterial', 'Sheets', 'PCS', 3, 15]]);
});

test('filters, validation and access', async () => {
  await reset(fixture());
  await issue(3);
  assert.deepEqual((await report('Consumption', { Category: 'FinishedGood' })).Rows, []);
  assert.equal((await report('Consumption', { SubCategoryID: 'SC1' })).Rows.length, 1);
  assert.deepEqual((await report('Consumption', { FromDate: '2026-10-01', ToDate: '2026-10-31' })).Rows, []);
  await assert.rejects(report('Other'), /Select Production or Consumption\./);
  await assert.rejects(report('Production', { FromDate: '' }), /Select a date range\./);
  await assert.rejects(report('Production', {}, 'u-other'), /You do not have access to that company\./);
  assert.equal((await report('Consumption', {}, 'u-viewer')).Rows.length, 1, 'Viewer has access');
});
