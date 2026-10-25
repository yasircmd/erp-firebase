// HR Payroll, step 5b: the final settlement (owner, 2026-10-05;
// docs/modules/HR_PAYROLL.md, decisions 29, 34, 36-39): drafted for a
// leaver, worked out on the leaving date (gratuity, the leave balance, the
// accruals paid at leaving, notice pay, other lines, the loans); with the
// leaving month's run posted, no salary (step 5c: payrollInterim suite for
// the salary it pays otherwise); approved and posted (provisions
// used, the difference to expense, lapsed accruals taken back, the net
// payable or owed); paid as a run is; reversed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');
const calc = require('../../src/payrollCalc');

test.after(async () => { await app.delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const r2 = n => Math.round(n * 100) / 100;
let ALI, BEN, EL, ACC, LOAN, FS_ALI, FS_BEN, JULY, FMT;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const sums = e => { const o = {}; e.Lines.forEach(l => { o[l.AccountCode] = r2((o[l.AccountCode] || 0) + l.Debit - l.Credit); }); return o; };
const line = (s, key) => s.Lines.find(l => l.Key === key);
const get = (d, uid) => call(uid || 'u-admin', 'getSettlement', d).then(r => r.settlement);
const balances = async () => Object.fromEntries((await call('u-admin', 'getProvisionBalances', { companyId: 'C1' })).employees.map(e => [e.EmployeeID, e.Balances]));

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from employees', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-LOAN': { AccountCode: '1260', AccountName: 'Staff Loans', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-FEXP': { AccountCode: '6120', AccountName: 'Air Ticket Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FPRO': { AccountCode: '2420', AccountName: 'Air Ticket Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-EEXP': { AccountCode: '6130', AccountName: 'Education Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-EPRO': { AccountCode: '2430', AccountName: 'Education Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-NOT': { AccountCode: '6200', AccountName: 'Notice Pay', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-OTH': { AccountCode: '4900', AccountName: 'Other Income', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  // No clearance here: these checks are the settlement's own (docs/modules/LEAVER_CLEARANCE.md).
  await call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps: [] });
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, x) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', CostCenterID: 'CC1',
    IBAN: 'AE070331234567890123456', WpsPersonID: '10000000000001', BankRoutingCode: '803320101' }, x) }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan', { JoinDate: '2021-01-01', Status: 'Left', LeavingDate: '2026-07-15', LeavingReason: 'Personal reasons' });
  BEN = await emp('Ben Okafor', { JoinDate: '2026-03-01', Status: 'On notice', LeavingDate: '2026-07-31', LeavingReason: 'End of contract', IBAN: '' });
  await emp('Cara Stays', { JoinDate: '2025-01-01' });
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  EL = els;
  EL.NOTICE = (await call('u-admin', 'savePayElement', { element: { Code: 'NOTICE', Name: 'Notice pay', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  EL.DAMAGE = (await call('u-admin', 'savePayElement', { element: { Code: 'DAMAGE', Name: 'Damaged equipment', Kind: 'Deduction', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }, { ElementID: els.HRA, Amount: 3000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: BEN, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 3000 }] } });
  for (const id of [els.BASIC, els.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.NOTICE, glAccountId: 'A-NOT' });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.DAMAGE, glAccountId: 'A-OTH' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  // Provisions (step 5a): gratuity and leave salary; an air ticket paid at leaving, an education allowance that lapses.
  const s = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  const type = x => call('u-admin', 'saveAccrualType', { accrualType: Object.assign({ Basis: 'Fixed', Rules: [{ LevelFrom: 1, LevelTo: 99, Value: 2400 }] }, x) }).then(r => r.accrualTypeId);
  ACC = { FLIGHT: await type({ Name: 'Air ticket', Code: 'FLIGHT', PaidAtLeaving: true, ExpenseAccountID: 'A-FEXP', ProvisionAccountID: 'A-FPRO' }),
    EDU: await type({ Name: 'Education', Code: 'EDU', PaidAtLeaving: false, ExpenseAccountID: 'A-EEXP', ProvisionAccountID: 'A-EPRO', Rules: [{ LevelFrom: 1, LevelTo: 99, Value: 1200 }] }) };
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: types.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '10', '30/06/2026']]) });
  await call('u-admin', 'runMasterImport', { master: 'PROVOPEN', text: tsv([['Employee', 'Provision', 'Amount', 'Provided To'], ['EMP-0001', 'Gratuity', '20000', '30/06/2026']]) });
  // Ben took leave in advance: his balance is negative.
  await call('u-admin', 'adjustLeaveBalance', { employeeId: BEN, leaveTypeId: types.ANNUAL, days: -20, date: '2026-06-01', reason: 'Leave in advance' });
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
  // Ben's loan, paid out, recovery from August.
  const lt = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Personal loan', Kind: 'Loan', GLAccountID: 'A-LOAN' } })).loanTypeId;
  LOAN = (await call('u-admin', 'saveLoan', { loan: { EmployeeID: BEN, LoanTypeID: lt, Amount: 20000, Instalment: 1000, StartMonth: '2026-08' } })).loanId;
  await call('u-admin', 'submitLoan', { loanId: LOAN });
  await call('u-admin', 'payOutLoan', { loanId: LOAN, date: '2026-07-05', accountId: 'A-BANK' });
  const fmt = (await call('u-admin', 'getPaymentFormats', {})).starter;
  FMT = (await call('u-admin', 'savePaymentFormat', { format: Object.assign({}, fmt, { CompanyID: 'C1', Bank: 'ENBD', Values: { EmployerID: '0000123456789', BankCode: '803320101', Currency: 'AED', Reference: '' } }) })).formatId;
});

