// Stock transactions and balances in Firestore keep RTDB's shape
// (functions/src/stockStore.js; docs/modules/TRANSACTIONS_FIRESTORE.md, T1).
// Every case runs the same operations against the RTDB emulator itself and
// through stockStore, and every read must come back identical: what the
// ported modules and the hand-written code saw from RTDB is what they see
// now.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const store = require('../../src/stockStore');
const { app, rtdb, reset } = require('./_helpers');

test.after(async () => { await app.delete(); });

// RTDB's own answer, and stockStore's, for a path.
const viaRtdb = async path => (await rtdb.ref(path).get()).val();
const holes = v => JSON.stringify(v, (k, x) => (x === undefined ? '<hole>' : x));
async function both(path, method, payload) {
  const ref = rtdb.ref(path);
  if (method === 'put') await ref.set(payload === undefined ? null : JSON.parse(JSON.stringify(payload)));
  else if (method === 'patch') await ref.update(payload);
  else if (method === 'delete') await ref.remove();
  await store.rtdbStyle(path, method, payload);
}
async function same(path, why) {
  assert.equal(holes(await store.rtdbStyle(path, 'get')), holes(await viaRtdb(path)), why || path);
}

const tricky = {
  T1: {
    TransactionType: 'GRN', TransactionDate: '2026-10-05', CompanyID: 'C1', Status: 'Draft', Note: '', Qty: 0, Flag: false,
    Lines: [{ ItemID: 'IT1', WarehouseID: 'WH1', Quantity: 2, Batches: [] }, { ItemID: 'IT2', WarehouseID: 'WH2', Quantity: 1, Extra: {} }],
    NonStockLines: [], Empty: {}, Nested: { a: { b: {} }, c: 1 },
    Sparse: { 0: 'a', 2: 'c' }, Wide: { 0: 'a', 5: 'c' }, One: { 1: 'x' }, Holey: [1, null, 3], Lead: [null, null, 5], Tail: [1, 2, null],
    Grid: [[1, 2], [3]], z: 'last', a: 'first', 10: 'ten', 9: 'nine'
  },
  T2: { TransactionType: 'MaterialIssue', CompanyID: 'C2', Status: 'Posted', TransactionDate: '2026-11-01', FromWarehouseID: 'WH9', Lines: [{ ItemID: 'IT1' }] }
};

test('a document comes back exactly as RTDB gives it: empties dropped, keys sorted, arrays and holes, arrays inside arrays', async () => {
  await reset({});
  for (const id of Object.keys(tricky)) await both('stock/transactions/' + id, 'put', tricky[id]);
  await same('stock/transactions/T1');
  await same('stock/transactions/T2');
  await same('stock/transactions', 'the whole collection, keyed and ordered as RTDB');
  await same('stock/transactions/T1/Lines/0', 'a path inside a document');
  await same('stock/transactions/T1/Missing');
  await same('stock/transactions/NOPE');
  // normalize() alone matches RTDB on each tricky field.
  const t1 = await viaRtdb('stock/transactions/T1');
  for (const k of Object.keys(tricky.T1)) assert.equal(holes(store.normalize(tricky.T1[k])), holes(t1[k] === undefined ? null : t1[k]), 'normalize ' + k);
});

test('updates as RTDB: path keys, null removes, a whole subtree replaced, a missing document created', async () => {
  await reset({});
  await both('stock/transactions/T1', 'put', tricky.T1);
  await both('stock/transactions/T1', 'patch', { Status: 'Posted', 'Lines/0/Quantity': 5, 'Lines/1': null, Note: 'x', Flag: null, Nested: { q: [] } });
  await same('stock/transactions/T1');
  await both('stock/transactions/NEW', 'patch', { Status: 'Draft', CompanyID: 'C1' });
  await same('stock/transactions/NEW');
  await both('stock/transactions/T1/Lines/0', 'patch', { Quantity: 7, Batches: ['B1'] });
  await same('stock/transactions/T1');
  await both('stock/transactions/T1/Reference', 'put', 'R-9');
  await same('stock/transactions/T1');
  await both('stock/transactions', 'patch', { 'T2/Status': 'Reversed', T3: { TransactionType: 'GRN', Status: 'Draft' } });
  await same('stock/transactions');
  await both('stock/transactions/NEW', 'patch', { Status: null, CompanyID: null });
  await same('stock/transactions/NEW', 'every field removed: the document is gone');
  await both('stock/transactions/T1', 'delete');
  await same('stock/transactions');
  await both('stock/transactions', 'delete');
  await same('stock/transactions', 'cleared');
});

