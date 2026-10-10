// Employee Requests, the Employee Portal's step 2 (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md, decisions 91, 96-105):
//   - payroll queries: raised in the portal on a payslip month, answered in
//     the ERP (replies the employee sees, internal notes they don't),
//     resolved or rejected, reopened by the employee within 14 days;
//   - advance and loan requests: the line manager, then HR, who drafts the
//     loan in Loans & Advances and submits it to Approval Configuration as
//     today; the request follows the loan from there;
//   - handlers per company and category (a company default for the rest),
//     who get the Home task; others with "handle" can step in or reassign.
// The portal's side is called through essPortal (essPortal.js), which
// works out the employee; the ERP's side is one callable,
// employeeRequests, with an action.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability, ensurePermissionsSeeded } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const files = require('./attachments');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'EMPREQUESTS';
const REQUESTS = () => firestore.collection('employeeRequests');
const HANDLERS = () => firestore.collection('employeeRequestHandlers');
const EMPLOYEES = () => firestore.collection('employees');
const RUNS = () => firestore.collection('payrollRuns');
const LOANS = () => firestore.collection('payrollLoans');

const QUERY_CATEGORIES = ['Deduction', 'Missing earning', 'Overtime', 'Leave pay', 'Loan', 'Other'];
const LOAN_CATEGORY = 'Loan / advance';
const CATEGORIES = QUERY_CATEGORIES.concat([LOAN_CATEGORY]);
const ALL = 'All categories';
const REOPEN_DAYS = 14; // decision 91
const MAX_EMPLOYEE_FILES = 5; // decision 98

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const num = v => Number(String(v == null ? '' : v).replace(/,/g, ''));
const today = () => todayIn('Asia/Dubai');
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const nextMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); };
const docs = snap => snap.docs.map(d => Object.assign({ RequestID: d.id }, d.data()));
const money = n => Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const nameOf = user => user.profile.fullName || user.profile.username || user.uid;
const entry = (event, by, note) => ({ Event: event, By: by, At: new Date().toISOString(), Note: note || '' });

// ---------- handlers (decisions 96, 100, 101) ----------

const handlerKey = (co, cat) => co + '__' + String(cat).replace(/[^A-Za-z]/g, '');
// The handler of a company and category, else the company default.
async function assignmentFor(co, category) {
  const row = (await HANDLERS().doc(handlerKey(co, category)).get()).data() || (await HANDLERS().doc(handlerKey(co, ALL)).get()).data();
  return row ? { AssignedUid: row.HandlerUid, AssignedName: row.HandlerName, BackupUid: row.BackupUid || '', BackupName: row.BackupName || '' }
    : { AssignedUid: '', AssignedName: '', BackupUid: '', BackupName: '' };
}
// The ERP users with "handle" for a company: those it may be assigned to.
async function handlersFor(co) {
  const [users, perms] = await Promise.all([rtdb.ref('users').get(), ensurePermissionsSeeded()]);
  const roles = ((perms[MODULE_ID] || {}).handle) || [];
  return Object.entries(users.val() || {}).filter(([, u]) => u && u.status === 'Active' && roles.includes(u.role) && userCanAccessCompany(u, co))
    .map(([uid, u]) => ({ Uid: uid, Name: u.fullName || u.username || uid })).sort((a, b) => a.Name.localeCompare(b.Name));
}

// ---------- shared ----------

const QUERY_STATUS = { New: 'New', InProgress: 'In progress', Resolved: 'Resolved', Rejected: 'Rejected', Withdrawn: 'Withdrawn' };
// A loan request's stage: its own while with the manager or HR, then the loan's.
function loanStage(r, loan) {
  if (r.Status === 'WithManager') return ['WithManager', 'With manager'];
  if (r.Status === 'Rejected') return ['Rejected', 'Rejected'];
  if (r.Status === 'Withdrawn') return ['Withdrawn', 'Withdrawn'];
  if (!loan || loan.Status === 'Draft') return ['WithHR', loan && loan.RejectedReason ? 'With HR (returned by the approver)' : 'With HR'];
  if (loan.Status === 'PendingApproval') return ['InApproval', 'In approval'];
  if (loan.Status === 'Approved') return ['Approved', 'Approved'];
  if (loan.Status === 'Active') return loan.Balance > 0 ? ['Running', 'Paid out · running'] : ['Repaid', 'Repaid'];
  return [loan.Status, loan.Status];
}
async function loanOf(r) {
  if (!r.LoanID) return null;
  const s = await LOANS().doc(r.LoanID).get();
  if (!s.exists) return null;
  const l = Object.assign({ LoanID: s.id }, s.data());
  if (l.Status === 'Active') {
    const P = require('./payrollLoans');
    l.Balance = P.balanceOf(l, (await P.recoveriesOf(l.CompanyID))[l.LoanID]);
  }
  return l;
}
async function stageOf(r) {
  if (r.Type === 'Query') return { Stage: r.Status, StatusText: QUERY_STATUS[r.Status] || r.Status, Loan: null };
  const loan = await loanOf(r);
  const [stage, label] = loanStage(r, loan);
  return { Stage: stage, StatusText: label, Loan: loan };
}
// Waiting for HR: a new query, one whose last word is the employee's, a
// loan request with HR and not yet submitted.
function waiting(r, loan) {
  if (r.Type === 'Query') return r.Status === 'New' || (r.Status === 'InProgress' && r.LastFrom === 'Employee');
  return r.Status === 'WithHR' && (!loan || loan.Status === 'Draft');
}
const isOpen = r => (r.Type === 'Query' ? ['New', 'InProgress'].includes(r.Status) : ['WithManager', 'WithHR'].includes(r.Status));
async function nextNumber(prefix) { return require('./numbering').hrNumber(prefix, Number(today().slice(0, 4))); }

