// DELIVERYNOTE through its screen's callables, on top of real Sales
// Orders: eligible SOs with live ship caps, draft cap validation, post
// (stock out at WAC, COGS GL, SO DeliveredQuantity, reservation
// consumed), approval gate, reversal (and its guards), delete, access.
// Plus the port fixes: the ship cap is re-checked at post/commit, and a
// reversal doesn't re-reserve on a cancelled Sales Order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Other Buyer', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' }
  };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 5, TotalValue: 50 } } } };
  return f;
}
test.after(async () => { await app.delete(); });

const ledger = async () => { const l = (await val('stock/ledger/I1/WH1')) || {}; return [l.Quantity || 0, l.TotalValue || 0]; };
const reservedFor = async (soId) => Object.values((await val('stock/reservations')) || {})
  .filter(r => r.SourceID === soId && r.Status === 'Active').reduce((s, r) => s + r.Quantity, 0);
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId }))
  .Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

async function confirmedSO(qty, customerId) {
  const s = await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: customerId || 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: qty, UnitPrice: 20 }] } });
  assert.equal(s.success, true, s.error);
  const c = await call('u-admin', 'confirmSalesOrder', { soId: s.soId });
  assert.equal(c.success, true, c.error);
  const so = await val('salesOrders/' + s.soId);
  return { soId: s.soId, lineId: so.Lines[0].LineID, soNumber: so.SONumber };
}
const dnLine = (so, qty, o) => Object.assign({ SourceSOID: so.soId, SourceSOLineID: so.lineId, Quantity: qty, Description: 'Ship' }, o);
const draft = (lines, extra, uid) => call(uid || 'u-admin', 'saveDeliveryNoteDraft', {
  dnData: Object.assign({ TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: lines }, extra || {})
});

test('eligible SOs carry live caps; post ships at WAC, books COGS, updates the SO and consumes the reservation', async () => {
  await reset(fixture());
  const so = await confirmedSO(6);
  const elig = await call('u-admin', 'getEligibleSOsForDelivery', { companyId: 'C1', customerId: 'CU1' });
  assert.deepEqual(elig.map(s => [s.SOID, s.Lines[0].MaxShippable]), [[so.soId, 6]]);
  assert.deepEqual(await call('u-admin', 'getEligibleSOsForDelivery', { companyId: 'C1', customerId: 'CU2' }), []);

  const s = await draft([dnLine(so, 4), dnLine(so, 0, { SourceSOID: '' })]);
  assert.equal(s.success, true, s.error);
  let rec = await val('stock/transactions/' + s.dnId);
  assert.equal(rec.Lines.length, 1, 'blank trailing row skipped');
  assert.deepEqual([rec.Lines[0].WarehouseID, rec.Lines[0].UnitPrice, rec.Lines[0].SourceSONumber], ['WH1', 20, so.soNumber], 'warehouse and price locked to the SO line');

  const p = await call('u-admin', 'postDeliveryNote', { dnId: s.dnId });
  assert.equal(p.success, true, p.error);
  assert.equal(p.status, 'Posted');
  assert.deepEqual(await ledger(), [6, 30]);
  rec = await val('stock/transactions/' + s.dnId);
  assert.equal(rec.Status, 'Posted');
  assert.deepEqual(await jvLines(rec.LinkedJVID), [['1300', 0, 20], ['5000', 20, 0]]);
  const soRec = await val('salesOrders/' + so.soId);
  assert.equal(soRec.Lines[0].DeliveredQuantity, 4);
  assert.equal(await reservedFor(so.soId), 2);
  assert.equal(soRec.Status, 'Reserved', 'delivered + reserved still covers the order');
  const listed = (await call('u-admin', 'getDeliveryNoteEntries', {})).entries.map(e => e.DeliveryNoteID || e.TransactionID || e.DNID || e.ID);
  assert.equal(listed.length, 1);
});

test('draft validation: ship cap, customer, company, SO status', async () => {
  await reset(fixture());
  const so = await confirmedSO(12); // only 10 on hand: Partially Reserved, 10 reserved
  assert.match((await draft([dnLine(so, 11)])).error, /cannot ship more than 10 — capped at the smaller of what remains on the order \(12\) and what is currently reserved \(10\)/);
  assert.match((await draft([dnLine(so, 1)], { CustomerID: 'CU2' })).error, /different Customer/);
  assert.match((await draft([dnLine(so, 0)])).error, /quantity greater than zero/);
  assert.match((await draft([dnLine(so, 1, { Description: '' })])).error, /description is required/);
  assert.match((await draft([dnLine(so, 1)], { CostCenterID: '' })).error, /Cost Center is required/);
  assert.match((await draft([dnLine(so, 1, { SourceSOLineID: 'NOPE' })])).error, /Sales Order line was not found/);
  assert.match((await draft([])).error, /at least one line/);
  assert.match((await draft([dnLine(so, 1)], { Description: '' })).error, /Description is required/);
  await call('u-admin', 'cancelSalesOrder', { soId: so.soId });
  assert.match((await draft([dnLine(so, 1)])).error, /no longer available for delivery/);
});

