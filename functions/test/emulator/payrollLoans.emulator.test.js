// HR Payroll, step 4b: advances and loans (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, decisions 7 and 24-27): loan types with
// their receivable; a loan entered, submitted (with or without approval),
// paid out from Payroll; recovered by the runs (an advance at once, never
// past the net), posted to the receivable; the balance on the payslip;
// skipping a month, changing the instalment, an early repayment; a reversed
// run gives its recovery back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, BEN, T, LOAN, ADV, JULY;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const loanOf = async id => (await call('u-admin', 'getLoan', { loanId: id })).loan;
const slipOf = async (runId, emp) => (await call('u-admin', 'getPayrollRun', { runId })).slips.find(s => s.EmployeeID === emp);
const amt = (s, code) => s.Lines.filter(l => l.Code === code).reduce((t, l) => t + l.Amount, 0);

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LOAN': { AccountCode: '1260', AccountName: 'Staff Loans', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = name => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan'); BEN = await emp('Ben Okafor');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: BEN, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 2000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-08' });
});

test('loan types: an advance or a loan, with its receivable (an asset; the group\'s shared, a company\'s own)', async () => {
  const save = (lt, uid) => call(uid || 'u-admin', 'saveLoanType', { loanType: lt });
  await assert.rejects(save({ Name: 'Personal loan', Kind: 'Loan', GLAccountID: 'A-LOAN' }, 'u-viewer'), /permission to change Payroll Setup/);
  await assert.rejects(save({ Name: 'Personal loan', Kind: 'Loan', GLAccountID: 'A-SAL' }), /must be an asset/);
  await assert.rejects(save({ Name: 'Personal loan', Kind: 'Lease', GLAccountID: 'A-LOAN' }), /an advance .* or a loan/);
  T = {
    loan: (await save({ Name: 'Personal loan', Kind: 'Loan', GLAccountID: 'A-LOAN' })).loanTypeId,
    adv: (await save({ Name: 'Salary advance', Kind: 'Advance', GLAccountID: 'A-LOAN' })).loanTypeId
  };
  await assert.rejects(save({ Name: 'personal LOAN', Kind: 'Loan', GLAccountID: 'A-LOAN' }), /already a loan type/);
  assert.deepEqual((await call('u-admin', 'getLoanTypes', {})).types.map(t => [t.Name, t.Kind]), [['Personal loan', 'Loan'], ['Salary advance', 'Advance']]);
});

test('a loan: a draft (in My Drafts), submitted with no approval set up, paid out from Payroll; an advance through approval', async () => {
  const save = l => call('u-admin', 'saveLoan', { loan: l });
  await assert.rejects(save({ EmployeeID: ALI, LoanTypeID: T.loan, Amount: 3000, Instalment: 4000, StartMonth: '2026-07' }), /instalment is more than 0 and at most the amount/);
  await assert.rejects(call('u-viewer', 'saveLoan', { loan: { EmployeeID: ALI, LoanTypeID: T.loan, Amount: 3000, Instalment: 500, StartMonth: '2026-07' } }), /permission to enter loans/);
  LOAN = (await save({ EmployeeID: ALI, LoanTypeID: T.loan, Amount: 3000, Instalment: 500, StartMonth: '2026-07', Note: 'Car repair' })).loanId;
  assert.ok((await call('u-admin', 'getMyDraftsForUser', {})).some(d => d.ModuleID === 'PAYROLLLOAN' && d.DocumentID === LOAN));
  assert.deepEqual(await call('u-admin', 'submitLoan', { loanId: LOAN }), { success: true, status: 'Approved', loanNumber: 'LN-0001' });
  const pay = (id, d, uid) => call(uid || 'u-admin', 'payOutLoan', Object.assign({ loanId: id, date: '2026-07-05', accountId: 'A-BANK' }, d));
  await assert.rejects(pay(LOAN, {}, 'u-viewer'), /permission to pay out or receive loans/);
  await assert.rejects(pay(LOAN, { accountId: 'A-SAL' }), /cash or bank account/);
  const out = await pay(LOAN, {});
  assert.match(out.jvNumber, /^PLN-/);
  const l = await loanOf(LOAN);
  assert.deepEqual([l.Status, l.Balance, l.PayoutDate], ['Active', 3000, '2026-07-05']);
  const e = await jv(l.PayoutJVID);
  assert.deepEqual(e.Lines.map(x => [x.AccountCode, x.Debit, x.Credit]).sort(), [['1100', 0, 3000], ['1260', 3000, 0]]);
  // An advance, with its approval.
  await rtdb.ref('approvalConfigurations/PAYROLLLOAN').set({ Enabled: true, ScopeType: 'Company' });
  await rtdb.ref('approvalLevels/PAYROLLLOAN/C1').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
  ADV = (await save({ EmployeeID: BEN, LoanTypeID: T.adv, Amount: 1000, StartMonth: '2026-07' })).loanId;
  assert.equal((await loanOf(ADV)).Instalment, 1000, 'an advance: all at once');
  assert.equal((await call('u-admin', 'submitLoan', { loanId: ADV })).status, 'PendingApproval');
  await assert.rejects(pay(ADV, {}), /Only an approved loan is paid out/);
  assert.equal((await call('u-approver', 'decideLoanApproval', { loanId: ADV, levelNumber: 1, decision: 'Approved' })).status, 'Approved');
  await pay(ADV, { accountId: 'A-CASH' });
  await rtdb.ref('approvalConfigurations/PAYROLLLOAN').remove();
});

