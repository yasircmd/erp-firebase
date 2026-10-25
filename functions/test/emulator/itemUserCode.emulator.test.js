// Item user code (owner, 2026-10-24; docs/modules/ITEM_USER_CODE.md,
// decisions Q276, Q293): optional, kept with the item; unique in the
// corporate ignoring case, shared and company items alike, and never
// another item's system code; the shell gets the pairs for the items of the
// user's companies and the shared ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const item = over => call('u-admin', 'saveItem', { itemData: Object.assign({ ItemName: 'Bearing 6204', Category: 'Consumable', UOMID: 'UOM-PCS', CompanyID: 'C1',
  DefaultWarehouseID: 'WH1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' }, over) });

test.before(async () => {
  const f = baseFixture();
  f.items.I9 = { ItemCode: 'RM-009', ItemName: 'Other company item', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C2', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS', UserCode: 'C2-ONLY' };
  await reset(f);
});

test('kept with the item; unique ignoring case; never another item\'s system code; blank clears it', async () => {
  const a = ok(await item({ ItemName: 'Bearing A', UserCode: ' BRG-6204 ' }));
  assert.equal((await val('items/' + a.itemId)).UserCode, 'BRG-6204', 'trimmed');
  assert.match((await item({ ItemName: 'Bearing B', UserCode: 'brg-6204' })).error, /The user code "brg-6204" is already item .* \(Bearing A\): choose another\./);
  assert.match((await item({ ItemName: 'Bearing B', UserCode: 'c2-only' })).error, /already item RM-009/, 'another company\'s item counts too');
  assert.match((await item({ ItemName: 'Bearing B', UserCode: 'rm-001' })).error, /already item RM-001 \(Steel Sheet\)/, 'another item\'s system code');
  assert.match((await item({ ItemName: 'Bearing B', UserCode: 'has space' })).error, /1 to 30 letters, digits/);
  // Its own, saved again: fine. A new one, then blank: cleared.
  ok(await item({ ItemID: a.itemId, ItemName: 'Bearing A', UserCode: 'BRG-6204' }));
  const b = ok(await item({ ItemName: 'Bearing B', UserCode: 'BRG-6205' }));
  ok(await item({ ItemID: b.itemId, ItemName: 'Bearing B', UserCode: '' }));
  assert.equal((await val('items/' + b.itemId)).UserCode, '');
});

test('the shell\'s pairs: the user\'s companies\' items and the shared ones, only those with a user code', async () => {
  const shared = ok(await item({ ItemName: 'Shared bolt', CompanyID: '', DefaultWarehouseID: '', UserCode: 'BOLT-M8' }));
  const pairs = await call('u-admin', 'getItemUserCodes', {});
  const code = (await val('items/' + shared.itemId)).ItemCode;
  assert.equal(pairs[code], 'BOLT-M8');
  assert.ok(Object.values(pairs).includes('BRG-6204'));
  assert.ok(!Object.values(pairs).includes('C2-ONLY'), 'not another company\'s');
  assert.ok(!('RM-001' in pairs), 'none without a user code');
});

test('Master Import: a User Code column', async () => {
  const tsv = rows => rows.map(r => r.join('\t')).join('\n');
  const rows = [['Item Name', 'Category', 'User Code', 'UOM', 'Company', 'Inventory Account', 'Consumption Account'],
    ['Imported washer', 'Consumable', 'WASH-10', 'PCS', '01', '1300', 'Material Consumption']];
  const r = await call('u-admin', 'runMasterImport', { master: 'ITEM', text: tsv(rows) });
  assert.equal(r.created, 1, JSON.stringify(r));
  assert.ok(Object.values(await call('u-admin', 'getItemUserCodes', {})).includes('WASH-10'));
  // A taken one is refused by the item's save, like any other error of a row.
  const again = await call('u-admin', 'runMasterImport', { master: 'ITEM', text: tsv([rows[0], ['Imported nut', 'Consumable', 'wash-10', 'PCS', '01', '1300', 'Material Consumption']]) });
  assert.equal(again.created, 0, JSON.stringify(again));
  assert.match(JSON.stringify(again), /already item/);
});
