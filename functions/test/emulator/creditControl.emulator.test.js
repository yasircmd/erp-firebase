// Customer credit control, step C1 (docs/modules/CREDIT_CONTROL.md,
// Q360-Q365), on the emulators: a limit and a hold per customer in a
// company, with their history; Credit Control Setup; the report's exposure
// (the receivable, deliveries not yet invoiced, open orders; or the
// receivable only), what is available, overdue past the grace days, and
// the order of the rows; the rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
const S = require('../../src/recurringSchedule');
const today = S.todayIn(S.TIME_ZONE);
const daysAgo = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

function fixture() {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Alpha Traders', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Beta Stores', Status: 'Active', CompanyID: '', TradeReceivablesAccountID: 'A-AR' },
    CU9: { CustomerCode: 'C009', CustomerName: 'Other Company', Status: 'Active', CompanyID: 'C2', TradeReceivablesAccountID: 'A-AR' },
    CUX: { CustomerCode: 'C010', CustomerName: 'Inactive', Status: 'Inactive', CompanyID: '', TradeReceivablesAccountID: 'A-AR' }
  };
  const line = (q, d, p) => ({ LineID: 'L1', ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: q, DeliveredQuantity: d, UnitPrice: p });
  f.salesOrders = {
    SO1: { CompanyID: 'C1', CustomerID: 'CU1', Status: 'Reserved', SONumber: 'SO-1', SODate: daysAgo(5), CurrencyID: '', Lines: [line(10, 4, 50)] }, // 300 to go
    SO2: { CompanyID: 'C1', CustomerID: 'CU1', Status: 'Draft', SONumber: '', SODate: daysAgo(1), Lines: [line(99, 0, 50)] }, // not confirmed
    SO3: { CompanyID: 'C1', CustomerID: 'CU1', Status: 'Cancelled', SONumber: 'SO-3', SODate: daysAgo(9), Lines: [line(5, 0, 50)] }
  };
  const dn = (n, extra) => Object.assign({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: n, TransactionDate: daysAgo(3),
    Lines: [{ ItemCode: 'RM-001', Quantity: 4, UnitPrice: 50, SourceSOID: 'SO1', SourceSOLineID: 'L1' }] }, extra);
  f.stock = { transactions: { DN1: dn('DN-1'), DN2: dn('DN-2', { MatchedToInvoiceID: 'INV-X' }), DN3: dn('DN-3', { ReversedByDeliveryNoteID: 'DN4' }) } }; // 200 not invoiced
  return f;
}
// What the customer owes: a Bank Payment to it (a refund) leaves an open debit on that date.
async function owes(customer, date, amount) {
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: date, Description: 'Refund', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '1200', Amount: amount, Description: 'Refund', PartyType: 'Customer', PartyID: customer, Allocations: [] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}
const report = uid => call(uid || 'u-admin', 'getCreditControl', { companyId: 'C1' });
const rowOf = (r, id) => r.rows.find(x => x.CustomerID === id);

test('credit control: limits and holds per company, setup, the report of exposure, available and overdue; the rights', async () => {
  await reset(fixture());
  await owes('CU1', daysAgo(40), 1000);
  await owes('CU2', today, 100); // due today: not yet overdue

  // The company's customers: its own and the shared, Active only; none limited yet; the check off to start.
  let r = await report();
  assert.deepEqual(r.setup, { Check: 'Off', Exposure: 'ReceivableAndOrders', GraceDays: 0 });
  assert.deepEqual(r.rows.map(x => x.CustomerID).sort(), ['CU1', 'CU2']);
  let a = rowOf(r, 'CU1');
  assert.deepEqual([a.Receivable, a.Deliveries, a.Orders, a.Exposure, a.Limit, a.Available], [1000, 200, 300, 1500, null, null]);
  assert.deepEqual([a.Overdue, a.OverdueDays, a.Flags], [1000, 40, ['Overdue']]);
  assert.deepEqual(a.Docs.Orders.map(d => [d.Number, d.Amount]), [['SO-1', 300]]);
  assert.deepEqual(a.Docs.Deliveries.map(d => [d.Number, d.Amount]), [['DN-1', 200]]);

  // A limit: over it, and first in the list.
  ok(await call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU1', limit: 1200 }));
  ok(await call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU2', limit: '5000' }));
  r = await report();
  a = rowOf(r, 'CU1');
  assert.deepEqual([a.Limit, a.Available, a.Over, a.Flags], [1200, -300, 300, ['OverLimit', 'Overdue']]);
  assert.deepEqual([rowOf(r, 'CU2').Available, rowOf(r, 'CU2').Flags], [4900, []]);
  assert.equal(r.rows[0].CustomerID, 'CU1');
  assert.match(await err(call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU1', limit: -5 })), /0 or more/);
  assert.match(await err(call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU9', limit: 5 })), /different company/);

  // The receivable only, and grace days: within them, not overdue.
  ok(await call('u-admin', 'saveCreditSetup', { companyId: 'C1', Exposure: 'Receivable', GraceDays: 45, Check: 'Warn' }));
  a = rowOf(await report(), 'CU1');
  assert.deepEqual([a.Exposure, a.Available, a.Overdue, a.Flags], [1000, 200, 0, []]);
  assert.match(await err(call('u-admin', 'saveCreditSetup', { companyId: 'C1', GraceDays: 2.5 })), /whole number/);
  assert.match(await err(call('u-admin', 'saveCreditSetup', { companyId: 'C1', Check: 'Maybe' })), /one of Off, Warn, Block/);

  // A hold: a reason needed; first in the list; lifted.
  assert.match(await err(call('u-admin', 'setCreditHold', { companyId: 'C1', customerId: 'CU2', hold: true })), /reason/);
  ok(await call('u-admin', 'setCreditHold', { companyId: 'C1', customerId: 'CU2', hold: true, reason: 'Cheque returned' }));
  r = await report();
  assert.deepEqual([r.rows[0].CustomerID, r.rows[0].Hold, r.rows[0].HoldReason, r.rows[0].Flags], ['CU2', true, 'Cheque returned', ['Hold']]);
  ok(await call('u-admin', 'setCreditHold', { companyId: 'C1', customerId: 'CU2', hold: false }));
  assert.equal(rowOf(await report(), 'CU2').Hold, false);
  // Removing a limit: none again. The history kept.
  ok(await call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU2', limit: '' }));
  assert.equal(rowOf(await report(), 'CU2').Limit, null);
  const kept = (await firestore.collection('creditLimits').doc('C1__CU2').get()).data();
  assert.deepEqual(kept.History.map(h => h.What), ['Limit set to 5,000.00', 'Put on hold: Cheque returned', 'Hold lifted', 'Limit removed']);

  // The rights: a viewer reads, changes nothing; another company's user sees nothing of C1.
  const v = await report('u-viewer');
  assert.deepEqual(v.rights, { canWrite: false, canHold: false, canSetup: false });
  assert.match(await err(call('u-viewer', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU1', limit: 1 })), /permission to change credit limits/);
  assert.match(await err(call('u-viewer', 'setCreditHold', { companyId: 'C1', customerId: 'CU1', hold: true, reason: 'x' })), /credit hold/);
  assert.match(await err(call('u-viewer', 'saveCreditSetup', { companyId: 'C1', GraceDays: 1 })), /Credit Control Setup/);
  assert.match(await err(report('u-other')), /access to that company/);
});
