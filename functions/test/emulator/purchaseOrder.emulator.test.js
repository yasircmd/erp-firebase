// PURCHASEORDER through its screen's callables: eligible requisitions,
// draft (requisition-sourced + direct lines), submit (line merge, source
// requisitions closed, approval by Total), reject -> revise -> resubmit,
// close -> reopen (with its own approval), cancel, delete, access. Plus
// the three port fixes: a requisition can't feed two POs, a revision
// can't use a non-positive quantity, and a multi-level reopen keeps its
// ReopenRequested flag until it resolves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, put } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.users['u-approver2'] = { status: 'Active', role: 'Admin', username: 'approver2', fullName: 'Approver Two', AssignedCompanies: ['C1'] };
  f.vendors.V1.DefaultCurrency = 'AED';
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Gone Ltd', Status: 'Inactive', CompanyID: 'C1' };
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.purchaseRequisitions = {
    PRQ1: { PRNumber: 'PR-26-01', Status: 'Submitted', CompanyID: 'C1', CostCenterID: 'CC1', Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 10, Unit: 'box' }] },
    PRQ2: { PRNumber: '', Status: 'Draft', CompanyID: 'C1', CostCenterID: 'CC1', Lines: [] },
    PRQ3: { PRNumber: 'PR-26-03', Status: 'Submitted', CompanyID: 'C2', CostCenterID: 'CC1', Lines: [] }
  };
  f.inventoryPurchaseRequisitions = {
    IPRQ1: { IPRNumber: 'IPR-26-01', Status: 'Submitted', CompanyID: 'C1', CostCenterID: 'CC1', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Description: 'Sheets', EnteredQuantity: 4 }] }
  };
  return f;
}
function gated(f, levels) {
  f.approvalConfigurations = { PURCHASEORDER: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASEORDER: { GLOBAL: { Levels: levels } } };
  return f;
}
const TWO_LEVELS = [
  { LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 },
  { LevelNumber: 2, ApproverUserID: 'u-approver2', ThresholdAmount: 1000 }
];
test.after(async () => { await app.delete(); });

