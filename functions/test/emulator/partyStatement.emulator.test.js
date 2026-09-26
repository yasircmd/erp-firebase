// VENDORSOA / CUSTOMERSOA (docs/modules/VENDOR_SOA.md, CUSTOMER_SOA.md)
// through getPartyStatement: opening balance, rows from invoices and
// tagged GL entries (payments, advances, debit/credit notes, reversals) in
// date order with a running balance, open items and aging as at the end
// date (closing balance = open items total), the GL reconciliation line
// (agrees / differs / shared account), validation and access. The
// customer test runs last: functions/test/ui/partyStatement.ui.js uses
// the data it leaves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-SRET'] = { AccountCode: '410000', AccountName: 'Sales Returns & Discounts', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.coa['A-PRV'] = { AccountCode: '5200', AccountName: 'Purchase Return Variance', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { PurchaseReturnVarianceAccountID: 'A-PRV' });
  f.vendors.V1.PaymentTermsDays = 30;
  f.vendors.V9 = { VendorCode: 'V009', VendorName: 'C2 Vendor', Status: 'Active', CompanyID: 'C2', TradePayablesAccountID: 'A-AP' };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 15 } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' } };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  const line = (wh, dir, qty, cost, extra) => Object.assign({ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', ItemName: 'Steel Sheet', WarehouseID: wh,
    Direction: dir, Quantity: qty, UnitCost: cost, TotalValue: qty * cost, CostCenterID: 'CC1', Description: 'Line' }, extra || {});
  f.stock = {
    transactions: {
      G1: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionNumber: 'GRN-1', TransactionDate: '2026-04-15',
        Description: 'Receipt', Lines: [line('WH1', 'In', 10, 20)] },
      N1: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'DN-1', TransactionDate: '2026-05-01',
        Description: 'Delivery', Lines: [line('WH1', 'Out', 10, 20, { UnitPrice: 50 })] }
    },
    ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } } }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const err = async (p) => (await p.catch(e => e)).message;
async function bill(date, amount, extra) {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: Object.assign({
    InvoiceDate: date, Description: 'Bill ' + amount, VendorRefNumber: 'B-' + amount, CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: amount, Description: 'Freight', CostCenterID: 'CC1' }] }, extra || {}) }));
  const p = ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  return { id: s.invoiceId, ref: 'VendorInvoice:' + s.invoiceId, number: p.invoiceNumber };
}
async function cbt(type, date, account, party, amount, allocations) {
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: type, SelectedAccountCode: '1100', JVDate: date,
    Description: type, CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: account, Amount: amount, Description: type, PartyType: party[0], PartyID: party[1], Allocations: allocations }] } }));
  return ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}
const statement = (partyType, partyId, fromDate, toDate, uid, companyId) => call(uid || 'u-admin', 'getPartyStatement',
  { partyType, partyId, companyId: companyId || 'C1', fromDate, toDate });
const rowsOf = s => s.Rows.map(r => [r.Date, r.Type + (r.IsReversal ? '*' : r.Reversed ? '~' : ''), r.Debit, r.Credit, r.Balance]);
const aging = s => Object.fromEntries(s.Aging.map(b => [b.key, b.amount]));

test('validation and access', async () => {
  await reset(fixture());
  assert.match(await err(statement('Vendor', 'V1', '2026-05-01', '2026-04-01')), /start date is after the end date/);
  assert.match(await err(statement('Vendor', 'V1', '', '2026-04-01')), /Select a date range/);
  assert.match(await err(statement('Vendor', '', '2026-01-01', '2026-04-01')), /Select a Vendor/);
  assert.match(await err(statement('Supplier', 'V1', '2026-01-01', '2026-04-01')), /Party type must be Vendor or Customer/);
  assert.match(await err(statement('Vendor', 'NOPE', '2026-01-01', '2026-04-01')), /Vendor not found/);
  assert.match(await err(statement('Vendor', 'V9', '2026-01-01', '2026-04-01')), /belongs to a different company/);
  assert.match(await err(statement('Vendor', 'V1', '2026-01-01', '2026-04-01', 'u-other')), /do not have access to that company/);
  // Viewer can read statements; without the module's access, nobody can.
  const empty = await statement('Vendor', 'V1', '2026-01-01', '2026-04-01', 'u-viewer');
  assert.deepEqual([empty.Opening, empty.Rows, empty.Closing, empty.OpenItems], [0, [], 0, []]);
  await (require('./_helpers').rtdb).ref('permissions/CUSTOMERSOA/access').set(['Admin']);
  assert.match(await err(statement('Customer', 'CU1', '2026-01-01', '2026-04-01', 'u-viewer')), /do not have access to the Customer Statement of Account/);
});

