// Employee Self-Service Portal, step 1 (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md, decisions 88-95): HR switches access on
// (the default password by the owner's rule, the forced change, reset,
// switch off); who may ask (a portal account, an ERP user linked to an
// employee, never an ERP function with a portal account); leave applied in
// the portal (with the line manager first, then as Submit does; without
// one, submitted at once); withdraw and cancel; balances; payslips.
// Signs in through the Auth emulator for real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, PROJECT, val, put } = require('./_helpers');

test.after(async () => { await app.delete(); });

const AUTH = 'http://127.0.0.1:9099';
let ALI, SARA, BEN, TYPE, UID = {};
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const manage = (uid, action, data) => call(uid, 'manageEssAccounts', Object.assign({ action }, data || {}));
const leaveDoc = async id => (await firestore.collection('leaveRequests').doc(id).get()).data();
async function signIn(code, password) {
  const email = code.toLowerCase() + '@ess.invalid';
  const res = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.localId;
}

// Ali (EMP-0001) reports to Sara (EMP-0002); Ben (EMP-0003) has no manager.
// C1: Sat-Sun weekend. Annual: 24 a year, basic pay.
test.before(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (e) => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan', Gender: 'Male' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  BEN = await emp({ FullName: 'Ben O\'Neil', Gender: 'Male' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  await call('u-admin', 'saveLeavePayRules', { leaveTypeId: TYPE.ANNUAL, rows: [{ LevelFrom: 1, LevelTo: 99, Pay: 'Basic', Percent: 100 }] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2027, weekend: [0, 6], holidays: [] });
});

