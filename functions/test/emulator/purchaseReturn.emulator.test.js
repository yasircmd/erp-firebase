// PURCHASERETURN (docs/modules/PURCHASE_RETURN.md) through its screen's
// callables: returnable invoices and lines, draft, post (stock Out at WAC;
// GL at the invoice price with the discount and tax shares and the
// variance; the payables line settling its invoice, any remainder a New
// Ref), approval (and the rollback to Rejected when the commit fails),
// reversal (stock back, GL mirrored, allocations released, and its guard),
// the Vendor Invoice reversal guard, Company Master's new account, the
// ledger rebuild, validation and access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.coa['A-DISC'] = { AccountCode: '4100', AccountName: 'Discount Received', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.coa['A-PRV'] = { AccountCode: '5200', AccountName: 'Purchase Return Variance', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountReceivedAccountID: 'A-DISC', InputTaxAccountID: 'A-VATIN', PurchaseReturnVarianceAccountID: 'A-PRV' });
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Other Vendor', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP' };
  const grn = (n, wh, qty, cost) => ({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionNumber: 'GRN-' + n,
    TransactionDate: D, Description: 'Receipt ' + n, CreatedAt: '2026-09-0' + n + 'T00:00:00Z', PostedAt: '2026-09-0' + n + 'T00:00:00Z',
    Lines: [{ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', ItemName: 'Steel Sheet', WarehouseID: wh, Direction: 'In', Quantity: qty, UnitCost: cost, TotalValue: qty * cost }] });
  // G1 received at 20, but other receipts have put WH1's average at 22.
  f.stock = {
    transactions: { G1: grn(1, 'WH1', 10, 20), G2: grn(2, 'WH2', 5, 10), G0: grn(0, 'WH1', 10, 24) },
    ledger: { I1: { WH1: { Quantity: 20, AvgCost: 22, TotalValue: 440 }, WH2: { Quantity: 5, AvgCost: 10, TotalValue: 50 } } }
  };
  f.stock.transactions.G0.MatchedToInvoiceID = 'OLD'; // not on our invoice
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const rec = (id) => val('stock/transactions/' + id);
const glDoc = async (id) => (await firestore.collection('journalEntries').doc(id).get()).data();
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId })).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();
const ledger = (wh) => val('stock/ledger/I1/' + wh);

// Invoice for G1 (200) + G2 (50): subtotal 250, discount 25, tax 5% on 225
// = 11.25, total 236.25 — through its real flow.
async function invoice() {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: D, Description: 'Invoice 77', VendorRefNumber: 'ACME-77', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [{ GRNID: 'G1' }, { GRNID: 'G2' }], DirectLines: [], Discount: 25, TaxPercent: 5 } }));
  const p = ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  return { id: s.invoiceId, ref: 'VendorInvoice:' + s.invoiceId, number: p.invoiceNumber };
}
const draft = (inv, lines, extra, uid) => call(uid || 'u-admin', 'savePurchaseReturnDraft', Object.assign({
  TransactionDate: D, Description: 'Damaged sheets', Reference: 'CN-9', CompanyID: 'C1', VendorID: 'V1', SourceInvoiceID: inv.id,
  Lines: lines.map(([grn, qty]) => ({ SourceGRNID: grn, SourceGRNLineNo: 1, Quantity: qty }))
}, extra || {}));
const postReturn = (returnId, uid) => call(uid || 'u-admin', 'postPurchaseReturn', { returnId });
const openItems = async () => (await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' }))
  .map(i => [i.Number, i.Side, i.Amount, i.Outstanding]);
const returnable = async () => (await call('u-admin', 'getReturnableVendorInvoices', { companyId: 'C1', vendorId: 'V1' }))
  .map(i => [i.TransactionNumber, i.Outstanding, i.Lines.map(l => [l.SourceGRNNumber, l.ReturnableQuantity])]);

test('post: stock out at WAC, GL at the invoice price with discount/tax shares and variance, invoice settled', async () => {
  await reset(fixture());
  const inv = await invoice();
  assert.deepEqual(await returnable(), [[inv.number, 236.25, [['GRN-1', 10], ['GRN-2', 5]]]]);

  const s = ok(await draft(inv, [['G1', 4]]));
  let r = await rec(s.returnId);
  // 4 × 20 = 80; discount 25 × 80/250 = 8; tax 5% of 72 = 3.6; total 75.6.
  assert.deepEqual([r.Status, r.ReturnValue, r.DiscountAmount, r.TaxAmount, r.Total, r.SourceInvoiceNumber, r.CostCenterID],
    ['Draft', 80, 8, 3.6, 75.6, inv.number, 'CC1']);

  const p = ok(await postReturn(s.returnId));
  assert.equal(p.status, 'Posted');
  assert.match(p.returnNumber, /^DBN-26-01-\d{6}$/);
  r = await rec(s.returnId);
  assert.deepEqual([r.Status, r.StockValue, r.VarianceAmount, r.AllocatedToInvoice, r.Lines[0].Direction, r.Lines[0].UnitCost],
    ['Posted', 88, -8, 75.6, 'Out', 22]);
  // Stock left at 22 (88) while the vendor takes it back at 20 (80): the 8 is a loss.
  assert.deepEqual(await jvLines(r.LinkedJVID), [['1300', 0, 88], ['1400', 0, 3.6], ['2000', 75.6, 0], ['4100', 8, 0], ['5200', 8, 0]]);
  const wh1 = await ledger('WH1');
  assert.deepEqual([wh1.Quantity, wh1.AvgCost, wh1.TotalValue], [16, 22, 352]);

  const gl = await glDoc(r.LinkedJVID);
  assert.deepEqual([gl.VoucherType, gl.PartyKeys, gl.AllocatedRefs, gl.AllocatedRefTypes], ['PurchaseReturn', ['Vendor:V1'], [inv.ref], ['VendorInvoice']]);
  assert.deepEqual([gl.Lines[0].PartyID, gl.Lines[0].Allocations], ['V1', [{ RefType: 'Against', RefID: inv.ref, Amount: 75.6, RefNumber: inv.number }]]);

  // The invoice now has 160.65 outstanding, everywhere it's shown.
  assert.deepEqual(await openItems(), [[inv.number, 'Cr', 236.25, 160.65]]);
  const listed = (await call('u-admin', 'getVendorInvoiceEntries', { limit: 'all' })).entries.find(e => e.VendorInvoiceID === inv.id);
  assert.deepEqual([listed.Outstanding, listed.PaymentStatus], [160.65, 'Partly paid']);
  assert.deepEqual(await returnable(), [[inv.number, 160.65, [['GRN-1', 6], ['GRN-2', 5]]]]);

  // Can't return more than is left; the invoice can't be reversed under it.
  assert.match((await draft(inv, [['G1', 7]]).catch(e => e)).message, /only 6 left to return \(received 10, already returned 4\)/);
  assert.match((await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv.id, reversalDate: D })).error,
    new RegExp('Purchase Returns posted against it \\(' + p.returnNumber + '\\) — reverse those first'));
  const list = (await call('u-admin', 'getPurchaseReturnEntries', {})).entries;
  assert.deepEqual(list.map(e => [e.ReturnID, e.TransactionNumber]), [[s.returnId, p.returnNumber]]);
});

