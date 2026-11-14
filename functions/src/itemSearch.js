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

// ---------- Item Master: a page at a time (QI3) ----------

const PAGE = 100, SCAN = 300, SCAN_MAX = 3000;
const ownCategory = i => (i.CustomCategoryID ? 'X-' + i.CustomCategoryID : i.Category);
const full = (id, i) => { const o = Object.assign({ ItemID: id }, i); delete o._q; return o; };
async function requireItemMasterAccess(user) {
  if (!(await moduleHasCapability('ITEMMASTER', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Item Master.');
}
function filtersOf(user, d) {
  const companyId = String(d.companyId || '').trim();
  const category = String(d.category || '').trim(), status = String(d.status || '').trim();
  return it => userCanAccessCompany(user.profile, it.CompanyID) && (!companyId || it.CompanyID === companyId) &&
    (!category || ownCategory(it) === category) && (!status || it.Status === status);
}

// The page cursor, from the screen as it was given: [ItemCode, id], or none.
function cursorOf(v) {
  try { const c = JSON.parse(String(v || '')); return Array.isArray(c) && c.length === 2 && c.every(x => typeof x === 'string') ? c : null; } catch (e) { return null; }
}

// data: { q, companyId, category, status, after }: { items (whole records), next (the cursor, '' at the end), searched }
exports.getItemsPage = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireItemMasterAccess(user);
  const d = request.data || {};
  const keep = filtersOf(user, d);
  const q = String(d.q || '').trim().slice(0, 80);
  if (q) {
    // Typed: the search's best 200 (it reads its candidates only).
    const { items, barcodeId } = await candidates(q);
    const words = lower(q).split(/\s+/).filter(Boolean);
    const rows = Object.keys(items).map(id => ({ id, it: items[id], r: id === barcodeId ? -1 : rank(items[id], words) }))
      .filter(x => (x.r >= 0 || x.id === barcodeId) && keep(x.it)).sort((a, b) => a.r - b.r || lower(a.it.ItemCode).localeCompare(lower(b.it.ItemCode), undefined, { numeric: true }));
    return { items: rows.slice(0, 200).map(x => full(x.id, x.it)), next: '', searched: true, more: rows.length > 200 };
  }
  // In code order, from the cursor, the filters kept, until a page is full (or SCAN_MAX read: "Load more" goes on).
  const out = [];
  // The cursor is the last item's code and id: two items with one code (two companies, an import) are both listed.
  let after = cursorOf(d.after), scanned = 0, ended = false;
  const { FieldPath } = require('firebase-admin/firestore');
  while (out.length < PAGE && scanned < SCAN_MAX) {
    let qy = col().orderBy('ItemCode').orderBy(FieldPath.documentId()).limit(SCAN);
    if (after) qy = qy.startAfter(after[0], after[1]);
    const snap = await qy.get();
    scanned += snap.size;
    let used = 0;
    for (const doc of snap.docs) {
      used++;
      after = [doc.get('ItemCode'), doc.id];
      const it = fromStore(doc.data());
      if (it && keep(it)) out.push(full(doc.id, it));
      if (out.length >= PAGE) break;
    }
    // The end: the last read was short and every document of it was used.
    if (snap.size < SCAN) { ended = used === snap.size; break; }
  }
  return { items: out, next: ended || !after ? '' : JSON.stringify(after), searched: false };
});

// Copy to Excel (QI3): every item the filters keep, as tab-separated text, built here.
exports.getItemsExport = onCallWithMessages(Object.assign({}, onCallOptions, { timeoutSeconds: 300, memory: '1GiB' }), async (request) => {
  const user = await requireUser(request);
  await requireItemMasterAccess(user);
  const d = request.data || {};
  const keep = filtersOf(user, d);
  const q = String(d.q || '').trim();
  let list;
  if (q) {
    const { items } = await candidates(q);
    const words = lower(q).split(/\s+/).filter(Boolean);
    list = Object.keys(items).filter(id => rank(items[id], words) >= 0).map(id => [id, items[id]]);
  } else list = Object.entries(await itemStore.all());
  list = list.filter(([, it]) => keep(it)).sort((a, b) => lower(a[1].ItemCode).localeCompare(lower(b[1].ItemCode), undefined, { numeric: true }));
  const [subs, uoms, companies] = await Promise.all(['itemSubCategories', 'uoms', 'companies'].map(p => firebaseAdmin.rtdb.ref(p).get().then(x => x.val() || {})));
  const cell = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  const lines = [['Item Code', 'User Code', 'Item Name', 'Category', 'Sub-Category', 'UOM', 'Company', 'Batch Tracked', 'Status'].join('\t')];
  list.forEach(([, i]) => lines.push([i.ItemCode, i.UserCode, i.ItemName, ownCategory(i), (subs[i.SubCategoryID] || {}).Name, (uoms[i.UOMID] || {}).Code,
    i.CompanyID ? (companies[i.CompanyID] || {}).LegalName || i.CompanyID : 'Shared', i.BatchTracked ? 'Yes' : 'No', i.Status].map(cell).join('\t')));
  return { tsv: lines.join('\n'), count: list.length };
});

module.exports = Object.assign(exports, { search, rank, pickFields, MAX });