function summary(r, st) {
  return {
    RequestID: r.RequestID, Type: r.Type, Number: r.Number, Category: r.Category, EmployeeID: r.EmployeeID, EmployeeNo: r.EmployeeNo, EmployeeName: r.EmployeeName, CompanyID: r.CompanyID,
    Month: r.Month || '', Title: r.Type === 'Query' ? r.Category + (r.Month ? ' · ' + r.Month : '') : r.TypeName + ' · ' + money(r.Amount),
    Stage: st.Stage, StatusText: st.StatusText, AssignedName: r.AssignedName || '', AssignedUid: r.AssignedUid || '', CreatedAt: r.CreatedAt, LastAt: r.LastAt || r.CreatedAt, LastFrom: r.LastFrom || ''
  };
}

// ---------- the portal's side (essPortal passes me: { uid, emp, actor }) ----------

async function loadOwn(me, id) {
  const s = await REQUESTS().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Request not found.');
  const r = Object.assign({ RequestID: s.id }, s.data());
  if (r.EmployeeID !== me.emp.EmployeeID) throw new HttpsError('permission-denied', 'That is not your request.');
  return r;
}
const employeeName = me => me.emp.FullName;
const unreadFor = r => (r.Messages || []).some(m => m.From === 'HR' && !m.Internal && (!r.ReadByEmployeeAt || m.At > r.ReadByEmployeeAt));

async function base(me, type, category) {
  const now = new Date().toISOString();
  return Object.assign({ Type: type, Category: category, EmployeeID: me.emp.EmployeeID, EmployeeNo: me.emp.EmployeeNo, EmployeeName: me.emp.FullName, CompanyID: me.emp.CompanyID,
    CreatedAt: now, CreatedByUid: me.uid, UpdatedAt: now, LastAt: now, LastFrom: 'Employee', Messages: [], ReadByEmployeeAt: now }, await assignmentFor(me.emp.CompanyID, category));
}

// A payroll query on a posted payslip month.
async function raiseQuery(me, d) {
  const run = (await RUNS().doc(text(d.runId, 120) || '-').get()).data();
  const slip = run && run.Status === 'Posted' ? (await RUNS().doc(text(d.runId, 120)).collection('slips').doc(me.emp.EmployeeID).get()).data() : null;
  if (!slip) bad('Choose the month, from your payslips.');
  const category = text(d.category, 30);
  if (!QUERY_CATEGORIES.includes(category)) bad('Choose what the query is about.');
  const description = text(d.description, 2000);
  if (!description) bad('Describe what looks wrong.');
  const lines = [...new Set((Array.isArray(d.lines) ? d.lines : []).map(Number))].filter(i => Number.isInteger(i) && slip.Lines[i])
    .map(i => ({ Code: slip.Lines[i].Code || '', Name: slip.Lines[i].Name, Kind: slip.Lines[i].Kind, Amount: slip.Lines[i].Amount }));
  const expected = d.expected === '' || d.expected == null ? null : round2(num(d.expected));
  if (expected != null && !(expected >= 0)) bad('The amount you expected is 0 or more.');
  const r = Object.assign(await base(me, 'Query', category), { Number: await nextNumber('PQ'), Status: 'New', RunID: text(d.runId, 120), Month: run.Month, Lines: lines, Expected: expected,
    Description: description, History: [entry('Raised', employeeName(me))] });
  const ref = await REQUESTS().add(r);
  return { success: true, requestId: ref.id, number: r.Number, assignedTo: r.AssignedName };
}

