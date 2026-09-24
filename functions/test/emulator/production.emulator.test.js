// PRODUCTION through its screen's callables: post (stock In at the entered
// unit cost, Dr Inventory / Cr the item's Consumption account), Job Order
// line matching + progress + Sales Order allocation, reversal (stock back
// out, this posting's own reservations released, Job Order rolled back),
// approval gate, pickers, access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.items.FG2 = { ItemCode: 'FG-002', ItemName: 'Door', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  // A Sales-origin Job Order, submitted: line JL1 (FG-001 x10, Accepted, linked to SO1/L1 which is short 6).
  f.jobOrderBatches = {
    JB1: { Origin: 'Sales', CompanyID: 'C1', CostCenterID: 'CC1', Status: 'Submitted', BatchNumber: 'JOB-26-01-000001', CreatedAt: '2026-09-01' },
    JBD: { Origin: 'Production', CompanyID: 'C1', CostCenterID: 'CC1', Status: 'Draft', BatchNumber: '', CreatedAt: '2026-09-02' }
  };
  f.jobOrderLines = {
    JL1: { ParentBatchID: 'JB1', LineNumber: 1, ItemCode: 'FG-001', OrderedQuantity: 10, Status: 'Accepted', SubJONumber: 'JOB-26-01-000001/01',
      LinkedSalesOrderLines: [{ SOID: 'SO1', SOLineID: 'L1', SONumber: 'SO-1' }] }
  };
  f.salesOrders = {
    SO1: { SONumber: 'SO-1', CompanyID: 'C1', Status: 'Partially Reserved', Lines: [{ LineID: 'L1', ItemCode: 'FG-001', WarehouseID: 'WH1', OrderedQuantity: 6 }] }
  };
  f.inventoryValuationLines = {
    V1: { CompanyID: 'C1', ItemCode: 'FG-001', UnitCost: 11, EffectiveFrom: '2026-01-01', Status: 'Active' },
    V2: { CompanyID: 'C1', ItemCode: 'FG-001', UnitCost: 12, EffectiveFrom: '2026-09-05', Status: 'Active' },
    V3: { CompanyID: 'C1', ItemCode: 'FG-001', UnitCost: 99, EffectiveFrom: '2026-09-06', Status: 'Inactive' }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const ledger = async (i, w) => { const l = (await val('stock/ledger/' + i + '/' + w)) || {}; return [l.Quantity || 0, l.AvgCost || 0, l.TotalValue || 0]; };
const line = (o) => Object.assign({ ItemID: 'FG1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 4, UnitCost: 12, Description: 'Run', CostCenterID: 'CC1' }, o);
const draft = (lines, extra, uid) => call(uid || 'u-admin', 'saveProductionDraft', {
  prodData: Object.assign({ TransactionDate: D, Description: 'Panel run', CompanyID: 'C1', Lines: lines }, extra || {})
});
const postNew = async (lines, extra) => {
  const s = await draft(lines, extra);
  assert.equal(s.success, true, s.error);
  const p = await call('u-admin', 'postProduction', { prodId: s.prodId });
  assert.equal(p.success, true, p.error);
  return s.prodId;
};
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId }))
  .Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();
const reservations = async () => Object.values((await val('stock/reservations')) || {}).map(r => [r.SourceID, r.Quantity, r.Status]).sort();

test('post without a Job Order: stock In at entered cost; Dr Inventory / Cr Consumption', async () => {
  await reset(fixture());
  const id = await postNew([line({ EnteredQuantity: 5, UnitCost: 12 })]);
  assert.deepEqual(await ledger('FG1', 'WH1'), [5, 12, 60]);
  const rec = await val('stock/transactions/' + id);
  assert.equal(rec.Status, 'Posted');
  assert.match(rec.TransactionNumber, /^PRD-/);
  assert.deepEqual(await jvLines(rec.LinkedJVID), [['1300', 60, 0], ['5100', 0, 60]]);
});

test('Job Order: matched line gets JobOrderLineID, progress, and FIFO allocation to its linked Sales Order', async () => {
  await reset(fixture());
  const p1 = await postNew([line({ EnteredQuantity: 8 }), line({ ItemID: 'FG2', EnteredQuantity: 1 })], { JobOrderID: 'JB1' });
  const rec = await val('stock/transactions/' + p1);
  assert.deepEqual(rec.Lines.map(l => [l.ItemCode, l.JobOrderLineID]), [['FG-001', 'JL1'], ['FG-002', undefined]]);
  assert.equal((await val('jobOrderLines/JL1')).Status, 'In Progress');
  // 8 produced, SO1/L1 short 6 -> one reservation of 6 tagged with this posting; SO fully covered.
  const res = Object.values(await val('stock/reservations'));
  assert.deepEqual(res.map(r => [r.SourceID, r.SourceLineID, r.Quantity, r.Status, r.CreatedByProductionID]), [['SO1', 'L1', 6, 'Active', p1]]);
  assert.equal((await val('salesOrders/SO1')).Status, 'Reserved');

  await postNew([line({ EnteredQuantity: 2 })], { JobOrderID: 'JB1' });
  const jl = await val('jobOrderLines/JL1');
  assert.equal(jl.Status, 'Completed');
  assert.deepEqual(await reservations(), [['SO1', 6, 'Active']], 'nothing left to allocate');
  assert.deepEqual(await ledger('FG1', 'WH1'), [10, 12, 120]);
});

