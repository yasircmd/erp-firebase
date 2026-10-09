// Item barcodes (owner, 2026-10-09; docs/modules/ITEM_BARCODES.md,
// decisions 64-66): several barcodes an item, each for one unit or a pack;
// unique across all items; an EAN/UPC's check digit verified; Item Master's
// write right; Master Data Import → Item Barcodes; the Retail Sales counter
// gets each item's barcodes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const save = (itemId, barcodes, uid) => call(uid || 'u-admin', 'saveItemBarcodes', { itemId, barcodes });
const mine = async () => (await call('u-admin', 'getItemBarcodes', {})).barcodes;

test.before(async () => {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'FG-001', ItemName: 'Olive Oil 1L', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  await reset(f);
});

test('Item Master: several barcodes, a pack with its units; checked; replaced as a list', async () => {
  await assert.rejects(save('I2', [{ Barcode: '6291041500213' }], 'u-viewer'), /permission to change items/);
  await assert.rejects(save('NOPE', [{ Barcode: '6291041500213' }]), /Item not found/);
  await assert.rejects(save('I2', [{ Barcode: '62910-41' }]), /letters and digits, 4 to 30/);
  await assert.rejects(save('I2', [{ Barcode: '6291041500214' }]), /check digit is wrong \(an EAN\/UPC barcode of 13 digits\)/);
  await assert.rejects(save('I2', [{ Barcode: '6291041500213' }, { Barcode: ' 6291041500213 ' }]), /listed twice/);
  await assert.rejects(save('I2', [{ Barcode: '6291041500213', PackQty: 0 }]), /pack quantity is more than 0/);
  const r = await save('I2', [{ Barcode: '6291041500213' }, { Barcode: '16291041500210', PackQty: '12' }, { Barcode: 'oil1l' }]);
  assert.deepEqual(r.barcodes, [{ Barcode: '6291041500213', PackQty: 1 }, { Barcode: '16291041500210', PackQty: 12 }, { Barcode: 'OIL1L', PackQty: 1 }]);
  assert.deepEqual((await mine()).I2, [{ Barcode: '16291041500210', PackQty: 12 }, { Barcode: '6291041500213', PackQty: 1 }, { Barcode: 'OIL1L', PackQty: 1 }]);
  // The list replaces the item's: one removed, one pack changed.
  await save('I2', [{ Barcode: '6291041500213' }, { Barcode: '16291041500210', PackQty: 6 }]);
  assert.deepEqual((await mine()).I2, [{ Barcode: '16291041500210', PackQty: 6 }, { Barcode: '6291041500213', PackQty: 1 }]);
  assert.equal(await val('itemBarcodes/OIL1L'), null);
  const v = await call('u-viewer', 'getItemBarcodes', {});
  assert.equal(v.barcodes.I2.length, 2, 'Item Master\'s access sees them');
});

test('a barcode is on one item only: another item is refused, naming it', async () => {
  await assert.rejects(save('I1', [{ Barcode: '6291041500213' }]), /Barcode 6291041500213 is already on item FG-001 — Olive Oil 1L/);
  await save('I1', [{ Barcode: '4006381333931' }, { Barcode: '036000291452' }, { Barcode: '96385074' }]);
  assert.deepEqual(Object.keys(await mine()).sort(), ['I1', 'I2']);
  await save('I1', []);
  assert.equal((await mine()).I1, undefined, 'all removed');
});

test('Master Data Import → Item Barcodes: rows checked (format, check digit, already on an item, twice); added to their items', async () => {
  const head = ['Item', 'Barcode', 'Pack Qty'];
  const bad = await call('u-admin', 'checkMasterImport', { master: 'BARCODE', text: tsv([head, ['RM-001', '4006381333932', ''], ['RM-001', '6291041500213', ''],
    ['RM-001', '4006381333931', ''], ['Steel Sheet', '4006381333931', '2'], ['RM-001', 'AB', ''], ['RM-001', '96385074', '-1']]) });
  assert.deepEqual(bad.issues.map(i => 'R' + i.row + ' ' + i.column + ': ' + i.message), [
    'R1 Barcode: the check digit is wrong (an EAN/UPC barcode of 13 digits). Check it was typed right.',
    'R2 Barcode: Already on item FG-001: change it in Item Master.',
    'R4 Barcode: Same barcode as row 3.',
    'R5 Barcode: letters and digits, 4 to 30.',
    'R6 Pack Qty: More than 0, or empty for 1.'
  ]);
  const v = await call('u-viewer', 'runMasterImport', { master: 'BARCODE', text: tsv([head, ['RM-001', '4006381333931', '']]) });
  assert.equal(v.success, false);
  assert.match(JSON.stringify(v.issues), /permission/, 'Item Master\'s write right');
  const ok = await call('u-admin', 'runMasterImport', { master: 'BARCODE', text: tsv([head, ['RM-001', '4006381333931', ''], ['Steel Sheet', '14006381333938', '10'], ['FG-001', 'OIL-LOOSE'.replace('-', ''), '']]) });
  assert.equal(ok.success, true, JSON.stringify(ok.issues));
  const b = await mine();
  assert.deepEqual(b.I1, [{ Barcode: '14006381333938', PackQty: 10 }, { Barcode: '4006381333931', PackQty: 1 }]);
  assert.deepEqual(b.I2.map(x => x.Barcode), ['16291041500210', '6291041500213', 'OILLOOSE']);
});

