// Item Master a page at a time and the Retail Sales counter's items (owner,
// 2026-11-14; docs/modules/ITEMS_FIRESTORE.md, step 3b-1, QI3): pages in code
// order with their filters, a search, Copy to Excel built on the server; the
// counter asking for the item scanned or typed; barcodes by item.
const test = require('node:test');
const assert = require('node:assert/strict');
const { call, reset, baseFixture, today } = require('./_helpers');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });
const it = (code, name, over) => Object.assign({ ItemCode: code, ItemName: name, Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' }, over || {});

async function seed(n, shared) {
  const f = baseFixture();
  f.items = {};
  for (let i = 1; i <= n; i++) f.items['I' + i] = it('RM-' + String(i).padStart(3, '0'), 'Part ' + i, i % 10 === 0 ? { Status: 'Inactive' } : {});
  f.items.X1 = it('FG-001', 'Door Panel', { Category: 'FinishedGood' });
  f.items.X2 = it('RM-900', 'Other company part', { CompanyID: 'C2' });
  if (shared) f.items.X3 = it('RM-099', 'Second part with code RM-099', { CompanyID: '' }); // a shared item with I99's code: the 101st in code order
  f.itemBarcodes = { '6291041500213': { ItemID: 'X1', PackQty: 1 }, '6291041500220': { ItemID: 'X1', PackQty: 6 } };
  await reset(f);
}

test('Item Master: pages of 100 in code order, Load more to the end; the caller\'s companies only', async () => {
  await seed(230, true);
  const p1 = await call('u-admin', 'getItemsPage', {});
  assert.equal(p1.items.length, 100);
  assert.equal(p1.items[0].ItemCode, 'FG-001');
  assert.ok(p1.next, 'more to come');
  const p2 = await call('u-admin', 'getItemsPage', { after: p1.next });
  const p3 = await call('u-admin', 'getItemsPage', { after: p2.next });
  assert.deepEqual([p1.items[99].ItemID, p2.items[0].ItemID], ['I99', 'X3'], 'the page ends between the two RM-099s');
  const all = p1.items.concat(p2.items, p3.items).map(i => i.ItemCode);
  assert.equal(all.length, 232, 'every item of C1, once (230, the door panel, a shared item)');
  assert.equal(new Set(p1.items.concat(p2.items, p3.items).map(i => i.ItemID)).size, 232);
  assert.equal(p3.next, '', 'the end');
  assert.ok(!all.includes('RM-900'), 'another company\'s item is not listed');
  assert.ok(p1.items[1].InventoryAccountID, 'whole records (the edit form needs them)');
  assert.equal(all.filter(c => c === 'RM-099').length, 2, 'two items with one code: both, across the page boundary');
});

test('Item Master: the filters and a search go to the server', async () => {
  await seed(40);
  const inactive = await call('u-admin', 'getItemsPage', { status: 'Inactive' });
  assert.deepEqual(inactive.items.map(i => i.ItemCode), ['RM-010', 'RM-020', 'RM-030', 'RM-040']);
  assert.equal(inactive.next, '');
  assert.deepEqual((await call('u-admin', 'getItemsPage', { category: 'FinishedGood' })).items.map(i => i.ItemCode), ['FG-001']);
  const found = await call('u-admin', 'getItemsPage', { q: 'door' });
  assert.deepEqual([found.searched, found.items.map(i => i.ItemCode)], [true, ['FG-001']]);
  assert.deepEqual((await call('u-admin', 'getItemsPage', { q: '6291041500213' })).items.map(i => i.ItemCode), ['FG-001'], 'a barcode');
});

test('Copy to Excel: every item the filters keep, as tab-separated text', async () => {
  await seed(12);
  const r = await call('u-admin', 'getItemsExport', { status: 'Active' });
  const lines = r.tsv.split('\n');
  assert.equal(lines[0].split('\t')[0], 'Item Code');
  assert.equal(r.count, 12, '11 active parts and the door panel');
  assert.equal(lines.length, 13);
  assert.ok(lines.some(l => l.startsWith('FG-001\t\tDoor Panel\tFinishedGood')));
});

test('barcodes by item, and the items without one chosen on the server', async () => {
  await seed(3);
  const b = await call('u-admin', 'getItemBarcodes', { itemIds: ['X1', 'I1'] });
  assert.deepEqual(Object.keys(b.barcodes), ['X1']);
  assert.equal(b.barcodes.X1.length, 2);
  const g = await call('u-admin', 'generateItemBarcodes', { companyId: 'C1', category: 'RawMaterial', withoutBarcode: true, save: false });
  assert.deepEqual(g.generated.map(x => x.ItemCode), ['RM-001', 'RM-002', 'RM-003']);
  const none = await call('u-admin', 'generateItemBarcodes', { companyId: 'C1', category: 'FinishedGood', withoutBarcode: true, save: false });
  assert.equal(none.none, true, 'the door panel has its barcode');
});
// The counter's items (findRetailItems): retailSales.emulator.test.js.
