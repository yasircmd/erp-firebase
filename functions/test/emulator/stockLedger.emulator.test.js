// STOCKLEDGER report through its screen's callable, over REAL postings
// made with the hand-ported stock modules (GRN, Material Issue, Warehouse
// Movement) — the report must agree with the actual ledger balance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

test.before(async () => {
  await reset(baseFixture());
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 10, UnitCost: 5, Description: 'in' }] });
  await call('u-admin', 'postGrn', { grnId: g.grnId });
  const m = await call('u-admin', 'saveMaterialIssueDraft', { TransactionDate: today, Description: 'Issue', CompanyID: 'C1', EntryType: 'Issue',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 3, Description: 'out', CostCenterID: 'CC1' }] });
  await call('u-admin', 'postMaterialIssue', { miId: m.miId });
  const w = await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: today, Description: 'Move', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, Description: 'move' }] });
  await call('u-admin', 'postWarehouseMovement', { moveId: w.moveId });
});
test.after(async () => { await app.delete(); });

const params = (wh, from = '2000-01-01', to = '2099-12-31') => ({ params: { ItemID: 'I1', WarehouseID: wh, FromDate: from, ToDate: to } });

test('WH1: receipt, issue and transfer-out all appear; closing = actual ledger', async () => {
  const r = await call('u-admin', 'getStockLedgerReport', params('WH1'));
  assert.deepEqual(r.Rows.map(x => [x.TransactionType, x.Direction, x.Quantity]), [['GRN', 'In', 10], ['MaterialIssue', 'Out', 3], ['WarehouseMovement', 'Out', 2]]);
  assert.equal(r.ClosingQuantity, (await val('stock/ledger/I1/WH1')).Quantity);
  assert.equal(r.ClosingValue, (await val('stock/ledger/I1/WH1')).TotalValue);
});

test('WH2: transfer-in appears; closing = actual ledger', async () => {
  const r = await call('u-admin', 'getStockLedgerReport', params('WH2'));
  assert.deepEqual(r.Rows.map(x => [x.TransactionType, x.Direction, x.Quantity]), [['WarehouseMovement', 'In', 2]]);
  assert.equal(r.ClosingQuantity, (await val('stock/ledger/I1/WH2')).Quantity);
});

test('date window folds earlier movements into opening; validation', async () => {
  const r = await call('u-admin', 'getStockLedgerReport', params('WH1', '2099-01-01', '2099-12-31'));
  assert.equal(r.Rows.length, 0);
  assert.equal(r.OpeningQuantity, 5);
  await assert.rejects(call('u-admin', 'getStockLedgerReport', { params: { ItemID: 'I1', WarehouseID: 'WH1' } }), /Select a date range\./);
  await assert.rejects(call('u-other', 'getStockLedgerReport', params('WH1')), /You do not have access to that company\./);
});

test('a transaction with two lines for the same item+warehouse counts both', async () => {
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Two lines', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 4, UnitCost: 5, Description: 'a' },
            { ItemID: 'I1', WarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 6, UnitCost: 5, Description: 'b' }] });
  await call('u-admin', 'postGrn', { grnId: g.grnId });
  const r = await call('u-admin', 'getStockLedgerReport', params('WH2'));
  assert.equal(r.ClosingQuantity, (await val('stock/ledger/I1/WH2')).Quantity);
  assert.equal(r.ClosingQuantity, 12);
});
