// The item store (owner, 2026-11-14; docs/modules/ITEMS_FIRESTORE.md, QI1):
// every reader of the items goes through here, so each reads only the items
// it needs, not the whole catalogue (21 MB at 50,000 items). New
// development, hand-written.
//
// Step 1: on the Realtime Database, where the items are today, by id.
// Step 3 moves the items to Firestore behind the same calls.
'use strict';
const { rtdb } = require('./firebaseAdmin');

// Any list (an array or a Set); a single id on its own counts as one.
const listOf = list => (list == null ? [] : typeof list === 'string' ? [list] : Array.from(list));
const ids = list => [...new Set(listOf(list).map(x => String(x == null ? '' : x).trim()).filter(x => x && !/[.#$\[\]/]/.test(x)))];

// The items with these ids, as { id: item } (the shape a whole read gave):
// an id with no item is simply absent.
async function byIds(list) {
  const want = ids(list);
  const snaps = await Promise.all(want.map(id => rtdb.ref('items/' + id).get()));
  const out = {};
  snaps.forEach((s, i) => { const v = s.val(); if (v !== null && v !== undefined) out[want[i]] = v; });
  return out;
}

// The items with these item codes, as { id: item }, like byIds: one
// query each on ItemCode (database.rules.json indexes it on items).
async function byCodes(list) {
  const want = [...new Set(listOf(list).map(x => String(x == null ? '' : x).trim()).filter(Boolean))];
  const snaps = await Promise.all(want.map(code => rtdb.ref('items').orderByChild('ItemCode').equalTo(code).get()));
  const out = {};
  snaps.forEach(s => Object.assign(out, s.val() || {}));
  return out;
}

// ---------- reports (step 2, QI4, QI7) ----------

// Above this many, one read of the list is quicker than as many single
// reads; the report still gets only the items it asked for.
const BULK_AT = 2000;
const companyOk = (item, companyId) => !companyId || !item.CompanyID || item.CompanyID === companyId;

// The items a report covers (those with stock or movement, which the
// report already knows from its ledger or documents), of the company.
async function forReport(list, companyId) {
  const want = ids(list);
  let found;
  if (want.length > BULK_AT) {
    const all = (await rtdb.ref('items').get()).val() || {};
    found = {};
    want.forEach(id => { if (all[id]) found[id] = all[id]; });
  } else {
    found = await byIds(want);
  }
  const out = {};
  Object.keys(found).forEach(id => { if (companyOk(found[id], companyId)) out[id] = found[id]; });
  return out;
}

// The items a set of document lines names, by ItemID or (a line with
// only a code) by ItemCode: a report over many documents.
async function forReportLines(lines, companyId) {
  const list = listOf(lines).filter(l => l && typeof l === 'object');
  const idList = ids(list.map(l => l.ItemID));
  const codes = [...new Set(list.filter(l => !l.ItemID && l.ItemCode).map(l => String(l.ItemCode).trim()).filter(Boolean))];
  if (idList.length + codes.length > BULK_AT) {
    const all = (await rtdb.ref('items').get()).val() || {};
    const idSet = new Set(idList), codeSet = new Set(codes), out = {};
    Object.keys(all).forEach(id => { if ((idSet.has(id) || codeSet.has(all[id].ItemCode)) && companyOk(all[id], companyId)) out[id] = all[id]; });
    return out;
  }
  const out = Object.assign({}, await forReport(idList, companyId), codes.length ? await byCodes(codes) : {});
  Object.keys(out).forEach(id => { if (!companyOk(out[id], companyId)) delete out[id]; });
  return out;
}

// The lines of a set of documents: every array of objects at their top.
const linesOf = docs => [].concat(...listOf(docs).filter(Boolean).map(d => [].concat(...Object.values(d).filter(Array.isArray).map(a => a.filter(x => x && typeof x === 'object')))));

// Every item with stock or movement: each has a stock ledger entry (kept
// at zero once it has moved).
async function stocked(companyId) {
  const ledger = await require('./stockStore').allLedger();
  return forReport(Object.keys(ledger || {}), companyId);
}

// The items with a reorder level (QI7): the Reorder report lists them even
// before their first receipt. database.rules.json indexes ReorderLevel.
async function withReorderLevel(companyId) {
  const found = (await rtdb.ref('items').orderByChild('ReorderLevel').startAt(0.000001).get()).val() || {};
  const out = {};
  Object.keys(found).forEach(id => { if (Number(found[id].ReorderLevel) > 0 && companyOk(found[id], companyId)) out[id] = found[id]; });
  return out;
}

// The item ids a document's lines name (ItemID, and a line's own
// components where it has them).
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

module.exports = { byIds, byCodes, forLines, lineItemIds, forReport, forReportLines, linesOf, stocked, withReorderLevel, BULK_AT };
