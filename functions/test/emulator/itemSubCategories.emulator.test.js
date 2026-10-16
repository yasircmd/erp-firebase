// Item Sub-Categories by company (owner, 2026-10-14; docs/modules/
// ITEM_SUBCATEGORIES.md): shared by all companies or one company's; an item
// uses a shared one or its own company's; the import's Company column.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
test.beforeEach(async () => { await reset(baseFixture()); });

const sub = data => call('u-admin', 'saveItemSubCategory', { data });
const item = over => call('u-admin', 'saveItem', { itemData: Object.assign({ ItemName: 'Copper Wire', Category: 'RawMaterial', UOMID: 'UOM-PCS', CompanyID: 'C1',
  DefaultWarehouseID: 'WH1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' }, over) });
const tsv = rows => rows.map(r => r.join('\t')).join('\n');

test('shared or one company\'s; the picker gets the company; only the user\'s companies', async () => {
  const shared = (await sub({ Name: 'Metals', ParentCategory: 'RawMaterial' })).subCategoryId;
  const mine = (await sub({ Name: 'Cables', ParentCategory: 'RawMaterial', CompanyID: 'C1' })).subCategoryId;
  assert.deepEqual([(await val('itemSubCategories/' + shared)).CompanyID, (await val('itemSubCategories/' + mine)).CompanyID], ['', 'C1']);
  const picker = await call('u-admin', 'getActiveItemSubCategories');
  assert.deepEqual(picker.map(s => [s.Name, s.CompanyID]).sort(), [['Cables', 'C1'], ['Metals', '']]);
  assert.equal((await sub({ Name: 'Pipes', ParentCategory: 'RawMaterial', CompanyID: 'C2' })).error, 'You do not have access to that company.');
});

test('an item uses a shared sub-category or its company\'s; a shared item only a shared one', async () => {
  const shared = (await sub({ Name: 'Metals', ParentCategory: 'RawMaterial' })).subCategoryId;
  const c1 = (await sub({ Name: 'Cables', ParentCategory: 'RawMaterial', CompanyID: 'C1' })).subCategoryId;
  await rtdb.ref('itemSubCategories/C2SUB').set({ Name: 'Pipes', ParentCategory: 'RawMaterial', Status: 'Active', CompanyID: 'C2' });
  assert.equal((await item({ SubCategoryID: c1 })).success, true);
  assert.equal((await item({ ItemName: 'Bolt', SubCategoryID: shared })).success, true);
  assert.equal((await item({ ItemName: 'Nut', SubCategoryID: 'C2SUB' })).error, 'Sub-category "Pipes" belongs to another company.');
  assert.match((await item({ ItemName: 'Washer', CompanyID: '', SubCategoryID: c1 })).error, /belongs to one company; a shared item uses a shared sub-category/);
  assert.equal((await item({ ItemName: 'Washer', CompanyID: '', SubCategoryID: shared })).success, true);
});

test('a sub-category used by a shared item, or another company\'s, can\'t become one company\'s', async () => {
  const shared = (await sub({ Name: 'Metals', ParentCategory: 'RawMaterial' })).subCategoryId;
  assert.equal((await item({ ItemName: 'Washer', CompanyID: '', SubCategoryID: shared })).success, true);
  assert.match((await sub({ SubCategoryID: shared, Name: 'Metals', ParentCategory: 'RawMaterial', CompanyID: 'C1' })).error, /of all companies uses this sub-category: it cannot belong to one company only/);
  // Unused: it can.
  const other = (await sub({ Name: 'Plastics', ParentCategory: 'RawMaterial' })).subCategoryId;
  assert.equal((await sub({ SubCategoryID: other, Name: 'Plastics', ParentCategory: 'RawMaterial', CompanyID: 'C1' })).success, true);
});

test('Master Data Import: the Company column; an item finds the sub-category of its company or a shared one', async () => {
  const r = await call('u-admin', 'runMasterImport', { master: 'SUBCATEGORY', text: tsv([['Name', 'Parent Category', 'Company'], ['Cables', 'Raw Material', '01'], ['Metals', 'Raw Material', '']]) });
  assert.equal(r.success, true, JSON.stringify(r));
  const subs = Object.values(await val('itemSubCategories'));
  assert.deepEqual(subs.map(s => [s.Name, s.CompanyID]).sort(), [['Cables', 'C1'], ['Metals', '']]);
  // The same name may exist in another company (its own scope).
  const chk = await call('u-admin', 'checkMasterImport', { master: 'SUBCATEGORY', text: tsv([['Name', 'Parent Category', 'Company'], ['Cables', 'Raw Material', '01']]) });
  assert.ok(JSON.stringify(chk).match(/already|exists/i), 'a duplicate in the same company is flagged');
});
