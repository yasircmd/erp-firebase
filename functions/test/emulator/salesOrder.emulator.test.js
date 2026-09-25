// SALESORDER through its screen's callables: price list from the
// customer's classification, dated item price, sellable-item picker,
// draft, confirm (reserve min(ordered, free), Reserved vs Partially
// Reserved), manual claim/release, cancel releasing everything, delete,
// list with live reserved quantities, and access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Cabinet', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS' };
  f.items.I3 = { ItemCode: 'FG-003', ItemName: 'Unpriced', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS' };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' },
    CU2: { CustomerCode: 'C002', CustomerName: 'No List', Status: 'Active', CompanyID: 'C1', Classification: 'Export' },
    CU3: { CustomerCode: 'C003', CustomerName: 'Gone', Status: 'Inactive', CompanyID: 'C1', Classification: 'Retail' }
  };
  f.priceLists = {
    PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'AED' },
    PL2: { Name: 'Retail C2', CompanyID: 'C2', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'USD' }
  };
  f.priceListLines = {
    L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 10, EffectiveFrom: '2026-01-01', Status: 'Active' },
    L2: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 12, EffectiveFrom: '2026-09-01', Status: 'Active' },
    L3: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 99, EffectiveFrom: '2026-12-01', Status: 'Active' },
    L4: { PriceListID: 'PL1', ItemCode: 'FG-002', UnitPrice: 50, EffectiveFrom: '2026-01-01', Status: 'Active' }
  };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 5, TotalValue: 50 } } } };
  return f;
}
test.after(async () => { await app.delete(); });

const line = (o) => Object.assign({ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 6, UnitPrice: 12 }, o);
const draft = (lines, extra, uid) => call(uid || 'u-admin', 'saveDraftSalesOrder', {
  header: Object.assign({ SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: lines }, extra || {})
});
const reservations = async () => Object.values((await val('stock/reservations')) || {});
const activeFor = async (soId) => (await reservations()).filter(r => r.SourceID === soId && r.Status === 'Active')
  .reduce((s, r) => s + r.Quantity, 0);
const so = (id) => val('salesOrders/' + id);

test('pricing: list from classification (own company), price effective on the date, sellable items', async () => {
  await reset(fixture());
  const pl = await call('u-admin', 'getPriceListForCustomer', { companyId: 'C1', customerId: 'CU1' });
  assert.equal(pl.PriceListID, 'PL1');
  assert.equal((await call('u-admin', 'getPriceListForCustomer', { companyId: 'C2', customerId: 'CU1' })).PriceListID, 'PL2');
  assert.equal(await call('u-admin', 'getPriceListForCustomer', { companyId: 'C1', customerId: 'CU2' }), null);
  assert.equal(await call('u-admin', 'getItemPriceOnPriceList', { priceListId: 'PL1', itemCode: 'RM-001', date: D }), 12);
  assert.equal(await call('u-admin', 'getItemPriceOnPriceList', { priceListId: 'PL1', itemCode: 'RM-001', date: '2026-03-01' }), 10);
  assert.equal(await call('u-admin', 'getItemPriceOnPriceList', { priceListId: 'PL1', itemCode: 'RM-001', date: '2025-12-31' }), null);
  assert.equal(await call('u-admin', 'getItemPriceOnPriceList', { priceListId: '', itemCode: 'RM-001', date: D }), null);
  assert.deepEqual((await call('u-admin', 'getSellableItems', {})).map(i => i.ItemCode).sort(), ['FG-002', 'RM-001']);
  assert.deepEqual((await call('u-admin', 'getActiveCustomers', {})).map(c => c.CustomerID).sort(), ['CU1', 'CU2']);
});

