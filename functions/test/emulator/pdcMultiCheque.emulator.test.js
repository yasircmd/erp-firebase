// Several cheques in one PDC entry (UX round 2, item 25, docs/modules/
// PDC_MULTI_CHEQUE.md, Q290-Q292): one entry posts a GL entry per cheque,
// numbered from the entry (-01 the earliest cheque); its allocations are
// checked once and the cheques settle them in cheque-date order; each cheque
// then clears or bounces by itself, a bounce reopening only what it settled.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-BANK2': { AccountCode: '1110', AccountName: 'Second Bank', AccountType: 'Asset', CashBank: 'Bank', Status: 'Active', IsPostable: true },
    'A-PDCR': { AccountCode: '1250', AccountName: 'PDC Received Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-PDCI': { AccountCode: '2150', AccountName: 'PDC Issued Clearing', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, { PdcReceivedClearingAccountID: 'A-PDCR', PdcIssuedClearingAccountID: 'A-PDCI' });
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 15 }
  };
  const inv = (party, id, date, total) => Object.assign({ Status: 'Posted', CompanyID: 'C1', TransactionNumber: id, InvoiceDate: date,
    Description: 'Invoice ' + id, Total: total, CreatedAt: date, PostedAt: date + 'T00:00:00Z' }, party);
  f.customerInvoices = { CI1: inv({ CustomerID: 'CU1' }, 'CINV-1', '2026-06-01', 1000), CI2: inv({ CustomerID: 'CU1' }, 'CINV-2', '2026-06-10', 300) };
  f.vendorInvoices = { VI1: inv({ VendorID: 'V1' }, 'VINV-1', '2026-06-05', 800) };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const err = async (p) => (await p.catch(e => e)).message;
const cheque = (n, date, amount, bank) => ({ ChequeNumber: n, ChequeDate: date, Amount: amount, DraweeBank: bank === undefined ? 'Emirates NBD' : bank });
// Typed out of date order, and the newer invoice first: the posting sorts both.
const entry = (o) => Object.assign({
  Direction: 'Received', CompanyID: 'C1', PartyID: 'CU1', TransactionDate: '2026-07-01', Description: 'Contract cheques', CostCenterID: 'CC1',
  Cheques: [cheque('300002', '2026-09-01', 500), cheque('300001', '2026-08-01', 500), cheque('300003', '2026-10-01', 400)],
  Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI2', Amount: 300 }, { RefType: 'Against', RefID: 'CustomerInvoice:CI1', Amount: 1000 }]
}, o);
const rec = (id) => val('pdcCheques/' + id);
const gl = async (jvId) => (await firestore.collection('journalEntries').doc(jvId).get()).data();
const openItems = async (partyType, partyId) => (await call('u-admin', 'getPartyOpenItems', { partyType, partyId, companyId: 'C1' }))
  .filter(i => i.Side === (partyType === 'Customer' ? 'Dr' : 'Cr')).map(i => [i.Number, i.Outstanding]);
const shares = (p) => p.Allocations.map(a => [a.RefType, a.RefType === 'New' ? 'new' : a.RefID, a.Amount]);