const prLine = (o) => Object.assign({ SourceRequisitionType: 'PR', SourceRequisitionID: 'PRQ1', SourceLineIndex: 0, CategoryID: 'RC1', Description: 'Paper', Quantity: 10, UOM: 'box', UnitPrice: 5 }, o);
const iprLine = (o) => Object.assign({ SourceRequisitionType: 'IPR', SourceRequisitionID: 'IPRQ1', SourceLineIndex: 0, ItemCode: 'RM-001', WarehouseID: 'WH1', Description: 'Sheets', Quantity: 4, UOM: 'UOM-PCS', UnitPrice: 20 }, o);
const directLine = (o) => Object.assign({ CategoryID: 'RC1', Description: 'Paper', Quantity: 2, UOM: 'box', UnitPrice: 8 }, o);
const draft = (lines, extra, uid) => call(uid || 'u-admin', 'saveDraftPurchaseOrder', {
  poData: Object.assign({ PODate: D, CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1', Lines: lines }, extra || {})
});
const po = (id) => val('purchaseOrders/' + id);

test('eligible requisitions: Submitted, this company only', async () => {
  await reset(fixture());
  const r = await call('u-admin', 'getEligibleRequisitionsForPO', { companyId: 'C1' });
  assert.deepEqual(r.pr.map(x => x.RequisitionID), ['PRQ1']);
  assert.deepEqual(r.ipr.map(x => x.RequisitionID), ['IPRQ1']);
  assert.deepEqual(await call('u-admin', 'getEligibleRequisitionsForPO', {}), { pr: [], ipr: [] });
});

test('draft -> submit with no gate: matching lines merge at a weighted price, sources close, straight to Approved', async () => {
  await reset(fixture());
  const s = await draft([prLine(), iprLine(), directLine(), directLine({ CategoryID: '', ItemCode: 'RM-001', Description: 'Bolts', Quantity: 1, UnitPrice: 3 })]);
  assert.equal(s.success, true, s.error);
  let rec = await po(s.poId);
  assert.equal(rec.Status, 'Draft');
  assert.equal(rec.Currency, 'AED', 'currency locked from the vendor');
  assert.equal(rec.Total, 50 + 80 + 16 + 3);
  assert.deepEqual(rec.SourceRequisitions.map(x => [x.RequisitionType, x.RequisitionNumber]).sort(), [['IPR', 'IPR-26-01'], ['PR', 'PR-26-01']]);

  const sub = await call('u-admin', 'submitPurchaseOrder', { poId: s.poId });
  assert.equal(sub.success, true, sub.error);
  assert.equal(sub.status, 'Approved');
  assert.match(sub.poNumber, /PO/);
  rec = await po(s.poId);
  assert.equal(rec.Lines.length, 3, 'the two "RC1|Paper" lines merge');
  const paper = rec.Lines.find(l => l.Description === 'Paper');
  assert.equal(paper.Quantity, 12);
  assert.equal(paper.LineTotal, 66);
  assert.ok(Math.abs(paper.UnitPrice - 5.5) < 1e-9);
  assert.equal(rec.Total, 149);
  assert.deepEqual(rec.Lines.map(l => l.LineID), ['POL-0', 'POL-1', 'POL-2']);
  assert.equal((await val('purchaseRequisitions/PRQ1')).Status, 'Closed');
  assert.equal((await val('inventoryPurchaseRequisitions/IPRQ1')).Status, 'Closed');

  assert.deepEqual(await call('u-admin', 'closePurchaseOrder', { poId: s.poId }), { success: true });
  assert.equal((await po(s.poId)).Status, 'Closed');
  const reopen = await call('u-admin', 'requestReopenPurchaseOrder', { poId: s.poId });
  assert.deepEqual(reopen, { success: true, status: 'Approved' }, 'no gate: reopens straight to Approved');
  assert.equal((await po(s.poId)).ReopenRequested, false);
});

test('PORT FIX: a requisition already taken by another PO (or cancelled, or unknown) blocks submit', async () => {
  await reset(fixture());
  const a = await draft([prLine()]);
  const b = await draft([prLine({ UnitPrice: 6 })]);
  assert.equal((await call('u-admin', 'submitPurchaseOrder', { poId: a.poId })).success, true);
  const second = await call('u-admin', 'submitPurchaseOrder', { poId: b.poId });
  assert.equal(second.success, false);
  assert.match(second.error, /Requisition PR-26-01 is Closed — it may already be on another Purchase Order/);
  assert.equal((await po(b.poId)).Status, 'Draft', 'second PO not submitted');

  // Removing the taken requisition's lines lets it go through as a direct PO.
  assert.equal((await draft([directLine()], { POID: b.poId })).success, true);
  assert.equal((await call('u-admin', 'submitPurchaseOrder', { poId: b.poId })).status, 'Approved');

  const c = await draft([iprLine()]);
  await put('inventoryPurchaseRequisitions/IPRQ1/Status', 'Cancelled');
  assert.match((await call('u-admin', 'submitPurchaseOrder', { poId: c.poId })).error, /IPR-26-01 is Cancelled/);

  const d = await draft([prLine({ SourceRequisitionID: 'NOPE', CategoryID: 'BOGUS' })]);
  assert.equal(d.success, true, 'a sourced line skips the direct-line check at save (as in GAS)');
  assert.match((await call('u-admin', 'submitPurchaseOrder', { poId: d.poId })).error, /Requisition NOPE was not found for this company/);
  const e = await draft([prLine({ SourceRequisitionID: 'PRQ3' })]);
  assert.match((await call('u-admin', 'submitPurchaseOrder', { poId: e.poId })).error, /PR-26-03 was not found for this company/);
});

test('approval by Total: reject -> revise (PORT FIX: quantity must stay positive) -> resubmit needs the higher level', async () => {
  await reset(gated(fixture(), TWO_LEVELS));
  const s = await draft([prLine()]); // Total 50: level 1 only
  const sub = await call('u-admin', 'submitPurchaseOrder', { poId: s.poId });
  assert.equal(sub.status, 'PendingApproval', sub.error);
  assert.equal((await val('purchaseRequisitions/PRQ1')).Status, 'Closed', 'sources close on submit, even pending');
  assert.equal((await val('approvalInstances/' + (await po(s.poId)).ApprovalInstanceID)).RequiredLevels.length, 1);

  const rej = await call('u-approver', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 1, decision: 'Rejected', reason: 'Price too high' });
  assert.equal(rej.status, 'Rejected', rej.error);
  let rec = await po(s.poId);
  assert.equal(rec.Status, 'Rejected');
  assert.equal(rec.RejectionReason, 'Price too high');

  const neg = await call('u-admin', 'reviseAndResubmitPurchaseOrder', { poId: s.poId, updatedLines: [Object.assign({}, rec.Lines[0], { Quantity: -300 })] });
  assert.deepEqual(neg, { success: false, error: 'Every line needs a quantity greater than zero.' });
  assert.match((await call('u-admin', 'reviseAndResubmitPurchaseOrder', { poId: s.poId, updatedLines: [Object.assign({}, rec.Lines[0], { LineID: 'X' })] })).error, /Cannot add or remove lines/);
  assert.match((await call('u-admin', 'reviseAndResubmitPurchaseOrder', { poId: s.poId, updatedLines: [] })).error, /Every original line/);

  const rev = await call('u-admin', 'reviseAndResubmitPurchaseOrder', { poId: s.poId, updatedLines: [Object.assign({}, rec.Lines[0], { Quantity: 250 })] });
  assert.deepEqual(rev, { success: true, status: 'PendingApproval' });
  rec = await po(s.poId);
  assert.equal(rec.Total, 1250);
  assert.equal(rec.RejectionReason, '');
  assert.notEqual(rec.PONumber, sub.poNumber, 'quirk kept from Code.gs: a revision draws a fresh PO number');
  assert.equal((await val('approvalInstances/' + rec.ApprovalInstanceID)).RequiredLevels.length, 2);

  assert.equal((await call('u-approver', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 1, decision: 'Approved', reason: '' })).status, 'Pending');
  assert.equal((await po(s.poId)).Status, 'PendingApproval');
  assert.equal((await call('u-approver2', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 2, decision: 'Approved', reason: '' })).status, 'Approved');
  rec = await po(s.poId);
  assert.equal(rec.Status, 'Approved');
  assert.ok(rec.ApprovedAt);
});

