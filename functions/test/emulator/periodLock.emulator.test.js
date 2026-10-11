// The period lock, Period Closing step 1b (docs/modules/PERIOD_CLOSING.md,
// decisions 123, 130, 132-135): nothing dated in a closed month is posted,
// sent for approval or reversed, from any module — JV / CBT, a stock
// document with its GL entry (GRN), a stock movement with none (Warehouse
// Movement), an Apps Script port (Vendor Invoice and its reversal request),
// Opening Balances; drafts stay free; a closed month's document is reversed
// into an open month; another company is not affected; reopening lifts it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.notEqual(r && r.success, false, r && r.error); return r; };
// The refusal's message, whether the callable throws or answers success: false.
async function refused(p) {
  let r;
  try { r = await p; } catch (e) { return e.message; }
  if (r && r.success === false) return r.error;
  assert.fail('expected a refusal, got ' + JSON.stringify(r));
}
const CLOSED = /2026-03 is closed for Test Co One \(closed through 2026-03\)\. Use a date in an open month, or ask a user with the reopen right in Period Closing to reopen it\./;
const closeThrough = (month, co) => rtdb.ref('periodClosing/' + (co || 'C1') + '/ClosedThrough').set(month);
const jv = async (date, extra) => ok(await call('u-admin', 'saveJournalDraft', { jvData: Object.assign({ JVDate: date, Description: 'Accrual', CompanyID: 'C1',
  Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] }, extra || {}) })).jvId;
const entry = async id => (await firestore.collection('journalEntries').doc(id).get()).data();

function fixture() {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-OBC'] = { AccountCode: '3900', AccountName: 'Opening Balance Clearing', AccountType: 'Equity', Status: 'Active', IsPostable: true };
  f.users['u-other'].AssignedCompanies = ['C2'];
  return f;
}

test('JV: a draft in a closed month saves (132) but does not post; an open month posts; another company is not affected; reopening lifts it', async () => {
  await reset(fixture());
  await closeThrough('2026-03');
  const march = await jv('2026-03-20'); // decision 132: saved
  const msg = await refused(call('u-admin', 'postJournalEntry', { jvId: march }));
  assert.match(msg, CLOSED);
  assert.equal((await entry(march)).Status, 'Draft');
  ok(await call('u-admin', 'saveJournalDraft', { jvData: { jvId: march, JVID: march, JVDate: '2026-03-21', Description: 'Accrual, edited', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 41, Description: 'a' }, { AccountCode: '1100', Credit: 41, Description: 'b' }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: await jv('2026-04-01') }));
  // Another company's March is open.
  const c2 = ok(await call('u-other', 'saveJournalDraft', { jvData: { JVDate: '2026-03-20', Description: 'C2', CompanyID: 'C2',
    Lines: [{ AccountCode: '1000', Debit: 5, Description: 'a' }, { AccountCode: '1100', Credit: 5, Description: 'b' }] } })).jvId;
  ok(await call('u-other', 'postJournalEntry', { jvId: c2 }));
  // Reopened (Period Closing sets ClosedThrough back): it posts.
  await closeThrough('2026-02');
  ok(await call('u-admin', 'postJournalEntry', { jvId: march }));
  assert.equal((await entry(march)).Status, 'Posted');
});

test('JV reversal (130): a closed month\'s entry reverses into an open month; a reversal dated in a closed month is refused', async () => {
  await reset(fixture());
  const feb = await jv('2026-02-10');
  ok(await call('u-admin', 'postJournalEntry', { jvId: feb }));
  await closeThrough('2026-03');
  assert.match(await refused(call('u-admin', 'reverseJournalEntry', { jvId: feb, reversalDate: '2026-03-31' })), CLOSED);
  assert.equal((await entry(feb)).ReversedByJV, '');
  const r = ok(await call('u-admin', 'reverseJournalEntry', { jvId: feb, reversalDate: '2026-04-02' }));
  const original = await entry(feb), reversal = await entry(r.jvId);
  assert.deepEqual([original.ReversedByJV, original.JVDate, original.Status, reversal.JVDate, reversal.ReversalOfJV], [r.jvId, '2026-02-10', 'Posted', '2026-04-02', feb]);
});