test('vendor: rows, running balance, open items and aging as at the end date, reconciliation', async () => {
  await reset(fixture());
  const a = await bill('2026-01-10', 1000);
  await cbt('Bank Payment', '2026-02-01', '2000', ['Vendor', 'V1'], 600, [{ RefType: 'Against', RefID: a.ref, Amount: 600 }]);
  const b = await bill('2026-03-05', 400);
  const adv = await cbt('Bank Payment', '2026-03-20', '2000', ['Vendor', 'V1'], 150, []);
  const c = await bill('2026-04-10', 200);
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: c.id, reversalDate: '2026-04-12' }));
  const d = await bill('2026-04-15', 0, { SourceGRNs: [{ GRNID: 'G1' }], DirectLines: [] }); // 10 × 20 = 200
  const dn = ok(await call('u-admin', 'savePurchaseReturnDraft', { TransactionDate: '2026-04-20', Description: 'Two back', CompanyID: 'C1', VendorID: 'V1',
    SourceInvoiceID: d.id, Lines: [{ SourceGRNID: 'G1', SourceGRNLineNo: 1, Quantity: 2 }] }));
  const dbn = ok(await call('u-admin', 'postPurchaseReturn', { returnId: dn.returnId }));

  const s = await statement('Vendor', 'V1', '2026-03-01', '2026-04-30');
  // Opening: bill A 1000 less its 600 payment.
  assert.equal(s.Opening, 400);
  assert.deepEqual(rowsOf(s), [
    ['2026-03-05', 'Invoice', 0, 400, 800],
    ['2026-03-20', 'Bank Payment', 150, 0, 650],
    ['2026-04-10', 'Invoice~', 0, 200, 850],
    ['2026-04-12', 'Invoice Reversal*', 200, 0, 650],
    ['2026-04-15', 'Invoice', 0, 200, 850],
    ['2026-04-20', 'Debit Note', 40, 0, 810]
  ]);
  assert.deepEqual([s.Closing, s.Totals, s.BalanceLabel], [810, { Debit: 390, Credit: 800 }, 'Payable to vendor']);
  assert.equal(s.Rows[5].Number, dbn.returnNumber);

  // Open items as at 30 April, signed as payable: A 400 (due 9 Feb, 80 days),
  // B 400 (due 4 Apr, 26), the advance −150 (20 Mar, 41), D 160 (due 15 May).
  assert.deepEqual(s.OpenItems.map(i => [i.Number, i.Type, i.DueDate, i.DaysOverdue, i.Amount, i.Outstanding]), [
    [a.number, 'Invoice', '2026-02-09', 80, 1000, 400],
    [adv.jvNumber, 'Open credit', '2026-03-20', 41, -150, -150],
    [b.number, 'Invoice', '2026-04-04', 26, 400, 400],
    [d.number, 'Invoice', '2026-05-15', 0, 200, 160]
  ]);
  assert.deepEqual(aging(s), { notDue: 160, d1_30: 400, d31_60: -150, d61_90: 400, d90plus: 0 });
  assert.equal(s.OpenTotal, s.Closing, 'every tagged amount is allocated, so open items add up to the balance');
  assert.deepEqual(s.Reconciliation, { status: 'ok', AccountCode: '2000', AccountName: 'Trade Payables', Balance: 810, Difference: 0 });

  // As at the end of January the payment hadn't happened: A fully open.
  const jan = await statement('Vendor', 'V1', '2026-01-01', '2026-01-31');
  assert.deepEqual([jan.Opening, jan.Closing, jan.OpenItems.map(i => [i.Number, i.Outstanding])], [0, 1000, [[a.number, 1000]]]);

  // An old untagged payment on the vendor's account shows as a difference.
  await firestore.collection('journalEntries').doc('OLDPAY').set({ Status: 'Posted', CompanyID: 'C1', JVDate: '2026-04-01', VoucherType: 'JV', JVNumber: 'JV-OLD',
    Lines: [{ LineNo: 1, AccountID: 'A-AP', AccountCode: '2000', Debit: 50, Credit: 0 }, { LineNo: 2, AccountID: 'A-BANK', AccountCode: '1100', Debit: 0, Credit: 50 }] });
  const withOld = await statement('Vendor', 'V1', '2026-03-01', '2026-04-30');
  assert.deepEqual([withOld.Closing, withOld.Reconciliation.Balance, withOld.Reconciliation.Difference], [810, 760, 50]);
});

test('customer: invoice, receipt and credit note on the debit side; reconciliation; shared account', async () => {
  await reset(fixture());
  const s1 = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: '2026-05-01', Description: 'Sale', CompanyID: 'C1', CustomerID: 'CU1',
    CostCenterID: 'CC1', SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }], DirectLines: [] } }));
  const inv = ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s1.invoiceId }));
  await cbt('Bank Receipt', '2026-05-10', '1200', ['Customer', 'CU1'], 200, [{ RefType: 'Against', RefID: 'CustomerInvoice:' + s1.invoiceId, Amount: 200 }]);
  const sr = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: '2026-05-20', Description: 'Two back', CompanyID: 'C1', CustomerID: 'CU1',
    SourceInvoiceID: s1.invoiceId, Lines: [{ SourceDNID: 'N1', SourceDNLineNo: 1, Quantity: 2 }] }));
  ok(await call('u-admin', 'postSalesReturn', { returnId: sr.returnId }));

  const s = await statement('Customer', 'CU1', '2026-05-01', '2026-05-31');
  assert.deepEqual(rowsOf(s), [
    ['2026-05-01', 'Invoice', 500, 0, 500],
    ['2026-05-10', 'Bank Receipt', 0, 200, 300],
    ['2026-05-20', 'Credit Note', 0, 100, 200]
  ]);
  assert.deepEqual([s.Opening, s.Closing, s.BalanceLabel], [0, 200, 'Receivable from customer']);
  assert.deepEqual(s.OpenItems.map(i => [i.Number, i.DueDate, i.DaysOverdue, i.Outstanding]), [[inv.invoiceNumber, '2026-05-16', 15, 200]]);
  assert.deepEqual(aging(s), { notDue: 0, d1_30: 200, d31_60: 0, d61_90: 0, d90plus: 0 });
  assert.deepEqual([s.Reconciliation.status, s.Reconciliation.Balance, s.Reconciliation.Difference], ['ok', 200, 0]);

  // Once another party uses the same control account, no comparison.
  await (require('./_helpers').rtdb).ref('customers/CU2').set({ CustomerCode: 'C002', CustomerName: 'Other', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' });
  assert.deepEqual((await statement('Customer', 'CU1', '2026-05-01', '2026-05-31')).Reconciliation, { status: 'shared', AccountCode: '1200' });
});