test('received: one entry, a GL entry per cheque numbered -01 by cheque date, allocations settled in date order', async () => {
  await reset(fixture());
  const s = ok(await call('u-admin', 'savePdcDraft', entry()));
  const draft = await rec(s.pdcId);
  assert.equal(draft.Amount, 1400, 'the entry\'s total');
  assert.deepEqual(draft.Cheques.map(c => c.ChequeNumber), ['300001', '300002', '300003'], 'kept in cheque-date order');
  const r = ok(await call('u-admin', 'postPdc', { pdcId: s.pdcId }));
  assert.match(r.pdcNumber, /^PDR-26-01-\d{6}$/);

  const ids = [s.pdcId, s.pdcId + '-02', s.pdcId + '-03'];
  const ps = await Promise.all(ids.map(rec));
  assert.deepEqual(ps.map(p => [p.Status, p.ChequeNumber, p.ChequeDate, p.Amount, p.TransactionNumber, p.EntryID, p.EntryNumber, p.ChequeIndex, p.ChequeCount]), [
    ['Pending', '300001', '2026-08-01', 500, r.pdcNumber + '-01', s.pdcId, r.pdcNumber, 1, 3],
    ['Pending', '300002', '2026-09-01', 500, r.pdcNumber + '-02', s.pdcId, r.pdcNumber, 2, 3],
    ['Pending', '300003', '2026-10-01', 400, r.pdcNumber + '-03', s.pdcId, r.pdcNumber, 3, 3]
  ]);
  assert.equal(ps[0].Cheques, undefined, 'the lines go once posted');
  // The earliest cheque settles the oldest invoice; the rest of the last is its New Ref.
  assert.deepEqual(ps.map(shares), [
    [['Against', 'CustomerInvoice:CI1', 500]],
    [['Against', 'CustomerInvoice:CI1', 500]],
    [['Against', 'CustomerInvoice:CI2', 300], ['New', 'new', 100]]
  ]);
  // Each cheque its own GL entry, with its own number and source.
  for (const p of ps) {
    const e = await gl(p.LinkedJVID);
    assert.deepEqual([e.JVNumber, e.VoucherType, e.SourceTransactionID, e.TotalDebit], [p.TransactionNumber, 'PDCReceived', ids[ps.indexOf(p)], p.Amount]);
    assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']), [['1250', p.Amount, 0, ''], ['1200', 0, p.Amount, 'CU1']]);
  }
  assert.deepEqual(await openItems('Customer', 'CU1'), [], 'both invoices settled');

  // The entry took one number: the next PDC has the next one.
  const one = ok(await call('u-admin', 'savePdcDraft', entry({ Cheques: [cheque('400001', '2026-08-15', 50)], Allocations: [] })));
  const n = ok(await call('u-admin', 'postPdc', { pdcId: one.pdcId })).pdcNumber;
  assert.equal(Number(n.slice(-6)), Number(r.pdcNumber.slice(-6)) + 1);
  assert.equal((await rec(one.pdcId)).TransactionNumber, n, 'an entry of one keeps the plain number');

  // Each cheque on its own: -01 clears, -03 bounces and reopens only what it settled.
  ok(await call('u-admin', 'clearPdcs', { pdcIds: [ids[0]], clearDate: '2026-08-02', depositAccountId: 'A-BANK2' }));
  ok(await call('u-admin', 'bouncePdc', { pdcId: ids[2], date: '2026-10-02', reason: 'Insufficient funds' }));
  assert.deepEqual((await Promise.all(ids.map(rec))).map(p => p.Status), ['Cleared', 'Pending', 'Bounced']);
  assert.deepEqual(await openItems('Customer', 'CU1'), [['CINV-2', 300]]);

  // The statement lists the cheque still pending; the list keeps the entry whole.
  const st = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1', fromDate: '2026-06-01', toDate: '2026-10-31' });
  assert.deepEqual(st.PendingPdcs.map(p => [p.Number, p.ChequeNumber, p.Amount]), [[n, '400001', 50], [r.pdcNumber + '-02', '300002', 500]]);
  const list = (await call('u-admin', 'getPdcEntries', { direction: 'Received' })).entries;
  assert.deepEqual(list.filter(e => e.EntryID === s.pdcId).map(e => e.PdcID).sort(), ids);
});

