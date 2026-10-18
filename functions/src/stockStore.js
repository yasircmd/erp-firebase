// Stock transactions and running balances in Firestore (owner, 2026-10-17;
// docs/modules/TRANSACTIONS_FIRESTORE.md, phase T1). New development,
// hand-written.
//
// They were RTDB's stock/transactions/{id} and stock/ledger/{item}/{wh}.
// Every reader downloaded the whole collection; here a reader asks for what
// it needs (queryTx). The documents keep exactly the shape RTDB gave back
// (docStore.js), so the code that reads them, the ported modules' included,
// is unchanged.
//
//   stockTransactions/{id}            the document, as before, plus _q { ItemIDs, WarehouseIDs, Period }
//   stockLedger/{itemId}|{warehouseId} { Quantity, AvgCost, TotalValue, UpdatedAt }, plus _q { ItemID, WarehouseID }
//
// Queries are equality only (and array-contains on an item or warehouse);
// see docStore.js.
//
// No data is kept in module-level variables: one function instance will
// serve several corporates (docs/modules/MULTI_CORPORATE.md).
'use strict';
const { Q, keyOrder, normalize, toStore, fromStore, applyUpdate, sorted, getPath, cleanPath, deleteAll, writeAll, makeStore } = require('./docStore');
const firebaseAdmin = require('./firebaseAdmin');
const fsOf = () => firebaseAdmin.firestore;

const TX = 'stockTransactions';
const LEDGER = 'stockLedger';

// ---------- the query fields ----------
const linesOf = d => [].concat(...['Lines', 'NonStockLines'].map(k => {
  const l = d && d[k];
  return Array.isArray(l) ? l : (l && typeof l === 'object' ? Object.values(l) : []);
})).filter(Boolean);
function queryFields(d) {
  const items = new Set(), warehouses = new Set();
  ['WarehouseID', 'FromWarehouseID', 'ToWarehouseID'].forEach(k => { if (d[k]) warehouses.add(String(d[k])); });
  linesOf(d).forEach(l => {
    if (l.ItemID) items.add(String(l.ItemID));
    ['WarehouseID', 'FromWarehouseID', 'ToWarehouseID'].forEach(k => { if (l[k]) warehouses.add(String(l[k])); });
  });
  return { ItemIDs: [...items].sort(), WarehouseIDs: [...warehouses].sort(), Period: String(d.TransactionDate || '').slice(0, 7) };
}

// ---------- transactions ----------
// Equality filters only, on these fields; ItemID matches any line's item,
// WarehouseID any warehouse the document names.
const txStore = makeStore({
  name: 'stock transaction', path: 'stock/transactions', collection: TX, queryName: 'queryTx',
  fields: ['TransactionType', 'Status', 'CompanyID', 'SourceInvoiceID', 'ReturnOfSaleID', 'TransactionNumber', 'VendorID', 'CustomerID'],
  derived: {
    ItemID: { field: 'ItemIDs', op: 'array-contains', value: d => queryFields(d).ItemIDs },
    WarehouseID: { field: 'WarehouseIDs', op: 'array-contains', value: d => queryFields(d).WarehouseIDs },
    Period: { field: 'Period', op: '==', value: d => queryFields(d).Period }
  }
});
const QUERY_FIELDS = txStore.fields;
const getTx = txStore.get;
const snapTx = txStore.snap;
const getTxs = txStore.getMany;
// Every stock transaction: what a whole RTDB read gave. Kept for the ported
// modules and the stock reports' history replay; a reader that needs less
// asks queryTx.
const allTx = txStore.all;
const setTx = txStore.set;
const updateTx = txStore.update;
const deleteTx = txStore.remove;
const queryTx = txStore.query;
const setAllTx = txStore.setAll;

// ---------- running balances ----------
const ledgerId = (itemId, warehouseId) => {
  const i = String(itemId || ''), w = String(warehouseId || '');
  if (!i || !w || (i + w).includes('/') || (i + w).includes('|')) throw new Error('Invalid stock ledger key.');
  return i + '|' + w;
};
const ledgerRef = (itemId, warehouseId) => fsOf().collection(LEDGER).doc(ledgerId(itemId, warehouseId));
const storedEntry = (itemId, warehouseId, e) => Object.assign(toStore(e, false), { [Q]: { ItemID: String(itemId), WarehouseID: String(warehouseId) } });

