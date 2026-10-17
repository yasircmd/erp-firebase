// Stock transactions and running balances in Firestore (owner, 2026-10-17;
// docs/modules/TRANSACTIONS_FIRESTORE.md, phase T1). New development,
// hand-written.
//
// They were RTDB's stock/transactions/{id} and stock/ledger/{item}/{wh}.
// Every reader downloaded the whole collection; here a reader asks for what
// it needs (queryTx), and the documents keep exactly the shape RTDB gave
// back, so the code that reads them, the ported modules' included, is
// unchanged:
//   - normalize() reproduces RTDB's storage rules, measured on the RTDB
//     emulator (functions/test/emulator/stockStore.emulator.test.js
//     compares the two): null and empty objects / arrays vanish, keys come
//     back sorted (integer keys first), and an integer-keyed object comes
//     back as an array when more than half its indices are present (the
//     others are holes);
//   - toStore() makes that storable in Firestore, which refuses holes
//     (stored as null) and arrays directly inside arrays (stored as
//     integer-keyed maps); normalize() on read turns both back.
//   - the query fields (the items, the warehouses, the period) are kept
//     under _q, never returned.
//
//   stockTransactions/{id}            the document, as before, plus _q { ItemIDs, WarehouseIDs, Period }
//   stockLedger/{itemId}|{warehouseId} { Quantity, AvgCost, TotalValue, UpdatedAt }, plus _q { ItemID, WarehouseID }
//
// Queries are equality only (and array-contains on an item): Firestore
// serves those from its automatic single-field indexes, so no composite
// index has to be deployed first (a missing one is refused in production,
// never on the emulator). Date ranges are filtered by the caller.
//
// No data is kept in module-level variables: one function instance will
// serve several corporates (docs/modules/MULTI_CORPORATE.md).
'use strict';
const { rtdb, firestore } = require('./firebaseAdmin');

const TX = 'stockTransactions';
const LEDGER = 'stockLedger';
const Q = '_q';
const BATCH = 400;

const INT = /^(0|[1-9]\d{0,9})$/;
const keyOrder = (a, b) => {
  const ai = INT.test(a), bi = INT.test(b);
  if (ai && bi) return Number(a) - Number(b);
  if (ai) return -1;
  if (bi) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

// A value as RTDB would give it back after storing it (null: nothing).
function normalize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  const entries = Array.isArray(v) ? Array.from(v, (x, i) => [String(i), x]) : Object.entries(v);
  const kept = [];
  entries.forEach(([k, x]) => { const n = normalize(x); if (n !== null) kept.push([k, n]); });
  if (!kept.length) return null;
  if (kept.every(([k]) => INT.test(k))) {
    const max = Math.max(...kept.map(([k]) => Number(k)));
    if (max < 2 * kept.length) {
      const arr = new Array(max + 1);
      kept.forEach(([k, x]) => { arr[Number(k)] = x; });
      return arr;
    }
  }
  kept.sort(([a], [b]) => keyOrder(a, b));
  const out = {};
  kept.forEach(([k, x]) => { out[k] = x; });
  return out;
}

// A normalized value in a form Firestore stores.
function toStore(v, inArray) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    if (inArray) {
      const m = {};
      v.forEach((x, i) => { if (x !== undefined) m[String(i)] = toStore(x, false); });
      return m;
    }
    return Array.from(v, x => toStore(x, true));
  }
  const out = {};
  Object.keys(v).forEach(k => { out[k] = toStore(v[k], false); });
  return out;
}

function fromStore(data) {
  if (!data) return null;
  const copy = Object.assign({}, data);
  delete copy[Q];
  return normalize(copy);
}

// RTDB update() on a value: each key is a path below it ('Lines/0/Qty'),
// null removes.
function setAt(obj, parts, value) {
  if (!parts.length) return value;
  const base = obj && typeof obj === 'object' ? (Array.isArray(obj) ? Object.assign({}, obj) : Object.assign({}, obj)) : {};
  const [head, ...rest] = parts;
  base[head] = setAt(base[head], rest, value);
  return base;
}
function applyUpdate(current, fields) {
  let doc = current;
  Object.keys(fields || {}).forEach(k => {
    const parts = String(k).split('/').filter(Boolean);
    doc = parts.length ? setAt(doc, parts, fields[k] === undefined ? null : fields[k]) : fields[k];
  });
  return normalize(doc);
}

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
const stored = d => Object.assign(toStore(d, false), { [Q]: queryFields(d) });

