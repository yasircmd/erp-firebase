// SALESINVOICESETUP (sales types + customer classifications) through its
// screen's callables — incl. the { __positional: [...] } shape the
// screens' dynamic deactivate/reactivate calls send.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

const state = {};

test('classification: create, listed', async () => {
  const r = await call('u-admin', 'saveCustomerClassification', { data: { Name: 'GCC', IsExport: true, CompanyID: 'C1' } });
  assert.equal(r.success, true, JSON.stringify(r));
  state.cls = r.classificationId;
  const list = await call('u-admin', 'getCustomerClassifications');
  assert.ok(list.some(c => c.Name === 'GCC' && c.IsExport === true));
});

test('sales type: revenue account rule, restriction to a classification', async () => {
  assert.equal((await call('u-admin', 'saveSalesType', { data: { Name: 'Bad', GLAccountID: 'A-AR' } })).error, 'Sales Revenue account must be a Revenue-type account.');
  const r = await call('u-admin', 'saveSalesType', { data: { Name: 'Export Sales', GLAccountID: 'A-REV', CompanyID: 'C1', RestrictedToClassificationID: state.cls } });
  assert.equal(r.success, true, JSON.stringify(r));
  state.st = r.salesTypeId;
  assert.match((await call('u-admin', 'saveSalesType', { data: { Name: 'X', GLAccountID: 'A-REV', RestrictedToClassificationID: 'NOPE' } })).error, /Select a valid, active Classification/);
  assert.ok((await call('u-admin', 'getSalesTypes')).some(s => s.Name === 'Export Sales'));
});

test('dynamic deactivate/reactivate via __positional (what the screen sends)', async () => {
  assert.equal((await call('u-admin', 'deactivateSalesType', { __positional: [state.st] })).success, true);
  assert.equal((await val('salesTypes/' + state.st)).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateSalesType', { __positional: [state.st] })).success, true);
  assert.equal((await call('u-admin', 'deactivateCustomerClassification', { __positional: [state.cls] })).success, true);
  assert.equal((await val('customerClassifications/' + state.cls)).Status, 'Inactive');
  // Named keys still work too.
  assert.equal((await call('u-admin', 'reactivateCustomerClassification', { classificationId: state.cls })).success, true);
});

test('Viewer cannot modify', async () => {
  assert.equal((await call('u-viewer', 'saveSalesType', { data: { Name: 'x', GLAccountID: 'A-REV' } })).error, 'You do not have permission to modify Sales Invoice Configuration.');
});