test('PORT FIX: the ship cap is re-checked at post (stale drafts, cancelled SO, duplicate lines)', async () => {
  await reset(fixture());
  const so = await confirmedSO(6);
  const a = await draft([dnLine(so, 4)]);
  const b = await draft([dnLine(so, 4)]);
  assert.equal((await call('u-admin', 'postDeliveryNote', { dnId: a.dnId })).success, true);
  const pb = await call('u-admin', 'postDeliveryNote', { dnId: b.dnId });
  assert.equal(pb.success, false);
  assert.match(pb.error, /ships 4 but only 2 can ship now \(remaining on order 2, reserved 2\)/);
  assert.deepEqual(await ledger(), [6, 30], 'second DN moved nothing');
  assert.equal((await val('stock/transactions/' + b.dnId)).Status, 'Draft');
  assert.equal((await val('salesOrders/' + so.soId)).Lines[0].DeliveredQuantity, 4);

  const dup = await draft([dnLine(so, 2), dnLine(so, 2)]);
  assert.equal(dup.success, true, 'each line is within the cap on its own at save');
  assert.match((await call('u-admin', 'postDeliveryNote', { dnId: dup.dnId })).error, /ships 4 but only 2 can ship now/);

  const so2 = await confirmedSO(3);
  const c = await draft([dnLine(so2, 3)]);
  await call('u-admin', 'cancelSalesOrder', { soId: so2.soId });
  assert.match((await call('u-admin', 'postDeliveryNote', { dnId: c.dnId })).error, /no longer available for delivery \(Cancelled\)/);
  assert.deepEqual(await ledger(), [6, 30]);
});

test('reversal restores stock, GL, delivered qty and reservation; guarded against repeats', async () => {
  await reset(fixture());
  const so = await confirmedSO(6);
  const a = await draft([dnLine(so, 4)]);
  await call('u-admin', 'postDeliveryNote', { dnId: a.dnId });
  const r = await call('u-admin', 'reverseDeliveryNote', { dnId: a.dnId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.deepEqual(await ledger(), [10, 50]);
  const rev = await val('stock/transactions/' + r.dnId);
  assert.equal(rev.Status, 'Posted');
  assert.equal(rev.ReversalOfDeliveryNoteID, a.dnId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1300', 20, 0], ['5000', 0, 20]]);
  assert.equal((await val('salesOrders/' + so.soId)).Lines[0].DeliveredQuantity, 0);
  assert.equal(await reservedFor(so.soId), 6);
  assert.match((await call('u-admin', 'reverseDeliveryNote', { dnId: a.dnId, reversalDate: D })).error, /already been reversed/);
  assert.match((await call('u-admin', 'reverseDeliveryNote', { dnId: r.dnId, reversalDate: D })).error, /reversal entry cannot itself be reversed/);
  await rtdb.ref('stock/transactions/' + a.dnId + '/ReversedByDeliveryNoteID').set('');
  await rtdb.ref('stock/transactions/' + a.dnId + '/MatchedToInvoiceID').set('INV-1');
  assert.match((await call('u-admin', 'reverseDeliveryNote', { dnId: a.dnId, reversalDate: D })).error, /matched to a Customer Invoice/);
});

test('PORT FIX: reversing after the SO was cancelled leaves the stock free, not stuck in a reservation', async () => {
  await reset(fixture());
  const so = await confirmedSO(10);
  const a = await draft([dnLine(so, 4)]);
  await call('u-admin', 'postDeliveryNote', { dnId: a.dnId });
  assert.deepEqual(await call('u-admin', 'cancelSalesOrder', { soId: so.soId, reason: 'x' }), { success: true, releasedCount: 1 });
  const r = await call('u-admin', 'reverseDeliveryNote', { dnId: a.dnId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.deepEqual(await ledger(), [10, 50]);
  assert.equal(await reservedFor(so.soId), 0, 'no reservation on a Cancelled order');
  // The returned stock can be promised to a new order in full.
  const so2 = await confirmedSO(10);
  assert.equal(await reservedFor(so2.soId), 10);
});

test('approval gate: nothing moves until approved; rejection is editable', async () => {
  const f = fixture();
  f.approvalConfigurations = { DELIVERYNOTE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { DELIVERYNOTE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const so = await confirmedSO(6);
  const a = await draft([dnLine(so, 3)]);
  assert.deepEqual(await call('u-admin', 'postDeliveryNote', { dnId: a.dnId }), { success: true, status: 'PendingApproval' });
  assert.deepEqual(await ledger(), [10, 50]);
  const rej = await call('u-approver', 'decideDeliveryNoteApproval', { dnId: a.dnId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong qty' });
  assert.equal(rej.status, 'Rejected', rej.error);
  assert.equal((await draft([dnLine(so, 2)], { DeliveryNoteID: a.dnId })).success, true, 'Rejected is editable');
  assert.equal((await call('u-admin', 'postDeliveryNote', { dnId: a.dnId })).status, 'PendingApproval');
  const ok = await call('u-approver', 'decideDeliveryNoteApproval', { dnId: a.dnId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
  assert.deepEqual(await ledger(), [8, 40]);
  assert.equal((await val('stock/transactions/' + a.dnId)).Status, 'Posted');
});

test('delete, list and access', async () => {
  await reset(fixture());
  const so = await confirmedSO(6);
  const a = await draft([dnLine(so, 1)]);
  assert.equal((await draft([dnLine(so, 1)], {}, 'u-viewer')).success, false);
  assert.deepEqual(await draft([dnLine(so, 1)], {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-viewer', 'postDeliveryNote', { dnId: a.dnId })).success, false);
  assert.deepEqual(await call('u-other', 'postDeliveryNote', { dnId: a.dnId }), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-other', 'getDeliveryNoteEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getDeliveryNoteEntries', {})).total, 1);
  assert.deepEqual(await call('u-admin', 'deleteDeliveryNoteDraft', { dnId: a.dnId }), { success: true });
  assert.equal(await val('stock/transactions/' + a.dnId), null);
  assert.deepEqual(await ledger(), [10, 50]);
});
