// A sales rep's collections, balance and receipts (UX round 2, items 30-31;
// docs/modules/REP_COLLECTIONS.md, Q294-Q298, Q309-Q310): the company's Rep
// Cash Clearing account and each rep's code; a collection final when the
// rep records it, numbered RC-<code>-000001: cash Dr Rep Cash Clearing (an
// open item on the rep) · Cr the customer, settling the invoices the rep
// picked; the cashier takes it with a Cash Receipt matching the rep's
// receipts; a cheque a PDC Received "with the rep" until the office ticks
// it received; the office cancels a receipt with Cash & Bank's post right.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const saveRep = (data, uid) => call(uid || 'u-admin', 'saveSalesRep', Object.assign({ companyId: 'C1', active: true, isManager: false, customerIds: [] }, data));
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const receipt = async n => (await firestore.collection('repReceipts').doc(n).get()).data();
const openOf = async (type, id) => call('u-admin', 'getPartyOpenItems', { partyType: type, partyId: id, companyId: 'C1' });
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

test.before(async () => {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Corner Shop', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Market Stall', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 }
  };
  Object.assign(f.companies.C1, { PdcReceivedClearingAccountID: 'A-PDCR' });
  f.coa['A-PDCR'] = { AccountCode: '1250', AccountName: 'PDC Received Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  f.coa['A-RCC'] = { AccountCode: '1260', AccountName: 'Rep Cash Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  await reset(f);
  const emp = (id, no, name, uid) => firestore.collection('employees').doc(id).set({ EmployeeNo: no, FullName: name, CompanyID: 'C1', Status: 'Active', UserUID: uid, CostCenterID: 'CC1' });
  await emp('E1', 'EMP-0001', 'Sam Seller', 'u-viewer');
  await emp('E2', 'EMP-0002', 'Mia Mover', 'u-approver');
  // Two of the Corner Shop's invoices, the older first.
  const inv = (id, no, date, total) => firestore.collection('customerInvoices').doc(id).set({ CustomerID: 'CU1', CompanyID: 'C1', Status: 'Posted', InvoiceDate: date, Total: total, TransactionNumber: no });
  await inv('CI1', 'CINV-26-01-000001', '2026-09-01', 300);
  await inv('CI2', 'CINV-26-01-000002', '2026-10-01', 200);
});

