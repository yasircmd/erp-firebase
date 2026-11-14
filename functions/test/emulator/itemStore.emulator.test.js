// The item store, step 1 (docs/modules/ITEMS_FIRESTORE.md, QI1): items by
// id and by code, in the shape a whole read gave; the readers that use it
// still find their items, and still refuse an unknown one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { call, reset, baseFixture, today } = require('./_helpers');
const itemStore = require('../../src/itemStore');

// The store runs in this process too (the default app): close every app.
test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

function fixture() {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Copper Wire', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.items.I3 = { ItemCode: 'RM-003', ItemName: 'Old Part', Category: 'RawMaterial', Status: 'Inactive', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' };
  return f;
}

test('byIds, forLines and byCodes: only the items asked for, as { id: item }', async () => {
  await reset(fixture());
  assert.deepEqual(Object.keys(await itemStore.byIds(['I1', 'I3', 'NOPE', 'I1'])).sort(), ['I1', 'I3'], 'an unknown id is absent');
  assert.equal((await itemStore.byIds(['I2'])).I2.ItemName, 'Copper Wire');
  assert.deepEqual(await itemStore.byIds([]), {});
  assert.deepEqual(Object.keys(await itemStore.forLines([{ ItemID: 'I2' }, { CategoryID: 'X' }], [{ ItemID: 'I1' }])).sort(), ['I1', 'I2']);
  const byCode = await itemStore.byCodes(['RM-003', 'RM-001', 'NOPE', '']);
  assert.deepEqual(Object.keys(byCode).sort(), ['I1', 'I3'], 'by code, keyed by id');
  assert.equal(byCode.I3.ItemCode, 'RM-003');
});

test('a GRN still finds its line\'s item, and refuses an unknown one; it posts', async () => {
  await reset(fixture());
  const line = { ItemID: 'I2', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 3, UnitCost: 7, Description: 'Wire', CostCenterID: 'CC1' };
  const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'R', CompanyID: 'C1', VendorID: 'V1', Lines: [line] });
  assert.equal(s.success, true, JSON.stringify(s));
  const p = await call('u-admin', 'postGrn', { grnId: s.grnId });
  assert.notEqual(p && p.success, false, JSON.stringify(p));
  await assert.rejects(call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'R', CompanyID: 'C1', VendorID: 'V1', Lines: [Object.assign({}, line, { ItemID: 'NOPE' })] }),
    /Line 1: item not found/);
});

test('a ported reader by code (a Price Listing line) finds its item, and refuses an inactive one', async () => {
  const f = fixture();
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', CurrencyID: 'AED', Status: 'Active' } };
  await reset(f);
  const ok = await call('u-admin', 'savePriceListLine', { lineData: { PriceListID: 'PL1', ItemCode: 'RM-002', UnitPrice: 12, EffectiveFrom: today } }).catch(e => ({ error: e.message }));
  assert.ok(!ok.error && ok.success !== false, JSON.stringify(ok));
  const bad = await call('u-admin', 'savePriceListLine', { lineData: { PriceListID: 'PL1', ItemCode: 'RM-003', UnitPrice: 12, EffectiveFrom: today } }).catch(e => ({ error: e.message }));
  assert.match(String(bad.error || (bad.success === false && bad.error)), /Item not found or inactive: RM-003/);
});
