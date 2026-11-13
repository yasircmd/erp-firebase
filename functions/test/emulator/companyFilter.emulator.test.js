// The company filter at the top (owner, 2026-10-24; docs/modules/
// UX_ROUND2.md item 19, decision 273): a user chooses among their own
// companies which the screens offer and default to. Saved with the user for
// the next sign-in; a filter, not rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });

test.beforeEach(async () => {
  const f = baseFixture();
  f.users['u-two'] = { status: 'Active', role: 'Viewer', username: 'two', fullName: 'Two Companies', AssignedCompanies: ['C1', 'C2'] };
  await reset(f);
});
const chosen = list => list.filter(c => c.Chosen).map(c => c.CompanyID);

test('all chosen until the user chooses; the choice is kept for the next sign-in', async () => {
  assert.deepEqual(chosen(await call('u-two', 'getActiveCompanies', {})), ['C1', 'C2']);
  assert.deepEqual(await call('u-two', 'saveMyCompanies', { companyIds: ['C2'] }), { companyIds: ['C2'] });
  const list = await call('u-two', 'getActiveCompanies', {});
  assert.deepEqual(list.map(c => c.CompanyID), ['C1', 'C2'], 'still both of them: a filter, not rights');
  assert.deepEqual(chosen(list), ['C2']);
  assert.deepEqual(await val('userPreferences/u-two/Companies'), ['C2']);
  // All again: nothing kept, so a company assigned later is chosen too.
  assert.deepEqual(await call('u-two', 'saveMyCompanies', { companyIds: ['C1', 'C2', 'C1'] }), { companyIds: ['C1', 'C2'] });
  assert.equal(await val('userPreferences/u-two/Companies'), null);
});

test('only the user\'s own companies; a choice no longer theirs falls back to all', async () => {
  await assert.rejects(call('u-viewer', 'saveMyCompanies', { companyIds: ['C2'] }), /Not one of your companies: C2/);
  await call('u-two', 'saveMyCompanies', { companyIds: ['C2'] });
  // C2 unassigned later: the filter keeps nothing that isn't theirs.
  await call('u-admin', 'saveFirebaseUser', { userData: { id: 'u-two', username: 'two', fullName: 'Two Companies', role: 'Viewer', status: 'Active', assignedCompanies: ['C1'] } });
  assert.deepEqual(await call('u-two', 'getActiveCompanies', {}).then(l => l.map(c => [c.CompanyID, c.Chosen])), [['C1', true]]);
});

// UX4 item 15 (owner, 2026-11-13; docs/modules/UX4.md): the choice applies
// everywhere. Home tasks carry their document's company, so Home shows only
// the chosen companies' (the shell filters them, PUBLIC index.html COMPANY
// FILTER); Master Import refuses a row for a company not chosen.
test('UX4: Home tasks carry their company (pending approval, rejected submission)', async () => {
  const f = baseFixture();
  f.vendors.V1.DefaultCurrency = 'AED';
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.approvalConfigurations = { PURCHASEORDER: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASEORDER: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: '2026-10-20', CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 10, UOM: 'box', UnitPrice: 5 }] } });
  assert.equal(s.success, true, s.error);
  await call('u-admin', 'submitPurchaseOrder', { poId: s.poId });
  const pending = (await call('u-approver', 'getPendingApprovalsForUser', {})).find(x => x.DocumentID === s.poId);
  assert.equal(pending.CompanyID, 'C1');
  await call('u-approver', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 1, decision: 'Rejected', reason: 'Price too high' });
  const rejected = (await call('u-admin', 'getMyRejectedSubmissions', {})).find(x => x.DocumentID === s.poId);
  assert.equal(rejected.CompanyID, 'C1');
});

test('UX4: Master Import refuses a row for a company not chosen on Home; blank (all companies) and the chosen one pass', async () => {
  const f = baseFixture();
  f.users['u-two'] = { status: 'Active', role: 'Admin', username: 'two', fullName: 'Two Companies', AssignedCompanies: ['C1', 'C2'] };
  await reset(f);
  const issues = async rows => (await call('u-two', 'checkMasterImport', { master: 'SUBCATEGORY', text: rows.map(r => r.join('\t')).join('\n') })).issues.map(i => 'R' + i.row + ' ' + i.column + ': ' + i.message);
  const rows = [['Name', 'Parent Category', 'Company'], ['Steel', 'Raw Material', '01'], ['Bolts', 'Raw Material', '02'], ['Paint', 'Raw Material', '']];
  assert.deepEqual(await issues(rows), [], 'all chosen: every company');
  await call('u-two', 'saveMyCompanies', { companyIds: ['C1'] });
  assert.deepEqual(await issues(rows), ['R2 Company: Test Co Two is not among the companies chosen on Home. Choose it there to import for it.']);
});
