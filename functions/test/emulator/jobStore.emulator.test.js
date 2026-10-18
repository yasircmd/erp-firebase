// Job Orders and PDCs in Firestore (functions/src/jobStore.js;
// docs/modules/TRANSACTIONS_FIRESTORE.md, T4): the same shape RTDB gave
// through every kind of write, their queries, and a Production Entry's Job
// Order effects worked out as the step-by-step code did and written with
// the posting, or not at all.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const movedPaths = require('../../src/movedPaths');
const { jobOrderBatches, jobOrderLines, pdcCheques } = require('../../src/jobStore');
const { salesOrders, reservations } = require('../../src/salesStore');
const { postStock } = require('../../src/stockPosting');
const production = require('../../src/productionPosting');
const stockStore = require('../../src/stockStore');
const { rtdb, reset, baseFixture, firestore, today } = require('./_helpers');

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

const batch = { BatchNumber: 'JO-1', Status: 'Submitted', CompanyID: 'C1', Origin: 'Sales', CreatedBy: 'admin', JODate: today, Note: '', Lines: [] };
const line = { ParentBatchID: 'B1', Status: 'Accepted', ItemCode: 'FG-1', OrderedQuantity: 5, SubJONumber: 'JO-1-1', LinkedSalesOrderLines: [{ SOID: 'SO1', SOLineID: 'S1' }], Empty: {} };
const pdc = { Direction: 'Received', Status: 'Pending', CompanyID: 'C1', PartyType: 'Customer', PartyID: 'CU1', ChequeNumber: '000123', Amount: 50, JVIDs: [], History: [{ Event: 'Posted', Date: today }] };

test('the three collections come back exactly as RTDB gives them, through every kind of write', async () => {
  await reset({});
  for (const [path, doc] of [['jobOrderBatches', batch], ['jobOrderLines', line], ['pdcCheques', pdc]]) {
    await both(path + '/A1', 'put', doc);
    await both(path + '/A2', 'put', Object.assign({}, doc, { Status: 'Cleared' }));
    await same(path + '/A1');
    await same(path, 'the whole collection');
    await both(path + '/A1', 'patch', { Status: 'Closed', Note: null, 'History/1/Event': 'Cleared', New: { x: 1 } });
    await same(path + '/A1', 'a patch with path keys and a removal');
    await both(path + '/A1/ApprovalInstanceID', 'delete');
    await same(path + '/A1');
    await both(path, 'patch', { 'A3/Status': 'Draft', A2: { Status: 'Gone' } });
    await same(path);
  }
});

test('queries: each store\'s fields', async () => {
  await reset({});
  await jobOrderBatches.set('B1', batch);
  await jobOrderBatches.set('B2', Object.assign({}, batch, { CompanyID: 'C2' }));
  await jobOrderLines.set('L1', line);
  await jobOrderLines.set('L2', Object.assign({}, line, { ParentBatchID: 'B2', Status: 'Open' }));
  await pdcCheques.set('P1', pdc);
  await pdcCheques.set('P2', Object.assign({}, pdc, { Direction: 'Issued', BankAccountID: 'A-BANK', PartyType: 'Vendor', PartyID: 'V1' }));
  const ids = async (store, f) => Object.keys(await store.query(f));
  assert.deepEqual(await ids(jobOrderBatches, { CompanyID: 'C1' }), ['B1']);
  assert.deepEqual(await ids(jobOrderLines, { ParentBatchID: 'B2' }), ['L2']);
  assert.deepEqual(await ids(jobOrderLines, { Status: 'Accepted' }), ['L1']);
  assert.deepEqual(await ids(pdcCheques, { Direction: 'Issued', BankAccountID: 'A-BANK' }), ['P2']);
  assert.deepEqual(await ids(pdcCheques, { PartyID: 'CU1', CompanyID: 'C1' }), ['P1']);
  assert.deepEqual(await ids(pdcCheques, { Status: 'Pending' }), ['P1', 'P2']);
  await assert.rejects(pdcCheques.query({ ChequeDate: today }), /no equality query on ChequeDate/);
});

