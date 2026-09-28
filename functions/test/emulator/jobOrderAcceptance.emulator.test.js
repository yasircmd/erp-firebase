// Job Order acceptance and stop through Approval Configuration, levels in
// order (owner, 2026-09-28; docs/modules/JOB_ORDER_ACCEPTANCE.md): Home
// tasks for the current level's approver, only that approver can act, the
// line moves on after the last level; amendment -> the submitter's rejected
// task; resubmit restarts at level 1; withdraw leaves no task behind; not
// configured, legacy lines and Production lines work as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture(opts) {
  const o = opts || {};
  const f = baseFixture();
  f.users['u-appr2'] = { status: 'Active', role: 'Admin', username: 'appr2', fullName: 'Second Approver', AssignedCompanies: ['C1'] };
  const item = (code, name) => ({ ItemCode: code, ItemName: name, Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' });
  Object.assign(f.items, { FG1: item('FG-001', 'Panel'), FG2: item('FG-002', 'Door') });
  f.boms = {
    B1: { ParentItemID: 'FG1', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 2 }] },
    B2: { ParentItemID: 'FG2', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 3 }] }
  };
  if (o.configured !== false) {
    f.approvalConfigurations = { JOBORDERREQUEST: { Enabled: o.disabled ? false : true, ScopeType: 'Company' } };
    f.approvalLevels = { JOBORDERREQUEST: { C1: { Levels: o.levels || [
      { LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 },
      { LevelNumber: 2, ApproverUserID: 'u-appr2', ThresholdAmount: 0 }
    ] } } };
  }
  return f;
}
test.after(async () => { await app.delete(); });

const act = (fn, data, uid) => call(uid || 'u-admin', fn, data);
const line = async id => Object.assign({ LineID: id }, await val('jobOrderLines/' + id));
async function submitSales(items) {
  const s = await act('saveDraftJobOrderBatch', { header: { Origin: 'Sales', CompanyID: 'C1', CostCenterID: 'CC1', JODate: D, Description: 'Run',
    Lines: (items || ['FG-001']).map(code => ({ ItemCode: code, OrderedQuantity: 5, TargetDate: '2026-10-01' })) } });
  assert.equal(s.success, true, s.error);
  const sub = await act('submitJobOrderBatch', { batchId: s.batchId });
  assert.equal(sub.success, true, sub.error);
  return Object.entries(await val('jobOrderLines')).filter(([, l]) => l.ParentBatchID === s.batchId)
    .sort(([, a], [, b]) => a.LineNumber - b.LineNumber).map(([id]) => id);
}
// Job Order tasks in a user's Home "Pending approvals".
const joTasks = async uid => (await call(uid, 'getPendingApprovalsForUser', {})).filter(t => t.ModuleID === 'JOBORDERREQUEST').map(t => t.DocumentID);
const rejectedTasks = async uid => (await call(uid, 'getMyRejectedSubmissions', {})).filter(t => t.ModuleID === 'JOBORDERREQUEST');
const flat = async (uid, id) => (await call(uid, 'getJobOrderLinesFlat', {})).entries.find(l => l.LineID === id);