// ---------- transactions ----------
const txRef = id => {
  const s = String(id || '');
  if (!s || s.includes('/')) throw new Error('Invalid stock transaction id.');
  return firestore.collection(TX).doc(s);
};
const sorted = map => {
  const out = {};
  Object.keys(map).sort(keyOrder).forEach(k => { out[k] = map[k]; });
  return out;
};
const toMap = snap => {
  const out = {};
  snap.docs.forEach(d => { const v = fromStore(d.data()); if (v !== null) out[d.id] = v; });
  return sorted(out);
};

async function getTx(id) {
  const snap = await txRef(id).get();
  return snap.exists ? fromStore(snap.data()) : null;
}
// getTx as a snapshot ({ val(), exists() }), for code written against
// RTDB's rtdb.ref(...).get().
async function snapTx(id) {
  const v = await getTx(id);
  return { val: () => v, exists: () => v !== null, key: String(id) };
}
// { id: document } for the ids given (missing ones left out).
async function getTxs(ids) {
  const unique = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!unique.length) return {};
  const snaps = await firestore.getAll(...unique.map(txRef));
  const out = {};
  snaps.forEach(s => { if (s.exists) { const v = fromStore(s.data()); if (v !== null) out[s.id] = v; } });
  return sorted(out);
}
// Every stock transaction: what a whole RTDB read gave. Kept for the ported
// modules and the stock reports' history replay; a reader that needs less
// asks queryTx.
async function allTx() { return toMap(await firestore.collection(TX).get()); }

// RTDB set(): replaces the document (null or empty: deletes it).
async function setTx(id, doc, tx) {
  const ref = txRef(id);
  const v = normalize(doc);
  if (tx) { if (v === null) tx.delete(ref); else tx.set(ref, stored(v)); return v; }
  if (v === null) await ref.delete(); else await ref.set(stored(v));
  return v;
}
// RTDB update(): merges path keys into the document, creating it if absent.
async function updateTx(id, fields) {
  const ref = txRef(id);
  return firestore.runTransaction(async t => {
    const snap = await t.get(ref);
    const next = applyUpdate(snap.exists ? fromStore(snap.data()) : null, fields);
    if (next === null) t.delete(ref); else t.set(ref, stored(next));
    return next;
  });
}
async function deleteTx(id) { await txRef(id).delete(); }

// Equality filters only (see the header), on these fields; ItemID matches
// any line's item, WarehouseID any warehouse the document names.
const QUERY_FIELDS = ['TransactionType', 'Status', 'CompanyID', 'SourceInvoiceID', 'ReturnOfSaleID', 'TransactionNumber', 'VendorID', 'CustomerID', 'ItemID', 'WarehouseID', 'Period'];
async function queryTx(filters) {
  let q = firestore.collection(TX);
  const keys = Object.keys(filters || {});
  if (!keys.length) throw new Error('queryTx needs at least one filter (allTx reads everything).');
  keys.forEach(k => {
    if (!QUERY_FIELDS.includes(k)) throw new Error('queryTx: no equality query on ' + k + '.');
    const v = filters[k];
    if (v === undefined || v === null || typeof v === 'object') throw new Error('queryTx: ' + k + ' must be one value.');
    if (k === 'ItemID') q = q.where(Q + '.ItemIDs', 'array-contains', String(v));
    else if (k === 'WarehouseID') q = q.where(Q + '.WarehouseIDs', 'array-contains', String(v));
    else if (k === 'Period') q = q.where(Q + '.Period', '==', String(v));
    else q = q.where(k, '==', v);
  });
  if (keys.filter(k => k === 'ItemID' || k === 'WarehouseID').length > 1) throw new Error('queryTx: one array filter at most.');
  return toMap(await q.get());
}

async function deleteAll(collection) {
  for (;;) {
    const snap = await firestore.collection(collection).limit(BATCH).get();
    if (snap.empty) return;
    const b = firestore.batch();
    snap.docs.forEach(d => b.delete(d.ref));
    await b.commit();
  }
}
async function writeAll(collection, entries) {
  for (let i = 0; i < entries.length; i += BATCH) {
    const b = firestore.batch();
    entries.slice(i, i + BATCH).forEach(([ref, data]) => b.set(ref, data));
    await b.commit();
  }
}
// RTDB set() on the whole collection.
async function setAllTx(map) {
  await deleteAll(TX);
  const v = normalize(map) || {};
  await writeAll(TX, Object.keys(v).map(id => [txRef(id), stored(v[id])]));
}