async function myRequests(me) {
  const list = docs(await REQUESTS().where('EmployeeID', '==', me.emp.EmployeeID).get());
  const out = [];
  for (const r of list) out.push(Object.assign(summary(r, await stageOf(r)), { Unread: unreadFor(r) }));
  return out.sort((a, b) => String(b.LastAt).localeCompare(String(a.LastAt)));
}

async function requestDetail(me, d) {
  const r = await loadOwn(me, d.id);
  const st = await stageOf(r);
  await REQUESTS().doc(r.RequestID).update({ ReadByEmployeeAt: new Date().toISOString() });
  const done = r.ResolvedAt || r.RejectedAt;
  const canReopen = r.Type === 'Query' && ['Resolved', 'Rejected'].includes(r.Status) && done && (Date.now() - Date.parse(done)) <= REOPEN_DAYS * 86400000;
  const mine = (await files.portalFiles(MODULE_ID, r.RequestID));
  return {
    request: Object.assign(summary(r, st), {
      Description: r.Description || '', Lines: r.Lines || [], Expected: r.Expected == null ? null : r.Expected, Outcome: r.Outcome || '', RejectionReason: r.RejectionReason || '',
      TypeName: r.TypeName || '', Kind: r.Kind || '', Amount: r.Amount || 0, Instalment: r.Instalment || 0, Months: r.Months || 0, StartMonth: r.StartMonth || '', Reason: r.Reason || '',
      ManagerName: r.ManagerName || '', LoanNumber: st.Loan ? st.Loan.LoanNumber || '' : '', Balance: st.Loan && st.Loan.Balance != null ? round2(st.Loan.Balance) : null,
      Messages: (r.Messages || []).filter(m => !m.Internal).map(m => ({ From: m.From, By: m.By, At: m.At, Text: m.Text })),
      History: (r.History || []).map(h => ({ Event: h.Event, By: h.By, At: h.At, Note: h.Note || '' }))
    }),
    files: mine, canReply: isOpen(r), canWithdraw: await canWithdraw(r, st), canReopen, canUpload: r.Status !== 'Withdrawn' && mine.filter(f => f.UploadedBy === me.uid).length < MAX_EMPLOYEE_FILES,
    reopenDays: REOPEN_DAYS, maxFiles: MAX_EMPLOYEE_FILES
  };
}
async function canWithdraw(r, st) {
  if (r.Type === 'Query') return r.Status === 'New';
  return r.Status === 'WithManager' || (r.Status === 'WithHR' && (!st.Loan || st.Loan.Status === 'Draft'));
}

async function employeeReply(me, d) {
  const r = await loadOwn(me, d.id);
  if (!isOpen(r)) throw failed(r.Type === 'Query' && ['Resolved', 'Rejected'].includes(r.Status) ? 'This query is closed: reopen it to write again.' : 'This request is closed.');
  const msg = text(d.text, 2000);
  if (!msg) bad('Write your message.');
  const now = new Date().toISOString();
  await REQUESTS().doc(r.RequestID).update({ Messages: (r.Messages || []).concat([{ From: 'Employee', By: employeeName(me), At: now, Text: msg, Internal: false }]),
    LastFrom: 'Employee', LastAt: now, UpdatedAt: now, ReadByEmployeeAt: now });
  return { success: true };
}

async function withdraw(me, d) {
  const r = await loadOwn(me, d.id);
  const st = await stageOf(r);
  if (!(await canWithdraw(r, st))) throw failed(r.Type === 'Query' ? 'Only a query nobody has answered yet can be withdrawn.' : 'It is already with the approvers: ask HR.');
  if (st.Loan && st.Loan.Status === 'Draft') await LOANS().doc(st.Loan.LoanID).delete();
  const now = new Date().toISOString();
  await REQUESTS().doc(r.RequestID).update({ Status: 'Withdrawn', WithdrawnAt: now, UpdatedAt: now, LoanID: '', History: (r.History || []).concat([entry('Withdrawn', employeeName(me), text(d.reason, 500))]) });
  return { success: true };
}

async function reopen(me, d) {
  const r = await loadOwn(me, d.id);
  const done = r.ResolvedAt || r.RejectedAt;
  if (r.Type !== 'Query' || !['Resolved', 'Rejected'].includes(r.Status)) throw failed('Only a resolved or rejected query can be reopened.');
  if (!done || Date.now() - Date.parse(done) > REOPEN_DAYS * 86400000) throw failed('A query can be reopened within ' + REOPEN_DAYS + ' days: raise a new one, mentioning ' + r.Number + '.');
  const msg = text(d.text, 2000);
  if (!msg) bad('Say why you are reopening it.');
  const now = new Date().toISOString();
  await REQUESTS().doc(r.RequestID).update({ Status: 'InProgress', ReopenedAt: now, UpdatedAt: now, LastFrom: 'Employee', LastAt: now, ReadByEmployeeAt: now,
    Messages: (r.Messages || []).concat([{ From: 'Employee', By: employeeName(me), At: now, Text: msg, Internal: false }]), History: (r.History || []).concat([entry('Reopened', employeeName(me))]) });
  return { success: true };
}