test('reversal: stock back at the cost it left at, GL mirrored, invoice restored; once only', async () => {
  await reset(fixture());
  const inv = await invoice();
  const s = ok(await draft(inv, [['G1', 4]]));
  ok(await postReturn(s.returnId));
  const original = await rec(s.returnId);

  const r = ok(await call('u-admin', 'reversePurchaseReturn', { returnId: s.returnId, reversalDate: D }));
  assert.match(r.returnNumber, /^DBN-/);
  const rev = await rec(r.returnId);
  assert.deepEqual([rev.Status, rev.ReversalOfReturnID, rev.Lines[0].Direction], ['Posted', s.returnId, 'In']);
  assert.equal((await rec(s.returnId)).ReversedByReturnID, r.returnId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1300', 88, 0], ['1400', 3.6, 0], ['2000', 0, 75.6], ['4100', 0, 8], ['5200', 0, 8]]);
  const [oGl, rGl] = [await glDoc(original.LinkedJVID), await glDoc(rev.LinkedJVID)];
  assert.deepEqual([oGl.ReversedByJV, rGl.ReversalOfJV, rGl.PartyKeys, rGl.AllocatedRefs, rGl.Lines[0].PartyID, rGl.Lines[0].Allocations],
    [rev.LinkedJVID, original.LinkedJVID, ['Vendor:V1'], [], 'V1', []]);
  const wh1 = await ledger('WH1');
  assert.deepEqual([wh1.Quantity, wh1.AvgCost, wh1.TotalValue], [20, 22, 440]);

  // Invoice fully outstanding again; all of G1 returnable again.
  assert.deepEqual(await openItems(), [[inv.number, 'Cr', 236.25, 236.25]]);
  assert.deepEqual(await returnable(), [[inv.number, 236.25, [['GRN-1', 10], ['GRN-2', 5]]]]);

  assert.match((await call('u-admin', 'reversePurchaseReturn', { returnId: s.returnId }).catch(e => e)).message, /already been reversed/);
  assert.match((await call('u-admin', 'reversePurchaseReturn', { returnId: r.returnId }).catch(e => e)).message, /reversal entry cannot itself be reversed/);
  // With no live return left, the invoice can be reversed.
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv.id, reversalDate: D }));
  assert.match((await draft(inv, [['G1', 1]]).catch(e => e)).message, /no longer a posted, unreversed invoice/);
});

