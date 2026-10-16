// Re-match a posted entry's references (owner, 2026-10-16; docs/modules/
// UX_TIER3.md, G, decisions 164-165): a payment matched to the wrong bill is
// re-matched without reversing it: the books stay, the open items follow;
// its own right; allowed in a closed month; logged in the entry; checked as
// at posting; a New Ref others settle can't shrink below what they settle.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, rtdb } = require('./_helpers');

const D = '2026-09-10';
test.after(async () => { await app.delete(); });
const doc = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const err = async p => (await p.catch(e => e)).message;

function fixture() {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-REG'] = { AccountCode: '320000', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: false };
  f.coa['A-RE'] = { AccountCode: '320001', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'A-REG' };
  f.vendors.V1.PaymentTermsDays = 30;
  return f;
}
async function bill(total) {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: '2026-09-01', Description: 'Bill ' + total, VendorRefNumber: 'B' + total, CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: total, Description: 'Freight', CostCenterID: 'CC1' }] } }));
  const p = ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  return { ref: 'VendorInvoice:' + s.invoiceId, number: p.invoiceNumber };
}
const against = (ref, amount) => ({ RefType: 'Against', RefID: ref, Amount: amount });
const payment = async (amount, allocations) => {
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: D, Description: 'Payment', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: amount, Description: 'Payment', PartyType: 'Vendor', PartyID: 'V1', Allocations: allocations }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  return s.jvId;
};
const open = async () => (await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' })).map(i => [i.Number, i.Outstanding]);
const partyLine = e => e.Lines.find(l => l.PartyType === 'Vendor');
const rematch = (jvId, lineNo, allocations, reason, uid) => call(uid || 'u-admin', 'rematchJournalEntry', { jvId, lines: [{ LineNo: lineNo, Allocations: allocations }], reason: reason === undefined ? 'Wrong bill picked' : reason });

test('a payment matched to the wrong bill: re-matched, the books unchanged, the open items follow; logged; its own right; checked as at posting', async () => {
  await reset(fixture());
  const b1 = await bill(300), b2 = await bill(200);
  const pay = await payment(300, [against(b1.ref, 300)]); // meant: B2 in full, the rest an advance
  const before = await doc(pay);
  const line = partyLine(before).LineNo;
  assert.deepEqual(await open(), [[b2.number, 200]]);

  assert.match(await err(rematch(pay, line, [against(b2.ref, 200), { RefType: 'New', Amount: 100 }], 'x', 'u-viewer')), /permission to re-match/);
  assert.match(await err(rematch(pay, line, [against(b2.ref, 200), { RefType: 'New', Amount: 100 }], '  ')), /reason/);
  assert.match(await err(rematch(pay, line, [against(b1.ref, 300)])), /Nothing changed/);
  assert.match(await err(rematch(pay, line, [against(b2.ref, 250), { RefType: 'New', Amount: 50 }])), /only 200\.00 outstanding/);
  assert.match(await err(rematch(pay, line, [against(b2.ref, 200)])), /allocations total 200\.00 but the line is 300\.00/);
  assert.match(await err(rematch(pay, 1, [{ RefType: 'New', Amount: 300 }])), /no vendor or customer/);
  // The open items shown for a re-match count this entry's own allocation back in.
  const forRematch = await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1', excludeJvId: pay });
  assert.deepEqual(forRematch.map(i => [i.Number, i.Outstanding]), [[b1.number, 300], [b2.number, 200]]);

  const r = ok(await rematch(pay, line, [against(b2.ref, 200), { RefType: 'New', Amount: 100 }]));
  assert.equal(r.changes.length, 1);
  const after = await doc(pay);
  assert.deepEqual(after.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), before.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), 'the books unchanged');
  assert.deepEqual([after.Status, after.JVNumber, after.JVDate], [before.Status, before.JVNumber, before.JVDate]);
  assert.deepEqual(partyLine(after).Allocations.map(a => [a.RefType, a.RefNumber || '', a.Amount]), [['Against', b2.number, 200], ['New', '', 100]]);
  assert.deepEqual(after.AllocatedRefs, [b2.ref]);
  assert.deepEqual(await open(), [[b1.number, 300], [before.JVNumber, 100]], 'B1 open again, B2 settled, the advance a New Ref');
  assert.equal(after.Rematches.length, 1);
  assert.deepEqual([after.Rematches[0].Reason, after.Rematches[0].ByName], ['Wrong bill picked', 'Admin User']);
  assert.match(after.Rematches[0].Changes[0].Before, new RegExp('Against ' + b1.number + ' 300\\.00'));
  assert.match(after.Rematches[0].Changes[0].After, new RegExp('Against ' + b2.number + ' 200\\.00 · New Ref 100\\.00'));
});

test('a New Ref another entry settles cannot shrink below it; a closed month is allowed (165); only live JV / CBT entries', async () => {
  await reset(fixture());
  const b1 = await bill(300);
  const pay = await payment(300, [{ RefType: 'New', Amount: 300 }]); // an advance
  const line = partyLine(await doc(pay)).LineNo;
  const advance = 'NewRef:' + pay + ':' + line;
  // A JV sets 120 of the advance against bill B1.
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Advance against bill', CompanyID: 'C1', CurrencyCode: 'AED', Lines: [
    { AccountCode: '2000', Debit: 120, Description: 'Bill', PartyType: 'Vendor', PartyID: 'V1', Allocations: [against(b1.ref, 120)] },
    { AccountCode: '2000', Credit: 120, Description: 'Advance', PartyType: 'Vendor', PartyID: 'V1', Allocations: [against(advance, 120)] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  const jvNo = (await doc(s.jvId)).JVNumber;
  assert.match(await err(rematch(pay, line, [against(b1.ref, 200), { RefType: 'New', Amount: 100 }])), /only 180\.00 outstanding/, 'B1 has 180 left');
  assert.match(await err(rematch(pay, line, [{ RefType: 'New', Amount: 300 }])), /Nothing changed/);
  // 300 advance: 120 used by the JV. Leaving 100 as the New Ref is refused; 120 is fine.
  const b2 = await bill(200);
  assert.match(await err(rematch(pay, line, [against(b2.ref, 200), { RefType: 'New', Amount: 100 }])), new RegExp('New Ref is settled by ' + jvNo + ' for 120\\.00'));

  // September closed: a re-match changes no books, so it is allowed.
  await rtdb.ref('periodClosing/C1').update({ ClosedThrough: '2026-09', FirstClosed: '2026-09' });
  ok(await rematch(pay, line, [against(b2.ref, 180), { RefType: 'New', Amount: 120 }], 'Bill B2 came in'));
  assert.deepEqual((await doc(pay)).Rematches.map(x => x.Reason), ['Bill B2 came in']);

  // Not another module's entry, not a reversed one.
  await firestore.collection('journalEntries').doc('PDC1').set({ CompanyID: 'C1', VoucherType: 'PDCIssued', Status: 'Posted', JVNumber: 'PDCI-1', Lines: [] });
  assert.match(await err(call('u-admin', 'rematchJournalEntry', { jvId: 'PDC1', lines: [], reason: 'x' })), /posted by PDCIssued: its matching is kept in that module/);
  await firestore.collection('journalEntries').doc(pay).update({ ReversedByJV: 'X' });
  assert.match(await err(rematch(pay, line, [{ RefType: 'New', Amount: 300 }])), /Only a posted entry that is not reversed/);
});
