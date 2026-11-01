// The credit check, step C2 (docs/modules/CREDIT_CONTROL.md, Q362-Q365), on
// the emulators: confirming a Sales Order and posting a Customer Invoice
// against the customer's limit and overdue items, as the company's setting
// says (off, warn, block with the override right and a reason), what went
// ahead kept on the document; a credit hold refusing whatever the setting;
// the approver's card and the rep portal seeing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const errOf = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
const S = require('../../src/recurringSchedule');
const today = S.todayIn(S.TIME_ZONE);
const daysAgo = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

function fixture() {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Alpha Traders', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 30 } };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: '' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 100, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 40, TotalValue: 2000 } } } };
  return f;
}
async function owes(date, amount) {
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: date, Description: 'Refund', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '1200', Amount: amount, Description: 'Refund', PartyType: 'Customer', PartyID: 'CU1', Allocations: [] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}
const order = async qty => ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: today, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
  Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: qty, UnitPrice: 100 }] } })).soId;
const confirm = (soId, consent) => call('u-admin', 'confirmSalesOrder', Object.assign({ soId }, consent ? { budgetConsent: consent } : {}));
const invoice = async amount => ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: today, Description: 'Service', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
  SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: amount, Description: 'Service', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } })).invoiceId;
const post = (invoiceId, consent) => call('u-admin', 'postCustomerInvoice', Object.assign({ invoiceId }, consent ? { budgetConsent: consent } : {}));
const setup = async fields => ok(await call('u-admin', 'saveCreditSetup', Object.assign({ companyId: 'C1' }, fields)));

test('the credit check: off, warn, block and override; overdue; a hold whatever the setting; kept on the document', async () => {
  await reset(fixture());
  await owes(today, 1000);
  ok(await call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU1', limit: 1200 }));

  // Off (to start): over the limit, confirmed all the same.
  const so0 = await order(5);
  ok(await confirm(so0));
  assert.equal((await val('salesOrders/' + so0)).CreditCheck || null, null);
  ok(await call('u-admin', 'cancelSalesOrder', { soId: so0, reason: 'Test' }));

  // Warn: within the limit, nothing; over it, refused until the user continues; kept on the order.
  await setup({ Check: 'Warn' });
  const so1 = await order(1);
  ok(await confirm(so1)); // 1,000 + 100
  const so2 = await order(2);
  assert.match(await errOf(confirm(so2)),
    /^Over credit \(warning\) C001 Alpha Traders: credit limit 1,200\.00, exposure 1,100\.00, this document 200\.00, over by 100\.00\. Continue anyway\? The approvers will see it\.$/);
  assert.equal((await val('salesOrders/' + so2)).Status, 'Draft', 'refused: nothing taken');
  ok(await confirm(so2, { go: true }));
  const kept = (await val('salesOrders/' + so2)).CreditCheck;
  assert.deepEqual([kept.Accepted, kept.Over, kept.Document, kept.By], [true, 100, 200, 'admin']);

  // Block: the override right lets the user go ahead with a reason, not without.
  await setup({ Check: 'Block' });
  const inv = await invoice(300);
  assert.match(await errOf(post(inv)), /^Over credit \(blocked; you may override with a reason\) C001 Alpha Traders: credit limit 1,200\.00, exposure 1,300\.00, this document 300\.00, over by 400\.00\.$/);
  assert.match(await errOf(post(inv, { go: true })), /^Over credit \(blocked; you may override/);
  ok(await post(inv, { go: true, reason: 'Paid by transfer today' }));
  const ci = await val('customerInvoices/' + inv);
  assert.deepEqual([ci.Status, ci.CreditCheck.Overridden, ci.CreditCheck.Reason], ['Posted', true, 'Paid by transfer today']);

  // Overdue past the grace days, with room under the limit.
  ok(await call('u-admin', 'saveCreditLimit', { companyId: 'C1', customerId: 'CU1', limit: '' }));
  await setup({ Check: 'Warn', GraceDays: 10 });
  await owes(daysAgo(60), 50); // an open balance, due on its date: 60 days overdue
  const so3 = await order(1);
  assert.match(await errOf(confirm(so3)), /^Over credit \(warning\) C001 Alpha Traders: 50\.00 overdue, the oldest 60 days past its due date\. Continue anyway/);
  await setup({ GraceDays: 60 });
  ok(await confirm(so3));

  // A hold refuses whatever the setting, consent or not; lifted, the sale goes through.
  ok(await call('u-admin', 'setCreditHold', { companyId: 'C1', customerId: 'CU1', hold: true, reason: 'Cheque returned' }));
  await setup({ Check: 'Off' });
  const so4 = await order(1);
  assert.match(await errOf(confirm(so4, { go: true, reason: 'x' })), /^On credit hold: C001 Alpha Traders \(Cheque returned, admin\)\. Lift the hold in Credit Control/);
  ok(await call('u-admin', 'setCreditHold', { companyId: 'C1', customerId: 'CU1', hold: false }));
  ok(await confirm(so4));
});
