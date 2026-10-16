// Approval routing (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md):
// CBT's four voucher types each have their own Approval Configuration entry,
// with today's CBT setup copied into them once; and follow-up teams get a
// Home task when a Sales Job Order line is accepted (Production) or a PR /
// IPR is submitted (Procurement), until it's acted on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
test.after(async () => { await app.delete(); });

const level = uid => ({ Levels: [{ LevelNumber: 1, ApproverUserID: uid, ThresholdAmount: 0 }] });
function cbtFixture() {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.users['u-approver2'] = { status: 'Active', role: 'Admin', username: 'approver2', fullName: 'Approver Two', AssignedCompanies: ['C1'] };
  // Today's single CBT setup.
  f.approvalConfigurations = { CBT: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { CBT: { GLOBAL: level('u-approver') } };
  return f;
}
const cbt = async (type, ledger) => {
  const s = await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: type, SelectedAccountCode: ledger, JVDate: D, Description: type, CompanyID: 'C1',
    CostCenterID: 'CC1', OppositeLines: [{ AccountCode: type.endsWith('Receipt') ? '4000' : '6000', Amount: 10, Description: 'x', CostCenterID: 'CC1' }] } });
  assert.equal(s.success, true, s.error);
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.success, true, p.error);
  return { jvId: s.jvId, status: p.status };
};
const KEYS = ['CBT_CASHRECEIPT', 'CBT_BANKRECEIPT', 'CBT_CASHPAYMENT', 'CBT_BANKPAYMENT'];

test('CBT: four entries replace CBT in Approval Configuration; today\'s setup is copied into each, once', async () => {
  await reset(cbtFixture());
  const list = await call('u-admin', 'getApprovalConfigurations', {});
  const ids = list.map(m => m.ModuleID);
  assert.ok(!ids.includes('CBT'));
  for (const k of KEYS) {
    const m = list.find(x => x.ModuleID === k);
    assert.deepEqual([m.Enabled, m.ScopeType, m.GateType], [true, 'Global', 'Flat'], k);
    assert.deepEqual(await val('approvalLevels/' + k + '/GLOBAL'), level('u-approver'), k);
  }
  assert.deepEqual(list.filter(m => KEYS.includes(m.ModuleID)).map(m => m.Label),
    ['Cash & Bank — Cash Receipt', 'Cash & Bank — Bank Receipt', 'Cash & Bank — Cash Payment', 'Cash & Bank — Bank Payment']);

  // An edit to one entry is never overwritten by the copy.
  assert.equal((await call('u-admin', 'saveApprovalLevels', { moduleId: 'CBT_BANKPAYMENT', scopeKey: 'GLOBAL',
    levels: [{ ApproverUserID: 'u-approver2', ThresholdAmount: 0 }] })).success, true);
  await rtdb.ref('approvalLevels/CBT/GLOBAL').set(level('u-viewer'));
  await call('u-admin', 'getApprovalConfigurations', {});
  assert.equal((await val('approvalLevels/CBT_BANKPAYMENT/GLOBAL/Levels/0/ApproverUserID')), 'u-approver2');
  assert.equal((await val('approvalLevels/CBT_CASHRECEIPT/GLOBAL/Levels/0/ApproverUserID')), 'u-approver');
});

test('CBT: an entry that already has its own setup when the copy runs keeps it', async () => {
  const f = cbtFixture();
  f.approvalConfigurations.CBT_BANKPAYMENT = { Enabled: true, ScopeType: 'Company', GateType: 'Threshold' };
  f.approvalLevels.CBT_BANKPAYMENT = { C1: level('u-approver2') };
  await reset(f);
  const list = await call('u-admin', 'getApprovalConfigurations', {});
  assert.equal(list.find(m => m.ModuleID === 'CBT_BANKPAYMENT').ScopeType, 'Company');
  assert.deepEqual(await val('approvalLevels/CBT_BANKPAYMENT'), { C1: level('u-approver2') });
  assert.equal(list.find(m => m.ModuleID === 'CBT_CASHPAYMENT').ScopeType, 'Global', 'the others are copied');
});

