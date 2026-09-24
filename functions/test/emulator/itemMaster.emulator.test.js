// ITEMMASTER through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => {
  const f = baseFixture();
  f.itemSubCategories = { 'ISC-1': { Name: 'Sheets', ParentCategory: 'RawMaterial', Status: 'Active' } };
  await reset(f);
});
test.after(async () => { await app.delete(); });

const good = { ItemName: 'Copper Wire', Category: 'RawMaterial', SubCategoryID: 'ISC-1', UOMID: 'UOM-PCS', CompanyID: 'C1',
  DefaultWarehouseID: 'WH1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };

test('create item: auto code by category prefix, listed, sub-categories listed', async () => {
  const r = await call('u-admin', 'saveItem', { itemData: good });
  assert.equal(r.success, true, JSON.stringify(r));
  const items = await call('u-admin', 'getItems');
  const created = items.find(i => i.ItemName === 'Copper Wire');
  assert.ok(created);
  assert.match(created.ItemCode, /^RM-\d+$/);
  const subs = await call('u-admin', 'getActiveItemSubCategories');
  assert.ok(subs.some(s => s.SubCategoryID === 'ISC-1'));
});

test('validation: wrong account types, sub-category mismatch, category change', async () => {
  let r = await call('u-admin', 'saveItem', { itemData: { ...good, InventoryAccountID: 'A-CONS' } });
  assert.equal(r.error, 'Inventory account must be an Asset-type account.');
  r = await call('u-admin', 'saveItem', { itemData: { ...good, SalesCogsAccountID: 'A-INV' } }); // Consumption is deliberately unrestricted in the original; Sales COGS is not
  assert.match(r.error, /must be an Expense or COGS account/);
  r = await call('u-admin', 'saveItem', { itemData: { ...good, Category: 'FinishedGood' } });
  assert.equal(r.error, 'Sub-category does not belong to the selected Category.');
  r = await call('u-admin', 'saveItem', { itemData: { ...good, ItemID: 'I1', Category: 'FinishedGood', SubCategoryID: '' } });
  assert.equal(r.error, 'Item category cannot be changed after creation.');
});

test('permissions and company access', async () => {
  const v = await call('u-viewer', 'saveItem', { itemData: good });
  assert.equal(v.error, 'You do not have permission to modify Item Master.');
  const o = await call('u-other', 'saveItem', { itemData: good });
  assert.equal(o.error, 'You do not have access to that company.');
});

test('deactivate / reactivate', async () => {
  assert.equal((await call('u-admin', 'deactivateItem', { itemId: 'I1' })).success, true);
  assert.equal((await val('items/I1')).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateItem', { itemId: 'I1' })).success, true);
  assert.equal((await val('items/I1')).Status, 'Active');
});