async function uploadFile(me, d) {
  const r = await loadOwn(me, d.id);
  if (r.Status === 'Withdrawn') throw failed('This request was withdrawn.');
  const mine = (await files.portalFiles(MODULE_ID, r.RequestID)).filter(f => f.UploadedBy === me.uid);
  if (mine.length >= MAX_EMPLOYEE_FILES) throw failed('At most ' + MAX_EMPLOYEE_FILES + ' files on one request.');
  const f = await files.portalUpload(me.actor, MODULE_ID, r.RequestID, d.fileName, d.data);
  await REQUESTS().doc(r.RequestID).update({ History: (r.History || []).concat([entry('File added: ' + f.FileName, employeeName(me))]), UpdatedAt: new Date().toISOString() });
  return { success: true, file: f };
}
async function openFile(me, d) {
  const r = await loadOwn(me, d.id);
  return files.portalOpen(me.actor, MODULE_ID, r.RequestID, d.attachmentId);
}

// ---------- advances and loans (decisions 102-104) ----------

// The loans of an employee still open: drafts, in approval, approved, or
// running with a balance; and the loan requests not yet settled.
async function openLoansOf(emp) {
  const P = require('./payrollLoans');
  const loans = (await LOANS().where('EmployeeID', '==', emp.EmployeeID).get()).docs.map(x => Object.assign({ LoanID: x.id }, x.data()));
  const recs = loans.some(l => l.Status === 'Active') ? await P.recoveriesOf(emp.CompanyID) : {};
  return loans.map(l => Object.assign(l, { Balance: l.Status === 'Active' ? P.balanceOf(l, recs[l.LoanID]) : l.Amount }))
    .filter(l => ['Draft', 'PendingApproval', 'Approved'].includes(l.Status) || (l.Status === 'Active' && l.Balance > 0));
}
// What the employee may ask for of a type: the most, the most instalments,
// and anything that stops them (decision 103).
async function limitsFor(emp, type, openLoans, openRequests) {
  const out = { MaxAmount: null, MaxText: '', MaxInstalments: type.Kind === 'Loan' ? (type.MaxInstalments || null) : 1, Blocked: '' };
  if (type.MaxMonths) {
    const pay = require('./hrPay');
    const v = pay.inForce(await pay.versions(emp.EmployeeID), today());
    const salary = v ? (type.MaxBasis === 'Gross' ? v.MonthlyEarnings : v.Basic) : 0;
    out.MaxAmount = round2((salary || 0) * type.MaxMonths);
    out.MaxText = 'Up to ' + type.MaxMonths + (type.MaxMonths === 1 ? ' month\'s ' : ' months\' ') + (type.MaxBasis === 'Gross' ? 'gross salary' : 'basic salary') + ': ' + money(out.MaxAmount);
    if (!salary) out.Blocked = 'Your salary is not set up yet: ask HR.';
  }
  if (type.AfterProbation && emp.ProbationEndDate && today() <= emp.ProbationEndDate) out.Blocked = type.Name + ' is available after probation (ends ' + emp.ProbationEndDate + ').';
  if (type.OneOpen) {
    const l = openLoans.find(x => x.LoanTypeID === type.LoanTypeID);
    const q = openRequests.find(x => x.LoanTypeID === type.LoanTypeID);
    if (l) out.Blocked = 'You already have a ' + type.Name + ' open (' + (l.LoanNumber || 'with HR') + ').';
    else if (q) out.Blocked = 'You already asked for a ' + type.Name + ' (' + q.Number + ').';
  }
  return out;
}
async function openLoanRequests(emp) {
  return docs(await REQUESTS().where('EmployeeID', '==', emp.EmployeeID).get()).filter(r => r.Type === 'Loan' && ['WithManager', 'WithHR'].includes(r.Status) && !r.LoanID);
}
async function loanForm(me) {
  const emp = me.emp;
  const types = (await require('./payrollLoans').loanTypes()).filter(t => t.Active !== false);
  const [loans, reqs] = await Promise.all([openLoansOf(emp), openLoanRequests(emp)]);
  const out = [];
  for (const t of types) out.push(Object.assign({ LoanTypeID: t.LoanTypeID, Name: t.Name, Kind: t.Kind }, await limitsFor(emp, t, loans, reqs)));
  return { types: out, startMonth: nextMonth(today().slice(0, 7)), running: loans.filter(l => l.Status === 'Active').map(l => ({ LoanNumber: l.LoanNumber, TypeName: l.TypeName, Balance: round2(l.Balance), Instalment: l.Instalment })) };
}

