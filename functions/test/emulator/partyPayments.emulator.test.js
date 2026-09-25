// Party tagging and bill-wise allocation on JV/CBT lines
// (docs/modules/PARTY_PAYMENTS.md): vendor payments and customer receipts
// through CBT against posted invoices, advances as New Refs settled by a
// JV, write-offs, the tagging rules, the outstanding re-check at post and
// at final approval, reversal releasing allocations (and its guards), the
// invoice reversal guard, and the invoice lists' Outstanding column.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-WO'] = { AccountCode: '6800', AccountName: 'Bad Debts / Write-off', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-AP2'] = { AccountCode: '2010', AccountName: 'Trade Payables - Foreign', AccountType: 'Liability', Status: 'Active', IsPostable: true };
  f.vendors.V1.PaymentTermsDays = 30;
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Foreign Vendor', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP2', PaymentTermsDays: 0 };
  f.vendors.V9 = { VendorCode: 'V009', VendorName: 'C2 Vendor', Status: 'Active', CompanyID: 'C2', TradePayablesAccountID: 'A-AP' };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 15 }
  };
  // Customer invoices seeded as already posted (their own posting flow is
  // covered by the customerInvoice suite).
  f.customerInvoices = {
    CI1: { TransactionType: 'CustomerInvoice', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'CINV-26-01-000001',
      InvoiceDate: '2026-09-01', Description: 'Sale 1', Total: 500, CreatedAt: '2026-09-01T00:00:00Z' },
    CIREV: { TransactionType: 'CustomerInvoice', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'CINV-26-01-000002',
      InvoiceDate: '2026-09-02', Description: 'Reversal', Total: 70, ReversalOfInvoiceID: 'CIX', CreatedAt: '2026-09-02T00:00:00Z' }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const doc = async (id) => (await firestore.collection('journalEntries').doc(id).get()).data();
const ok = (r) => { assert.equal(r.success, true, r.error); return r; };

// A posted vendor invoice with one direct line, through its real flow.
async function vendorInvoice(total, vendor) {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: '2026-09-01', Description: 'Bill ' + total, VendorRefNumber: 'B' + total, CompanyID: 'C1', VendorID: vendor || 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: total, Description: 'Freight', CostCenterID: 'CC1' }] } }));
  const p = ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  return { id: s.invoiceId, ref: 'VendorInvoice:' + s.invoiceId, number: p.invoiceNumber };
}

const payable = (amount, allocations, o) => Object.assign({ AccountCode: '2000', Amount: amount, Description: 'Payment', PartyType: 'Vendor', PartyID: 'V1', Allocations: allocations }, o);
const cbt = (type, ledger, lines, extra) => call('u-admin', 'saveCbtDraft', {
  cbtData: Object.assign({ VoucherType: type, SelectedAccountCode: ledger, JVDate: D, Description: 'Voucher', CompanyID: 'C1', CostCenterID: 'CC1', OppositeLines: lines }, extra || {})
});
const jv = (lines, extra) => call('u-admin', 'saveJournalDraft', {
  jvData: Object.assign({ JVDate: D, Description: 'Adjustment', CompanyID: 'C1', CurrencyCode: 'AED', Lines: lines }, extra || {})
});
const post = (jvId, uid) => call(uid || 'u-admin', 'postJournalEntry', { jvId });
const openItems = async (partyType, partyId) => (await call('u-admin', 'getPartyOpenItems', { partyType, partyId, companyId: 'C1' }))
  .map(i => [i.Number, i.Side, i.Amount, i.Outstanding]);
const against = (ref, amount) => ({ RefType: 'Against', RefID: ref, Amount: amount });

