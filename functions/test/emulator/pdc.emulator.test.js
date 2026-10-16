// PDC Received / PDC Issued (docs/modules/PDC.md): posting to the
// clearing account with the party line allocated against invoices,
// clearing to the bank, bounce/cancel reversing the post entry and
// reopening invoices, undo clearing, batch clearing, duplicate cheques,
// the Company Master accounts, approvals, the Home task list, the
// invoice lists' "PDC pending", the party statements' pending PDCs, and
// the GL-side guards (JV can't reverse a PDC entry; GL Report routes here).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-BANK2': { AccountCode: '1110', AccountName: 'Second Bank', AccountType: 'Asset', CashBank: 'Bank', Status: 'Active', IsPostable: true },
    'A-BANKC2': { AccountCode: '1120', AccountName: 'C2 Bank', AccountType: 'Asset', CashBank: 'Bank', Status: 'Active', IsPostable: true, CompanyID: 'C2' },
    'A-PDCR': { AccountCode: '1250', AccountName: 'PDC Received Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-PDCI': { AccountCode: '2150', AccountName: 'PDC Issued Clearing', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, { PdcReceivedClearingAccountID: 'A-PDCR', PdcIssuedClearingAccountID: 'A-PDCI' });
  f.vendors.V1.PaymentTermsDays = 30;
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 15 }
  };
  const inv = (party, id, date, total, extra) => Object.assign({ Status: 'Posted', CompanyID: 'C1', TransactionNumber: id, InvoiceDate: date,
    Description: 'Invoice ' + id, Total: total, CreatedAt: date, PostedAt: date + 'T00:00:00Z' }, party, extra || {});
  f.customerInvoices = { CI1: inv({ CustomerID: 'CU1' }, 'CINV-1', '2026-06-01', 1000), CI2: inv({ CustomerID: 'CU1' }, 'CINV-2', '2026-06-10', 300) };
  f.vendorInvoices = { VI1: inv({ VendorID: 'V1' }, 'VINV-1', '2026-06-05', 800) };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const err = async (p) => (await p.catch(e => e)).message;
