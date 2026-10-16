// HR Payroll, step 5c: interim payroll (owner, 2026-10-06;
// docs/modules/HR_PAYROLL.md, decisions 40-43). The final settlement pays
// the months no posted run has paid (the leaving month always; an earlier
// one unless left to its run), worked out as the run does, and the run then
// leaves the employee out; it is submitted from the leaving date, with the
// employee's leave decided, and freezes their leave. An interim payroll
// batch pays posted settlements and approved loans between runs: approved,
// one bank file, each item's own journal, all or nothing, reversed whole.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

const r2 = n => Math.round(n * 100) / 100;
let DAN, EVE, FAY, EL, TYPE, ACC, LOAN, ADV, LOANTYPE, FMT, FS_DAN, IP;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const sums = e => { const o = {}; e.Lines.forEach(l => { o[l.AccountCode] = r2((o[l.AccountCode] || 0) + l.Debit - l.Credit); }); return o; };
const line = (s, key) => s.Lines.find(l => l.Key === key);
const get = (d, uid) => call(uid || 'u-admin', 'getSettlement', d).then(r => r.settlement);
const save = (d, uid) => call(uid || 'u-admin', 'saveSettlement', Object.assign({ employeeId: DAN }, d));
const batch = id => call('u-admin', 'getInterimBatch', { interimId: id });

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
    'A-FPRO': { AccountCode: '2420', AccountName: 'Air Ticket Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, x) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', CostCenterID: 'CC1',
    JoinDate: '2025-01-01', IBAN: 'AE070331234567890123456', WpsPersonID: '10000000000001', BankRoutingCode: '803320101' }, x) }).then(r => r.employeeId);
  DAN = await emp('Dan Leaver', { Status: 'On notice', LeavingDate: '2026-09-10', LeavingReason: 'Personal reasons' });
  EVE = await emp('Eve Stays', { IBAN: 'AE460331234567890000001' });
  FAY = await emp('Fay Later', { Status: 'On notice', LeavingDate: '2026-12-31', LeavingReason: 'Personal reasons' });
  EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const [id, amounts] of [[DAN, [6000, 3000]], [EVE, [4000, 0]], [FAY, [3000, 0]]]) {
    await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: amounts[0] }].concat(amounts[1] ? [{ ElementID: EL.HRA, Amount: amounts[1] }] : []) } });
  }
  for (const id of [EL.BASIC, EL.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.BONUS, glAccountId: 'A-SAL' });
  const unpaid = (await call('u-admin', 'getPayrollSetup', {})).elements.find(e => e.Code === 'UNPAIDLV');
  await call('u-admin', 'savePayElementPayroll', { elementId: unpaid.ElementID, glAccountId: 'A-SAL' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  const s = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  ACC = (await call('u-admin', 'saveAccrualType', { accrualType: { Name: 'Air ticket', Code: 'FLIGHT', Basis: 'Fixed', Rules: [{ LevelFrom: 1, LevelTo: 99, Value: 2400 }], PaidAtLeaving: true,
    ExpenseAccountID: 'A-FEXP', ProvisionAccountID: 'A-FPRO' } })).accrualTypeId;
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
  // Dan's loan, paid out in June, recovered from October.
  LOANTYPE = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Personal loan', Kind: 'Loan', GLAccountID: 'A-LOAN' } })).loanTypeId;
  LOAN = (await call('u-admin', 'saveLoan', { loan: { EmployeeID: DAN, LoanTypeID: LOANTYPE, Amount: 5000, Instalment: 1000, StartMonth: '2026-10' } })).loanId;
  await call('u-admin', 'submitLoan', { loanId: LOAN });
  await call('u-admin', 'payOutLoan', { loanId: LOAN, date: '2026-06-05', accountId: 'A-BANK' });
  // June's run: posted, with everyone on it.
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-06' });
  const june = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-06' })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: june })).status, 'Posted');
  const fmt = (await call('u-admin', 'getPaymentFormats', {})).starter;
  FMT = (await call('u-admin', 'savePaymentFormat', { format: Object.assign({}, fmt, { CompanyID: 'C1', Bank: 'ENBD', Values: { EmployerID: '0000123456789', BankCode: '803320101', Currency: 'AED', Reference: '' } }) })).formatId;
});

