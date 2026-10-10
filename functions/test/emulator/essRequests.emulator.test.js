// Employee Portal, step 2 (owner, 2026-10-10; docs/modules/EMPLOYEE_PORTAL.md,
// decisions 91, 96-105): handlers per company and category; payroll
// queries (raised on a posted payslip, assigned, replies and internal
// notes, resolved, reopened within 14 days, withdrawn); files from the
// portal; advance and loan requests (limits per type, the line manager,
// HR's draft in Loans & Advances, the request following the loan); the
// employee's loans; Home tasks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, PROJECT } = require('./_helpers');

test.after(async () => { await app.delete(); });

const AUTH = 'http://127.0.0.1:9099';
const PDF = Buffer.from('%PDF-1.4\n% bank statement\n').toString('base64');
let ALI, SARA, BEN, AUG, JULY, ADV, LOANT;
const UID = {};
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const er = (uid, action, data) => call(uid, 'employeeRequests', Object.assign({ action }, data || {}));
const reqDoc = async id => (await firestore.collection('employeeRequests').doc(id).get()).data();
async function portalUser(code, pw, newPw) {
  const res = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: code.toLowerCase() + '@ess.invalid', password: pw, returnSecureToken: true })
  });
  const uid = (await res.json()).localId;
  await ess(uid, 'changePassword', { newPassword: newPw });
  return uid;
}

// Ali (EMP-0001, basic 6,000 + housing 1,500) reports to Sara (EMP-0002);
// Ben (EMP-0003) has no manager and is on probation to the end of 2026.
// Handlers in C1: Deduction → approver; all other categories → admin,
// backup approver.
test.before(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  f.permissions.EMPREQUESTS = { access: ['Admin', 'Viewer'], handle: ['Admin'], setup: ['Admin'] };
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-LOAN': { AccountCode: '1260', AccountName: 'Employee Loans', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1', Gender: 'Male' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  BEN = await emp({ FullName: 'Ben Okafor', ProbationEndDate: '2026-12-31' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  const EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const [id, lines] of [[ALI, [[EL.BASIC, 6000], [EL.HRA, 1500]]], [SARA, [[EL.BASIC, 9000]]], [BEN, [[EL.BASIC, 3000]]]]) {
    await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: lines.map(([e, a]) => ({ ElementID: e, Amount: a })) } });
  }
  for (const id of [EL.BASIC, EL.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  for (const m of ['2026-07', '2026-08']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: JULY });
  AUG = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId; // left a draft
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI, SARA, BEN] });
  UID.ALI = await portalUser('EMP-0001', 'alih0001', 'Sunrise#2026');
  UID.SARA = await portalUser('EMP-0002', 'sara0002', 'Garden#2026');
  UID.BEN = await portalUser('EMP-0003', 'beno0003', 'Harbour#2026');
  ADV = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Salary Advance', Kind: 'Advance', GLAccountID: 'A-LOAN', MaxMonths: 1, MaxBasis: 'Basic', OneOpen: true } })).loanTypeId;
  LOANT = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Personal Loan', Kind: 'Loan', GLAccountID: 'A-LOAN', MaxMonths: 2, MaxBasis: 'Gross', MaxInstalments: 6, AfterProbation: true } })).loanTypeId;
});

test('handlers: set per company and category by "setup", only people who handle the company; a company default with a backup', async () => {
  await assert.rejects(er('u-viewer', 'saveHandler', { companyId: 'C1', category: 'Deduction', handlerUid: 'u-approver' }), /permission to set up the handlers/);
  await assert.rejects(er('u-admin', 'saveHandler', { companyId: 'C1', category: 'Deduction', handlerUid: 'u-viewer' }), /Choose the handler/);
  await assert.rejects(er('u-admin', 'saveHandler', { companyId: 'C1', category: 'Deduction', handlerUid: 'u-other' }), /Choose the handler/);
  await er('u-admin', 'saveHandler', { companyId: 'C1', category: 'Deduction', handlerUid: 'u-approver' });
  await assert.rejects(er('u-admin', 'saveHandler', { companyId: 'C1', category: 'All categories', handlerUid: 'u-admin', backupUid: 'u-admin' }), /backup is someone else/);
  await er('u-admin', 'saveHandler', { companyId: 'C1', category: 'All categories', handlerUid: 'u-admin', backupUid: 'u-approver' });
  const h = await er('u-admin', 'handlers');
  assert.deepEqual(h.handlers.map(x => [x.Category, x.HandlerName, x.BackupName]), [['All categories', 'Admin User', 'Approver'], ['Deduction', 'Approver', '']]);
  assert.deepEqual(h.people.C1.map(p => p.Uid), ['u-admin', 'u-approver']);
});

