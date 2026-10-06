// HR Payroll, step 6: the owner's points of 2026-10-06 (docs/modules/
// HR_PAYROLL.md, decisions 44-48): a missing supporting document accepted
// by the approver and flagged until attached; leave deductions in the GL
// pro rata on the earnings, per company; payroll journals referenced PRL-
// and opened from the GL report in their own module. (The payment plan,
// decision 47, is in the payrollPayment and payrollInterim suites.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

const r2 = n => Math.round(n * 100) / 100;
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const PDF = Buffer.from('%PDF-1.4\n% medical certificate\n').toString('base64');
let ALI, BEN, EL, TYPE, JULY;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const sums = e => { const o = {}; e.Lines.forEach(l => { o[l.AccountCode] = r2((o[l.AccountCode] || 0) + l.Debit - l.Credit); }); return o; };
const leave = (emp, code, from, to) => ({ EmployeeID: emp, LeaveTypeID: TYPE[code], FromDate: from, ToDate: to });

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-BAS': { AccountCode: '6000', AccountName: 'Basic Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-HRA': { AccountCode: '6010', AccountName: 'Housing Allowance', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-UNP': { AccountCode: '6090', AccountName: 'Unpaid Leave Deductions', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = name => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1' } }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan');
  BEN = await emp('Ben Okafor');
  EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const id of [ALI, BEN]) await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 6000 }, { ElementID: EL.HRA, Amount: 3000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.BASIC, glAccountId: 'A-BAS', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.HRA, glAccountId: 'A-HRA', prorated: true, inGross: true });
  const unpaid = (await call('u-admin', 'getPayrollSetup', {})).elements.find(e => e.Code === 'UNPAIDLV');
  await call('u-admin', 'savePayElementPayroll', { elementId: unpaid.ElementID, glAccountId: 'A-UNP' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
  await call('u-admin', 'useTestDocumentStorage', {});
});

test('the supporting document (decision 44): submitted without it; the approver must accept it without; flagged in the register and report until attached', async () => {
  await rtdb.ref('approvalConfigurations/LEAVE').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/LEAVE/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
  const id = (await call('u-admin', 'saveLeave', { leave: leave(ALI, 'SICK', '2026-07-06', '2026-07-08') })).leaveId;
  assert.equal((await call('u-admin', 'submitLeave', { leaveId: id })).status, 'PendingApproval', 'no longer blocked');
  const l = (await call('u-approver', 'getLeave', { leaveId: id })).leave;
  assert.deepEqual([l.DocumentNeeded, l.DocumentMissing], [true, true]);
  const decide = x => call('u-approver', 'decideLeaveApproval', Object.assign({ leaveId: id, levelNumber: 1, decision: 'Approved' }, x));
  await assert.rejects(decide({}), /No supporting document is attached \(e\.g\. a medical certificate\): Sick Leave over 1 day expects one\. Accept the leave without it, or attach it first\./);
  assert.equal((await call('u-approver', 'getLeave', { leaveId: id })).leave.Status, 'PendingApproval', 'nothing decided');
  assert.equal((await decide({ acceptWithoutDocument: true })).status, 'Approved');
  const a = (await call('u-admin', 'getLeave', { leaveId: id })).leave;
  assert.equal(a.AcceptedWithoutDocument.By, 'Approver');
  assert.match(a.History.slice(-1)[0].Event, /accepted without the supporting document/);
  const row = async () => (await call('u-admin', 'getLeaves', {})).leaves.find(x => x.LeaveID === id);
  assert.deepEqual([(await row()).NoDocument, Boolean((await row()).AcceptedWithoutDocument)], [true, true]);
  const report = async () => (await call('u-admin', 'getLeaveRegisterReport', { companyId: 'C1', from: '2026-07-01', to: '2026-07-31' })).rows.find(x => x.LeaveID === id);
  assert.equal((await report()).Document, 'Missing, accepted by Approver');
  // Attached later: the flag clears; who accepted it stays on the leave.
  await call('u-admin', 'uploadAttachment', { module: 'LEAVE', docId: id, fileName: 'certificate.pdf', data: PDF });
  assert.deepEqual([(await row()).NoDocument, (await report()).Document], [false, 'Attached']);
  await rtdb.ref('approvalConfigurations/LEAVE').remove();
  // With no approval set up, the person submitting accepts it.
  const id2 = (await call('u-admin', 'saveLeave', { leave: leave(BEN, 'SICK', '2026-07-13', '2026-07-14') })).leaveId;
  await assert.rejects(call('u-admin', 'submitLeave', { leaveId: id2 }), /No supporting document is attached/);
  assert.equal((await call('u-admin', 'submitLeave', { leaveId: id2, acceptWithoutDocument: true })).status, 'Approved');
  assert.equal((await call('u-admin', 'getLeave', { leaveId: id2 })).leave.AcceptedWithoutDocument.By, 'Admin User');
});

