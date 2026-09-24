// PROCUREMENTSETUP (requisition categories) through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

test('category → GL account type rules; list; deactivate/reactivate', async () => {
  const exp = await call('u-admin', 'saveRequisitionCategory', { data: { Name: 'Consulting', Type: 'DirectExpense', CompanyID: 'C1', GLAccountID: 'A-CONS' } });
  assert.equal(exp.success, true, JSON.stringify(exp));
  const fa = await call('u-admin', 'saveRequisitionCategory', { data: { Name: 'Laptops', Type: 'FixedAsset', CompanyID: 'C1', GLAccountID: 'A-INV' } });
  assert.equal(fa.success, true, JSON.stringify(fa));
  const bad = await call('u-admin', 'saveRequisitionCategory', { data: { Name: 'Bad', Type: 'FixedAsset', GLAccountID: 'A-CONS' } });
  assert.equal(bad.error, 'Fixed Asset categories must map to a(n) Asset-type account.');
  assert.equal((await call('u-admin', 'saveRequisitionCategory', { data: { Name: 'X', Type: 'Other', GLAccountID: 'A-CONS' } })).error, 'Select Fixed Asset or Direct Expense.');
  const list = await call('u-admin', 'getRequisitionCategories');
  assert.deepEqual(list.map(c => c.Name).sort(), ['Consulting', 'Laptops']);
  assert.equal((await call('u-admin', 'deactivateRequisitionCategory', { categoryId: exp.categoryId })).success, true);
  assert.equal((await val('requisitionCategories/' + exp.categoryId)).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateRequisitionCategory', { categoryId: exp.categoryId })).success, true);
});

test('Viewer cannot modify', async () => {
  assert.equal((await call('u-viewer', 'saveRequisitionCategory', { data: { Name: 'x', Type: 'DirectExpense', GLAccountID: 'A-CONS' } })).error, 'You do not have permission to modify Procurement Setup.');
});