test('accounts: HR switches access on; the default password signs in and must be changed first; the account never reaches the ERP', async () => {
  await assert.rejects(manage('u-viewer', 'enable', { employeeIds: [ALI] }), /permission to manage portal access/);
  const r = await manage('u-admin', 'enable', { employeeIds: [ALI, SARA, BEN] });
  assert.deepEqual(r.results.map(x => [x.EmployeeNo, x.DefaultPassword, x.Created, x.MustChange]),
    [['EMP-0001', 'alih0001', true, true], ['EMP-0002', 'sara0002', true, true], ['EMP-0003', 'beno0003', true, true]]);
  await assert.rejects(signIn('EMP-0001', 'wrong-one'), /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/);
  UID.ALI = await signIn('EMP-0001', 'alih0001');
  UID.SARA = await signIn('emp-0002', 'sara0002');
  UID.BEN = await signIn('EMP-0003', 'beno0003');
  // Still on the default: only who they are and the change.
  const me = await ess(UID.ALI, 'me');
  assert.deepEqual([me.me.FullName, me.me.EmployeeNo, me.me.MustChange, me.me.Via, me.me.ManagerName], ['Ali Hassan', 'EMP-0001', true, 'portal', 'Sara Khan']);
  await assert.rejects(ess(UID.ALI, 'home'), /Change your password first/);
  await assert.rejects(ess(UID.ALI, 'changePassword', { newPassword: 'alih0001' }), /other than the one you were given/);
  await assert.rejects(ess(UID.ALI, 'changePassword', { newPassword: 'short' }), /at least 8/);
  await assert.rejects(ess(UID.ALI, 'changePassword', { newPassword: 'my-EMP-0001-pw' }), /can't contain your Employee Code/);
  assert.equal((await ess(UID.ALI, 'changePassword', { newPassword: 'Sunrise#2026' })).success, true);
  await assert.rejects(signIn('EMP-0001', 'alih0001'), /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/);
  assert.equal(await signIn('EMP-0001', 'Sunrise#2026'), UID.ALI);
  assert.equal((await ess(UID.ALI, 'me')).me.MustChange, false);
  await ess(UID.ALI, 'home');
  for (const [u, pw] of [[UID.SARA, 'Garden#2026'], [UID.BEN, 'Harbour#2026']]) await ess(u, 'changePassword', { newPassword: pw });
  // A portal account has no ERP profile: every ERP function refuses it.
  await assert.rejects(call(UID.ALI, 'getLeaves', {}), /inactive or not configured/);
  await assert.rejects(call(UID.ALI, 'manageEssAccounts', { action: 'list' }), /inactive or not configured/);
  // HR's list: switched on, changed, last sign-in.
  const list = await manage('u-admin', 'list');
  assert.equal(list.canManage, true);
  assert.deepEqual([list.accounts[ALI].Enabled, list.accounts[ALI].MustChange, Boolean(list.accounts[ALI].LastSignIn), Boolean(list.accounts[ALI].PasswordChangedAt)], [true, false, true, true]);
  assert.equal((await manage('u-viewer', 'list')).canManage, false);
});

test('accounts: switched off (signed out and refused), on again (the password kept), reset (the default again, changed at the next sign-in); an employee who left is refused', async () => {
  await manage('u-admin', 'disable', { employeeIds: [BEN] });
  await assert.rejects(signIn('EMP-0003', 'Harbour#2026'), /USER_DISABLED/);
  await assert.rejects(ess(UID.BEN, 'home'), /portal access is switched off/);
  const on = await manage('u-admin', 'enable', { employeeIds: [BEN] });
  assert.deepEqual([on.results[0].Created, on.results[0].MustChange, on.results[0].DefaultPassword], [false, false, '']);
  assert.equal(await signIn('EMP-0003', 'Harbour#2026'), UID.BEN);
  const reset_ = await manage('u-admin', 'reset', { employeeIds: [BEN] });
  assert.equal(reset_.results[0].DefaultPassword, 'beno0003');
  await assert.rejects(signIn('EMP-0003', 'Harbour#2026'), /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/);
  await signIn('EMP-0003', 'beno0003');
  await assert.rejects(ess(UID.BEN, 'leaves'), /Change your password first/);
  await ess(UID.BEN, 'changePassword', { newPassword: 'Harbour#2027' });
  await firestore.collection('employees').doc(BEN).update({ Status: 'Left' });
  await assert.rejects(ess(UID.BEN, 'home'), /ended when you left/);
  assert.match((await manage('u-admin', 'enable', { employeeIds: [BEN] })).results[0].error, /has left/);
  await firestore.collection('employees').doc(BEN).update({ Status: 'Active' });
});

test('leave with a line manager: applied (With manager, counted in the balance), the manager approves, then as Submit: approved, or to Approval Configuration', async () => {
  const form = await ess(UID.ALI, 'leaveForm');
  assert.equal(form.manager, 'Sara Khan');
  assert.ok(form.types.some(t => t.Code === 'ANNUAL') && !form.types.some(t => t.Code === 'MATERNITY') && !form.types.some(t => t.Code === 'TRAVEL'), 'leave kinds for his gender only');
  const l = { LeaveTypeID: TYPE.ANNUAL, FromDate: '2026-11-02', ToDate: '2026-11-06', Reason: 'Family visit' };
  const p = (await ess(UID.ALI, 'previewLeave', { leave: l })).preview;
  assert.equal(p.Days, 5);
  const before = (await ess(UID.ALI, 'balances')).balances.find(b => b.Code === 'ANNUAL');
  const a = await ess(UID.ALI, 'applyLeave', { leave: l });
  assert.deepEqual([a.status, a.leaveNumber], ['PendingManager', 'LV-2026-0001']);
  const after = (await ess(UID.ALI, 'balances')).balances.find(b => b.Code === 'ANNUAL');
  assert.deepEqual([after.Pending, after.Available], [5, Math.round((before.Available - 5) * 100) / 100]);
  const mine = (await ess(UID.ALI, 'leaves')).leaves[0];
  assert.deepEqual([mine.StatusText, mine.ManagerName, mine.CanCancel, mine.History.map(h => h.Event)], ['With manager', 'Sara Khan', true, ['Applied in the portal']]);
  // The Leave Register leaves it alone.
  await assert.rejects(call('u-admin', 'submitLeave', { leaveId: a.leaveId }), /Only a draft or rejected leave can be submitted/);
  // Only the line manager decides.
  await assert.rejects(ess(UID.BEN, 'decideLeave', { leaveId: a.leaveId, decision: 'Approved' }), /Only the employee's line manager/);
  const t = await ess(UID.SARA, 'team');
  assert.equal(t.isManager, true);
  assert.deepEqual(t.pending.map(x => [x.LeaveNumber, x.EmployeeName, x.Days, x.NextStep]), [['LV-2026-0001', 'Ali Hassan', 5, 'Approved when you approve']]);
  assert.equal((await ess(UID.SARA, 'home')).teamPending, 1);
  assert.equal((await ess(UID.BEN, 'team')).isManager, false);
  await assert.rejects(ess(UID.SARA, 'decideLeave', { leaveId: a.leaveId, decision: 'Rejected' }), /reason for rejecting/);
  const ok = await ess(UID.SARA, 'decideLeave', { leaveId: a.leaveId, decision: 'Approved' });
  assert.equal(ok.status, 'Approved');
  const d = await leaveDoc(a.leaveId);
  assert.deepEqual([d.Status, d.ManagerDecision, d.Lines.every(x => x.PayMonth === '2026-11'), d.History.map(h => h.Event)],
    ['Approved', 'Approved', true, ['Applied in the portal', 'Approved by the line manager', 'Submitted (no approval needed)']]);
  await assert.rejects(ess(UID.SARA, 'decideLeave', { leaveId: a.leaveId, decision: 'Approved' }), /no longer waiting for you \(approved\)/);
  assert.equal((await ess(UID.SARA, 'team')).decided[0].ManagerDecision, 'Approved');

  // With Approval Configuration set up for Leave: the manager, then the approver.
  await rtdb.ref('approvalConfigurations/LEAVE').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/LEAVE').set({ GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } });
  const b = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2026-12-07', ToDate: '2026-12-08' } });
  assert.equal((await ess(UID.SARA, 'team')).pending[0].NextStep, 'Then to HR\'s approval');
  assert.equal((await ess(UID.SARA, 'decideLeave', { leaveId: b.leaveId, decision: 'Approved' })).status, 'PendingApproval');
  assert.equal((await ess(UID.ALI, 'leaves')).leaves.find(x => x.LeaveID === b.leaveId).StatusText, 'With HR');
  const inst = (await val('approvalInstances/' + (await leaveDoc(b.leaveId)).ApprovalInstanceID));
  assert.equal(inst.CreatedBy, UID.ALI, 'the employee asked');
  assert.equal((await call('u-approver', 'decideLeaveApproval', { leaveId: b.leaveId, levelNumber: 1, decision: 'Approved' })).status, 'Approved');
  // Rejected by the manager, with the reason, shown to the employee.
  const c = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2027-01-04', ToDate: '2027-01-04' } });
  await ess(UID.SARA, 'decideLeave', { leaveId: c.leaveId, decision: 'Rejected', reason: 'Year-end closing' });
  const rej = (await ess(UID.ALI, 'leaves')).leaves.find(x => x.LeaveID === c.leaveId);
  assert.deepEqual([rej.Status, rej.RejectionReason, rej.CanCancel], ['Rejected', 'Year-end closing', false]);
  await rtdb.ref('approvalConfigurations/LEAVE').remove();
});

test('leave without a line manager: submitted at once; one expecting a document nobody would see is refused, nothing saved', async () => {
  const r = await ess(UID.SARA, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2026-11-09', ToDate: '2026-11-10' } });
  assert.equal(r.status, 'Approved');
  assert.deepEqual((await leaveDoc(r.leaveId)).History.map(h => [h.Event, h.By]), [['Applied in the portal', 'Sara Khan'], ['Submitted (no approval needed)', 'Sara Khan']]);
  const n = (await firestore.collection('leaveRequests').get()).size;
  await assert.rejects(ess(UID.SARA, 'applyLeave', { leave: { LeaveTypeID: TYPE.SICK, FromDate: '2026-11-16', ToDate: '2026-11-18' } }), /Sick Leave over 1 day needs a supporting document .* hand it to HR/);
  assert.equal((await firestore.collection('leaveRequests').get()).size, n);
  // The Leave Register's own rules apply: an overlap.
  await assert.rejects(ess(UID.SARA, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2026-11-10', ToDate: '2026-11-11' } }), /already has leave/);
  // Another employee's type, gender: not offered, refused.
  await assert.rejects(ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.MATERNITY, FromDate: '2026-11-16', ToDate: '2026-11-18' } }), /Choose the leave type/);
});

test('withdraw a request not yet approved (with the manager, or with HR); cancel approved leave not started; never another employee\'s', async () => {
  const a = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2027-02-01', ToDate: '2027-02-02' } });
  await assert.rejects(ess(UID.SARA, 'cancelLeave', { leaveId: a.leaveId }), /not your leave/);
  assert.equal((await ess(UID.ALI, 'cancelLeave', { leaveId: a.leaveId, reason: 'Plans changed' })).status, 'Withdrawn');
  assert.equal((await ess(UID.SARA, 'team')).pending.length, 0);
  assert.equal((await ess(UID.ALI, 'balances')).balances.find(b => b.Code === 'ANNUAL').Pending, 0);
  // With HR: the approval is withdrawn too.
  await rtdb.ref('approvalConfigurations/LEAVE').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/LEAVE').set({ GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } });
  const b = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2027-02-03', ToDate: '2027-02-03' } });
  await ess(UID.SARA, 'decideLeave', { leaveId: b.leaveId, decision: 'Approved' });
  await ess(UID.ALI, 'cancelLeave', { leaveId: b.leaveId });
  const inst = (await val('approvalInstances/' + (await leaveDoc(b.leaveId)).ApprovalInstanceID));
  assert.equal(inst.Status, 'Withdrawn');
  await assert.rejects(call('u-approver', 'decideLeaveApproval', { leaveId: b.leaveId, levelNumber: 1, decision: 'Approved' }), /not awaiting approval/);
  await rtdb.ref('approvalConfigurations/LEAVE').remove();
  // Approved, not started: cancelled with a reason; the days return.
  const s = (await ess(UID.SARA, 'leaves')).leaves.find(x => x.FromDate === '2026-11-09');
  assert.equal(s.CanCancel, true);
  await assert.rejects(ess(UID.SARA, 'cancelLeave', { leaveId: s.LeaveID }), /reason for cancelling/);
  assert.equal((await ess(UID.SARA, 'cancelLeave', { leaveId: s.LeaveID, reason: 'Trip postponed' })).status, 'Cancelled');
  assert.equal((await leaveDoc(s.LeaveID)).Status, 'Cancelled');
  // Started leave: not from the portal.
  await firestore.collection('leaveRequests').doc(s.LeaveID).update({ Status: 'Approved', FromDate: '2026-01-05' });
  await assert.rejects(ess(UID.SARA, 'cancelLeave', { leaveId: s.LeaveID, reason: 'x' }), /The leave has started/);
  await firestore.collection('leaveRequests').doc(s.LeaveID).update({ Status: 'Cancelled', FromDate: '2026-11-09' });
});

test('an ERP user linked to an employee uses the portal with the ERP sign-in; an unlinked one is told; the month lock names leave with the manager', async () => {
  assert.deepEqual(await ess('u-viewer', 'link'), { linked: false });
  await assert.rejects(ess('u-viewer', 'home'), /not linked to an employee record/);
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: SARA })).employee, { UserUID: 'u-approver' }) });
  assert.deepEqual(await ess('u-approver', 'link'), { linked: true, name: 'Sara Khan' });
  const me = (await ess('u-approver', 'me')).me;
  assert.deepEqual([me.FullName, me.Via, me.MustChange, me.IsManager], ['Sara Khan', 'erp', false, true]);
  await assert.rejects(ess('u-approver', 'changePassword', { newPassword: 'Anything#123' }), /change its password in the ERP/);
  const a = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.ANNUAL, FromDate: '2026-09-28', ToDate: '2026-09-28' } });
  assert.equal((await ess('u-approver', 'team')).pending[0].LeaveID, a.leaveId);
  await assert.rejects(call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-09' }), /LV-2026-\d+ \(Ali Hassan, with the line manager\)/);
  await ess(UID.ALI, 'cancelLeave', { leaveId: a.leaveId });
});