const user = { uid: 'u-admin', profile: { username: 'admin', role: 'Admin', AssignedCompanies: ['C1'] } };
function fixture() {
  const f = baseFixture();
  f.items.I9 = { ItemCode: 'FG-1', ItemName: 'Finished', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' };
  f.jobOrderBatches = { B1: batch };
  f.jobOrderLines = { L1: line };
  // 4 ordered, 1 reserved: a shortfall of 3 the production can fill.
  f.salesOrders = { SO1: { SONumber: 'SO-1', Status: 'Partially Reserved', CompanyID: 'C1', Lines: [{ LineID: 'S1', ItemCode: 'FG-1', WarehouseID: 'WH1', OrderedQuantity: 4, DeliveredQuantity: 0 }] } };
  f.stock = { reservations: { R1: { ItemID: 'I9', ItemCode: 'FG-1', WarehouseID: 'WH1', CompanyID: 'C1', Quantity: 1, Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'S1', CreatedByProductionID: '' } } };
  return f;
}
const made = (qty, dir) => [{ ItemID: 'I9', ItemCode: 'FG-1', Quantity: qty, Direction: dir, JobOrderLineID: 'L1', WarehouseID: 'WH1' }];
const gl = id => ({
  type: 'Production', date: today, description: 'Production ' + id, reference: '',
  lines: [{ AccountCode: '1300', Debit: 30, Credit: 0, Description: 'x' }, { AccountCode: '2100', Debit: 0, Credit: 30, Description: 'x' }],
  dimensions: { CompanyID: 'C1' }, extra: { SourceTransactionID: id }
});
const refused = b => b.update(firestore.collection('journalEntries').doc('GONE'), { X: 1 });
const doc = (id, lines) => () => ({ [id]: { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', TransactionDate: today, Lines: lines } });

test('a production fills its linked order\'s shortfall, moves its Job Order line on, and lands with its posting or not at all', async () => {
  await reset(fixture());
  const plan = await production.planProduction('admin', { mode: 'post', prodId: 'P1', lineQuantities: { L1: 3 }, inflightLines: made(3, 'In') });
  assert.deepEqual(Object.keys(plan.lines), ['L1']);
  assert.equal(plan.lines.L1.Status, 'In Progress', '3 of 5 produced');
  const created = Object.values(plan.reservations);
  assert.deepEqual(created.map(r => [r.ItemID, r.Quantity, r.SourceID, r.SourceLineID, r.CreatedByProductionID]), [['I9', 3, 'SO1', 'S1', 'P1']], 'the shortfall, reserved');
  assert.equal(plan.orders.SO1.Status, 'Reserved', 'now fully reserved');

  await assert.rejects(postStock(user, gl('P1'), {}, doc('P1', made(3, 'In')), async b => { await production.planWriter(plan)(b); refused(b); }));
  assert.equal((await jobOrderLines.get('L1')).Status, 'Accepted', 'no line changed');
  assert.equal((await salesOrders.get('SO1')).Status, 'Partially Reserved');
  assert.equal(Object.keys(await reservations.query({ CreatedByProductionID: 'P1' })).length, 0, 'no reservation made');

  await postStock(user, gl('P1'), {}, doc('P1', made(3, 'In')), production.planWriter(plan));
  assert.equal((await jobOrderLines.get('L1')).Status, 'In Progress');
  assert.equal((await salesOrders.get('SO1')).Status, 'Reserved');

  // Two more: the line is complete (nothing left to allocate).
  const more = await production.planProduction('admin', { mode: 'post', prodId: 'P2', lineQuantities: { L1: 2 }, inflightLines: made(2, 'In') });
  assert.equal(more.lines.L1.Status, 'Completed');
  assert.deepEqual(Object.keys(more.reservations), []);
});

test('a production reversal releases its own reservations and steps its Job Order line back', async () => {
  await reset(fixture());
  const plan = await production.planProduction('admin', { mode: 'post', prodId: 'P1', lineQuantities: { L1: 3 }, inflightLines: made(3, 'In') });
  await postStock(user, gl('P1'), {}, doc('P1', made(3, 'In')), production.planWriter(plan));

  const back = await production.planProduction('admin', { mode: 'reverse', prodId: 'P1', lineIds: ['L1'], inflightLines: made(3, 'Out') });
  const released = Object.values(back.reservations);
  assert.deepEqual(released.map(r => [r.Status, r.ReleaseReason, r.CreatedByProductionID]), [['Released', 'Production Entry reversed', 'P1']], 'only its own');
  assert.equal(back.orders.SO1.Status, 'Partially Reserved', 'the order short again');
  assert.equal(back.lines.L1.Status, 'Accepted', 'nothing produced now: back to Accepted (a Sales batch)');

  await assert.rejects(postStock(user, gl('PRDD-1'), {}, doc('PRDD-1', made(3, 'Out')), async b => { await production.planWriter(back)(b); refused(b); }));
  assert.equal((await jobOrderLines.get('L1')).Status, 'In Progress', 'nothing rolled back');
  await postStock(user, gl('PRDD-1'), {}, doc('PRDD-1', made(3, 'Out')), production.planWriter(back));
  assert.equal((await jobOrderLines.get('L1')).Status, 'Accepted');
  assert.equal((await stockStore.getTx('PRDD-1')).Status, 'Posted');
});
