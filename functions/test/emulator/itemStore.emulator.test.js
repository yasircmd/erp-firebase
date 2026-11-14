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

// ---------- step 2: the reports (QI4, QI7) ----------

const { rtdb } = require('./_helpers');
const grn = async (itemId, qty) => {
  const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'R', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: itemId, WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: qty, UnitCost: 2, Description: 'x', CostCenterID: 'CC1' }] });
  await call('u-admin', 'postGrn', { grnId: s.grnId });
};

test('forReport, forReportLines, stocked and withReorderLevel: only the items asked for, of the company', async () => {
  const f = fixture();
  f.items.I4 = Object.assign({}, f.items.I2, { ItemCode: 'RM-004', CompanyID: 'C2' });
  f.items.I5 = Object.assign({}, f.items.I2, { ItemCode: 'RM-005', ReorderLevel: 10 });
  f.items.I6 = Object.assign({}, f.items.I2, { ItemCode: 'RM-006', ReorderLevel: '4' });
  f.items.I7 = Object.assign({}, f.items.I2, { ItemCode: 'RM-007', ReorderLevel: 0 });
  await reset(f);
  assert.deepEqual(Object.keys(await itemStore.forReport(['I1', 'I4', 'NOPE'], 'C1')).sort(), ['I1'], 'another company\'s item left out');
  assert.deepEqual(Object.keys(await itemStore.forReport(['I1', 'I4'], '')).sort(), ['I1', 'I4']);
  const byLines = await itemStore.forReportLines([{ ItemID: 'I2' }, { ItemCode: 'RM-003' }, { ItemCode: 'RM-004' }], 'C1');
  assert.deepEqual(Object.keys(byLines).sort(), ['I2', 'I3'], 'by id or by code; C2 left out');
  assert.deepEqual(Object.keys(await itemStore.withReorderLevel('C1')).sort(), ['I5', 'I6'], 'a level above 0, a number or text');
  assert.deepEqual(Object.keys(await itemStore.stocked('C1')), [], 'nothing moved yet');
  await grn('I2', 3);
  assert.deepEqual(Object.keys(await itemStore.stocked('C1')), ['I2']);
});

test('above BULK_AT items, one read of the list, still only the items asked for', async () => {
  await reset(fixture());
  const more = {}, want = ['I1'];
  for (let i = 0; i < itemStore.BULK_AT + 50; i++) { more['B' + i] = { ItemCode: 'B-' + i, ItemName: 'Bulk ' + i, Status: 'Active', CompanyID: i % 2 ? 'C1' : 'C2' }; want.push('B' + i); }
  await rtdb.ref('items').update(more);
  const got = await itemStore.forReport(want, 'C1');
  assert.equal(Object.keys(got).length, 1 + Math.floor((itemStore.BULK_AT + 50) / 2), 'C1\'s only');
  assert.ok(!got.I2 && !got.I3, 'items not asked for are not returned');
});

test('the Reorder report: a never-received item with a reorder level stays on it (QI7); a stocked one is counted', async () => {
  const f = fixture();
  f.items.I5 = Object.assign({}, f.items.I2, { ItemCode: 'RM-005', ItemName: 'Never received', ReorderLevel: 10 });
  f.items.I2.ReorderLevel = 5;
  await reset(f);
  await grn('I2', 3);
  const r = await call('u-admin', 'getReorderReport', { companyId: 'C1' });
  const rows = Object.fromEntries(r.Rows.map(x => [x.ItemCode, x]));
  assert.ok(rows['RM-005'], 'the never-received item with a level');
  assert.equal(rows['RM-005'].OnHand, 0);
  assert.equal(rows['RM-002'].OnHand, 3);
  assert.ok(!rows['RM-001'], 'no level, not listed');
});

test('a ported report (Stock Valuation) lists the stocked item from its ledger', async () => {
  await reset(fixture());
  await grn('I2', 4);
  const v = await call('u-admin', 'getStockValuationReport', { params: { CompanyID: 'C1' } });
  const rows = (v.rows || v.Rows || v.lines || []);
  assert.ok(JSON.stringify(v).includes('RM-002'), JSON.stringify(v).slice(0, 300));
  assert.ok(!JSON.stringify(v).includes('RM-001'), 'an item with no stock is not on it');
  assert.ok(Array.isArray(rows));
});
