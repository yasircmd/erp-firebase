// Period Closing, step 1a (docs/modules/PERIOD_CLOSING.md, decisions
// 122-131): the Setup per company (financial year, Retained Earnings,
// Block / Warn / Off per checklist item), the month grid of the financial
// year, the checklist (drafts, approvals, recurring, depreciation, payroll,
// PDCs, receivables / payables / stock against the GL, the Trial Balance),
// close in order, reopen with a reason, the log, and the rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const err = async p => (await p.catch(e => e)).message;
const CHECK_KEYS = ['drafts', 'approvals', 'recurring', 'depreciation', 'payroll', 'pdc', 'deliveries', 'receivables', 'payables', 'stock', 'trialBalance'];
const allModes = mode => Object.fromEntries(CHECK_KEYS.map(k => [k, mode]));

function fixture() {
  const f = baseFixture();
  f.coa['A-REG'] = { AccountCode: '320000', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: false };
  f.coa['A-RE'] = { AccountCode: '320001', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'A-REG' };
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  return f;
}
const get = (year, uid) => call(uid || 'u-admin', 'getPeriodClosing', { companyId: 'C1', year });
const checklist = (month, uid) => call(uid || 'u-admin', 'getPeriodClosingChecklist', { companyId: 'C1', month });
const close = (month, uid) => call(uid || 'u-admin', 'closePeriod', { companyId: 'C1', month });
const reopen = (month, reason, uid) => call(uid || 'u-admin', 'reopenPeriod', { companyId: 'C1', month, reason });
const save = (settings, uid) => call(uid || 'u-admin', 'savePeriodClosingSettings', { companyId: 'C1', settings: Object.assign({ FiscalYearStart: 'Jan', RetainedEarningsAccountID: 'A-RE', Checklist: allModes('Warn') }, settings) });
const item = (list, key) => list.Items.find(i => i.Key === key);
const cbtDraft = date => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: date, Description: 'Draft payment', CompanyID: 'C1', CostCenterID: 'CC1',
  OppositeLines: [{ AccountCode: '6100', Amount: 25, Description: 'Freight', CostCenterID: 'CC1' }] } });
const postedEntry = (date, lines) => firestore.collection('journalEntries').add({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: 'JV', JVNumber: 'JV-' + date, Lines: lines });