test('issued: the entry\'s bank account for every cheque; a vendor invoice settled across two cheques', async () => {
  await reset(fixture());
  const s = ok(await call('u-admin', 'savePdcDraft', {
    Direction: 'Issued', CompanyID: 'C1', PartyID: 'V1', TransactionDate: '2026-07-02', BankAccountID: 'A-BANK', Description: 'Steel', CostCenterID: 'CC1',
    Cheques: [{ ChequeNumber: '500002', ChequeDate: '2026-09-15', Amount: 500 }, { ChequeNumber: '500001', ChequeDate: '2026-08-15', Amount: 500 }],
    Allocations: [{ RefType: 'Against', RefID: 'VendorInvoice:VI1', Amount: 800 }]
  }));
  const r = ok(await call('u-admin', 'postPdc', { pdcId: s.pdcId }));
  const ps = await Promise.all([s.pdcId, s.pdcId + '-02'].map(rec));
  assert.deepEqual(ps.map(p => [p.ChequeNumber, p.BankAccountCode, p.TransactionNumber]), [['500001', '1100', r.pdcNumber + '-01'], ['500002', '1100', r.pdcNumber + '-02']]);
  assert.match(r.pdcNumber, /^PDI-26-01-\d{6}$/);
  assert.deepEqual(ps.map(shares), [[['Against', 'VendorInvoice:VI1', 500]], [['Against', 'VendorInvoice:VI1', 300], ['New', 'new', 200]]]);
  assert.deepEqual((await gl(ps[1].LinkedJVID)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), [['2000', 500, 0], ['2150', 0, 500]]);
  // Cancelling the second cheque reopens its 300 only.
  ok(await call('u-admin', 'cancelPdc', { pdcId: s.pdcId + '-02', date: '2026-07-10', reason: 'Replaced' }));
  assert.deepEqual(await openItems('Vendor', 'V1'), [['VINV-1', 300]]);
});

test('checks: each cheque\'s fields, a cheque entered twice, one recorded elsewhere, the most an entry takes, approval of the whole entry', async () => {
  const f = fixture();
  f.approvalConfigurations = { PDCRECEIVED: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PDCRECEIVED: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const save = (o) => call('u-admin', 'savePdcDraft', entry(o));
  assert.match(await err(save({ Cheques: [cheque('1', '2026-08-01', 10), cheque('2', '', 10)] })), /Cheque 2: Cheque date is required/);
  assert.match(await err(save({ Cheques: [cheque('1', '2026-08-01', 10), cheque('2', '2026-09-01', 0)] })), /Cheque 2: Amount must be greater than zero/);
  assert.match(await err(save({ Cheques: [cheque('1', '2026-08-01', 10), cheque('2', '2026-09-01', 10, '')] })), /Cheque 2: Enter the bank the cheque is drawn on/);
  assert.match(await err(save({ Cheques: [cheque('7', '2026-08-01', 10), cheque('7', '2026-09-01', 10)], Allocations: [] })), /Cheque 7 is entered twice/);
  ok(await save({ Cheques: [cheque('7', '2026-08-01', 10), cheque('7', '2026-09-01', 10, 'Other Bank')], Allocations: [] }));
  // A cheque in another entry's draft is refused.
  assert.match(await err(save({ Cheques: [cheque('8', '2026-08-01', 10), cheque('7', '2026-09-01', 10)], Allocations: [] })), /Cheque 7 is already recorded \(draft PDC-/);
  const many = Array.from({ length: 61 }, (_, i) => cheque('M' + i, '2026-08-01', 1));
  assert.match(await err(save({ Cheques: many, Allocations: [] })), /at most 60 cheques/);
  assert.match(await err(save({ Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI1', Amount: 1500 }] })), /more than the cheque amount \(1400\.00\)/);

  // Approval: for the entry's total; on approval every cheque posts.
  const s = ok(await save({}));
  assert.deepEqual(await call('u-admin', 'postPdc', { pdcId: s.pdcId }), { success: true, status: 'PendingApproval' });
  const p = await rec(s.pdcId);
  assert.equal((await val('approvalInstances/' + p.ApprovalInstanceID)).Amount, 1400);
  assert.equal(await rec(s.pdcId + '-02'), null, 'nothing posted yet');
  ok(await call('u-approver', 'decidePdcApproval', { pdcId: s.pdcId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.deepEqual((await Promise.all([s.pdcId, s.pdcId + '-02', s.pdcId + '-03'].map(rec))).map(x => x.Status), ['Pending', 'Pending', 'Pending']);
});