test('vendor payment through CBT settles bills; invoice list shows outstanding and status', async () => {
  await reset(fixture());
  const b1 = await vendorInvoice(1000);
  const b2 = await vendorInvoice(400);
  assert.deepEqual(await openItems('Vendor', 'V1'), [[b1.number, 'Cr', 1000, 1000], [b2.number, 'Cr', 400, 400]]);

  const s = ok(await cbt('Bank Payment', '1100', [payable(1200, [against(b1.ref, 1000), against(b2.ref, 200)])]));
  const p = ok(await post(s.jvId));
  assert.equal(p.status, 'Posted');
  const rec = await doc(s.jvId);
  assert.deepEqual(rec.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']), [['1100', 0, 1200, ''], ['2000', 1200, 0, 'V1']]);
  assert.equal(rec.Lines[1].PartyName, 'Acme Metals');
  assert.deepEqual(rec.Lines[1].Allocations.map(a => [a.RefType, a.RefNumber, a.Amount]), [['Against', b1.number, 1000], ['Against', b2.number, 200]]);
  assert.deepEqual([rec.PartyKeys, rec.AllocatedRefs.sort(), rec.AllocatedRefTypes], [['Vendor:V1'], [b1.ref, b2.ref].sort(), ['VendorInvoice']]);
  assert.equal(rec.Lines[0].PartyType, undefined, 'untagged lines keep their old shape');

  assert.deepEqual(await openItems('Vendor', 'V1'), [[b2.number, 'Cr', 400, 200]]);
  const list = (await call('u-admin', 'getVendorInvoiceEntries', { limit: 'all' })).entries;
  const byId = Object.fromEntries(list.map(i => [i.VendorInvoiceID, i]));
  assert.deepEqual([byId[b1.id].Outstanding, byId[b1.id].PaymentStatus, byId[b1.id].DueDate], [0, 'Paid', '2026-10-01']);
  assert.deepEqual([byId[b2.id].Outstanding, byId[b2.id].PaymentStatus], [200, 'Partly paid']);
});

test('tagging rules: party required on control accounts, own account only, allocations must fit', async () => {
  await reset(fixture());
  const b1 = await vendorInvoice(300);
  const e = async (lines) => (await cbt('Bank Payment', '1100', lines)).error;
  assert.match(await e([{ AccountCode: '2000', Amount: 50, Description: 'x' }]), /Line 2: account 2000 is a vendor or customer control account — select the Vendor or Customer/);
  assert.match(await e([payable(50, undefined, { AccountCode: '6100', CostCenterID: 'CC1' })]), /must be on Acme Metals's own Trade Payables account, not 6100/);
  assert.match(await e([payable(50, undefined, { PartyID: 'V2' })]), /Foreign Vendor's own Trade Payables account, not 2000/);
  assert.match(await e([payable(50, undefined, { PartyType: 'Customer', PartyID: 'CU1' })]), /Retail Co's own Trade Receivables account/);
  assert.match(await e([payable(50, undefined, { PartyID: 'V9' })]), /C2 Vendor belongs to a different company/);
  assert.match(await e([payable(50, undefined, { PartyID: 'NOPE' })]), /Vendor not found/);
  assert.match(await e([payable(50, [against(b1.ref, 30)])]), /allocations total 30.00 but the line is 50.00/);
  assert.match(await e([payable(50, [{ RefType: 'New', Amount: 20 }, { RefType: 'New', Amount: 30 }])]), /only one New Ref per line/);
  assert.match(await e([payable(350, [against(b1.ref, 350)])]), /has only 300.00 outstanding/);
  assert.match(await e([payable(50, [against('VendorInvoice:NOPE', 50)])]), /not an open item of Acme Metals/);
  assert.match(await e([payable(50, [against(b1.ref, 0), { RefType: 'New', Amount: 50 }])]), /greater than zero/);
  // Two lines of one entry together over-allocating one bill.
  assert.match(await e([payable(200, [against(b1.ref, 200)]), payable(200, [against(b1.ref, 200)])]), /Line 3: .* has only 300.00 outstanding \(this entry allocates 400.00 to it in total\)/);
  // A receipt (credit to payables) can't settle a bill, which is itself a credit.
  assert.match((await cbt('Bank Receipt', '1100', [payable(50, [against(b1.ref, 50)])])).error, /is a credit item — only a debit line can settle it/);

  // No allocations given: the whole line becomes one New Ref (an advance).
  const adv = ok(await cbt('Bank Payment', '1100', [payable(75)]));
  assert.deepEqual((await doc(adv.jvId)).Lines[1].Allocations, [{ RefType: 'New', RefID: '', Amount: 75 }]);
  assert.deepEqual((await doc(adv.jvId)).AllocatedRefs, []);
});

test('advance as a New Ref, settled against a later bill by a JV; reversal guards', async () => {
  await reset(fixture());
  const adv = ok(await cbt('Bank Payment', '1100', [payable(300)]));
  const advPost = ok(await post(adv.jvId));
  const advRef = 'NewRef:' + adv.jvId + ':2';
  assert.deepEqual(await openItems('Vendor', 'V1'), [[advPost.jvNumber, 'Dr', 300, 300]]);

  const bill = await vendorInvoice(1000);
  const settle = ok(await jv([
    { AccountCode: '2000', Debit: 300, Credit: 0, Description: 'Advance adjusted', PartyType: 'Vendor', PartyID: 'V1', Allocations: [against(bill.ref, 300)] },
    { AccountCode: '2000', Debit: 0, Credit: 300, Description: 'Advance adjusted', PartyType: 'Vendor', PartyID: 'V1', Allocations: [against(advRef, 300)] }
  ]));
  const settlePost = ok(await post(settle.jvId));
  assert.deepEqual(await openItems('Vendor', 'V1'), [[bill.number, 'Cr', 1000, 700]]);

  // The advance can't be reversed while the JV settles it.
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: adv.jvId, reversalDate: D })).error,
    new RegExp('settled by ' + settlePost.jvNumber + ' — reverse that first'));
  // Reversing the settlement releases both allocations...
  const r = ok(await call('u-admin', 'reverseJournalEntry', { jvId: settle.jvId, reversalDate: D }));
  assert.deepEqual(await openItems('Vendor', 'V1'), [[bill.number, 'Cr', 1000, 1000], [advPost.jvNumber, 'Dr', 300, 300]], 'sorted by date');
  const rev = await doc(r.jvId);
  assert.deepEqual([rev.PartyKeys, rev.AllocatedRefs, rev.Lines.every(l => !l.Allocations), rev.Lines[0].PartyID], [['Vendor:V1'], [], true, 'V1']);
  // ...and a reversal with party lines can't itself be reversed.
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: r.jvId, reversalDate: D })).error, /cannot itself be reversed/);
  // Now the advance reverses, and its New Ref is gone.
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: adv.jvId, reversalDate: D }));
  assert.deepEqual(await openItems('Vendor', 'V1'), [[bill.number, 'Cr', 1000, 1000]]);
});