const received = (o) => Object.assign({
  Direction: 'Received', CompanyID: 'C1', PartyID: 'CU1', TransactionDate: '2026-07-01', ChequeDate: '2026-08-01',
  ChequeNumber: '100001', DraweeBank: 'Emirates NBD', Amount: 600, Description: 'June invoice', CostCenterID: 'CC1',
  Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI1', Amount: 600 }]
}, o);
const issued = (o) => Object.assign({
  Direction: 'Issued', CompanyID: 'C1', PartyID: 'V1', TransactionDate: '2026-07-02', ChequeDate: '2026-08-15',
  ChequeNumber: '500001', BankAccountID: 'A-BANK', Amount: 500, Description: 'Steel', CostCenterID: 'CC1', Allocations: []
}, o);
const save = (data, uid) => call(uid || 'u-admin', 'savePdcDraft', data);
const post = (pdcId, uid) => call(uid || 'u-admin', 'postPdc', { pdcId });
async function posted(data) {
  const s = ok(await save(data));
  ok(await post(s.pdcId));
  return s.pdcId;
}
const rec = (id) => val('pdcCheques/' + id);
const gl = async (jvId) => (await firestore.collection('journalEntries').doc(jvId).get()).data();
const glLines = async (jvId) => (await gl(jvId)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']);
async function balance(accountId) {
  const snap = await firestore.collection('journalEntries').get();
  let b = 0;
  snap.docs.forEach(d => (d.data().Lines || []).forEach(l => { if (l.AccountID === accountId) b += (l.Debit || 0) - (l.Credit || 0); }));
  return Math.round(b * 100) / 100;
}
const openItems = async (partyType, partyId) => (await call('u-admin', 'getPartyOpenItems', { partyType, partyId, companyId: 'C1' }))
  .map(i => [i.Number, i.Outstanding]);

test('received: post to clearing against invoices, clear to a bank, undo clearing, bounce reopens the invoice', async () => {
  await reset(fixture());
  const id = await posted(received());
  let p = await rec(id);
  assert.equal(p.Status, 'Pending');
  assert.match(p.TransactionNumber, /^PDR-26-01-\d{6}$/);
  assert.deepEqual(await glLines(p.LinkedJVID), [['1250', 600, 0, ''], ['1200', 0, 600, 'CU1']]);
  assert.equal((await gl(p.LinkedJVID)).VoucherType, 'PDCReceived');
  assert.deepEqual(await openItems('Customer', 'CU1'), [['CINV-1', 400], ['CINV-2', 300]]);

  // Invoice list: CI1 partly paid, 600 of it by a PDC not yet cleared.
  const list = (await call('u-admin', 'getCustomerInvoiceEntries', { limit: 'all' })).entries;
  const ci1 = list.find(e => e.CustomerInvoiceID === 'CI1');
  assert.deepEqual([ci1.PaymentStatus, ci1.Outstanding, ci1.PdcPending], ['Partly paid', 400, 600]);

  // Clearing: not before the cheque date; the deposit bank is required and must be a bank.
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [id], clearDate: '2026-07-31', depositAccountId: 'A-BANK' })), /before the cheque date 2026-08-01/);
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [id], clearDate: '2026-08-02' })), /Select the bank account the cheque was deposited into/);
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [id], clearDate: '2026-08-02', depositAccountId: 'A-AR' })), /must be a bank account/);
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [id], clearDate: '2026-08-02', depositAccountId: 'A-BANKC2' })), /belongs to a different company/);
  ok(await call('u-admin', 'clearPdcs', { pdcIds: [id], clearDate: '2026-08-02', depositAccountId: 'A-BANK2' }));
  p = await rec(id);
  assert.deepEqual([p.Status, p.ClearedDate, p.DepositAccountCode], ['Cleared', '2026-08-02', '1110']);
  assert.match(p.ClearJVNumber, /^PDRC-26-01-\d{6}$/);
  assert.deepEqual(await glLines(p.ClearJVID), [['1110', 600, 0, ''], ['1250', 0, 600, '']]);
  assert.equal(await balance('A-PDCR'), 0);
  assert.equal(await balance('A-BANK2'), 600);
  const after = (await call('u-admin', 'getCustomerInvoiceEntries', { limit: 'all' })).entries.find(e => e.CustomerInvoiceID === 'CI1');
  assert.equal(after.PdcPending, 0, 'cleared: no longer pending');

  // Bounce needs the clearing undone first.
  assert.match(await err(call('u-admin', 'bouncePdc', { pdcId: id, date: '2026-08-05', reason: 'Insufficient funds' })), /undo the clearing first/);
  assert.match(await err(call('u-admin', 'undoPdcClearing', { pdcId: id, date: '2026-08-05', reason: '' })), /A reason is required/);
  ok(await call('u-admin', 'undoPdcClearing', { pdcId: id, date: '2026-08-05', reason: 'Returned by bank' }));
  p = await rec(id);
  assert.deepEqual([p.Status, p.ClearJVID], ['Pending', '']);
  assert.equal(await balance('A-BANK2'), 0);
  assert.equal(await balance('A-PDCR'), 600);

  ok(await call('u-admin', 'bouncePdc', { pdcId: id, date: '2026-08-05', reason: 'Insufficient funds' }));
  p = await rec(id);
  assert.deepEqual([p.Status, p.ClosedReason], ['Bounced', 'Insufficient funds']);
  const rev = await gl(p.ReversalJVID);
  assert.deepEqual([rev.ReversalOfJV, rev.PdcEvent, rev.VoucherType], [p.LinkedJVID, 'Bounced', 'PDCReceived']);
  assert.deepEqual(await glLines(p.ReversalJVID), [['1250', 0, 600, ''], ['1200', 600, 0, 'CU1']]);
  assert.equal((await gl(p.LinkedJVID)).ReversedByJV, p.ReversalJVID);
  assert.equal(await balance('A-PDCR'), 0);
  assert.equal(await balance('A-AR'), 0, 'receivable back where it was (invoices are not in the GL fixture)');
  assert.deepEqual(await openItems('Customer', 'CU1'), [['CINV-1', 1000], ['CINV-2', 300]], 'the invoice is open again');
  assert.deepEqual(p.History.map(h => h.Event), ['Posted', 'Cleared', 'Clearing undone', 'Bounced']);
  assert.equal(p.JVIDs.length, 4);

  // Nothing more can happen to a bounced cheque; its number is free again.
  assert.match(await err(call('u-admin', 'cancelPdc', { pdcId: id, date: '2026-08-06', reason: 'x' })), /Only a Pending PDC can be cancelled/);
  const again = await posted(received({ ReplacesPdcID: id, Allocations: [] }));
  assert.equal((await rec(again)).ReplacesPdcNumber, p.TransactionNumber);
});

