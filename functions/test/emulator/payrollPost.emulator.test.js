// HR Payroll, step 3: approval, posting, payslips, reversal (owner,
// 2026-10-04; docs/modules/HR_PAYROLL.md, "Step 3 design", decisions 9-11,
// 16-19): the accounts checked at submit; posted at once with no approval;
// the journal (month end, clubbed by cost center, net to Salaries Payable,
// a shortfall to Recoverable); the shortfall brought forward; back pay after
// a pay correction; approval (reject, approve by an approver without the
// company); reversal (the latest only, back to draft); payslips.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, BEN, CHRIS, EL, JULY, AUG;
const run = id => call('u-admin', 'getPayrollRun', { runId: id });
const slipOf = (r, emp) => r.slips.find(s => s.EmployeeID === emp);
const amt = (s, code, source) => { const l = s.Lines.find(x => x.Code === code && (!source || x.Source === source)); return l ? l.Amount : undefined; };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const lineSet = e => e.Lines.map(l => [l.AccountCode, l.CostCenterID, l.Debit, l.Credit, l.Description]).sort((a, b) => String(a).localeCompare(String(b)));

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-BON': { AccountCode: '6050', AccountName: 'Bonus', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, cc) => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: cc, BankName: 'ENBD', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan', 'CC1'); BEN = await emp('Ben Okafor', 'CC2'); CHRIS = await emp('Chris Lee', 'CC1');
  EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  EL.FINE = (await call('u-admin', 'savePayElement', { element: { Code: 'FINE', Name: 'Fine', Kind: 'Deduction', Nature: 'Variable' } })).elementId;
  const pay = (id, lines) => call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: lines } });
  await pay(ALI, [{ ElementID: EL.BASIC, Amount: 6000 }, { ElementID: EL.HRA, Amount: 3000 }]);
  await pay(BEN, [{ ElementID: EL.BASIC, Amount: 2000 }]);
  await pay(CHRIS, [{ ElementID: EL.BASIC, Amount: 1000 }]);
  const gl = (id, acc) => call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: acc, prorated: true, inGross: true });
  await gl(EL.BASIC, 'A-SAL'); await gl(EL.HRA, 'A-SAL');
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.FINE, glAccountId: 'A-AP' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: types.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  const lid = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: ALI, LeaveTypeID: types.UNPAID, FromDate: '2026-07-13', ToDate: '2026-07-13' } })).leaveId;
  await call('u-admin', 'submitLeave', { leaveId: lid });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-08' });
});

test('submit: the accounts are checked first; with no approval set up, the run posts at once: month end, clubbed by cost center, a shortfall to Recoverable', async () => {
  await assert.rejects(call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', receivableAccountId: 'A-SALPAY' }), /Recoverable from employees: .* must be Asset/);
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'savePayrollInputs', { runId: JULY, rows: [{ EmployeeID: BEN, Code: 'FINE', Amount: 2500, Note: 'Damage' }] });
  await assert.rejects(call('u-admin', 'submitPayrollRun', { runId: JULY }), /Set the GL accounts in HR Setup → Payroll first: Unpaid leave\./);
  const sys = (await call('u-admin', 'getPayrollSetup', {})).elements.find(e => e.Code === 'UNPAIDLV');
  await call('u-admin', 'savePayElementPayroll', { elementId: sys.ElementID, glAccountId: 'A-SAL' });
  await assert.rejects(call('u-viewer', 'submitPayrollRun', { runId: JULY }), /permission to prepare/);
  const out = await call('u-admin', 'submitPayrollRun', { runId: JULY });
  assert.equal(out.status, 'Posted');
  const r = await run(JULY);
  assert.deepEqual([r.run.Status, r.run.JVNumber, r.canDraft], ['Posted', out.jvNumber, false]);
  const e = await jv(r.run.JVID);
  assert.deepEqual([e.VoucherType, e.JVDate, e.CompanyID, e.TotalDebit, e.TotalCredit, e.PayrollRunID], ['Payroll', '2026-07-31', 'C1', 12500, 12500, JULY]);
  // Ali 9,000 less one unpaid day (300); Ben 2,000 less a 2,500 fine: −500, paid 0, carried; Chris 1,000.
  const label = ' — payroll 2026-07';
  assert.deepEqual(lineSet(e), [
    ['1250', '', 500, 0, 'Recoverable from employees' + label],
    ['2000', '', 0, 2500, 'Fine' + label],
    ['2300', '', 0, 9700, 'Salaries Payable' + label],
    ['6000', 'CC1', 0, 300, 'Unpaid leave' + label],
    ['6000', 'CC1', 3000, 0, 'Housing Allowance' + label],
    ['6000', 'CC1', 7000, 0, 'Basic Salary' + label], // Ali and Chris clubbed
    ['6000', 'CC2', 2000, 0, 'Basic Salary' + label]
  ].sort((a, b) => String(a).localeCompare(String(b))));
  assert.deepEqual([slipOf(r, BEN).CarryForward, slipOf(r, BEN).Paid, slipOf(r, ALI).Paid], [500, 0, 8700]);
  await assert.rejects(call('u-admin', 'recalculatePayrollRun', { runId: JULY }), /The run is Posted/);
});