test('set-up: the company\'s Rep Cash Clearing account and each rep\'s code', async () => {
  const set = (id, uid) => call(uid || 'u-admin', 'saveSalesRepSettings', { companyId: 'C1', clearingAccountId: id });
  assert.match(await err(set('A-RCC', 'u-viewer')), /permission to change Sales Invoice Configuration/);
  assert.match(await err(set('A-CASH')), /not a cash or bank account/);
  ok(await saveRep({ employeeId: 'E1', customerIds: ['CU1'] }));
  assert.equal((await val('salesReps/E1')).RepCode, 'EMP0001', 'the employee number by default (Q298)');
  assert.match(await err(saveRep({ employeeId: 'E1', repCode: 'S S' })), /1 to 12 letters or digits/);
  ok(await saveRep({ employeeId: 'E1', repCode: 'ss', customerIds: ['CU1'] }));
  assert.match(await err(saveRep({ employeeId: 'E2', repCode: 'EMP0001' })), /belongs to another rep/, 'a code once used is the rep\'s for good');
  ok(await saveRep({ employeeId: 'E2', repCode: 'MM', customerIds: ['CU2'] }));
  // No clearing account yet: cash is refused, so nothing is posted to nowhere.
  assert.match(await err(ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cash', amount: '10' })), /no Rep Cash Clearing account yet/);
  assert.match(await err(set('A-AR')), /control account/);
  ok(await set('A-RCC'));
  const reps = await call('u-admin', 'getSalesReps', { companyId: 'C1' });
  assert.deepEqual([reps.clearingAccountId, reps.reps.map(r => [r.EmployeeID, r.RepCode]).sort()], ['A-RCC', [['E1', 'SS'], ['E2', 'MM']]]);
  // The rep is a party on Rep Cash Clearing (Cash & Bank's party picker).
  const parties = (await call('u-admin', 'getPartyAccounts', { companyId: 'C1' })).filter(p => p.PartyType === 'SalesRep');
  assert.deepEqual(parties.map(p => [p.PartyID, p.Code, p.Name, p.AccountCode]).sort(), [['E1', 'SS', 'Sam Seller', '1260'], ['E2', 'MM', 'Mia Mover', '1260']]);
  // Numbering has no "RC" series of its own: the reps number their receipts.
  assert.ok(!(await call('u-admin', 'getNumbering', {})).kinds.some(k => k.key === 'doc:RC'));
});

let CASH1, CASH2;
test('cash: final at once, its own number; the invoices the rep picks are settled, the rest on account', async () => {
  const inv = (await ess('u-viewer', 'salesInvoices', { customerId: 'CU1' })).invoices;
  assert.deepEqual(inv.map(i => [i.Number, i.Outstanding]), [['CINV-26-01-000001', 300], ['CINV-26-01-000002', 200]], 'oldest first (Q296)');
  assert.match(await err(ess('u-viewer', 'salesCollect', { customerId: 'CU2', method: 'Cash', amount: '10' })), /not one of yours/);
  assert.match(await err(ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cash', amount: '100', invoices: [{ refId: inv[0].RefID, amount: '150' }] })), /more than the 100.00 collected/);
  const r = ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cash', amount: '350', invoices: [{ refId: inv[0].RefID, amount: '300' }] }));
  CASH1 = r.number;
  assert.equal(CASH1, 'RC-SS-000001');
  const rc = await receipt(CASH1);
  const e = await jv(rc.JVID);
  assert.deepEqual([e.Status, e.VoucherType, e.JVNumber, e.CreatedBy], ['Posted', 'RepReceipt', 'RC-SS-000001', 'Portal: EMP-0001 Sam Seller']);
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyType, l.PartyID]), [['1260', 350, 0, 'SalesRep', 'E1'], ['1200', 0, 350, 'Customer', 'CU1']]);
  assert.deepEqual(rc.Settles, [{ Number: 'CINV-26-01-000001', Amount: 300 }, { Number: '', OnAccount: true, Amount: 50 }]);
  // The receipt as the customer gets it (the PDF on the phone).
  assert.deepEqual([r.receipt.CustomerName, r.receipt.Amount, r.receipt.Method, r.receipt.RepName, typeof r.receipt.Words], ['Corner Shop', 350, 'Cash', 'Sam Seller', 'string']);
  assert.ok(r.receipt.Words.length > 10, r.receipt.Words);
  // The customer owes less at once; the rep holds 350.
  assert.deepEqual((await openOf('Customer', 'CU1')).filter(i => i.Side === 'Dr').map(i => [i.Number, i.Outstanding]), [['CINV-26-01-000002', 200]]);
  const mine = await ess('u-viewer', 'salesCollections');
  assert.deepEqual([mine.balance.Cash, mine.receipts.map(x => [x.Number, x.StatusText])], [350, [['RC-SS-000001', 'With the rep']]]);
  CASH2 = ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cash', amount: '40' })).number;
  assert.equal(CASH2, 'RC-SS-000002', 'the rep\'s own series, one by one');
});

test('the cashier: an ordinary Cash Receipt, choosing the rep and matching their receipts', async () => {
  const items = await openOf('SalesRep', 'E1');
  assert.deepEqual(items.map(i => [i.Number, i.Outstanding]), [['RC-SS-000001', 350], ['RC-SS-000002', 40]]);
  const cr = (lines) => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Cash Receipt', SelectedAccountCode: '1000', JVDate: TODAY, Description: 'Cash from Sam', CompanyID: 'C1', CostCenterID: 'CC1', OppositeLines: lines } });
  const noParty = await cr([{ AccountCode: '1260', Amount: '200', Description: 'From the rep', CostCenterID: 'CC1' }]);
  assert.equal(noParty.success, false);
  assert.match(noParty.error, /account 1260 is the Rep Cash Clearing account — select the Sales rep/);
  const d = ok(await cr([{ AccountCode: '1260', Amount: '200', Description: 'From the rep', CostCenterID: 'CC1', PartyType: 'SalesRep', PartyID: 'E1',
    Allocations: [{ RefType: 'Against', RefID: items[0].RefID, Amount: 200 }] }]));
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: d.jvId })).status, 'Posted');
  let mine = await ess('u-viewer', 'salesCollections');
  assert.deepEqual([mine.balance.Cash, mine.receipts.map(x => [x.Number, x.StatusText])], [190, [['RC-SS-000002', 'With the rep'], ['RC-SS-000001', 'Part handed over']]]);
  const d2 = ok(await cr([{ AccountCode: '1260', Amount: '150', Description: 'The rest', CostCenterID: 'CC1', PartyType: 'SalesRep', PartyID: 'E1', Allocations: [{ RefType: 'Against', RefID: items[0].RefID, Amount: 150 }] }]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: d2.jvId }));
  mine = await ess('u-viewer', 'salesCollections');
  assert.deepEqual([mine.balance.Cash, mine.receipts.find(x => x.Number === CASH1).StatusText], [40, 'Handed over']);
  // The clearing account can't change while a rep still holds cash on it.
  assert.match(await err(call('u-admin', 'saveSalesRepSettings', { companyId: 'C1', clearingAccountId: 'A-INV' })), /Sam Seller still holds cash/);
});