test('JV approval: a month closed while an entry waits; the final approval is refused, rejecting still works', async () => {
  const f = fixture();
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const id = await jv('2026-03-05');
  assert.equal(ok(await call('u-admin', 'postJournalEntry', { jvId: id })).status, 'PendingApproval');
  await closeThrough('2026-03');
  assert.match(await refused(call('u-approver', 'decideJournalEntryApproval', { jvId: id, levelNumber: 1, decision: 'Approved', reason: '' })), CLOSED);
  assert.equal((await entry(id)).Status, 'PendingApproval');
  ok(await call('u-approver', 'decideJournalEntryApproval', { jvId: id, levelNumber: 1, decision: 'Rejected', reason: 'Re-date it' }));
  assert.equal((await entry(id)).Status, 'Rejected');
  // Sending a closed month's document for approval is refused too (132).
  assert.match(await refused(call('u-admin', 'postJournalEntry', { jvId: id })), CLOSED);
});

test('GRN (stock with GL) and Warehouse Movement (stock only): not posted into a closed month, stock untouched; reversal into an open month', async () => {
  await reset(fixture());
  const grn = async date => ok(await call('u-admin', 'saveGrnDraft', { TransactionDate: date, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 10, UnitCost: 5, Description: 'x' }] })).grnId;
  const feb = await grn('2026-02-03');
  ok(await call('u-admin', 'postGrn', { grnId: feb }));
  await closeThrough('2026-03');
  const march = await grn('2026-03-15');
  assert.match(await refused(call('u-admin', 'postGrn', { grnId: march })), CLOSED);
  assert.equal((await val('stock/transactions/' + march)).Status, 'Draft');
  assert.equal((await val('stock/ledger/I1/WH1')).Quantity, 10);
  assert.match(await refused(call('u-admin', 'reverseGrn', { grnId: feb, reversalDate: '2026-03-20' })), CLOSED);
  assert.equal((await val('stock/transactions/' + feb)).ReversedByGRN || '', '');

  const move = async date => ok(await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: date, Description: 'To site', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, Description: 'Transfer' }] })).moveId;
  const m = await move('2026-03-31');
  assert.match(await refused(call('u-admin', 'postWarehouseMovement', { moveId: m })), CLOSED);
  assert.equal((await val('stock/transactions/' + m)).Status, 'Draft');
  assert.equal((await val('stock/ledger/I1/WH2')), null);
  ok(await call('u-admin', 'postWarehouseMovement', { moveId: await move('2026-04-01') }));
  assert.equal((await val('stock/ledger/I1/WH2')).Quantity, 2);

  // 2 of the 10 moved to WH2: reverse needs them back; move back first in April.
  ok(await call('u-admin', 'postWarehouseMovement', { moveId: ok(await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: '2026-04-02', Description: 'Back', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH2', ToWarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, Description: 'Back' }] })).moveId }));
  const r = ok(await call('u-admin', 'reverseGrn', { grnId: feb, reversalDate: '2026-04-05' }));
  assert.equal((await val('stock/transactions/' + feb)).ReversedByGRN, r.grnId);
  assert.equal((await val('stock/transactions/' + r.grnId)).TransactionDate, '2026-04-05');
});

test('Vendor Invoice (an Apps Script port): not posted into a closed month; its reversal request checks its own date', async () => {
  await reset(fixture());
  const bill = async date => ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: date, Description: 'Bill', VendorRefNumber: 'B-' + date, CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: 100, Description: 'Freight', CostCenterID: 'CC1' }] } })).invoiceId;
  const feb = await bill('2026-02-01');
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: feb }));
  await closeThrough('2026-03');
  const march = await bill('2026-03-01');
  assert.match(await refused(call('u-admin', 'postVendorInvoice', { invoiceId: march })), CLOSED);
  assert.equal((await val('vendorInvoices/' + march)).Status, 'Draft');
  assert.match(await refused(call('u-admin', 'requestReverseVendorInvoice', { invoiceId: feb, reversalDate: '2026-03-31' })), CLOSED);
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: feb, reversalDate: '2026-04-01' }));
  assert.ok((await val('vendorInvoices/' + feb)).ReversedByInvoiceID);
});