test('payslips: the posted runs with the employee\'s slip, the latest first; the ERP\'s payslip; never a draft run or another employee\'s', async () => {
  const EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: SARA, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 9000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  for (const m of ['2026-07', '2026-08']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
  const july = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: july })).status, 'Posted');
  const aug = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  assert.deepEqual((await ess(UID.ALI, 'payslips')).payslips.map(p => [p.Month, p.Net, p.Paid]), [['2026-07', 6000, false]], 'the August draft is not shown');
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: aug })).status, 'Posted');
  const list = (await ess(UID.ALI, 'payslips')).payslips;
  assert.deepEqual(list.map(p => p.Month), ['2026-08', '2026-07']);
  // Paid: the whole run, or a payment that covered the employee.
  await firestore.collection('payrollRuns').doc(july).update({ Payments: [{ PaymentID: 'P1', EmployeeIDs: [SARA] }] });
  assert.deepEqual([(await ess(UID.ALI, 'payslips')).payslips[1].Paid, (await ess(UID.SARA, 'payslips')).payslips[1].Paid], [false, true]);
  await firestore.collection('payrollRuns').doc(july).update({ PaidAt: '2026-08-02T08:00:00Z' });
  assert.equal((await ess(UID.ALI, 'payslip', { runId: july })).slip.PaidStatus, true);
  const ps = await ess(UID.ALI, 'payslip', { runId: aug });
  assert.deepEqual([ps.month, ps.company.Name, ps.slip.EmployeeID, ps.slip.Net, ps.slip.YTD.Net], ['2026-08', 'Test Co One', ALI, 6000, 12000]);
  assert.ok(ps.slip.Leave.some(x => x.Code === 'ANNUAL'), 'the leave balances, as the ERP\'s payslip');
  // One layout (owner, 2026-10-10): the portal's payslip is exactly the one Payroll prints.
  const erp = await call('u-admin', 'getPayrollPayslips', { runId: aug, employeeId: ALI });
  assert.equal(ps.slip.Html, erp.slips[0].Html);
  assert.equal(ps.css, erp.css);
  assert.match(ps.slip.Html, /^<div class="payslip-doc"><h1>Test Co One<\/h1>[\s\S]*Payslip — 2026-08<\/h2>[\s\S]*<th>Earnings<\/th><th>How<\/th>/);
  assert.match(ps.slip.Html, /Net pay<\/th><th class="r">6,000\.00<\/th>/);
  assert.equal((await ess(UID.ALI, 'home')).lastPayslip.Month, '2026-08');
  // Sara sees only her own slip of the same run.
  assert.equal((await ess(UID.SARA, 'payslip', { runId: aug })).slip.EmployeeID, SARA);
  await call('u-admin', 'reversePayrollRun', { runId: aug, reason: 'Recalculate' });
  await assert.rejects(ess(UID.ALI, 'payslip', { runId: aug }), /Payslip not found/);
});