test('step 2: the barcode index for the stock screens, readable without Item Master\'s access (barcode → item and units only)', async () => {
  const { rtdb } = require('./_helpers');
  await rtdb.ref('permissions/ITEMMASTER/access').set(['Admin']);
  await assert.rejects(call('u-viewer', 'getItemBarcodes', {}), /access to Item Master/);
  const { index } = await call('u-viewer', 'getBarcodeIndex', {});
  assert.deepEqual(index['14006381333938'], { ItemID: 'I1', PackQty: 10 });
  assert.deepEqual(index['6291041500213'], { ItemID: 'I2', PackQty: 1 });
  assert.deepEqual(Object.keys(index).sort(), ['14006381333938', '16291041500210', '4006381333931', '6291041500213', 'OILLOOSE']);
  await assert.rejects(call('u-viewer', 'saveItemBarcodes', { itemId: 'I1', barcodes: [] }), /access to Item Master/);
  await rtdb.ref('permissions/ITEMMASTER/access').set(['Admin', 'Viewer']);
});

// ---------- step 3: own products' numbers and labels (decisions 72-75) ----------

test('step 3: label settings per company (Item Master\'s write): defaults, checked, saved', async () => {
  const { rtdb } = require('./_helpers');
  const s0 = (await call('u-admin', 'getBarcodeSettings', { companyId: 'C1' })).settings;
  assert.deepEqual([s0.GS1Prefix, s0.RollWidthMm, s0.RollHeightMm, s0.SheetCols, s0.SheetRows, s0.SheetMarginMm], ['', 50, 25, 3, 8, 10]);
  const save = (d, uid) => call(uid || 'u-admin', 'saveBarcodeSettings', Object.assign({ companyId: 'C1', GS1Prefix: '', RollWidthMm: 50, RollHeightMm: 25, SheetCols: 3, SheetRows: 8, SheetMarginMm: 10 }, d));
  await assert.rejects(save({}, 'u-viewer'), /permission to change items/);
  await assert.rejects(save({}, 'u-other'), /access to that company/);
  await assert.rejects(save({ GS1Prefix: '62910A' }), /6 to 11 digits/);
  await assert.rejects(save({ RollWidthMm: 5 }), /label width \(mm\) is 20 to 150/);
  await save({ RollWidthMm: 40, RollHeightMm: 30 });
  assert.equal((await call('u-viewer', 'getBarcodeSettings', { companyId: 'C1' })).settings.RollWidthMm, 40, 'readable by any user of the company (for printing)');
  // Items for the rest: two own products without a barcode, a shared one, another company's.
  const it = (code, co, cat) => ({ ItemCode: code, ItemName: 'Item ' + code, Category: cat || 'FinishedGood', Status: 'Active', CompanyID: co, UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' });
  await rtdb.ref('items').update({ I3: it('FG-002', 'C1'), I4: it('FG-003', 'C1'), I5: it('FG-004', ''), I6: it('FG-005', 'C2') });
});

test('step 3: numbers for own products: previewed (nothing kept), saved as each item\'s barcode; in-store 200…, then the GS1 prefix', async () => {
  const gen = (ids, save, uid, co) => call(uid || 'u-admin', 'generateItemBarcodes', { companyId: co || 'C1', itemIds: ids, save });
  await assert.rejects(gen(['I3'], false, 'u-viewer'), /permission to change items/);
  await assert.rejects(gen([], false), /Choose the items/);
  const p = await gen(['I3', 'I4', 'I2', 'I6'], false);
  assert.equal(p.scheme, 'In-store');
  assert.deepEqual(p.generated.map(g => [g.ItemCode, g.Barcode]), [['FG-002', '2000000000015'], ['FG-003', '2000000000022']]);
  assert.deepEqual(p.skipped.map(s => [s.ItemCode, s.Reason]), [['FG-001', 'has a barcode (16291041500210)'], ['FG-005', 'another company\'s item']]);
  assert.equal(p.saved, false);
  assert.equal((await call('u-admin', 'getBarcodeIndex', {})).index['2000000000015'], undefined, 'a preview keeps nothing');
  const s = await gen(['I3', 'I4'], true);
  assert.deepEqual(s.generated.map(g => g.Barcode), ['2000000000015', '2000000000022']);
  const idx = (await call('u-admin', 'getBarcodeIndex', {})).index;
  assert.deepEqual([idx['2000000000015'], idx['2000000000022']], [{ ItemID: 'I3', PackQty: 1 }, { ItemID: 'I4', PackQty: 1 }]);
  // The next number goes on; a shared item takes the chosen company's scheme.
  await call('u-admin', 'saveBarcodeSettings', { companyId: 'C1', GS1Prefix: '6291041', RollWidthMm: 40, RollHeightMm: 30, SheetCols: 3, SheetRows: 8, SheetMarginMm: 10 });
  const g = await gen(['I5'], true);
  assert.deepEqual([g.scheme, g.generated[0].Barcode], ['GS1 6291041', '6291041000010']);
  // Numbers are skipped when already used (here one typed in by hand).
  await call('u-admin', 'saveItemBarcodes', { itemId: 'I6', barcodes: [{ Barcode: '6291041000027' }] });
  await call('u-admin', 'saveItemBarcodes', { itemId: 'I5', barcodes: [] });
  assert.equal((await gen(['I5'], true)).generated[0].Barcode, '6291041000034');
});

test('step 3: the label sheet: the unit barcode (else the item code), name and code, price and batch when asked; roll or A4 sheets', async () => {
  const { rtdb } = require('./_helpers');
  await rtdb.ref('retailSales/settings/C1/PriceListID').set('PL1');
  await rtdb.ref('priceListLines/PLL1').set({ PriceListID: 'PL1', ItemCode: 'FG-001', UnitPrice: 12.5, Status: 'Active', EffectiveFrom: '2026-01-01' });
  const sheet = (d, uid) => call(uid || 'u-viewer', 'getLabelSheet', Object.assign({ companyId: 'C1', stock: 'Roll' }, d));
  await assert.rejects(sheet({ lines: [] }), /at least one label/);
  await assert.rejects(sheet({ lines: [{ ItemID: 'I2', Copies: 1001 }] }), /Up to 1,000 labels a line/);
  await assert.rejects(sheet({ lines: [{ ItemID: 'I6', Copies: 1 }] }), /not found for this company/);
  await assert.rejects(sheet({ lines: [{ ItemID: 'I2', Copies: 1 }] }, 'u-other'), /access to that company/);
  const r = await sheet({ withPrice: true, withBatch: true, lines: [{ ItemID: 'I2', Copies: 2, BatchNumber: 'B7', ExpiryDate: '2027-03-31' }, { ItemID: 'I1', Copies: 1 }, { ItemID: 'I3', Copies: 0 }] });
  assert.equal(r.labels, 3);
  assert.match(r.html, /@page\{size:40mm 30mm;margin:0\}/);
  const labels = r.html.split('<div class="lbl">').slice(1);
  assert.equal(labels.length, 3);
  // FG-001: its one-unit barcode (not its carton's), its price, the batch and expiry as dd/mm/yyyy.
  assert.match(labels[0], />6291041500213<\/text>/);
  assert.doesNotMatch(labels[0], /16291041500210/);
  assert.match(labels[0], /<span>FG-001<\/span><b>12.50<\/b>/);
  assert.match(labels[0], /Batch B7 · Exp 31\/03\/2027/);
  // RM-001: its unit barcode; no price on the list, no batch.
  assert.match(labels[2], />4006381333931<\/text>/);
  assert.doesNotMatch(labels[2], /<b>|Batch/);
  // An item without a barcode: its item code as the barcode.
  await call('u-admin', 'saveItemBarcodes', { itemId: 'I4', barcodes: [] });
  assert.match((await sheet({ lines: [{ ItemID: 'I4', Copies: 1 }] })).html, />FG-003<\/text>/);
  // A4: 3 across, 8 down, two sheets for 25 labels.
  const a4 = await sheet({ stock: 'Sheet', lines: [{ ItemID: 'I2', Copies: 25 }] });
  assert.match(a4.html, /@page\{size:A4;margin:10mm\}\.sheet\{display:grid;grid-template-columns:repeat\(3,1fr\);grid-auto-rows:34\.63mm/);
  assert.equal((a4.html.match(/<div class="sheet">/g) || []).length, 2);
});
