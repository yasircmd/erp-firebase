// Approval delegation (owner, 2026-09-29; docs/modules/APPROVAL_DELEGATION.md):
// an Admin (any) or an approver (their own) hands an undecided level of a
// pending approval to another active user who can open the document, with
// a reason; one approval or all of an absent approver's. Driven through the
// real JV approval flow.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val, put } = require('./_helpers');

test.after(async () => { await app.delete(); });

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.roles.Approver = { Name: 'Approver', Status: 'Active' };
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  // Approvers can open and decide JVs (deciding needs "post") and open the Tracker.
  f.permissions.JV.access.push('Approver'); f.permissions.JV.post.push('Approver');
  f.permissions.APPROVALTRACKER.access.push('Approver');
  const u = (name, role, companies, status) => ({ status: status || 'Active', role, username: name.toLowerCase(), fullName: name, AssignedCompanies: companies });
  Object.assign(f.users, {
    'u-anna': u('Anna', 'Approver', ['C1']),
    'u-ben': u('Ben', 'Approver', ['C1']),
    'u-cara': u('Cara', 'Approver', ['C1']),
    'u-dan': u('Dan', 'Approver', ['C2']),
    'u-eve': u('Eve', 'Clerk', ['C1']),
    'u-fay': u('Fay', 'Approver', ['C1'], 'Inactive')
  });
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [
    { LevelNumber: 1, ApproverUserID: 'u-anna', ThresholdAmount: 0 },
    { LevelNumber: 2, ApproverUserID: 'u-ben', ThresholdAmount: 0 }] } } };
  return f;
}

async function pendingJv(description) {
  const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: description || 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] } });
  assert.equal(s.success, true, s.error);
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.status, 'PendingApproval', p.error);
  const rec = (await firestore.collection('journalEntries').doc(s.jvId).get()).data();
  return { jvId: s.jvId, instanceId: rec.ApprovalInstanceID };
}
// A refused call comes back as { error } (call() throws on an HttpsError).
const tryCall = (uid, fn, data) => call(uid, fn, data).catch(e => ({ error: e.message }));
const delegate = (uid, instanceId, levelNumber, toUserId, reason) =>
  tryCall(uid, 'delegateApproval', { instanceId, levelNumber, toUserId, reason: reason === undefined ? 'On annual leave' : reason });
const decide = (uid, jvId, levelNumber, decision) => call(uid, 'decideJournalEntryApproval', { jvId, levelNumber, decision, reason: decision === 'Rejected' ? 'No' : '' });
const tasks = async uid => (await call(uid, 'getPendingApprovalsForUser', {})).map(t => t.InstanceID);

test('an Admin delegates a level: the new approver has the task and decides; the old one no longer can; the history is kept', async () => {
  await reset(fixture());
  const { jvId, instanceId } = await pendingJv();
  assert.deepEqual(await tasks('u-anna'), [instanceId]);

  const r = await delegate('u-admin', instanceId, 1, 'u-cara');
  assert.equal(r.success, true, r.error);
  assert.equal(r.delegatedTo, 'Cara');
  const inst = await val('approvalInstances/' + instanceId);
  assert.deepEqual(inst.RequiredLevels.map(l => [l.LevelNumber, l.ApproverUserID]), [[1, 'u-cara'], [2, 'u-ben']]);
  const [h] = inst.Delegations;
  assert.deepEqual([h.LevelNumber, h.FromUserID, h.FromName, h.ToUserID, h.ToName, h.By, h.Reason], [1, 'u-anna', 'Anna', 'u-cara', 'Cara', 'u-admin', 'On annual leave']);
  assert.match(h.At, /^\d{4}-\d{2}-\d{2}T/);

  assert.deepEqual(await tasks('u-anna'), [], 'Anna no longer has it');
  assert.deepEqual(await tasks('u-cara'), [instanceId]);
  assert.match((await decide('u-anna', jvId, 1, 'Approved')).error, /not the assigned approver/);
  assert.equal((await decide('u-cara', jvId, 1, 'Approved')).error, undefined);
  const after = await val('approvalInstances/' + instanceId);
  assert.deepEqual(after.Decisions.map(d => [d.LevelNumber, d.ApproverUserID, d.Decision]), [[1, 'u-cara', 'Approved']]);
  assert.equal(after.Status, 'Pending', 'level 2 still to decide');
});