test('the next run: the shortfall brought forward; back pay for a posted month after a pay correction', async () => {
  // Ali's July basic was wrong: 6,600, corrected from his first pay's date.
  await call('u-admin', 'saveCompensation', { employeeId: ALI, correction: 'Offer letter says 6,600', compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 6600 }, { ElementID: EL.HRA, Amount: 3000 }] } });
  AUG = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  const r = await run(AUG);
  const ali = slipOf(r, ALI), ben = slipOf(r, BEN);
  // July again: basic +600; the unpaid day now 9,600/30 = 320, 20 more.
  assert.deepEqual([amt(ali, 'BASIC', 'Fixed'), amt(ali, 'BASIC', 'Arrears'), amt(ali, 'UNPAIDLV', 'Arrears'), ali.Net], [6600, 600, 20, 9600 + 580]);
  assert.equal(ali.Lines.find(l => l.Source === 'Arrears' && l.Code === 'BASIC').Text, '2026-07: paid 6,000.00, now 6,600.00');
  assert.deepEqual([amt(ben, 'BFWD'), ben.Net], [500, 1500]);
  assert.equal(ben.Lines.find(l => l.Code === 'BFWD').Text, 'Net shortfall from 2026-07');
  assert.equal(amt(slipOf(r, CHRIS), 'BASIC', 'Arrears'), undefined, 'no change, no back pay');
});

test('approval: rejected back to draft with the reason; approved by an approver without the company, posted on behalf of the submitter', async () => {
  await rtdb.ref('approvalConfigurations/PAYROLL').set({ Enabled: true, ScopeType: 'Company' });
  await rtdb.ref('approvalLevels/PAYROLL/C1').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-other', ThresholdAmount: 0 }] });
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: AUG })).status, 'PendingApproval');
  let r = await run(AUG);
  assert.deepEqual([r.run.Status, r.approval.MyLevels, r.canDraft], ['PendingApproval', [], false]);
  const inst = (await rtdb.ref('approvalInstances/' + r.run.ApprovalInstanceID).get()).val();
  assert.equal(inst.Amount, 9600 + 580 + 1500 + 1000, 'the amount is the net pay');
  await assert.rejects(call('u-admin', 'decidePayrollApproval', { runId: AUG, levelNumber: 1, decision: 'Approved' }), /not the assigned approver/);
  await assert.rejects(call('u-other', 'decidePayrollApproval', { runId: AUG, levelNumber: 1, decision: 'Rejected' }), /reason is required/);
  assert.equal((await call('u-other', 'decidePayrollApproval', { runId: AUG, levelNumber: 1, decision: 'Rejected', reason: 'Check Ben' })).status, 'Draft');
  r = await run(AUG);
  assert.deepEqual([r.run.Status, r.run.RejectedReason, r.canDraft], ['Draft', 'Check Ben', true]);
  await call('u-admin', 'submitPayrollRun', { runId: AUG });
  const out = await call('u-other', 'decidePayrollApproval', { runId: AUG, levelNumber: 1, decision: 'Approved' });
  assert.equal(out.status, 'Posted');
  r = await run(AUG);
  const e = await jv(r.run.JVID);
  assert.deepEqual([e.JVDate, e.CreatedBy, e.TotalDebit], ['2026-08-31', 'admin', e.TotalCredit]);
  assert.ok(e.Lines.some(l => l.AccountCode === '1250' && l.Credit === 500), 'the shortfall recovered from Recoverable');
  assert.ok(e.Lines.some(l => l.AccountCode === '6000' && l.CostCenterID === 'CC1' && l.Debit === 600 && /Basic Salary arrears/.test(l.Description)));
  assert.deepEqual(r.run.History.map(h => h.Event), ['Submitted', 'Rejected', 'Submitted', 'Approved', 'Posted']);
  // The leave it paid stays locked.
  await assert.rejects(call('u-admin', 'reopenLeaveMonth', { companyId: 'C1', month: '2026-08', reason: 'Late sick note' }), /The payroll run for 2026-08 is posted: the month's leave stays locked/);
  await rtdb.ref('approvalConfigurations/PAYROLL').remove();
});

