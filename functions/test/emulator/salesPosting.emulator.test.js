// A Delivery Note's Sales Order and reservation effects, and a Customer
// Invoice's posting, written with the posting itself
// (functions/src/salesPosting.js; docs/modules/TRANSACTIONS_FIRESTORE.md,
// T2): worked out as the step-by-step code did, and all or none.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const { postStock } = require('../../src/stockPosting');
const sales = require('../../src/salesPosting');
const { salesOrders, customerInvoices, reservations } = require('../../src/salesStore');
const stockStore = require('../../src/stockStore');
const { reset, baseFixture, firestore, today } = require('./_helpers');

// The default app holds an RTDB connection once a voucher number is taken.
test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

const user = { uid: 'u-admin', profile: { username: 'admin', role: 'Admin', AssignedCompanies: ['C1'] } };
const rsv = (line, qty, at) => ({ ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', CompanyID: 'C1', Quantity: qty, Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: line, CreatedAt: at });
function fixture() {
  const f = baseFixture();
  f.salesOrders = {
    // Partially Reserved by its stored status, though reserved + delivered
    // already cover both lines: the refresh after the posting corrects it.
    SO1: { SONumber: 'SO-1', Status: 'Partially Reserved', CompanyID: 'C1', CustomerID: 'CU1', Lines: [
      { LineID: 'L1', ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 10, DeliveredQuantity: 0 },
      { LineID: 'L2', ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 2, DeliveredQuantity: 0 }] },
    SO2: { SONumber: 'SO-2', Status: 'Cancelled', CompanyID: 'C1', CustomerID: 'CU1', Lines: [{ LineID: 'L1', ItemCode: 'RM-001', OrderedQuantity: 1, DeliveredQuantity: 1 }] }
  };
  f.stock = { reservations: { R2: rsv('L1', 4, '2026-10-02'), R1: rsv('L1', 6, '2026-10-01'), R3: rsv('L2', 2, '2026-10-01'), R4: Object.assign(rsv('L1', 5, '2026-09-01'), { Status: 'Released' }) } };
  return f;
}
// Two lines of SO1's line L1 (one delivery, shipped in two lines), one of L2.
const lines = [
  { ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 5, SourceSOID: 'SO1', SourceSOLineID: 'L1' },
  { ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 2, SourceSOID: 'SO1', SourceSOLineID: 'L1' },
  { ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 2, SourceSOID: 'SO1', SourceSOLineID: 'L2' },
  { ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 1, SourceSOID: '', SourceSOLineID: '' }
];

test('a delivery uses up its reservations oldest first, counts the order delivered and refreshes its status', async () => {
  await reset(fixture());
  const plan = await sales.planDelivery('admin', lines, 'post', 'C1');
  assert.deepEqual(Object.keys(plan.orders), ['SO1'], 'only the order delivered against');
  assert.deepEqual(plan.orders.SO1.Lines.map(l => l.DeliveredQuantity), [7, 2]);
  assert.equal(plan.orders.SO1.Status, 'Reserved', 'reserved + delivered cover every line now');
  const r = plan.reservations;
  assert.deepEqual(Object.keys(r).sort(), ['R1', 'R2', 'R3']);
  assert.deepEqual([r.R1.Status, r.R1.ReleaseReason, r.R1.ReleasedBy], ['Released', 'Consumed by Delivery Note', 'admin'], 'the oldest, used up whole');
  assert.deepEqual([r.R2.Status, r.R2.Quantity], ['Active', 3], 'the newer one, used up in part');
  assert.equal(r.R3.Status, 'Released');
  // Nothing is written until the posting's batch commits.
  assert.equal((await reservations.get('R1')).Status, 'Active');
  assert.deepEqual((await salesOrders.get('SO1')).Lines.map(l => l.DeliveredQuantity), [0, 0]);
});

test('a reversal gives the delivered quantity back and reserves it again, only on an order still reserving', async () => {
  await reset(fixture());
  await salesOrders.update('SO1', { Status: 'Reserved', 'Lines/0/DeliveredQuantity': 7, 'Lines/1/DeliveredQuantity': 2 });
  const back = lines.slice(0, 3).concat([{ ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 1, SourceSOID: 'SO2', SourceSOLineID: 'L1' }]);
  const plan = await sales.planDelivery('admin', back, 'reverse', 'C1');
  assert.deepEqual(plan.orders.SO1.Lines.map(l => l.DeliveredQuantity), [0, 0]);
  assert.deepEqual(plan.orders.SO2.Lines.map(l => l.DeliveredQuantity), [0], 'a cancelled order still gets its quantity back');
  const made = Object.values(plan.reservations);
  assert.deepEqual(made.map(x => [x.SourceID, x.SourceLineID, x.Quantity, x.Reason]),
    [['SO1', 'L1', 5, 'Restored by Delivery Note reversal'], ['SO1', 'L1', 2, 'Restored by Delivery Note reversal'], ['SO1', 'L2', 2, 'Restored by Delivery Note reversal']], 'none on the cancelled order');
  assert.ok(Object.keys(plan.reservations).every(id => /^RSV-/.test(id)));
});

const gl = (id, type) => ({
  type: type || 'DeliveryNote', date: today, description: 'Posting ' + id, reference: '',
  lines: [{ AccountCode: '1200', Debit: 25, Credit: 0, Description: 'x' }, { AccountCode: '4000', Debit: 0, Credit: 25, Description: 'x', CostCenterID: 'CC1' }],
  dimensions: { CompanyID: 'C1' }, extra: { SourceTransactionID: id }
});
const entriesOf = async id => (await firestore.collection('journalEntries').where('SourceTransactionID', '==', id).get()).size;
// A write the database refuses at commit: an update of a document that is
// not there. Everything else in the batch must be left unwritten.
const refused = batch => batch.update(firestore.collection('journalEntries').doc('GONE'), { X: 1 });

test('a delivery\'s order and reservation changes land with the posting, or not at all', async () => {
  await reset(fixture());
  const plan = await sales.planDelivery('admin', lines, 'post', 'C1');
  await assert.rejects(postStock(user, gl('DN1'), {}, () => ({ DN1: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1' } }),
    async batch => { await sales.planWriter(plan)(batch); refused(batch); }));
  assert.equal(await entriesOf('DN1'), 0);
  assert.equal(await stockStore.getTx('DN1'), null);
  assert.equal((await reservations.get('R1')).Status, 'Active', 'no reservation used up');
  assert.deepEqual((await salesOrders.get('SO1')).Lines.map(l => l.DeliveredQuantity), [0, 0], 'no order changed');

  await postStock(user, gl('DN1'), {}, () => ({ DN1: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1' } }), sales.planWriter(plan));
  assert.equal(await entriesOf('DN1'), 1);
  assert.deepEqual((await salesOrders.get('SO1')).Lines.map(l => l.DeliveredQuantity), [7, 2]);
  assert.equal((await salesOrders.get('SO1')).Status, 'Reserved');
  assert.deepEqual([(await reservations.get('R1')).Status, (await reservations.get('R2')).Quantity], ['Released', 3]);
});

test('a customer invoice, its GL entry and its Delivery Notes\' marks land together, or not at all; so does its reversal', async () => {
  const f = fixture();
  f.customerInvoices = { CI1: { Status: 'Draft', CompanyID: 'C1', CustomerID: 'CU1', InvoiceDate: today, Total: 25, SourceDeliveryNotes: [{ DeliveryNoteID: 'DN1' }] } };
  f.stock.transactions = { DN1: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionDate: today } };
  await reset(f);
  const dns = await stockStore.getTxs(['DN1']);
  const marks = () => sales.markDocs(dns, ['DN1'], { MatchedToInvoiceID: 'CI1' });
  await assert.rejects(postStock(user, gl('CI1', 'CustomerInvoice'), {}, marks,
    async (batch, g, now) => { await sales.invoicePostedWriter('CI1', 'admin')(batch, g, now); refused(batch); }));
  assert.equal(await entriesOf('CI1'), 0);
  assert.equal((await customerInvoices.get('CI1')).Status, 'Draft');
  assert.equal((await stockStore.getTx('DN1')).MatchedToInvoiceID, undefined);

  const res = await postStock(user, gl('CI1', 'CustomerInvoice'), {}, marks, sales.invoicePostedWriter('CI1', 'admin'));
  const ci = await customerInvoices.get('CI1');
  assert.deepEqual([ci.Status, ci.TransactionNumber, ci.LinkedJVID, ci.PostedBy, ci.CommitAttemptID], ['Posted', res.jvNumber, res.jvId, 'admin', '']);
  assert.equal(ci.Total, 25, 'the rest of the invoice kept');
  assert.equal((await stockStore.getTx('DN1')).MatchedToInvoiceID, 'CI1');

  const reversal = { TransactionType: 'CustomerInvoice', Status: 'Committing', InvoiceDate: today, CompanyID: 'C1', CustomerID: 'CU1', ReversalOfInvoiceID: 'CI1', ReversedByInvoiceID: '', Total: 25 };
  const unmark = () => sales.markDocs(dns, ['DN1'], { MatchedToInvoiceID: '' });
  await assert.rejects(postStock(user, gl('CINVD-1', 'CustomerInvoice'), {}, unmark,
    async (batch, g, now) => { await sales.invoiceReversalWriter('CI1', 'CINVD-1', reversal, 'admin')(batch, g, now); refused(batch); }));
  assert.equal(await customerInvoices.get('CINVD-1'), null);
  assert.equal((await customerInvoices.get('CI1')).ReversedByInvoiceID, undefined);
  assert.equal((await stockStore.getTx('DN1')).MatchedToInvoiceID, 'CI1');

  const back = await postStock(user, gl('CINVD-1', 'CustomerInvoice'), {}, unmark, sales.invoiceReversalWriter('CI1', 'CINVD-1', reversal, 'admin'));
  assert.deepEqual([(await customerInvoices.get('CINVD-1')).Status, (await customerInvoices.get('CINVD-1')).TransactionNumber], ['Posted', back.jvNumber]);
  assert.deepEqual([(await customerInvoices.get('CI1')).Status, (await customerInvoices.get('CI1')).ReversedByInvoiceID], ['Posted', 'CINVD-1']);
  assert.equal((await stockStore.getTx('DN1')).MatchedToInvoiceID, '');
});
