// APPROVALTRACKER through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.before(async () => {
  const f = baseFixture();
  f.approvalInstances = {
    'APR-1': { ModuleID: 'GRN', DocumentID: 'G1', DocumentNumber: 'GRN-26-01-000001', CreatedBy: 'u-admin', CreatedAt: '2026-09-01T10:00:00Z', Status: 'Pending',
      RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] },
    'APR-2': { ModuleID: 'STOCKADJUSTMENT', DocumentID: 'A1', DocumentNumber: 'ADJ-26-01-000009', CreatedBy: 'u-admin', CreatedAt: '2026-09-10T10:00:00Z', Status: 'Approved',
      RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-admin', ThresholdAmount: 0 }] }
  };
  await reset(f);
});
test.after(async () => { await app.delete(); });

test('history: newest first, filters by module, document number, approver, dates', async () => {
  const all = await call('u-admin', 'getApprovalHistory', { filters: {} });
  assert.deepEqual(all.map(i => i.InstanceID), ['APR-2', 'APR-1']);
  assert.deepEqual((await call('u-admin', 'getApprovalHistory', { filters: { ModuleID: 'GRN' } })).map(i => i.InstanceID), ['APR-1']);
  assert.deepEqual((await call('u-admin', 'getApprovalHistory', { filters: { DocumentNumber: 'adj-26' } })).map(i => i.InstanceID), ['APR-2']);
  assert.deepEqual((await call('u-admin', 'getApprovalHistory', { filters: { ApproverUserID: 'u-approver' } })).map(i => i.InstanceID), ['APR-1']);
  assert.deepEqual((await call('u-admin', 'getApprovalHistory', { filters: { FromDate: '2026-09-05', ToDate: '2026-09-10' } })).map(i => i.InstanceID), ['APR-2']);
});

test('requires access', async () => {
  const noAccess = baseFixture().permissions.APPROVALTRACKER.access.filter(r => r !== 'Viewer');
  const { rtdb } = require('./_helpers');
  await rtdb.ref('permissions/APPROVALTRACKER/access').set(noAccess);
  try {
    await assert.rejects(call('u-viewer', 'getApprovalHistory', { filters: {} }), /You do not have access to Approval Tracker\./);
  } finally {
    await rtdb.ref('permissions/APPROVALTRACKER/access').set(baseFixture().permissions.APPROVALTRACKER.access);
  }
});