test('acceptance goes level by level: task and buttons only for the current level\'s approver', async () => {
  await reset(fixture());
  const [id] = await submitSales();
  let l = await line(id);
  assert.equal(l.Status, 'Pending Acceptance');
  assert.match(l.ApprovalInstanceID, /^APR-/);

  assert.deepEqual(await joTasks('u-approver'), [id], 'level 1 has the task');
  assert.deepEqual(await joTasks('u-appr2'), [], 'level 2 waits for level 1');
  assert.deepEqual(await joTasks('u-admin'), []);
  const view = await flat('u-approver', id);
  assert.deepEqual([view.ApprovalPending, view.AwaitingLevel, view.AwaitingApproverName, view.CanActOnApproval], [true, 1, 'Approver', true]);
  assert.equal((await flat('u-admin', id)).CanActOnApproval, false);

  assert.match((await act('acceptJobOrderLine', { lineId: id }, 'u-appr2')).error, /waiting on approval level 1/);
  assert.match((await act('acceptJobOrderLine', { lineId: id }, 'u-admin')).error, /waiting on approval level 1/, 'post permission alone no longer accepts');

  assert.deepEqual(await act('acceptJobOrderLine', { lineId: id }, 'u-approver'), { success: true, status: 'Pending Acceptance' });
  assert.equal((await line(id)).Status, 'Pending Acceptance', 'level 2 still to come');
  assert.deepEqual(await joTasks('u-approver'), []);
  assert.deepEqual(await joTasks('u-appr2'), [id], 'now level 2 has it');
  assert.deepEqual([(await flat('u-appr2', id)).AwaitingLevel, (await flat('u-appr2', id)).CanActOnApproval], [2, true]);

  assert.deepEqual(await act('acceptJobOrderLine', { lineId: id }, 'u-appr2'), { success: true });
  l = await line(id);
  assert.deepEqual([l.Status, l.AcceptedBy], ['Accepted', 'appr2']);
  assert.deepEqual(await joTasks('u-appr2'), []);
  assert.equal((await val('approvalInstances/' + l.ApprovalInstanceID)).Status, 'Approved');
});

test('amendment ends the chain and becomes the submitter\'s task; resubmit restarts at level 1', async () => {
  await reset(fixture());
  const [id] = await submitSales();
  await act('acceptJobOrderLine', { lineId: id }, 'u-approver');
  assert.match((await act('requestJobOrderLineAmendment', { lineId: id, proposedQuantity: 3, proposedDate: '', note: 'Only 3' }, 'u-approver')).error,
    /waiting on approval level 2/, 'level 1 already decided');
  assert.deepEqual(await act('requestJobOrderLineAmendment', { lineId: id, proposedQuantity: 3, proposedDate: '', note: 'Only 3' }, 'u-appr2'), { success: true });
  const first = (await line(id)).ApprovalInstanceID;
  assert.equal((await line(id)).Status, 'Amendment Requested');
  assert.equal((await val('approvalInstances/' + first)).Status, 'Rejected');
  const rej = await rejectedTasks('u-admin');
  assert.deepEqual(rej.map(t => [t.DocumentID, t.RejectionReason]), [[id, 'Only 3']], 'the submitter sees it');
  assert.deepEqual(await joTasks('u-appr2'), []);

  assert.deepEqual(await act('reviseAndResubmitJobOrderLine', { lineId: id, revisedQuantity: 3, revisedDate: '2026-10-05' }), { success: true });
  const l = await line(id);
  assert.equal(l.Status, 'Pending Acceptance');
  assert.notEqual(l.ApprovalInstanceID, first, 'a fresh approval');
  assert.deepEqual(await rejectedTasks('u-admin'), [], 'the rejected task is gone');
  assert.deepEqual(await joTasks('u-approver'), [id], 'back to level 1');
  assert.deepEqual(await joTasks('u-appr2'), []);
});

test('withdraw leaves no task behind, from pending or from an amendment', async () => {
  await reset(fixture());
  const [a, b] = await submitSales(['FG-001', 'FG-002']);
  assert.deepEqual(await act('withdrawJobOrderLine', { lineId: a }), { success: true });
  assert.equal((await val('approvalInstances/' + (await line(a)).ApprovalInstanceID)).Status, 'Withdrawn');
  assert.deepEqual(await joTasks('u-approver'), [b]);

  await act('requestJobOrderLineAmendment', { lineId: b, proposedQuantity: '', proposedDate: '', note: 'Why?' }, 'u-approver');
  assert.equal((await rejectedTasks('u-admin')).length, 1);
  assert.deepEqual(await act('withdrawJobOrderLine', { lineId: b }), { success: true });
  assert.deepEqual(await rejectedTasks('u-admin'), []);
  assert.deepEqual(await joTasks('u-approver'), []);
});