test('a draft: the leavers; worked out on the leaving date; notice pay and other lines; an amount changed needs a reason; rights', async () => {
  const list = await call('u-admin', 'getSettlements', {});
  assert.deepEqual([list.settlements, list.leavers.map(e => e.FullName), list.canDraft], [[], ['Ali Hassan', 'Ben Okafor'], true]);
  const s = await get({ employeeId: ALI });
  const gratuity = calc.gratuityFor({}, { base: 6000, joinDate: '2021-01-01', asOf: '2026-07-15', provision: false });
  assert.deepEqual([line(s, 'Gratuity').Amount, line(s, 'Gratuity').Kind, line(s, 'Gratuity').Provided, s.Basic, s.Gross], [gratuity.amount, 'Earning', 20000, 6000, 9000]);
  assert.ok(line(s, 'LeaveSalary').Amount > 0 && line(s, 'LeaveSalary').Text.endsWith('× 200.00 = ' + line(s, 'LeaveSalary').Amount.toLocaleString('en-US', { minimumFractionDigits: 2 })));
  // No run yet (step 5c): it pays July's salary to the 15th, and the air ticket's July share (nothing provided).
  assert.deepEqual(s.Salary.map(m => [m.Month, m.Pay, m.Net]), [['2026-07', true, 4200]]);
  assert.deepEqual([line(s, 'Accrual:' + ACC.FLIGHT).Amount, line(s, 'Accrual:' + ACC.FLIGHT).Provided, line(s, 'Accrual:' + ACC.EDU)], [96.77, 0, undefined]);
  const save = (d, uid) => call(uid || 'u-admin', 'saveSettlement', Object.assign({ employeeId: ALI }, d));
  await assert.rejects(save({}, 'u-viewer'), /permission to prepare final settlements/);
  await assert.rejects(save({ overrides: { Gratuity: { Amount: 0 } } }), /reason for changing an amount/);
  await assert.rejects(save({ notice: { Days: 10, Mode: 'Pay', ElementID: EL.DAMAGE } }), /Notice paid goes on an earning element/);
  const cara = (await call('u-admin', 'getEmployees', {})).employees.find(e => e.FullName === 'Cara Stays').EmployeeID;
  await assert.rejects(call('u-admin', 'saveSettlement', { employeeId: cara }), /Cara Stays has no leaving date/);
  // Dismissed for cause (decision 29): set to 0 by hand, with a reason; then back to the rule.
  FS_ALI = (await save({ overrides: { Gratuity: { Amount: 0, Reason: 'Dismissed for cause' } } })).settlementId;
  const d0 = await get({ settlementId: FS_ALI });
  assert.deepEqual([line(d0, 'Gratuity').Amount, line(d0, 'Gratuity').Worked, line(d0, 'Gratuity').Reason, d0.Status], [0, gratuity.amount, 'Dismissed for cause', 'Draft']);
  await save({ notice: { Days: 10, Mode: 'Pay', ElementID: EL.NOTICE }, others: [{ ElementID: EL.DAMAGE, Amount: 500, Note: 'Laptop screen' }] });
  const d1 = await get({ settlementId: FS_ALI });
  assert.deepEqual([line(d1, 'Gratuity').Amount, line(d1, 'Notice').Amount, line(d1, 'Notice').Text, line(d1, 'Other1').Kind, line(d1, 'Other1').Amount],
    [gratuity.amount, 3000, '10 days × 9,000.00 ÷ 30 = 300.00 (gross)', 'Deduction', 500]);
  assert.equal(d1.Net, r2(gratuity.amount + line(d1, 'LeaveSalary').Amount + 3000 - 500 + 96.77 + 4200));
  // In My Drafts.
  const drafts = await call('u-admin', 'getMyDraftsForUser', {});
  assert.ok(JSON.stringify(drafts).includes('Final settlement — Ali Hassan'));
  await assert.rejects(call('u-admin', 'getSettlement', { employeeId: ALI }), /already has a final settlement/);
});

