// Vendor Invoices, Purchase Orders and requisitions in Firestore
// (functions/src/purchaseStore.js; docs/modules/TRANSACTIONS_FIRESTORE.md,
// T3): the same shape RTDB gave through every kind of write, their
// queries, and the GRN's and the Vendor Invoice's postings all or none.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const movedPaths = require('../../src/movedPaths');
const { vendorInvoices, purchaseOrders, purchaseRequisitions, inventoryPurchaseRequisitions } = require('../../src/purchaseStore');
const { postStock } = require('../../src/stockPosting');
const sales = require('../../src/salesPosting');
const grn = require('../../src/grn');
const stockStore = require('../../src/stockStore');
const { rtdb, reset, baseFixture, firestore, today } = require('./_helpers');

// The default app holds an RTDB connection once a voucher number is taken.
test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

const holes = v => JSON.stringify(v, (k, x) => (x === undefined ? '<hole>' : x));
const SCRATCH = 'rtdbCopy/';
async function both(path, method, payload) {
  const ref = rtdb.ref(SCRATCH + path);
  if (method === 'put') await ref.set(payload === undefined ? null : JSON.parse(JSON.stringify(payload)));
  else if (method === 'patch') await ref.update(payload);
  else if (method === 'delete') await ref.remove();
  await movedPaths.request(path, method, payload);
}
async function same(path, why) {
  assert.equal(holes(await movedPaths.request(path, 'get')), holes((await rtdb.ref(SCRATCH + path).get()).val()), why || path);
}

const po = { PONumber: 'PO-1', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1', PODate: '2026-10-05', CreatedBy: 'admin', Note: '',
  Lines: [{ LineID: 'L1', ItemCode: 'RM-001', Quantity: 10, ReceivedQuantity: 0, Extra: {} }, { LineID: 'L2', ItemCode: 'RM-002', Quantity: 4, ReceivedQuantity: 0 }], Grid: [[1, 2], [3]] };
const vi = { Status: 'Draft', CompanyID: 'C1', VendorID: 'V1', InvoiceDate: today, Total: 25, TransactionNumber: '', SourceGRNs: [{ GRNID: 'G1', Lines: [] }], DirectLines: [] };
const pr = { PRNumber: '', Status: 'Submitted', CompanyID: 'C1', CreatedBy: 'admin', Lines: [{ ItemCode: 'RM-001', Quantity: 2 }], Empty: {} };

test('the four collections come back exactly as RTDB gives them, through every kind of write', async () => {
  await reset({});
  for (const [path, doc] of [['vendorInvoices', vi], ['purchaseOrders', po], ['purchaseRequisitions', pr], ['inventoryPurchaseRequisitions', pr]]) {
    await both(path + '/A1', 'put', doc);
    await both(path + '/A2', 'put', Object.assign({}, doc, { Status: 'Posted' }));
    await same(path + '/A1');
    await same(path, 'the whole collection');
    await both(path + '/A1', 'patch', { Status: 'Closed', 'Lines/0/Quantity': 3, Note: null, New: { x: 1 } });
    await same(path + '/A1', 'a patch with path keys and a removal');
    await both(path + '/A1/Lines/1/ReceivedQuantity', 'put', 2);
    await same(path + '/A1', 'a put below a document');
    await both(path, 'patch', { 'A3/Status': 'Draft', A2: { Status: 'Gone' } });
    await same(path);
    await both(path + '/A2', 'delete');
    await same(path);
  }
});

test('queries: each store\'s fields and derived lists', async () => {
  await reset({});
  await purchaseOrders.set('PO2', po);
  await purchaseOrders.set('PO1', Object.assign({}, po, { Status: 'Draft', PODate: '2026-11-02' }));
  await vendorInvoices.set('VI1', vi);
  await vendorInvoices.set('VI2', Object.assign({}, vi, { Status: 'Posted', SourceGRNs: [{ GRNID: 'G2' }] }));
  await purchaseRequisitions.set('PR1', pr);
  await purchaseRequisitions.set('PR2', Object.assign({}, pr, { CompanyID: 'C2' }));
  await inventoryPurchaseRequisitions.set('IPR1', Object.assign({}, pr, { Status: 'Draft' }));
  const ids = async (store, f) => Object.keys(await store.query(f));
  assert.deepEqual(await ids(purchaseOrders, { Status: 'Approved', CompanyID: 'C1', VendorID: 'V1' }), ['PO2']);
  assert.deepEqual(await ids(purchaseOrders, { ItemCode: 'RM-002' }), ['PO1', 'PO2'], 'a line\'s item');
  assert.deepEqual(await ids(purchaseOrders, { Period: '2026-11' }), ['PO1']);
  assert.deepEqual(await ids(vendorInvoices, { GRNID: 'G1' }), ['VI1'], 'a GRN it invoices');
  assert.deepEqual(await ids(vendorInvoices, { CompanyID: 'C1', VendorID: 'V1', Status: 'Posted' }), ['VI2']);
  assert.deepEqual(await ids(purchaseRequisitions, { Status: 'Submitted', CompanyID: 'C1' }), ['PR1']);
  assert.deepEqual(await ids(inventoryPurchaseRequisitions, { Status: 'Submitted', CompanyID: 'C1' }), []);
  await assert.rejects(purchaseOrders.query({ PODate: '2026-10-05' }), /no equality query on PODate/);
});