async function getLedgerEntry(itemId, warehouseId) {
  const snap = await ledgerRef(itemId, warehouseId).get();
  return snap.exists ? fromStore(snap.data()) : null;
}
// { itemId: { warehouseId: entry } }: what RTDB's stock/ledger gave; only
// one item's or one warehouse's when asked ({ ItemID, WarehouseID }).
async function allLedger(filter) {
  const f = filter || {};
  let q = fsOf().collection(LEDGER);
  if (f.ItemID) q = q.where(Q + '.ItemID', '==', String(f.ItemID));
  if (f.WarehouseID) q = q.where(Q + '.WarehouseID', '==', String(f.WarehouseID));
  const snap = await q.get();
  const out = {};
  snap.docs.forEach(d => {
    const { ItemID, WarehouseID } = (d.data() || {})[Q] || {};
    const v = fromStore(d.data());
    if (!ItemID || !WarehouseID || v === null) return;
    (out[ItemID] = out[ItemID] || {})[WarehouseID] = v;
  });
  const res = {};
  Object.keys(out).sort(keyOrder).forEach(i => { res[i] = sorted(out[i]); });
  return res;
}
// Several balances at once ({ 'itemId|warehouseId': entry or null }), in
// one batch (or the transaction given): all land, or none.
async function setLedgerEntries(entries, tx) {
  const ops = Object.keys(entries || {}).map(key => {
    const [itemId, warehouseId] = key.split('|');
    const v = normalize(entries[key]);
    return [ledgerRef(itemId, warehouseId), v === null ? null : storedEntry(itemId, warehouseId, v)];
  });
  if (!ops.length) return;
  if (tx) { ops.forEach(([ref, data]) => (data ? tx.set(ref, data) : tx.delete(ref))); return; }
  if (ops.length > 499) throw new Error('Too many stock balances in one posting.');
  const b = fsOf().batch();
  ops.forEach(([ref, data]) => (data ? b.set(ref, data) : b.delete(ref)));
  await b.commit();
}
// RTDB set() on the whole of stock/ledger ({ itemId: { warehouseId: entry } }).
async function setAllLedger(nested) {
  await deleteAll(LEDGER);
  const v = normalize(nested) || {};
  const entries = [];
  Object.keys(v).forEach(i => Object.keys(v[i] || {}).forEach(w => entries.push([ledgerRef(i, w), storedEntry(i, w, v[i][w])])));
  await writeAll(entries);
}

// ---------- the RTDB paths, for the ported modules and the tests ----------
// The ported modules (legacy/runtime.js firebaseDbRequest_, through
// movedPaths.js) and the test helpers still name RTDB paths; these are
// answered here, with RTDB's get / put / patch / post / delete semantics.
const isStockPath = path => /^stock\/(transactions|ledger)(\/|$)/.test(cleanPath(path));

async function rtdbStyle(path, method, payload) {
  const parts = cleanPath(path).split('/');
  const m = String(method || 'get').toLowerCase();
  const node = parts[1];
  const rest = parts.slice(2);
  const val = x => (x === undefined ? null : x);

  if (node === 'transactions') return txStore.rtdbStyle(rest, m, payload);

  if (node === 'ledger') {
    const [itemId, warehouseId, ...sub] = rest;
    if (!itemId) {
      if (m === 'get') { const all = await allLedger(); return Object.keys(all).length ? all : null; }
      if (m === 'delete') { await deleteAll(LEDGER); return null; }
      if (m === 'put') { await setAllLedger(payload); return normalize(payload); }
    }
    if (itemId && !warehouseId) {
      if (m === 'get') return val((await allLedger({ ItemID: itemId }))[itemId]);
      if (m === 'put' || m === 'delete') {
        const now = await allLedger({ ItemID: itemId });
        const next = m === 'delete' ? {} : (normalize(payload) || {});
        const e = {};
        Object.keys(now[itemId] || {}).forEach(w => { e[itemId + '|' + w] = null; });
        Object.keys(next).forEach(w => { e[itemId + '|' + w] = next[w]; });
        await setLedgerEntries(e);
        return m === 'delete' ? null : normalize(payload);
      }
    }
    if (itemId && warehouseId) {
      const current = await getLedgerEntry(itemId, warehouseId);
      if (m === 'get') return val(sub.length ? normalize(getPath(current, sub)) : current);
      let next;
      if (m === 'put' || m === 'delete') next = sub.length ? applyUpdate(current, { [sub.join('/')]: m === 'delete' ? null : payload }) : normalize(m === 'delete' ? null : payload);
      else if (m === 'patch') {
        const prefix = sub.length ? sub.join('/') + '/' : '';
        const f = {};
        Object.keys(payload || {}).forEach(k => { f[prefix + k] = payload[k]; });
        next = applyUpdate(current, f);
      }
      if (next !== undefined) { await setLedgerEntries({ [itemId + '|' + warehouseId]: next }); return m === 'delete' ? null : (m === 'patch' ? payload || {} : normalize(payload)); }
    }
  }
  throw new Error('stockStore: ' + m + ' on ' + path + ' is not supported.');
}

module.exports = {
  TX, LEDGER, txStore, normalize, toStore, fromStore, applyUpdate, queryFields, keyOrder,
  getTx, snapTx, getTxs, allTx, setTx, updateTx, deleteTx, queryTx, QUERY_FIELDS, setAllTx,
  ledgerId, getLedgerEntry, allLedger, setLedgerEntries, setAllLedger,
  isStockPath, rtdbStyle
};
