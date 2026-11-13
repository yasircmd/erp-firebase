// The audit log, step 1 (owner, 2026-11-13; docs/modules/AUDIT_LOG.md,
// Q508-Q509, QA1, QA4): every request that changes something is recorded
// with who, when, the function, the module and the record; a document's
// creation and status change are recorded with its number and total;
// refusals for rights are recorded as refused; reads and failed
// validations are not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, today } = require('./_helpers');

test.after(async () => { await app.delete(); });
const entries = async () => (await firestore.collection('auditLog').get()).docs.map(d => d.data()).sort((a, b) => a.At.localeCompare(b.At));
const line = { ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 5, UnitCost: 4, Description: 'Steel', CostCenterID: 'CC1' };

test('a GRN saved then posted: the save, the post and the document\'s Draft → Posted, by the user, with its number and total', async () => {
  await reset(baseFixture());
  const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1', Lines: [line] });
  assert.equal(s.success, true, s.error);
  await call('u-admin', 'postGrn', { grnId: s.grnId });
  const e = await entries();
  const actions = e.filter(x => x.Function).map(x => [x.Action, x.Function, x.ModuleID, x.RecordID, x.UserID, x.Outcome]);
  assert.deepEqual(actions, [['save', 'saveGrnDraft', 'GRN', s.grnId, 'u-admin', 'done'], ['post', 'postGrn', 'GRN', s.grnId, 'u-admin', 'done']]);
  assert.equal(e.find(x => x.Function === 'saveGrnDraft').UserName, 'Admin User');
  assert.equal(e.find(x => x.Function === 'saveGrnDraft').CompanyID, 'C1');
  const docs = e.filter(x => !x.Function && x.RecordID === s.grnId).map(x => [x.Action, x.Totals.Status]);
  assert.deepEqual(docs, [['create', ' → Draft'], ['status', 'Draft → Posted']]);
  const posted = e.find(x => !x.Function && x.Action === 'status' && x.RecordID === s.grnId);
  assert.match(posted.RecordLabel, /GRN/);
  assert.equal(posted.UserID, 'u-admin');
});

test('reads and failed validations are not recorded; a refusal for rights is, as refused (QA1, QA4)', async () => {
  await reset(baseFixture());
  await call('u-admin', 'getActiveCompanies', {});
  await call('u-admin', 'getGrnEntries', {}).catch(() => {});
  const bad = await call('u-admin', 'saveGrnDraft', { TransactionDate: '', Description: 'x', CompanyID: 'C1', VendorID: 'V1', Lines: [line] }).catch(e => ({ error: e.message }));
  assert.ok(bad.error, 'refused for a missing date');
  assert.deepEqual(await entries(), [], 'nothing recorded');
  const no = await call('u-viewer', 'saveGrnDraft', { TransactionDate: today, Description: 'x', CompanyID: 'C1', VendorID: 'V1', Lines: [line] }).catch(e => ({ error: e.message }));
  assert.ok(no.error || no.success === false, 'the viewer may not');
  const e = await entries();
  assert.deepEqual(e.map(x => [x.Action, x.Function, x.UserID, x.Outcome]), [['save', 'saveGrnDraft', 'u-viewer', 'refused']]);
  assert.match(e[0].Totals.Reason, /permission|access/i);
});

test('an approval decided: approve or reject, by the approver, on the document', async () => {
  const f = baseFixture();
  f.vendors.V1.DefaultCurrency = 'AED';
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.approvalConfigurations = { PURCHASEORDER: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASEORDER: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: today, CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 10, UOM: 'box', UnitPrice: 5 }] } });
  await call('u-admin', 'submitPurchaseOrder', { poId: s.poId });
  await call('u-approver', 'decidePurchaseOrderApproval', { poId: s.poId, levelNumber: 1, decision: 'Rejected', reason: 'Price too high' });
  const e = (await entries()).filter(x => x.Function);
  assert.deepEqual(e.map(x => [x.Action, x.Function, x.UserID, x.RecordID]), [
    ['save', 'saveDraftPurchaseOrder', 'u-admin', s.poId], ['submit', 'submitPurchaseOrder', 'u-admin', s.poId],
    ['reject', 'decidePurchaseOrderApproval', 'u-approver', s.poId]]);
});
