// CUSTOMERINVOICE through its screen's callables: eligible Delivery Notes,
// draft (DN + direct lines with Sales Types, discount, tax on the net,
// round off), post (GL: Dr AR / Discount Given, Cr revenue by Sales Type
// / Output Tax, round off by sign; DNs matched), reversal, approval,
// access. Plus the port fixes: DNs re-checked at post, and reversed
// documents / reversal entries left out of both invoice pickers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-DISCG'] = { AccountCode: '5300', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-RND'] = { AccountCode: '6900', AccountName: 'Round Off', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-SVC'] = { AccountCode: '4200', AccountName: 'Service Revenue', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISCG', OutputTaxAccountID: 'A-VATOUT', RoundOffAccountID: 'A-RND' });
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Other', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' }
  };
  f.salesTypes = {
    ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' },
    ST2: { Name: 'Services', GLAccountID: 'A-SVC', Status: 'Active', CompanyID: 'C1' }
  };
  const dn = (n, cust, qty, price, extra) => Object.assign({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: cust,
    TransactionNumber: 'DN-' + n, TransactionDate: D, Description: 'Delivery ' + n,
    Lines: [{ ItemCode: 'RM-001', Quantity: qty, UnitPrice: price, CostCenterID: 'CC1' }] }, extra || {});
  const grn = (n, extra) => Object.assign({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionNumber: 'GRN-' + n,
    Lines: [{ ItemID: 'I1', Quantity: 1, UnitCost: 10 }] }, extra || {});
  f.stock = { transactions: {
    N1: dn(1, 'CU1', 4, 50), N2: dn(2, 'CU1', 1, 20), N3: dn(3, 'CU2', 1, 1),
    NREV: dn(4, 'CU1', 1, 20, { ReversalOfDeliveryNoteID: 'NX' }), NX: dn(5, 'CU1', 1, 20, { ReversedByDeliveryNoteID: 'NREV' }),
    G1: grn(1), GX: grn(2, { ReversedByGRN: 'GREV' }), GREV: grn(3, { ReversalOfGRN: 'GX' })
  } };
  return f;
}
test.after(async () => { await app.delete(); });

const draft = (extra, uid) => call(uid || 'u-admin', 'saveCustomerInvoiceDraft', {
  invoiceData: Object.assign({ InvoiceDate: D, Description: 'Invoice 9', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }], DirectLines: [] }, extra || {})
});
const inv = (id) => val('customerInvoices/' + id);
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId }))
  .Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

test('PORT FIX: pickers leave out reversed documents and reversal entries', async () => {
  await reset(fixture());
  assert.deepEqual((await call('u-admin', 'getEligibleDeliveryNotesForInvoice', { companyId: 'C1', customerId: 'CU1' })).map(d => [d.DeliveryNoteID, d.Amount]),
    [['N1', 200], ['N2', 20]]);
  assert.deepEqual((await call('u-admin', 'getEligibleGRNsForInvoice', { companyId: 'C1', vendorId: 'V1' })).map(g => g.GRNID), ['G1']);
});

test('draft totals, GL shape (revenue by Sales Type), DNs matched', async () => {
  await reset(fixture());
  const s = await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }, { DeliveryNoteID: 'N2', SalesTypeID: 'ST1' }],
    DirectLines: [{ AccountCode: '4200', Amount: 30, Description: 'Installation', SalesTypeID: 'ST2' }],
    Discount: 50, TaxPercent: 5, RoundOff: 0.5 });
  assert.equal(s.success, true, s.error);
  let rec = await inv(s.invoiceId);
  // Subtotal 250, less 50 = 200, tax 10, +0.5.
  assert.deepEqual([rec.Subtotal, rec.TaxAmount, rec.Total], [250, 10, 210.5]);
  const p = await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId });
  assert.equal(p.success, true, p.error);
  rec = await inv(s.invoiceId);
  assert.equal(rec.Status, 'Posted');
  assert.deepEqual(await jvLines(rec.LinkedJVID), [
    ['1200', 210.5, 0], ['2200', 0, 10], ['4000', 0, 220], ['4200', 0, 30], ['5300', 50, 0], ['6900', 0, 0.5]
  ]);
  assert.equal((await val('stock/transactions/N1')).MatchedToInvoiceID, s.invoiceId);
  assert.deepEqual(await call('u-admin', 'getEligibleDeliveryNotesForInvoice', { companyId: 'C1', customerId: 'CU1' }), []);
});

