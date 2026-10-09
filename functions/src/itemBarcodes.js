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
const { userCanAccessCompany } = require('./glWriting');
const BarcodeSvg = require('./barcodeSvg');
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

// ---------- step 3: own products' numbers and labels (decisions 72-75) ----------

const SETTINGS = 'barcodeSettings/';
const DEFAULTS = { GS1Prefix: '', RollWidthMm: 50, RollHeightMm: 25, SheetCols: 3, SheetRows: 8, SheetMarginMm: 10 };
const requireCompanyAccess = (user, co) => {
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return co;
};
const settingsOf = async co => Object.assign({}, DEFAULTS, (await rtdb.ref(SETTINGS + co).get()).val() || {});

// A company's barcode settings: its GS1 company prefix and its label stock.
exports.getBarcodeSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const co = requireCompanyAccess(user, String((request.data || {}).companyId || '').trim());
  return { settings: await settingsOf(co), canWrite: await moduleHasCapability('ITEMMASTER', 'write', user.profile.role) };
});

exports.saveBarcodeSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireItemMaster(user, 'write');
  const d = request.data || {};
  const co = requireCompanyAccess(user, String(d.companyId || '').trim());
  const prefix = String(d.GS1Prefix == null ? '' : d.GS1Prefix).trim();
  if (prefix && !/^\d{6,11}$/.test(prefix)) bad('The GS1 company prefix is 6 to 11 digits, as GS1 issued it (or empty: in-store numbers).');
  const n = (k, lo, hi, label) => {
    const v = Number(d[k]);
    if (!(v >= lo && v <= hi)) bad(label + ' is ' + lo + ' to ' + hi + '.');
    return Math.round(v * 10) / 10;
  };
  const out = { GS1Prefix: prefix, RollWidthMm: n('RollWidthMm', 20, 150, 'The label width (mm)'), RollHeightMm: n('RollHeightMm', 10, 150, 'The label height (mm)'),
    SheetCols: Math.round(n('SheetCols', 1, 8, 'Labels across a sheet')), SheetRows: Math.round(n('SheetRows', 1, 20, 'Labels down a sheet')),
    SheetMarginMm: n('SheetMarginMm', 0, 30, 'The sheet margin (mm)'), UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid };
  await rtdb.ref(SETTINGS + co).set(out);
  return { success: true, settings: out };
});

// The next free numbers of a scheme: a GS1 prefix's (prefix + item
// reference + check digit) or in-store EAN-13s (200 + 9 digits + check).
function numberer(prefix, start, taken) {
  const refLen = prefix ? 12 - prefix.length : 9;
  const head = prefix || '200';
  let n = start;
  return () => {
    for (;;) {
      n++;
      if (String(n).length > refLen) throw new HttpsError('resource-exhausted', prefix ? 'The GS1 prefix ' + prefix + ' has no item numbers left.' : 'In-store numbers are used up.');
      const twelve = head + String(n).padStart(refLen, '0');
      const code = twelve + BarcodeSvg.ean13Check(twelve);
      if (!taken[code]) { taken[code] = true; return { code, n }; }
    }
  };
}

// Numbers for items without a barcode (Item Master's "write"): previewed,
// then saved. Each becomes the item's barcode (one unit), so it scans at
// once in Retail Sales and the stock screens.
exports.generateItemBarcodes = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireItemMaster(user, 'write');
  const d = request.data || {};
  const co = requireCompanyAccess(user, String(d.companyId || '').trim());
  const ids = [...new Set((Array.isArray(d.itemIds) ? d.itemIds : []).map(x => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) bad('Choose the items.');
  if (ids.length > 500) bad('Up to 500 items at a time.');
  const run = async () => {
    const [items, map, settings] = await Promise.all([rtdb.ref('items').get().then(s => s.val() || {}), all(), settingsOf(co)]);
    const prefix = settings.GS1Prefix || '';
    const counterPath = 'barcodeCounters/' + (prefix ? 'gs1/' + prefix : 'instore');
    const has = byItem(map), taken = Object.fromEntries(Object.keys(map).map(k => [k, true]));
    const next = numberer(prefix, Number((await rtdb.ref(counterPath).get()).val()) || 0, taken);
    const generated = [], skipped = [];
    let last = null;
    for (const id of ids) {
      const it = items[id];
      if (!it) { skipped.push({ ItemID: id, ItemCode: id, Reason: 'not found' }); continue; }
      if (it.CompanyID && it.CompanyID !== co) { skipped.push({ ItemID: id, ItemCode: it.ItemCode, Reason: 'another company\'s item' }); continue; }
      if ((has[id] || []).length) { skipped.push({ ItemID: id, ItemCode: it.ItemCode, Reason: 'has a barcode (' + has[id][0].Barcode + ')' }); continue; }
      last = next();
      generated.push({ ItemID: id, ItemCode: it.ItemCode, ItemName: it.ItemName || '', Barcode: last.code });
    }
    return { generated, skipped, scheme: prefix ? 'GS1 ' + prefix : 'In-store', counterPath, last };
  };
  if (d.save !== true) { const r = await run(); return { generated: r.generated, skipped: r.skipped, scheme: r.scheme, saved: false }; }
  return withGlobalLock(user.uid, async () => {
    const r = await run();
    if (r.generated.length) {
      const now = new Date().toISOString(), by = user.profile.username || user.uid;
      const update = { [r.counterPath]: r.last.n };
      r.generated.forEach(g => { update[ROOT + '/' + g.Barcode] = { ItemID: g.ItemID, PackQty: 1, At: now, By: by, Generated: r.scheme }; });
      await rtdb.ref().update(update);
    }
    return { generated: r.generated, skipped: r.skipped, scheme: r.scheme, saved: true };
  });
});

const escHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// The owner's date rule (dd/mm/yyyy) on a printed label; the app's shell
// formats screens, but this page is printed on its own.
const dmy = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');

// A printable page of labels (decisions 73-75): for each line the item's
// barcode (its one-unit barcode, else its item code as Code 128), name and
// code, optionally the price (the company's retail price list) and the
// batch and expiry; on the company's label roll or A4 sheets.
exports.getLabelSheet = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = requireCompanyAccess(user, String(d.companyId || '').trim());
  const stock = d.stock === 'Sheet' ? 'Sheet' : 'Roll';
  const lines = (Array.isArray(d.lines) ? d.lines : []).map(l => ({ ItemID: String(l.ItemID || ''), Copies: Math.floor(Number(l.Copies)), BatchNumber: String(l.BatchNumber || '').slice(0, 60), ExpiryDate: String(l.ExpiryDate || '') }))
    .filter(l => l.Copies > 0);
  if (!lines.length) bad('Give at least one label (copies more than 0).');
  if (lines.some(l => l.Copies > 1000)) bad('Up to 1,000 labels a line.');
  const total = lines.reduce((t, l) => t + l.Copies, 0);
  if (total > 3000) bad('Up to 3,000 labels at a time (' + total + ' asked).');
  const [items, map, settings] = await Promise.all([rtdb.ref('items').get().then(s => s.val() || {}), all(), settingsOf(co)]);
  let prices = {};
  if (d.withPrice) {
    const R = require('./retailSales');
    const rs = await R.loadSettings(co);
    prices = await R.pricesOn(rs && rs.PriceListID, new Date().toISOString().slice(0, 10));
  }
  const codes = byItem(map);
  const one = l => {
    const it = items[l.ItemID];
    if (!it || (it.CompanyID && it.CompanyID !== co)) bad('An item to label was not found for this company.');
    const unit = (codes[l.ItemID] || []).find(b => b.PackQty === 1);
    const price = d.withPrice && prices[it.ItemCode] != null ? Number(prices[it.ItemCode]).toFixed(2) : '';
    const batch = d.withBatch ? [l.BatchNumber ? 'Batch ' + l.BatchNumber : '', l.ExpiryDate ? 'Exp ' + dmy(l.ExpiryDate) : ''].filter(Boolean).join(' · ') : '';
    return '<div class="lbl"><div class="nm">' + escHtml(it.ItemName || it.ItemCode) + '</div><div class="bc">' + BarcodeSvg.svg(unit ? unit.Barcode : it.ItemCode) + '</div>' +
      '<div class="mt"><span>' + escHtml(it.ItemCode) + '</span>' + (price ? '<b>' + escHtml(price) + '</b>' : '') + '</div>' + (batch ? '<div class="bt">' + escHtml(batch) + '</div>' : '') + '</div>';
  };
  const labels = [];
  lines.forEach(l => { const html = one(l); for (let i = 0; i < l.Copies; i++) labels.push(html); });
  const S = settings;
  let page, body;
  if (stock === 'Roll') {
    page = '@page{size:' + S.RollWidthMm + 'mm ' + S.RollHeightMm + 'mm;margin:0}.lbl{width:' + S.RollWidthMm + 'mm;height:' + S.RollHeightMm + 'mm;page-break-after:always}';
    body = labels.join('');
  } else {
    const per = S.SheetCols * S.SheetRows, h = (297 - 2 * S.SheetMarginMm) / S.SheetRows;
    page = '@page{size:A4;margin:' + S.SheetMarginMm + 'mm}.sheet{display:grid;grid-template-columns:repeat(' + S.SheetCols + ',1fr);grid-auto-rows:' + h.toFixed(2) + 'mm;page-break-after:always}.lbl{height:' + h.toFixed(2) + 'mm}';
    body = '';
    for (let i = 0; i < labels.length; i += per) body += '<div class="sheet">' + labels.slice(i, i + per).join('') + '</div>';
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>' + page +
    '*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}.lbl{padding:1.2mm 1.5mm;overflow:hidden;display:flex;flex-direction:column}' +
    '.nm{font-size:2.6mm;font-weight:bold;line-height:1.15;max-height:6mm;overflow:hidden}.bc{flex:1;min-height:0;margin:.6mm 0}.bc svg{width:100%;height:100%;display:block}' +
    '.mt{display:flex;justify-content:space-between;font-size:2.3mm}.mt b{font-size:2.8mm}.bt{font-size:2.1mm}</style></head><body>' + body + '</body></html>';
  return { html, labels: labels.length, stock };
});

Object.assign(module.exports, { checkBarcode, checkPack, gtinOk, byItem, all, saveImportedBarcode, ROOT, numberer, settingsOf, dmy });
