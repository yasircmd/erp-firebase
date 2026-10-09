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