test('the settlement pays the months no run has: July, August and September to the leaving date, with its leave and inputs, the air ticket\'s share; an earlier month left to its run only from the start', async () => {
  // An unpaid day in September, approved; a draft leave still open.
  const l1 = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: DAN, LeaveTypeID: TYPE.UNPAID, FromDate: '2026-09-03', ToDate: '2026-09-03' } })).leaveId;
  assert.equal((await call('u-admin', 'submitLeave', { leaveId: l1 })).status, 'Approved');
  const open = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: DAN, LeaveTypeID: TYPE.UNPAID, FromDate: '2026-09-08', ToDate: '2026-09-08' } })).leaveId;
  await assert.rejects(save({ inputs: [{ Month: '2026-06', ElementID: EL.BONUS, Amount: '500' }] }), /2026-06 is not paid in this settlement/);
  await assert.rejects(save({ inputs: [{ Month: '2026-09', ElementID: EL.BASIC, Amount: '500' }] }), /choose a variable pay element/);
  await assert.rejects(save({ leaveToRun: ['2026-08'] }), /2026-08 can't be left to its run: a month before it is paid in the settlement/);
  FS_DAN = (await save({ inputs: [{ Month: '2026-09', ElementID: EL.BONUS, Amount: '1,000', Note: 'Handover' }] })).settlementId;
  const s = await get({ settlementId: FS_DAN });
  // 9,000 a month (÷ 30): September is 10 days (3,000), less the unpaid day (300), plus the bonus.
  assert.deepEqual(s.Salary.map(m => [m.Month, m.Pay, m.Net]), [['2026-07', true, 9000], ['2026-08', true, 9000], ['2026-09', true, 3700]]);
  assert.deepEqual(s.SalaryMonths, ['2026-07', '2026-08', '2026-09']);
  const sep = s.Lines.filter(l => l.Month === '2026-09').map(l => [l.Code, l.Kind, l.Amount]);
  assert.deepEqual(sep, [['BASIC', 'Earning', 2000], ['HRA', 'Earning', 1000], ['UNPAIDLV', 'Deduction', 300], ['BONUS', 'Earning', 1000]]);
  assert.equal(s.Lines.filter(l => l.Source === 'Loan').length, 0, 'no instalment: the loan is deducted whole');
  // The air ticket: June provided 200; July, August and 10 days of September are this settlement's.
  const fl = line(s, 'Accrual:' + ACC);
  assert.deepEqual([fl.Provided, fl.Amount], [200, r2(200 + 200 + 200 + 200 * 10 / 30)]);
  assert.match(fl.Text, /for 2026-07, 2026-08, 2026-09/);
  assert.equal(line(s, 'Loan:' + LOAN).Amount, 5000);
  assert.equal(s.Net, r2(s.Lines.filter(l => l.Kind === 'Earning').reduce((t, l) => t + l.Amount, 0) - s.Lines.filter(l => l.Kind === 'Deduction').reduce((t, l) => t + l.Amount, 0)));
  // July left to its run (decision 41): not paid here; the submit waits for that run.
  await save({ leaveToRun: ['2026-07'], inputs: [{ Month: '2026-09', ElementID: EL.BONUS, Amount: '1000' }] });
  const left = await get({ settlementId: FS_DAN });
  assert.deepEqual([left.Salary.map(m => m.Pay), left.SalaryMonths], [[false, true, true], ['2026-08', '2026-09']]);
  await assert.rejects(call('u-admin', 'submitSettlement', { settlementId: FS_DAN }), /Decide or delete Dan Leaver's leave up to the leaving date first/);
  await call('u-admin', 'deleteLeave', { leaveId: open });
  await assert.rejects(call('u-admin', 'submitSettlement', { settlementId: FS_DAN }), /Post the payroll run for 2026-07 with Dan Leaver on it first, or pay 2026-07 in this settlement/);
  await save({ inputs: [{ Month: '2026-09', ElementID: EL.BONUS, Amount: '1000' }] });
  // Fay leaves at the year's end (decision 40).
  const fay = (await call('u-admin', 'saveSettlement', { employeeId: FAY })).settlementId;
  await assert.rejects(call('u-admin', 'submitSettlement', { settlementId: fay }), /submitted from the leaving date \(2026-12-31\)/);
  await call('u-admin', 'deleteSettlement', { settlementId: fay });
});