test('PORT FIX: a multi-level reopen keeps ReopenRequested until it resolves; a rejected reopen falls back to Closed', async () => {
  await reset(gated(fixture(), TWO_LEVELS));
  const s = await draft([prLine({ Quantity: 300 })]); // Total 1500: both levels
  await call('u-admin', 'submitPurchaseOrder', { poId: s.poId });
  await call('u-approver', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 1, decision: 'Approved', reason: '' });
  await call('u-approver2', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 2, decision: 'Approved', reason: '' });
  assert.equal((await call('u-admin', 'closePurchaseOrder', { poId: s.poId })).success, true);

  const r = await call('u-admin', 'requestReopenPurchaseOrder', { poId: s.poId });
  assert.deepEqual(r, { success: true, status: 'PendingApproval' });
  assert.equal((await po(s.poId)).ReopenRequested, true);

  const l1 = await call('u-approver', 'decidePurchaseOrderReopenApproval', { poId: s.poId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(l1.status, 'Pending', l1.error);
  assert.equal((await po(s.poId)).ReopenRequested, true, 'still a reopen: level 2 must see the reopen path');

  const l2 = await call('u-approver2', 'decidePurchaseOrderReopenApproval', { poId: s.poId, levelNumber: 2, decision: 'Rejected', reason: 'No' });
  assert.equal(l2.status, 'Rejected', l2.error);
  const rec = await po(s.poId);
  assert.equal(rec.Status, 'Closed', 'a rejected reopen goes back to Closed, not Rejected');
  assert.equal(rec.ReopenRequested, false);

  // And an approved reopen lands on Approved.
  await call('u-admin', 'requestReopenPurchaseOrder', { poId: s.poId });
  await call('u-approver', 'decidePurchaseOrderReopenApproval', { poId: s.poId, levelNumber: 1, decision: 'Approved', reason: '' });
  await call('u-approver2', 'decidePurchaseOrderReopenApproval', { poId: s.poId, levelNumber: 2, decision: 'Approved', reason: '' });
  assert.equal((await po(s.poId)).Status, 'Approved');
  assert.equal((await po(s.poId)).ReopenRequested, false);
});

