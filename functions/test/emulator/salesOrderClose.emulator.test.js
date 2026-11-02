// Sales Order: Delivered when fully delivered, and Close / Reopen (owner,
// 2026-11-02; docs/modules/SO_CLOSE.md, Q379-Q382), on real Delivery Notes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-10-10';
function fixture() {
  const f = baseFixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 20, AvgCost: 5, TotalValue: 100 } } } };
  return f;
}
test.after(async () => { await app.delete(); });
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
const reservedFor = async soId => Object.values((await val('stock/reservations')) || {})
  .filter(r => r.SourceID === soId && r.Status === 'Active').reduce((s, r) => s + r.Quantity, 0);
const so = async id => val('salesOrders/' + id);

async function confirmedSO(qty) {
  const s = await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: qty, UnitPrice: 20 }] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await call('u-admin', 'confirmSalesOrder', { soId: s.soId })).success, true);
  return { soId: s.soId, lineId: (await so(s.soId)).Lines[0].LineID };
}
async function deliver(o, qty) {
  const d = await call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ SourceSOID: o.soId, SourceSOLineID: o.lineId, Quantity: qty, Description: 'Ship' }] } });
  assert.equal(d.success, true, d.error);
  const p = await call('u-admin', 'postDeliveryNote', { dnId: d.dnId });
  assert.equal(p.success, true, p.error);
  return d.dnId;
}
const eligible = async () => (await call('u-admin', 'getEligibleSOsForDelivery', { companyId: 'C1', customerId: 'CU1' })).map(s => s.SOID);
const invoiceable = async () => (await call('u-admin', 'getInvoiceableOrderLines', { companyId: 'C1', customerId: 'CU1' })).map(l => l.SourceSOID);

test('Delivered when every line is delivered; a reversal brings it back to Reserved, reserving again', async () => {
  await reset(fixture());
  const o = await confirmedSO(6);
  await deliver(o, 4);
  assert.deepEqual([(await so(o.soId)).Status, (await so(o.soId)).Lines[0].DeliveredQuantity, await reservedFor(o.soId)], ['Reserved', 4, 2]);
  const last = await deliver(o, 2);
  assert.deepEqual([(await so(o.soId)).Status, (await so(o.soId)).Lines[0].DeliveredQuantity, await reservedFor(o.soId)], ['Delivered', 6, 0]);
  assert.deepEqual(await eligible(), [], 'nothing left to deliver');
  assert.match(await err(call('u-admin', 'closeSalesOrder', { soId: o.soId, reason: 'x' })), /fully delivered: there is nothing left to close/);
  assert.equal((await call('u-admin', 'reverseDeliveryNote', { dnId: last, reversalDate: D })).success, true);
  assert.deepEqual([(await so(o.soId)).Status, (await so(o.soId)).Lines[0].DeliveredQuantity, await reservedFor(o.soId)], ['Reserved', 4, 2]);
});

test('Close: a reason, the post right; reservations released; no more deliveries or invoices from it; a reversal leaves it Closed; Reopen with a reason', async () => {
  await reset(fixture());
  const o = await confirmedSO(10);
  await deliver(o, 4);
  assert.equal(await reservedFor(o.soId), 6);
  assert.match(await err(call('u-admin', 'closeSalesOrder', { soId: o.soId, reason: ' ' })), /Give a reason to close/);
  assert.match(await err(call('u-viewer', 'closeSalesOrder', { soId: o.soId, reason: 'x' })), /right to close Sales Orders/);
  const c = await call('u-admin', 'closeSalesOrder', { soId: o.soId, reason: 'Customer cancelled the rest' });
  assert.deepEqual([c.status, c.released, c.left], ['Closed', 1, 6]);
  let rec = await so(o.soId);
  assert.deepEqual([rec.Status, rec.StatusBeforeClose, rec.CloseReason, rec.Lines[0].DeliveredQuantity, await reservedFor(o.soId)], ['Closed', 'Reserved', 'Customer cancelled the rest', 4, 0]);
  assert.deepEqual(await eligible(), [], 'no Delivery Note from it');
  assert.deepEqual(await invoiceable(), [], 'no direct invoice from it');
  assert.match(await err(call('u-admin', 'claimStockForSalesOrderLine', { soId: o.soId, lineId: o.lineId, quantity: 1, reason: 'x' })), /only be claimed for a Reserved or Partially Reserved/);
  assert.match(await err(call('u-admin', 'closeSalesOrder', { soId: o.soId, reason: 'x' })), /already Closed/);

  // A delivery reversed on a Closed order: delivered back down, still Closed, nothing reserved again.
  const dnId = Object.keys((await val('stock/transactions')) || {}).find(Boolean);
  assert.equal((await call('u-admin', 'reverseDeliveryNote', { dnId, reversalDate: D })).success, true);
  rec = await so(o.soId);
  assert.deepEqual([rec.Status, rec.Lines[0].DeliveredQuantity, await reservedFor(o.soId)], ['Closed', 0, 0]);

  assert.match(await err(call('u-admin', 'reopenSalesOrder', { soId: o.soId, reason: '' })), /Give a reason to reopen/);
  const r = await call('u-admin', 'reopenSalesOrder', { soId: o.soId, reason: 'Customer wants it after all' });
  assert.equal(r.status, 'Partially Reserved');
  rec = await so(o.soId);
  assert.deepEqual(rec.CloseLog.map(x => [x.Action, x.Reason]), [['Closed', 'Customer cancelled the rest'], ['Reopened', 'Customer wants it after all']]);
  assert.deepEqual(await eligible(), [o.soId], 'deliverable again');
  assert.match(await err(call('u-admin', 'reopenSalesOrder', { soId: o.soId, reason: 'x' })), /Only a Closed Sales Order can be reopened/);
});

test('only a confirmed order closes: not a Draft or a Cancelled one', async () => {
  await reset(fixture());
  const s = await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 1, UnitPrice: 20 }] } });
  assert.match(await err(call('u-admin', 'closeSalesOrder', { soId: s.soId, reason: 'x' })), /this one is Draft/);
  const o = await confirmedSO(2);
  assert.equal((await call('u-admin', 'cancelSalesOrder', { soId: o.soId, reason: '' })).success, true);
  assert.match(await err(call('u-admin', 'closeSalesOrder', { soId: o.soId, reason: 'x' })), /this one is Cancelled/);
});
