// Budget and forecast, step B1 (docs/modules/BUDGET.md, Q338-Q345), on the
// emulators: a company's budget for its year, lines per account and cost
// centre, refused when wrong; submitted and approved through Approval
// Configuration (the approval card's way too); a Revision from the Current
// one, approved over it, the Original kept; Budget vs Actual against the
// posted entries; a start from last year's actuals; Budget Setup's method
// kept by the budget made with it; a Viewer reads, never prepares.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
const months = (...pairs) => { const a = Array(12).fill(0); for (let i = 0; i < pairs.length; i += 2) a[pairs[i]] = pairs[i + 1]; return a; };
const post = (date, lines, type) => firestore.collection('journalEntries').add({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: type || 'JV', JVNumber: 'JV-' + date,
  Lines: lines.map(([AccountID, Debit, Credit, CostCenterID]) => ({ AccountID, Debit, Credit, CostCenterID: CostCenterID || '' })) });

test('a budget: prepared, approved, revised over; against the actuals; from last year', async () => {
  const f = baseFixture();
  f.coa['A-RENT'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-LOAN'] = { AccountCode: '2500', AccountName: 'Bank Loan', AccountType: 'Liability', Status: 'Active', IsPostable: true, DimensionRules: { CostCenter: 'NotUsed' } };
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.approvalConfigurations = { BUDGET: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { BUDGET: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  await post('2025-03-10', [['A-RENT', 900, 0, 'CC1'], ['A-CASH', 0, 900]]);
  await post('2026-01-10', [['A-BANK', 5000, 0], ['A-REV', 0, 5000]]);
  await post('2026-01-20', [['A-RENT', 1100, 0, 'CC1'], ['A-RENT', 70, 0, 'CC2'], ['A-BANK', 0, 1170]]);
  await post('2026-02-01', [['A-LOAN', 200, 0], ['A-BANK', 0, 200]]);

  const s = await call('u-admin', 'getBudgetSetup', { companyId: 'C1' });
  assert.deepEqual([s.rights.canWrite, s.rights.canSetup, s.fiscalYearStart, s.setup.BalanceSheet], [true, true, 'Jan', 'Movements']);
  assert.ok(s.accounts.some(a => a.AccountID === 'A-LOAN' && a.UsesCostCenter === false));
  assert.deepEqual(s.costCenters.map(c => c.Code), ['CC1', 'CC2']);
  const v = await call('u-viewer', 'getBudgetSetup', { companyId: 'C1' });
  assert.equal(v.rights.canWrite, false);
  assert.match(await err(call('u-viewer', 'createBudget', { companyId: 'C1', yearStart: '2026-01' })), /permission to prepare/);
  assert.match(await err(call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-04' })), /starts in January/);

  const o = await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' });
  assert.equal(o.number, 'Budget FY 2026 Original');
  const lines = [{ AccountID: 'A-REV', Amounts: months(0, 4000, 1, 4000) }, { AccountID: 'A-RENT', CostCenterID: 'CC1', Amounts: months(0, 1000) }, { AccountID: 'A-LOAN', Amounts: months(1, -250) }];
  assert.match(await err(call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: lines.concat([lines[1]]) })), /Line 4: 6100 \/ CC1 is on the budget twice/);
  assert.match(await err(call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-LOAN', CostCenterID: 'CC1', Amounts: months() }] })), /does not use cost centres/);
  const saved = await call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines, notes: 'First plan' });
  assert.deepEqual([saved.lines, saved.total], [3, 1000], 'the approval amount: the budgeted costs');

  assert.equal((await call('u-admin', 'submitBudget', { budgetId: o.budgetId })).status, 'PendingApproval');
  assert.match(await err(call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' })), /still waiting for approval/);
  // The approver, as Home and the phone's approval card do.
  const task = (await call('u-approver', 'getPendingApprovalsForUser', {})).find(x => x.DocumentID === o.budgetId);
  assert.ok(task, 'on the approver\'s Home');
  const card = await call('u-approver', 'getApprovalSummary', { instanceId: task.InstanceID });
  assert.deepEqual([card.Amount, card.Lines.length, card.Lines[0].Amount, card.Decide.fn, card.Decide.id], [1000, 3, 8000, 'decideBudgetApproval', 'budgetId']);
  assert.equal((await call('u-approver', card.Decide.fn, { budgetId: o.budgetId, levelNumber: 1, decision: 'Approved', reason: '' })).status, 'Approved');
  const orig = await call('u-admin', 'getBudget', { budgetId: o.budgetId });
  assert.deepEqual([orig.Status, orig.Current, orig.BalanceSheetMethod], ['Approved', true, 'Movements']);
  assert.match(await err(call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines })), /Only a draft or rejected/);

  // Budget Setup changes; the Original keeps its method, the revision follows the Original.
  await call('u-admin', 'saveBudgetSetup', { companyId: 'C1', BalanceSheet: 'Closing' });
  const r = await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' });
  assert.equal(r.number, 'Budget FY 2026 Revision 1');
  const rev = await call('u-admin', 'getBudget', { budgetId: r.budgetId });
  assert.deepEqual([rev.Lines.length, rev.BalanceSheetMethod], [3, 'Movements']);
  await call('u-admin', 'saveBudgetDraft', { budgetId: r.budgetId, lines: rev.Lines.map(l => (l.AccountID === 'A-RENT' ? Object.assign({}, l, { Amounts: months(0, 1200) }) : l)) });
  await call('u-admin', 'submitBudget', { budgetId: r.budgetId });
  await call('u-approver', 'decideBudgetApproval', { budgetId: r.budgetId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.deepEqual([(await call('u-admin', 'getBudget', { budgetId: o.budgetId })).Current, (await call('u-admin', 'getBudget', { budgetId: r.budgetId })).Current], [false, true]);

  // Against the actuals, through February.
  const va = await call('u-viewer', 'getBudgetVsActual', { budgetId: r.budgetId, through: '2026-02' });
  const row = (acc, cc) => va.rows.find(x => x.AccountID === acc && x.CostCenterID === (cc || ''));
  assert.deepEqual([row('A-REV').YtdBudget, row('A-REV').YtdActual, row('A-REV').Favour], [8000, 5000, -1]);
  assert.deepEqual([row('A-RENT', 'CC1').MonthBudget, row('A-RENT', 'CC1').YtdActual, row('A-RENT', 'CC1').Favour], [0, 1100, 1]);
  assert.deepEqual([row('A-RENT', 'CC2').Budgeted, row('A-RENT', 'CC2').YtdActual], [false, 70], 'not budgeted');
  assert.deepEqual([row('A-LOAN').Opening, row('A-LOAN').YtdActual, row('A-LOAN').BudgetBalance[1]], [0, -200, -250]);
  assert.equal(row('A-RENT', 'CC1').CostCenter, 'CC1 Workshop');
  assert.deepEqual(va.versions.map(x => [x.Number, x.Current]), [['Budget FY 2026 Original', false], ['Budget FY 2026 Revision 1', true]]);

  // Next year from this year's actuals, +10%, per cost centre.
  const seed = await call('u-admin', 'getBudgetSeed', { companyId: 'C1', yearStart: '2027-01', source: 'actual', pct: 10 });
  assert.deepEqual(seed.lines.filter(l => l.AccountID === 'A-RENT').map(l => [l.CostCenterID, l.Amounts[0]]).sort(), [['CC1', 1210], ['CC2', 77]]);
  assert.equal(seed.lines.some(l => l.AccountID === 'A-LOAN'), false, 'the P&L only');
  const fromBudget = await call('u-admin', 'getBudgetSeed', { companyId: 'C1', yearStart: '2027-01', source: 'budget', pct: 0 });
  assert.equal(fromBudget.from, 'Budget FY 2026 Revision 1');
});

test('a rejected budget goes back to be changed; a draft deleted', async () => {
  const f = baseFixture();
  f.approvalConfigurations = { BUDGET: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { BUDGET: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const o = await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' });
  await call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-CONS', CostCenterID: 'CC1', Amounts: months(0, 10) }] });
  await call('u-admin', 'submitBudget', { budgetId: o.budgetId });
  assert.match(await err(call('u-approver', 'decideBudgetApproval', { budgetId: o.budgetId, levelNumber: 1, decision: 'Rejected', reason: '' })), /reason is required/);
  await call('u-approver', 'decideBudgetApproval', { budgetId: o.budgetId, levelNumber: 1, decision: 'Rejected', reason: 'Too high' });
  const b = await call('u-admin', 'getBudget', { budgetId: o.budgetId });
  assert.deepEqual([b.Status, b.RejectionReason, b.Current], ['Rejected', 'Too high', false]);
  await call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-CONS', CostCenterID: 'CC1', Amounts: months(0, 8) }] });
  assert.equal((await call('u-admin', 'deleteBudgetDraft', { budgetId: o.budgetId })).success, true);
  assert.match(await err(call('u-admin', 'getBudget', { budgetId: o.budgetId })), /not found/);
});

test('forecasts: from the Current budget, actuals locked, finalised and kept, beside the budget in the report', async () => {
  const f = baseFixture();
  f.coa['A-RENT'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  await reset(f);
  await post('2026-01-10', [['A-BANK', 900, 0], ['A-REV', 0, 900]]);
  await post('2026-02-10', [['A-BANK', 1200, 0], ['A-REV', 0, 1200]]);
  await post('2026-02-15', [['A-RENT', 300, 0, 'CC1'], ['A-BANK', 0, 300]]);
  assert.match(await err(call('u-admin', 'createForecast', { companyId: 'C1', yearStart: '2026-01' })), /approve a budget for FY 2026 first/);
  const o = await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: '2026-01' });
  await call('u-admin', 'saveBudgetDraft', { budgetId: o.budgetId, lines: [{ AccountID: 'A-REV', Amounts: Array(12).fill(1000) }, { AccountID: 'A-RENT', CostCenterID: 'CC1', Amounts: Array(12).fill(250) }] });
  assert.equal((await call('u-admin', 'submitBudget', { budgetId: o.budgetId })).status, 'Approved');
  assert.match(await err(call('u-viewer', 'createForecast', { companyId: 'C1', yearStart: '2026-01' })), /permission to prepare/);

  const c = await call('u-admin', 'createForecast', { companyId: 'C1', yearStart: '2026-01', actualsThrough: '2026-02' });
  assert.equal(c.number, 'Forecast 1 FY 2026 (actuals to 2026-02)');
  const fc = await call('u-admin', 'getForecast', { forecastId: c.forecastId });
  const rev = fc.Lines.find(l => l.AccountID === 'A-REV');
  assert.deepEqual([rev.Amounts[0], rev.Amounts[1], rev.Amounts[2], fc.Revenue, fc.Status], [900, 1200, 1000, 12100, 'Draft']);
  assert.match(await err(call('u-admin', 'createForecast', { companyId: 'C1', yearStart: '2026-01' })), /still a draft/);
  // Revenue ahead lowered; January sent as 5 stays the actual 900; a balance-sheet line refused.
  const lines = fc.Lines.map(l => (l.AccountID === 'A-REV' ? Object.assign({}, l, { Amounts: [5, 5].concat(Array(10).fill(800)) }) : l));
  assert.match(await err(call('u-admin', 'saveForecastDraft', { forecastId: c.forecastId, lines: lines.concat([{ AccountID: 'A-CASH', Amounts: months() }]) })), /not a P&L account/);
  const saved = await call('u-admin', 'saveForecastDraft', { forecastId: c.forecastId, lines });
  assert.deepEqual([saved.Revenue, saved.Costs, saved.Profit], [10100, 2800, 7300]);
  assert.equal((await call('u-admin', 'getForecast', { forecastId: c.forecastId })).Lines.find(l => l.AccountID === 'A-REV').Amounts[0], 900);
  await call('u-admin', 'finaliseForecast', { forecastId: c.forecastId });
  assert.match(await err(call('u-admin', 'saveForecastDraft', { forecastId: c.forecastId, lines })), /Only a draft/);
  assert.match(await err(call('u-admin', 'deleteForecastDraft', { forecastId: c.forecastId })), /Only a draft/);

  // The next one; both listed with their year's profit.
  const c2 = await call('u-admin', 'createForecast', { companyId: 'C1', yearStart: '2026-01', actualsThrough: '2026-01' });
  assert.equal(c2.number, 'Forecast 2 FY 2026 (actuals to 2026-01)');
  const s = await call('u-admin', 'getBudgetSetup', { companyId: 'C1' });
  assert.deepEqual(s.forecasts.map(x => [x.Sequence, x.Status, x.Profit]), [[2, 'Draft', 9150], [1, 'Final', 7300]]);

  const va = await call('u-viewer', 'getBudgetVsActual', { budgetId: o.budgetId, through: '2026-02', forecastId: c.forecastId });
  assert.deepEqual([va.forecast.Number, va.forecasts.map(x => x.Sequence)], ['Forecast 1 FY 2026 (actuals to 2026-02)', [1]], 'only the final ones offered');
  assert.deepEqual(va.rows.filter(r => r.AccountID === 'A-REV').map(r => [r.YearBudget, r.YearForecast]), [[12000, 10100]]);
});
