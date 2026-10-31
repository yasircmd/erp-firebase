// The budget's spending check, step B3 (docs/modules/BUDGET.md, Q342,
// Q348-Q352), through the real ported Purchase Order and Vendor Invoice:
// warn (refused until the user goes ahead, then kept on the PO for the
// approvers, no PO number taken before), block (refused; overridden with
// the right and a reason; without the right, refused for good), open POs
// counted as committed or not, a direct invoice line checked, off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const months = (...pairs) => { const a = Array(12).fill(0); for (let i = 0; i < pairs.length; i += 2) a[pairs[i]] = pairs[i + 1]; return a; };
const setup = fields => call('u-admin', 'saveBudgetSetup', Object.assign({ companyId: 'C1' }, fields));
// A PO of `total` (Stationery, CC1) on 2026-10-20 (or `date`), saved; its id.
async function po(total, date) {
  const s = await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: date || '2026-10-20', CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 1, UOM: 'box', UnitPrice: total }] } });
  assert.equal(s.success, true, s.error);
  return s.poId;
}
const submit = (poId, budgetConsent) => call('u-admin', 'submitPurchaseOrder', Object.assign({ poId }, budgetConsent ? { budgetConsent } : {}));

test('Purchase Orders and Vendor Invoices against the budget: warn, block, override, committed, off', async () => {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'DirectExpense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  await reset(f);

  // No budget for the year: nothing is checked (Q351). (A 2025 order: never 2026's committed.)
  await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' }).then(r => call('u-admin', 'deleteBudgetDraft', { budgetId: r.budgetId }));
  const p0 = await po(500, '2025-10-20');
  assert.equal((await submit(p0)).success, true);

  // The budget: Office Expense / CC1, 50 in October.
  const b = await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' });
  await call('u-admin', 'saveBudgetDraft', { budgetId: b.budgetId, lines: [{ AccountID: 'A-EXP', CostCenterID: 'CC1', Amounts: months(9, 50) }] });
  assert.equal((await call('u-admin', 'submitBudget', { budgetId: b.budgetId })).status, 'Approved');

  // Warn (the default): refused, nothing taken, until the user goes ahead.
  await setup({ SpendingCheck: 'Warn', CheckPeriod: 'YTD', Committed: 'Actuals' });
  const p1 = await po(60);
  const w = await submit(p1);
  assert.equal(w.success, false);
  assert.match(w.error, /^Over budget \(warning\) to the end of 2026-10 \(Budget FY 2026 Original\): 6000 Office Expense \/ CC1: budget 50\.00, spent 0\.00, this document 60\.00, over by 10\.00\. Continue anyway\?/);
  const d1 = await val('purchaseOrders/' + p1);
  assert.deepEqual([d1.Status, d1.PONumber || ''], ['Draft', ''], 'nothing taken: no number');
  assert.equal((await submit(p1, { go: true })).success, true);
  const k1 = (await val('purchaseOrders/' + p1)).BudgetCheck;
  assert.deepEqual([k1.Mode, k1.Accepted, k1.Findings[0].Over, k1.By], ['Warn', true, 10, 'admin']);

  // Block, open POs committed: p1's 60 counts; refused, overridden only with a reason.
  await setup({ SpendingCheck: 'Block', Committed: 'ActualsAndPOs' });
  const p2 = await po(20);
  const x = await submit(p2);
  assert.match(x.error, /^Over budget \(blocked; you may override with a reason\).*spent 0\.00, on open orders 60\.00, this document 20\.00, over by 30\.00/);
  assert.match((await submit(p2, { go: true })).error, /^Over budget \(blocked; you may override/, 'no reason: still refused');
  assert.equal((await submit(p2, { go: true, reason: 'Year-end stock of paper' })).success, true);
  const k2 = (await val('purchaseOrders/' + p2)).BudgetCheck;
  assert.deepEqual([k2.Mode, k2.Overridden, k2.Reason], ['Block', true, 'Year-end stock of paper']);

  // Without the right to override: refused for good.
  await rtdb.ref('permissions/BUDGET/override').set([]);
  const p3 = await po(5);
  const y = await submit(p3, { go: true, reason: 'Please' });
  assert.match(y.error, /^Over budget \(blocked\) .*Someone with the right to override the budget can go ahead, or the budget can be revised\./);
  // Counting actuals only: 5 of 50 is within budget.
  await setup({ Committed: 'Actuals' });
  assert.equal((await submit(p3)).success, true);
  assert.equal((await val('purchaseOrders/' + p3)).BudgetCheck || null, null, 'within budget: nothing kept');

  // A Vendor Invoice's direct line, warned; Off: no check.
  await setup({ SpendingCheck: 'Warn' });
  const inv = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: '2026-10-25', Description: 'Bill', VendorRefNumber: 'B-1', CompanyID: 'C1', VendorID: 'V1',
    CostCenterID: 'CC1', SourceGRNs: [], DirectLines: [{ AccountCode: '6000', Amount: 70, Description: 'Toner', CostCenterID: 'CC1' }] } });
  assert.equal(inv.success, true, 'invoice draft: ' + inv.error);
  assert.match((await call('u-admin', 'postVendorInvoice', { invoiceId: inv.invoiceId })).error, /^Over budget \(warning\).*this document 70\.00/);
  await setup({ SpendingCheck: 'Off' });
  assert.equal((await call('u-admin', 'postVendorInvoice', { invoiceId: inv.invoiceId })).success, true);
});
