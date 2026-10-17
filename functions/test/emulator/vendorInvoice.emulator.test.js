// VENDORINVOICE through its screen's callables: eligible GRNs, draft
// (GRN + direct lines, discount, tax on the net, round off), post (GL:
// Dr GRN Clearing / direct accounts / Input Tax, Cr Discount / AP,
// round off by sign; GRNs marked matched), approval (and the rollback to
// Rejected when the commit fails), reversal with its own approval, and
// access. Plus the port fix: GRNs are re-checked at post.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, put } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-DISC'] = { AccountCode: '4100', AccountName: 'Discount Received', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.coa['A-RND'] = { AccountCode: '6900', AccountName: 'Round Off', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountReceivedAccountID: 'A-DISC', InputTaxAccountID: 'A-VATIN', RoundOffAccountID: 'A-RND' });
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Other Vendor', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP' };
  const grn = (n, vendor, qty, cost) => ({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: vendor, TransactionNumber: 'GRN-' + n,
    TransactionDate: D, Description: 'Receipt ' + n, Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', Direction: 'In', Quantity: qty, UnitCost: cost }] });
  f.stock = { transactions: { G1: grn(1, 'V1', 10, 20), G2: grn(2, 'V1', 5, 10), G3: grn(3, 'V2', 1, 1) } };
  return f;
}
test.after(async () => { await app.delete(); });

const draft = (extra, uid) => call(uid || 'u-admin', 'saveVendorInvoiceDraft', {
  invoiceData: Object.assign({ InvoiceDate: D, Description: 'Invoice 77', VendorRefNumber: 'ACME-77', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [{ GRNID: 'G1' }], DirectLines: [] }, extra || {})
});
const inv = (id) => val('vendorInvoices/' + id);
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId }))
  .Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

test('draft totals, post GL shape, GRN matched and dropped from the picker', async () => {
  await reset(fixture());
  assert.deepEqual((await call('u-admin', 'getEligibleGRNsForInvoice', { companyId: 'C1', vendorId: 'V1' })).map(g => [g.GRNID, g.Amount]), [['G1', 200], ['G2', 50]]);
  const s = await draft({ SourceGRNs: [{ GRNID: 'G1' }, { GRNID: 'G2' }],
    DirectLines: [{ AccountCode: '6100', Amount: 30, Description: 'Freight', CostCenterID: 'CC1' }, { AccountCode: '' }],
    Discount: 80, TaxPercent: 5, RoundOff: -0.5 });
  assert.equal(s.success, true, s.error);
  let rec = await inv(s.invoiceId);
  // Subtotal 280, less discount 80 = 200, tax 5% on the net = 10, round off -0.5.
  assert.deepEqual([rec.Subtotal, rec.TaxAmount, rec.Total, rec.DirectLines.length], [280, 10, 209.5, 1]);

  const p = await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });
  assert.equal(p.success, true, p.error);
  assert.equal(p.status, 'Posted');
  rec = await inv(s.invoiceId);
  assert.equal(rec.Status, 'Posted');
  assert.deepEqual(await jvLines(rec.LinkedJVID), [
    ['1400', 10, 0], ['2000', 0, 209.5], ['2100', 250, 0], ['4100', 0, 80], ['6100', 30, 0], ['6900', 0, 0.5]
  ]);
  assert.equal((await val('stock/transactions/G1')).MatchedToInvoiceID, s.invoiceId);
  assert.equal((await val('stock/transactions/G2')).MatchedToInvoiceID, s.invoiceId);
  assert.deepEqual(await call('u-admin', 'getEligibleGRNsForInvoice', { companyId: 'C1', vendorId: 'V1' }), []);
  assert.match((await draft()).error, /already matched to a different invoice/);
  assert.match((await draft({ VendorInvoiceID: s.invoiceId })).error, /Only draft or rejected invoices can be edited/);
});

test('PORT FIX: a GRN taken by another invoice (or reversed) since the draft was saved blocks posting', async () => {
  await reset(fixture());
  const a = await draft();
  const b = await draft();
  assert.equal(b.success, true, 'both drafts saved while G1 was unmatched');
  assert.equal((await call('u-admin', 'postVendorInvoice', { invoiceId: a.invoiceId })).success, true);
  const pb = await call('u-admin', 'postVendorInvoice', { invoiceId: b.invoiceId });
  assert.deepEqual(pb, { success: false, error: 'GRN GRN-1 has already been invoiced on another Vendor Invoice — remove it from this invoice and save again.' });
  assert.equal((await inv(b.invoiceId)).Status, 'Draft');
  assert.equal((await val('stock/transactions/G1')).MatchedToInvoiceID, a.invoiceId, 'still matched to the first invoice');

  const c = await draft({ SourceGRNs: [{ GRNID: 'G2' }] });
  await put('stock/transactions/G2/ReversedByGRN', 'GRNR-X');
  assert.match((await call('u-admin', 'postVendorInvoice', { invoiceId: c.invoiceId })).error, /GRN GRN-2 is no longer a posted, unreversed GRN/);
});