test('a stop goes through the same approvers in order; Stopped after the last level', async () => {
  await reset(fixture());
  const [id] = await submitSales();
  await act('acceptJobOrderLine', { lineId: id }, 'u-approver');
  await act('acceptJobOrderLine', { lineId: id }, 'u-appr2');
  assert.deepEqual(await act('requestJobOrderLineStop', { lineId: id, note: 'Customer cancelled' }), { success: true });
  const l = await line(id);
  assert.equal(l.Status, 'Stop Requested');
  const stop = await val('approvalInstances/' + l.ApprovalInstanceID);
  assert.deepEqual([stop.Status, stop.DocumentNumber], ['Pending', l.SubJONumber + ' (stop)']);
  assert.deepEqual(await joTasks('u-approver'), [id]);

  assert.match((await act('acceptJobOrderLineStop', { lineId: id }, 'u-admin')).error, /waiting on approval level 1/);
  assert.deepEqual(await act('acceptJobOrderLineStop', { lineId: id }, 'u-approver'), { success: true, status: 'Stop Requested' });
  assert.deepEqual(await joTasks('u-appr2'), [id]);
  assert.deepEqual(await act('acceptJobOrderLineStop', { lineId: id }, 'u-appr2'), { success: true });
  assert.equal((await line(id)).Status, 'Stopped');
  assert.deepEqual(await joTasks('u-appr2'), []);
});

test('not configured (or disabled) works as before: no approval, anyone with post accepts and stops', async () => {
  for (const opts of [{ configured: false }, { disabled: true }]) {
    await reset(fixture(opts));
    const [id] = await submitSales();
    assert.equal((await line(id)).ApprovalInstanceID, '');
    assert.deepEqual(await joTasks('u-approver'), []);
    assert.equal((await flat('u-admin', id)).ApprovalPending, false);
    assert.deepEqual(await act('acceptJobOrderLine', { lineId: id }, 'u-admin'), { success: true });
    assert.deepEqual(await act('requestJobOrderLineStop', { lineId: id, note: 'x' }), { success: true });
    assert.deepEqual(await act('acceptJobOrderLineStop', { lineId: id }, 'u-admin'), { success: true });
    assert.equal((await line(id)).Status, 'Stopped');
  }
});

test('lines already pending before go-live, Production lines, and zero-threshold levels', async () => {
  await reset(fixture({ levels: [
    { LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 },
    { LevelNumber: 2, ApproverUserID: 'u-appr2', ThresholdAmount: 1000 }
  ] }));
  // A Job Order has no amount: only 0-threshold levels apply (as Purchase Requisition).
  const [id] = await submitSales();
  const inst = await val('approvalInstances/' + (await line(id)).ApprovalInstanceID);
  assert.deepEqual(inst.RequiredLevels.map(l => l.LevelNumber), [1]);
  assert.deepEqual(await act('acceptJobOrderLine', { lineId: id }, 'u-approver'), { success: true });
  assert.equal((await line(id)).Status, 'Accepted');

  // A line left Pending Acceptance by the old code (no approval) keeps working as before.
  const [legacy] = await submitSales();
  await rtdb.ref('jobOrderLines/' + legacy + '/ApprovalInstanceID').remove();
  assert.deepEqual(await act('acceptJobOrderLine', { lineId: legacy }, 'u-admin'), { success: true });

  // Production-direct lines start Open with no approval.
  const s = await act('saveDraftJobOrderBatch', { header: { Origin: 'Production', CompanyID: 'C1', CostCenterID: 'CC1', JODate: D, Description: 'Direct',
    Lines: [{ ItemCode: 'FG-002', OrderedQuantity: 1 }] } });
  await act('submitJobOrderBatch', { batchId: s.batchId });
  const direct = Object.values(await val('jobOrderLines')).find(l => l.ParentBatchID === s.batchId);
  assert.deepEqual([direct.Status, direct.ApprovalInstanceID], ['Open', '']);
});
