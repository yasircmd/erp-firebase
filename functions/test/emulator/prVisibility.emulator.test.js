// Who sees which Purchase Requisitions (owner, 2026-10-02;
// docs/modules/PR_VISIBILITY.md): who raised it, its approvers (any level,
// delegated or decided, from then on), the Procurement follow-up team for
// its scope, and Admins. The list and every requisition action follow the
// same rule, so a requisition can't be opened or acted on by its id.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.roles.Staff = { Name: 'Staff', Status: 'Active' };
  for (const cap of ['access', 'draft', 'post']) f.permissions.PURCHASEREQUISITION[cap].push('Staff');
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.requisitionCategories = { RC1: { Name: 'Laptops', Type: 'Direct Expense', GLAccountID: 'A-CONS', Status: 'Active', CompanyID: 'C1' } };
  const u = name => ({ status: 'Active', role: 'Staff', username: name.toLowerCase(), fullName: name, AssignedCompanies: ['C1'] });
  Object.assign(f.users, { 'u-ann': u('Ann'), 'u-bob': u('Bob'), 'u-appr': u('Appr'), 'u-appr2': u('Appr2'),
    'u-buyer': u('Buyer'), 'u-buyer2': u('Buyer2'), 'u-out': u('Out') });
  // Approvals and the Procurement team per cost center.
  f.approvalConfigurations = { PURCHASEREQUISITION: { Enabled: true, ScopeType: 'CostCenter' } };
  f.approvalLevels = { PURCHASEREQUISITION: {
    CC1: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-appr', ThresholdAmount: 0 }] },
    CC2: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-appr2', ThresholdAmount: 0 }] } } };
  f.approvalFollowUps = { PURCHASEREQUISITION: { CC1: { UserIDs: ['u-buyer'] }, CC2: { UserIDs: ['u-buyer2'] } } };
  return f;
}

async function draft(uid, costCenter, description) {
  const s = await call(uid, 'saveDraftPurchaseRequisition', { header: { PRDate: D, CompanyID: 'C1', CostCenterID: costCenter, Description: description,
    Lines: [{ CategoryID: 'RC1', Description: 'Laptop', Quantity: 1, Unit: 'pcs' }] } });
  assert.equal(s.success, true, s.error);
  return s.prId;
}
const sees = async uid => (await call(uid, 'getPurchaseRequisitionEntries', {})).entries.map(e => e.Description).sort();

let a, b, c;
test.before(async () => {
  await reset(fixture());
  a = await draft('u-ann', 'CC1', 'A: Ann, CC1');                 // submitted, waits on Appr
  b = await draft('u-bob', 'CC2', 'B: Bob, CC2');                 // stays a draft
  c = await draft('u-ann', 'CC2', 'C: Ann, CC2');                 // submitted, waits on Appr2
  for (const id of [a, c]) assert.equal((await call('u-ann', 'submitPurchaseRequisition', { prId: id })).status, 'PendingApproval');
});

test('each user sees exactly their own, the ones they approve, and their team scope; Admins all', async () => {
  assert.deepEqual(await sees('u-ann'), ['A: Ann, CC1', 'C: Ann, CC2'], 'the raiser');
  assert.deepEqual(await sees('u-bob'), ['B: Bob, CC2'], 'the raiser of a draft only');
  assert.deepEqual(await sees('u-appr'), ['A: Ann, CC1'], 'the approver waiting on it');
  assert.deepEqual(await sees('u-appr2'), ['C: Ann, CC2']);
  assert.deepEqual(await sees('u-buyer'), ['A: Ann, CC1'], 'Procurement team CC1');
  assert.deepEqual(await sees('u-buyer2'), ['B: Bob, CC2', 'C: Ann, CC2'], 'Procurement team CC2: all of its scope');
  assert.deepEqual(await sees('u-out'), [], 'nobody else');
  assert.deepEqual(await sees('u-admin'), ['A: Ann, CC1', 'B: Bob, CC2', 'C: Ann, CC2'], 'Admins see all');
});

test('approvers keep seeing it after deciding; a delegated level moves sight to the new approver, the old keeps it', async () => {
  // Admin delegates A's level from Appr to Appr2.
  const d = await call('u-admin', 'delegateApproval', { instanceId: (await val('purchaseRequisitions/' + a)).ApprovalInstanceID, levelNumber: 1, toUserId: 'u-appr2', reason: 'On leave' });
  assert.equal(d.success, true);
  assert.deepEqual(await sees('u-appr2'), ['A: Ann, CC1', 'C: Ann, CC2'], 'the new approver');
  assert.deepEqual(await sees('u-appr'), ['A: Ann, CC1'], 'the approver it was delegated from');
  const ok = await call('u-appr2', 'decidePurchaseRequisitionApproval', { prId: a, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.success, true, ok.error);
  assert.equal((await val('purchaseRequisitions/' + a)).Status, 'Submitted');
  assert.deepEqual(await sees('u-appr2'), ['A: Ann, CC1', 'C: Ann, CC2'], 'still seen after approving');
});

test('a user who may not see a requisition cannot act on it by its id either', async () => {
  const refused = { success: false, error: 'Requisition not found.' };
  assert.deepEqual(await call('u-out', 'cancelPurchaseRequisition', { prId: a }), refused);
  assert.deepEqual(await call('u-out', 'closePurchaseRequisition', { prId: a }), refused);
  assert.deepEqual(await call('u-out', 'deleteDraftPurchaseRequisition', { prId: b }), refused);
  assert.deepEqual(await call('u-ann', 'deleteDraftPurchaseRequisition', { prId: b }), refused, 'not another raiser\'s draft');
  assert.deepEqual(await call('u-out', 'submitPurchaseRequisition', { prId: b }), refused);
  assert.deepEqual(await call('u-out', 'saveDraftPurchaseRequisition', { header: { PRID: b, PRDate: D, CompanyID: 'C1', CostCenterID: 'CC2', Description: 'hijack',
    Lines: [{ CategoryID: 'RC1', Description: 'x', Quantity: 1 }] } }), refused);
  assert.deepEqual(await call('u-out', 'decidePurchaseRequisitionApproval', { prId: c, levelNumber: 1, decision: 'Rejected', reason: 'no' }), refused);
  assert.equal((await val('purchaseRequisitions/' + b)).Description, 'B: Bob, CC2', 'nothing changed');
  assert.equal((await val('purchaseRequisitions/' + a)).Status, 'Submitted');
  // Those who may see it still can: the CC1 buyer closes A.
  assert.deepEqual(await call('u-buyer', 'closePurchaseRequisition', { prId: a }), { success: true });
});