test('after the leaving month\'s run: approved, then posted (the provisions used, the difference to expense, a lapsed accrual taken back, notice and deductions, the net payable); provisions settled, claims and the run\'s reversal wait for it', async () => {
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: JULY })).status, 'Posted');
  assert.deepEqual((await get({ settlementId: FS_ALI })).Salary, [], 'the run paid July');
  await rtdb.ref('approvalConfigurations/PAYROLLFS').set({ Enabled: true, ScopeType: 'Company' });
  await rtdb.ref('approvalLevels/PAYROLLFS/C1').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
  const sub = await call('u-admin', 'submitSettlement', { settlementId: FS_ALI });
  assert.deepEqual([sub.status, sub.number], ['PendingApproval', 'FS-0001']);
  await assert.rejects(call('u-admin', 'saveSettlement', { employeeId: ALI }), /Only a draft is changed/);
  const done = await call('u-approver', 'decideSettlementApproval', { settlementId: FS_ALI, levelNumber: 1, decision: 'Approved' });
  assert.equal(done.status, 'Posted', JSON.stringify(done));
  assert.match(done.jvNumber, /^FS-/);
  await rtdb.ref('approvalConfigurations/PAYROLLFS').remove();
  const s = await get({ settlementId: FS_ALI });
  const g = line(s, 'Gratuity'), l = line(s, 'LeaveSalary'), fl = line(s, 'Accrual:' + ACC.FLIGHT), ed = line(s, 'Accrual:' + ACC.EDU);
  // The run provided to the leaving date: what is paid is what was provided.
  assert.deepEqual([g.Provided, l.Provided, fl.Amount, fl.Provided, ed.Kind, ed.Provided], [g.Amount, l.Amount, 96.77, 96.77, 'Lapse', 48.39]);
  const e = await jv(s.JVID);
  assert.equal(e.JVDate, '2026-07-15');
  assert.deepEqual(sums(e), { 2400: g.Amount, 2410: l.Amount, 2420: 96.77, 2430: 48.39, 6130: -48.39, 6200: 3000, 4900: -500, 2300: -s.Net });
  assert.equal(e.TotalDebit, e.TotalCredit);
  // Nothing left provided for Ali.
  // A leaver with nothing left provided drops off the balances.
  assert.equal((await balances())[ALI], undefined);
  await assert.rejects(call('u-admin', 'recordAccrualClaim', { employeeId: ALI, accrualTypeId: ACC.FLIGHT, date: '2026-07-20', amount: 10, accountId: 'A-BANK' }), /has a final settlement \(FS-0001\)/);
  await assert.rejects(call('u-admin', 'reversePayrollRun', { runId: JULY, reason: 'x' }), /Reverse the final settlement first \(FS-0001 Ali Hassan\)/);
  assert.deepEqual((await call('u-admin', 'getSettlements', {})).leavers.map(x => x.FullName), ['Ben Okafor']);
});