test('CBT: each voucher type goes to its own approvers; the task names the voucher type; the Tracker filter finds it', async () => {
  await reset(cbtFixture());
  // No screen visit first: the copy also happens on the first post.
  const cp = await cbt('Cash Payment', '1000');
  assert.equal(cp.status, 'PendingApproval', 'copied setup applies');
  await rtdb.ref('approvalLevels/CBT_BANKPAYMENT/GLOBAL').set(level('u-approver2'));
  await rtdb.ref('approvalConfigurations/CBT_CASHRECEIPT/Enabled').set(false);

  const bp = await cbt('Bank Payment', '1100');
  assert.equal(bp.status, 'PendingApproval');
  assert.equal((await cbt('Cash Receipt', '1000')).status, 'Posted', 'its own entry is disabled');

  const tasks = uid => call(uid, 'getPendingApprovalsForUser', {});
  const theirs = (await tasks('u-approver2')).map(t => [t.DocumentID, t.ModuleID, t.ConfigKey, t.ModuleLabel]);
  assert.deepEqual(theirs, [[bp.jvId, 'CBT', 'CBT_BANKPAYMENT', 'Cash & Bank — Bank Payment']]);
  assert.deepEqual((await tasks('u-approver')).map(t => t.DocumentID), [cp.jvId], 'the bank payment is not the cash approver\'s');

  const ok = await call('u-approver2', 'decideJournalEntryApproval', { jvId: bp.jvId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
  assert.equal((await firestore.collection('journalEntries').doc(bp.jvId).get()).data().Status, 'Posted');

  const history = await call('u-admin', 'getApprovalHistory', { filters: { ModuleID: 'CBT_BANKPAYMENT' } });
  assert.deepEqual(history.map(h => h.DocumentID), [bp.jvId]);
});

test('CBT: an approval pending before the split still finishes under its own levels', async () => {
  const f = cbtFixture();
  f.approvalInstances = { 'APR-OLD': { ModuleID: 'CBT', DocumentID: 'JE-OLD', DocumentNumber: 'CP-OLD', ScopeKey: 'GLOBAL', Amount: 5, CreatedBy: 'u-admin',
    RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }], Decisions: [], Status: 'Pending', CreatedAt: '2026-09-01T00:00:00Z' } };
  await reset(f);
  await firestore.collection('journalEntries').doc('JE-OLD').set({ VoucherType: 'Cash Payment', Status: 'PendingApproval', ApprovalInstanceID: 'APR-OLD',
    CompanyID: 'C1', JVNumber: 'CP-OLD', JVDate: D, Description: 'Old', Lines: [{ AccountCode: '6000', Debit: 5, Credit: 0 }, { AccountCode: '1000', Debit: 0, Credit: 5 }] });
  const t = (await call('u-approver', 'getPendingApprovalsForUser', {})).find(x => x.DocumentID === 'JE-OLD');
  assert.equal(t.ModuleLabel, 'Cash & Bank Transactions');
  const ok = await call('u-approver', 'decideJournalEntryApproval', { jvId: 'JE-OLD', levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
});

// ---------- follow-up teams ----------
function teamFixture() {
  const f = baseFixture();
  f.users['u-buyer'] = { status: 'Active', role: 'Admin', username: 'buyer', fullName: 'Buyer', AssignedCompanies: ['C1'] };
  f.users['u-maker'] = { status: 'Active', role: 'Admin', username: 'maker', fullName: 'Maker', AssignedCompanies: ['C1'] };
  f.users['u-gone'] = { status: 'Inactive', role: 'Admin', username: 'gone', fullName: 'Gone', AssignedCompanies: ['C1'] };
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.vendors.V1.DefaultCurrency = 'AED';
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  // Approval itself stays off for all three: the teams work regardless.
  f.approvalConfigurations = {
    PURCHASEREQUISITION: { Enabled: false, ScopeType: 'CostCenter', GateType: 'Flat' },
    INVENTORYPURCHASEREQUISITION: { Enabled: false, ScopeType: 'Company', GateType: 'Flat' },
    JOBORDERREQUEST: { Enabled: false, ScopeType: 'Global', GateType: 'Flat' }
  };
  f.jobOrderBatches = { B1: { Origin: 'Sales', CompanyID: 'C1', CostCenterID: 'CC1', Status: 'Submitted', BatchNumber: 'JOB-1' } };
  f.jobOrderLines = {
    L1: { ParentBatchID: 'B1', SubJONumber: 'JO-1-1', ItemCode: 'FG-001', OrderedQuantity: 5, TargetDate: '2026-10-01', Status: 'Accepted', AcceptedAt: '2026-09-20T00:00:00Z' },
    L2: { ParentBatchID: 'B1', SubJONumber: 'JO-1-2', ItemCode: 'FG-002', OrderedQuantity: 3, Status: 'Pending Acceptance' },
    L3: { ParentBatchID: 'B1', SubJONumber: 'JO-1-3', ItemCode: 'FG-003', OrderedQuantity: 1, Status: 'In Progress' }
  };
  f.inventoryPurchaseRequisitions = { IPR1: { IPRNumber: 'IPR-1', Status: 'Submitted', CompanyID: 'C1', CostCenterID: 'CC2', Description: 'Stock',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Description: 'Sheets', EnteredQuantity: 4 }] } };
  return f;
}
const save = (moduleId, scopeKey, userIds, uid) => call(uid || 'u-admin', 'saveFollowUpTeam', { moduleId, scopeKey, userIds });
const tasksOf = async uid => (await call(uid, 'getMyFollowUpTasksForUser', {})).map(t => t.ModuleID + ':' + t.DocumentID);
const err = async p => { try { const r = await p; return r && r.error; } catch (e) { return e.message; } };