test('cost centers: variance and stock lines take the cost center of the GRN line returned, not the invoice header', async () => {
  // As reported live: the variance account is a COGS account (needs a
  // Cost Center) and the invoice header has none. G1's line and G2's
  // header carry one each; WH2's average is now 11, so G2 also has a variance.
  const f = fixture();
  f.companies.C1.PurchaseReturnVarianceAccountID = 'A-COGS';
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Stores', Status: 'Active', CompanyID: 'C1' };
  f.stock.transactions.G1.Lines[0].CostCenterID = 'CC1';
  f.stock.transactions.G2.CostCenterID = 'CC2';
  f.stock.ledger.I1.WH2 = { Quantity: 5, AvgCost: 11, TotalValue: 55 };
  await reset(f);
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: D, Description: 'Invoice 78', VendorRefNumber: 'ACME-78', CompanyID: 'C1', VendorID: 'V1',
    SourceGRNs: [{ GRNID: 'G1' }, { GRNID: 'G2' }], DirectLines: [], Discount: 0, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const inv = { id: s.invoiceId };

  const d = ok(await draft(inv, [['G1', 4], ['G2', 2]]));
  assert.deepEqual((await rec(d.returnId)).Lines.map(l => l.CostCenterID), ['CC1', 'CC2']);
  ok(await postReturn(d.returnId));
  const r = await rec(d.returnId);
  assert.equal(r.VarianceAmount, -10);
  const byCenter = async (jvId) => (await glDoc(jvId)).Lines.filter(l => ['5000', '1300'].includes(l.AccountCode))
    .map(l => [l.AccountCode, l.CostCenterID, l.Debit, l.Credit]).sort();
  // 4 × (20 − 22) = −8 on CC1; 2 × (10 − 11) = −2 on CC2.
  assert.deepEqual(await byCenter(r.LinkedJVID), [['1300', 'CC1', 0, 88], ['1300', 'CC2', 0, 22], ['5000', 'CC1', 8, 0], ['5000', 'CC2', 2, 0]]);

  const rv = ok(await call('u-admin', 'reversePurchaseReturn', { returnId: d.returnId, reversalDate: D }));
  assert.deepEqual(await byCenter((await rec(rv.returnId)).LinkedJVID), [['1300', 'CC1', 88, 0], ['1300', 'CC2', 22, 0], ['5000', 'CC1', 0, 8], ['5000', 'CC2', 0, 2]]);
});