test('a negative leave balance deducted, the loan recovered in full: the net owed stays on Recoverable from employees; nothing to pay', async () => {
  FS_BEN = (await call('u-admin', 'saveSettlement', { employeeId: BEN })).settlementId;
  const draft = await get({ settlementId: FS_BEN });
  const lv = line(draft, 'LeaveSalary');
  assert.deepEqual([line(draft, 'Gratuity').Amount, lv.Kind, lv.Name, lv.Provided, line(draft, 'Loan:' + LOAN).Amount, line(draft, 'Accrual:' + ACC.FLIGHT).Amount], [0, 'Deduction', 'Leave taken in advance', 0, 20000, 200]);
  assert.match(draft.Warnings.join(' '), /The employee owes .*: it stays on Recoverable from employees/);
  assert.equal(draft.Net, r2(200 - lv.Amount - 20000));
  await assert.rejects(call('u-admin', 'payOutLoan', { loanId: LOAN, date: '2026-07-05', accountId: 'A-BANK' }), /Only an approved loan/);
  assert.equal((await call('u-admin', 'submitSettlement', { settlementId: FS_BEN })).status, 'Posted');
  const s = await get({ settlementId: FS_BEN });
  const e = await jv(s.JVID);
  assert.deepEqual(sums(e), { 2420: 200, 2430: line(s, 'Accrual:' + ACC.EDU).Provided, 6130: -line(s, 'Accrual:' + ACC.EDU).Provided, 6110: -lv.Amount, 1260: -20000, 1250: -s.Net });
  const loan = (await call('u-admin', 'getLoan', { loanId: LOAN })).loan;
  assert.deepEqual([loan.Balance, loan.Shown], [0, 'Repaid']);
  await assert.rejects(call('u-admin', 'recordLoanRepayment', { loanId: LOAN, date: '2026-08-01', amount: 1, accountId: 'A-BANK' }), /has a final settlement \(FS-0002\)/);
  await assert.rejects(call('u-admin', 'markSettlementPaid', { settlementId: FS_BEN, paymentDate: '2026-08-01', accountId: 'A-BANK' }), /nothing to pay: the employee owes the company/);
  // Reversed: back to a draft, the loan owed again; then deleted.
  await assert.rejects(call('u-admin', 'reverseSettlement', { settlementId: FS_BEN }), /reason for reversing/);
  await call('u-admin', 'reverseSettlement', { settlementId: FS_BEN, reason: 'Wrong leave balance' });
  assert.equal((await call('u-admin', 'getLoan', { loanId: LOAN })).loan.Balance, 20000);
  assert.equal((await get({ settlementId: FS_BEN })).Status, 'Draft');
  await call('u-admin', 'deleteSettlement', { settlementId: FS_BEN });
  assert.deepEqual((await call('u-admin', 'getSettlements', {})).leavers.map(x => x.FullName), ['Ben Okafor']);
});

