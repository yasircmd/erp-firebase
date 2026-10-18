// Employee Portal, step 3 (owner, 2026-10-10; docs/modules/EMPLOYEE_PORTAL.md,
// decisions 93, 94, 106-109): reimbursement categories with their own
// earning elements; claims with bills and receipts; the line manager, then
// Approval Configuration "Reimbursement" (approve in part); the Earnings &
// Deductions entries for the payroll month (cut-off day, a run past its
// draft); Paid once that run is posted; over a monthly limit flagged; leave
// documents from the portal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, PROJECT, val, put } = require('./_helpers');
const { todayIn } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const AUTH = 'http://127.0.0.1:9099';
const PDF = Buffer.from('%PDF-1.4\n% receipt\n').toString('base64');
const T = todayIn('Asia/Dubai'), MONTH = T.slice(0, 7);
const ago = n => new Date(Date.parse(T) - n * 86400000).toISOString().slice(0, 10);
const nextMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = m => MON[Number(m.slice(5, 7)) - 1] + '-' + m.slice(0, 4);
let ALI, SARA, BEN, TRAVEL, FUEL, TYPE;
const UID = {};
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const er = (uid, action, data) => call(uid, 'employeeRequests', Object.assign({ action }, data || {}));
const rs = (uid, action, data) => call(uid, 'reimbursementSetup', Object.assign({ action }, data || {}));
const reqDoc = async id => (await firestore.collection('employeeRequests').doc(id).get()).data();
const entriesOf = async id => (await firestore.collection('payrollInputs').where('ClaimID', '==', id).get()).docs.map(d => d.data());
async function portalUser(code, pw, newPw) {
  const res = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: code.toLowerCase() + '@ess.invalid', password: pw, returnSecureToken: true })
  });
  const uid = (await res.json()).localId;
  await ess(uid, 'changePassword', { newPassword: newPw });
  return uid;
}
async function claim(uid, bills, receipts) {
  const r = await ess(uid, 'raiseClaim', { bills, description: 'Trip' });
  for (const i of receipts || []) await ess(uid, 'uploadFile', { id: r.requestId, billIndex: i, fileName: 'receipt' + i + '.pdf', data: PDF });
  return r;
}

// Ali (EMP-0001) reports to Sara (EMP-0002); Ben (EMP-0003) has no manager.
test.before(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  f.permissions.EMPREQUESTS = { access: ['Admin', 'Viewer'], handle: ['Admin'], setup: ['Admin'] };
  Object.assign(f.coa, {
    'A-TRAVEL': { AccountCode: '6400', AccountName: 'Travel', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FUEL': { AccountCode: '6410', AccountName: 'Fuel', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1', Gender: 'Male' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  BEN = await emp({ FullName: 'Ben Okafor' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI, SARA, BEN] });
  UID.ALI = await portalUser('EMP-0001', 'alih0001', 'Sunrise#2026');
  UID.SARA = await portalUser('EMP-0002', 'sara0002', 'Garden#2026');
  UID.BEN = await portalUser('EMP-0003', 'beno0003', 'Harbour#2026');
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  for (const y of [Number(T.slice(0, 4)), Number(T.slice(0, 4)) + 1]) await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: y, weekend: [0, 6], holidays: [] });
});