let CHQ;
test('a cheque: a PDC Received posted at once, with the rep; the office ticks it received, then deposits it', async () => {
  assert.match(await err(ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cheque', amount: '200', cheque: { number: '', date: TODAY, bank: 'Sample Bank' } })), /Enter the cheque number/);
  const inv2 = (await ess('u-viewer', 'salesInvoices', { customerId: 'CU1' })).invoices[0];
  const r = ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cheque', amount: '200', invoices: [{ refId: inv2.RefID, amount: '200' }], cheque: { number: '900001', date: TODAY, bank: 'Sample Bank' } }));
  CHQ = r.number;
  assert.equal(CHQ, 'RC-SS-000003', 'cash and cheques share the rep\'s series');
  const rc = await receipt(CHQ);
  const p = await val('pdcCheques/' + rc.PdcID);
  assert.deepEqual([p.Status, p.WithRep, p.RepEmployeeID, p.RepReceiptNumber, p.Amount, p.Reference], ['Pending', true, 'E1', CHQ, 200, CHQ]);
  assert.deepEqual(rc.Settles, [{ Number: 'CINV-26-01-000002', Amount: 200 }]);
  let mine = await ess('u-viewer', 'salesCollections');
  assert.deepEqual([mine.balance.ChequeTotal, mine.balance.Cheques.map(c => [c.Number, c.ChequeNumber, c.Customer])], [200, [[CHQ, '900001', 'Corner Shop']]]);
  // Still with the rep: not deposited, so neither cleared nor bounced.
  assert.match(await err(call('u-admin', 'clearPdcs', { pdcIds: [rc.PdcID], clearDate: TODAY, depositAccountId: 'A-BANK' })), /still with the sales rep/);
  assert.match(await err(call('u-admin', 'bouncePdc', { pdcId: rc.PdcID, date: TODAY, reason: 'x' })), /still with the sales rep/);
  assert.match(await err(call('u-viewer', 'receivePdcsFromRep', { pdcIds: [rc.PdcID] })), /permission/i);
  ok(await call('u-admin', 'receivePdcsFromRep', { pdcIds: [rc.PdcID] }));
  const after = await val('pdcCheques/' + rc.PdcID);
  assert.deepEqual([after.WithRep, after.History.map(h => h.Event)], [false, ['Posted', 'Received from the rep']]);
  mine = await ess('u-viewer', 'salesCollections');
  assert.deepEqual([mine.balance.ChequeTotal, mine.receipts.find(x => x.Number === CHQ).StatusText], [0, 'Handed over']);
  ok(await call('u-admin', 'clearPdcs', { pdcIds: [rc.PdcID], clearDate: TODAY, depositAccountId: 'A-BANK' }));
  assert.equal((await ess('u-viewer', 'salesCollections')).receipts.find(x => x.Number === CHQ).StatusText, 'Cleared');
});

test('cancelling: the office only, with Cash & Bank\'s post right; not cash the cashier has taken; the number stays', async () => {
  assert.match(await err(call('u-viewer', 'cancelRepReceipt', { number: CASH2, reason: 'Wrong customer' })), /Cash & Bank's post right|access/);
  assert.match(await err(call('u-admin', 'cancelRepReceipt', { number: CASH2, reason: '' })), /Give the reason/);
  assert.match(await err(call('u-admin', 'cancelRepReceipt', { number: CASH1, reason: 'Wrong amount' })), /cashier has already taken this cash .*reverse that Cash Receipt first/);
  const before = (await openOf('Customer', 'CU1')).filter(i => i.Side === 'Cr').map(i => [i.Number, i.Outstanding]);
  ok(await call('u-admin', 'cancelRepReceipt', { number: CASH2, reason: 'Wrong customer' }));
  const rc = await receipt(CASH2);
  assert.deepEqual([rc.Status, rc.CancelReason, rc.CancelNumber], ['Cancelled', 'Wrong customer', 'RC-SS-000002-C']);
  assert.equal((await jv(rc.JVID)).ReversedByJV, rc.CancelJVID);
  const after = (await openOf('Customer', 'CU1')).filter(i => i.Side === 'Cr').map(i => [i.Number, i.Outstanding]);
  assert.deepEqual(after, before.filter(x => x[0] !== 'RC-SS-000002'), 'the customer\'s 40 on account is gone');
  const mine = await ess('u-viewer', 'salesCollections');
  assert.deepEqual([mine.balance.Cash, mine.receipts.find(x => x.Number === CASH2).StatusText], [0, 'Cancelled']);
  assert.match(await err(call('u-admin', 'cancelRepReceipt', { number: CASH2, reason: 'Again' })), /already cancelled/);
  // A cheque receipt: its PDC cancelled (Pending only: this one has cleared).
  assert.match(await err(call('u-admin', 'cancelRepReceipt', { number: CHQ, reason: 'x' })), /has cleared/);
  const c2 = ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cheque', amount: '25', cheque: { number: '900002', date: TODAY, bank: 'Sample Bank' } }));
  ok(await call('u-admin', 'cancelRepReceipt', { number: c2.number, reason: 'Unsigned cheque' }));
  const p = await val('pdcCheques/' + (await receipt(c2.number)).PdcID);
  assert.deepEqual([p.Status, p.WithRep, (await receipt(c2.number)).Status], ['Cancelled', false, 'Cancelled']);
  // The next receipt goes on from the last number: none is reused.
  assert.equal(ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cash', amount: '5' })).number, 'RC-SS-000005');
});

test('the portal: a receipt shared again is the rep\'s own; the office sees each rep\'s receipts and balance', async () => {
  const again = await ess('u-viewer', 'salesReceipt', { number: CASH1 });
  assert.deepEqual([again.receipt.Number, again.receipt.Settles.length], [CASH1, 2]);
  assert.match(await err(ess('u-approver', 'salesReceipt', { number: CASH1 })), /Receipt not found/, 'another rep can\'t read it');
  const office = await call('u-admin', 'getRepReceipts', { employeeId: 'E1' });
  assert.deepEqual([office.canCancel, office.balance.Cash, office.receipts.map(r => r.Number)], [true, 5, ['RC-SS-000005', 'RC-SS-000004', CHQ, CASH2, CASH1]]);
  const reps = await call('u-admin', 'getSalesReps', { companyId: 'C1' });
  assert.equal(reps.reps.find(r => r.EmployeeID === 'E1').Balance.Cash, 5);
});
