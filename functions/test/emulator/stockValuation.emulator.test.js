// STOCKVALUATION report through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.before(async () => {
  const f = baseFixture();
  f.orgUnits.RK1 = { Type: 'Rack', Code: 'R1', Name: 'Rack 1', ParentUnitID: 'WH1', Status: 'Active', CompanyID: 'C1' };
  f.items.I2 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.items.IX = { ItemCode: 'RM-X', ItemName: 'Other co', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C2', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.stock = { ledger: {
    I1: { WH1: { Quantity: 10, AvgCost: 4, TotalValue: 40 }, RK1: { Quantity: 5, AvgCost: 6, TotalValue: 30 }, WH2: { Quantity: 0, AvgCost: 0, TotalValue: 0 } },
    I2: { WH2: { Quantity: 2, AvgCost: 25, TotalValue: 50 } },
    IX: { WH1: { Quantity: 1, AvgCost: 1, TotalValue: 1 } }
  } };
  await reset(f);
});
test.after(async () => { await app.delete(); });

test('racks aggregate into their warehouse by default; zero rows and other companies excluded', async () => {
  const r = await call('u-admin', 'getStockValuationReport', { params: { CompanyID: 'C1' } });
  assert.deepEqual(r.rows.map(x => [x.ItemCode, x.LocationLabel, x.Quantity, x.TotalValue, x.AvgCost]), [
    ['FG-001', 'WH2', 2, 50, 25], ['RM-001', 'WH1', 15, 70, 4.6667]]);
  assert.equal(r.grandTotal, 120);
});

test('per-rack view and category filter', async () => {
  const r = await call('u-admin', 'getStockValuationReport', { params: { CompanyID: 'C1', AggregateRacks: false, Category: 'RawMaterial' } });
  assert.deepEqual(r.rows.map(x => [x.ItemCode, x.LocationLabel, x.Quantity]), [['RM-001', 'WH1', 10], ['RM-001', 'WH1 / R1', 5]]);
  await assert.rejects(call('u-other', 'getStockValuationReport', { params: { CompanyID: 'C1' } }), /You do not have access to that company\./);
});
