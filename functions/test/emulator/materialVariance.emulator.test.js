// MATERIALVARIANCE report through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

const D = '2026-09-10';
function fixture(withReversal) {
  const f = baseFixture();
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  // 1 panel needs 2 sheets + 10% scrap = 2.2 sheets
  f.boms = { B1: { ParentItemID: 'FG1', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 2, ScrapPercent: 10 }] } };
  f.stock = { transactions: {
    P1: { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', TransactionDate: D, Lines: [{ ItemID: 'FG1', Direction: 'In', Quantity: 10 }] },
    M1: { TransactionType: 'MaterialIssue', Status: 'Posted', CompanyID: 'C1', TransactionDate: D, Lines: [{ ItemID: 'I1', Direction: 'Out', Quantity: 23 }] },
    M2: { TransactionType: 'MaterialIssue', Status: 'Posted', CompanyID: 'C1', TransactionDate: D, Lines: [{ ItemID: 'I1', Direction: 'In', Quantity: 1 }] }, // a return
    X9: { TransactionType: 'MaterialIssue', Status: 'Posted', CompanyID: 'C2', TransactionDate: D, Lines: [{ ItemID: 'I1', Direction: 'Out', Quantity: 500 }] }
  } };
  if (withReversal) {
    // Production P1 produced 10, then a partial run P2 of 4 was posted and REVERSED (P2R).
    f.stock.transactions.P2 = { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', TransactionDate: D, Lines: [{ ItemID: 'FG1', Direction: 'In', Quantity: 4 }] };
    f.stock.transactions.P2R = { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', TransactionDate: D, ReversalOfProduction: 'P2', Lines: [{ ItemID: 'FG1', Direction: 'Out', Quantity: 4 }] };
  }
  return f;
}
test.after(async () => { await app.delete(); });

const run = () => call('u-admin', 'getMaterialVarianceReport', { params: { CompanyID: 'C1', FromDate: '2026-09-01', ToDate: '2026-09-30' } });

test('expected (BOM x produced, with scrap) vs actual (issues net of returns), company-scoped', async () => {
  await reset(fixture(false));
  const r = await run();
  assert.deepEqual(r.ProducedItems.map(p => [p.ItemCode, p.Quantity, p.NoBomWarning]), [['FG-001', 10, false]]);
  assert.deepEqual(r.Rows.map(x => [x.ComponentItemCode, x.ExpectedConsumption, x.ActualConsumption, x.Variance, x.VariancePercent]),
    [['RM-001', 22, 22, 0, 0]]);
});

test('a reversed production run cancels out (Code.gs doubled it)', async () => {
  await reset(fixture(true));
  const r = await run();
  assert.deepEqual(r.ProducedItems.map(p => [p.ItemCode, p.Quantity]), [['FG-001', 10]]);
  assert.equal(r.Rows[0].ExpectedConsumption, 22);
});

test('validation', async () => {
  await assert.rejects(call('u-admin', 'getMaterialVarianceReport', { params: { CompanyID: 'C1' } }), /Select a date range\./);
  await assert.rejects(call('u-other', 'getMaterialVarianceReport', { params: { CompanyID: 'C1', FromDate: '2026-01-01', ToDate: '2026-12-31' } }), /You do not have access to that company\./);
});
