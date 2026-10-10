// Employee Self-Service Portal, step 1 (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md, decisions 88-95): every employee signs
// in with their Employee Code; ERP users linked to an employee record
// (UserUID) use their ERP sign-in (decision 89). Leave: apply, track,
// cancel, balances; the line manager's Team requests (decision 90);
// payslips.
//
// Two callables, each with an action, so the portal adds two functions to
// deploy rather than fifteen:
//   essPortal          the portal's own calls (the signed-in employee);
//   manageEssAccounts  HR in Employees (the EMPLOYEES "portal" right).
//
// A portal account is a Firebase Auth user with a hidden email made from
// the Employee Code and NO ERP profile, so every ERP function refuses it.
// Records: essAccounts/{employeeId} and essUids/{uid} -> employee.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { admin, rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const { loadSetup } = require('./hrSetup');
const { leaveTypes } = require('./hrLeaveSetup');
const lv = require('./hrLeave');

const onCallOptions = { region: 'us-central1' };
const ACCOUNTS = () => firestore.collection('essAccounts');
const UIDS = () => firestore.collection('essUids');
const EMPLOYEES = () => firestore.collection('employees');
const LEAVES = () => firestore.collection('leaveRequests');
const RUNS = () => firestore.collection('payrollRuns');

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const today = () => todayIn('Asia/Dubai');
const round2 = n => Math.round(n * 100) / 100;
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const docs = snap => snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
const empOf = snap => Object.assign({ EmployeeID: snap.id }, snap.data());

// ---------- the account ----------

