// Life-of-project budgets, budget step B5 (docs/modules/BUDGET.md, Q343,
// Q357-Q359), on the emulators: only where the company keeps them; one
// amount per P&L account for the project's life; approved and revised as a
// year's budget; its report against all the project's actuals; a Vendor
// Invoice carrying the project checked against what is left of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
const bill = (date, amount) => call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: date, Description: 'Bill', VendorRefNumber: 'B-' + amount, CompanyID: 'C1',
  VendorID: 'V1', CostCenterID: 'CC1', ProjectID: 'P1', SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: amount, Description: 'Freight', CostCenterID: 'CC1' }] } })
  .then(s => { assert.equal(s.success, true, s.error); return s.invoiceId; });

test('a project\'s life budget: kept where the company does, approved, revised; its report; an invoice of the project checked against it', async () => {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.orgUnits.P1 = { Type: 'Project', Code: 'P1', Name: 'Tower', CompanyID: 'C1', Status: 'Active' };
  await reset(f);

  assert.match(await err(call('u-admin', 'createBudget', { companyId: 'C1', projectId: 'P1' })), /budgets projects within each year/);
  await call('u-admin', 'saveBudgetSetup', { companyId: 'C1', ProjectBudgets: 'LifeOfProject' });
  const o = await call('u-admin', 'createBudget', { companyId: 'C1', projectId: 'P1' });
  assert.equal(o.number, 'Project budget P1 Original');
  assert.match(await err(call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-CASH', Amounts: [5] }] })), /a project budget is of revenue and costs/);
  assert.match(await err(call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-FRT', Amounts: Array(12).fill(1) }] })), /one amount/);
  const saved = await call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-FRT', CostCenterID: 'CC1', Amounts: [1000] }, { AccountID: 'A-REV', Amounts: [5000] }] });
  assert.equal(saved.total, 1000);
  const b = await call('u-admin', 'getBudget', { budgetId: o.budgetId });
  assert.deepEqual(b.Lines.map(l => [l.AccountID, l.CostCenterID, l.ProjectID]), [['A-FRT', '', 'P1'], ['A-REV', '', 'P1']], 'the project\'s own, no cost centre');
  assert.equal((await call('u-admin', 'submitBudget', { budgetId: o.budgetId })).status, 'Approved');

  // Within it: posted (no year's budget, the life budget only).
  const i1 = await bill('2026-10-10', 700);
  assert.equal((await call('u-admin', 'postVendorInvoice', { invoiceId: i1 })).success, true);
  const r = await call('u-viewer', 'getProjectBudgetReport', { budgetId: o.budgetId });
  const frt = r.rows.find(x => x.AccountID === 'A-FRT');
  assert.deepEqual([frt.Budget, frt.Actual, frt.Left, frt.Used], [1000, 700, 300, 70]);
  assert.match(await err(call('u-admin', 'getBudgetVsActual', { budgetId: o.budgetId })), /compared in its own report/);

  // Over what is left: warned (the company's check), named for the project's life.
  const i2 = await bill('2026-10-20', 500);
  assert.match((await call('u-admin', 'postVendorInvoice', { invoiceId: i2 })).error,
    /^Over budget \(warning\) for the life of project P1 Tower \(Project budget P1 Original\): 6100 Freight: budget 1,000\.00, spent 700\.00, this document 500\.00, over by 200\.00\. Continue anyway\?/);
  assert.equal((await call('u-admin', 'postVendorInvoice', { invoiceId: i2, budgetConsent: { go: true } })).success, true);

  // A revision starts from the Current one.
  const rv = await call('u-admin', 'createBudget', { companyId: 'C1', projectId: 'P1' });
  assert.equal(rv.number, 'Project budget P1 Revision 1');
  assert.equal((await call('u-admin', 'getBudget', { budgetId: rv.budgetId })).Lines.length, 2);
});