// ---------- running balances ----------
const ledgerId = (itemId, warehouseId) => {
  const i = String(itemId || ''), w = String(warehouseId || '');
  if (!i || !w || (i + w).includes('/') || (i + w).includes('|')) throw new Error('Invalid stock ledger key.');
  return i + '|' + w;
};
const ledgerRef = (itemId, warehouseId) => firestore.collection(LEDGER).doc(ledgerId(itemId, warehouseId));
const storedEntry = (itemId, warehouseId, e) => Object.assign(toStore(e, false), { [Q]: { ItemID: String(itemId), WarehouseID: String(warehouseId) } });

async function getLedgerEntry(itemId, warehouseId) {
  const snap = await ledgerRef(itemId, warehouseId).get();
  return snap.exists ? fromStore(snap.data()) : null;
}
// { itemId: { warehouseId: entry } }: what RTDB's stock/ledger gave; only
// one item's or one warehouse's when asked ({ ItemID, WarehouseID }).
async function allLedger(filter) {
  const f = filter || {};
  let q = firestore.collection(LEDGER);
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
  const b = firestore.batch();
  ops.forEach(([ref, data]) => (data ? b.set(ref, data) : b.delete(ref)));
  await b.commit();
}
// RTDB set() on the whole of stock/ledger ({ itemId: { warehouseId: entry } }).
async function setAllLedger(nested) {
  await deleteAll(LEDGER);
  const v = normalize(nested) || {};
  const entries = [];
  Object.keys(v).forEach(i => Object.keys(v[i] || {}).forEach(w => entries.push([ledgerRef(i, w), storedEntry(i, w, v[i][w])])));
  await writeAll(LEDGER, entries);
}

// ---------- the RTDB paths, for the ported modules and the tests ----------
// The ported modules (legacy/runtime.js firebaseDbRequest_) and the test
// helpers still name RTDB paths; these are answered here, with RTDB's
// get / put / patch / post / delete semantics.
const isStockPath = path => /^stock\/(transactions|ledger)(\/|$)/.test(String(path || '').replace(/^\/+|\/+$/g, ''));
const getPath = (v, parts) => parts.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), v);

async function rtdbStyle(path, method, payload) {
  const parts = String(path || '').replace(/^\/+|\/+$/g, '').split('/');
  const m = String(method || 'get').toLowerCase();
  const node = parts[1];
  const rest = parts.slice(2);
  const val = x => (x === undefined ? null : x);

  if (node === 'transactions') {
    if (!rest.length) {
      if (m === 'get') { const all = await allTx(); return Object.keys(all).length ? all : null; }
      if (m === 'delete') { await deleteAll(TX); return null; }
      if (m === 'put') { await setAllTx(payload); return normalize(payload); }
      if (m === 'post') { const id = rtdb.ref().push().key; await setTx(id, payload); return { name: id }; }
      if (m === 'patch') {
        const byDoc = {};
        Object.keys(payload || {}).forEach(k => {
          const [id, ...sub] = k.split('/').filter(Boolean);
          (byDoc[id] = byDoc[id] || {})[sub.join('/')] = payload[k];
        });
        for (const id of Object.keys(byDoc)) {
          const f = byDoc[id];
          if ('' in f) await setTx(id, f['']); else await updateTx(id, f);
        }
        return payload || {};
      }
    }
    const [id, ...sub] = rest;
    if (m === 'get') return val(sub.length ? normalize(getPath(await getTx(id), sub)) : await getTx(id));
    if (m === 'put' || m === 'delete') {
      const value = m === 'delete' ? null : payload;
      if (!sub.length) { await setTx(id, value); return m === 'delete' ? null : normalize(value); }
      await updateTx(id, { [sub.join('/')]: value });
      return m === 'delete' ? null : normalize(value);
    }
    if (m === 'patch') {
      const prefix = sub.length ? sub.join('/') + '/' : '';
      const f = {};
      Object.keys(payload || {}).forEach(k => { f[prefix + k] = payload[k]; });
      if (Object.keys(f).length) await updateTx(id, f);
      return payload || {};
    }
  }

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
  TX, LEDGER, normalize, toStore, fromStore, applyUpdate, queryFields, keyOrder,
  getTx, snapTx, getTxs, allTx, setTx, updateTx, deleteTx, queryTx, QUERY_FIELDS, setAllTx,
  ledgerId, getLedgerEntry, allLedger, setLedgerEntries, setAllLedger,
  isStockPath, rtdbStyle
};
