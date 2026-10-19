// A collection of documents moved from RTDB to Firestore, keeping the shape
// RTDB gave (owner, 2026-10-17; docs/modules/TRANSACTIONS_FIRESTORE.md).
// New development, hand-written. Built for the stock transactions (T1,
// stockStore.js) and shared by every collection that moves after them
// (T2: Sales Orders, Customer Invoices, reservations; T3-T5 the rest).
//
// The documents keep exactly the shape RTDB gave back, so the code that
// reads them, the ported modules' included, is unchanged:
//   - normalize() reproduces RTDB's storage rules, measured on the RTDB
//     emulator (functions/test/emulator/stockStore.emulator.test.js
//     compares the two): null and empty objects / arrays vanish, keys come
//     back sorted (integer keys first), and an integer-keyed object comes
//     back as an array when more than half its indices are present (the
//     others are holes);
//   - toStore() makes that storable in Firestore, which refuses holes
//     (stored as null) and arrays directly inside arrays (stored as
//     integer-keyed maps); normalize() on read turns both back.
//   - the derived query fields (a document's items, warehouses, period) are
//     kept under _q, never returned.
//
// Queries are equality only (and array-contains on a derived list):
// Firestore serves those from its automatic single-field indexes, so no
// composite index has to be deployed first (a missing one is refused in
// production, never on the emulator). Date ranges are filtered by the
// caller.
//
// No data is kept in module-level variables: one function instance will
// serve several corporates (docs/modules/MULTI_CORPORATE.md). The clients
// are taken from firebaseAdmin.js when a store is used.
'use strict';
// Loaded here, not when first used: firebaseAdmin.js makes the default app
// only when no app exists yet (the emulator suites make a named one).
const firebaseAdmin = require('./firebaseAdmin');

const Q = '_q';
const BATCH = 400;
const fs = () => firebaseAdmin.firestore;

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
  const base = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
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

const sorted = map => {
  const out = {};
  Object.keys(map).sort(keyOrder).forEach(k => { out[k] = map[k]; });
  return out;
};
const getPath = (v, parts) => parts.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), v);
const cleanPath = path => String(path || '').replace(/^\/+|\/+$/g, '');

async function deleteAll(collection) {
  const firestore = fs();
  for (;;) {
    const snap = await firestore.collection(collection).limit(BATCH).get();
    if (snap.empty) return;
    const b = firestore.batch();
    snap.docs.forEach(d => b.delete(d.ref));
    await b.commit();
  }
}
async function writeAll(entries) {
  const firestore = fs();
  for (let i = 0; i < entries.length; i += BATCH) {
    const b = firestore.batch();
    entries.slice(i, i + BATCH).forEach(([ref, data]) => b.set(ref, data));
    await b.commit();
  }
}