test('outstanding is re-checked at post, not trusted from the draft', async () => {
  await reset(fixture());
  const b1 = await vendorInvoice(500);
  const a = ok(await cbt('Bank Payment', '1100', [payable(500, [against(b1.ref, 500)])]));
  const b = ok(await cbt('Cash Payment', '1000', [payable(500, [against(b1.ref, 500)])]));
  ok(await post(a.jvId));
  assert.match((await post(b.jvId)).error, /has only 0.00 outstanding/);
  assert.equal((await doc(b.jvId)).Status, 'Draft');
  // A bill reversed after the draft was saved is no longer an open item.
  const b2 = await vendorInvoice(80);
  const c = ok(await cbt('Bank Payment', '1100', [payable(80, [against(b2.ref, 80)])]));
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: b2.id, reversalDate: D }));
  assert.match((await post(c.jvId)).error, /not an open item of Acme Metals \(it may have been reversed\)/);
});

test('approval gate: allocations count only once approved, and are re-checked at the approval', async () => {
  const f = fixture();
  f.approvalConfigurations = { CBT: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { CBT: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const b1 = await vendorInvoice(600);
  const a = ok(await cbt('Bank Payment', '1100', [payable(600, [against(b1.ref, 600)])]));
  assert.equal((await post(a.jvId)).status, 'PendingApproval');
  assert.deepEqual(await openItems('Vendor', 'V1'), [[b1.number, 'Cr', 600, 600]], 'a pending entry allocates nothing yet');

  const b = ok(await cbt('Bank Payment', '1100', [payable(250, [against(b1.ref, 250)])]));
  assert.equal((await post(b.jvId)).status, 'PendingApproval');
  ok(await call('u-approver', 'decideJournalEntryApproval', { jvId: b.jvId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.equal((await doc(b.jvId)).Status, 'Posted');
  assert.deepEqual(await openItems('Vendor', 'V1'), [[b1.number, 'Cr', 600, 350]]);

  const refused = await call('u-approver', 'decideJournalEntryApproval', { jvId: a.jvId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.match(refused.error, /has only 350.00 outstanding/);
  assert.equal((await doc(a.jvId)).Status, 'PendingApproval');
  const rej = ok(await call('u-approver', 'decideJournalEntryApproval', { jvId: a.jvId, levelNumber: 1, decision: 'Rejected', reason: 'Overpaid' }));
  assert.equal(rej.status, 'Rejected');
});

test('invoice reversal is refused while payments are allocated to it', async () => {
  await reset(fixture());
  const b1 = await vendorInvoice(200);
  const pay = ok(await cbt('Bank Payment', '1100', [payable(50, [against(b1.ref, 50)])]));
  const payPost = ok(await post(pay.jvId));
  const r = await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: b1.id, reversalDate: D });
  assert.equal(r.success, false);
  assert.match(r.error, new RegExp('allocated to it \\(' + payPost.jvNumber + '\\) — reverse those first'));
  assert.equal((await val('vendorInvoices/' + b1.id)).ReversedByInvoiceID || '', '');

  ok(await call('u-admin', 'reverseJournalEntry', { jvId: pay.jvId, reversalDate: D }));
  const r2 = ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: b1.id, reversalDate: D }));
  assert.equal(r2.status, 'Posted');
  assert.deepEqual(await openItems('Vendor', 'V1'), []);
});

test('customer receipt through CBT plus a JV write-off of the balance', async () => {
  await reset(fixture());
  assert.deepEqual(await openItems('Customer', 'CU1'), [['CINV-26-01-000001', 'Dr', 500, 500]], 'reversal entries are never open items');
  const recv = (amount, allocs, o) => Object.assign({ AccountCode: '1200', Amount: amount, Description: 'Receipt', PartyType: 'Customer', PartyID: 'CU1', Allocations: allocs }, o);
  const s = ok(await cbt('Bank Receipt', '1100', [recv(480, [against('CustomerInvoice:CI1', 480)])]));
  ok(await post(s.jvId));
  assert.deepEqual((await doc(s.jvId)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), [['1100', 480, 0], ['1200', 0, 480]]);

  const wo = ok(await jv([
    { AccountCode: '6800', Debit: 20, Credit: 0, Description: 'Short payment written off', CostCenterID: 'CC1' },
    { AccountCode: '1200', Debit: 0, Credit: 20, Description: 'Short payment written off', PartyType: 'Customer', PartyID: 'CU1', Allocations: [against('CustomerInvoice:CI1', 20)] }
  ]));
  ok(await post(wo.jvId));
  assert.deepEqual(await openItems('Customer', 'CU1'), []);
  const list = (await call('u-admin', 'getCustomerInvoiceEntries', { limit: 'all' })).entries;
  const ci1 = list.find(i => i.CustomerInvoiceID === 'CI1');
  assert.deepEqual([ci1.Outstanding, ci1.PaymentStatus, ci1.DueDate], [0, 'Paid', '2026-09-16']);
  assert.equal(list.find(i => i.CustomerInvoiceID === 'CIREV').Outstanding, undefined);

  const rr = await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: 'CI1', reversalDate: D });
  assert.match(rr.error, /has payments or adjustments allocated to it/);
});

test('party pickers: accounts per company, open items, access', async () => {
  await reset(fixture());
  const accounts = await call('u-admin', 'getPartyAccounts', { companyId: 'C1' });
  assert.deepEqual(accounts.map(a => [a.PartyType, a.PartyID, a.AccountCode]),
    [['Customer', 'CU1', '1200'], ['Vendor', 'V1', '2000'], ['Vendor', 'V2', '2010']]);
  assert.deepEqual(await call('u-admin', 'getPartyAccounts', { companyId: '' }), []);
  await assert.rejects(call('u-other', 'getPartyAccounts', { companyId: 'C1' }), /do not have access to that company/);
  await assert.rejects(call('u-admin', 'getPartyOpenItems', { partyType: 'Nope', partyId: 'V1', companyId: 'C1' }), /Vendor or Customer/);
  assert.equal((await call('u-viewer', 'getPartyAccounts', { companyId: 'C1' })).length, 3, 'viewers can look');
  await rtdb.ref('permissions/JV/access').set(['Admin']);
  await rtdb.ref('permissions/CBT/access').set(['Admin']);
  await assert.rejects(call('u-viewer', 'getPartyAccounts', { companyId: 'C1' }), /do not have access to Journal Entry Processing/);
});
