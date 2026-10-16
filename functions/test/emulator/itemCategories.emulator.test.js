// Item categories of your own (owner, 2026-10-16; docs/modules/
// ITEM_CATEGORIES_CUSTOM.md, decisions 203-207): added with a name, its own
// code prefix, the one of the five it behaves like, shared or one
// company's, by anyone with Item Master access; its items get codes with
// its own prefix and sequence (a numbering type of its own); they keep the
// base category (BOM and production unchanged); sub-categories under it; an
// item's category never changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const cat = (c, uid) => call(uid || 'u-admin', 'saveItemCategory', { category: c });
const item = over => call('u-admin', 'saveItem', { itemData: Object.assign({ ItemName: 'Bearing 6204', Category: 'Consumable', UOMID: 'UOM-PCS', CompanyID: 'C1',
  DefaultWarehouseID: 'WH1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' }, over) });
let SP;

test.before(async () => { await reset(baseFixture()); });

test('a category of your own: name, prefix, behaves like, shared or one company\'s; checked; by anyone with Item Master access', async () => {
  assert.match(await err(cat({ Name: 'Spare Parts', Prefix: 'S', BaseCategory: 'Consumable' })), /2 to 6 letters or digits/);
  assert.match(await err(cat({ Name: 'Spare Parts', Prefix: 'SP', BaseCategory: '' })), /behaves like/);
  assert.match(await err(cat({ Name: 'Raw Material', Prefix: 'RAW', BaseCategory: 'RawMaterial' })), /already a category "Raw Material"/);
  assert.match(await err(cat({ Name: 'Vendors too', Prefix: 'VEN', BaseCategory: 'Consumable' })), /same codes as Vendor/);
  assert.match(await err(cat({ Name: 'Remnants', Prefix: 'RM', BaseCategory: 'Scrap' })), /same codes as Item — Raw Material/);
  assert.match(await err(cat({ Name: 'Elsewhere', Prefix: 'EL', BaseCategory: 'Consumable', CompanyID: 'C2' })), /access to that company/);
  SP = ok(await cat({ Name: 'Spare Parts', Prefix: 'sp', BaseCategory: 'Consumable' }, 'u-viewer')).itemCategoryId; // Item Master access is enough (205)
  const c = await val('itemCategories/' + SP);
  assert.deepEqual([c.Name, c.Prefix, c.BaseCategory, c.CompanyID, c.Status, c.CreatedByName], ['Spare Parts', 'SP', 'Consumable', '', 'Active', 'Viewer']);
  assert.match(await err(cat({ Name: 'Spare parts', Prefix: 'SPX', BaseCategory: 'Consumable' })), /already a category/);
  assert.match(await err(cat({ Name: 'Spares', Prefix: 'SP', BaseCategory: 'Consumable' })), /already has the prefix SP/);
  ok(await cat({ Name: 'Tools', Prefix: 'TL', BaseCategory: 'Consumable', CompanyID: 'C1' }));
  const list = await call('u-admin', 'getItemCategories', {});
  assert.deepEqual([list.builtIn.map(b => b.Prefix), list.categories.map(c => [c.Name, c.Key.slice(0, 2), c.CompanyID])],
    [['RM', 'SFG', 'FG', 'CONS', 'SCRAP'], [['Spare Parts', 'X-', ''], ['Tools', 'X-', 'C1']]]);
});

test('its items: codes with its own prefix and sequence; the base category kept; the category checked and never changed', async () => {
  const a = ok(await item({ CustomCategoryID: SP }));
  const b = ok(await item({ ItemName: 'Bearing 6205', CustomCategoryID: SP }));
  const plain = ok(await item({ ItemName: 'Gloves' }));
  assert.deepEqual([a.itemCode, b.itemCode, plain.itemCode.slice(0, 5)], ['SP-000001', 'SP-000002', 'CONS-']);
  const rec = await val('items/' + a.itemId);
  assert.deepEqual([rec.Category, rec.CustomCategoryID], ['Consumable', SP], 'it behaves like a Consumable');
  assert.match((await item({ ItemName: 'Shaft', Category: 'FinishedGood', CustomCategoryID: SP })).error, /behaves like Consumable, not Finished Good/);
  const tools = (await call('u-admin', 'getItemCategories', {})).categories.find(c => c.Name === 'Tools').ItemCategoryID;
  assert.match((await item({ ItemName: 'Spanner', CompanyID: '', CustomCategoryID: tools })).error, /belongs to one company; a shared item uses a shared category/);
  // Never changes (207): not to the base, nor to another.
  assert.equal((await item({ ItemID: a.itemId, CustomCategoryID: '' })).error, 'Item category cannot be changed after creation.');
  ok(await item({ ItemID: a.itemId, ItemName: 'Bearing 6204-2RS', CustomCategoryID: SP }));
  // Numbering shows it like the five.
  const n = await call('u-admin', 'getNumbering', {});
  assert.deepEqual(n.kinds.filter(k => /Spare Parts|Tools/.test(k.label)).map(k => [k.label, k.sample]), [['Item — Spare Parts', 'SP-000001'], ['Item — Tools', 'TL-000001']]);
  // An inactive category takes no new items; its items stay.
  ok(await cat({ ItemCategoryID: SP, Name: 'Spare Parts', Status: 'Inactive' }));
  assert.match((await item({ ItemName: 'Belt', CustomCategoryID: SP })).error, /no longer in use/);
  ok(await item({ ItemID: b.itemId, ItemName: 'Bearing 6205', CustomCategoryID: SP }));
  ok(await cat({ ItemCategoryID: SP, Name: 'Spare Parts', Status: 'Active' }));
});

test('sub-categories under it; an item of it uses those, not the base category\'s', async () => {
  const key = 'X-' + SP;
  const under = (await call('u-admin', 'saveItemSubCategory', { data: { Name: 'Bearings', ParentCategory: key } })).subCategoryId;
  assert.ok(under);
  const base = (await call('u-admin', 'saveItemSubCategory', { data: { Name: 'Gloves', ParentCategory: 'Consumable' } })).subCategoryId;
  assert.equal((await call('u-admin', 'saveItemSubCategory', { data: { Name: 'Nowhere', ParentCategory: 'X-missing' } })).error, 'Select a valid parent category.');
  ok(await item({ ItemName: 'Bearing 6206', CustomCategoryID: SP, SubCategoryID: under }));
  assert.equal((await item({ ItemName: 'Bearing 6207', CustomCategoryID: SP, SubCategoryID: base })).error, 'Sub-category does not belong to the selected Category.');
  assert.equal((await item({ ItemName: 'Nitrile gloves', SubCategoryID: under })).error, 'Sub-category does not belong to the selected Category.');
});