test('reversal: stock out, mirror GL, this posting\'s reservations released, Job Order rolled back', async () => {
  await reset(fixture());
  const p1 = await postNew([line({ EnteredQuantity: 8 })], { JobOrderID: 'JB1' });
  const r = await call('u-admin', 'reverseProduction', { prodId: p1, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.deepEqual(await ledger('FG1', 'WH1'), [0, 0, 0]);
  const rev = await val('stock/transactions/' + r.prodId);
  assert.equal(rev.ReversalOfProduction, p1);
  assert.deepEqual(rev.Lines.map(l => [l.Direction, l.Quantity, l.JobOrderLineID]), [['Out', 8, 'JL1']]);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1300', 0, 96], ['5100', 96, 0]]);
  assert.equal((await val('stock/transactions/' + p1)).ReversedByProduction, r.prodId);
  assert.deepEqual(await reservations(), [['SO1', 6, 'Released']]);
  assert.equal((await val('salesOrders/SO1')).Status, 'Partially Reserved');
  assert.equal((await val('jobOrderLines/JL1')).Status, 'Accepted', 'back to its pre-production status');
  assert.equal((await call('u-admin', 'reverseProduction', { prodId: p1, reversalDate: D })).error, 'This Production entry has already been reversed.');
});

test('a reversal entry cannot itself be reversed (Code.gs took the stock out twice)', async () => {
  await reset(fixture());
  await rtdb.ref('stock/ledger/FG1/WH1').set({ Quantity: 20, AvgCost: 12, TotalValue: 240 });
  const p1 = await postNew([line({ EnteredQuantity: 5 })]);
  const r = await call('u-admin', 'reverseProduction', { prodId: p1, reversalDate: D });
  assert.deepEqual(await ledger('FG1', 'WH1'), [20, 12, 240]);
  const rr = await call('u-admin', 'reverseProduction', { prodId: r.prodId, reversalDate: D });
  assert.deepEqual(rr, { success: false, error: 'A reversal entry cannot itself be reversed.' });
  assert.deepEqual(await ledger('FG1', 'WH1'), [20, 12, 240], 'ledger untouched');
});

test('reversal is refused once the produced stock has been consumed', async () => {
  await reset(fixture());
  const p1 = await postNew([line({ EnteredQuantity: 5 })]);
  await rtdb.ref('stock/ledger/FG1/WH1').set({ Quantity: 2, AvgCost: 12, TotalValue: 24 });
  const r = await call('u-admin', 'reverseProduction', { prodId: p1, reversalDate: D });
  assert.equal(r.success, false);
  assert.match(r.error, /insufficient|not enough|only 2/i);
  assert.deepEqual(await ledger('FG1', 'WH1'), [2, 12, 24]);
});

test('approval gate: nothing (stock, GL, Job Order, reservations) moves until approved', async () => {
  const f = fixture();
  f.approvalConfigurations = { PRODUCTION: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PRODUCTION: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft([line({ EnteredQuantity: 8 })], { JobOrderID: 'JB1' });
  assert.deepEqual(await call('u-admin', 'postProduction', { prodId: s.prodId }), { success: true, status: 'PendingApproval' });
  assert.deepEqual(await ledger('FG1', 'WH1'), [0, 0, 0]);
  assert.equal((await val('jobOrderLines/JL1')).Status, 'Accepted');
  assert.equal(await val('stock/reservations'), null);

  const d = await call('u-approver', 'decideProductionApproval', { prodId: s.prodId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(d.success, true, d.error);
  assert.deepEqual(await ledger('FG1', 'WH1'), [8, 12, 96]);
  assert.equal((await val('jobOrderLines/JL1')).Status, 'In Progress');
  assert.deepEqual(await reservations(), [['SO1', 6, 'Active']]);
});

test('pickers: eligible Job Orders (submitted, company-scoped) and valuation cost effective on a date', async () => {
  await reset(fixture());
  const jos = await call('u-admin', 'getEligibleJobOrderBatchesForProduction', { companyId: 'C1' });
  assert.deepEqual(jos.map(b => [b.BatchNumber, b.Lines.map(l => l.ItemCode)]), [['JOB-26-01-000001', ['FG-001']]]);
  assert.deepEqual(await call('u-other', 'getEligibleJobOrderBatchesForProduction', { companyId: 'C1' }), []);
  const cost = (date) => call('u-admin', 'getItemCostForProduction', { companyId: 'C1', itemCode: 'FG-001', date });
  assert.equal(await cost('2026-09-04'), 11);
  assert.equal(await cost('2026-09-10'), 12, 'inactive 99 ignored');
  assert.equal(await cost('2025-12-31'), null);
});

test('validation, list, delete and access', async () => {
  await reset(fixture());
  const err = async (lines, extra) => (await draft(lines, extra)).error;
  assert.match(await err([line({ UnitCost: 0 })]), /unit cost greater than zero/);
  assert.match(await err([line({ EnteredQuantity: 0 })]), /quantity greater than zero/);
  assert.match(await err([line({ WarehouseID: 'CC1' })]), /warehouse not found/);
  assert.match(await err([line({ EnteredQuantity: 1.5 })]), /does not allow decimal/);
  assert.equal(await err([line()], { JobOrderID: 'JBD' }), 'Selected Job Order has not been submitted yet.');
  assert.equal(await err([line()], { JobOrderID: 'NOPE' }), 'Selected Job Order not found.');
  assert.equal((await draft([line()], {}, 'u-viewer')).success, false);
  assert.equal((await draft([line()], {}, 'u-other')).error, 'You do not have access to that company.');

  const s = await draft([line()]);
  assert.deepEqual((await call('u-admin', 'getProductionEntries', { limit: 'all' })).entries.map(e => e.ProductionID), [s.prodId]);
  assert.equal((await call('u-other', 'getProductionEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'postProduction', { prodId: s.prodId })).success, false);
  assert.deepEqual(await call('u-admin', 'deleteProductionDraft', { prodId: s.prodId }), { success: true });
  assert.equal(await val('stock/transactions/' + s.prodId), null);
});