test('invoice already paid: the whole note is an open debit (New Ref); its reversal waits for the refund to be reversed', async () => {
  const f = fixture();
  delete f.companies.C1.PurchaseReturnVarianceAccountID; // G2 returns at its own average: no variance, account not needed
  await reset(f);
  const inv = await invoice();
  const pay = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: D,
    Description: 'Pay bill', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: 236.25, Description: 'Pay', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: inv.ref, Amount: 236.25 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: pay.jvId }));
  assert.deepEqual(await returnable(), [[inv.number, 0, [['GRN-1', 10], ['GRN-2', 5]]]]);

  // 5 × 10 = 50; discount 5; tax 2.25; total 47.25 — all of it open.
  const s = ok(await draft(inv, [['G2', 5]]));
  const p = ok(await postReturn(s.returnId));
  const r = await rec(s.returnId);
  assert.deepEqual([r.VarianceAmount, r.AllocatedToInvoice, r.Total], [0, 0, 47.25]);
  assert.deepEqual(await jvLines(r.LinkedJVID), [['1300', 0, 50], ['1400', 0, 2.25], ['2000', 47.25, 0], ['4100', 5, 0]]);
  assert.deepEqual((await glDoc(r.LinkedJVID)).AllocatedRefs, []);
  assert.deepEqual(await openItems(), [[p.returnNumber, 'Dr', 47.25, 47.25]]);

  // The vendor refunds it: a bank receipt settles the open debit.
  const newRef = 'NewRef:' + r.LinkedJVID + ':1';
  const refund = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Receipt', SelectedAccountCode: '1100', JVDate: D,
    Description: 'Refund', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: 47.25, Description: 'Refund', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: newRef, Amount: 47.25 }] }] } }));
  const refundPost = ok(await call('u-admin', 'postJournalEntry', { jvId: refund.jvId }));
  assert.deepEqual(await openItems(), []);

  assert.match((await call('u-admin', 'reversePurchaseReturn', { returnId: s.returnId, reversalDate: D }).catch(e => e)).message,
    new RegExp('settled by ' + refundPost.jvNumber + ' — reverse that first'));
  // A debit note's GL entry can't be reversed from the JV screen.
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: r.LinkedJVID, reversalDate: D })).error, /posted by PurchaseReturn — reverse it from that module/);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: refund.jvId, reversalDate: D }));
  assert.deepEqual(await openItems(), [[p.returnNumber, 'Dr', 47.25, 47.25]]);
  // With the payment reversed too, nothing is allocated to the invoice any
  // more — only the return itself stops the invoice being reversed.
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: pay.jvId, reversalDate: D }));
  assert.match((await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv.id, reversalDate: D })).error,
    new RegExp('Purchase Returns posted against it \\(' + p.returnNumber + '\\)'));
  ok(await call('u-admin', 'reversePurchaseReturn', { returnId: s.returnId, reversalDate: D }));
  assert.deepEqual(await openItems(), [[inv.number, 'Cr', 236.25, 236.25]], 'unpaid again, and the note is gone');
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv.id, reversalDate: D }));
});