test('leave deductions pro rata on the earnings (decision 46): the company\'s choice; the payslip still shows the deduction; the journal backs off basic and housing', async () => {
  const s = (await call('u-admin', 'getPayrollSetup', {})).settings.find(x => x.CompanyID === 'C1');
  assert.equal(s.LeaveDeductionGL, 'Ledger');
  // Two unpaid days for Ali in July (300 a day: 200 basic + 100 housing).
  const u = (await call('u-admin', 'saveLeave', { leave: leave(ALI, 'UNPAID', '2026-07-20', '2026-07-21') })).leaveId;
  await call('u-admin', 'submitLeave', { leaveId: u });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  const slip = (await call('u-admin', 'getPayrollRun', { runId: JULY })).slips.find(x => x.EmployeeID === ALI);
  const ded = slip.Lines.find(l => l.Code === 'UNPAIDLV');
  assert.deepEqual([ded.Amount, ded.Split], [600, [{ ElementID: EL.BASIC, Amount: 400 }, { ElementID: EL.HRA, Amount: 200 }]]);
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', leaveDeductionGL: 'ProRata' });
  assert.equal((await call('u-admin', 'getPayrollSetup', {})).settings.find(x => x.CompanyID === 'C1').LeaveDeductionGL, 'ProRata');
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: JULY })).status, 'Posted');
  const run = (await call('u-admin', 'getPayrollRun', { runId: JULY })).run;
  const e = await jv(run.JVID);
  // Basic 12,000 − 400, housing 6,000 − 200; nothing on the unpaid leave account.
  assert.deepEqual(sums(e), { 6000: 11600, 6010: 5800, 2300: -17400 });
  assert.equal(e.TotalDebit, e.TotalCredit);
  // Back to its own ledger: reversed and posted again.
  await call('u-admin', 'reversePayrollRun', { runId: JULY, reason: 'Ledger instead' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', leaveDeductionGL: 'Ledger' });
  await call('u-admin', 'submitPayrollRun', { runId: JULY });
  const e2 = await jv((await call('u-admin', 'getPayrollRun', { runId: JULY })).run.JVID);
  assert.deepEqual(sums(e2), { 6000: 12000, 6010: 6000, 6090: -600, 2300: -17400 });
});

test('payroll journals: referenced PRL- (decision 48); the GL report sends them to their module, which finds the document behind each', async () => {
  const run = (await call('u-admin', 'getPayrollRun', { runId: JULY })).run;
  const e = await jv(run.JVID);
  assert.match(e.TransactionRef, /^PRL-\d{8}$/);
  const report = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-SALPAY', FromDate: '2026-07-01', ToDate: '2026-07-31' } });
  const row = report.rows.find(r => r.JVID === run.JVID);
  assert.deepEqual([row.SourceModule, row.TransactionRef], ['PAYROLL', e.TransactionRef]);
  assert.deepEqual(await call('u-admin', 'getPayrollJournalSource', { jvId: run.JVID }), { ModuleID: 'PAYROLL', ID: JULY, JVNumber: run.JVNumber });
  // A payment journal goes to its run; a loan's to the loan; a non-payroll entry is refused.
  await call('u-admin', 'markPayrollPaid', { runId: JULY, paymentDate: '2026-08-02', way: 'Cash', accountId: 'A-CASH' });
  const pay = (await call('u-admin', 'getPayrollRun', { runId: JULY })).run.Payments[0];
  assert.equal((await call('u-admin', 'getPayrollJournalSource', { jvId: pay.JVID })).ModuleID, 'PAYROLL');
  assert.match((await jv(pay.JVID)).TransactionRef, /^PRL-/);
  const lt = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Salary advance', Kind: 'Advance', GLAccountID: 'A-CASH' } })).loanTypeId;
  await rtdb.ref('coa/A-ADV').set({ AccountCode: '1270', AccountName: 'Advances', AccountType: 'Asset', Status: 'Active', IsPostable: true });
  await firestore.collection('payrollLoanTypes').doc(lt).update({ GLAccountID: 'A-ADV' });
  const loan = (await call('u-admin', 'saveLoan', { loan: { EmployeeID: BEN, LoanTypeID: lt, Amount: 500, StartMonth: '2026-09' } })).loanId;
  await call('u-admin', 'submitLoan', { loanId: loan });
  const out = await call('u-admin', 'payOutLoan', { loanId: loan, date: '2026-08-05', accountId: 'A-CASH' });
  const loanJv = (await call('u-admin', 'getLoan', { loanId: loan })).loan.PayoutJVID;
  assert.deepEqual(await call('u-admin', 'getPayrollJournalSource', { jvId: loanJv }), { ModuleID: 'PAYROLLLOAN', ID: loan, JVNumber: out.jvNumber });
  await firestore.collection('journalEntries').doc('STKJV-PLAIN').set({ JVNumber: 'JV-1', CompanyID: 'C1', VoucherType: 'JV', Lines: [] });
  await assert.rejects(call('u-admin', 'getPayrollJournalSource', { jvId: 'STKJV-PLAIN' }), /JV-1 is not a payroll journal/);
  await assert.rejects(call('u-other', 'getPayrollJournalSource', { jvId: run.JVID }), /access to that company/);
  // A payroll journal can't be reversed from Journal Vouchers.
  const r = await call('u-admin', 'reverseJournalEntry', { jvId: run.JVID, reversalDate: '2026-08-01' });
  assert.equal(r.success, false);
  assert.match(r.error, /posted by Payroll — reverse it from that module/);
});
