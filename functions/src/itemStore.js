// The item store (owner, 2026-11-14; docs/modules/ITEMS_FIRESTORE.md): every
// reader of the items goes through here, so each reads only the items it
// needs, not the whole catalogue (21 MB at 50,000 items). New development,
// hand-written.
//
// Step 3 (QI1, QI8): the items are in Firestore, items/{id}, a document
// store (docStore.js) that movedPaths.js answers the old RTDB path 'items'
// with, so the ported code is unchanged. Each item keeps, under _q:
//   CodeLower, UserCodeLower, NameLower   its code, user code and name in lower case (the duplicate checks)
//   Words    the lower-case words of its code, user code and name (a word's start: step 3b's search)
//   Grams    every 3-letter fragment of those words (inside words, QI2)
//   Reorder  'yes' when it has a reorder level (QI7)
// and the store keeps itemAccounts: how many items use each inventory
// account, per company (period closing, the Correction JV, MIS, Opening
// Balances need every item's account, moved or not).
'use strict';
const firebaseAdmin = require('./firebaseAdmin');
const { makeStore } = require('./docStore');

// Any list (an array or a Set); a single id on its own counts as one.
const listOf = list => (list == null ? [] : typeof list === 'string' ? [list] : Array.from(list));
const ids = list => [...new Set(listOf(list).map(x => String(x == null ? '' : x).trim()).filter(x => x && !/[.#$\[\]/]/.test(x)))];
const lower = v => String(v == null ? '' : v).trim().toLowerCase();

// ---------- the search fields ----------

const MAX_GRAMS = 300;
const wordsIn = v => lower(v).split(/[^0-9a-zÀ-￿]+/).filter(Boolean);
function words(d) {
  return [...new Set([d.ItemCode, d.UserCode, d.ItemName].flatMap(wordsIn))];
}
function grams(d) {
  const out = new Set();
  words(d).forEach(w => { for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3)); });
  return [...out].slice(0, MAX_GRAMS);
}

const ACCOUNTS = 'itemAccounts';
const accountKey = d => (d && d.InventoryAccountID ? (d.CompanyID || '*') + '_' + d.InventoryAccountID : '');
// itemAccounts/{company or *}_{account} { CompanyID, AccountID, Count }: kept on every item write.
async function noteAccounts(id, before, after) {
  try {
    const was = accountKey(before), is = accountKey(after);
    if (was === is) return;
    const { FieldValue } = require('firebase-admin/firestore');
    const col = firebaseAdmin.firestore.collection(ACCOUNTS);
    const bump = (key, d, n) => col.doc(key).set({ CompanyID: d.CompanyID || '', AccountID: d.InventoryAccountID, Count: FieldValue.increment(n) }, { merge: true });
    if (was) await bump(was, before, -1);
    if (is) await bump(is, after, 1);
  } catch (e) {
    console.error('itemStore: itemAccounts not kept', e && e.message);
  }
}

const store = makeStore({
  name: 'item', path: 'items', collection: 'items',
  fields: ['Status', 'CompanyID', 'ItemCode', 'Category', 'SubCategoryID'],
  derived: {
    codeLower: { field: 'CodeLower', op: '==', value: d => lower(d.ItemCode) },
    userCodeLower: { field: 'UserCodeLower', op: '==', value: d => lower(d.UserCode) },
    nameLower: { field: 'NameLower', op: '==', value: d => lower(d.ItemName) },
    word: { field: 'Words', op: 'array-contains', value: words },
    gram: { field: 'Grams', op: 'array-contains', value: grams },
    reorder: { field: 'Reorder', op: '==', value: d => (Number(d.ReorderLevel) > 0 ? 'yes' : 'no') }
  },
  afterWrite: noteAccounts,
  auditDocuments: false // a master: the audit log keeps its changed fields (auditWrites.js), not a document's status
});

// ---------- by id, by code ----------

// The items with these ids, as { id: item } (the shape a whole read gave):
// an id with no item is simply absent.
const byIds = list => store.getMany(ids(list));

// The items with these item codes, as { id: item }.
async function byCodes(list) {
  const want = [...new Set(listOf(list).map(x => String(x == null ? '' : x).trim()).filter(Boolean))];
  const found = await Promise.all(want.map(code => store.query({ ItemCode: code })));
  return Object.assign({}, ...found);
}

// The items whose code or user code is this one, ignoring case (the item
// master's duplicate checks).
async function byCodeIgnoringCase(code) {
  const c = lower(code);
  if (!c) return {};
  const [a, b] = await Promise.all([store.query({ codeLower: c }), store.query({ userCodeLower: c })]);
  return Object.assign({}, a, b);
}
// The items with this exact name, ignoring case (Opening Balances' stock lines).
const byNameIgnoringCase = name => (lower(name) ? store.query({ nameLower: lower(name) }) : Promise.resolve({}));
// The items of a sub-category.
const bySubCategory = id => (id ? store.query({ SubCategoryID: String(id) }) : Promise.resolve({}));

// The item ids a document's lines name.
function lineItemIds(lines) {
  const out = [];
  (Array.isArray(lines) ? lines : Object.values(lines || {})).forEach(l => {
    if (!l || typeof l !== 'object') return;
    if (l.ItemID) out.push(l.ItemID);
  });
  return ids(out);
}
// The items of these lines: byIds(lineItemIds(lines)).
const forLines = (...lineLists) => byIds([].concat(...lineLists.map(lineItemIds)));

// ---------- reports (step 2, QI4, QI7) ----------

// Above this many, one read of the whole collection is quicker than as many
// single reads; the report still gets only the items it asked for.
const BULK_AT = 2000;
const companyOk = (item, companyId) => !companyId || !item.CompanyID || item.CompanyID === companyId;

// The items a report covers (those its ledger or documents name), of the company.
async function forReport(list, companyId) {
  const want = ids(list);
  let found;
  if (want.length > BULK_AT) {
    const everything = await store.all();
    found = {};
    want.forEach(id => { if (everything[id]) found[id] = everything[id]; });
  } else {
    found = await byIds(want);
  }
  const out = {};
  Object.keys(found).forEach(id => { if (companyOk(found[id], companyId)) out[id] = found[id]; });
  return out;
}

// The items a set of document lines names, by ItemID or (a line with only a
// code) by ItemCode.
async function forReportLines(lines, companyId) {
  const list = listOf(lines).filter(l => l && typeof l === 'object');
  const idList = ids(list.map(l => l.ItemID));
  const codes = [...new Set(list.filter(l => !l.ItemID && l.ItemCode).map(l => String(l.ItemCode).trim()).filter(Boolean))];
  if (idList.length + codes.length > BULK_AT) {
    const everything = await store.all();
    const idSet = new Set(idList), codeSet = new Set(codes), out = {};
    Object.keys(everything).forEach(id => { if ((idSet.has(id) || codeSet.has(everything[id].ItemCode)) && companyOk(everything[id], companyId)) out[id] = everything[id]; });
    return out;
  }
  const out = Object.assign({}, await forReport(idList, companyId), codes.length ? await byCodes(codes) : {});
  Object.keys(out).forEach(id => { if (!companyOk(out[id], companyId)) delete out[id]; });
  return out;
}

// The lines of a set of documents: every array of objects at their top.
const linesOf = docs => [].concat(...listOf(docs).filter(Boolean).map(d => [].concat(...Object.values(d).filter(Array.isArray).map(a => a.filter(x => x && typeof x === 'object')))));

// Every item with stock or movement: each has a stock ledger entry.
async function stocked(companyId) {
  const ledger = await require('./stockStore').allLedger();
  return forReport(Object.keys(ledger || {}), companyId);
}

// The items with a reorder level (QI7): the Reorder report lists them even
// before their first receipt.
async function withReorderLevel(companyId) {
  const found = await store.query({ reorder: 'yes' });
  const out = {};
  Object.keys(found).forEach(id => { if (Number(found[id].ReorderLevel) > 0 && companyOk(found[id], companyId)) out[id] = found[id]; });
  return out;
}

// ---------- every item's inventory account ----------

// The inventory accounts the company's items use (and the shared items'),
// moved or not: { accountId: true }.
async function inventoryAccounts(companyId) {
  const snap = await firebaseAdmin.firestore.collection(ACCOUNTS).where('Count', '>', 0).get();
  const out = {};
  snap.docs.forEach(d => { const a = d.data(); if (!companyId || !a.CompanyID || a.CompanyID === companyId) out[a.AccountID] = true; });
  return out;
}
// Rebuilds itemAccounts from the items (after the copy, or a Data Reset).
async function rebuildAccounts() {
  const fs = firebaseAdmin.firestore;
  const old = await fs.collection(ACCOUNTS).get();
  const counts = {};
  Object.values(await store.all()).forEach(d => {
    const k = accountKey(d);
    if (!k) return;
    counts[k] = counts[k] || { CompanyID: d.CompanyID || '', AccountID: d.InventoryAccountID, Count: 0 };
    counts[k].Count++;
  });
  for (let i = 0; i < old.docs.length; i += 400) { const b = fs.batch(); old.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
  await require('./docStore').writeAll(Object.keys(counts).map(k => [fs.collection(ACCOUNTS).doc(k), counts[k]]));
  return Object.keys(counts).length;
}

// Every item: what a whole read gave. Only for the readers that need every
// item (the pickers until step 3b, Master Import's duplicate check, the MIS
// builder's item data set).
const all = () => store.all();

module.exports = {
  store, ACCOUNTS, BULK_AT, byIds, byCodes, byCodeIgnoringCase, byNameIgnoringCase, bySubCategory, forLines, lineItemIds,
  forReport, forReportLines, linesOf, stocked, withReorderLevel, inventoryAccounts, rebuildAccounts, all, words, grams
};