// The hidden sign-in email of an Employee Code; the portal page makes the
// same from what is typed (public/ess.html, essEmail).
function essEmail(code) {
  const local = String(code || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/^[._]+/, '');
  return local ? local + '@ess.invalid' : '';
}
// Decision 92: the first 4 letters of the name, in lowercase (spaces and
// punctuation skipped, accents removed), plus the last 4 digits of the
// Employee Code. Ali Hassan, EMP-0007 -> alih0007.
function defaultPassword(emp) {
  const letters = String(emp.FullName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
  return letters + String(emp.EmployeeNo || '').replace(/\D/g, '').slice(-4);
}
// The new password (decision: at least 8 characters, not the default, not
// containing the Employee Code).
function checkNewPassword(emp, pw) {
  if (typeof pw !== 'string' || pw.length < 8) bad('The new password needs at least 8 characters.');
  if (pw.length > 100) bad('The new password is at most 100 characters.');
  if (pw === defaultPassword(emp)) bad('Choose a password other than the one you were given.');
  const low = pw.toLowerCase(), code = String(emp.EmployeeNo || '').toLowerCase();
  if (code && (low.includes(code) || low.includes(code.replace(/[^a-z0-9]/g, '')))) bad('The password can\'t contain your Employee Code.');
}

// Who is asking: a portal account (enabled; the employee not Left), or an
// ERP user linked to an employee (decision 89). A portal account still on
// its default password may only change it.
async function whoIsAsking(request, allowMustChange) {
  if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Please sign in again.');
  const uid = request.auth.uid;
  const link = (await UIDS().doc(uid).get()).data();
  let emp, account = null, via;
  if (link) {
    account = (await ACCOUNTS().doc(link.EmployeeID).get()).data();
    if (!account || account.Uid !== uid || !account.Enabled) throw new HttpsError('permission-denied', 'Your portal access is switched off: ask HR.');
    const s = await EMPLOYEES().doc(link.EmployeeID).get();
    if (!s.exists) throw new HttpsError('permission-denied', 'Your employee record was not found: ask HR.');
    emp = empOf(s);
    via = 'portal';
  } else {
    const profile = (await rtdb.ref('users/' + uid).get()).val();
    if (!profile || profile.status !== 'Active') throw new HttpsError('permission-denied', 'This account has no portal access.');
    const mine = (await EMPLOYEES().where('UserUID', '==', uid).get()).docs.map(empOf).filter(e => e.Status !== 'Left');
    if (!mine.length) throw new HttpsError('permission-denied', 'Your ERP user is not linked to an employee record: ask HR to link it (Employees → ERP user).');
    emp = mine[0];
    via = 'erp';
  }
  if (emp.Status === 'Left') throw new HttpsError('permission-denied', 'Your portal access ended when you left.');
  const mustChange = Boolean(account && account.MustChange);
  if (mustChange && !allowMustChange) throw failed('Change your password first.');
  // The actor for history entries: { uid, profile: { username, fullName } }.
  const actor = { uid, profile: { username: emp.EmployeeNo, fullName: emp.FullName } };
  return { uid, emp, via, account, mustChange, actor };
}

// ---------- leave ----------

const STATUS_TEXT = { Draft: 'Draft', PendingManager: 'With manager', PendingApproval: 'With HR', Approved: 'Approved', Rejected: 'Rejected', Cancelled: 'Cancelled', Withdrawn: 'Withdrawn' };
function leaveRow(l) {
  return {
    LeaveID: l.LeaveID || l._id, LeaveNumber: l.LeaveNumber || '', LeaveTypeName: l.LeaveTypeName, Kind: l.Kind, FromDate: l.FromDate, ToDate: l.EffectiveTo || l.ToDate,
    HalfStart: Boolean(l.HalfStart), HalfEnd: Boolean(l.HalfEnd), Days: l.Days, UnpaidDays: l.UnpaidDays || 0, Reason: l.Reason || '', Status: l.Status, StatusText: STATUS_TEXT[l.Status] || l.Status,
    RejectionReason: l.RejectionReason || '', CancelReason: l.CancelReason || '', ManagerName: l.ManagerName || '', Summary: l.Summary || [],
    History: (l.History || []).map(h => ({ Event: h.Event, By: h.By, At: h.At, Note: h.Note || '' })), AppliedAt: l.CreatedAt || '', UpdatedAt: l.UpdatedAt || l.CreatedAt || ''
  };
}
// What the employee may do with their own leave: withdraw a request not
// yet approved; cancel approved leave that hasn't started.
function canCancel(l) {
  if (l.Status === 'PendingManager' || l.Status === 'PendingApproval') return true;
  return l.Status === 'Approved' && l.Kind === 'Leave' && l.FromDate > today() && !l.ReturnDate;
}
// The leave types an employee applies for: those in use, of kind Leave,
// for their gender.
async function typesFor(emp) {
  return (await leaveTypes()).filter(t => t.Active !== false && t.Kind === 'Leave' && (t.Gender === 'Any' || !t.Gender || t.Gender === emp.Gender))
    .map(t => ({ LeaveTypeID: t.LeaveTypeID, Code: t.Code, Name: t.Name, HalfDays: Boolean(t.HalfDays), UsesBalance: Boolean(t.UsesBalance), Counts: t.Counts,
      DocumentAfterDays: t.DocumentAfterDays == null ? null : t.DocumentAfterDays, MaxPerInstance: t.MaxPerInstance == null ? null : t.MaxPerInstance }));
}
async function lineManager(emp) {
  if (!emp.ManagerID) return null;
  const s = await EMPLOYEES().doc(emp.ManagerID).get();
  if (!s.exists) return null;
  const m = empOf(s);
  return m.Status === 'Left' ? null : m;
}
// The balances: entitlement so far (opening + accrued + adjustments), taken,
// booked (approved, not yet taken), pending (not yet approved), available.
async function balances(emp) {
  const { balances: list, leaves } = await lv.balancesFor(emp, today());
  const pendingOf = code => round2(leaves.filter(l => l.Status === 'PendingManager' || l.Status === 'PendingApproval')
    .reduce((s, l) => s + (l.Lines || []).filter(x => lv.live(x) && x.Code === code).reduce((a, x) => a + x.Fraction, 0), 0));
  return list.map(b => {
    if (!b.UsesBalance) return { Code: b.Code, Name: b.Name, UsesBalance: false, UsedThisYear: b.UsedThisYear, MaxPerYear: b.MaxPerYear == null ? null : b.MaxPerYear };
    const pending = pendingOf(b.Code);
    return { Code: b.Code, Name: b.Name, UsesBalance: true, Entitlement: round2(b.Opening + b.Accrued + b.Adjustments), Opening: b.Opening, OpeningAsOf: b.OpeningAsOf,
      Accrued: b.Accrued, Adjustments: b.Adjustments, Taken: b.Taken, Booked: round2(b.Booked - pending), Pending: pending, Available: b.Available };
  });
}
async function myLeaves(emp) {
  return (await lv.leavesOf(emp.EmployeeID)).filter(l => l.Status !== 'Draft')
    .sort((a, b) => String(b.FromDate).localeCompare(String(a.FromDate)) || String(b.CreatedAt).localeCompare(String(a.CreatedAt)))
    .map(l => Object.assign(leaveRow(l), { CanCancel: canCancel(l) }));
}
async function loadOwnLeave(me, id) {
  const s = await LEAVES().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Leave not found.');
  const l = Object.assign({ LeaveID: s.id }, s.data());
  if (l.EmployeeID !== me.emp.EmployeeID) throw new HttpsError('permission-denied', 'That is not your leave.');
  return l;
}

async function applyLeave(me, d) {
  const emp = me.emp;
  const type = (await typesFor(emp)).find(t => t.LeaveTypeID === text(d.LeaveTypeID, 80));
  if (!type) bad('Choose the leave type.');
  const v = await lv.evaluate({ LeaveTypeID: type.LeaveTypeID, FromDate: d.FromDate, ToDate: d.ToDate, HalfStart: d.HalfStart === true, HalfEnd: d.HalfEnd === true, Reason: d.Reason }, emp, null);
  const mgr = await lineManager(emp);
  const now = new Date().toISOString();
  const base = Object.assign(v, {
    EmployeeID: emp.EmployeeID, EmployeeNo: emp.EmployeeNo, EmployeeName: emp.FullName, CompanyID: emp.CompanyID, Description: v.LeaveTypeName + ' — ' + emp.FullName,
    Source: 'Portal', AppliedByUid: me.uid, CreatedAt: now, CreatedBy: lv.actorOf(me.actor), UpdatedAt: now, UpdatedBy: lv.actorOf(me.actor)
  });
  if (mgr) {
    // Decision 90: the line manager first, in the portal's Team requests.
    const number = await lv.nextNumber(v.FromDate);
    const ref = await LEAVES().add(Object.assign(base, { Status: 'PendingManager', LeaveNumber: number, ManagerID: mgr.EmployeeID, ManagerName: mgr.FullName, SubmittedAt: now,
      SubmittedBy: lv.actorOf(me.actor), History: [lv.histEntry('Applied in the portal', me.actor)] }));
    return { success: true, leaveId: ref.id, leaveNumber: number, status: 'PendingManager', warnings: v.Warnings };
  }
  // No line manager: submitted at once (Approval Configuration, else
  // approved). A leave expecting a document nobody would then see is
  // refused here: HR enters it in the Leave Register.
  if (v.DocumentNeeded && !(await lv.approvalNeeded(v, emp))) {
    throw failed(v.LeaveTypeName + ' over ' + v.DocumentAfterDays + (v.DocumentAfterDays === 1 ? ' day' : ' days') + ' needs a supporting document (e.g. a medical certificate): hand it to HR, who enter this leave for you.');
  }
  const ref = await LEAVES().add(Object.assign(base, { Status: 'Draft', LeaveNumber: '', History: [lv.histEntry('Applied in the portal', me.actor)] }));
  try {
    const r = await lv.submitCore(Object.assign({ LeaveID: ref.id }, (await ref.get()).data()), emp, me.actor, { createdBy: me.uid });
    return { success: true, leaveId: ref.id, leaveNumber: r.leaveNumber, status: r.status, warnings: v.Warnings };
  } catch (err) {
    await ref.delete();
    throw err;
  }
}

async function cancelLeave(me, d) {
  const l = await loadOwnLeave(me, d.leaveId);
  const reason = text(d.reason, 500);
  if (l.Status === 'PendingManager' || l.Status === 'PendingApproval') {
    const now = new Date().toISOString();
    if (l.Status === 'PendingApproval' && l.ApprovalInstanceID) await rtdb.ref('approvalInstances/' + l.ApprovalInstanceID).update({ Status: 'Withdrawn', UpdatedAt: now });
    await LEAVES().doc(l.LeaveID).update({ Status: 'Withdrawn', CancelReason: reason, WithdrawnAt: now, UpdatedAt: now, UpdatedBy: lv.actorOf(me.actor),
      History: (l.History || []).concat([lv.histEntry('Withdrawn by the employee', me.actor, reason)]) });
    return { success: true, status: 'Withdrawn' };
  }
  if (l.Status === 'Approved' && l.Kind !== 'Leave') throw failed('Ask HR to change this.');
  await lv.cancelCore(l, me.actor, reason);
  return { success: true, status: 'Cancelled' };
}

// ---------- the line manager (decision 90) ----------

async function reportsOf(emp) {
  return (await EMPLOYEES().where('ManagerID', '==', emp.EmployeeID).get()).docs.map(empOf);
}
// Requests waiting for this manager: their direct reports' leave with the
// manager, whoever was the manager when it was applied (Replace manager
// moves them), and what they decided lately.
async function team(me) {
  const reports = await reportsOf(me.emp);
  const ids = new Set(reports.map(e => e.EmployeeID));
  if (!ids.size) return { isManager: false, pending: [], decided: [] };
  const pending = docs(await LEAVES().where('Status', '==', 'PendingManager').get()).filter(l => ids.has(l.EmployeeID)).map(l => Object.assign(l, { LeaveID: l._id }));
  const out = [];
  for (const l of pending.sort((a, b) => String(a.FromDate).localeCompare(String(b.FromDate)))) {
    const emp = reports.find(e => e.EmployeeID === l.EmployeeID);
    const type = (await leaveTypes()).find(t => t.LeaveTypeID === l.LeaveTypeID);
    let bal = null;
    if (type && type.UsesBalance) { const b = await lv.balanceOf(emp, type, l.FromDate, l.LeaveID); bal = { Before: b.Available, After: round2(b.Available - (l.TypeDays || 0)) }; }
    const noDoc = Boolean(l.DocumentNeeded) && !(await firestore.collection('attachments').where('DocKey', '==', 'LEAVE:' + l.LeaveID).get()).docs.some(x => !x.data().Removed);
    const configured = await lv.approvalNeeded(l, emp);
    out.push(Object.assign(leaveRow(l), { EmployeeNo: l.EmployeeNo, EmployeeName: l.EmployeeName, Balance: bal, Warnings: l.Warnings || [],
      NoDocument: noDoc, NextStep: configured ? 'Then to HR\'s approval' : 'Approved when you approve' }));
  }
  const decided = docs(await LEAVES().where('ManagerDecidedBy', '==', me.emp.EmployeeID).get())
    .sort((a, b) => String(b.ManagerDecidedAt).localeCompare(String(a.ManagerDecidedAt))).slice(0, 20)
    .map(l => Object.assign(leaveRow(Object.assign(l, { LeaveID: l._id })), { EmployeeNo: l.EmployeeNo, EmployeeName: l.EmployeeName, ManagerDecision: l.ManagerDecision, ManagerDecidedAt: l.ManagerDecidedAt }));
  return { isManager: true, pending: out, decided };
}

async function decideLeave(me, d) {
  const s = await LEAVES().doc(text(d.leaveId, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Leave not found.');
  const l = Object.assign({ LeaveID: s.id }, s.data());
  const es = await EMPLOYEES().doc(l.EmployeeID).get();
  const emp = es.exists ? empOf(es) : null;
  if (!emp || emp.ManagerID !== me.emp.EmployeeID) throw new HttpsError('permission-denied', 'Only the employee\'s line manager decides this request.');
  if (l.Status !== 'PendingManager') throw failed('This request is no longer waiting for you (' + (STATUS_TEXT[l.Status] || l.Status).toLowerCase() + ').');
  const now = new Date().toISOString();
  const mark = { ManagerDecidedBy: me.emp.EmployeeID, ManagerDecidedByName: me.emp.FullName, ManagerDecidedAt: now };
  if (d.decision === 'Rejected') {
    const reason = text(d.reason, 500);
    if (!reason) bad('Give the reason for rejecting.');
    await LEAVES().doc(l.LeaveID).update(Object.assign({ Status: 'Rejected', RejectionReason: reason, ManagerDecision: 'Rejected', UpdatedAt: now, UpdatedBy: lv.actorOf(me.actor),
      History: (l.History || []).concat([lv.histEntry('Rejected by the line manager', me.actor, reason)]) }, mark));
    return { success: true, status: 'Rejected' };
  }
  if (d.decision !== 'Approved') bad('Approve or reject.');
  // Then exactly as Submit: Approval Configuration if set up, else approved
  // (the manager then decides on a missing document, decision 44).
  const r = await lv.submitCore(l, emp, me.actor, { createdBy: l.AppliedByUid || me.uid, acceptWithoutDocument: d.acceptWithoutDocument === true,
    before: [lv.histEntry('Approved by the line manager', me.actor)] });
  await LEAVES().doc(l.LeaveID).update(Object.assign({ ManagerDecision: 'Approved' }, mark));
  return r;
}

// ---------- payslips ----------

// Paid: the whole run, or a payment (not reversed) that covered the employee.
const paidFor = (run, id) => Boolean(run.PaidAt) || (run.Payments || []).some(p => !p.ReversedAt && (!p.EmployeeIDs || p.EmployeeIDs.includes(id)));
// The posted monthly runs with a slip for the employee, the latest first.
async function payslipList(emp) {
  const runs = docs(await RUNS().where('Status', '==', 'Posted').get());
  const out = [];
  for (const r of runs) {
    const s = await RUNS().doc(r._id).collection('slips').doc(emp.EmployeeID).get();
    if (!s.exists) continue;
    const x = s.data();
    out.push({ RunID: r._id, Month: r.Month, CompanyID: r.CompanyID, Earnings: x.Earnings, Deductions: x.Deductions, Net: x.Net, Paid: paidFor(r, emp.EmployeeID) });
  }
  return out.sort((a, b) => b.Month.localeCompare(a.Month));
}
async function payslip(me, d) {
  const s = await RUNS().doc(text(d.runId, 120) || '-').get();
  if (!s.exists || s.data().Status !== 'Posted') throw new HttpsError('not-found', 'Payslip not found.');
  const run = Object.assign({ RunID: s.id }, s.data());
  const out = await require('./payrollPost').payslipsOf(run, me.emp.EmployeeID);
  if (!out.slips.length) throw new HttpsError('not-found', 'Payslip not found.');
  const slip = out.slips[0];
  return { company: out.company, month: out.month, monthEnd: out.monthEnd, runNumber: out.runNumber, slip: Object.assign(slip, { PaidStatus: paidFor(run, me.emp.EmployeeID) }) };
}

// ---------- the portal's callable ----------

async function profileOf(me) {
  const emp = me.emp;
  const [setup, co, mgr] = await Promise.all([loadSetup(), rtdb.ref('companies/' + emp.CompanyID).get(), lineManager(emp)]);
  const des = setup.designations.find(x => x.DesignationID === emp.DesignationID);
  const reports = await reportsOf(emp);
  return {
    EmployeeID: emp.EmployeeID, EmployeeNo: emp.EmployeeNo, FullName: emp.FullName, FirstName: String(emp.FullName || '').split(/\s+/)[0], Designation: des ? des.Title : '',
    Company: (co.val() || {}).LegalName || emp.CompanyID, JoinDate: emp.JoinDate || '', Mobile: emp.Mobile || '', WorkEmail: emp.WorkEmail || '',
    ManagerName: mgr ? mgr.FullName : '', IsManager: reports.some(e => e.Status !== 'Left'), Via: me.via, MustChange: me.mustChange
  };
}

const ACTIONS = {
  // Who is signed in; also records the portal sign-in.
  me: { mustChange: true, run: async (me) => {
    if (me.via === 'portal') await ACCOUNTS().doc(me.emp.EmployeeID).update({ LastSignIn: new Date().toISOString() });
    return { me: await profileOf(me), today: today() };
  } },
  changePassword: { mustChange: true, run: async (me, d) => {
    if (me.via !== 'portal') throw failed('You sign in with your ERP user: change its password in the ERP.');
    checkNewPassword(me.emp, d.newPassword);
    await admin.auth().updateUser(me.uid, { password: d.newPassword });
    await ACCOUNTS().doc(me.emp.EmployeeID).update({ MustChange: false, PasswordChangedAt: new Date().toISOString() });
    return { success: true };
  } },
  home: { run: async (me) => {
    const [bal, leaves, slips, t] = await Promise.all([balances(me.emp), myLeaves(me.emp), payslipList(me.emp), team(me)]);
    return { balances: bal, open: leaves.filter(l => ['PendingManager', 'PendingApproval'].includes(l.Status) || (l.Status === 'Approved' && l.ToDate >= today())).slice(0, 5),
      lastPayslip: slips[0] || null, teamPending: t.pending.length, today: today() };
  } },
  leaveForm: { run: async (me) => ({ types: await typesFor(me.emp), manager: ((await lineManager(me.emp)) || {}).FullName || '', today: today() }) },
  previewLeave: { run: async (me, d) => {
    const type = (await typesFor(me.emp)).find(t => t.LeaveTypeID === text((d.leave || {}).LeaveTypeID, 80));
    if (!type) bad('Choose the leave type.');
    const l = d.leave || {};
    const v = await lv.evaluate({ LeaveTypeID: type.LeaveTypeID, FromDate: l.FromDate, ToDate: l.ToDate, HalfStart: l.HalfStart === true, HalfEnd: l.HalfEnd === true }, me.emp, null);
    return { preview: { Days: v.Days, TypeDays: v.TypeDays, UnpaidDays: v.UnpaidDays, Balance: v.Balance, Warnings: v.Warnings, Summary: v.Summary, DocumentNeeded: v.DocumentNeeded, ExpectedReturn: v.ExpectedReturn } };
  } },
  applyLeave: { run: (me, d) => applyLeave(me, d.leave || {}) },
  leaves: { run: async (me) => ({ leaves: await myLeaves(me.emp), today: today() }) },
  cancelLeave: { run: cancelLeave },
  balances: { run: async (me) => ({ balances: await balances(me.emp), today: today() }) },
  team: { run: team },
  decideLeave: { run: decideLeave },
  payslips: { run: async (me) => ({ payslips: await payslipList(me.emp) }) },
  payslip: { run: payslip }
};

exports.essPortal = onCallWithMessages(onCallOptions, async (request) => {
  const d = request.data || {};
  // The ERP shell asks whether to show My Portal: never an error.
  if (d.action === 'link') {
    try { const me = await whoIsAsking(request, true); return { linked: true, name: me.emp.FullName }; } catch (e) { return { linked: false }; }
  }
  const a = ACTIONS[d.action];
  if (!a) bad('Unknown request.');
  const me = await whoIsAsking(request, Boolean(a.mustChange));
  return a.run(me, d);
});

// ---------- HR: the accounts (decision 95) ----------

async function requirePortalRight(user) {
  if (!(await moduleHasCapability('EMPLOYEES', 'access', user.profile.role)) || !(await moduleHasCapability('EMPLOYEES', 'portal', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have permission to manage portal access.');
  }
}
async function loadEmployees(user, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(x => text(x, 80)).filter(Boolean))];
  if (!list.length) bad('Choose the employees.');
  if (list.length > 500) bad('At most 500 employees at a time.');
  const out = [];
  for (const id of list) {
    const s = await EMPLOYEES().doc(id).get();
    if (!s.exists) throw new HttpsError('not-found', 'Employee not found.');
    const e = empOf(s);
    if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    out.push(e);
  }
  return out;
}
const accountView = (a) => (a ? { Enabled: Boolean(a.Enabled), MustChange: Boolean(a.MustChange), EnabledAt: a.EnabledAt || '', EnabledByName: a.EnabledByName || '',
  LastSignIn: a.LastSignIn || '', PasswordChangedAt: a.PasswordChangedAt || '', ResetAt: a.ResetAt || '', Email: a.Email || '' } : null);

// Turns the portal on for one employee: creates the account with the
// default password, or switches an existing one back on (its password
// unchanged). Returns the welcome slip's details, or why not.
async function enableOne(user, e) {
  const who = e.EmployeeNo + ' ' + e.FullName;
  if (e.Status === 'Left') return { EmployeeID: e.EmployeeID, error: who + ' has left.' };
  const email = essEmail(e.EmployeeNo);
  if (!email) return { EmployeeID: e.EmployeeID, error: who + ' has no Employee Code.' };
  const pw = defaultPassword(e);
  const now = new Date().toISOString(), by = user.profile.fullName || user.profile.username || user.uid;
  const ref = ACCOUNTS().doc(e.EmployeeID);
  const a = (await ref.get()).data();
  if (a && a.Uid) {
    await admin.auth().updateUser(a.Uid, { disabled: false, email, displayName: e.FullName });
    await ref.update({ Enabled: true, Email: email, EnabledAt: now, EnabledBy: user.uid, EnabledByName: by });
    const after = (await ref.get()).data();
    return { EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID, Created: false, MustChange: Boolean(after.MustChange), DefaultPassword: after.MustChange ? pw : '' };
  }
  if (pw.length < 6) return { EmployeeID: e.EmployeeID, error: who + ': the default password (the name\'s first 4 letters and the code\'s last 4 digits) would be under 6 characters. Check the name is in English letters and the code has digits.' };
  try {
    const clash = await admin.auth().getUserByEmail(email);
    if (clash) return { EmployeeID: e.EmployeeID, error: who + ': the code ' + e.EmployeeNo + ' signs in as another employee\'s account: make the codes distinct.' };
  } catch (err) { if (err.code !== 'auth/user-not-found') throw err; }
  const u = await admin.auth().createUser({ email, password: pw, displayName: e.FullName });
  await UIDS().doc(u.uid).set({ EmployeeID: e.EmployeeID });
  await ref.set({ Uid: u.uid, Email: email, Enabled: true, MustChange: true, EnabledAt: now, EnabledBy: user.uid, EnabledByName: by, CreatedAt: now });
  return { EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID, Created: true, MustChange: true, DefaultPassword: pw };
}

exports.manageEssAccounts = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  if (d.action === 'list') {
    // Employees: the access column and the record's Portal access section.
    if (!(await moduleHasCapability('EMPLOYEES', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Employees.');
    const canManage = await moduleHasCapability('EMPLOYEES', 'portal', user.profile.role);
    const accounts = {};
    (await ACCOUNTS().get()).docs.forEach(x => { accounts[x.id] = accountView(x.data()); });
    return { canManage, accounts };
  }
  await requirePortalRight(user);
  const emps = await loadEmployees(user, d.employeeIds || (d.employeeId ? [d.employeeId] : []));
  if (d.action === 'enable') {
    const results = [];
    for (const e of emps) results.push(await enableOne(user, e));
    return { success: true, results };
  }
  if (d.action === 'slips') {
    // Welcome slips again: only for accounts still on the default password.
    const results = [];
    for (const e of emps) {
      const a = (await ACCOUNTS().doc(e.EmployeeID).get()).data();
      if (a && a.Enabled && a.MustChange) results.push({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID, DefaultPassword: defaultPassword(e) });
    }
    return { success: true, results };
  }
  const now = new Date().toISOString();
  const results = [];
  for (const e of emps) {
    const ref = ACCOUNTS().doc(e.EmployeeID);
    const a = (await ref.get()).data();
    if (!a || !a.Uid) { results.push({ EmployeeID: e.EmployeeID, error: e.EmployeeNo + ' ' + e.FullName + ' has no portal account.' }); continue; }
    if (d.action === 'disable') {
      await admin.auth().updateUser(a.Uid, { disabled: true });
      await admin.auth().revokeRefreshTokens(a.Uid);
      await ref.update({ Enabled: false, DisabledAt: now, DisabledBy: user.uid });
      results.push({ EmployeeID: e.EmployeeID });
    } else if (d.action === 'reset') {
      // Forgot password: back to the default, changed again at the next sign-in.
      const pw = defaultPassword(e);
      if (pw.length < 6) { results.push({ EmployeeID: e.EmployeeID, error: e.EmployeeNo + ': the default password would be under 6 characters.' }); continue; }
      const email = essEmail(e.EmployeeNo);
      await admin.auth().updateUser(a.Uid, { password: pw, email });
      await admin.auth().revokeRefreshTokens(a.Uid);
      await ref.update({ MustChange: true, Email: email, ResetAt: now, ResetBy: user.uid });
      results.push({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID, MustChange: true, DefaultPassword: pw, Enabled: Boolean(a.Enabled) });
    } else bad('Unknown request.');
  }
  return { success: true, results };
});

module.exports.essEmail = essEmail;
module.exports.defaultPassword = defaultPassword;
module.exports.checkNewPassword = checkNewPassword;