test('issued: own bank, New Ref advance, cancel guarded while the advance is settled, JV and GL Report guards', async () => {
  await reset(fixture());
  const id = await posted(issued());
  let p = await rec(id);
  assert.match(p.TransactionNumber, /^PDI-26-01-\d{6}$/);
  assert.deepEqual(await glLines(p.LinkedJVID), [['2000', 500, 0, 'V1'], ['2150', 0, 500, '']]);
  assert.deepEqual(p.Allocations.map(a => [a.RefType, a.Amount]), [['New', 500]]);

  // The advance is settled against VINV-1 by a JV — cancelling the cheque is then refused.
  const newRef = 'NewRef:' + p.LinkedJVID + ':1';
  const j = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-07-03', Description: 'Settle advance', CompanyID: 'C1', CurrencyCode: 'AED', Lines: [
    { AccountCode: '2000', Debit: 500, Credit: 0, Description: 'Against bill', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: 'VendorInvoice:VI1', Amount: 500 }] },
    { AccountCode: '2000', Debit: 0, Credit: 500, Description: 'Against advance', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: newRef, Amount: 500 }] }
  ] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: j.jvId }));
  assert.match(await err(call('u-admin', 'cancelPdc', { pdcId: id, date: '2026-07-10', reason: 'Stopped' })), /has been settled by/);

  // JV can't reverse a PDC entry; GL Report routes it to the PDC screen.
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: p.LinkedJVID, reversalDate: '2026-07-10' })).error, /reverse it from that module/);
  const report = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-PDCI', FromDate: '2026-07-01', ToDate: '2026-07-31' } });
  assert.deepEqual(report.rows.map(r => r.SourceModule), ['PDCISSUED']);

  // Clearing uses the cheque's own bank, whatever is sent.
  ok(await call('u-admin', 'clearPdcs', { pdcIds: [id], clearDate: '2026-08-15', depositAccountId: 'A-BANK2' }));
  p = await rec(id);
  assert.deepEqual(await glLines(p.ClearJVID), [['2150', 500, 0, ''], ['1100', 0, 500, '']]);
  assert.match(p.ClearJVNumber, /^PDIC-26-01-\d{6}$/);
  assert.equal(await balance('A-PDCI'), 0);
  assert.equal(await balance('A-BANK'), -500);

  // Undo the clearing, reverse the settlement, then the cancel goes through.
  ok(await call('u-admin', 'undoPdcClearing', { pdcId: id, date: '2026-08-16', reason: 'Wrong date' }));
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: j.jvId, reversalDate: '2026-08-16' }));
  ok(await call('u-admin', 'cancelPdc', { pdcId: id, date: '2026-08-16', reason: 'Stopped' }));
  assert.equal((await rec(id)).Status, 'Cancelled');
  assert.equal(await balance('A-AP'), 0);
});

