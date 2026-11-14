// The item store (owner, 2026-11-14; docs/modules/ITEMS_FIRESTORE.md, QI1):
// every reader of the items goes through here, so each reads only the items
// it needs, not the whole catalogue (21 MB at 50,000 items). New
// development, hand-written.
//
// Step 1: on the Realtime Database, where the items are today, by id.
// Step 3 moves the items to Firestore behind the same calls.
'use strict';
const { rtdb } = require('./firebaseAdmin');

const ids = list => [...new Set((list || []).map(x => String(x == null ? '' : x).trim()).filter(x => x && !/[.#$\[\]/]/.test(x)))];

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
  const want = [...new Set((list || []).map(x => String(x == null ? '' : x).trim()).filter(Boolean))];
  const snaps = await Promise.all(want.map(code => rtdb.ref('items').orderByChild('ItemCode').equalTo(code).get()));
  const out = {};
  snaps.forEach(s => Object.assign(out, s.val() || {}));
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

module.exports = { byIds, byCodes, forLines, lineItemIds };