test('payslips: the month, leave balances at its end, the year to date; the IBAN masked', async () => {
  const p = await call('u-admin', 'getPayrollPayslips', { runId: AUG, employeeId: ALI });
  const s = p.slips[0];
  assert.deepEqual([p.company.Name, p.month, p.slips.length, s.Designation, s.CostCenterName, s.BankName, s.IBAN], ['Test Co One', '2026-08', 1, 'Accountant', 'Workshop', 'ENBD', 'AE07 •••• 3456']);
  assert.deepEqual(s.YTD, { Earnings: 9000 + 10200, Deductions: 300 + 20, Net: 8700 + 10180 });
  assert.ok(s.Leave.some(l => l.Code === 'ANNUAL' && typeof l.Balance === 'number'));
  assert.equal((await call('u-admin', 'getPayrollPayslips', { runId: AUG })).slips.length, 3);
});

test('reversal: the latest posted run only, with a reason and the post right; a mirror journal; the run back to draft', async () => {
  await assert.rejects(call('u-admin', 'reversePayrollRun', { runId: JULY, reason: 'x' }), /Reverse the later run first \(2026-08\)/);
  await assert.rejects(call('u-admin', 'reversePayrollRun', { runId: AUG }), /reason for reversing/);
  await assert.rejects(call('u-viewer', 'reversePayrollRun', { runId: AUG, reason: 'x' }), /permission to reverse/);
  const before = (await run(AUG)).run;
  const out = await call('u-admin', 'reversePayrollRun', { runId: AUG, reason: 'Ben\'s fine refunded' });
  const orig = await jv(before.JVID);
  assert.ok(orig.ReversedByJV);
  const rev = await jv(orig.ReversedByJV);
  assert.deepEqual([rev.JVNumber, rev.JVDate, rev.ReversalOfJV, rev.TotalDebit], [out.reversalNumber, '2026-08-31', before.JVID, orig.TotalCredit]);
  assert.deepEqual(lineSet(rev).map(l => [l[0], l[1], l[2], l[3]]), lineSet(orig).map(l => [l[0], l[1], l[3], l[2]]).sort((a, b) => String(a).localeCompare(String(b))));
  const r = await run(AUG);
  assert.deepEqual([r.run.Status, r.run.JVID, r.canDraft, slipOf(r, BEN).CarryForward], ['Draft', '', true, undefined]);
  // Recalculated, it still pays the back pay and recovers July's shortfall.
  await call('u-admin', 'recalculatePayrollRun', { runId: AUG });
  const again = await run(AUG);
  assert.deepEqual([amt(slipOf(again, ALI), 'BASIC', 'Arrears'), amt(slipOf(again, BEN), 'BFWD')], [600, 500]);
  // July is now the latest posted run.
  await call('u-admin', 'reversePayrollRun', { runId: JULY, reason: 'Redo' });
  assert.equal((await run(JULY)).run.Status, 'Draft');
});