test('validation: required fields, bank rules, duplicates, clearing account set-up, allocations, company and access', async () => {
  const f = fixture();
  f.customers.CU9 = { CustomerCode: 'C009', CustomerName: 'Other Co Customer', Status: 'Active', CompanyID: 'C2', TradeReceivablesAccountID: 'A-AR' };
  await reset(f);
  assert.match(await err(save(received({ ChequeNumber: '' }))), /Cheque number is required/);
  assert.match(await err(save(received({ ChequeDate: '' }))), /Cheque date is required/);
  assert.match(await err(save(received({ Amount: 0 }))), /Amount must be greater than zero/);
  assert.match(await err(save(received({ DraweeBank: ' ' }))), /Enter the bank the cheque is drawn on/);
  assert.match(await err(save(received({ Direction: 'Sideways' }))), /Direction must be Received or Issued/);
  assert.match(await err(save(issued({ BankAccountID: '' }))), /Select the bank account the cheque is drawn on/);
  assert.match(await err(save(issued({ BankAccountID: 'A-CASH' }))), /must be a bank account \(code 11…\)/);
  assert.match(await err(save(issued({ BankAccountID: 'A-BANKC2' }))), /belongs to a different company/);
  assert.match(await err(save(received({ PartyID: 'CU9' }))), /belongs to a different company/);
  assert.match(await err(save(received({ Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI2', Amount: 600 }] }))), /CINV-2 has only 300\.00 outstanding/);
  assert.match(await err(save(received({ Amount: 500 }))), /The allocations \(600\.00\) are more than the cheque amount \(500\.00\)/);
  // Settling part of the cheque: the rest is kept as an advance.
  const part = ok(await save(received({ ChequeNumber: 'P1', Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI1', Amount: 250 }] })));
  assert.deepEqual((await rec(part.pdcId)).Allocations.map(a => [a.RefType, a.Amount]), [['Against', 250], ['New', 350]]);
  ok(await call('u-admin', 'deletePdcDraft', { pdcId: part.pdcId }));
  assert.match(await err(save(received({ Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI1', Amount: 1100 }], Amount: 1100 }))), /has only 1000\.00 outstanding/);
  assert.match(await err(save(received(), 'u-other')), /do not have access to that company/);
  assert.match(await err(save(received(), 'u-viewer')), /do not have permission to create or edit entries in PDCRECEIVED/);

  // Duplicates: same number + drawee bank (any case/spacing) + customer; same number + bank account.
  const first = ok(await save(received()));
  assert.match(await err(save(received({ DraweeBank: 'emirates  nbd' }))), /Cheque 100001 is already recorded \(draft PDC-/);
  ok(await save(received({ DraweeBank: 'ADCB' })));
  const iss = await posted(issued());
  assert.match(await err(save(issued())), /Cheque 500001 is already recorded \(PDI-/);
  ok(await save(issued({ BankAccountID: 'A-BANK2' })));

  // Clearing account: required, and neither a bank nor a party account.
  await rtdb.ref('companies/C1/PdcReceivedClearingAccountID').remove();
  assert.match(await err(post(first.pdcId)), /no PDC Received Clearing Account configured/);
  await rtdb.ref('companies/C1/PdcReceivedClearingAccountID').set('A-BANK2');
  assert.match(await err(post(first.pdcId)), /must not be a cash or bank account/);
  await rtdb.ref('companies/C1/PdcReceivedClearingAccountID').set('A-AR');
  assert.match(await err(post(first.pdcId)), /must not be a vendor or customer account/);
  assert.equal((await rec(first.pdcId)).Status, 'Draft');

  // Company Master save stores both fields.
  const company = await val('companies/C1');
  ok(await call('u-admin', 'saveCompany', { companyData: Object.assign({}, company, { CompanyID: 'C1', PdcReceivedClearingAccountID: 'A-PDCR', PdcIssuedClearingAccountID: 'A-PDCI' }) }));
  assert.deepEqual([(await val('companies/C1')).PdcReceivedClearingAccountID, (await val('companies/C1')).PdcIssuedClearingAccountID], ['A-PDCR', 'A-PDCI']);

  // Viewer can list but not post or clear; delete only drafts; the other screen can't edit it.
  assert.equal((await call('u-viewer', 'getPdcEntries', { direction: 'Received' })).entries.length, 2);
  assert.match(await err(post(first.pdcId, 'u-viewer')), /do not have permission to post, clear or reverse entries in PDCRECEIVED/);
  assert.match(await err(call('u-viewer', 'clearPdcs', { pdcIds: [iss], clearDate: '2026-08-20' })), /do not have permission to post/);
  assert.match(await err(save(Object.assign(issued({ ChequeNumber: '9' }), { PdcID: first.pdcId }))), /belongs to the other screen/);
  assert.match(await err(call('u-admin', 'deletePdcDraft', { pdcId: iss })), /Only draft PDCs can be deleted/);
  ok(await call('u-admin', 'deletePdcDraft', { pdcId: first.pdcId }));
  assert.equal(await rec(first.pdcId), null);
  await rtdb.ref('permissions/PDCISSUED/access').set(['Admin']);
  assert.match(await err(call('u-viewer', 'getPdcEntries', { direction: 'Issued' })), /do not have access to PDC Issued/);
});

test('batch clearing is all-or-nothing; the Home list shows cheques due', async () => {
  await reset(fixture());
  const a = await posted(received({ ChequeNumber: 'A1', Amount: 100, Allocations: [] }));
  const b = await posted(received({ ChequeNumber: 'B1', Amount: 200, Allocations: [], ChequeDate: '2026-09-01' }));
  const c = await posted(issued({ ChequeNumber: 'C1', ChequeDate: '2026-07-20' }));

  const due = await call('u-admin', 'getPdcsDueForUser', { today: '2026-08-01' });
  assert.deepEqual(due.map(d => [d.ModuleID, d.ChequeNumber, d.Overdue]), [['PDCISSUED', 'C1', true], ['PDCRECEIVED', 'A1', false]]);
  assert.deepEqual(await call('u-viewer', 'getPdcsDueForUser', { today: '2026-08-01' }), [], 'no post right, no task');

  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [a, b], clearDate: '2026-08-10', depositAccountId: 'A-BANK' })), /before the cheque date 2026-09-01/);
  assert.equal((await rec(a)).Status, 'Pending', 'nothing cleared');
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [a, c], clearDate: '2026-09-10', depositAccountId: 'A-BANK' })), /Clear received and issued PDCs separately/);
  const r = ok(await call('u-admin', 'clearPdcs', { pdcIds: [a, b], clearDate: '2026-09-10', depositAccountId: 'A-BANK' }));
  assert.equal(r.cleared.length, 2);
  assert.deepEqual([(await rec(a)).Status, (await rec(b)).Status], ['Cleared', 'Cleared']);
  assert.equal(await balance('A-BANK'), 300);
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [a], clearDate: '2026-09-10', depositAccountId: 'A-BANK' })), /only a Pending PDC can be cleared/);
});

test('approval: nothing posts until approved; a failed commit returns the PDC to Rejected', async () => {
  const f = fixture();
  f.approvalConfigurations = { PDCRECEIVED: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PDCRECEIVED: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = ok(await save(received()));
  assert.deepEqual(await post(s.pdcId), { success: true, status: 'PendingApproval' });
  let p = await rec(s.pdcId);
  assert.equal((await val('approvalInstances/' + p.ApprovalInstanceID)).Amount, 600);
  assert.equal(p.LinkedJVID, undefined);
  assert.deepEqual(await openItems('Customer', 'CU1'), [['CINV-1', 1000], ['CINV-2', 300]], 'nothing allocated yet');
  const tasks = await call('u-approver', 'getPendingApprovalsForUser');
  assert.deepEqual(tasks.map(t => [t.ModuleID, t.ModuleLabel]), [['PDCRECEIVED', 'PDC Received']]);
  ok(await call('u-approver', 'decidePdcApproval', { pdcId: s.pdcId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.equal((await rec(s.pdcId)).Status, 'Pending');

  const t = ok(await save(received({ ChequeNumber: '2', Allocations: [] })));
  await post(t.pdcId);
  await rtdb.ref('companies/C1/PdcReceivedClearingAccountID').remove();
  assert.match(await err(call('u-approver', 'decidePdcApproval', { pdcId: t.pdcId, levelNumber: 1, decision: 'Approved', reason: '' })),
    /Posting failed: This company has no PDC Received Clearing Account configured/);
  p = await rec(t.pdcId);
  assert.equal(p.Status, 'Rejected');
  assert.equal((await val('approvalInstances/' + p.ApprovalInstanceID)).Status, 'Pending');
});

test('statements: PDC rows, pending PDCs as at the end date', async () => {
  await reset(fixture());
  const a = await posted(received({ ChequeNumber: 'A1', Amount: 600 }));
  const b = await posted(received({ ChequeNumber: 'B1', Amount: 300, TransactionDate: '2026-07-05', ChequeDate: '2026-09-01',
    Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI2', Amount: 300 }] }));
  ok(await call('u-admin', 'clearPdcs', { pdcIds: [a], clearDate: '2026-08-02', depositAccountId: 'A-BANK' }));
  ok(await call('u-admin', 'bouncePdc', { pdcId: b, date: '2026-09-03', reason: 'Signature mismatch' }));

  const st = (to) => call('u-admin', 'getPartyStatement', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1', fromDate: '2026-06-01', toDate: to });
  // 31 July: both cheques pending.
  let s = await st('2026-07-31');
  assert.deepEqual(s.PendingPdcs.map(p => [p.ChequeNumber, p.Bank, p.Amount, p.DaysToMaturity]), [['A1', 'Emirates NBD', 600, 1], ['B1', 'Emirates NBD', 300, 32]]);
  assert.deepEqual([s.Closing, s.PendingPdcTotal], [400, 900]);
  assert.equal(s.BalanceIfPdcsBounce, undefined, 'no "if they bounce" figure (owner, 2026-09-26)');
  assert.deepEqual(s.Rows.map(r => [r.Type, r.Debit, r.Credit]), [['Invoice', 1000, 0], ['Invoice', 300, 0], ['PDC Received', 0, 600], ['PDC Received', 0, 300]]);
  // 15 August: A1 cleared on 2 August, B1 still pending.
  s = await st('2026-08-15');
  assert.deepEqual(s.PendingPdcs.map(p => p.ChequeNumber), ['B1']);
  // 30 September: B1 bounced on 3 September — a row, and nothing pending.
  s = await st('2026-09-30');
  assert.deepEqual(s.PendingPdcs, []);
  assert.deepEqual(s.Rows.slice(-1).map(r => [r.Type, r.Debit, r.IsReversal]), [['PDC Received Bounced', 300, true]]);
  assert.deepEqual([s.Closing, s.OpenTotal], [700, 700]);

  // Vendor side: an issued cheque pending at the end date.
  await posted(issued());
  const v = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1', fromDate: '2026-06-01', toDate: '2026-07-31' });
  assert.deepEqual(v.PendingPdcs.map(p => [p.ChequeNumber, p.Bank, p.Amount]), [['500001', '1100', 500]]);
  assert.deepEqual([v.Closing, v.PendingPdcTotal], [300, 500]);
});
