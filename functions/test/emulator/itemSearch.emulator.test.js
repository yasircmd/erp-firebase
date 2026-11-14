// The item search (owner, 2026-11-14; docs/modules/ITEMS_FIRESTORE.md, step
// 3b, QI2): what a picker finds as you type, from the search fields, never
// the whole catalogue; a document's items by id.
const test = require('node:test');
const assert = require('node:assert/strict');
const { call, reset, baseFixture, rtdb } = require('./_helpers');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });
const it = (code, name, over) => Object.assign({ ItemCode: code, ItemName: name, Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' }, over || {});

async function seed() {
  const f = baseFixture();
  f.items = {
    I1: it('RM-001', 'Steel Sheet 2mm'),
    I2: it('RM-002', 'Hex Bolt M8 Zinc', { UserCode: 'BLT-08' }),
    I3: it('RM-003', 'Carriage bolt', { Status: 'Inactive' }),
    I4: it('RM-004', 'Bolt cutter', { CompanyID: 'C2' }),
    I5: it('FG-001', 'Steel Door Panel', { Category: 'FinishedGood' }),
    I6: it('CN-001', 'Cable ties', { Category: 'Consumable', InventoryAccountID: '' })
  };
  f.itemBarcodes = { '6291041500213': { ItemID: 'I5', PackQty: 1 } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'FG-001', UnitPrice: 10 } };
  await reset(f);
}
const codes = r => r.items.map(i => i.ItemCode);
const s = (q, extra) => call('u-admin', 'searchItems', Object.assign({ q }, extra || {}));

test('the code\'s start, an exact barcode, inside words (from 3 letters), every word typed', async () => {
  await seed();
  assert.deepEqual(codes(await s('rm-00')), ['RM-001', 'RM-002'], 'the code\'s start; the inactive and another company\'s left out');
  assert.deepEqual(codes(await s('6291041500213')), ['FG-001'], 'an exact barcode');
  assert.deepEqual(codes(await s('olt')), ['RM-002'], 'inside a word (QI2)');
  assert.deepEqual(codes(await s('steel')), ['FG-001', 'RM-001'], 'both names start with it: by code');
  assert.deepEqual(codes(await s('sheet')), ['RM-001'], 'a word inside the name');
  assert.deepEqual(codes(await s('steel door')), ['FG-001'], 'every word typed');
  assert.deepEqual(codes(await s('blt-08')), ['RM-002'], 'the user code');
  assert.deepEqual(codes(await s('nothing like it')), []);
  assert.deepEqual(codes(await s('')), [], 'nothing typed: nothing');
  assert.equal((await s('hex')).items[0].ItemName, 'Hex Bolt M8 Zinc', 'the fields a screen needs');
});

test('the filters: status, category, stock items, sellable, a company', async () => {
  await seed();
  assert.deepEqual(codes(await s('bolt', { status: '' })).sort(), ['RM-002', 'RM-003'], 'any status');
  assert.deepEqual(codes(await s('steel', { category: 'FinishedGood' })), ['FG-001']);
  assert.deepEqual(codes(await s('ties')), ['CN-001']);
  assert.deepEqual(codes(await s('ties', { stockOnly: true })), [], 'no inventory account: not a stock item');
  assert.deepEqual(codes(await s('steel', { sellable: true })), ['FG-001'], 'on a price list');
  assert.deepEqual(codes(await call('u-other', 'searchItems', { q: 'bolt' })), ['RM-004'], 'the caller\'s own companies only');
  await assert.rejects(call('u-admin', 'searchItems', { q: 'bolt', companyId: 'C2' }), /do not have access to that company/);
});

test('a document\'s items by id: only those, of the caller\'s companies', async () => {
  await seed();
  const r = await call('u-admin', 'getItemsByIds', { ids: ['I1', 'I4', 'NOPE'] });
  assert.deepEqual(r.map(i => i.ItemID), ['I1'], 'another company\'s item and an unknown id left out');
});

test('codes typed or pasted on a line: the item code or user code, any case; active, of the company (step 3b-2)', async () => {
  await seed();
  const r = await call('u-admin', 'getItemsByCodes', { codes: ['rm-001', 'BLT-08', ' FG-001 ', 'RM-003', 'RM-004', 'NOPE', ''], companyId: 'C1' });
  assert.deepEqual(r.map(i => i.ItemCode).sort(), ['FG-001', 'RM-001', 'RM-002'], 'the inactive, another company\'s and an unknown code left out');
  assert.equal(r.find(i => i.ItemCode === 'RM-001').InventoryAccountID, 'A-INV', 'the fields a line needs');
  await assert.rejects(call('u-admin', 'getItemsByCodes', { codes: ['RM-004'], companyId: 'C2' }), /do not have access to that company/);
  assert.deepEqual(await call('u-admin', 'getItemsByCodes', { codes: [] }), []);
});