let Q;
test('a payroll query: raised on a posted payslip; assigned; replies and internal notes; the Home task; resolved; reopened within 14 days', async () => {
  await assert.rejects(ess(UID.ALI, 'raiseQuery', { runId: AUG, category: 'Deduction', description: 'x' }), /Choose the month, from your payslips/);
  await assert.rejects(ess(UID.ALI, 'raiseQuery', { runId: JULY, category: 'Bonus', description: 'x' }), /Choose what the query is about/);
  await assert.rejects(ess(UID.ALI, 'raiseQuery', { runId: JULY, category: 'Deduction' }), /Describe what looks wrong/);
  const r = await ess(UID.ALI, 'raiseQuery', { runId: JULY, category: 'Deduction', lines: [0, 99], expected: '6,000', description: 'My basic looks short.' });
  Q = r.requestId;
  assert.deepEqual([r.number, r.assignedTo], ['PQ-2026-0001', 'Approver']);
  const d = await reqDoc(Q);
  assert.deepEqual([d.Month, d.Status, d.Expected, d.Lines.map(l => [l.Code, l.Amount])], ['2026-07', 'New', 6000, [['BASIC', 6000]]]);
  // The Home task: the assigned handler only.
  assert.deepEqual((await er('u-approver', 'tasks')).items.map(x => [x.Number, x.What]), [['PQ-2026-0001', 'New query']]);
  assert.deepEqual((await er('u-admin', 'tasks')).items, []);
  // An internal note: not shown to the employee, the query stays waiting.
  await er('u-approver', 'reply', { id: Q, text: 'Checking with Finance.', internal: true });
  assert.equal((await ess(UID.ALI, 'request', { id: Q })).request.Messages.length, 0);
  await er('u-approver', 'reply', { id: Q, text: 'We are looking into it.' });
  const list = (await ess(UID.ALI, 'requests')).requests;
  assert.deepEqual([list[0].StatusText, list[0].Unread], ['In progress', true]);
  assert.equal((await ess(UID.ALI, 'home')).requests.unread, 1);
  const det = await ess(UID.ALI, 'request', { id: Q });
  assert.deepEqual(det.request.Messages.map(m => [m.From, m.Text]), [['HR', 'We are looking into it.']]);
  assert.equal((await ess(UID.ALI, 'home')).requests.unread, 0, 'read once opened');
  assert.equal((await er('u-approver', 'tasks')).items.length, 0, 'answered: not waiting');
  await ess(UID.ALI, 'replyRequest', { id: Q, text: 'Thanks, it was 300 short.' });
  assert.deepEqual((await er('u-approver', 'tasks')).items.map(x => x.What), ['Employee replied']);
  // Only those who handle act; the employee never sees internal notes.
  await assert.rejects(er('u-viewer', 'reply', { id: Q, text: 'x' }), /permission to handle/);
  await assert.rejects(er('u-approver', 'resolve', { id: Q }), /Say what was done/);
  await er('u-approver', 'resolve', { id: Q, text: 'Corrected: 300 refunded in the September payroll.' });
  const done = await ess(UID.ALI, 'request', { id: Q });
  assert.deepEqual([done.request.StatusText, done.canReply, done.canReopen, done.request.Outcome], ['Resolved', false, true, 'Corrected: 300 refunded in the September payroll.']);
  await assert.rejects(ess(UID.ALI, 'replyRequest', { id: Q, text: 'x' }), /closed: reopen it/);
  await assert.rejects(ess(UID.ALI, 'reopenQuery', { id: Q }), /Say why/);
  await ess(UID.ALI, 'reopenQuery', { id: Q, text: 'Not refunded yet.' });
  assert.equal((await reqDoc(Q)).Status, 'InProgress');
  await er('u-approver', 'resolve', { id: Q, text: 'Now paid.' });
  await firestore.collection('employeeRequests').doc(Q).update({ ResolvedAt: new Date(Date.now() - 15 * 86400000).toISOString() });
  await assert.rejects(ess(UID.ALI, 'reopenQuery', { id: Q, text: 'Again' }), /within 14 days: raise a new one, mentioning PQ-2026-0001/);
  // Never another employee's.
  await assert.rejects(ess(UID.SARA, 'request', { id: Q }), /not your request/);
});

