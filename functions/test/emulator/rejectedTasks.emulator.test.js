// Rejected items in Home Tasks (docs/modules/UX_ROUND2.md, items 2 and 3,
// owner 2026-10-24): a rejection stays the submitter's task only while its
// document still waits to be corrected; its submitter or an Admin can close
// one that will not be resubmitted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });

const rejected = (doc, by, extra) => Object.assign({
  ModuleID: 'GRN', DocumentID: doc, DocumentNumber: doc, CreatedBy: by || 'u-admin', Status: 'Rejected',
  RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-approver' }],
  Decisions: [{ LevelNumber: 1, Decision: 'Rejected', Reason: 'Wrong qty', DecidedAt: '2026-10-20T00:00:00Z' }],
  CreatedAt: '2026-10-20T00:00:00Z', UpdatedAt: '2026-10-20T00:00:00Z'
}, extra || {});
const tx = (status, apr, extra) => Object.assign({ TransactionType: 'GRN', CompanyID: 'C1', Status: status, ApprovalInstanceID: apr }, extra || {});

function fixture() {
  const f = baseFixture();
  f.approvalInstances = {
    'APR-REJ': rejected('G-REJ'), 'APR-POST': rejected('G-POST'), 'APR-OLD': rejected('G-NEW'),
    'APR-PEND': rejected('G-PEND'), 'APR-JOL': rejected('JOL1', 'u-admin', { ModuleID: 'JOBORDERREQUEST' }),
    'APR-PO': rejected('PO1', 'u-admin', { ModuleID: 'PURCHASEORDER' }), 'APR-PAY': rejected('RUN1', 'u-admin', { ModuleID: 'PAYROLL' }),
    'APR-THEIRS': rejected('G-THEIRS', 'u-approver')
  };
  f.stock = { transactions: {
    'G-REJ': tx('Rejected', 'APR-REJ'),
    // Corrected to under the threshold and posted with no approval: the
    // document keeps the old approval's id (the bug, owner 2026-10-24).
    'G-POST': tx('Posted', 'APR-POST'),
    'G-NEW': tx('PendingApproval', 'APR-NEWER'),
    'G-PEND': tx('PendingApproval', 'APR-PEND'),
    'G-THEIRS': tx('Rejected', 'APR-THEIRS')
  } };
  f.jobOrderLines = { JOL1: { ParentBatchID: 'B1', Status: 'Amendment Requested', ApprovalInstanceID: 'APR-JOL' } };
  f.purchaseOrders = { PO1: { CompanyID: 'C1', Status: 'Closed', ReopenRequested: true, ApprovalInstanceID: 'APR-PO' } };
  return f;
}
const ids = async uid => (await call(uid, 'getMyRejectedSubmissions', {})).map(x => x.InstanceID).sort();

test('a rejection is a task only while its document waits to be corrected', async () => {
  await reset(fixture());
  await firestore.collection('payrollRuns').doc('RUN1').set({ CompanyID: 'C1', Status: 'Draft', ApprovalInstanceID: 'APR-PAY' });
  assert.deepEqual(await ids('u-admin'), ['APR-JOL', 'APR-PAY', 'APR-PO', 'APR-REJ'],
    'posted after correction, resubmitted, and pending are left out; Draft, Amendment Requested and a refused reopening stay');
  assert.deepEqual(await ids('u-approver'), ['APR-THEIRS'], 'only one\'s own');

  // Once the PO is reopened some other way, or the run is posted, they go.
  await firestore.collection('payrollRuns').doc('RUN1').update({ Status: 'Posted' });
  assert.ok(!(await ids('u-admin')).includes('APR-PAY'));
});

test('the submitter closes their own; an Admin closes anyone\'s; others are refused', async () => {
  const f = fixture();
  f.approvalInstances['APR-VIEW'] = rejected('G-REJ', 'u-viewer');
  f.approvalInstances['APR-VIEW2'] = rejected('G-REJ', 'u-viewer');
  await reset(f);

  const closed = await call('u-admin', 'closeRejectedSubmission', { InstanceID: 'APR-REJ' });
  assert.equal(closed.success, true, closed.error);
  const inst = await val('approvalInstances/APR-REJ');
  assert.equal(inst.Status, 'Closed');
  assert.equal(inst.ClosedNote, 'Closed, not resubmitted');
  assert.equal(inst.ClosedBy, 'u-admin');
  assert.equal(inst.Decisions[0].Reason, 'Wrong qty', 'the rejection stays on record');
  assert.equal((await val('stock/transactions/G-REJ')).Status, 'Rejected', 'the document is untouched');
  assert.ok(!(await ids('u-admin')).includes('APR-REJ'), 'off Tasks');

  await assert.rejects(call('u-admin', 'closeRejectedSubmission', { InstanceID: 'APR-REJ' }), /Only a rejected item can be closed; this one is closed/);
  await assert.rejects(call('u-admin', 'closeRejectedSubmission', { InstanceID: 'APR-NONE' }), /not found/);

  // Not theirs and not an Admin: refused.
  await assert.rejects(call('u-viewer', 'closeRejectedSubmission', { InstanceID: 'APR-THEIRS' }), /Only its submitter or an Admin/);
  // The submitter who is not an Admin closes their own.
  const f2 = await call('u-viewer', 'closeRejectedSubmission', { InstanceID: 'APR-VIEW2' });
  assert.equal(f2.success, true);
  assert.equal((await val('approvalInstances/APR-THEIRS')).Status, 'Rejected');
  // An Admin closes another user's.
  assert.equal((await call('u-admin', 'closeRejectedSubmission', { InstanceID: 'APR-VIEW' })).success, true);
  assert.equal((await val('approvalInstances/APR-VIEW')).ClosedByName, 'Admin User');
});