test('reversal: mirror GL, GRNs unmatched, once only, never of a reversal', async () => {
  await reset(fixture());
  const s = await draft({ TaxPercent: 5 });
  await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });
  const r = await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  const rev = await inv(r.invoiceId);
  assert.equal(rev.Status, 'Posted');
  assert.equal(rev.ReversalOfInvoiceID, s.invoiceId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1400', 0, 10], ['2000', 210, 0], ['2100', 0, 200]]);
  assert.equal((await inv(s.invoiceId)).ReversedByInvoiceID, r.invoiceId);
  assert.equal((await val('stock/transactions/G1')).MatchedToInvoiceID, '');
  assert.match((await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId })).error, /already been reversed/);
  assert.match((await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: r.invoiceId })).error, /reversal entry cannot itself be reversed/);
  // The GRN can be invoiced again.
  const again = await draft();
  assert.equal((await call('u-admin', 'postVendorInvoice', { invoiceId: again.invoiceId })).success, true);
});

test('approval: post and reversal gated; a failed commit on approval returns the invoice to Rejected', async () => {
  const f = fixture();
  f.approvalConfigurations = { VENDORINVOICE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { VENDORINVOICE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft();
  assert.deepEqual(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }), { success: true, status: 'PendingApproval' });
  assert.equal((await val('stock/transactions/G1')).MatchedToInvoiceID, undefined, 'nothing matched before approval');
  const ok = await call('u-approver', 'decideVendorInvoiceApproval', { invoiceId: s.invoiceId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
  assert.equal((await inv(s.invoiceId)).Status, 'Posted');

  const rr = await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D });
  assert.deepEqual(rr, { success: true, status: 'PendingReversalApproval' });
  const no = await call('u-approver', 'decideVendorInvoiceReversalApproval', { invoiceId: s.invoiceId, levelNumber: 1, decision: 'Rejected', reason: 'Keep it' });
  assert.equal(no.status, 'Rejected', no.error);
  let rec = await inv(s.invoiceId);
  assert.equal(rec.Status, 'Posted');
  assert.equal(rec.ReversalRejectionReason, 'Keep it');
  await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D });
  const yes = await call('u-approver', 'decideVendorInvoiceReversalApproval', { invoiceId: s.invoiceId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(yes.status, 'Approved', yes.error);
  rec = await inv(s.invoiceId);
  assert.equal(rec.Status, 'Posted');
  assert.ok(rec.ReversedByInvoiceID);

  // Commit fails at approval time (company lost its Input Tax account): back to Rejected, editable.
  const t = await draft({ SourceGRNs: [{ GRNID: 'G2' }], TaxPercent: 5 });
  await call('u-admin', 'postVendorInvoice', { invoiceId: t.invoiceId });
  await rtdb.ref('companies/C1/InputTaxAccountID').remove();
  const bad = await call('u-approver', 'decideVendorInvoiceApproval', { invoiceId: t.invoiceId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Posting failed: This company has no Input Tax Account configured/);
  rec = await inv(t.invoiceId);
  assert.equal(rec.Status, 'Rejected');
  assert.equal((await val('approvalInstances/' + rec.ApprovalInstanceID)).Status, 'Pending');
});

test('validation, delete, list and access', async () => {
  await reset(fixture());
  assert.match((await draft({ VendorRefNumber: '' })).error, /Vendor's own invoice number is required/);
  assert.match((await draft({ SourceGRNs: [{ GRNID: 'G3' }] })).error, /different Vendor/);
  assert.match((await draft({ SourceGRNs: [{ GRNID: 'NOPE' }] })).error, /not found or not Posted/);
  assert.match((await draft({ SourceGRNs: [] })).error, /at least one GRN or one direct line/);
  assert.match((await draft({ Discount: 500 })).error, /cannot exceed the invoice subtotal/);
  assert.match((await draft({ Discount: -1 })).error, /Discount cannot be negative/);
  assert.match((await draft({ DirectLines: [{ AccountCode: '9999', Amount: 5, Description: 'x' }] })).error, /unknown or non-postable account/);
  assert.match((await draft({ DirectLines: [{ AccountCode: '6100', Amount: 0, Description: 'x' }] })).error, /amount must be greater than zero/);

  const s = await draft();
  assert.equal((await draft({}, 'u-viewer')).success, false);
  assert.deepEqual(await draft({}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-viewer', 'postVendorInvoice', { invoiceId: s.invoiceId })).success, false);
  assert.deepEqual(await call('u-other', 'postVendorInvoice', { invoiceId: s.invoiceId }), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-other', 'getVendorInvoiceEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getVendorInvoiceEntries', {})).total, 1);
  assert.deepEqual(await call('u-admin', 'deleteVendorInvoiceDraft', { invoiceId: s.invoiceId }), { success: true });
  assert.equal(await inv(s.invoiceId), null);
});