test('paid as a run is: the bank file, Mark paid (Dr Salaries Payable / Cr the bank); reversed only after its payment; the provisions back', async () => {
  const s = await get({ settlementId: FS_ALI });
  const p = await call('u-admin', 'getSettlementPayment', { settlementId: FS_ALI });
  assert.deepEqual([p.payee.Net, p.payee.ByBank, p.formats.length, p.canPay], [s.Net, true, 1, true]);
  await assert.rejects(call('u-viewer', 'markSettlementPaid', { settlementId: FS_ALI, paymentDate: '2026-07-20', accountId: 'A-BANK' }), /permission to pay final settlements/);
  const f = await call('u-admin', 'downloadSettlementFile', { settlementId: FS_ALI, formatId: FMT, paymentDate: '2026-07-20' });
  assert.equal(f.count, 1);
  assert.ok(f.content.includes('AE070331234567890123456') && f.content.includes(s.Net.toFixed(2)), f.content);
  await assert.rejects(call('u-admin', 'markSettlementPaid', { settlementId: FS_ALI, paymentDate: '2026-07-10', accountId: 'A-BANK' }), /before Ali Hassan's leaving date/);
  const paid = await call('u-admin', 'markSettlementPaid', { settlementId: FS_ALI, paymentDate: '2026-07-20', accountId: 'A-BANK' });
  assert.match(paid.jvNumber, /^PAYP-/);
  const after = await get({ settlementId: FS_ALI });
  assert.deepEqual(sums(await jv(after.PaymentJVID)), { 2300: s.Net, 1100: -s.Net });
  await assert.rejects(call('u-admin', 'reverseSettlement', { settlementId: FS_ALI, reason: 'x' }), /reverse the payment first/);
  await call('u-admin', 'reverseSettlementPayment', { settlementId: FS_ALI, reason: 'Wrong account' });
  await call('u-admin', 'reverseSettlement', { settlementId: FS_ALI, reason: 'Recalculate' });
  const b = (await balances())[ALI];
  assert.equal(b.Gratuity, line(s, 'Gratuity').Provided);
  assert.equal(b['Accrual:' + ACC.FLIGHT], 96.77);
  // The run can be reversed again now.
  await call('u-admin', 'reversePayrollRun', { runId: JULY, reason: 'Check' });
});

// Period Closing, step 1c (docs/modules/PERIOD_CLOSING.md, decisions 131,
// 136-138): a settlement of a closed month is reversed, on the user's
// Continue, on the first open day, and redone there too.
test('a closed month: the settlement reversed on the first open day, and posted again there', async () => {
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: JULY })).status, 'Posted');
  assert.equal((await call('u-admin', 'submitSettlement', { settlementId: FS_ALI })).status, 'Posted');
  const posted = await get({ settlementId: FS_ALI });
  assert.equal((await jv(posted.JVID)).JVDate, '2026-07-15');
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2026-07');
  await assert.rejects(call('u-admin', 'reverseSettlement', { settlementId: FS_ALI, reason: 'Recalculate' }), /2026-07 is closed for Test Co One\. It can be adjusted in the first open month: it is posted on 2026-08-01/);
  await call('u-admin', 'reverseSettlement', { settlementId: FS_ALI, reason: 'Recalculate', adjustInOpenMonth: true });
  const back = await get({ settlementId: FS_ALI });
  const reversal = await jv((await jv(posted.JVID)).ReversedByJV);
  assert.deepEqual([back.Status, reversal.JVDate, reversal.AdjustedFromDate], ['Draft', '2026-08-01', '2026-07-15']);
  assert.equal((await call('u-admin', 'submitSettlement', { settlementId: FS_ALI })).status, 'Posted');
  const again = await jv((await get({ settlementId: FS_ALI })).JVID);
  assert.deepEqual([again.JVDate, again.AdjustedFromDate], ['2026-08-01', '2026-07-15']);
  await rtdb.ref('periodClosing').remove();
});