test('who is away today and the returns due: in the portal, the line manager\'s Team and the employee\'s own Home; never another team\'s (owner, 2026-10-10)', async () => {
  const { todayIn } = require('../../src/recurringSchedule');
  const T = todayIn('Asia/Dubai');
  const day = n => { const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const leave = (emp, no, name, from, to, back, extra) => firestore.collection('leaveRequests').add(Object.assign({ Status: 'Approved', Kind: 'Leave', EmployeeID: emp, EmployeeNo: no, EmployeeName: name,
    LeaveTypeName: 'Annual Leave', LeaveNumber: 'LV-T-' + no, FromDate: from, ToDate: to, ExpectedReturn: back, CompanyID: 'C1', Lines: [] }, extra || {})).then(r => r.id);
  // Ali (Sara's report) is away today; Ali's earlier leave is back 3 days ago, its return not recorded; Ben's (no manager) too.
  const away = await leave(ALI, 'EMP-0001', 'Ali Hassan', day(-1), day(1), day(2), { Lines: [{ Date: T, Fraction: 1, Code: 'AL' }] });
  const due = await leave(ALI, 'EMP-0001', 'Ali Hassan', day(-10), day(-4), day(-3), { ConfirmReturn: true });
  await leave(BEN, 'EMP-0003', 'Ben O\'Neil', day(-10), day(-4), day(-3), { ConfirmReturn: true });
  // A recorded return is no longer due.
  await leave(ALI, 'EMP-0001', 'Ali Hassan', day(-20), day(-15), day(-14), { ConfirmReturn: true, ReturnDate: day(-14) });
  const t = await ess(UID.SARA, 'team');
  assert.deepEqual(t.onLeaveToday.map(x => [x.DocumentID, x.EmployeeName, x.ExpectedReturn]), [[away, 'Ali Hassan', day(2)]]);
  assert.deepEqual(t.returnsDue.map(x => [x.DocumentID, x.DaysOverdue]), [[due, 3]]);
  const sh = await ess(UID.SARA, 'home');
  assert.deepEqual([sh.teamAway, sh.teamReturnsDue, sh.myReturnDue], [1, 1, null]);
  // Ali: his own return due on Home; he manages nobody.
  const ah = await ess(UID.ALI, 'home');
  assert.deepEqual([ah.myReturnDue && ah.myReturnDue.DocumentID, ah.teamAway, ah.teamReturnsDue], [due, 0, 0]);
  const at = await ess(UID.ALI, 'team');
  assert.deepEqual([at.isManager, at.onLeaveToday, at.returnsDue], [false, [], []]);
  // Ben sees only his own; not Ali's.
  const bh = await ess(UID.BEN, 'home');
  assert.equal(bh.myReturnDue.EmployeeName, 'Ben O\'Neil');
});
