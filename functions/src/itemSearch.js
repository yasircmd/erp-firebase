// The item search (owner, 2026-11-14; docs/modules/ITEMS_FIRESTORE.md, step
// 3b, QI2, QI3): what an item picker shows as you type, and the Item Master
// list a page at a time, from the items' search fields in Firestore
// (itemStore.js), never the whole catalogue. New development, hand-written.
//
// A search matches, as the picker always did (SEARCH_PICKER.md): every word
// typed appears in the item's code, user code or name; code first, then the
// name's start, then a word's start, then anywhere. Its candidates come from
// the index: an exact barcode, the code's or user code's start, and (from 3
// letters, QI2) the 3-letter fragments of the longest word typed.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const firebaseAdmin = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const itemStore = require('./itemStore');
const { fromStore } = require('./docStore');

const onCallOptions = { region: 'us-central1' };
const MAX = 50, FRAGMENT_READS = 300, PREFIX_READS = 60;
const lower = v => String(v == null ? '' : v).trim().toLowerCase();
const col = () => firebaseAdmin.firestore.collection('items');
const docsOf = snap => { const out = {}; snap.docs.forEach(d => { const v = fromStore(d.data()); if (v) out[d.id] = v; }); return out; };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The search's candidates: { id: item }.
async function candidates(q) {
  const words = itemStore.words({ ItemName: q });
  const reads = [];
  // An exact barcode (itemBarcodes, keyed by the code in capitals).
  const code = String(q).trim().toUpperCase();
  if (/^[0-9A-Z-]{3,40}$/.test(code)) {
    reads.push(firebaseAdmin.rtdb.ref('itemBarcodes/' + code).get().then(s => {
      const b = s.val();
      return b && b.ItemID ? itemStore.byIds([b.ItemID]).then(f => Object.assign(f, f[b.ItemID] ? { __barcode: b.ItemID } : {})) : {};
    }));
  }
  // The code's or the user code's start.
  const q0 = lower(q);
  ['CodeLower', 'UserCodeLower'].forEach(f => reads.push(col().where('_q.' + f, '>=', q0).where('_q.' + f, '<', q0 + '').limit(PREFIX_READS).get().then(docsOf)));
  // From 3 letters: the longest word's fragments (its first, middle and last), inside words too (QI2).
  const longest = words.slice().sort((a, b) => b.length - a.length)[0] || '';
  if (longest.length >= 3) {
    const picks = [...new Set([0, Math.floor((longest.length - 3) / 2), longest.length - 3].map(i => longest.slice(i, i + 3)))];
    picks.forEach(g => reads.push(col().where('_q.Grams', 'array-contains', g).limit(FRAGMENT_READS).get().then(docsOf)));
  } else if (longest) {
    reads.push(col().where('_q.Words', 'array-contains', longest).limit(PREFIX_READS).get().then(docsOf));
  }
  const found = await Promise.all(reads);
  const out = {};
  let barcodeId = '';
  found.forEach(f => { if (f.__barcode) { barcodeId = f.__barcode; delete f.__barcode; } Object.assign(out, f); });
  return { items: out, barcodeId };
}

// Lower is better; -1: not a match. Every word typed must appear.
function rank(item, words) {
  const code = lower(item.ItemCode), user = lower(item.UserCode), name = lower(item.ItemName);
  const hay = code + ' ' + user + ' ' + name;
  if (!words.every(w => hay.includes(w))) return -1;
  const w = words[0];
  if (code.startsWith(w) || user.startsWith(w)) return 0;
  if (name.startsWith(w)) return 1;
  if (new RegExp('(^|[\\s\\-(/·—,.])' + escRe(w)).test(name)) return 2;
  return 3;
}

const pickFields = (id, i) => ({
  ItemID: id, ItemCode: i.ItemCode || '', ItemName: i.ItemName || '', UserCode: i.UserCode || '', Category: i.Category || '',
  SubCategoryID: i.SubCategoryID || '', UOMID: i.UOMID || '', AltUOMID: i.AltUOMID || '', ConversionFactor: i.ConversionFactor || 0,
  CompanyID: i.CompanyID || '', Status: i.Status || '', DefaultWarehouseID: i.DefaultWarehouseID || '', InventoryAccountID: i.InventoryAccountID || '',
  ConsumptionAccountID: i.ConsumptionAccountID || '', SalesCogsAccountID: i.SalesCogsAccountID || '', BatchTracked: Boolean(i.BatchTracked), TaxCode: i.TaxCode || ''
});

// Whether an item is on a price list (Sales Order's sellable items): one
// indexed query of its code (database.rules.json indexes priceListLines).
async function onAPriceList(code) {
  const s = await firebaseAdmin.rtdb.ref('priceListLines').orderByChild('ItemCode').equalTo(String(code)).limitToFirst(1).get();
  return Boolean(s.val());
}

// The items matching q for this user: [{ item fields }], best first, at most limit.
// opts: { companyId, status ('Active' by default; '' for any), category, stockOnly, sellable (on a price list) }
async function search(user, q, opts) {
  const o = opts || {};
  const words = lower(q).split(/\s+/).filter(Boolean);
  if (!words.length) return { items: [], more: false };
  const { items, barcodeId } = await candidates(q);
  const status = o.status === undefined ? 'Active' : o.status;
  const rows = Object.keys(items).map(id => ({ id, it: items[id] })).filter(({ it }) =>
    userCanAccessCompany(user.profile, it.CompanyID) && (!o.companyId || !it.CompanyID || it.CompanyID === o.companyId) &&
    (!status || it.Status === status) && (!o.category || it.Category === o.category) && (!o.stockOnly || it.InventoryAccountID));
  const ranked = rows.map(r => Object.assign(r, { r: r.id === barcodeId ? -1 : rank(r.it, words) })).filter(r => r.r >= 0 || r.id === barcodeId)
    .sort((a, b) => a.r - b.r || lower(a.it.ItemCode).localeCompare(lower(b.it.ItemCode), undefined, { numeric: true }));
  const limit = Math.max(1, Math.min(Number(o.limit) || MAX, 200));
  let list = ranked;
  if (o.sellable) {
    // Only the best candidates are checked, until the page is full.
    const kept = [];
    for (const r of ranked) { if (kept.length > limit) break; if (await onAPriceList(r.it.ItemCode)) kept.push(r); }
    list = kept;
  }
  return { items: list.slice(0, limit).map(r => pickFields(r.id, r.it)), more: list.length > limit };
}

// ---------- the callables ----------

// data: { q, companyId, category, stockOnly, sellable, status, limit }
exports.searchItems = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const q = String(d.q || '').slice(0, 80);
  const companyId = String(d.companyId || '').trim();
  if (companyId && !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return search(user, q, { companyId, category: String(d.category || ''), stockOnly: Boolean(d.stockOnly), sellable: Boolean(d.sellable), status: d.status === '' ? '' : undefined, limit: d.limit });
});

// The items with these ids (a document's own, when it is opened): [{ item fields }].
exports.getItemsByIds = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const ids = (Array.isArray((request.data || {}).ids) ? request.data.ids : []).slice(0, 500);
  const found = await itemStore.byIds(ids);
  return Object.keys(found).filter(id => userCanAccessCompany(user.profile, found[id].CompanyID)).map(id => pickFields(id, found[id]));
});

module.exports = Object.assign(exports, { search, rank, pickFields, MAX });