test('running balances: the whole ledger, one item, one balance, as RTDB nests them', async () => {
  await reset({});
  const ledger = { IT1: { WH1: { Quantity: 2, AvgCost: 3.5, TotalValue: 7 }, WH2: { Quantity: 0, AvgCost: 0, TotalValue: 0 } }, IT2: { WH1: { Quantity: 1, AvgCost: 1, TotalValue: 1, UpdatedAt: '2026-10-05T00:00:00.000Z' } } };
  await both('stock/ledger', 'put', ledger);
  await same('stock/ledger');
  await same('stock/ledger/IT1');
  await same('stock/ledger/IT1/WH1');
  await same('stock/ledger/IT1/WH1/AvgCost');
  await same('stock/ledger/IT9/WH1');
  await both('stock/ledger/IT1/WH1', 'patch', { Quantity: 4, TotalValue: 14 });
  await both('stock/ledger/IT3/WH5', 'put', { Quantity: 9, AvgCost: 1, TotalValue: 9 });
  await both('stock/ledger/IT2', 'delete');
  await same('stock/ledger');
  assert.deepEqual(await store.getLedgerEntry('IT1', 'WH1'), await viaRtdb('stock/ledger/IT1/WH1'));
  await store.setLedgerEntries({ 'IT1|WH2': null, 'IT4|WH1': { Quantity: 1, AvgCost: 2, TotalValue: 2 } });
  await rtdb.ref().update({ 'stock/ledger/IT1/WH2': null, 'stock/ledger/IT4/WH1': { Quantity: 1, AvgCost: 2, TotalValue: 2 } });
  await same('stock/ledger', 'several balances in one batch');
  await both('stock/ledger', 'delete');
  await same('stock/ledger');
});

test('queries: equality only, by type, status, company, an item or a warehouse; anything else refused', async () => {
  await reset({});
  for (const id of Object.keys(tricky)) await store.setTx(id, tricky[id]);
  await store.setTx('T3', { TransactionType: 'GRN', CompanyID: 'C1', Status: 'Posted', TransactionDate: '2026-10-09', Lines: [{ ItemID: 'IT2', WarehouseID: 'WH1' }] });
  const ids = async f => Object.keys(await store.queryTx(f));
  assert.deepEqual(await ids({ TransactionType: 'GRN' }), ['T1', 'T3']);
  assert.deepEqual(await ids({ TransactionType: 'GRN', Status: 'Posted' }), ['T3']);
  assert.deepEqual(await ids({ CompanyID: 'C1', ItemID: 'IT2' }), ['T1', 'T3']);
  assert.deepEqual(await ids({ WarehouseID: 'WH9' }), ['T2'], 'the document\'s own warehouse');
  assert.deepEqual(await ids({ Period: '2026-11' }), ['T2']);
  assert.deepEqual(Object.keys(await store.getTxs(['T3', 'NOPE', 'T1'])), ['T1', 'T3']);
  assert.equal((await store.queryTx({ TransactionType: 'GRN' })).T1._q, undefined, 'the query fields are never returned');
  await assert.rejects(store.queryTx({}), /at least one filter/);
  await assert.rejects(store.queryTx({ TransactionDate: '2026-10-05' }), /no equality query on TransactionDate/);
  await assert.rejects(store.queryTx({ Status: ['Draft', 'Posted'] }), /must be one value/);
  await assert.rejects(store.queryTx({ ItemID: 'IT1', WarehouseID: 'WH1' }), /one array filter/);
});