test('the company default handler and backup; reassigning; withdrawing a new query; rejecting one', async () => {
  const o = (await ess(UID.ALI, 'raiseQuery', { runId: JULY, category: 'Overtime', description: 'Overtime of 12 hours missing.' })).requestId;
  assert.deepEqual([(await er('u-admin', 'tasks')).items.length, (await er('u-approver', 'tasks')).items.length], [1, 1], 'handler and backup');
  await er('u-approver', 'assign', { id: o, uid: 'u-approver' });
  assert.deepEqual([(await er('u-admin', 'tasks')).items.length, (await er('u-approver', 'tasks')).items.length], [0, 1]);
  await assert.rejects(er('u-approver', 'assign', { id: o, uid: 'u-viewer' }), /Choose someone who handles/);
  assert.match((await reqDoc(o)).History.map(h => h.Event).join(' | '), /Assigned to Approver/);
  await assert.rejects(er('u-approver', 'reject', { id: o }), /Give the reason/);
  await er('u-approver', 'reject', { id: o, text: 'No overtime was approved for July.' });
  assert.deepEqual((await ess(UID.ALI, 'request', { id: o })).request.RejectionReason, 'No overtime was approved for July.');
  const w = (await ess(UID.ALI, 'raiseQuery', { runId: JULY, category: 'Other', description: 'Typo in my name.' })).requestId;
  await ess(UID.ALI, 'withdrawRequest', { id: w });
  assert.equal((await reqDoc(w)).Status, 'Withdrawn');
  await assert.rejects(ess(UID.ALI, 'withdrawRequest', { id: Q }), /Only a query nobody has answered yet/);
});

test('files: the employee adds up to 5 to their own request; HR sees them in Employee Requests; never on another employee\'s', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const q = (await ess(UID.ALI, 'raiseQuery', { runId: JULY, category: 'Deduction', description: 'See the statement.' })).requestId;
  const up = await ess(UID.ALI, 'uploadFile', { id: q, fileName: 'statement.pdf', data: PDF });
  assert.equal(up.file.FileName, 'statement.pdf');
  await assert.rejects(ess(UID.SARA, 'uploadFile', { id: q, fileName: 'x.pdf', data: PDF }), /not your request/);
  await assert.rejects(ess(UID.ALI, 'uploadFile', { id: q, fileName: 'x.exe', data: PDF }), /can be attached/);
  for (let i = 2; i <= 5; i++) await ess(UID.ALI, 'uploadFile', { id: q, fileName: 'page' + i + '.pdf', data: PDF });
  await assert.rejects(ess(UID.ALI, 'uploadFile', { id: q, fileName: 'six.pdf', data: PDF }), /At most 5 files/);
  const det = await ess(UID.ALI, 'request', { id: q });
  assert.deepEqual([det.files.length, det.canUpload], [5, false]);
  const opened = await ess(UID.ALI, 'openFile', { id: q, attachmentId: det.files[0].AttachmentID });
  assert.equal(Buffer.from(opened.data, 'base64').toString().slice(0, 8), '%PDF-1.4');
  const hr = await call('u-approver', 'getAttachments', { module: 'EMPREQUESTS', docId: q });
  assert.equal(hr.files.length, 5);
  await assert.rejects(call('u-other', 'getAttachments', { module: 'EMPREQUESTS', docId: q }), /access to that company/);
});