test('PORT FIX: a delivery already invoiced, reversed, or a reversal entry blocks posting', async () => {
  await reset(fixture());
  const a = await draft();
  const b = await draft();
  assert.equal((await call('u-admin', 'postCustomerInvoice', { invoiceId: a.invoiceId })).success, true);
  assert.deepEqual(await call('u-admin', 'postCustomerInvoice', { invoiceId: b.invoiceId }),
    { success: false, error: 'Delivery Note DN-1 has already been invoiced on another Customer Invoice — remove it from this invoice and save again.' });
  assert.equal((await inv(b.invoiceId)).Status, 'Draft');

  const rv = await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'NREV', SalesTypeID: 'ST1' }] });
  assert.equal(rv.success, true, 'save accepts it (as in GAS)');
  assert.match((await call('u-admin', 'postCustomerInvoice', { invoiceId: rv.invoiceId })).error, /DN-4 is no longer a posted, unreversed delivery/);
  const c = await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N2', SalesTypeID: 'ST1' }] });
  await rtdb.ref('stock/transactions/N2/ReversedByDeliveryNoteID').set('NR2');
  assert.match((await call('u-admin', 'postCustomerInvoice', { invoiceId: c.invoiceId })).error, /DN-2 is no longer a posted, unreversed delivery/);
});

test('reversal: mirror GL, DNs unmatched, once only', async () => {
  await reset(fixture());
  const s = await draft();
  await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId });
  const r = await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: s.invoiceId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  const rev = await inv(r.invoiceId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1200', 0, 200], ['4000', 200, 0]]);
  assert.equal((await val('stock/transactions/N1')).MatchedToInvoiceID, '');
  assert.match((await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: s.invoiceId })).error, /already been reversed/);
  assert.match((await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: r.invoiceId })).error, /cannot itself be reversed/);
});

test('approval gate and a failed commit rolled back to Rejected', async () => {
  const f = fixture();
  f.approvalConfigurations = { CUSTOMERINVOICE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { CUSTOMERINVOICE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft();
  assert.deepEqual(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }), { success: true, status: 'PendingApproval' });
  const ok = await call('u-approver', 'decideCustomerInvoiceApproval', { invoiceId: s.invoiceId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
  assert.equal((await inv(s.invoiceId)).Status, 'Posted');

  const t = await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N2', SalesTypeID: 'ST1' }] });
  await call('u-admin', 'postCustomerInvoice', { invoiceId: t.invoiceId });
  await rtdb.ref('salesTypes/ST1/Status').set('Inactive');
  const bad = await call('u-approver', 'decideCustomerInvoiceApproval', { invoiceId: t.invoiceId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.match(bad.error, /Posting failed: .*Sales Type is no longer valid/);
  assert.equal((await inv(t.invoiceId)).Status, 'Rejected');
});

test('validation, delete, list and access', async () => {
  await reset(fixture());
  assert.match((await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N3', SalesTypeID: 'ST1' }] })).error, /different Customer/);
  assert.match((await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: '' }] })).error, /a Sales Type is required/);
  assert.match((await draft({ CostCenterID: '' })).error, /A Cost Center is required/);
  assert.match((await draft({ SourceDeliveryNotes: [] })).error, /at least one Delivery Note or one direct line/);
  assert.match((await draft({ Discount: 999 })).error, /cannot exceed the invoice subtotal/);
  assert.match((await draft({ SourceDeliveryNotes: [{ DeliveryNoteID: 'G1', SalesTypeID: 'ST1' }] })).error, /not found or not Posted/);
  const s = await draft();
  assert.equal((await draft({}, 'u-viewer')).success, false);
  assert.deepEqual(await draft({}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'postCustomerInvoice', { invoiceId: s.invoiceId }), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-other', 'getCustomerInvoiceEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getCustomerInvoiceEntries', {})).total, 1);
  assert.deepEqual((await call('u-admin', 'getActiveSalesTypes', {})).map(t => t.SalesTypeID).sort(), ['ST1', 'ST2']);
  assert.deepEqual(await call('u-admin', 'deleteCustomerInvoiceDraft', { invoiceId: s.invoiceId }), { success: true });
  assert.equal(await inv(s.invoiceId), null);
});
