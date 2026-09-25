// APPROVALCONFIG through its screen's callables — and that what it saves
// actually gates a posting (the hand-ported Stock Adjustment reads it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

test('configure scope + gate, then levels; ordering and approver rules', async () => {
  const cfgs = await call('u-admin', 'getApprovalConfigurations');
  assert.ok(JSON.stringify(cfgs).includes('STOCKADJUSTMENT'));
  assert.equal((await call('u-admin', 'saveApprovalLevels', { moduleId: 'STOCKADJUSTMENT', scopeKey: 'GLOBAL', levels: [] })).error,
    "Configure this module's scope and gate type before adding levels.");
  assert.deepEqual(await call('u-admin', 'saveApprovalConfiguration', { moduleId: 'STOCKADJUSTMENT', config: { Enabled: true, ScopeType: 'Global', GateType: 'Threshold' } }), { success: true });
  assert.equal((await call('u-admin', 'saveApprovalConfiguration', { moduleId: 'STOCKADJUSTMENT', config: { Enabled: true, ScopeType: 'Planet', GateType: 'Threshold' } })).error, 'Invalid scope type.');
  const bad = await call('u-admin', 'saveApprovalLevels', { moduleId: 'STOCKADJUSTMENT', scopeKey: 'GLOBAL', levels: [
    { ThresholdAmount: 100, ApproverUserID: 'u-approver' }, { ThresholdAmount: 50, ApproverUserID: 'u-admin' }] });
  assert.equal(bad.error, "Level 2: threshold cannot be lower than the previous level's.");
  assert.equal((await call('u-admin', 'saveApprovalLevels', { moduleId: 'STOCKADJUSTMENT', scopeKey: 'GLOBAL', levels: [{ ThresholdAmount: 0, ApproverUserID: 'nobody' }] })).error,
    'Level 1: approver must be an active user.');
  assert.deepEqual(await call('u-admin', 'saveApprovalLevels', { moduleId: 'STOCKADJUSTMENT', scopeKey: 'GLOBAL', levels: [{ ThresholdAmount: 0, ApproverUserID: 'u-approver' }] }), { success: true });
  const lv = await call('u-admin', 'getApprovalLevelsForModule', { moduleId: 'STOCKADJUSTMENT' });
  assert.ok(JSON.stringify(lv).includes('u-approver'));
  assert.ok((await call('u-admin', 'getActiveUsersForPicker')).length >= 3);
});

test('the saved configuration gates a real Stock Adjustment post', async () => {
  // Stock to adjust: GRN 5 @ 4 into WH1 (GRN itself is not gated).
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'seed', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 5, UnitCost: 4, Description: 'seed' }] });
  await call('u-admin', 'postGrn', { grnId: g.grnId });
  const s = await call('u-admin', 'saveStockAdjustmentDraft', { TransactionDate: today, Description: 'gated', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', AdjustmentDirection: 'Decrease', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, Description: 'x', CostCenterID: 'CC1' }] });
  assert.deepEqual(await call('u-admin', 'postStockAdjustment', { adjId: s.adjId }), { success: true, status: 'PendingApproval' });
});

test('Viewer cannot modify', async () => {
  assert.equal((await call('u-viewer', 'saveApprovalConfiguration', { moduleId: 'GRN', config: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } })).error,
    'You do not have permission to modify Approval Configuration.');
});