test('advance and loan requests: limits per type; the line manager; HR drafts the loan; the request follows it; the employee\'s loans', async () => {
  // Limits (decision 103).
  const form = await ess(UID.ALI, 'loanForm');
  assert.deepEqual(form.types.map(t => [t.Name, t.MaxText, t.Blocked]),
    [['Personal Loan', 'Up to 2 months\' gross salary: 15,000.00', ''], ['Salary Advance', 'Up to 1 month\'s basic salary: 6,000.00', '']]);
  assert.equal(form.manager, 'Sara Khan');
  await assert.rejects(ess(UID.ALI, 'requestLoan', { loanTypeId: ADV, amount: 6500, reason: 'Rent' }), /Up to 1 month's basic salary: 6,000\.00/);
  await assert.rejects(ess(UID.ALI, 'requestLoan', { loanTypeId: LOANT, amount: 12000, months: 8, reason: 'Car' }), /at most 6 instalments: 8 asked/);
  await assert.rejects(ess(UID.BEN, 'requestLoan', { loanTypeId: LOANT, amount: 1000, months: 2, reason: 'x' }), /available after probation \(ends 2026-12-31\)/);
  await assert.rejects(ess(UID.ALI, 'requestLoan', { loanTypeId: ADV, amount: 5000 }), /Give the reason/);
  // The manager first (decision 102).
  const a = await ess(UID.ALI, 'requestLoan', { loanTypeId: ADV, amount: 5000, reason: 'School fees' });
  assert.deepEqual([a.number, a.status], ['LR-2026-0001', 'WithManager']);
  await assert.rejects(ess(UID.ALI, 'requestLoan', { loanTypeId: ADV, amount: 100, reason: 'More' }), /You already asked for a Salary Advance \(LR-2026-0001\)/);
  const team = await ess(UID.SARA, 'team');
  assert.deepEqual(team.loanRequests.map(x => [x.Number, x.EmployeeName, x.Amount]), [['LR-2026-0001', 'Ali Hassan', 5000]]);
  assert.equal((await ess(UID.SARA, 'home')).teamPending, 1);
  assert.deepEqual((await er('u-admin', 'tasks')).items.filter(x => x.Type === 'Loan'), [], 'not with HR yet');
  await assert.rejects(ess(UID.BEN, 'decideLoanRequest', { id: a.requestId, decision: 'Approved' }), /Only the employee's line manager/);
  await ess(UID.SARA, 'decideLoanRequest', { id: a.requestId, decision: 'Approved' });
  assert.equal((await ess(UID.ALI, 'request', { id: a.requestId })).request.StatusText, 'With HR');
  // HR: the company default handler (Loan / advance has no row of its own).
  assert.deepEqual((await er('u-admin', 'tasks')).items.map(x => [x.Number, x.What]), [['LR-2026-0001', 'Loan request to review']]);
  await assert.rejects(er('u-viewer', 'draftLoan', { id: a.requestId }), /permission to handle/);
  const loanId = (await er('u-admin', 'draftLoan', { id: a.requestId })).loanId;
  assert.equal((await er('u-admin', 'draftLoan', { id: a.requestId })).loanId, loanId, 'drafted once');
  const loan = (await call('u-admin', 'getLoan', { loanId })).loan;
  assert.deepEqual([loan.Status, loan.Amount, loan.Instalment, loan.TypeName, loan.EmployeeName], ['Draft', 5000, 5000, 'Salary Advance', 'Ali Hassan']);
  assert.match(loan.Note, /^Requested in the Employee Portal, LR-2026-0001: School fees/);
  // Submitted in Loans & Advances as today: the request follows.
  await call('u-admin', 'submitLoan', { loanId });
  assert.equal((await ess(UID.ALI, 'request', { id: a.requestId })).request.StatusText, 'Approved');
  await assert.rejects(ess(UID.ALI, 'withdrawRequest', { id: a.requestId }), /already with the approvers/);
  await assert.rejects(er('u-admin', 'reject', { id: a.requestId, text: 'x' }), /already with the approvers: reject it there/);
  assert.deepEqual((await er('u-admin', 'tasks')).items, []);
  await call('u-admin', 'payOutLoan', { loanId, date: '2026-09-01', accountId: 'A-BANK' });
  assert.equal((await ess(UID.ALI, 'request', { id: a.requestId })).request.StatusText, 'Paid out · running');
  const mine = (await ess(UID.ALI, 'loans')).loans;
  assert.deepEqual(mine.map(l => [l.TypeName, l.Status, l.Amount, l.Balance]), [['Salary Advance', 'Running', 5000, 5000]]);
  // One open at a time (OneOpen): the running advance blocks another.
  assert.match((await ess(UID.ALI, 'loanForm')).types.find(t => t.Name === 'Salary Advance').Blocked, /already have a Salary Advance open \(LN-0001\)/);
  // A loan request rejected by the manager.
  const b = await ess(UID.ALI, 'requestLoan', { loanTypeId: LOANT, amount: 9000, instalment: 1500, reason: 'Car repair' });
  assert.deepEqual([(await reqDoc(b.requestId)).Months, (await reqDoc(b.requestId)).Instalment], [6, 1500]);
  await assert.rejects(ess(UID.SARA, 'decideLoanRequest', { id: b.requestId, decision: 'Rejected' }), /reason for rejecting/);
  await ess(UID.SARA, 'decideLoanRequest', { id: b.requestId, decision: 'Rejected', reason: 'Too soon after the advance' });
  assert.equal((await ess(UID.ALI, 'request', { id: b.requestId })).request.StatusText, 'Rejected');
});

test('loan requests without a manager go straight to HR; HR rejecting deletes its draft; the employee withdrawing deletes it too', async () => {
  await firestore.collection('employees').doc(BEN).update({ ProbationEndDate: '2025-12-31' });
  const c = await ess(UID.BEN, 'requestLoan', { loanTypeId: LOANT, amount: 3000, months: 3, reason: 'Medical' });
  assert.equal(c.status, 'WithHR');
  const l1 = (await er('u-admin', 'draftLoan', { id: c.requestId })).loanId;
  await er('u-admin', 'reject', { id: c.requestId, text: 'Use the medical insurance.' });
  assert.equal((await firestore.collection('payrollLoans').doc(l1).get()).exists, false);
  const d = await ess(UID.BEN, 'requestLoan', { loanTypeId: LOANT, amount: 2000, months: 2, reason: 'Medical bills' });
  const l2 = (await er('u-admin', 'draftLoan', { id: d.requestId })).loanId;
  await ess(UID.BEN, 'withdrawRequest', { id: d.requestId });
  assert.equal((await firestore.collection('payrollLoans').doc(l2).get()).exists, false);
  // The list in the ERP: by company access, with what waits.
  const list = await er('u-admin', 'list');
  assert.ok(list.requests.length >= 6 && list.canHandle && list.canSetup);
  assert.deepEqual((await er('u-other', 'list')).requests, []);
});