test('categories: Payroll Setup\'s right; an expense account; each with its own earning element, kept in step', async () => {
  await assert.rejects(rs('u-viewer', 'save', { category: { Name: 'Travel', GLAccountID: 'A-TRAVEL' } }), /access to Payroll Setup|permission to change Payroll Setup/);
  await assert.rejects(rs('u-admin', 'save', { category: { Name: 'Travel', GLAccountID: 'A-CASH' } }), /must be an expense account/);
  TRAVEL = (await rs('u-admin', 'save', { category: { Name: 'Travel', GLAccountID: 'A-TRAVEL', MonthlyLimit: 500, ReceiptRequired: true } })).categoryId;
  FUEL = (await rs('u-admin', 'save', { category: { Name: 'Fuel', GLAccountID: 'A-FUEL', ReceiptRequired: false, MaxAgeDays: 30 } })).categoryId;
  await assert.rejects(rs('u-admin', 'save', { category: { Name: 'travel', GLAccountID: 'A-TRAVEL' } }), /already a category/);
  const cats = (await rs('u-admin', 'list')).categories;
  assert.deepEqual(cats.map(c => [c.Name, c.ElementCode, c.MonthlyLimit, c.MaxAgeDays, c.ReceiptRequired]), [['Fuel', 'RB02', null, 30, false], ['Travel', 'RB01', 500, 60, true]]);
  const el = (await firestore.collection('hrPayElements').doc(cats[1].ElementID).get()).data();
  assert.deepEqual([el.Code, el.Name, el.Kind, el.Nature, el.InGross, el.Prorated, el.GLAccountID, el.Reimbursement], ['RB01', 'Reimbursement — Travel', 'Earning', 'Variable', false, false, 'A-TRAVEL', TRAVEL]);
  await rs('u-admin', 'save', { category: { CategoryID: TRAVEL, Name: 'Business Travel', GLAccountID: 'A-TRAVEL', MonthlyLimit: 500 } });
  assert.equal((await firestore.collection('hrPayElements').doc(cats[1].ElementID).get()).data().Name, 'Reimbursement — Business Travel');
  await rs('u-admin', 'save', { category: { CategoryID: TRAVEL, Name: 'Travel', GLAccountID: 'A-TRAVEL', MonthlyLimit: 500 } });
  // A new kind in Numbering, the approval in Approval Configuration.
  assert.ok((await call('u-admin', 'getNumbering', {})).kinds.some(k => k.key === 'hr:RC'));
});