test('Opening Balances: its reversal, dated as the original, is refused while that month is closed', async () => {
  await reset(fixture());
  ok(await call('u-admin', 'saveOpeningBalanceSettings', { companyId: 'C1', openingDate: '2025-12-31', clearingAccountId: 'A-OBC' }));
  const posted = ok(await call('u-admin', 'postOpeningBalances', { kind: 'GL', companyId: 'C1',
    text: ['Account\tDebit\tCredit\tDescription\tCost Center\tProfit Center', '1000\t500\t\tCash\t\t'].join('\n') }));
  await closeThrough('2026-01');
  assert.match(await refused(call('u-admin', 'reverseOpeningBalanceBatch', { batchId: posted.batchId })), /Opening balances: 2025-12 is closed for Test Co One/);
  await closeThrough('2025-11');
  ok(await call('u-admin', 'reverseOpeningBalanceBatch', { batchId: posted.batchId }));
});

test('sending for approval (132): a GRN needing approval, dated in a closed month, is not sent; in an open month it is', async () => {
  const f = fixture();
  f.approvalConfigurations = { GRN: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { GRN: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  await closeThrough('2026-03');
  const grn = async date => ok(await call('u-admin', 'saveGrnDraft', { TransactionDate: date, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, UnitCost: 5, Description: 'x' }] })).grnId;
  const march = await grn('2026-03-10');
  assert.match(await refused(call('u-admin', 'postGrn', { grnId: march })), CLOSED);
  assert.equal((await val('stock/transactions/' + march)).Status, 'Draft');
  assert.equal(await val('approvalInstances'), null);
  const april = await grn('2026-04-10');
  ok(await call('u-admin', 'postGrn', { grnId: april }));
  assert.equal((await val('stock/transactions/' + april)).Status, 'PendingApproval');
});

test('reversals that skip the approval step: a Warehouse Movement reversed into a closed month is refused; an invoice reversal needing approval is refused before it is sent', async () => {
  const f = fixture();
  f.approvalConfigurations = { VENDORINVOICE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { VENDORINVOICE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  ok(await call('u-admin', 'postGrn', { grnId: ok(await call('u-admin', 'saveGrnDraft', { TransactionDate: '2026-02-01', Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 5, UnitCost: 5, Description: 'x' }] })).grnId }));
  const m = ok(await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: '2026-02-02', Description: 'To site', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, Description: 'Transfer' }] })).moveId;
  ok(await call('u-admin', 'postWarehouseMovement', { moveId: m }));
  // A bill posted in February (its approval given), before the close.
  const inv = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: '2026-02-03', Description: 'Bill', VendorRefNumber: 'B-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: 100, Description: 'Freight', CostCenterID: 'CC1' }] } })).invoiceId;
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: inv }));
  const instance = Object.keys(await val('approvalInstances'))[0];
  ok(await call('u-approver', 'decideVendorInvoiceApproval', { invoiceId: inv, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.equal((await val('vendorInvoices/' + inv)).Status, 'Posted', instance);
  await closeThrough('2026-03');

  assert.match(await refused(call('u-admin', 'reverseWarehouseMovement', { moveId: m, reversalDate: '2026-03-15' })), CLOSED);
  assert.equal((await val('stock/ledger/I1/WH2')).Quantity, 2);
  ok(await call('u-admin', 'reverseWarehouseMovement', { moveId: m, reversalDate: '2026-04-15' }));
  assert.equal((await val('stock/ledger/I1/WH2')).Quantity, 0);

  const before = Object.keys(await val('approvalInstances')).length;
  assert.match(await refused(call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv, reversalDate: '2026-03-31' })), CLOSED);
  assert.equal(Object.keys(await val('approvalInstances')).length, before, 'not sent for approval');
  assert.equal((await val('vendorInvoices/' + inv)).Status, 'Posted');
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv, reversalDate: '2026-04-01' }));
  assert.equal(Object.keys(await val('approvalInstances')).length, before + 1);
});
