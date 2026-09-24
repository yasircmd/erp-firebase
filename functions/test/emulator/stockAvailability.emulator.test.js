// STOCKAVAILABILITY report through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.before(async () => {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.items.I3 = { ItemCode: 'RM-NOPRICE', ItemName: 'Not sellable', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.priceListLines = { L1: { ItemCode: 'FG-001', UnitPrice: 50 }, L2: { ItemCode: 'RM-001', UnitPrice: 9 } };
  f.stock = {
    ledger: {
      I1: { WH1: { Quantity: 10, AvgCost: 4, TotalValue: 40 } },
      I2: { WH1: { Quantity: 3, AvgCost: 20, TotalValue: 60 }, WH2: { Quantity: 0, AvgCost: 0, TotalValue: 0 } },
      I3: { WH1: { Quantity: 99, AvgCost: 1, TotalValue: 99 } }
    },
    reservations: {
      R1: { ItemID: 'I2', WarehouseID: 'WH1', Quantity: 2, Status: 'Active' },
      R2: { ItemID: 'I2', WarehouseID: 'WH2', Quantity: 1, Status: 'Active' },
      R3: { ItemID: 'I2', WarehouseID: 'WH1', Quantity: 5, Status: 'Released' }
    }
  };
  await reset(f);
});
test.after(async () => { await app.delete(); });

test('on hand - active reservations, sellable items only, zero rows dropped', async () => {
  const rows = await call('u-admin', 'getStockAvailabilityList', { companyId: 'C1' });
  assert.deepEqual(rows.map(r => [r.ItemCode, r.WarehouseCode, r.OnHand, r.Reserved, r.Available]), [
    ['FG-001', 'WH1', 3, 2, 1],
    ['FG-001', 'WH2', 0, 1, -1],
    ['RM-001', 'WH1', 10, 0, 10]
  ]);
});

test('company required and access-checked', async () => {
  await assert.rejects(call('u-admin', 'getStockAvailabilityList', { companyId: '' }), /Select a Company\./);
  await assert.rejects(call('u-other', 'getStockAvailabilityList', { companyId: 'C1' }), /You do not have access to that company\./);
});