test('approval: gated post, nothing moves until approved; a failed commit returns the note to Rejected', async () => {
  const f = fixture();
  f.approvalConfigurations = { PURCHASERETURN: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASERETURN: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const inv = await invoice();
  const s = ok(await draft(inv, [['G1', 1]]));
  assert.deepEqual(await postReturn(s.returnId), { success: true, status: 'PendingApproval' });
  let r = await rec(s.returnId);
  assert.equal((await val('approvalInstances/' + r.ApprovalInstanceID)).Amount, 18.9); // 20 − 2 + 0.9
  assert.equal((await ledger('WH1')).Quantity, 20, 'no stock moved yet');
  assert.match((await draft(inv, [['G1', 1]], { ReturnID: s.returnId }).catch(e => e)).message, /Only draft or rejected returns can be edited/);
  const yes = ok(await call('u-approver', 'decidePurchaseReturnApproval', { returnId: s.returnId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.equal(yes.status, 'Approved');
  assert.equal((await rec(s.returnId)).Status, 'Posted');
  assert.equal((await ledger('WH1')).Quantity, 19);

  // Rejected with a reason, then editable.
  const t = ok(await draft(inv, [['G1', 1]]));
  await postReturn(t.returnId);
  assert.match((await call('u-approver', 'decidePurchaseReturnApproval', { returnId: t.returnId, levelNumber: 1, decision: 'Rejected', reason: '' }).catch(e => e)).message, /reason is required/);
  ok(await call('u-approver', 'decidePurchaseReturnApproval', { returnId: t.returnId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong qty' }));
  r = await rec(t.returnId);
  assert.deepEqual([r.Status, r.RejectionReason], ['Rejected', 'Wrong qty']);
  ok(await draft(inv, [['G1', 2]], { ReturnID: t.returnId }));

  // The commit fails at approval (variance account removed meanwhile).
  await postReturn(t.returnId);
  await rtdb.ref('companies/C1/PurchaseReturnVarianceAccountID').remove();
  const bad = await call('u-approver', 'decidePurchaseReturnApproval', { returnId: t.returnId, levelNumber: 1, decision: 'Approved', reason: '' }).catch(e => e);
  assert.match(bad.message, /Posting failed: This company has no Purchase Return Variance Account configured/);
  r = await rec(t.returnId);
  assert.equal(r.Status, 'Rejected');
  assert.equal((await val('approvalInstances/' + r.ApprovalInstanceID)).Status, 'Pending');
  assert.equal((await ledger('WH1')).Quantity, 19, 'nothing moved');
});

test('validation, stock check, delete, company scoping and access', async () => {
  await reset(fixture());
  const inv = await invoice();
  const err = async (p) => (await p.catch(e => e)).message;
  assert.match(await err(draft(inv, [])), /Enter a quantity to return on at least one line/);
  assert.match(await err(draft(inv, [['G1', 0]])), /Enter a quantity/);
  assert.match(await err(draft(inv, [['G1', 1], ['G1', 1]])), /listed twice/);
  assert.match(await err(draft(inv, [['G1', 1.5]])), /PCS does not allow decimal quantities/);
  assert.match(await err(draft(inv, [['G0', 1]])), /that GRN line is not on this invoice/);
  assert.match(await err(draft(inv, [['G1', 1]], { VendorID: 'V2' })), /different company or vendor/);
  assert.match(await err(draft(inv, [['G1', 1]], { SourceInvoiceID: '' })), /Select the Vendor Invoice/);
  assert.match(await err(draft(inv, [['G1', 1]], {}, 'u-viewer')), /permission to create or edit/);
  assert.match(await err(draft(inv, [['G1', 1]], {}, 'u-other')), /do not have access to that company/);

  // Stock that has left the warehouse since can't be returned.
  const s = ok(await draft(inv, [['G1', 4]]));
  assert.match(await err(postReturn(s.returnId, 'u-viewer')), /permission to post/);
  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 3, AvgCost: 22, TotalValue: 66 });
  assert.match(await err(postReturn(s.returnId)), /insufficient stock for RM-001 at this warehouse — available 3, requested 4/);
  assert.equal((await rec(s.returnId)).Status, 'Draft');

  // Company scoping of lists and pickers.
  assert.deepEqual((await call('u-other', 'getPurchaseReturnEntries', {})).entries, []);
  assert.match(await err(call('u-other', 'getReturnableVendorInvoices', { companyId: 'C1', vendorId: 'V1' })), /do not have access to that company/);
  assert.equal((await call('u-viewer', 'getPurchaseReturnEntries', {})).entries.length, 1);

  ok(await call('u-admin', 'deletePurchaseReturnDraft', { returnId: s.returnId }));
  assert.equal(await rec(s.returnId), null);
  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 20, AvgCost: 22, TotalValue: 440 });
  const t = ok(await draft(inv, [['G1', 1]]));
  ok(await postReturn(t.returnId));
  assert.match(await err(call('u-admin', 'deletePurchaseReturnDraft', { returnId: t.returnId })), /Only draft returns can be deleted/);
});

test('Company Master stores the variance account; the ledger rebuild replays returns and their reversals', async () => {
  await reset(fixture());
  const saved = await call('u-admin', 'saveCompany', { companyData: Object.assign({ CompanyID: 'C1' }, await val('companies/C1'), { PurchaseReturnVarianceAccountID: 'A-PRV' }) });
  assert.equal(saved.success, true, saved.error);
  assert.equal((await val('companies/C1')).PurchaseReturnVarianceAccountID, 'A-PRV');
  const bad = await call('u-admin', 'saveCompany', { companyData: Object.assign({ CompanyID: 'C1' }, await val('companies/C1'), { PurchaseReturnVarianceAccountID: 'NOPE' }) });
  assert.deepEqual(bad, { success: false, error: 'Purchase Return Variance Account must be an active, postable account.' });

  // Ledger seeded to agree with the three GRNs, so a rebuild must reproduce it.
  await rtdb.ref('stock/ledger/I1').set({ WH1: { Quantity: 20, AvgCost: 22, TotalValue: 440 }, WH2: { Quantity: 5, AvgCost: 10, TotalValue: 50 } });
  const inv = await invoice();
  const a = ok(await draft(inv, [['G1', 4], ['G2', 2]]));
  ok(await postReturn(a.returnId));
  const b = ok(await draft(inv, [['G1', 1]]));
  ok(await postReturn(b.returnId));
  ok(await call('u-admin', 'reversePurchaseReturn', { returnId: b.returnId, reversalDate: D }));
  const live = await val('stock/ledger/I1');
  const strip = (l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, [v.Quantity, v.AvgCost, v.TotalValue]]));
  assert.deepEqual(strip(live), { WH1: [16, 22, 352], WH2: [3, 10, 30] });
  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 999, AvgCost: 1, TotalValue: 999 });
  ok(await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' }));
  assert.deepEqual(strip(await val('stock/ledger/I1')), strip(live));
});
