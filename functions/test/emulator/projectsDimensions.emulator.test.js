// Projects, and which accounts need a cost center, profit center or project
// (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, decisions
// 219-224): with no rule, today's rule (an expense needs a cost center);
// a rule set on a heading is followed by its accounts and an account may
// differ; a required one missing is refused, a not-used one dropped; a
// project is an Organizational Unit with a customer and dates, and a
// Closed one takes no new postings (its reversals still post); invoices
// carry their project to every line; the GL Report, Trial Balance and the
// Project report filter or group by project, "No project" included.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-09-10';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const journal = (lines, extra) => call('u-admin', 'saveJournalDraft', { jvData: Object.assign({ JVDate: D, Description: 'Site costs', CompanyID: 'C1', Lines: lines }, extra) });
const line = (code, debit, credit, extra) => Object.assign({ AccountCode: code, Debit: debit, Credit: credit, Description: 'x' }, extra);
let P1;

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'G-SITE': { AccountCode: '630000', AccountName: 'Site expenses', AccountType: 'Expense', Status: 'Active', IsPostable: false },
    'A-SITE': { AccountCode: '630001', AccountName: 'Site labour', AccountType: 'Expense', Status: 'Active', IsPostable: true, ParentAccountID: 'G-SITE' },
    'A-RENT': { AccountCode: '640001', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Tower Client', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0 } };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Contract', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  await reset(f);
});

test('no rule: as before — an expense needs a cost center, the rest optional', async () => {
  assert.match(await err(journal([line('640001', 10, 0), line('1100', 0, 10)])), /Line 1: account 640001 \(Expense\) requires a Cost Center\./);
  ok(await journal([line('640001', 10, 0, { CostCenterID: 'CC1' }), line('1100', 0, 10)]));
});

test('projects: an Organizational Unit with a customer and dates; Closed is a project\'s only', async () => {
  const unit = d => call('u-admin', 'saveOrgUnit', { unitData: Object.assign({ Type: 'Project', Code: 'PRJ-1', Name: 'Tower A', CompanyID: 'C1', Status: 'Active' }, d) });
  assert.match((await unit({ StartDate: '2026-09-30', EndDate: '2026-09-01' })).error, /The project ends before it starts/);
  assert.match((await unit({ CustomerID: 'NOPE' })).error, /Choose a customer of Customer Master/);
  assert.match((await call('u-admin', 'saveOrgUnit', { unitData: { Type: 'CostCenter', Code: 'CC-X', Name: 'X', CompanyID: 'C1', Status: 'Closed' } })).error, /Only a project is Closed/);
  const r = ok(await unit({ CustomerID: 'CU1', StartDate: '2026-09-01', EndDate: '2026-12-31' }));
  P1 = r.unitId;
  const u = await val('orgUnits/' + P1);
  assert.deepEqual([u.Type, u.CustomerID, u.StartDate, u.EndDate], ['Project', 'CU1', '2026-09-01', '2026-12-31']);
  assert.ok((await call('u-admin', 'getActiveOrgUnits', {})).some(x => x.UnitID === P1 && x.Type === 'Project'));
});

test('a heading\'s rule, followed by its accounts: site labour needs a project, not a cost center; the profit center not used', async () => {
  const acct = async (id, rules) => ok(await call('u-admin', 'saveAccount', { accountData: Object.assign({}, await val('coa/' + id), { AccountID: id, DimensionRules: rules }) }));
  assert.match((await call('u-admin', 'saveAccount', { accountData: Object.assign({}, await val('coa/G-SITE'), { AccountID: 'G-SITE', DimensionRules: { Project: 'Sometimes' } }) })).error, /Project must be Required, Optional or Not used/);
  await acct('G-SITE', { CostCenter: 'Optional', ProfitCenter: 'NotUsed', Project: 'Required' });
  assert.deepEqual((await val('coa/G-SITE')).DimensionRules, { CostCenter: 'Optional', ProfitCenter: 'NotUsed', Project: 'Required' });
  assert.match(await err(journal([line('630001', 100, 0), line('1100', 0, 100)])), /Line 1: account 630001 requires a Project\./);
  const s = ok(await journal([line('630001', 100, 0, { ProjectID: P1, ProfitCenterID: 'PC1' }), line('1100', 0, 100)]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  const l = (await jv(s.jvId)).Lines.find(x => x.AccountCode === '630001');
  assert.deepEqual([l.ProjectID, l.CostCenterID, l.ProfitCenterID], [P1, '', ''], 'no cost center needed; the profit center not used, dropped');
  // An account may differ from its heading: rent (no heading) made to need a project too.
  await acct('A-RENT', { Project: 'Optional', CostCenter: 'Optional' });
  ok(await journal([line('640001', 10, 0), line('1100', 0, 10)]));
});

test('an invoice\'s project goes on every line it posts', async () => {
  const s = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Stage 1', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', ProjectID: P1,
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 500, Description: 'Stage 1', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } }));
  assert.equal((await val('customerInvoices/' + s.invoiceId)).ProjectID, P1);
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const e = await jv((await val('customerInvoices/' + s.invoiceId)).LinkedJVID);
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.ProjectID]).sort(), [['1200', P1], ['4000', P1]]);
});

test('the Project report, the GL Report and the Trial Balance by project, "No project" included', async () => {
  // A posted cost with no project.
  const np = ok(await journal([line('640001', 10, 0), line('1100', 0, 10)]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: np.jvId }));
  const r = await call('u-admin', 'getProjectReport', { params: { CompanyID: 'C1', FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  const p = r.projects.find(x => x.ProjectID === P1), none = r.projects.find(x => !x.ProjectID);
  assert.deepEqual([p.Code, p.Income, p.Costs, p.Result], ['PRJ-1', 500, 100, 400]);
  assert.deepEqual(p.Accounts.map(a => [a.AccountCode, a.Kind, a.Amount]), [['4000', 'Income', 500], ['630001', 'Costs', 100]]);
  assert.deepEqual([none.Name, none.Costs], ['No project', 10]);
  const only = await call('u-admin', 'getProjectReport', { params: { CompanyID: 'C1', FromDate: '2026-09-01', ToDate: '2026-09-30', ProjectID: P1 } });
  assert.deepEqual(only.projects.map(x => x.ProjectID), [P1]);
  const tb = await call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30', CompanyID: 'C1', ProjectID: P1 } });
  assert.deepEqual(tb.rows.map(x => x.AccountCode).sort(), ['1100', '1200', '4000', '630001'].filter(c => c !== '1100'), 'the bank line has no project');
  const gl = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-SITE', FromDate: '2026-09-01', ToDate: '2026-09-30', ProjectID: '__none__' } });
  assert.equal(gl.rows.length, 0, 'every site labour line has a project');
});

test('a closed project takes no new postings; a reversal of its entry still posts', async () => {
  const posted = ok(await journal([line('630001', 40, 0, { ProjectID: P1 }), line('1100', 0, 40)]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: posted.jvId }));
  ok(await call('u-admin', 'saveOrgUnit', { unitData: Object.assign({}, await val('orgUnits/' + P1), { UnitID: P1, Status: 'Closed' }) }));
  assert.match(await err(journal([line('630001', 5, 0, { ProjectID: P1 }), line('1100', 0, 5)])), /Line 1: project PRJ-1 is closed: it takes no new postings/);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: posted.jvId, reversalDate: D }));
});
