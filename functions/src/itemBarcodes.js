// Item barcodes (owner, 2026-10-09; docs/modules/ITEM_BARCODES.md,
// decisions 64-66): the barcodes already printed on a product, as an extra
// way to find the item (its code stays system-generated). Several per
// item, each with a pack quantity; unique across all items; an EAN/UPC's
// check digit verified. Item Master's ported save is untouched: barcodes
// are stored on their own, RTDB itemBarcodes/{BARCODE} = { ItemID, PackQty }.
'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
const ROOT = 'itemBarcodes';
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const norm = v => String(v == null ? '' : v).trim().toUpperCase();

// GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14): from the right, the
// digits before the check digit weigh 3, 1, 3, 1...
function gtinOk(code) {
  const d = code.split('').map(Number), check = d.pop();
  const sum = d.reverse().reduce((t, n, i) => t + n * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}
// The barcode, cleaned; a message when it can't be one.
function checkBarcode(v) {
  const code = norm(v);
  if (!/^[A-Z0-9]{4,30}$/.test(code)) return { error: 'Barcode "' + String(v == null ? '' : v).trim() + '": letters and digits, 4 to 30.' };
  if (/^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length) && !gtinOk(code)) {
    return { error: 'Barcode ' + code + ': the check digit is wrong (an EAN/UPC barcode of ' + code.length + ' digits). Check it was typed right.' };
  }
  return { code };
}
function checkPack(v) {
  const n = v === '' || v == null ? 1 : Number(String(v).replace(/,/g, ''));
  return n > 0 && n <= 100000 ? Math.round(n * 1000) / 1000 : null;
}

const all = async () => (await rtdb.ref(ROOT).get()).val() || {};
const itemLabel = (items, id) => { const i = items[id] || {}; return (i.ItemCode || id) + (i.ItemName ? ' — ' + i.ItemName : ''); };
// { [itemId]: [{ Barcode, PackQty }] }
function byItem(map) {
  const out = {};
  Object.entries(map).forEach(([code, b]) => { (out[b.ItemID] = out[b.ItemID] || []).push({ Barcode: code, PackQty: b.PackQty || 1 }); });
  Object.values(out).forEach(l => l.sort((a, b) => a.Barcode.localeCompare(b.Barcode)));
  return out;
}

async function requireItemMaster(user, cap) {
  if (!(await moduleHasCapability('ITEMMASTER', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Item Master.');
  if (cap && !(await moduleHasCapability('ITEMMASTER', cap, user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change items.');
}

// Every item's barcodes (Item Master shows them in the list and the form).
exports.getItemBarcodes = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireItemMaster(user);
  return { barcodes: byItem(await all()) };
});

// The barcode index for the stock screens (step 2, decision 68): barcode →
// item and units, nothing else, for any signed-in user (they scan without
// Item Master's access); changing barcodes stays Item Master's "write".
exports.getBarcodeIndex = onCallWithMessages(onCallOptions, async (request) => {
  await requireUser(request);
  const index = {};
  Object.entries(await all()).forEach(([code, b]) => { index[code] = { ItemID: b.ItemID, PackQty: b.PackQty || 1 }; });
  return { index };
});

// An item's barcodes, replaced by the list given (Item Master's form).
exports.saveItemBarcodes = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireItemMaster(user, 'write');
  const d = request.data || {};
  const itemId = String(d.itemId || '').trim();
  const items = (await rtdb.ref('items').get()).val() || {};
  if (!itemId || !items[itemId]) throw new HttpsError('not-found', 'Item not found.');
  const rows = (Array.isArray(d.barcodes) ? d.barcodes : []).filter(r => String((r || {}).Barcode || '').trim());
  if (rows.length > 50) bad('Up to 50 barcodes an item.');
  const clean = rows.map(r => {
    const c = checkBarcode(r.Barcode);
    if (c.error) bad(c.error);
    const pack = checkPack(r.PackQty);
    if (pack == null) bad('Barcode ' + c.code + ': the pack quantity is more than 0 (empty for 1).');
    return { code: c.code, pack };
  });
  clean.forEach((r, i) => { if (clean.findIndex(x => x.code === r.code) !== i) bad('Barcode ' + r.code + ' is listed twice.'); });
  return withGlobalLock(user.uid, async () => {
    const map = await all();
    for (const r of clean) {
      if (map[r.code] && map[r.code].ItemID !== itemId) throw new HttpsError('already-exists', 'Barcode ' + r.code + ' is already on item ' + itemLabel(items, map[r.code].ItemID) + '.');
    }
    const now = new Date().toISOString(), by = user.profile.username || user.uid;
    const update = {};
    Object.entries(map).filter(([, b]) => b.ItemID === itemId).forEach(([code]) => { update[code] = null; });
    clean.forEach(r => { update[r.code] = { ItemID: itemId, PackQty: r.pack, At: (map[r.code] && map[r.code].ItemID === itemId && map[r.code].At) || now, By: by, UpdatedAt: now }; });
    if (Object.keys(update).length) await rtdb.ref(ROOT).update(update);
    return { success: true, barcodes: clean.map(r => ({ Barcode: r.code, PackQty: r.pack })) };
  });
});

// One row of Master Data Import → Item barcodes: adds a barcode to an item.
// A barcode already on an item (any) is the import's issue, checked before.
async function saveImportedBarcode(user, data) {
  const c = checkBarcode(data.Barcode);
  if (c.error) bad(c.error);
  const pack = checkPack(data.PackQty);
  if (pack == null) bad('The pack quantity is more than 0 (empty for 1).');
  return withGlobalLock(user.uid, async () => {
    const ref = rtdb.ref(ROOT + '/' + c.code);
    if ((await ref.get()).exists()) throw new HttpsError('already-exists', 'Barcode ' + c.code + ' is already on an item.');
    await ref.set({ ItemID: data.ItemID, PackQty: pack, At: new Date().toISOString(), By: user.profile.username || user.uid });
    return { id: c.code, code: c.code };
  });
}

Object.assign(module.exports, { checkBarcode, checkPack, gtinOk, byItem, all, saveImportedBarcode, ROOT });