test('follow-up teams: saved per scope, validated, listed', async () => {
  const f = teamFixture();
  delete f.approvalConfigurations.JOBORDERREQUEST;
  await reset(f);
  assert.match(await err(save('JOBORDERREQUEST', 'GLOBAL', ['u-maker'])), /Save this module's settings/);
  assert.match(await err(save('GRN', 'CC1', ['u-maker'])), /no follow-up team/);
  assert.match(await err(save('PURCHASEREQUISITION', 'WH1', ['u-buyer'])), /Unknown CostCenter/);
  assert.match(await err(save('PURCHASEREQUISITION', 'CC1', ['u-gone'])), /only active users/);
  assert.match(await err(save('PURCHASEREQUISITION', 'CC1', ['u-buyer'], 'u-viewer')), /permission to modify/);
  assert.equal((await save('PURCHASEREQUISITION', 'CC1', ['u-buyer', 'u-buyer', ''])).success, true);
  assert.deepEqual((await call('u-admin', 'getFollowUpTeams', { moduleId: 'PURCHASEREQUISITION' })).teams.map(t => [t.ScopeKey, t.UserIDs]), [['CC1', ['u-buyer']]]);
  const mods = (await call('u-admin', 'getFollowUpTeams', {})).modules;
  assert.deepEqual(mods.map(m => [m.ModuleID, m.Team]), [['JOBORDERREQUEST', 'Production'], ['PURCHASEREQUISITION', 'Procurement'], ['INVENTORYPURCHASEREQUISITION', 'Procurement'],
    ['PDCRECEIVED', 'Treasury'], ['PDCISSUED', 'Treasury'], ['DELIVERYNOTE', 'Invoicing']]); // + Tier 3 wave 1 (owner, 2026-10-16)
  assert.equal((await save('PURCHASEREQUISITION', 'CC1', [])).success, true);
  assert.equal(await val('approvalFollowUps/PURCHASEREQUISITION/CC1'), null, 'an empty team is removed');
});

test('Procurement: a submitted PR is the team\'s task (its scope only) until a PO from it is submitted; closing ends it too', async () => {
  await reset(teamFixture());
  await save('PURCHASEREQUISITION', 'CC1', ['u-buyer']);
  await save('INVENTORYPURCHASEREQUISITION', 'C1', ['u-buyer']);
  const pr = async (cc, desc) => {
    const s = await call('u-maker', 'saveDraftPurchaseRequisition', { header: { PRDate: D, CompanyID: 'C1', CostCenterID: cc, Description: desc,
      Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 10, Unit: 'box' }] } });
    assert.equal(s.success, true, s.error);
    return s.prId;
  };
  const a = await pr('CC1', 'Paper for CC1');
  const b = await pr('CC2', 'Paper for CC2');
  const c = await pr('CC1', 'To close');
  assert.deepEqual(await tasksOf('u-buyer'), ['INVENTORYPURCHASEREQUISITION:IPR1'], 'drafts are not ready');
  for (const id of [a, b, c]) assert.equal((await call('u-maker', 'submitPurchaseRequisition', { prId: id })).status, 'Submitted');

  const list = await call('u-buyer', 'getMyFollowUpTasksForUser', {});
  assert.deepEqual(list.map(t => t.ModuleID + ':' + t.DocumentID).sort(),
    ['INVENTORYPURCHASEREQUISITION:IPR1', 'PURCHASEREQUISITION:' + a, 'PURCHASEREQUISITION:' + c].sort(), 'CC2 is not this team\'s scope');
  const t = list.find(x => x.DocumentID === a);
  assert.deepEqual([t.ModuleLabel, t.Description, t.DocumentDate], ['Purchase Requisition', 'Paper for CC1', D]);
  assert.match(t.DocumentNumber, /^PR/);
  assert.deepEqual(await tasksOf('u-maker'), [], 'not in the team');

  // A draft PO doesn't end it; submitting the PO does.
  const po = await call('u-buyer', 'saveDraftPurchaseOrder', { poData: { PODate: D, CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ SourceRequisitionType: 'PR', SourceRequisitionID: a, SourceLineIndex: 0, CategoryID: 'RC1', Description: 'Paper', Quantity: 10, UOM: 'box', UnitPrice: 5 }] } });
  assert.equal(po.success, true, po.error);
  assert.ok((await tasksOf('u-buyer')).includes('PURCHASEREQUISITION:' + a), 'still there with a draft PO');
  assert.equal((await call('u-buyer', 'submitPurchaseOrder', { poId: po.poId })).success, true);
  assert.ok(!(await tasksOf('u-buyer')).includes('PURCHASEREQUISITION:' + a), 'gone once the PO is submitted');

  assert.deepEqual(await call('u-maker', 'closePurchaseRequisition', { prId: c }), { success: true });
  assert.deepEqual(await tasksOf('u-buyer'), ['INVENTORYPURCHASEREQUISITION:IPR1']);
});