let C1;
test('a claim: bills checked (date, age, category); the receipt required before sending; the manager approves; E&D entries for this month\'s payroll; Paid when the run is posted', async () => {
  await assert.rejects(ess(UID.ALI, 'raiseClaim', { bills: [] }), /at least one bill/);
  await assert.rejects(ess(UID.ALI, 'raiseClaim', { bills: [{ categoryId: TRAVEL, date: nextMonth(MONTH) + '-01', amount: 10, description: 'x' }] }), /ahead of today/);
  await assert.rejects(ess(UID.ALI, 'raiseClaim', { bills: [{ categoryId: FUEL, date: ago(40), amount: 10, description: 'x' }] }), /Fuel bills are claimed within 30 days/);
  await assert.rejects(ess(UID.ALI, 'raiseClaim', { bills: [{ categoryId: TRAVEL, date: ago(1), amount: 0, description: 'x' }] }), /enter the amount/);
  const c = await claim(UID.ALI, [{ categoryId: TRAVEL, date: ago(5), amount: 300, description: 'Taxi to client' }, { categoryId: FUEL, date: ago(3), amount: '120.50', description: 'Fuel' }]);
  C1 = c.requestId;
  assert.equal(c.number, 'RC-' + T.slice(0, 4) + '-0001');
  let d = await ess(UID.ALI, 'request', { id: C1 });
  assert.deepEqual([d.request.StatusText, d.request.Total, d.canSubmit, d.request.Bills.length], ['Not sent yet', 420.5, true, 2]);
  await assert.rejects(ess(UID.ALI, 'submitClaim', { id: C1 }), /Add the receipt for bill 1 \(Travel\)/);
  await assert.rejects(ess(UID.SARA, 'uploadFile', { id: C1, billIndex: 0, fileName: 'r.pdf', data: PDF }), /not your request/);
  await ess(UID.ALI, 'uploadFile', { id: C1, billIndex: 0, fileName: 'taxi.pdf', data: PDF });
  assert.equal((await ess(UID.ALI, 'submitClaim', { id: C1 })).status, 'WithManager');
  await assert.rejects(ess(UID.ALI, 'uploadFile', { id: C1, billIndex: 1, fileName: 'r.pdf', data: PDF }), /has been sent/);
  // The manager in Team.
  const t = await ess(UID.SARA, 'team');
  assert.deepEqual(t.claims.map(x => [x.Number, x.EmployeeName, x.Total, x.Bills.map(b => [b.CategoryName, b.Amount, b.Files])]), [[c.number, 'Ali Hassan', 420.5, [['Travel', 300, 1], ['Fuel', 120.5, 0]]]]);
  assert.equal((await ess(UID.SARA, 'home')).teamPending, 1);
  await assert.rejects(ess(UID.BEN, 'decideClaim', { id: C1, decision: 'Approved' }), /Only the employee's line manager/);
  // No approval set up: approved at once; one entry per category, this month (no cut-off, no run yet).
  assert.equal((await ess(UID.SARA, 'decideClaim', { id: C1, decision: 'Approved' })).status, 'Approved');
  const e = (await entriesOf(C1)).sort((a, b) => a.Code.localeCompare(b.Code));
  assert.deepEqual(e.map(x => [x.Code, x.ElementName, x.Amount, x.Month, x.Note, x.PayBy, x.CompanyID]),
    [['RB01', 'Reimbursement — Travel', 300, MONTH, c.number, 'Run', 'C1'], ['RB02', 'Reimbursement — Fuel', 120.5, MONTH, c.number, 'Run', 'C1']]);
  d = await ess(UID.ALI, 'request', { id: C1 });
  assert.equal(d.request.StatusText, 'Approved — paid with the ' + monthText(MONTH) + ' payroll');
  assert.ok(d.request.History.some(h => h.Event === 'Approved by the line manager'));
  await firestore.collection('payrollRuns').doc('C1_' + MONTH).set({ CompanyID: 'C1', Month: MONTH, Status: 'Posted' });
  assert.equal((await ess(UID.ALI, 'request', { id: C1 })).request.StatusText, 'Paid with the ' + monthText(MONTH) + ' payroll');
  await firestore.collection('payrollRuns').doc('C1_' + MONTH).delete();
});

test('the payroll month: from the cut-off day, the next month; a month whose run is past its draft is skipped', async () => {
  const cut = Math.min(Number(T.slice(8, 10)), 28);
  await firestore.collection('payrollSettings').doc('C1').set({ CutOffDay: cut }, { merge: true });
  const c = await claim(UID.ALI, [{ categoryId: FUEL, date: ago(1), amount: 50, description: 'Fuel' }]);
  await ess(UID.ALI, 'submitClaim', { id: c.requestId });
  await ess(UID.SARA, 'decideClaim', { id: c.requestId, decision: 'Approved' });
  assert.equal((await reqDoc(c.requestId)).PayMonth, nextMonth(MONTH));
  await firestore.collection('payrollSettings').doc('C1').set({ CutOffDay: 0 }, { merge: true });
  await firestore.collection('payrollRuns').doc('C1_' + MONTH).set({ CompanyID: 'C1', Month: MONTH, Status: 'PendingApproval' });
  const c2 = await claim(UID.ALI, [{ categoryId: FUEL, date: ago(1), amount: 40, description: 'Fuel' }]);
  await ess(UID.ALI, 'submitClaim', { id: c2.requestId });
  await ess(UID.SARA, 'decideClaim', { id: c2.requestId, decision: 'Approved' });
  assert.equal((await reqDoc(c2.requestId)).PayMonth, nextMonth(MONTH));
  await firestore.collection('payrollRuns').doc('C1_' + MONTH).delete();
});

test('Approval Configuration "Reimbursement": no manager, straight to the approvers (Home task); over the monthly limit flagged; approved in part, with the reason shown', async () => {
  await rtdb.ref('approvalConfigurations/REIMBURSEMENT').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/REIMBURSEMENT').set({ GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } });
  const c = await claim(UID.BEN, [{ categoryId: TRAVEL, date: ago(2), amount: 450, description: 'Flight' }, { categoryId: TRAVEL, date: ago(2), amount: 150, description: 'Hotel' }], [0, 1]);
  assert.equal((await ess(UID.BEN, 'submitClaim', { id: c.requestId })).status, 'InApproval');
  const tasks = await call('u-approver', 'getPendingApprovalsForUser', {});
  assert.deepEqual(tasks.filter(x => x.DocumentID === c.requestId).map(x => [x.ModuleID, x.ModuleLabel, x.Amount]), [['EMPREQUESTS', 'Reimbursement claim (the amount is the claim total)', 600]]);
  const g = await er('u-approver', 'get', { id: c.requestId });
  assert.deepEqual([g.request.Total, g.request.Approval.MyLevels, g.request.Flags], [600, [1], ['Travel: over the monthly limit (500.00) by 100.00 for ' + monthText(T.slice(0, 7)) + '.']]);
  await assert.rejects(er('u-admin', 'decideClaim', { id: c.requestId, levelNumber: 1, decision: 'Approved' }), /not the assigned approver/);
  await assert.rejects(er('u-approver', 'decideClaim', { id: c.requestId, levelNumber: 1, decision: 'Approved', adjust: [{ index: 1, amount: 50 }] }), /Say why bill 2 is approved in part/);
  await assert.rejects(er('u-approver', 'decideClaim', { id: c.requestId, levelNumber: 1, decision: 'Approved', adjust: [{ index: 1, amount: 200, note: 'x' }] }), /0 to the amount claimed \(150\.00\)/);
  const out = await er('u-approver', 'decideClaim', { id: c.requestId, levelNumber: 1, decision: 'Approved', adjust: [{ index: 1, amount: 50, note: 'Hotel above the policy rate' }] });
  assert.equal(out.status, 'Approved');
  assert.deepEqual((await entriesOf(c.requestId)).map(x => [x.Code, x.Amount]), [['RB01', 500]]);
  const v = (await ess(UID.BEN, 'request', { id: c.requestId })).request;
  assert.deepEqual([v.Total, v.ApprovedTotal, v.Bills[1].Approved, v.Bills[1].Note], [600, 500, 50, 'Hotel above the policy rate']);
  assert.match(v.History.map(h => h.Event).join(' | '), /Approved in part: 500\.00 of 600\.00/);
  assert.equal((await call('u-approver', 'getPendingApprovalsForUser', {})).filter(x => x.DocumentID === c.requestId).length, 0);
  // Rejected by the approver; withdrawn by the employee (its approval withdrawn too); HR rejects.
  const r1 = await claim(UID.BEN, [{ categoryId: FUEL, date: ago(1), amount: 30, description: 'Fuel' }]);
  await ess(UID.BEN, 'submitClaim', { id: r1.requestId });
  await assert.rejects(er('u-approver', 'decideClaim', { id: r1.requestId, levelNumber: 1, decision: 'Rejected' }), /reason is required/);
  await er('u-approver', 'decideClaim', { id: r1.requestId, levelNumber: 1, decision: 'Rejected', reason: 'Personal use' });
  assert.deepEqual([(await reqDoc(r1.requestId)).Status, (await reqDoc(r1.requestId)).RejectionReason, (await entriesOf(r1.requestId)).length], ['Rejected', 'Personal use', 0]);
  const r2 = await claim(UID.BEN, [{ categoryId: FUEL, date: ago(1), amount: 20, description: 'Fuel' }]);
  await ess(UID.BEN, 'submitClaim', { id: r2.requestId });
  await ess(UID.BEN, 'withdrawRequest', { id: r2.requestId });
  const inst = (await val('approvalInstances/' + (await reqDoc(r2.requestId)).ApprovalInstanceID));
  assert.equal(inst.Status, 'Withdrawn');
  const r3 = await claim(UID.BEN, [{ categoryId: FUEL, date: ago(1), amount: 25, description: 'Fuel' }]);
  await ess(UID.BEN, 'submitClaim', { id: r3.requestId });
  await er('u-admin', 'reject', { id: r3.requestId, text: 'Raise it under the travel policy' });
  assert.equal((await val('approvalInstances/' + (await reqDoc(r3.requestId)).ApprovalInstanceID)).Status, 'Withdrawn');
  await assert.rejects(ess(UID.BEN, 'withdrawRequest', { id: c.requestId }), /already with the approvers|closed|withdraw/i);
  await rtdb.ref('approvalConfigurations/REIMBURSEMENT').remove();
});

test('leave documents from the portal: attached when applying (no manager, no approval: approved once attached); added later; seen by the line manager', async () => {
  // Ben: no manager, no Approval Configuration for leave. Without a document: refused.
  const sick = { LeaveTypeID: TYPE.SICK, FromDate: ago(3), ToDate: ago(1) };
  await assert.rejects(ess(UID.BEN, 'applyLeave', { leave: sick }), /needs a supporting document .* attach it, or hand it to HR/);
  const a = await ess(UID.BEN, 'applyLeave', { leave: sick, withDocument: true });
  assert.equal(a.status, 'Draft');
  const mine = (await ess(UID.BEN, 'leaves')).leaves.find(l => l.LeaveID === a.leaveId);
  assert.deepEqual([mine.StatusText, mine.CanSend, mine.CanCancel], ['Not sent yet', true, true]);
  assert.ok(!(await call('u-admin', 'getLeaves', {})).leaves.some(l => l.LeaveID === a.leaveId), 'not in the Leave Register until sent');
  await assert.rejects(ess(UID.BEN, 'sendLeave', { leaveId: a.leaveId }), /attach it, or hand it to HR/);
  await ess(UID.BEN, 'uploadLeaveFile', { leaveId: a.leaveId, fileName: 'certificate.pdf', data: PDF });
  assert.equal((await ess(UID.BEN, 'sendLeave', { leaveId: a.leaveId })).status, 'Approved');
  const l = (await call('u-admin', 'getLeave', { leaveId: a.leaveId })).leave;
  assert.deepEqual([l.Status, l.DocumentMissing, l.AcceptedWithoutDocument], ['Approved', false, null]);
  // Ali: to his manager with the document; Sara sees and opens it; Ben can't.
  const b = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.SICK, FromDate: ago(6), ToDate: ago(5) }, withDocument: true });
  const up = await ess(UID.ALI, 'uploadLeaveFile', { leaveId: b.leaveId, fileName: 'note.pdf', data: PDF });
  assert.equal((await ess(UID.ALI, 'sendLeave', { leaveId: b.leaveId })).status, 'PendingManager');
  const row = (await ess(UID.SARA, 'team')).pending.find(x => x.LeaveID === b.leaveId);
  assert.deepEqual([row.Files.map(f => f.FileName), row.NoDocument], [['note.pdf'], false]);
  assert.equal(Buffer.from((await ess(UID.SARA, 'openLeaveFile', { leaveId: b.leaveId, attachmentId: up.file.AttachmentID })).data, 'base64').toString().slice(0, 8), '%PDF-1.4');
  await assert.rejects(ess(UID.BEN, 'openLeaveFile', { leaveId: b.leaveId, attachmentId: up.file.AttachmentID }), /not your leave/);
  // A draft deleted (its file to Removed).
  const c = await ess(UID.ALI, 'applyLeave', { leave: { LeaveTypeID: TYPE.SICK, FromDate: ago(10), ToDate: ago(10) }, withDocument: true });
  await ess(UID.ALI, 'uploadLeaveFile', { leaveId: c.leaveId, fileName: 'x.pdf', data: PDF });
  assert.equal((await ess(UID.ALI, 'cancelLeave', { leaveId: c.leaveId })).status, 'Deleted');
  assert.equal((await firestore.collection('leaveRequests').doc(c.leaveId).get()).exists, false);
});