async function requestLoan(me, d, manager) {
  const emp = me.emp;
  const type = (await require('./payrollLoans').loanTypes()).find(t => t.LoanTypeID === text(d.loanTypeId, 80) && t.Active !== false);
  if (!type) bad('Choose the type.');
  const [loans, reqs] = await Promise.all([openLoansOf(emp), openLoanRequests(emp)]);
  const lim = await limitsFor(emp, type, loans, reqs);
  if (lim.Blocked) throw failed(lim.Blocked);
  const amount = round2(num(d.amount));
  if (!(amount > 0)) bad('Enter the amount.');
  if (lim.MaxAmount != null && amount > lim.MaxAmount) throw failed(lim.MaxText + '.');
  let instalment = amount, months = 1;
  if (type.Kind === 'Loan') {
    instalment = d.months ? round2(amount / Math.max(1, Math.round(num(d.months)))) : round2(num(d.instalment));
    if (!(instalment > 0 && instalment <= amount)) bad('Enter the monthly instalment, or the number of months.');
    months = Math.ceil(round2(amount / instalment));
    if (lim.MaxInstalments && months > lim.MaxInstalments) throw failed(type.Name + ' is repaid in at most ' + lim.MaxInstalments + ' instalments: ' + months + ' asked.');
  }
  const start = text(d.startMonth, 7) || nextMonth(today().slice(0, 7));
  if (!isMonth(start) || start < today().slice(0, 7)) bad('Recovery starts this month or later.');
  const reason = text(d.reason, 1000);
  if (!reason) bad('Give the reason.');
  const r = Object.assign(await base(me, 'Loan', LOAN_CATEGORY), {
    Number: await nextNumber('LR'), Status: manager ? 'WithManager' : 'WithHR', LoanTypeID: type.LoanTypeID, TypeName: type.Name, Kind: type.Kind,
    Amount: amount, Instalment: instalment, Months: months, StartMonth: start, Reason: reason, ManagerID: manager ? manager.EmployeeID : '', ManagerName: manager ? manager.FullName : '',
    LoanID: '', History: [entry('Requested', employeeName(me))]
  });
  const ref = await REQUESTS().add(r);
  return { success: true, requestId: ref.id, number: r.Number, status: r.Status };
}

// Pay → Loans: every loan or advance past its draft, with its recoveries.
async function myLoans(me) {
  const P = require('./payrollLoans');
  const loans = (await LOANS().where('EmployeeID', '==', me.emp.EmployeeID).get()).docs.map(x => Object.assign({ LoanID: x.id }, x.data())).filter(l => l.Status !== 'Draft');
  const recs = {};
  for (const co of [...new Set(loans.map(l => l.CompanyID))]) Object.assign(recs, await P.recoveriesOf(co));
  return loans.map(l => {
    const rec = recs[l.LoanID] || [];
    const balance = l.Status === 'Active' ? P.balanceOf(l, rec) : l.Amount;
    return { LoanNumber: l.LoanNumber || '', TypeName: l.TypeName, Kind: l.Kind, Amount: l.Amount, Instalment: l.Instalment, StartMonth: l.StartMonth, PayoutDate: l.PayoutDate || '',
      Status: l.Status === 'Active' ? (balance > 0 ? 'Running' : 'Repaid') : l.Status === 'PendingApproval' ? 'In approval' : l.Status, Balance: round2(balance),
      Recoveries: rec.map(x => ({ Month: x.Month, Amount: x.Amount })).sort((a, b) => a.Month.localeCompare(b.Month)),
      Repayments: (l.Repayments || []).map(x => ({ Date: x.Date, Amount: x.Amount })), Skips: (l.Skips || []).slice() };
  }).sort((a, b) => String(b.StartMonth).localeCompare(String(a.StartMonth)));
}

