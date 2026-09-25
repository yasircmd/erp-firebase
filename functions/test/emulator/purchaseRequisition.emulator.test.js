// PURCHASEREQUISITION through its screen's callables: draft (validation,
// line filtering, header cost-center default), submit (PR number only at
// submit), approval gate with reject -> revise -> resubmit, close, cancel,
// delete, list, category picker, and access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-FA'] = { AccountCode: '1500', AccountName: 'Equipment', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.requisitionCategories = {
    RC1: { Name: 'Laptops', Type: 'Fixed Asset', GLAccountID: 'A-FA', Status: 'Active', CompanyID: 'C1' },
    RC2: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' },
    RC3: { Name: 'Old', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Inactive', CompanyID: 'C1' },
    RC4: { Name: 'Other Co', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C2' }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const line = (o) => Object.assign({ CategoryID: 'RC1', Description: 'Laptop', Quantity: 2, Unit: 'pcs' }, o);
const draft = (lines, extra, uid) => call(uid || 'u-admin', 'saveDraftPurchaseRequisition', {
  header: Object.assign({ PRDate: D, CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Office refresh', Lines: lines }, extra || {})
});

test('draft stores lines (blank-category rows dropped, cost center defaulted); number only at submit', async () => {
  await reset(fixture());
  const s = await draft([line(), line({ CategoryID: '' }), line({ CategoryID: 'RC2', Description: 'Paper', Quantity: 5, CostCenterID: 'CC2' })]);
  assert.equal(s.success, true, s.error);
  assert.match(s.prId, /^PRQ-/);
  const rec = await val('purchaseRequisitions/' + s.prId);
  assert.equal(rec.Status, 'Draft');
  assert.equal(rec.PRNumber, '');
  assert.equal(rec.Priority, 'Normal');
  assert.deepEqual(rec.Lines.map(l => [l.CategoryID, l.Quantity, l.CostCenterID]), [['RC1', 2, 'CC1'], ['RC2', 5, 'CC2']]);

  const sub = await call('u-admin', 'submitPurchaseRequisition', { prId: s.prId });
  assert.equal(sub.success, true, sub.error);
  assert.equal(sub.status, 'Submitted');
  assert.match(sub.prNumber, /PR/);
  const after = await val('purchaseRequisitions/' + s.prId);
  assert.equal(after.Status, 'Submitted');
  assert.equal(after.PRNumber, sub.prNumber);

  const edit = await draft([line()], { PRID: s.prId });
  assert.deepEqual(edit, { success: false, error: 'Only a Draft or Rejected requisition can be edited.' });
  assert.equal((await call('u-admin', 'deleteDraftPurchaseRequisition', { prId: s.prId })).success, false);

  assert.deepEqual(await call('u-admin', 'closePurchaseRequisition', { prId: s.prId }), { success: true });
  assert.equal((await val('purchaseRequisitions/' + s.prId)).Status, 'Closed');
  assert.match((await call('u-admin', 'cancelPurchaseRequisition', { prId: s.prId })).error, /can no longer be cancelled/);
});

test('approval gate: reject -> revise -> resubmit -> approve lands on Submitted', async () => {
  const f = fixture();
  f.approvalConfigurations = { PURCHASEREQUISITION: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASEREQUISITION: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft([line()]);
  const sub = await call('u-admin', 'submitPurchaseRequisition', { prId: s.prId });
  assert.equal(sub.status, 'PendingApproval', sub.error);
  assert.match((await call('u-admin', 'closePurchaseRequisition', { prId: s.prId })).error, /Only a Submitted/);

  const rej = await call('u-approver', 'decidePurchaseRequisitionApproval', { prId: s.prId, levelNumber: 1, decision: 'Rejected', reason: 'Too many' });
  assert.equal(rej.success, true, rej.error);
  assert.equal(rej.status, 'Rejected');
  let rec = await val('purchaseRequisitions/' + s.prId);
  assert.equal(rec.Status, 'Rejected');
  assert.equal(rec.RejectionReason, 'Too many');

  assert.equal((await draft([line({ Quantity: 1 })], { PRID: s.prId })).success, true, 'Rejected is editable');
  const re = await call('u-admin', 'submitPurchaseRequisition', { prId: s.prId });
  assert.equal(re.status, 'PendingApproval', re.error);
  rec = await val('purchaseRequisitions/' + s.prId);
  assert.equal(rec.RejectionReason, '');
  // Quirk kept from Code.gs: a resubmission draws a fresh PR number.
  assert.notEqual(re.prNumber, sub.prNumber);

  const ok = await call('u-approver', 'decidePurchaseRequisitionApproval', { prId: s.prId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.success, true, ok.error);
  rec = await val('purchaseRequisitions/' + s.prId);
  assert.equal(rec.Status, 'Submitted');
  assert.equal(rec.Lines[0].Quantity, 1);
  assert.match((await call('u-approver', 'decidePurchaseRequisitionApproval', { prId: s.prId, levelNumber: 1, decision: 'Approved', reason: '' })).error, /not awaiting approval/);
});

test('validation', async () => {
  await reset(fixture());
  assert.match((await draft([line()], { CompanyID: '' })).error, /Select a Company/);
  assert.match((await draft([line()], { CostCenterID: '' })).error, /Select a Cost Center/);
  assert.match((await draft([line()], { CostCenterID: 'WH1' })).error, /Unknown Cost Center/);
  assert.match((await draft([line()], { Priority: 'Low' })).error, /Normal or Urgent/);
  assert.match((await draft([line({ CategoryID: 'RC3' })])).error, /inactive or unknown category/);
  assert.match((await draft([line({ CategoryID: 'NOPE' })])).error, /inactive or unknown category/);
  assert.match((await draft([line({ Description: ' ' })])).error, /needs a description/);
  assert.match((await draft([line({ Quantity: 0 })])).error, /greater than zero/);
  assert.equal((await draft([line()], { PRID: 'PRQ-MISSING' })).error, 'Requisition not found.');

  const empty = await draft([]);
  assert.equal(empty.success, true, 'an empty draft saves');
  assert.match((await call('u-admin', 'submitPurchaseRequisition', { prId: empty.prId })).error, /at least one line/);
});

test('cancel, delete, list, categories and access', async () => {
  await reset(fixture());
  const a = await draft([line()]);
  const b = await draft([line()], { Priority: 'Urgent' });
  assert.deepEqual(await call('u-admin', 'cancelPurchaseRequisition', { prId: a.prId }), { success: true });
  assert.equal((await val('purchaseRequisitions/' + a.prId)).Status, 'Cancelled');
  assert.match((await call('u-admin', 'deleteDraftPurchaseRequisition', { prId: a.prId })).error, /Only a Draft/);

  const list = await call('u-admin', 'getPurchaseRequisitionEntries', { limit: 1 });
  assert.equal(list.total, 2);
  assert.equal(list.entries.length, 1);
  assert.equal((await call('u-other', 'getPurchaseRequisitionEntries', {})).total, 0, 'other company sees nothing');
  assert.equal((await call('u-viewer', 'getPurchaseRequisitionEntries', {})).total, 2, 'viewer can read');

  const cats = await call('u-admin', 'getActiveRequisitionCategories', {});
  assert.deepEqual(cats.map(c => c.CategoryID).sort(), ['RC1', 'RC2'], 'active and own-company only');

  assert.equal((await draft([line()], {}, 'u-viewer')).success, false);
  assert.equal((await call('u-viewer', 'submitPurchaseRequisition', { prId: b.prId })).success, false);
  assert.deepEqual(await draft([line()], {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'submitPurchaseRequisition', { prId: b.prId }), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'cancelPurchaseRequisition', { prId: b.prId }), { success: false, error: 'You do not have access to that company.' });

  assert.deepEqual(await call('u-admin', 'deleteDraftPurchaseRequisition', { prId: b.prId }), { success: true });
  assert.equal(await val('purchaseRequisitions/' + b.prId), null);
});