test('an approver delegates their own level, never someone else\'s; a reason is required', async () => {
  await reset(fixture());
  const { instanceId } = await pendingJv();
  assert.match((await delegate('u-anna', instanceId, 2, 'u-cara')).error, /Only an Admin or this level's approver/);
  assert.match((await delegate('u-anna', instanceId, 1, 'u-cara', '  ')).error, /Enter the reason/);
  assert.match((await delegate('u-eve', instanceId, 1, 'u-cara')).error, /do not have access to Approval Tracker/);
  const r = await delegate('u-anna', instanceId, 1, 'u-cara');
  assert.equal(r.success, true, r.error);
  assert.equal((await val('approvalInstances/' + instanceId)).Delegations[0].By, 'u-anna');
  // Anna is no longer the approver, so she can't move it again.
  assert.match((await delegate('u-anna', instanceId, 1, 'u-admin')).error, /Only an Admin or this level's approver/);
});

test('who can receive it: active, not already on the document, with module and company access', async () => {
  await reset(fixture());
  const { jvId, instanceId } = await pendingJv();
  const err = async to => (await delegate('u-admin', instanceId, 1, to)).error;
  assert.match(await err('u-anna'), /already the approver of this level/);
  assert.match(await err('u-ben'), /already approves another level/);
  assert.match(await err('u-fay'), /not an active user/);
  assert.match(await err('u-eve'), /no access to Journal Entry \(JV\)/);
  assert.match(await err('u-dan'), /no access to this document's company/);
  assert.match(await err('u-nobody'), /not found/);
  assert.match((await delegate('u-admin', instanceId, 1, '')).error, /Select who/);

  const c = await call('u-admin', 'getDelegationCandidates', { instanceId, levelNumber: 1 });
  const ids = c.users.map(u => u.UserID);
  assert.ok(ids.includes('u-cara') && ids.includes('u-admin'), ids.join());
  for (const no of ['u-anna', 'u-ben', 'u-dan', 'u-eve', 'u-fay']) assert.ok(!ids.includes(no), no);
  assert.deepEqual([c.UserID, c.IsAdmin], ['u-admin', true]);

  // Someone who decided another level can't take this one either.
  await decide('u-ben', jvId, 2, 'Approved');
  await put('approvalInstances/' + instanceId + '/RequiredLevels/1/ApproverUserID', 'u-cara'); // level 2 re-pointed after Ben decided
  assert.match(await err('u-ben'), /already approves another level/);
});

test('only an undecided level of a pending approval', async () => {
  await reset(fixture());
  const { jvId, instanceId } = await pendingJv();
  await decide('u-anna', jvId, 1, 'Approved');
  assert.match((await delegate('u-admin', instanceId, 1, 'u-cara')).error, /already recorded a decision/);
  assert.match((await delegate('u-admin', instanceId, 3, 'u-cara')).error, /does not apply/);
  await decide('u-ben', jvId, 2, 'Rejected');
  assert.match((await delegate('u-admin', instanceId, 2, 'u-cara')).error, /already been rejected/);
  assert.match((await delegate('u-admin', 'APR-NONE', 1, 'u-cara')).error, /not found/);
});

test('all of an absent approver\'s: every pending one moves; the ones that can\'t are listed; approvers only their own', async () => {
  await reset(fixture());
  const a = await pendingJv('One');
  const b = await pendingJv('Two');
  const c = await pendingJv('Three');
  await decide('u-anna', c.jvId, 1, 'Approved'); // already decided: not Anna's any more

  assert.match((await tryCall('u-anna', 'delegateApprovalsOf', { fromUserId: 'u-ben', toUserId: 'u-cara', reason: 'x' })).error, /only delegate your own/);
  assert.match((await tryCall('u-admin', 'delegateApprovalsOf', { fromUserId: 'u-anna', toUserId: 'u-cara', reason: '' })).error, /Enter the reason/);
  assert.match((await tryCall('u-admin', 'delegateApprovalsOf', { fromUserId: 'u-anna', toUserId: 'u-anna', reason: 'x' })).error, /someone other/);

  // To Ben, who is level 2 on each: none can move, each listed.
  const none = await call('u-admin', 'delegateApprovalsOf', { fromUserId: 'u-anna', toUserId: 'u-ben', reason: 'Leave' });
  assert.deepEqual(none.moved, []);
  assert.equal(none.skipped.length, 2);
  assert.ok(none.skipped.every(s => /already approves another level/.test(s.Reason) && /Journal Entry \(JV\) JV-.*, level 1/.test(s.Document)), JSON.stringify(none.skipped));

  // Anna delegates her own, to Cara: both pending ones move.
  const all = await call('u-anna', 'delegateApprovalsOf', { toUserId: 'u-cara', reason: 'On annual leave' });
  assert.deepEqual(all.moved.map(m => m.InstanceID).sort(), [a.instanceId, b.instanceId].sort());
  assert.deepEqual(all.skipped, []);
  assert.deepEqual((await tasks('u-cara')).sort(), [a.instanceId, b.instanceId].sort());
  assert.deepEqual(await tasks('u-anna'), []);
  assert.equal((await val('approvalInstances/' + c.instanceId)).Delegations, undefined, 'a decided level is left alone');
});

test('a Job Order line: its company comes from the batch', async () => {
  const f = fixture();
  f.permissions.JOBORDERREQUEST.access.push('Approver');
  f.jobOrderBatches = { B1: { Origin: 'Sales', CompanyID: 'C2', Status: 'Submitted', BatchNumber: 'JOB-26-1' } };
  f.jobOrderLines = { L1: { ParentBatchID: 'B1', LineNumber: 1, SubJONumber: 'JO-26-1-1', Status: 'PendingAcceptance' } };
  f.approvalInstances = { 'APR-JO1': { ModuleID: 'JOBORDERREQUEST', DocumentID: 'L1', DocumentNumber: 'JO-26-1-1', Status: 'Pending',
    RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-other', ThresholdAmount: 0 }], Decisions: [], CreatedBy: 'u-admin', CreatedAt: '2026-09-20T00:00:00Z' } };
  await reset(f);
  assert.match((await delegate('u-admin', 'APR-JO1', 1, 'u-cara')).error, /no access to this document's company/, 'the batch is C2');
  const r = await delegate('u-admin', 'APR-JO1', 1, 'u-dan');
  assert.equal(r.success, true, r.error);
  assert.equal(await val('approvalInstances/APR-JO1/RequiredLevels/0/ApproverUserID'), 'u-dan');
});