test('draft keeps LineIDs across edits; confirm reserves what is free: Reserved, then Partially Reserved', async () => {
  await reset(fixture());
  const a = await draft([line(), line({ ItemCode: '' })]);
  assert.equal(a.success, true, a.error);
  let rec = await so(a.soId);
  assert.equal(rec.Status, 'Draft');
  assert.equal(rec.SONumber, '');
  assert.equal(rec.PriceListID, 'PL1');
  assert.equal(rec.CurrencyID, 'AED');
  assert.equal(rec.Total, 72);
  assert.equal(rec.Lines.length, 1);
  const lineId = rec.Lines[0].LineID;
  assert.match(lineId, /^SOL-/);
  assert.equal(rec.Lines[0].EnteredUOMID, 'UOM-PCS');
  assert.equal((await draft([line({ LineID: lineId, OrderedQuantity: 7 })], { SOID: a.soId })).success, true);
  rec = await so(a.soId);
  assert.equal(rec.Lines[0].LineID, lineId, 'LineID survives an edit');

  const c1 = await call('u-admin', 'confirmSalesOrder', { soId: a.soId });
  assert.equal(c1.success, true, c1.error);
  assert.equal(c1.status, 'Reserved');
  assert.match(c1.soNumber, /SO/);
  assert.equal(await activeFor(a.soId), 7);

  const b = await draft([line({ OrderedQuantity: 5 }), line({ ItemCode: 'FG-002', OrderedQuantity: 2, UnitPrice: 50 })]);
  const c2 = await call('u-admin', 'confirmSalesOrder', { soId: b.soId });
  assert.equal(c2.status, 'Partially Reserved', c2.error);
  assert.equal(await activeFor(b.soId), 3, 'only the 3 still free; FG-002 has no stock and gets no reservation');
  assert.equal((await reservations()).length, 2);

  const listed = (await call('u-admin', 'getSalesOrderEntries', {})).entries.find(e => e.SOID === b.soId);
  assert.deepEqual(listed.Lines.map(l => l.ReservedQuantity), [3, 0]);
  assert.match((await call('u-admin', 'confirmSalesOrder', { soId: b.soId })).error, /Only a Draft/);
  assert.match((await draft([line()], { SOID: b.soId })).error, /Only a Draft Sales Order can be edited/);
});

test('claim and release: manual reallocation between orders, with reasons and limits', async () => {
  await reset(fixture());
  const a = await draft([line({ OrderedQuantity: 8 })]);
  await call('u-admin', 'confirmSalesOrder', { soId: a.soId });
  const b = await draft([line({ OrderedQuantity: 6 })]);
  await call('u-admin', 'confirmSalesOrder', { soId: b.soId });
  const aLine = (await so(a.soId)).Lines[0].LineID;
  const bLine = (await so(b.soId)).Lines[0].LineID;
  assert.equal(await activeFor(b.soId), 2);

  assert.match((await call('u-admin', 'claimStockForSalesOrderLine', { soId: b.soId, lineId: bLine, quantity: 1, reason: 'VIP' })).error, /Not enough free stock available to claim \(0 available\)/);
  assert.match((await call('u-admin', 'releaseStockForSalesOrderLine', { soId: a.soId, lineId: aLine, quantity: 3, reason: '' })).error, /reason is required/);
  assert.match((await call('u-admin', 'releaseStockForSalesOrderLine', { soId: a.soId, lineId: aLine, quantity: 9, reason: 'x' })).error, /more than is currently reserved for this line \(8\)/);

  assert.deepEqual(await call('u-admin', 'releaseStockForSalesOrderLine', { soId: a.soId, lineId: aLine, quantity: 3, reason: 'Rush order for B' }), { success: true });
  assert.equal(await activeFor(a.soId), 5);
  assert.equal((await so(a.soId)).Status, 'Partially Reserved', 'status refreshed after release');

  assert.match((await call('u-admin', 'claimStockForSalesOrderLine', { soId: b.soId, lineId: bLine, quantity: 5, reason: 'VIP' })).error, /outstanding shortfall \(4\)/);
  assert.match((await call('u-admin', 'claimStockForSalesOrderLine', { soId: b.soId, lineId: bLine, quantity: 3, reason: ' ' })).error, /reason is required/);
  assert.deepEqual(await call('u-admin', 'claimStockForSalesOrderLine', { soId: b.soId, lineId: bLine, quantity: 3, reason: 'VIP' }), { success: true });
  assert.equal(await activeFor(b.soId), 5);
  assert.equal((await reservations()).find(r => r.Reason === 'VIP').Quantity, 3);

  // Release the rest of A: its full reservation is released, not left at 0.
  assert.deepEqual(await call('u-admin', 'releaseStockForSalesOrderLine', { soId: a.soId, lineId: aLine, quantity: 5, reason: 'All to B' }), { success: true });
  assert.equal(await activeFor(a.soId), 0);
  assert.equal((await reservations()).filter(r => r.SourceID === a.soId && r.Status === 'Active').length, 0);
  assert.match((await call('u-admin', 'claimStockForSalesOrderLine', { soId: b.soId, lineId: 'NOPE', quantity: 1, reason: 'x' })).error, /Line not found/);
});