const user = { uid: 'u-admin', profile: { username: 'admin', role: 'Admin', AssignedCompanies: ['C1'] } };
const gl = (id, type) => ({
  type, date: today, description: 'Posting ' + id, reference: '',
  lines: [{ AccountCode: '1300', Debit: 25, Credit: 0, Description: 'x' }, { AccountCode: '2100', Debit: 0, Credit: 25, Description: 'x' }],
  dimensions: { CompanyID: 'C1' }, extra: { SourceTransactionID: id }
});
const entriesOf = async id => (await firestore.collection('journalEntries').where('SourceTransactionID', '==', id).get()).size;
const refused = batch => batch.update(firestore.collection('journalEntries').doc('GONE'), { X: 1 });

test('a GRN counts its PO lines received with its posting, or not at all; its reversal gives them back', async () => {
  const f = baseFixture();
  f.purchaseOrders = { PO1: po };
  await reset(f);
  const lines = [
    { ItemID: 'I1', Quantity: 3, SourcePOID: 'PO1', SourcePOLineID: 'L1' },
    { ItemID: 'I1', Quantity: 2, SourcePOID: 'PO1', SourcePOLineID: 'L1' },
    { CategoryID: 'CAT', Quantity: 1, SourcePOID: 'PO1', SourcePOLineID: 'L2' },
    { ItemID: 'I1', Quantity: 9 }, { ItemID: 'I1', Quantity: 1, SourcePOID: 'NOPE', SourcePOLineID: 'L1' }
  ];
  const plan = await grn.planPOReceipts(lines, 1);
  assert.deepEqual(Object.keys(plan), ['PO1'], 'a missing PO and a direct line change nothing');
  assert.deepEqual(plan.PO1.Lines.map(l => l.ReceivedQuantity), [5, 1]);
  const doc = () => ({ G1: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1' } });
  await assert.rejects(postStock(user, gl('G1', 'GRN'), {}, doc, async batch => { await grn.writePOs(plan)(batch); refused(batch); }));
  assert.equal(await entriesOf('G1'), 0);
  assert.deepEqual((await purchaseOrders.get('PO1')).Lines.map(l => l.ReceivedQuantity), [0, 0], 'no PO changed');

  await postStock(user, gl('G1', 'GRN'), {}, doc, grn.writePOs(plan));
  assert.deepEqual((await purchaseOrders.get('PO1')).Lines.map(l => l.ReceivedQuantity), [5, 1]);
  const back = await grn.planPOReceipts(lines.concat([{ ItemID: 'I1', Quantity: 50, SourcePOID: 'PO1', SourcePOLineID: 'L2' }]), -1);
  assert.deepEqual(back.PO1.Lines.map(l => l.ReceivedQuantity), [0, 0], 'never below zero');
});

test('a vendor invoice, its GL entry and its GRNs\' marks land together, or not at all; so does its reversal', async () => {
  const f = baseFixture();
  f.vendorInvoices = { VI1: vi };
  f.stock = { transactions: { G1: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionDate: today } } };
  await reset(f);
  const grns = await stockStore.getTxs(['G1']);
  const marks = () => sales.markDocs(grns, ['G1'], { MatchedToInvoiceID: 'VI1' });
  await assert.rejects(postStock(user, gl('VI1', 'VendorInvoice'), {}, marks,
    async (batch, g, now) => { await sales.invoicePostedWriter('VI1', 'admin', 'vendorInvoices')(batch, g, now); refused(batch); }));
  assert.equal(await entriesOf('VI1'), 0);
  assert.equal((await vendorInvoices.get('VI1')).Status, 'Draft');
  assert.equal((await stockStore.getTx('G1')).MatchedToInvoiceID, undefined);

  const res = await postStock(user, gl('VI1', 'VendorInvoice'), {}, marks, sales.invoicePostedWriter('VI1', 'admin', 'vendorInvoices'));
  const inv = await vendorInvoices.get('VI1');
  assert.deepEqual([inv.Status, inv.TransactionNumber, inv.LinkedJVID, inv.Total], ['Posted', res.jvNumber, res.jvId, 25]);
  assert.equal((await stockStore.getTx('G1')).MatchedToInvoiceID, 'VI1');

  const reversal = { TransactionType: 'VendorInvoice', Status: 'Committing', InvoiceDate: today, CompanyID: 'C1', VendorID: 'V1', ReversalOfInvoiceID: 'VI1', ReversedByInvoiceID: '', Total: 25 };
  const unmark = () => sales.markDocs(grns, ['G1'], { MatchedToInvoiceID: '' });
  await assert.rejects(postStock(user, gl('VINVD-1', 'VendorInvoice'), {}, unmark,
    async (batch, g, now) => { await sales.invoiceReversalWriter('VI1', 'VINVD-1', reversal, 'admin', 'vendorInvoices')(batch, g, now); refused(batch); }));
  assert.equal(await vendorInvoices.get('VINVD-1'), null);
  assert.equal((await stockStore.getTx('G1')).MatchedToInvoiceID, 'VI1');

  await postStock(user, gl('VINVD-1', 'VendorInvoice'), {}, unmark, sales.invoiceReversalWriter('VI1', 'VINVD-1', reversal, 'admin', 'vendorInvoices'));
  assert.equal((await vendorInvoices.get('VINVD-1')).Status, 'Posted');
  assert.equal((await vendorInvoices.get('VI1')).ReversedByInvoiceID, 'VINVD-1');
  assert.equal((await stockStore.getTx('G1')).MatchedToInvoiceID, '');
});
