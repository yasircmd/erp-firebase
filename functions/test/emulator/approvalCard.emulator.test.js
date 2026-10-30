// The approval card on a phone (docs/modules/PHONE_VIEW.md, Q336): a
// Purchase Order waiting on its approver. getApprovalSummary gives the
// approver the document in short (number, vendor, amount, lines, who
// submitted, the levels) and the module's own decide function; anyone else
// is refused. Deciding through that function, as the card does (the ported
// module's positional arguments), approves the PO; the card then refuses,
// it has been decided.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);

test('the approver\'s card: the PO in short and its decide function; deciding through it approves; others refused', async () => {
  const f = baseFixture();
  f.vendors.V1.DefaultCurrency = 'AED';
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.approvalConfigurations = { PURCHASEORDER: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASEORDER: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: '2026-10-20', CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 10, UOM: 'box', UnitPrice: 5 }, { CategoryID: 'RC1', Description: 'Pens', Quantity: 4, UOM: 'box', UnitPrice: 2.5 }] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await call('u-admin', 'submitPurchaseOrder', { poId: s.poId })).status, 'PendingApproval');
  const instanceId = (await val('purchaseOrders/' + s.poId)).ApprovalInstanceID;
  // Home lists it for the approver, with the id the card asks for.
  assert.ok((await call('u-approver', 'getPendingApprovalsForUser', {})).some(x => x.InstanceID === instanceId));

  const c = await call('u-approver', 'getApprovalSummary', { instanceId });
  assert.deepEqual([c.ModuleID, c.DocumentID, c.Date, c.Party, c.Amount, c.Currency, c.Description, c.SubmittedBy, c.MyLevel],
    ['PURCHASEORDER', s.poId, '2026-10-20', 'Acme Metals', 60, 'AED', '', 'Admin User', 1]);
  assert.deepEqual(c.Lines.map(l => [l.Text, l.Quantity, l.Amount]), [['Paper', 10, 50], ['Pens', 4, 10]]);
  assert.deepEqual(c.Levels, [{ LevelNumber: 1, Approver: 'Approver' }]);
  assert.deepEqual(c.Decide, { fn: 'decidePurchaseOrderApproval', id: '', positional: true });

  assert.match(await err(call('u-admin', 'getApprovalSummary', { instanceId })), /not waiting on you/);
  assert.match(await err(call('u-approver', 'getApprovalSummary', { instanceId: 'APR-NOPE' })), /Approval record not found/);

  // As the card calls it.
  const d = await call('u-approver', c.Decide.fn, { __positional: [c.DocumentID, c.MyLevel, 'Approved', ''] });
  assert.equal(d.status, 'Approved', d.error);
  assert.equal((await val('purchaseOrders/' + s.poId)).Status, 'Approved');
  assert.match(await err(call('u-approver', 'getApprovalSummary', { instanceId })), /already been approved/);
});