// The line manager's loan requests (decision 102).
async function teamLoanRequests(reportIds) {
  if (!reportIds.size) return [];
  const list = docs(await REQUESTS().where('Status', '==', 'WithManager').get()).filter(r => reportIds.has(r.EmployeeID));
  const out = [];
  for (const r of list.sort((a, b) => String(a.CreatedAt).localeCompare(String(b.CreatedAt)))) {
    const emp = Object.assign({ EmployeeID: r.EmployeeID }, (await EMPLOYEES().doc(r.EmployeeID).get()).data());
    const running = (await openLoansOf(emp)).filter(l => l.Status === 'Active').map(l => ({ LoanNumber: l.LoanNumber, TypeName: l.TypeName, Balance: round2(l.Balance) }));
    out.push({ RequestID: r.RequestID, Number: r.Number, EmployeeNo: r.EmployeeNo, EmployeeName: r.EmployeeName, TypeName: r.TypeName, Kind: r.Kind, Amount: r.Amount, Instalment: r.Instalment,
      Months: r.Months, StartMonth: r.StartMonth, Reason: r.Reason, CreatedAt: r.CreatedAt, Running: running });
  }
  return out;
}
async function decideLoanRequest(me, d) {
  const s = await REQUESTS().doc(text(d.id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Request not found.');
  const r = Object.assign({ RequestID: s.id }, s.data());
  const emp = (await EMPLOYEES().doc(r.EmployeeID).get()).data() || {};
  if (r.Type !== 'Loan' || emp.ManagerID !== me.emp.EmployeeID) throw new HttpsError('permission-denied', 'Only the employee\'s line manager decides this request.');
  if (r.Status !== 'WithManager') throw failed('This request is no longer waiting for you.');
  const now = new Date().toISOString();
  if (d.decision === 'Rejected') {
    const reason = text(d.reason, 500);
    if (!reason) bad('Give the reason for rejecting.');
    await REQUESTS().doc(r.RequestID).update({ Status: 'Rejected', RejectionReason: reason, RejectedAt: now, UpdatedAt: now, ManagerDecision: 'Rejected', ManagerDecidedAt: now,
      History: (r.History || []).concat([entry('Rejected by the line manager', me.emp.FullName, reason)]) });
    return { success: true, status: 'Rejected' };
  }
  if (d.decision !== 'Approved') bad('Approve or reject.');
  await REQUESTS().doc(r.RequestID).update({ Status: 'WithHR', UpdatedAt: now, LastAt: now, LastFrom: 'Employee', ManagerDecision: 'Approved', ManagerDecidedAt: now,
    History: (r.History || []).concat([entry('Approved by the line manager', me.emp.FullName)]) });
  return { success: true, status: 'WithHR' };
}

async function portalCounts(me) {
  const list = docs(await REQUESTS().where('EmployeeID', '==', me.emp.EmployeeID).get());
  return { unread: list.filter(unreadFor).length, open: list.filter(isOpen).length };
}

// ---------- the ERP's side (callable employeeRequests) ----------

const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Employee Requests.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'setup' ? 'You do not have permission to set up the handlers.' : 'You do not have permission to handle employee requests.');
}
async function loadForUser(user, id) {
  const s = await REQUESTS().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Request not found.');
  const r = Object.assign({ RequestID: s.id }, s.data());
  if (!userCanAccessCompany(user.profile, r.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return r;
}
// The first word from HR moves a new query to In progress.
const inProgress = r => (r.Type === 'Query' && r.Status === 'New' ? { Status: 'InProgress' } : {});

const ERP = {
  async list(user) {
    await requireCap(user);
    const list = docs(await REQUESTS().get()).filter(r => userCanAccessCompany(user.profile, r.CompanyID));
    const out = [];
    for (const r of list) { const st = await stageOf(r); out.push(Object.assign(summary(r, st), { Waiting: waiting(r, st.Loan) })); }
    return { requests: out.sort((a, b) => String(b.LastAt).localeCompare(String(a.LastAt))), categories: CATEGORIES, canHandle: await can(user, 'handle'), canSetup: await can(user, 'setup'), me: user.uid };
  },
  async get(user, d) {
    await requireCap(user);
    const r = await loadForUser(user, d.id);
    const st = await stageOf(r);
    const emp = (await EMPLOYEES().doc(r.EmployeeID).get()).data() || {};
    return {
      request: Object.assign(summary(r, st), {
        Description: r.Description || '', Lines: r.Lines || [], Expected: r.Expected == null ? null : r.Expected, RunID: r.RunID || '', Outcome: r.Outcome || '', RejectionReason: r.RejectionReason || '',
        TypeName: r.TypeName || '', Kind: r.Kind || '', Amount: r.Amount || 0, Instalment: r.Instalment || 0, Months: r.Months || 0, StartMonth: r.StartMonth || '', Reason: r.Reason || '',
        ManagerName: r.ManagerName || '', LoanID: st.Loan ? st.Loan.LoanID : '', LoanNumber: st.Loan ? st.Loan.LoanNumber || '' : '', LoanRejectedReason: st.Loan ? st.Loan.RejectedReason || '' : '',
        BackupName: r.BackupName || '', Messages: r.Messages || [], History: r.History || [], Waiting: waiting(r, st.Loan),
        Designation: emp.DesignationID || '', Mobile: emp.Mobile || ''
      }),
      handlers: await handlersFor(r.CompanyID), canHandle: await can(user, 'handle'), canDraftLoan: await moduleHasCapability('PAYROLLLOAN', 'draft', user.profile.role),
      isOpen: isOpen(r)
    };
  },
  // A reply the employee sees, or an internal note (decision 97).
  async reply(user, d) {
    await requireCap(user, 'handle');
    const r = await loadForUser(user, d.id);
    if (!isOpen(r)) throw failed('This request is closed.');
    const msg = text(d.text, 2000);
    if (!msg) bad('Write the message.');
    const internal = d.internal === true, now = new Date().toISOString();
    await REQUESTS().doc(r.RequestID).update(Object.assign({ Messages: (r.Messages || []).concat([{ From: 'HR', By: nameOf(user), ByUid: user.uid, At: now, Text: msg, Internal: internal }]), UpdatedAt: now },
      internal ? {} : { LastFrom: 'HR', LastAt: now }, inProgress(r)));
    return { success: true };
  },
  // Decision 101: anyone with "handle" can reassign.
  async assign(user, d) {
    await requireCap(user, 'handle');
    const r = await loadForUser(user, d.id);
    const to = (await handlersFor(r.CompanyID)).find(h => h.Uid === text(d.uid, 128));
    if (!to) bad('Choose someone who handles employee requests for ' + r.CompanyID + '.');
    await REQUESTS().doc(r.RequestID).update({ AssignedUid: to.Uid, AssignedName: to.Name, BackupUid: '', BackupName: '', UpdatedAt: new Date().toISOString(),
      History: (r.History || []).concat([entry('Assigned to ' + to.Name, nameOf(user))]) });
    return { success: true };
  },
  async resolve(user, d) {
    await requireCap(user, 'handle');
    const r = await loadForUser(user, d.id);
    if (r.Type !== 'Query' || !isOpen(r)) throw failed('Only an open query is resolved.');
    const outcome = text(d.text, 2000);
    if (!outcome) bad('Say what was done (the employee sees it).');
    const now = new Date().toISOString();
    await REQUESTS().doc(r.RequestID).update({ Status: 'Resolved', Outcome: outcome, ResolvedAt: now, RejectedAt: '', UpdatedAt: now, LastFrom: 'HR', LastAt: now,
      Messages: (r.Messages || []).concat([{ From: 'HR', By: nameOf(user), ByUid: user.uid, At: now, Text: outcome, Internal: false }]), History: (r.History || []).concat([entry('Resolved', nameOf(user))]) });
    return { success: true };
  },
  async reject(user, d) {
    await requireCap(user, 'handle');
    const r = await loadForUser(user, d.id);
    if (!isOpen(r)) throw failed('This request is closed.');
    const reason = text(d.text, 1000);
    if (!reason) bad('Give the reason (the employee sees it).');
    const st = await stageOf(r);
    if (st.Loan && st.Loan.Status !== 'Draft') throw failed('Its loan ' + (st.Loan.LoanNumber || '') + ' is already with the approvers: reject it there.');
    if (st.Loan) await LOANS().doc(st.Loan.LoanID).delete();
    const now = new Date().toISOString();
    await REQUESTS().doc(r.RequestID).update({ Status: 'Rejected', RejectionReason: reason, RejectedAt: now, ResolvedAt: '', LoanID: '', UpdatedAt: now, LastFrom: 'HR', LastAt: now,
      Messages: (r.Messages || []).concat([{ From: 'HR', By: nameOf(user), ByUid: user.uid, At: now, Text: reason, Internal: false }]), History: (r.History || []).concat([entry('Rejected', nameOf(user), reason)]) });
    return { success: true };
  },
  // Decision 102: HR reviews the request as a Loans & Advances draft and
  // submits it there as today.
  async draftLoan(user, d) {
    await requireCap(user, 'handle');
    if (!(await moduleHasCapability('PAYROLLLOAN', 'draft', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to enter loans.');
    const r = await loadForUser(user, d.id);
    if (r.Type !== 'Loan' || r.Status !== 'WithHR') throw failed('Only a loan request with HR is drafted.');
    const st = await stageOf(r);
    if (st.Loan) return { success: true, loanId: st.Loan.LoanID };
    const now = new Date().toISOString();
    const ref = await LOANS().add({ EmployeeID: r.EmployeeID, EmployeeNo: r.EmployeeNo, EmployeeName: r.EmployeeName, CompanyID: r.CompanyID, LoanTypeID: r.LoanTypeID, TypeName: r.TypeName,
      Kind: r.Kind, Amount: r.Amount, Instalment: r.Instalment, StartMonth: r.StartMonth, Note: 'Requested in the Employee Portal, ' + r.Number + ': ' + text(r.Reason, 250),
      Description: r.TypeName + ' — ' + r.EmployeeName, RequestID: r.RequestID, RequestNumber: r.Number, Status: 'Draft', LoanNumber: '', Skips: [], Changes: [], Repayments: [],
      CreatedAt: now, CreatedBy: user.profile.username || user.uid, UpdatedAt: now, UpdatedBy: user.profile.username || user.uid, History: [] });
    await REQUESTS().doc(r.RequestID).update({ LoanID: ref.id, UpdatedAt: now, History: (r.History || []).concat([entry('Drafted in Loans & Advances', nameOf(user))]) });
    return { success: true, loanId: ref.id };
  },
  async handlers(user) {
    await requireCap(user);
    const rows = (await HANDLERS().get()).docs.map(x => Object.assign({ HandlerKey: x.id }, x.data())).filter(h => userCanAccessCompany(user.profile, h.CompanyID));
    const companies = Object.entries((await rtdb.ref('companies').get()).val() || {}).filter(([id, c]) => c && c.Status !== 'Inactive' && userCanAccessCompany(user.profile, id)).map(([id, c]) => id);
    const people = {};
    for (const co of companies) people[co] = await handlersFor(co);
    return { handlers: rows.sort((a, b) => (a.CompanyID + a.Category).localeCompare(b.CompanyID + b.Category)), people, categories: [ALL].concat(CATEGORIES), canSetup: await can(user, 'setup') };
  },
  async saveHandler(user, d) {
    await requireCap(user, 'setup');
    const co = text(d.companyId, 80), cat = text(d.category, 40);
    if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (![ALL].concat(CATEGORIES).includes(cat)) bad('Choose the category.');
    const people = await handlersFor(co);
    const h = people.find(x => x.Uid === text(d.handlerUid, 128));
    if (!h) bad('Choose the handler: an ERP user with "handle" in Employee Requests for that company.');
    const b = text(d.backupUid, 128) ? people.find(x => x.Uid === text(d.backupUid, 128)) : null;
    if (text(d.backupUid, 128) && !b) bad('The backup must also handle employee requests for that company.');
    if (b && b.Uid === h.Uid) bad('The backup is someone else.');
    await HANDLERS().doc(handlerKey(co, cat)).set({ CompanyID: co, Category: cat, HandlerUid: h.Uid, HandlerName: h.Name, BackupUid: b ? b.Uid : '', BackupName: b ? b.Name : '',
      UpdatedAt: new Date().toISOString(), UpdatedBy: nameOf(user) });
    return { success: true };
  },
  async deleteHandler(user, d) {
    await requireCap(user, 'setup');
    const s = await HANDLERS().doc(text(d.key, 120) || '-').get();
    if (!s.exists) throw new HttpsError('not-found', 'Not found.');
    if (!userCanAccessCompany(user.profile, s.data().CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await s.ref.delete();
    return { success: true };
  },
  // Home (decision 101): the assigned handler and backup, or, when none is
  // set, everyone who handles the company.
  async tasks(user) {
    if (!(await can(user, 'access')) || !(await can(user, 'handle'))) return { items: [] };
    const list = docs(await REQUESTS().get()).filter(r => isOpen(r) && userCanAccessCompany(user.profile, r.CompanyID)
      && (r.AssignedUid ? (r.AssignedUid === user.uid || r.BackupUid === user.uid) : true));
    const items = [];
    for (const r of list) {
      const st = await stageOf(r);
      if (!waiting(r, st.Loan)) continue;
      items.push({ ModuleID: MODULE_ID, DocumentID: r.RequestID, Number: r.Number, Type: r.Type, Category: r.Category, EmployeeName: r.EmployeeName, StatusText: st.StatusText,
        What: r.Type === 'Query' ? (r.Status === 'New' ? 'New query' : 'Employee replied') : 'Loan request to review', Since: r.LastAt || r.CreatedAt });
    }
    return { items: items.sort((a, b) => String(a.Since).localeCompare(String(b.Since))) };
  }
};

exports.employeeRequests = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const a = ERP[d.action];
  if (!a) bad('Unknown request.');
  return a(user, d);
});

Object.assign(module.exports, {
  raiseQuery, myRequests, requestDetail, employeeReply, withdraw, reopen, uploadFile, openFile,
  loanForm, requestLoan, myLoans, teamLoanRequests, decideLoanRequest, portalCounts,
  QUERY_CATEGORIES, LOAN_CATEGORY, MODULE_ID
});
