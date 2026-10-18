// Sales Orders, Customer Invoices and reservations in Firestore keep RTDB's
// shape (functions/src/salesStore.js, movedPaths.js;
// docs/modules/TRANSACTIONS_FIRESTORE.md, T2). Each case runs the same
// operations against the RTDB emulator itself and through movedPaths, and
// every read must come back identical; then each store's queries.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const movedPaths = require('../../src/movedPaths');
const { salesOrders, customerInvoices, reservations } = require('../../src/salesStore');
const { app, rtdb, reset } = require('./_helpers');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

const holes = v => JSON.stringify(v, (k, x) => (x === undefined ? '<hole>' : x));
// The same operation on RTDB (under a scratch root, as the real path is
// routed) and through movedPaths.
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

const so = {
  SONumber: '', Status: 'Draft', CompanyID: 'C1', CustomerID: 'CU1', SODate: '2026-10-05', CreatedBy: 'admin', Note: '', Total: 0,
  Lines: [{ LineID: 'L1', ItemCode: 'FG-1', WarehouseID: 'WH1', OrderedQuantity: 5, DeliveredQuantity: 0 }, { LineID: 'L2', ItemCode: 'FG-2', OrderedQuantity: 1, Extra: {} }],
  Empty: {}, Sparse: { 0: 'a', 2: 'c' }, Grid: [[1, 2], [3]]
};
const inv = {
  Status: 'Draft', CompanyID: 'C1', CustomerID: 'CU1', InvoiceDate: '2026-10-06', TransactionNumber: '', Total: 10,
  SourceDeliveryNotes: [{ DeliveryNoteID: 'DN1', Amount: 10, Lines: [] }], DirectLines: [], ItemLines: [{ SourceSOID: 'SO1', ItemCode: 'FG-1', Quantity: 1 }]
};
const rsv = { ItemID: 'I1', WarehouseID: 'WH1', CompanyID: 'C1', Quantity: 4, Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'L1', CreatedByProductionID: '' };

test('the three collections come back exactly as RTDB gives them, through every kind of write', async () => {
  await reset({});
  for (const [path, doc] of [['salesOrders', so], ['customerInvoices', inv], ['stock/reservations', rsv]]) {
    await both(path + '/A1', 'put', doc);
    await both(path + '/A2', 'put', Object.assign({}, doc, { Status: 'Posted' }));
    await same(path + '/A1');
    await same(path, 'the whole collection, keyed and ordered as RTDB');
    await same(path + '/NOPE');
    await both(path + '/A1', 'patch', { Status: 'Reserved', 'Lines/0/DeliveredQuantity': 2, Note: null, New: { x: 1 } });
    await same(path + '/A1', 'a patch with path keys and a removal');
    await both(path + '/A1/Status', 'put', 'Cancelled');
    await same(path + '/A1', 'a put below a document');
    await both(path, 'patch', { 'A3/Status': 'Draft', A2: { Status: 'Gone' } });
    await same(path, 'a collection patch: a new document, a whole one replaced');
    await both(path + '/A2', 'delete');
    await same(path);
  }
});

test('movedPaths: which paths moved, an empty id is no document, a multi-path list of RTDB paths stays a filter', async () => {
  await reset({ vendorInvoices: { V1: { VendorID: 'VE1', Status: 'Posted' }, V2: { VendorID: 'VE2', Status: 'Posted' } } });
  assert.deepEqual(['salesOrders/X', 'customerInvoices', 'stock/reservations/R', 'stock/transactions', 'stock/ledger/I/W', 'stock/counters', 'vendorInvoices', 'salesOrdersX'].map(movedPaths.isMoved),
    [true, true, true, true, true, false, false, false]);
  assert.equal(await salesOrders.get(''), null);
  assert.equal(await customerInvoices.get(undefined), null);
  // A collection still in RTDB (T3) is read and filtered by where().
  assert.deepEqual(Object.keys(await movedPaths.where('vendorInvoices', { VendorID: 'VE2' })), ['V2']);
});

test('queries: each store\'s fields and derived lists; merged queries in id order', async () => {
  await reset({});
  await salesOrders.set('SO2', Object.assign({}, so, { Status: 'Reserved' }));
  await salesOrders.set('SO1', Object.assign({}, so, { Status: 'Partially Reserved', CreatedBy: 'rep' }));
  await salesOrders.set('SO3', Object.assign({}, so, { Status: 'Reserved', CompanyID: 'C2', SODate: '2026-11-01', Lines: [{ LineID: 'L1', ItemCode: 'FG-9' }] }));
  const ids = async (store, f) => Object.keys(await store.query(f));
  assert.deepEqual(await ids(salesOrders, { CompanyID: 'C1', Status: 'Reserved' }), ['SO2']);
  assert.deepEqual(await ids(salesOrders, { CreatedBy: 'rep' }), ['SO1']);
  assert.deepEqual(await ids(salesOrders, { ItemCode: 'FG-2' }), ['SO1', 'SO2'], 'a line\'s item');
  assert.deepEqual(await ids(salesOrders, { Period: '2026-11' }), ['SO3']);
  assert.deepEqual(Object.keys(await movedPaths.whereAny('salesOrders', ['Reserved', 'Partially Reserved'].map(Status => ({ CompanyID: 'C1', Status })))), ['SO1', 'SO2'], 'merged, in id order');

  await customerInvoices.set('CI1', inv);
  await customerInvoices.set('CI2', Object.assign({}, inv, { Status: 'Posted', SourceDeliveryNotes: [{ DeliveryNoteID: 'DN2' }], ItemLines: [] }));
  assert.deepEqual(await ids(customerInvoices, { DeliveryNoteID: 'DN1' }), ['CI1'], 'a Delivery Note it invoices');
  assert.deepEqual(await ids(customerInvoices, { SalesOrderID: 'SO1' }), ['CI1'], 'a Sales Order its item lines deliver');
  assert.deepEqual(await ids(customerInvoices, { CompanyID: 'C1', CustomerID: 'CU1', Status: 'Posted' }), ['CI2']);

  await reservations.set('R1', rsv);
  await reservations.set('R2', Object.assign({}, rsv, { Status: 'Released' }));
  await reservations.set('R3', Object.assign({}, rsv, { WarehouseID: 'WH2', CreatedByProductionID: 'P1' }));
  assert.deepEqual(await ids(reservations, { Status: 'Active', ItemID: 'I1', WarehouseID: 'WH1' }), ['R1']);
  assert.deepEqual(await ids(reservations, { SourceType: 'SalesOrder', SourceID: 'SO1' }), ['R1', 'R2', 'R3']);
  assert.deepEqual(await ids(reservations, { Status: 'Active', CreatedByProductionID: 'P1' }), ['R3']);
  assert.equal((await salesOrders.query({ Status: 'Reserved' })).SO2._q, undefined, 'the query fields are never returned');
  await assert.rejects(salesOrders.query({ SODate: '2026-10-05' }), /no equality query on SODate/);
  await assert.rejects(customerInvoices.query({ DeliveryNoteID: 'DN1', SalesOrderID: 'SO1' }), /one array filter/);
});