test('Production: an accepted Sales Job Order line is the team\'s task until production starts or it is stopped', async () => {
  await reset(teamFixture());
  await save('JOBORDERREQUEST', 'GLOBAL', ['u-maker']);
  const list = await call('u-maker', 'getMyFollowUpTasksForUser', {});
  assert.deepEqual(list.map(t => [t.ModuleID, t.DocumentID, t.DocumentNumber, t.Description, t.DocumentDate]),
    [['JOBORDERREQUEST', 'L1', 'JO-1-1', 'FG-001 × 5', '2026-10-01']], 'pending and in-progress lines are not');
  await rtdb.ref('jobOrderLines/L1/Status').set('In Progress');
  assert.deepEqual(await tasksOf('u-maker'), []);
  await rtdb.ref('jobOrderLines/L1/Status').set('Accepted'); // e.g. its production entry reversed
  assert.deepEqual(await tasksOf('u-maker'), ['JOBORDERREQUEST:L1']);
  await rtdb.ref('jobOrderLines/L1/Status').set('Stopped');
  assert.deepEqual(await tasksOf('u-maker'), []);
});

test('follow-up tasks respect module access and company', async () => {
  const f = teamFixture();
  f.users['u-buyer'].AssignedCompanies = ['C2'];
  f.permissions.JOBORDERREQUEST.access = ['Viewer'];
  await reset(f);
  await save('INVENTORYPURCHASEREQUISITION', 'C1', ['u-buyer']);
  await save('JOBORDERREQUEST', 'GLOBAL', ['u-maker']);
  assert.deepEqual(await tasksOf('u-buyer'), [], 'no access to C1');
  assert.deepEqual(await tasksOf('u-maker'), [], 'no access to Job Order Request');
});