test('cancel releases every reservation; draft cancel and delete', async () => {
  await reset(fixture());
  const a = await draft([line({ OrderedQuantity: 10 })]);
  await call('u-admin', 'confirmSalesOrder', { soId: a.soId });
  assert.equal(await activeFor(a.soId), 10);
  const c = await call('u-admin', 'cancelSalesOrder', { soId: a.soId, reason: ' Customer cancelled ' });
  assert.deepEqual(c, { success: true, releasedCount: 1 });
  assert.equal(await activeFor(a.soId), 0);
  const rec = await so(a.soId);
  assert.equal(rec.Status, 'Cancelled');
  assert.equal(rec.CancelReason, 'Customer cancelled');
  assert.match((await call('u-admin', 'cancelSalesOrder', { soId: a.soId })).error, /already Cancelled/);
  assert.match((await call('u-admin', 'claimStockForSalesOrderLine', { soId: a.soId, lineId: rec.Lines[0].LineID, quantity: 1, reason: 'x' })).error, /only be claimed for a Reserved/);

  const b = await draft([line()]);
  assert.equal(await activeFor(b.soId), 0);
  assert.equal((await call('u-admin', 'confirmSalesOrder', { soId: b.soId })).status, 'Reserved', 'freed stock is available again');
  const d = await draft([line()]);
  assert.deepEqual(await call('u-admin', 'cancelSalesOrder', { soId: d.soId }), { success: true, releasedCount: 0 });
  assert.match((await call('u-admin', 'deleteDraftSalesOrder', { soId: d.soId })).error, /Only a Draft/);
  const e = await draft([line()]);
  assert.deepEqual(await call('u-admin', 'deleteDraftSalesOrder', { soId: e.soId }), { success: true });
  assert.equal(await so(e.soId), null);
});

test('validation, list and access', async () => {
  await reset(fixture());
  assert.match((await draft([line()], { CompanyID: '' })).error, /Select a Company/);
  assert.match((await draft([line()], { CostCenterID: 'WH1' })).error, /Unknown Cost Center/);
  assert.match((await draft([line()], { CustomerID: '' })).error, /Select a Customer/);
  assert.match((await draft([line()], { CustomerID: 'CU3' })).error, /Customer not found or inactive/);
  assert.match((await draft([line({ ItemCode: 'NOPE' })])).error, /Line 1: unknown or inactive item \(NOPE\)/);
  assert.match((await draft([line({ WarehouseID: '' })])).error, /Line 1: select a warehouse/);
  assert.match((await draft([line({ OrderedQuantity: 0 })])).error, /Line 1: quantity must be greater than zero/);
  const noList = await draft([line()], { CustomerID: 'CU2' });
  assert.equal(noList.success, true, 'no mapped price list is allowed');
  assert.equal((await so(noList.soId)).PriceListID, '');
  const empty = await draft([]);
  assert.match((await call('u-admin', 'confirmSalesOrder', { soId: empty.soId })).error, /at least one line/);

  // An item deleted after the draft was saved.
  const gone = await draft([line({ ItemCode: 'FG-003' })]);
  await rtdb.ref('items/I3').remove();
  assert.match((await call('u-admin', 'confirmSalesOrder', { soId: gone.soId })).error, /no longer exists: FG-003/);

  const list = await call('u-admin', 'getSalesOrderEntries', { limit: 2 });
  assert.equal(list.total, 3);
  assert.equal(list.entries.length, 2);
  assert.equal((await call('u-other', 'getSalesOrderEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getSalesOrderEntries', {})).total, 3);
  assert.equal((await draft([line()], {}, 'u-viewer')).success, false);
  assert.equal((await call('u-viewer', 'confirmSalesOrder', { soId: noList.soId })).success, false);
  assert.deepEqual(await draft([line()], {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'confirmSalesOrder', { soId: noList.soId }), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'cancelSalesOrder', { soId: noList.soId }), { success: false, error: 'You do not have access to that company.' });
});