test('recovered by the run: the instalment, an advance at once; posted to the receivable; the balance on the payslip; the draft run in My Drafts', async () => {
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.ok((await call('u-admin', 'getMyDraftsForUser', {})).some(d => d.ModuleID === 'PAYROLL' && d.DocumentID === JULY), 'a draft run shows in My Drafts');
  const ali = await slipOf(JULY, ALI), ben = await slipOf(JULY, BEN);
  assert.deepEqual([amt(ali, 'LOAN'), ali.Net, amt(ben, 'LOAN'), ben.Net], [500, 5500, 1000, 1000]);
  assert.equal(ali.Lines.find(l => l.Code === 'LOAN').Text, '500.00; balance after 2,500.00');
  const p = await call('u-admin', 'getPayrollPayslips', { runId: JULY, employeeId: ALI });
  assert.deepEqual(p.slips[0].Loans, [{ LoanNumber: 'LN-0001', TypeName: 'Personal loan', Balance: 2500 }]);
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: JULY })).status, 'Posted');
  const e = await jv((await call('u-admin', 'getPayrollRun', { runId: JULY })).run.JVID);
  assert.deepEqual(e.Lines.filter(l => l.AccountCode === '1260').map(l => [l.Credit, l.Description]).sort(),
    [[1000, 'Loan recovery: Salary advance — payroll 2026-07'], [500, 'Loan recovery: Personal loan — payroll 2026-07']]);
  const list = (await call('u-admin', 'getLoans', {})).loans;
  assert.deepEqual(list.map(l => [l.LoanNumber, l.Balance, l.Shown]).sort(), [['LN-0001', 2500, 'Active'], ['LN-0002', 0, 'Repaid']]);
  assert.deepEqual((await call('u-admin', 'getLoans', { employeeId: ALI })).loans.map(l => l.LoanNumber), ['LN-0001'], 'on the employee record');
});

test('the schedule: a recovered month stays; skip a month; a new instalment from a month; an early repayment', async () => {
  const sched = d => call('u-admin', 'saveLoanSchedule', Object.assign({ loanId: LOAN }, d));
  await assert.rejects(sched({ skips: ['2026-07'] }), /posted run has already recovered 2026-07/);
  await assert.rejects(call('u-admin', 'saveLoanSchedule', { loanId: ADV, changes: [{ FromMonth: '2026-09', Instalment: 100 }] }), /advance is recovered at once/);
  await sched({ skips: ['2026-08'], changes: [{ FromMonth: '2026-09', Instalment: 1000 }] });
  const aug = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  assert.equal(amt(await slipOf(aug, ALI), 'LOAN'), 0, 'August skipped');
  const rep = d => call('u-admin', 'recordLoanRepayment', Object.assign({ loanId: LOAN, date: '2026-08-20', accountId: 'A-CASH' }, d));
  await assert.rejects(rep({ amount: 2600 }), /at most the balance \(2500\.00\)/);
  const out = await rep({ amount: 500, note: 'Cash from bonus' });
  assert.equal(out.balance, 2000);
  const l = await loanOf(LOAN);
  assert.deepEqual(l.Repayments.map(r => [r.Date, r.Amount]), [['2026-08-20', 500]]);
  assert.deepEqual((await jv(l.Repayments[0].JVID)).Lines.map(x => [x.AccountCode, x.Debit, x.Credit]).sort(), [['1000', 500, 0], ['1260', 0, 500]]);
  await call('u-admin', 'deletePayrollRun', { runId: aug });
});

test('a reversed run gives its recovery back; a payout can be reversed only before anything is recovered or repaid; only a draft is deleted', async () => {
  await call('u-admin', 'reversePayrollRun', { runId: JULY, reason: 'Redo' });
  assert.deepEqual([(await loanOf(LOAN)).Balance, (await loanOf(ADV)).Balance], [2500, 1000]);
  await assert.rejects(call('u-admin', 'reverseLoanPayout', { loanId: LOAN, reason: 'x' }), /already recovered or repaid/);
  await call('u-admin', 'reverseLoanPayout', { loanId: ADV, reason: 'Paid by mistake' });
  assert.deepEqual([(await loanOf(ADV)).Status, (await loanOf(ADV)).PayoutJVID], ['Approved', '']);
  await assert.rejects(call('u-admin', 'deleteLoan', { loanId: ADV }), /Only a draft can be deleted/);
});
