// INVENTORYPURCHASEREQUISITION through its screen's callables: draft
// (item-code lines, UOM defaulted from the item, cost center defaulted),
// submit (IPR number only at submit), approval gate with reject -> revise
// -> resubmit, close, cancel, delete, list, and access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Bolt', Category: 'RawMaterial', Status: 'Inactive', CompanyID: 'C1', UOMID: 'UOM-PCS' };
  return f;
}
test.after(async () => { await app.delete(); });

const line = (o) => Object.assign({ ItemCode: 'RM-001', WarehouseID: 'WH1', Description: 'Sheets', EnteredQuantity: 3 }, o);
const draft = (lines, extra, uid) => call(uid || 'u-admin', 'saveDraftInventoryPurchaseRequisition', {
  header: Object.assign({ IPRDate: D, CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Restock', Lines: lines }, extra || {})
});

test('draft stores item lines (blank rows dropped, UOM and cost center defaulted); number only at submit', async () => {
  await reset(fixture());
  const s = await draft([line(), line({ ItemCode: ' ' }), line({ EnteredQuantity: 1.5, EnteredUOMID: 'UOM-X', CostCenterID: 'CCX' })]);
  assert.equal(s.success, true, s.error);
  assert.match(s.iprId, /^IPR-/);
  const rec = await val('inventoryPurchaseRequisitions/' + s.iprId);
  assert.equal(rec.Status, 'Draft');
  assert.equal(rec.IPRNumber, '');
  assert.deepEqual(rec.Lines.map(l => [l.ItemCode, l.EnteredQuantity, l.EnteredUOMID, l.CostCenterID]),
    [['RM-001', 3, 'UOM-PCS', 'CC1'], ['RM-001', 1.5, 'UOM-X', 'CCX']]);

  const sub = await call('u-admin', 'submitInventoryPurchaseRequisition', { iprId: s.iprId });
  assert.equal(sub.success, true, sub.error);
  assert.equal(sub.status, 'Submitted');
  assert.match(sub.iprNumber, /IPR/);
  assert.equal((await val('inventoryPurchaseRequisitions/' + s.iprId)).IPRNumber, sub.iprNumber);

  assert.deepEqual(await draft([line()], { IPRID: s.iprId }), { success: false, error: 'Only a Draft or Rejected requisition can be edited.' });
  assert.match((await call('u-admin', 'deleteDraftInventoryPurchaseRequisition', { iprId: s.iprId })).error, /Only a Draft/);
  assert.deepEqual(await call('u-admin', 'closeInventoryPurchaseRequisition', { iprId: s.iprId }), { success: true });
  assert.equal((await val('inventoryPurchaseRequisitions/' + s.iprId)).Status, 'Closed');
  assert.match((await call('u-admin', 'cancelInventoryPurchaseRequisition', { iprId: s.iprId })).error, /can no longer be cancelled/);
});

test('approval gate: reject -> revise -> resubmit -> approve lands on Submitted', async () => {
  const f = fixture();
  f.approvalConfigurations = { INVENTORYPURCHASEREQUISITION: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { INVENTORYPURCHASEREQUISITION: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft([line()]);
  const sub = await call('u-admin', 'submitInventoryPurchaseRequisition', { iprId: s.iprId });
  assert.equal(sub.status, 'PendingApproval', sub.error);
  assert.match((await call('u-admin', 'closeInventoryPurchaseRequisition', { iprId: s.iprId })).error, /Only a Submitted/);

  const rej = await call('u-approver', 'decideInventoryPurchaseRequisitionApproval', { iprId: s.iprId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong item' });
  assert.equal(rej.status, 'Rejected', rej.error);
  assert.equal((await val('inventoryPurchaseRequisitions/' + s.iprId)).RejectionReason, 'Wrong item');

  assert.equal((await draft([line({ EnteredQuantity: 9 })], { IPRID: s.iprId })).success, true, 'Rejected is editable');
  const re = await call('u-admin', 'submitInventoryPurchaseRequisition', { iprId: s.iprId });
  assert.equal(re.status, 'PendingApproval', re.error);
  assert.notEqual(re.iprNumber, sub.iprNumber, 'quirk kept from Code.gs: fresh number on resubmit');

  const ok = await call('u-approver', 'decideInventoryPurchaseRequisitionApproval', { iprId: s.iprId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.success, true, ok.error);
  const rec = await val('inventoryPurchaseRequisitions/' + s.iprId);
  assert.equal(rec.Status, 'Submitted');
  assert.equal(rec.RejectionReason, '');
  assert.equal(rec.Lines[0].EnteredQuantity, 9);
});

test('validation', async () => {
  await reset(fixture());
  assert.match((await draft([line()], { CompanyID: '' })).error, /Select a Company/);
  assert.match((await draft([line()], { CostCenterID: '' })).error, /Select a Cost Center/);
  assert.match((await draft([line()], { CostCenterID: 'WH1' })).error, /Unknown Cost Center/);
  assert.match((await draft([line()], { Priority: 'High' })).error, /Normal or Urgent/);
  assert.equal((await draft([line({ ItemCode: 'RM-002' })])).error, 'One or more lines reference an unknown or inactive item: RM-002');
  assert.match((await draft([line({ ItemCode: 'NOPE' })])).error, /unknown or inactive item: NOPE/);
  assert.match((await draft([line({ EnteredQuantity: -2 })])).error, /greater than zero/);
  assert.equal((await draft([line()], { IPRID: 'IPR-MISSING' })).error, 'Requisition not found.');
  const empty = await draft([]);
  assert.equal(empty.success, true);
  assert.match((await call('u-admin', 'submitInventoryPurchaseRequisition', { iprId: empty.iprId })).error, /at least one line/);
});

test('cancel, delete, list and access', async () => {
  await reset(fixture());
  const a = await draft([line()]);
  const b = await draft([line()], { Priority: 'Urgent' });
  assert.deepEqual(await call('u-admin', 'cancelInventoryPurchaseRequisition', { iprId: a.iprId }), { success: true });
  assert.equal((await val('inventoryPurchaseRequisitions/' + a.iprId)).Status, 'Cancelled');

  const list = await call('u-admin', 'getInventoryPurchaseRequisitionEntries', { limit: 1 });
  assert.equal(list.total, 2);
  assert.equal(list.entries.length, 1);
  assert.equal((await call('u-other', 'getInventoryPurchaseRequisitionEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getInventoryPurchaseRequisitionEntries', {})).total, 2);

  assert.equal((await draft([line()], {}, 'u-viewer')).success, false);
  assert.equal((await call('u-viewer', 'submitInventoryPurchaseRequisition', { iprId: b.iprId })).success, false);
  assert.deepEqual(await draft([line()], {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'closeInventoryPurchaseRequisition', { iprId: b.iprId }), { success: false, error: 'You do not have access to that company.' });

  assert.deepEqual(await call('u-admin', 'deleteDraftInventoryPurchaseRequisition', { iprId: b.iprId }), { success: true });
  assert.equal(await val('inventoryPurchaseRequisitions/' + b.iprId), null);
});
