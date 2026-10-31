// The cash flow forecast, budget step B4 (docs/modules/BUDGET.md, Q345,
// Q353-Q356), on the emulators, as at today: the bank balance now; a
// vendor's bill on its due date, an overdue one apart and not counted; a
// cheque issued on its date; payroll at each month's end from the last run;
// open items only, or the budget for the months after the 13 weeks; no
// budget said when one is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');
const S = require('../../src/recurringSchedule');
const C = require('../../src/budgetCalc');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const today = S.todayIn(S.TIME_ZONE);
async function bill(vendor, date, amount) {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: date, Description: 'Bill', VendorRefNumber: 'B-' + amount, CompanyID: 'C1', VendorID: vendor,
    CostCenterID: 'CC1', SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: amount, Description: 'Freight', CostCenterID: 'CC1' }] } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
}
const at = (f, label, i) => ((f.rows.find(r => r.Label === label) || { Amounts: [] }).Amounts[i] || 0);
const bucketOf = (f, date) => f.buckets.findIndex(b => date >= b.From && date <= b.To);

test('the cash forecast from open items, then with the budget', async () => {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.vendors.V1.PaymentTermsDays = 30;
  // An April-to-March year, so months follow the 13 weeks.
  f.periodClosing = { C1: { Settings: { FiscalYearStart: 'Apr' } } };
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Beta Supplies', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP', PaymentTermsDays: 0 };
  await reset(f);
  await firestore.collection('journalEntries').add({ CompanyID: 'C1', JVDate: C.addDays(today, -40), Status: 'Posted', VoucherType: 'JV', JVNumber: 'JV-OPEN',
    Lines: [{ AccountID: 'A-BANK', Debit: 10000, Credit: 0 }, { AccountID: 'A-EQ', Debit: 0, Credit: 10000 }] });
  await bill('V1', today, 1000); // due in 30 days
  await bill('V2', C.addDays(today, -10), 300); // overdue
  await firestore.collection('pdcCheques').add({ CompanyID: 'C1', Status: 'Pending', Direction: 'Issued', ChequeDate: C.addDays(today, 3), Amount: 200, TransactionNumber: 'PDCI-1' });
  await firestore.collection('payrollRuns').add({ CompanyID: 'C1', Status: 'Posted', Month: C.addMonths(today.slice(0, 7), -1), Net: 5000 });

  await call('u-admin', 'saveBudgetSetup', { companyId: 'C1', CashForecast: 'OpenItems' });
  const o = await call('u-viewer', 'getCashForecast', { companyId: 'C1' });
  // The bank today: 10,000 less the overdue bill? No: the bills are unpaid, nothing has left the bank.
  assert.equal(o.opening, 10000);
  assert.equal(at(o, 'Vendors', bucketOf(o, C.addDays(today, 30))), 1000, 'on its due date');
  assert.deepEqual([o.overdue.Out, o.overdue.Items.length], [300, 1], 'overdue: apart');
  assert.equal(at(o, 'Cheques issued', 0), 200);
  assert.equal(at(o, 'Payroll', bucketOf(o, C.lastDay(today.slice(0, 7)))), 5000, 'at the month\'s end');
  const payrolls = o.rows.find(r => r.Label === 'Payroll').Amounts.filter(v => v).length;
  assert.equal(o.closing[o.closing.length - 1], 10000 - 1000 - 200 - 5000 * payrolls, 'the overdue 300 not counted');
  assert.equal(o.needsBudget, false);

  // With the budget: said when there is none; with one, its cash in the months after the weeks.
  await call('u-admin', 'saveBudgetSetup', { companyId: 'C1', CashForecast: 'OpenItemsAndBudget' });
  assert.equal((await call('u-admin', 'getCashForecast', { companyId: 'C1' })).needsBudget, true);
  const yearStart = require('../../src/periodClosing').yearStartOf(today.slice(0, 7), 'Apr');
  const b = await call('u-admin', 'createBudget', { companyId: 'C1', yearStart });
  await call('u-admin', 'saveBudgetDraft', { budgetId: b.budgetId, lines: [{ AccountID: 'A-REV', Amounts: Array(12).fill(3000) }] });
  await call('u-admin', 'submitBudget', { budgetId: b.budgetId });
  const w = await call('u-admin', 'getCashForecast', { companyId: 'C1' });
  const months = w.buckets.map((x, i) => [x, i]).filter(([x]) => x.Kind === 'month');
  assert.equal(at(w, 'Budget: receipts', 0), 0, 'the weeks: open items');
  const full = months.filter(([x]) => x.From.slice(8) === '01' && x.To === C.lastDay(x.Label));
  assert.ok(full.length >= 1, 'whole months after the weeks');
  full.forEach(([x, i]) => assert.equal(at(w, 'Budget: receipts', i), 3000, x.Label));
  assert.equal(w.budget, 'Budget ' + C.yearLabel(yearStart) + ' Original');
});