test('submitted over July\'s draft run: posted with the salary; the run leaves Dan out once recalculated; his leave stays as it is', async () => {
  for (const m of ['2026-07', '2026-08', '2026-09']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
  const july = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.ok((await call('u-admin', 'getPayrollRun', { runId: july })).slips.some(x => x.EmployeeID === DAN), 'a draft settlement leaves the run as it is');
  const sub = await call('u-admin', 'submitSettlement', { settlementId: FS_DAN });
  assert.deepEqual([sub.status, sub.number], ['Posted', 'FS-0001']);
  const s = await get({ settlementId: FS_DAN });
  const e = await jv(s.JVID);
  // Salary: 9,000 + 9,000 + 3,000 + 1,000 bonus − 300 unpaid; the loan; the net payable.
  const x = sums(e);
  assert.deepEqual([x[6000], x[1260], x[2300], x[2420]], [21700, -5000, -s.Net, 200]);
  assert.equal(e.TotalDebit, e.TotalCredit);
  await assert.rejects(call('u-admin', 'submitPayrollRun', { runId: july }), /Recalculate the run first: a final settlement pays 2026-07 for Dan Leaver \(FS-0001\)/);
  const r = await call('u-admin', 'recalculatePayrollRun', { runId: july });
  assert.deepEqual(r.run.Settled.map(p => [p.EmployeeName, p.Number]), [['Dan Leaver', 'FS-0001']]);
  const run = await call('u-admin', 'getPayrollRun', { runId: july });
  assert.deepEqual(run.slips.map(p => p.EmployeeName), ['Eve Stays', 'Fay Later']);
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: july })).status, 'Posted');
  await assert.rejects(call('u-admin', 'saveLeave', { leave: { EmployeeID: DAN, LeaveTypeID: TYPE.UNPAID, FromDate: '2026-09-09', ToDate: '2026-09-09' } }), /Dan Leaver has a final settlement \(FS-0001\): their leave can no longer change/);
});

