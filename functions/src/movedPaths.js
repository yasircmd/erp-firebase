// The RTDB paths whose documents are in Firestore now
// (docs/modules/TRANSACTIONS_FIRESTORE.md), answered with RTDB's
// get / put / patch / post / delete semantics. New development,
// hand-written.
//
// The ported modules (legacy/runtime.js firebaseDbRequest_), the test
// helpers and the hand-written code that reaches a collection by its path
// (Data Reset, the chart-of-accounts checks, the approval registry) name
// RTDB paths; this is the one list of those that moved and where they went.
//   T1  stock/transactions, stock/ledger   stockStore.js
//   T2  salesOrders, customerInvoices,     salesStore.js
//       stock/reservations
//   T3  vendorInvoices, purchaseOrders,    purchaseStore.js
//       purchaseRequisitions,
//       inventoryPurchaseRequisitions
//   T4  jobOrderBatches, jobOrderLines,    jobStore.js
//       pdcCheques
//   T5  approvalInstances                  approvalStore.js
'use strict';
const firebaseAdmin = require('./firebaseAdmin');
const { cleanPath, sorted } = require('./docStore');
const stockStore = require('./stockStore');
const salesStore = require('./salesStore');
const purchaseStore = require('./purchaseStore');
const jobStore = require('./jobStore');
const approvalStore = require('./approvalStore');

const STORES = [stockStore.txStore, salesStore.salesOrders, salesStore.customerInvoices, salesStore.reservations,
  purchaseStore.vendorInvoices, purchaseStore.purchaseOrders, purchaseStore.purchaseRequisitions, purchaseStore.inventoryPurchaseRequisitions,
  jobStore.jobOrderBatches, jobStore.jobOrderLines, jobStore.pdcCheques, approvalStore.approvalInstances];
const PATHS = ['stock/transactions', 'stock/ledger', 'salesOrders', 'customerInvoices', 'stock/reservations',
  'vendorInvoices', 'purchaseOrders', 'purchaseRequisitions', 'inventoryPurchaseRequisitions',
  'jobOrderBatches', 'jobOrderLines', 'pdcCheques', 'approvalInstances'];

const under = (p, root) => p === root || p.startsWith(root + '/');
const isMoved = path => { const p = cleanPath(path); return PATHS.some(r => under(p, r)); };
// The document store a path is in or under (null: not moved, or the
// stock ledger, which is not a collection of documents).
const storeOf = path => { const p = cleanPath(path); return STORES.find(s => under(p, s.path)) || null; };

async function request(path, method, payload) {
  const p = cleanPath(path);
  if (stockStore.isStockPath(p)) return stockStore.rtdbStyle(p, method, payload);
  const s = storeOf(p);
  if (!s) throw new Error('movedPaths: ' + p + ' is not a moved path.');
  const rest = p.slice(s.path.length).split('/').filter(Boolean);
  // In a variant's request, its original's documents are the variant's (MODULE_BUILDER.md, Q483, Q486).
  const VD = require('./variantDocuments');
  if (VD.variantFor(s.path)) return variantRequest(VD, s, rest, String(method || 'get').toLowerCase(), payload);
  const out = await s.rtdbStyle(rest, method, payload);
  if (rest.length === 1 && String(method || 'get').toLowerCase() === 'get' && VD.BASE_OF[s.path]) await VD.noteRead(s.path, out); // a variant's document, from the original's screen
  return out;
}
async function variantRequest(VD, s, rest, m, payload) {
  if (!rest.length) {
    if (m === 'get') return VD.guardAll(s.path, await s.rtdbStyle(rest, m, payload));
    throw new Error('movedPaths: a variant writes its documents one by one.');
  }
  const doc = await s.rtdbStyle(rest.slice(0, 1), 'get');
  if (m === 'get') return VD.guardDoc(s.path, doc) == null ? null : s.rtdbStyle(rest, m, payload);
  VD.assertOwn(s.path, doc);
  if (rest.length === 1 && (m === 'put' || m === 'patch') && payload && typeof payload === 'object') {
    const marks = await VD.marksFor(s.path, payload.CompanyID || (doc && doc.CompanyID));
    // A new document is the variant's; an edit keeps it and takes the extra fields sent.
    payload = Object.assign({}, payload, m === 'put' || !doc ? marks : (marks.VariantFields ? { VariantFields: marks.VariantFields } : {}));
  }
  return s.rtdbStyle(rest, m, payload);
}

// A path's value, set and update, wherever it lives now.
const val = async p => (isMoved(p) ? request(p, 'get') : (await firebaseAdmin.rtdb.ref(p).get()).val());
const put = async (p, v) => (isMoved(p) ? request(p, 'put', v === undefined ? null : JSON.parse(JSON.stringify(v))) : firebaseAdmin.rtdb.ref(p).set(v));
const patch = async (p, fields) => (isMoved(p) ? request(p, 'patch', fields) : firebaseAdmin.rtdb.ref(p).update(fields));

// { id: document } of a collection's documents whose fields equal these,
// wherever it lives: a query where it moved, else the RTDB read filtered
// (for the collections that move in a later phase).
async function where(path, filters) {
  const s = storeOf(path);
  if (s && cleanPath(path) === s.path) return s.query(filters);
  const all = (await val(path)) || {};
  const keys = Object.keys(filters || {});
  const out = {};
  Object.keys(all).forEach(id => { const d = all[id]; if (d && keys.every(k => d[k] === filters[k])) out[id] = d; });
  return out;
}

// where() for each set of filters, merged, in id order (as a whole read
// gave them): the documents matching any of them.
async function whereAny(path, filterSets) {
  const found = await Promise.all((filterSets || []).map(f => where(path, f)));
  return sorted(Object.assign({}, ...found));
}

// { id: document } for the ids given, in a moved collection.
async function getMany(path, ids) {
  const s = storeOf(path);
  if (!s || cleanPath(path) !== s.path) throw new Error('movedPaths: ' + path + ' is not a moved collection.');
  return s.getMany(ids);
}

module.exports = { PATHS, isMoved, storeOf, request, val, put, patch, where, whereAny, getMany };