// One moved collection.
//   name:       for messages ('stock transaction')
//   path:       its RTDB path ('stock/transactions')
//   collection: its Firestore collection
//   fields:     the document fields it can be queried on, by equality
//   derived:    { filter: { field, op, value(doc) } }: query fields kept
//               under _q (op '==' or 'array-contains'), computed on write
//   queryName:  the query function's name, for messages ('queryTx')
function makeStore(spec) {
  const { name, path, collection } = spec;
  const fields = spec.fields || [];
  const derived = spec.derived || {};
  const qn = spec.queryName || 'query';
  const filters = fields.concat(Object.keys(derived));

  const col = () => fs().collection(collection);
  const ref = id => {
    const s = String(id || '');
    if (!s || s.includes('/')) throw new Error('Invalid ' + name + ' id.');
    return col().doc(s);
  };
  const stored = d => {
    const out = toStore(d, false);
    const keys = Object.keys(derived);
    if (keys.length) {
      out[Q] = {};
      keys.forEach(k => { out[Q][derived[k].field] = derived[k].value(d); });
    }
    return out;
  };
  const toMap = snap => {
    const out = {};
    snap.docs.forEach(d => { const v = fromStore(d.data()); if (v !== null) out[d.id] = v; });
    return sorted(out);
  };

  // An empty id is no document (RTDB read the whole collection there, which
  // has none of a document's fields).
  async function get(id) {
    if (id === undefined || id === null || String(id) === '') return null;
    const snap = await ref(id).get();
    return snap.exists ? fromStore(snap.data()) : null;
  }
  // get as a snapshot ({ val(), exists() }), for code written against
  // RTDB's rtdb.ref(...).get().
  async function snap(id) {
    const v = await get(id);
    return { val: () => v, exists: () => v !== null, key: String(id) };
  }
  // { id: document } for the ids given (missing ones left out).
  async function getMany(ids) {
    const unique = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!unique.length) return {};
    const snaps = await fs().getAll(...unique.map(ref));
    const out = {};
    snaps.forEach(s => { if (s.exists) { const v = fromStore(s.data()); if (v !== null) out[s.id] = v; } });
    return sorted(out);
  }
  // Every document: what a whole RTDB read gave. A reader that needs less
  // asks query.
  async function all() { return toMap(await col().get()); }

  // RTDB set(): replaces the document (null or empty: deletes it). With a
  // batch or transaction, the write joins it.
  async function set(id, doc, tx) {
    const r = ref(id);
    const v = normalize(doc);
    if (tx) { if (v === null) tx.delete(r); else tx.set(r, stored(v)); return v; }
    if (v === null) await r.delete(); else await r.set(stored(v));
    return v;
  }
  // RTDB update(): merges path keys into the document, creating it if absent.
  async function update(id, fieldsToSet) {
    const r = ref(id);
    return fs().runTransaction(async t => {
      const s = await t.get(r);
      const next = applyUpdate(s.exists ? fromStore(s.data()) : null, fieldsToSet);
      if (next === null) t.delete(r); else t.set(r, stored(next));
      return next;
    });
  }
  async function remove(id) { await ref(id).delete(); }
  // RTDB transaction(): fn(current) gives the document to write, or
  // undefined to abort; in a Firestore transaction, retried on contention.
  // { committed, snapshot } as RTDB's.
  async function transact(id, fn) {
    const r = ref(id);
    return fs().runTransaction(async t => {
      const s = await t.get(r);
      const current = s.exists ? fromStore(s.data()) : null;
      const next = fn(current === null ? null : JSON.parse(JSON.stringify(current)));
      if (next === undefined) return { committed: false, snapshot: { val: () => current, exists: () => current !== null } };
      const v = normalize(next);
      if (v === null) t.delete(r); else t.set(r, stored(v));
      return { committed: true, snapshot: { val: () => v, exists: () => v !== null } };
    });
  }

  // Equality filters only (see the header), on `fields` and `derived`.
  async function query(f) {
    let q = col();
    const keys = Object.keys(f || {});
    if (!keys.length) throw new Error(qn + ' needs at least one filter (all() reads everything).');
    let arrays = 0;
    keys.forEach(k => {
      if (!filters.includes(k)) throw new Error(qn + ': no equality query on ' + k + '.');
      const v = f[k];
      if (v === undefined || v === null || typeof v === 'object') throw new Error(qn + ': ' + k + ' must be one value.');
      const d = derived[k];
      if (d) {
        if (d.op === 'array-contains') arrays++;
        q = q.where(Q + '.' + d.field, d.op, String(v));
      } else q = q.where(k, '==', v);
    });
    if (arrays > 1) throw new Error(qn + ': one array filter at most.');
    return toMap(await q.get());
  }

  // RTDB set() on the whole collection.
  async function setAll(map) {
    await deleteAll(collection);
    const v = normalize(map) || {};
    await writeAll(Object.keys(v).map(id => [ref(id), stored(v[id])]));
  }

  // RTDB's get / put / patch / post / delete on the path, or below it
  // (parts: the path's segments after the collection's own).
  async function rtdbStyle(rest, method, payload) {
    const m = String(method || 'get').toLowerCase();
    const val = x => (x === undefined ? null : x);
    if (!rest.length) {
      if (m === 'get') { const a = await all(); return Object.keys(a).length ? a : null; }
      if (m === 'delete') { await deleteAll(collection); return null; }
      if (m === 'put') { await setAll(payload); return normalize(payload); }
      if (m === 'post') { const id = firebaseAdmin.rtdb.ref().push().key; await set(id, payload); return { name: id }; }
      if (m === 'patch') {
        const byDoc = {};
        Object.keys(payload || {}).forEach(k => {
          const [id, ...sub] = k.split('/').filter(Boolean);
          (byDoc[id] = byDoc[id] || {})[sub.join('/')] = payload[k];
        });
        for (const id of Object.keys(byDoc)) {
          const f = byDoc[id];
          if ('' in f) await set(id, f['']); else await update(id, f);
        }
        return payload || {};
      }
    }
    const [id, ...sub] = rest;
    if (m === 'get') return val(sub.length ? normalize(getPath(await get(id), sub)) : await get(id));
    if (m === 'put' || m === 'delete') {
      const value = m === 'delete' ? null : payload;
      if (!sub.length) { await set(id, value); return m === 'delete' ? null : normalize(value); }
      await update(id, { [sub.join('/')]: value });
      return m === 'delete' ? null : normalize(value);
    }
    if (m === 'patch') {
      const prefix = sub.length ? sub.join('/') + '/' : '';
      const f = {};
      Object.keys(payload || {}).forEach(k => { f[prefix + k] = payload[k]; });
      if (Object.keys(f).length) await update(id, f);
      return payload || {};
    }
    throw new Error(name + ': ' + m + ' on ' + [path].concat(rest).join('/') + ' is not supported.');
  }

  return { name, path, collection, fields: filters, ref, get, snap, getMany, all, set, update, remove, transact, query, setAll, rtdbStyle };
}

module.exports = { Q, BATCH, INT, keyOrder, normalize, toStore, fromStore, setAt, applyUpdate, sorted, getPath, cleanPath, deleteAll, writeAll, makeStore };
