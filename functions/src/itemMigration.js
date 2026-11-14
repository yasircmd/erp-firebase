// The items' move from the Realtime Database to Firestore (owner, 2026-11-14;
// docs/modules/ITEMS_FIRESTORE.md, step 3, QI6, QI8). New development,
// hand-written.
//
// QI8: copied before the deploy and again after it, the newer edit of each
// item winning (UpdatedAt, else CreatedAt), then checked; QI6: once the
// check passes, the old items are exported as JSON to the firm's Cloud
// Storage and deleted from the Realtime Database at once. Each runs in one
// corporate (the caller's runInCorporate); the firm starts it from Client
// Management (developer.js moveDeveloperItems), which reaches every
// corporate through the grant the functions already have.
'use strict';
const firebaseAdmin = require('./firebaseAdmin');
const itemStore = require('./itemStore');

// The old items, read straight from the Realtime Database (the 'items' path
// itself is answered from Firestore now: movedPaths.js).
const oldItems = async () => (await firebaseAdmin.rtdb.ref('items').get()).val() || {};
const stamp = d => String((d && (d.UpdatedAt || d.CreatedAt)) || '');
const plain = d => { const o = Object.assign({}, d || {}); delete o._q; return JSON.parse(JSON.stringify(o)); };
const same = (a, b) => JSON.stringify(sortKeys(plain(a))) === JSON.stringify(sortKeys(plain(b)));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}

// Copies the old items into Firestore: an item Firestore does not have, or
// whose old copy is newer (QI8: the newer edit wins). Returns the counts.
async function copy() {
  const old = await oldItems();
  const ids = Object.keys(old);
  const now = {};
  for (let i = 0; i < ids.length; i += 300) Object.assign(now, await itemStore.store.getMany(ids.slice(i, i + 300)));
  const write = {};
  let kept = 0;
  ids.forEach(id => {
    const f = now[id];
    if (!f || stamp(old[id]) > stamp(f)) write[id] = old[id];
    else kept++;
  });
  const copied = await itemStore.store.putMany(write);
  const accounts = await itemStore.rebuildAccounts();
  return { old: ids.length, copied, keptNewer: kept, accounts };
}

// Every old item is in Firestore, the same, or newer there.
async function check() {
  const old = await oldItems();
  const ids = Object.keys(old);
  const now = {};
  for (let i = 0; i < ids.length; i += 300) Object.assign(now, await itemStore.store.getMany(ids.slice(i, i + 300)));
  const missing = [], differing = [];
  ids.forEach(id => {
    const f = now[id];
    if (!f) missing.push(id);
    else if (!same(old[id], f) && !(stamp(f) > stamp(old[id]))) differing.push(id);
  });
  return { old: ids.length, ok: !missing.length && !differing.length, missing: missing.slice(0, 50), differing: differing.slice(0, 50), missingCount: missing.length, differingCount: differing.length };
}

// QI6: when the check passes, the old items go to the firm's Cloud Storage
// as JSON (the only way back), then are deleted from the Realtime Database.
async function finish() {
  const c = await check();
  if (!c.ok) return Object.assign({ finished: false }, c);
  const old = await oldItems();
  const n = Object.keys(old).length;
  if (!n) return { finished: true, old: 0, exported: '', note: 'Nothing left in the Realtime Database.' };
  const file = 'item-exports/' + firebaseAdmin.corporateId() + '/' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  await firebaseAdmin.firm.bucket().file(file).save(JSON.stringify(old), { contentType: 'application/json', resumable: false });
  await firebaseAdmin.rtdb.ref('items').remove();
  return { finished: true, old: n, exported: file };
}

module.exports = { copy, check, finish };