test('setup: defaults, financial year April-March, Retained Earnings, checklist modes; the grid follows the year', async () => {
  await reset(fixture());
  let r = await get('2026-05');
  assert.deepEqual([r.Settings.FiscalYearStart, r.Settings.RetainedEarningsAccountID, r.Settings.Saved], ['Jan', 'A-RE', false]); // the first account under 320000 by default
  assert.deepEqual(Object.values(r.Settings.Checklist), CHECK_KEYS.map(() => 'Warn'));
  assert.deepEqual([r.Year.Start, r.Year.Label, r.Months.length, r.Months[0].Month, r.Months[11].Month], ['2026-01', '2026', 12, '2026-01', '2026-12']);
  assert.deepEqual(r.EquityAccounts.map(a => a.Code), ['3000', '320001']);
  assert.ok(r.Months.every(m => m.Status === 'Open'));
  assert.deepEqual(r.Rights, { close: true, reopen: true });

  ok(await save({ FiscalYearStart: 'Apr', RetainedEarningsAccountID: 'A-EQ', Checklist: Object.assign(allModes('Warn'), { drafts: 'Block', stock: 'Off' }) }));
  r = await get('2026-02'); // February 2026 falls in the year April 2025 - March 2026
  assert.deepEqual([r.Year.Start, r.Year.Label, r.Months[0].Month, r.Months[11].Month, r.Year.Prev, r.Year.Next], ['2025-04', '2025–26', '2025-04', '2026-03', '2024-04', '2026-04']);
  assert.deepEqual([r.Settings.FiscalYearStart, r.Settings.RetainedEarningsAccountID, r.Settings.Checklist.drafts, r.Settings.Checklist.stock], ['Apr', 'A-EQ', 'Block', 'Off']);
  assert.equal(r.Log[0].Action, 'Setup');

  assert.match(await err(save({ RetainedEarningsAccountID: 'A-REV' })), /Equity account/);
  assert.match(await err(save({ RetainedEarningsAccountID: '' })), /Retained Earnings/);
  assert.match(await err(save({ FiscalYearStart: 'Jul' })), /January or April/);
  assert.match(await err(save({ Checklist: { drafts: 'Maybe' } })), /Block, Warn or Off/);
  // Decision 129: fixed after the first year-end close (step 2 writes YearsClosed).
  await rtdb.ref('periodClosing/C1/YearsClosed/2025-04').set({ At: 'x' });
  assert.match(await err(save({ FiscalYearStart: 'Jan' })), /can't change after/);
  ok(await save({ FiscalYearStart: 'Apr', RetainedEarningsAccountID: 'A-RE' })); // the rest can still change
  assert.equal((await get()).FiscalYearLocked, true);
});

test('rights and company access', async () => {
  await reset(fixture());
  const r = await get('2026-01', 'u-viewer');
  assert.deepEqual(r.Rights, { close: false, reopen: false });
  assert.match(await err(save({}, 'u-viewer')), /permission to close periods or change/);
  assert.match(await err(close('2026-01', 'u-viewer')), /permission to close/);
  ok(await close('2026-01'));
  assert.match(await err(reopen('2026-01', 'x', 'u-viewer')), /permission to reopen/);
  assert.match(await err(get('2026-01', 'u-other')), /access to that company/);
  await rtdb.ref('permissions/PERIODCLOSE/access').set(['Admin']);
  assert.match(await err(get('2026-01', 'u-viewer')), /access to Period Closing/);
});

test('the checklist finds each kind of problem, in the period being closed', async () => {
  await reset(fixture());
  // Drafts and approvals: a CBT draft, a GRN waiting for approval.
  ok(await cbtDraft('2026-04-12'));
  await rtdb.ref('stock/transactions/G-PA').set({ TransactionType: 'GRN', TransactionNumber: 'GRN-9', TransactionDate: '2026-04-03', CompanyID: 'C1', Status: 'PendingApproval', Lines: [] });
  await rtdb.ref('stock/transactions/G-C2').set({ TransactionType: 'GRN', TransactionDate: '2026-04-03', CompanyID: 'C2', Status: 'Draft', Lines: [] }); // another company
  // A recurring journal due on 30 April.
  await rtdb.ref('recurringJournals/R1').set({ CompanyID: 'C1', Status: 'Active', TemplateNumber: 'RJV-1', Description: 'Rent', AmountMode: 'Fixed', Lines: [],
    Schedule: { Frequency: 'MonthEnd', Interval: 1, StartDate: '2026-03-01', EndMode: 'Count', RunCount: 3 }, Runs: { '2026-03-31': { Status: 'Posted' } } });
  // An asset in use, no depreciation run; an active employee, no payroll run.
  await firestore.collection('faAssets').doc('FA1').set({ CompanyID: 'C1', Status: 'Active', CapitalizationDate: '2026-01-15' });
  await firestore.collection('employees').doc('E1').set({ CompanyID: 'C1', Status: 'Active', JoinDate: '2025-01-01' });
  await firestore.collection('employees').doc('E2').set({ CompanyID: 'C1', Status: 'Active', JoinDate: '2026-04-01' }); // joins after March
  // A PDC matured and not cleared.
  await rtdb.ref('pdcCheques/P1').set({ CompanyID: 'C1', Direction: 'Received', Status: 'Pending', TransactionNumber: 'PDCR-1', TransactionDate: '2026-03-01', ChequeDate: '2026-04-20', ChequeNumber: '777', PartyName: 'Retail Co', Amount: 100 });
  // Deliveries (UX_TIER3.md D): one posted and not invoiced; one invoiced, one reversed.
  const dn = (id, over) => rtdb.ref('stock/transactions/' + id).set(Object.assign({ TransactionType: 'DeliveryNote', TransactionNumber: id, TransactionDate: '2026-04-08', CompanyID: 'C1',
    CustomerID: 'CU1', Status: 'Posted', Lines: [] }, over || {}));
  await dn('DN-1'); await dn('DN-2', { MatchedToInvoiceID: 'INV1' }); await dn('DN-3', { ReversedByDeliveryNoteID: 'DN-3R' });
  await dn('DN-5', { TransactionDate: '2026-05-02' }); // after April
  // Payables: 50 posted to the control account outside the party ledger.
  await postedEntry('2026-04-15', [{ AccountID: 'A-AP', Debit: 0, Credit: 50 }, { AccountID: 'A-CASH', Debit: 50, Credit: 0 }]);
  // Stock: 10 received for 100, with no GL entry; an unbalanced entry.
  await rtdb.ref('stock/transactions/G1').set({ TransactionType: 'GRN', TransactionNumber: 'GRN-1', TransactionDate: '2026-04-02', CompanyID: 'C1', Status: 'Posted',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', Direction: 'In', Quantity: 10, TotalValue: 100 }] });
  await postedEntry('2026-04-20', [{ AccountID: 'A-CASH', Debit: 10, Credit: 0 }]);

  let c = await checklist('2026-04');
  assert.deepEqual([c.From, c.To], ['', '2026-04-30']); // nothing closed yet: everything up to the month's end
  assert.deepEqual(item(c, 'drafts').Findings.map(f => [f.ModuleID, f.Date, f.Status]), [['CBT', '2026-04-12', 'Draft']]);
  assert.deepEqual(item(c, 'approvals').Findings.map(f => [f.ModuleID, f.Number, f.Status]), [['GRN', 'GRN-9', 'PendingApproval']]);
  assert.deepEqual(item(c, 'recurring').Findings.map(f => [f.Number, f.Date]), [['RJV-1', '2026-04-30']]);
  assert.deepEqual(item(c, 'depreciation').Findings.map(f => f.ModuleID), ['FADEPRUN']);
  assert.deepEqual(item(c, 'payroll').Findings.map(f => [f.ModuleID, f.Status]), [['PAYROLL', 'Not started']]);
  assert.match(item(c, 'payroll').Findings[0].Text, /^2 active employee/);
  assert.deepEqual(item(c, 'pdc').Findings.map(f => [f.Number, f.Date]), [['PDCR-1', '2026-04-20']]);
  assert.deepEqual(item(c, 'deliveries').Findings.map(f => [f.ModuleID, f.Number, f.Status, f.Text]), [['DELIVERYNOTE', 'DN-1', 'Not invoiced', 'Retail Co']]);
  assert.equal(item(c, 'receivables').Result, 'OK');
  assert.match(item(c, 'payables').Findings[0].Text, /Aging 0\.00, GL 50\.00, difference -50\.00/);
  assert.match(item(c, 'stock').Findings[0].Text, /Stock 100\.00, GL 0\.00, difference 100\.00/);
  assert.deepEqual(item(c, 'trialBalance').Findings.map(f => f.Number), ['JV-2026-04-20']);
  assert.ok(c.Items.every(i => i.Result === (i.Key === 'receivables' ? 'OK' : 'Warning')), JSON.stringify(c.Items.map(i => [i.Key, i.Result])));
  assert.deepEqual([c.Blocking, c.Warnings], [0, 10]);

  // Each one fixed (or the month before them): clean.
  await firestore.collection('faRunState').doc('C1').set({ LastPostedPeriod: '2026-04' });
  await firestore.collection('payrollRuns').doc('C1_2026-04').set({ CompanyID: 'C1', Month: '2026-04', Status: 'Posted' });
  c = await checklist('2026-03');
  assert.deepEqual(['drafts', 'approvals', 'recurring', 'pdc', 'deliveries', 'payroll'].map(k => item(c, k).Count), [0, 0, 0, 0, 0, 1]); // March: none of April's, but March's payroll
  assert.match(item(c, 'payroll').Findings[0].Text, /^1 active employee/); // E2 had not joined
  c = await checklist('2026-04');
  assert.deepEqual([item(c, 'depreciation').Count, item(c, 'payroll').Count], [0, 0]);

  // Off: not checked at all.
  ok(await save({ Checklist: Object.assign(allModes('Off'), { trialBalance: 'Block' }) }));
  c = await checklist('2026-04');
  assert.deepEqual(c.Items.map(i => i.Result), CHECK_KEYS.map(k => k === 'trialBalance' ? 'Blocks' : 'Off'));
  assert.equal(c.Blocking, 1);
});

test('close: only ended months, in order, Block refuses, Warn closes; the period after the last close', async () => {
  await reset(fixture());
  assert.match(await err(close('2099-01')), /has not ended yet/);
  ok(await save({ Checklist: Object.assign(allModes('Warn'), { drafts: 'Block' }) }));
  ok(await cbtDraft('2026-01-20'));
  assert.match(await err(close('2026-02')), /can't be closed: Drafts dated in the period, not posted \(1\)/);
  ok(await save({ Checklist: allModes('Warn') }));
  const r1 = ok(await close('2026-02')); // the first close: January closes with it
  assert.deepEqual([r1.closedThrough, r1.warnings], ['2026-02', 1]);
  let g = await get('2026-01');
  assert.deepEqual(g.Months.slice(0, 4).map(m => [m.Status, m.WithFirst, m.CanClose]), [['Closed', true, false], ['Closed', false, false], ['Open', false, true], ['Open', false, false]]);
  assert.deepEqual([g.ClosedThrough, g.FirstClosed, g.NextToClose, g.Months[1].By], ['2026-02', '2026-02', '2026-03', 'Admin User']);
  assert.match(g.Log[0].Reason, /1 warning/);
  assert.match(await err(close('2026-04')), /close 2026-03 first/);
  assert.match(await err(close('2026-02')), /already closed/);

  // March's checklist starts after February: January's draft is not in it.
  ok(await save({ Checklist: Object.assign(allModes('Warn'), { drafts: 'Block' }) }));
  const c = await checklist('2026-03');
  assert.deepEqual([c.From, item(c, 'drafts').Count], ['2026-03-01', 0]);
  ok(await cbtDraft('2026-03-05'));
  assert.match(await err(close('2026-03')), /Drafts dated in the period/);
  ok(await save({ Checklist: allModes('Warn') }));
  ok(await close('2026-03'));
  g = await get('2026-01');
  assert.deepEqual([g.ClosedThrough, (await rtdb.ref('periodClosing/C1/Closed/2026-03/Warnings').get()).val()], ['2026-03', ['drafts']]);
});

test('reopen: a reason, later months reopen too, earlier ones stay closed; logged', async () => {
  await reset(fixture());
  ok(await close('2026-01'));
  ok(await close('2026-02'));
  ok(await close('2026-03'));
  assert.match(await err(reopen('2026-02', '  ')), /reason/);
  assert.match(await err(reopen('2026-05', 'x')), /is not closed/);
  const r = ok(await reopen('2026-02', 'Late supplier bill'));
  assert.equal(r.closedThrough, '2026-01');
  let g = await get('2026-01');
  assert.deepEqual(g.Months.slice(0, 3).map(m => m.Status), ['Closed', 'Open', 'Open']);
  assert.deepEqual(Object.keys((await rtdb.ref('periodClosing/C1/Closed').get()).val()), ['2026-01']);
  assert.deepEqual([g.Log[0].Action, g.Log[0].Month, g.Log[0].Reason, g.Log[0].ClosedThrough, g.Log[0].ByName], ['Reopen', '2026-02', 'Late supplier bill', '2026-01', 'Admin User']);
  ok(await close('2026-02')); // closes again, in order
  // The first month closed, reopened: the months before it stay closed.
  ok(await reopen('2026-01', 'Opening balances'));
  g = await get('2026-01');
  assert.deepEqual([g.ClosedThrough, g.FirstClosed, g.Months.every(m => m.Status === 'Open'), g.Log.length], ['2025-12', '2026-01', true, 6]);
  g = await get('2025-12');
  assert.deepEqual([g.Months[11].Status, g.Months[11].WithFirst, g.Months[11].CanReopen], ['Closed', true, true]);
});

test('D: accounts that must be zero at the month end, and steps to tick, each Block / Warn / Off', async () => {
  await reset(fixture());
  // Saved settings from before D: the deliveries check is Warn (decision 158).
  await rtdb.ref('periodClosing/C1/Settings').set({ FiscalYearStart: 'Jan', RetainedEarningsAccountID: 'A-RE', Checklist: { drafts: 'Block' } });
  let g = await get('2026-01');
  assert.deepEqual([g.Settings.Checklist.deliveries, g.Settings.ZeroAccounts, g.Settings.Steps], ['Warn', [], []]);
  assert.ok(g.Accounts.some(a => a.ID === 'A-FRT'), 'the postable accounts to choose from');
  assert.match(await err(save({ ZeroAccounts: [{ AccountID: 'NOPE', Mode: 'Block' }] })), /postable accounts of this company/);
  assert.match(await err(save({ ZeroAccounts: [{ AccountID: 'A-FRT' }, { AccountID: 'A-FRT' }] })), /listed twice/);
  assert.match(await err(save({ Steps: [{ Text: 'Bank reconciliation done', Mode: 'Sometimes' }] })), /Block, Warn or Off/);
  ok(await save({ ZeroAccounts: [{ AccountID: 'A-FRT', Mode: 'Block' }, { AccountID: '', Mode: 'Warn' }], Steps: [{ Text: 'Bank reconciliation done', Mode: 'Block' }, { Text: '  ', Mode: 'Warn' }, { Text: 'Petty cash counted', Mode: 'Warn' }] }));
  g = await get('2026-01');
  assert.deepEqual(g.Settings.ZeroAccounts, [{ AccountID: 'A-FRT', Mode: 'Block' }], 'the empty row is dropped');
  assert.deepEqual(g.Settings.Steps.map(x => [x.Text, x.Mode]), [['Bank reconciliation done', 'Block'], ['Petty cash counted', 'Warn']]);
  const [bank, petty] = g.Settings.Steps.map(x => x.ID);
  assert.match(bank, /^S[0-9a-f]{8}$/);

  // A balance on the account at the month's end blocks; a step not ticked blocks or warns.
  await postedEntry('2026-02-10', [{ AccountID: 'A-FRT', Debit: 30, Credit: 0 }, { AccountID: 'A-CASH', Debit: 0, Credit: 30 }]);
  let c = await checklist('2026-02');
  assert.deepEqual(item(c, 'zero:A-FRT').Findings.map(f => [f.Number, f.Status, f.Text]), [['6100 Freight', 'Not zero', 'Balance 30.00 Dr']]);
  assert.deepEqual([item(c, 'zero:A-FRT').Result, item(c, 'step:' + bank).Result, item(c, 'step:' + petty).Result], ['Blocks', 'Blocks', 'Warning']);
  assert.equal(item(c, 'step:' + bank).Label, 'Bank reconciliation done');
  assert.equal(item(c, 'zero:A-FRT').Label, 'Account 6100 Freight is zero');
  assert.match(await err(close('2026-02')), /can't be closed: Account 6100 Freight is zero \(1\); Bank reconciliation done \(1\)/);
  assert.equal(item(await checklist('2026-01'), 'zero:A-FRT').Result, 'OK', 'January: before the entry');

  // Ticking: anyone who can close (decision 159); logged; not a stale or unknown step; not by a Viewer.
  assert.match(await err(call('u-viewer', 'tickPeriodClosingStep', { companyId: 'C1', month: '2026-02', stepId: bank })), /permission|access/);
  assert.match(await err(call('u-admin', 'tickPeriodClosingStep', { companyId: 'C1', month: '2026-02', stepId: 'S00000000' })), /no longer on the checklist/);
  ok(await call('u-admin', 'tickPeriodClosingStep', { companyId: 'C1', month: '2026-02', stepId: bank }));
  await postedEntry('2026-02-20', [{ AccountID: 'A-FRT', Debit: 0, Credit: 30 }, { AccountID: 'A-CASH', Debit: 30, Credit: 0 }]); // cleared
  c = await checklist('2026-02');
  assert.deepEqual([item(c, 'zero:A-FRT').Result, item(c, 'step:' + bank).Result, item(c, 'step:' + bank).Ticked.ByName], ['OK', 'OK', 'Admin User']);
  assert.match(item(c, 'step:' + bank).Note, /Ticked by Admin User/);
  assert.equal(item(await checklist('2026-03'), 'step:' + bank).Result, 'Blocks', 'a tick is for its month only');
  g = await get('2026-01');
  assert.deepEqual([g.Log[0].Action, g.Log[0].Month, g.Log[0].Reason, g.Log[0].ByName], ['Tick', '2026-02', 'Bank reconciliation done', 'Admin User']);

  // Closing keeps the ticks with the month; a closed month's steps can't change.
  const r = ok(await close('2026-02'));
  assert.equal(r.warnings, 1, 'petty cash: Warn');
  const closed = (await rtdb.ref('periodClosing/C1/Closed/2026-02').get()).val();
  assert.deepEqual(closed.Steps.map(x => [x.Text, Boolean(x.Ticked)]), [['Bank reconciliation done', true], ['Petty cash counted', false]]);
  assert.deepEqual(closed.Warnings, ['step:' + petty]);
  assert.equal((await rtdb.ref('periodClosing/C1/Ticks/2026-02').get()).val(), null);
  assert.match(await err(call('u-admin', 'tickPeriodClosingStep', { companyId: 'C1', month: '2026-02', stepId: petty })), /is closed/);

  // Reopened: the steps are ticked again before it closes again. Untick is logged too.
  ok(await call('u-admin', 'tickPeriodClosingStep', { companyId: 'C1', month: '2026-03', stepId: bank }));
  ok(await call('u-admin', 'tickPeriodClosingStep', { companyId: 'C1', month: '2026-03', stepId: bank, ticked: false }));
  assert.equal((await get('2026-01')).Log[0].Action, 'Untick');
  ok(await reopen('2026-02', 'Late bill'));
  assert.equal(item(await checklist('2026-02'), 'step:' + bank).Result, 'Blocks');
  // Off: not checked.
  ok(await save({ ZeroAccounts: [{ AccountID: 'A-FRT', Mode: 'Off' }], Steps: [{ ID: bank, Text: 'Bank reconciliation done', Mode: 'Off' }] }));
  c = await checklist('2026-02');
  assert.deepEqual([item(c, 'zero:A-FRT').Result, item(c, 'step:' + bank).Result, c.Blocking], ['Off', 'Off', 0]);
  assert.equal((await get('2026-01')).Settings.Steps[0].ID, bank, 'a step keeps its ID when saved again');
});