test('validation, cancel, delete, list and access', async () => {
  await reset(fixture());
  assert.match((await draft([directLine()], { CompanyID: '' })).error, /Select a Company/);
  assert.match((await draft([directLine()], { CostCenterID: '' })).error, /Select a Cost Center/);
  assert.match((await draft([directLine()], { VendorID: '' })).error, /Select a Vendor/);
  assert.match((await draft([directLine()], { VendorID: 'V2' })).error, /inactive Vendor/);
  assert.match((await draft([])).error, /Add at least one line/);
  assert.match((await draft([directLine({ Quantity: 0 })])).error, /Line 1: quantity must be greater than zero/);
  assert.match((await draft([directLine({ CategoryID: '', ItemCode: 'NOPE' })])).error, /Line 1: unknown or inactive item/);
  assert.match((await draft([directLine({ CategoryID: 'NOPE' })])).error, /Line 1: unknown or inactive category/);

  const unpriced = await draft([directLine({ UnitPrice: '' })]);
  assert.equal(unpriced.success, true, 'price may be blank in a draft');
  assert.match((await call('u-admin', 'submitPurchaseOrder', { poId: unpriced.poId })).error, /Unit Price greater than zero/);
  assert.match((await call('u-admin', 'closePurchaseOrder', { poId: unpriced.poId })).error, /Only an Approved/);

  const a = await draft([directLine()]);
  await call('u-admin', 'submitPurchaseOrder', { poId: a.poId });
  assert.match((await draft([directLine()], { POID: a.poId })).error, /Only a Draft Purchase Order can be edited/);
  assert.match((await call('u-admin', 'deleteDraftPurchaseOrder', { poId: a.poId })).error, /Only a Draft/);
  await put('purchaseOrders/' + a.poId + '/Lines/0/ReceivedQuantity', 1);
  assert.match((await call('u-admin', 'cancelPurchaseOrder', { poId: a.poId, reason: 'x' })).error, /goods received against it/);
  await put('purchaseOrders/' + a.poId + '/Lines/0/ReceivedQuantity', 0);
  assert.deepEqual(await call('u-admin', 'cancelPurchaseOrder', { poId: a.poId, reason: ' Vendor withdrew ' }), { success: true });
  const cancelled = await po(a.poId);
  assert.equal(cancelled.Status, 'Cancelled');
  assert.equal(cancelled.CancelReason, 'Vendor withdrew');
  assert.match((await call('u-admin', 'cancelPurchaseOrder', { poId: a.poId })).error, /already cancelled/);

  const list = await call('u-admin', 'getPurchaseOrderEntries', {});
  assert.equal(list.total, 2);
  assert.equal((await call('u-other', 'getPurchaseOrderEntries', { limit: 'all' })).total, 0);
  assert.equal((await call('u-viewer', 'getPurchaseOrderEntries', {})).total, 2);

  assert.equal((await draft([directLine()], {}, 'u-viewer')).success, false);
  assert.equal((await call('u-viewer', 'submitPurchaseOrder', { poId: unpriced.poId })).success, false);
  assert.deepEqual(await draft([directLine()], {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });

  assert.deepEqual(await call('u-admin', 'deleteDraftPurchaseOrder', { poId: unpriced.poId }), { success: true });
  assert.equal(await po(unpriced.poId), null);
});