test('an interim payroll batch: the settlement and an advance; approved; one bank file; each paid by its own journal; only through the batch', async () => {
  ADV = (await call('u-admin', 'saveLoan', { loan: { EmployeeID: EVE, LoanTypeID: LOANTYPE, Amount: 1500, Instalment: 500, StartMonth: '2026-11' } })).loanId;
  await call('u-admin', 'submitLoan', { loanId: ADV });
  const fresh = await call('u-admin', 'getInterimBatch', { companyId: 'C1' });
  const s = await get({ settlementId: FS_DAN });
  assert.deepEqual(fresh.candidates.map(i => [i.Kind, i.Number, i.Amount]), [['Settlement', 'FS-0001', s.Net], ['Loan', 'LN-0002', 1500]]);
  const items = fresh.candidates.map(i => ({ Kind: i.Kind, ID: i.ID }));
  await assert.rejects(call('u-viewer', 'saveInterimBatch', { companyId: 'C1', paymentDate: '2026-09-15', items }), /permission to prepare interim payroll/);
  await assert.rejects(call('u-admin', 'saveInterimBatch', { companyId: 'C1', paymentDate: '2026-09-05', items }), /before Dan Leaver's leaving date \(2026-09-10\)/);
  const saved = await call('u-admin', 'saveInterimBatch', { companyId: 'C1', paymentDate: '2026-09-15', note: 'Leavers and advances', items });
  IP = saved.interimId;
  assert.deepEqual([saved.number, saved.total], ['IP-0001', r2(s.Net + 1500)]);
  // Now paid only through the batch, and in no other batch.
  await assert.rejects(call('u-admin', 'markSettlementPaid', { settlementId: FS_DAN, paymentDate: '2026-09-15', accountId: 'A-BANK' }), /FS-0001 is in interim payroll IP-0001/);
  await assert.rejects(call('u-admin', 'payOutLoan', { loanId: ADV, date: '2026-09-15', accountId: 'A-BANK' }), /LN-0002 is in interim payroll IP-0001/);
  assert.deepEqual((await call('u-admin', 'getInterimBatch', { companyId: 'C1' })).candidates, []);
  await assert.rejects(call('u-admin', 'saveInterimBatch', { companyId: 'C1', paymentDate: '2026-09-15', items: items.slice(1) }), /LN-0002 is in interim payroll IP-0001/);
  // Its approval (decision 43).
  await rtdb.ref('approvalConfigurations/PAYROLLIP').set({ Enabled: true, ScopeType: 'Company' });
  await rtdb.ref('approvalLevels/PAYROLLIP/C1').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
  assert.equal((await call('u-admin', 'submitInterimBatch', { interimId: IP })).status, 'PendingApproval');
  await assert.rejects(call('u-admin', 'saveInterimBatch', { interimId: IP, paymentDate: '2026-09-16', items }), /Only a draft is changed/);
  assert.equal((await call('u-approver', 'decideInterimApproval', { interimId: IP, levelNumber: 1, decision: 'Rejected', reason: 'Pay on the 15th' })).status, 'Draft');
  assert.equal((await call('u-admin', 'submitInterimBatch', { interimId: IP })).status, 'PendingApproval');
  await assert.rejects(call('u-admin', 'downloadInterimFile', { interimId: IP, formatId: FMT, accountId: 'A-BANK' }), /once the batch is approved/);
  await assert.rejects(call('u-admin', 'markInterimPaid', { interimId: IP, way: 'BankFile', accountId: 'A-BANK' }), /Only an approved batch is paid/);
  assert.equal((await call('u-approver', 'decideInterimApproval', { interimId: IP, levelNumber: 1, decision: 'Approved' })).status, 'Approved');
  await rtdb.ref('approvalConfigurations/PAYROLLIP').remove();
  const f = await call('u-admin', 'downloadInterimFile', { interimId: IP, formatId: FMT, accountId: 'A-BANK' });
  assert.deepEqual([f.count, f.total], [2, r2(s.Net + 1500)]);
  assert.ok(f.content.includes('AE070331234567890123456') && f.content.includes('AE460331234567890000001') && f.content.includes('1500.00'), f.content);
  const paid = await call('u-admin', 'markInterimPaid', { interimId: IP, way: 'BankFile', accountId: 'A-BANK', reference: 'TT-77' });
  assert.match(paid.journals.join(' '), /^PAYP-\S+ PLN-\S+$/);
  const b = (await batch(IP)).batch;
  assert.equal(b.Status, 'Paid');
  const after = await get({ settlementId: FS_DAN });
  assert.deepEqual(sums(await jv(after.PaymentJVID)), { 2300: s.Net, 1100: -s.Net });
  assert.deepEqual([(await jv(after.PaymentJVID)).Reference, (await jv(after.PaymentJVID)).PayrollInterimID], ['IP-0001', IP]);
  const adv = (await call('u-admin', 'getLoan', { loanId: ADV })).loan;
  assert.deepEqual([adv.Status, adv.Balance], ['Active', 1500]);
  assert.deepEqual(sums(await jv(adv.PayoutJVID)), { 1260: 1500, 1100: -1500 });
  await assert.rejects(call('u-admin', 'reverseSettlementPayment', { settlementId: FS_DAN, reason: 'x' }), /in interim payroll IP-0001/);
});

test('reversed whole: the batch is Reversed, kept with its history, never deleted; its items free for a new batch (step 7, point 6); a journal that fails puts back the ones before it', async () => {
  await assert.rejects(call('u-admin', 'reverseInterimPayment', { interimId: IP }), /reason for reversing/);
  const rev = await call('u-admin', 'reverseInterimPayment', { interimId: IP, reason: 'Wrong bank account' });
  assert.equal(rev.reversals.length, 2);
  const kept = (await batch(IP)).batch;
  assert.deepEqual([kept.Status, kept.ReversalReason, kept.Items.length, kept.Payments.length, kept.Payments.every(x => x.ReversedAt)], ['Reversed', 'Wrong bank account', 2, 1, true]);
  assert.deepEqual(kept.History.map(h => h.Event.replace(/^Paid .*/, 'Paid')).slice(-2), ['Paid', 'Payment reversed']);
  await assert.rejects(call('u-admin', 'deleteInterimBatch', { interimId: IP }), /Only a draft is deleted/);
  await assert.rejects(call('u-admin', 'submitInterimBatch', { interimId: IP }), /Only a draft is submitted/);
  await assert.rejects(call('u-admin', 'saveInterimBatch', { interimId: IP, paymentDate: '2026-09-16', items: [] }), /Only a draft is changed/);
  assert.equal((await get({ settlementId: FS_DAN })).PaidAt, '');
  assert.equal((await call('u-admin', 'getLoan', { loanId: ADV })).loan.Status, 'Approved');
  // Its items are free: a new batch takes them (none set up now: approved at once).
  const fresh = await call('u-admin', 'getInterimBatch', { companyId: 'C1' });
  assert.deepEqual(fresh.candidates.map(i => i.Number), ['FS-0001', 'LN-0002']);
  const items = fresh.candidates.map(i => ({ Kind: i.Kind, ID: i.ID }));
  const second = await call('u-admin', 'saveInterimBatch', { companyId: 'C1', paymentDate: '2026-09-15', items });
  assert.equal(second.number, 'IP-0002');
  IP = second.interimId;
  assert.equal((await call('u-admin', 'submitInterimBatch', { interimId: IP })).status, 'Approved');
  // The loan type's account gone, so the second journal fails.
  await firestore.collection('payrollLoanTypes').doc(LOANTYPE).update({ GLAccountID: 'NO-SUCH' });
  await assert.rejects(call('u-admin', 'markInterimPaid', { interimId: IP, way: 'BankFile', accountId: 'A-BANK' }), /Nothing was paid: Set the loan type's receivable account/);
  assert.equal((await batch(IP)).batch.Status, 'Approved');
  assert.equal((await get({ settlementId: FS_DAN })).PaidAt, '', 'the settlement\'s payment put back');
  await firestore.collection('payrollLoanTypes').doc(LOANTYPE).update({ GLAccountID: 'A-LOAN' });
  // The plan (step 6, decision 47): Eve's advance in cash, Dan by bank file; two groups, paid and reversed on their own.
  await assert.rejects(call('u-admin', 'saveInterimPlan', { interimId: IP, rows: [{ Kind: 'Loan', ID: ADV, Way: 'Cash', AccountID: 'A-BANK' }] }), /Eve Stays: cash is paid from a cash account/);
  await call('u-admin', 'saveInterimPlan', { interimId: IP, rows: [{ Kind: 'Loan', ID: ADV, Way: 'Cash', AccountID: 'A-CASH' }] });
  const g = await batch(IP);
  assert.deepEqual(g.groups.map(x => [x.Key, x.Count]), [['BankFile:A-BANK', 1], ['Cash:A-CASH', 1]]);
  assert.equal((await call('u-admin', 'downloadInterimFile', { interimId: IP, formatId: FMT, accountId: 'A-BANK' })).count, 1);
  const cash = await call('u-admin', 'markInterimPaid', { interimId: IP, way: 'Cash', accountId: 'A-CASH', paymentDate: '2026-09-16' });
  assert.deepEqual([cash.paid, cash.total, (await batch(IP)).batch.Status], [false, 1500, 'Approved']);
  assert.deepEqual(sums(await jv((await call('u-admin', 'getLoan', { loanId: ADV })).loan.PayoutJVID)), { 1260: 1500, 1000: -1500 });
  assert.equal((await call('u-admin', 'markInterimPaid', { interimId: IP, way: 'BankFile', accountId: 'A-BANK' })).paid, true);
  await assert.rejects(call('u-admin', 'reverseInterimPayment', { interimId: IP, reason: 'x' }), /Choose the payment to reverse/);
  const pays = (await batch(IP)).batch.Payments;
  await call('u-admin', 'reverseInterimPayment', { interimId: IP, paymentId: pays[pays.length - 2].PaymentID, reason: 'Cash not collected' });
  // One group reversed, the other still paid: not Reversed yet.
  assert.deepEqual([(await batch(IP)).batch.Status, (await call('u-admin', 'getLoan', { loanId: ADV })).loan.Status], ['Approved', 'Approved']);
  await call('u-admin', 'reverseInterimPayment', { interimId: IP, reason: 'Redo' });
  assert.equal((await batch(IP)).batch.Status, 'Reversed');
  await assert.rejects(call('u-admin', 'deleteInterimBatch', { interimId: IP }), /Only a draft is deleted/);
  // Both batches stay in the list; the items are free, each paid on its own.
  assert.deepEqual((await call('u-admin', 'getInterimBatches', {})).batches.map(x => [x.Number, x.Status]).sort(), [['IP-0001', 'Reversed'], ['IP-0002', 'Reversed']]);
  assert.deepEqual((await call('u-admin', 'getInterimBatch', { companyId: 'C1' })).candidates.map(i => i.Number), ['FS-0001', 'LN-0002']);
  await call('u-admin', 'markSettlementPaid', { settlementId: FS_DAN, paymentDate: '2026-09-15', accountId: 'A-BANK' });
});
