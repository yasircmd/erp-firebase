// HR: Attendance and Leave Register, step 3: the month close and the year
// close (owner, 2026-10-04; docs/modules/HR_LEAVE.md, decisions 9-13).
//   - A month is locked per company, after it ends, in order (decision 12),
//     and not while leave dated up to its end is a draft or pending. Locking
//     takes the month's summary for payroll (each employee's days by how
//     they're paid: the lines whose pay month is this month, adjustments
//     from locked months included, decision 9) and posts each employee's
//     accrual for the month at their grade then (less unpaid days,
//     decision 11). Only the latest locked month can be reopened, with a
//     reason (its accruals are taken back; it is locked again later).
//   - The year close (decision 13), after December is locked: each
//     balance at 31 December, what carries (up to the type's cap) and what
//     lapses; confirmed, each lapse is an adjustment on 31 December. Once a
//     year per company.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const { leaveTypes, PAY_LABEL } = require('./hrLeaveSetup');
const lv = require('./hrLeave');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'LEAVE';
const LEAVES = () => firestore.collection('leaveRequests');
const MONTHS = () => firestore.collection('leaveMonths');
const ACCRUALS = () => firestore.collection('leaveAccruals');
const OPENINGS = () => firestore.collection('leaveOpenings');
const ADJUSTMENTS = () => firestore.collection('leaveAdjustments');
const YEARS = () => firestore.collection('leaveYearCloses');
const EMPLOYEES = () => firestore.collection('employees');

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const today = () => todayIn('Asia/Dubai');
const round2 = n => Math.round(n * 100) / 100;
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const docs = snap => snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const prevMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'); };

const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to the Leave Register.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'reopen' ? 'You do not have permission to reopen a locked month.' : 'You do not have permission to lock months or close the leave year.');
}
async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}
async function monthsOf(co) { return docs(await MONTHS().where('CompanyID', '==', co).get()); }
const latestLocked = list => list.filter(m => m.Status === 'Locked').map(m => m.Month).sort().pop() || '';
async function employeesOf(co) {
  return docs(await EMPLOYEES().where('CompanyID', '==', co).get()).map(e => Object.assign(e, { EmployeeID: e._id }));
}
async function companyLeaves(co) { return docs(await LEAVES().where('CompanyID', '==', co).get()).map(l => Object.assign(l, { LeaveID: l._id })); }

// The month for payroll: each employee's lines paid in it, by how they are
// paid; days dated in an earlier (locked) month are adjustments.
function summaryRows(month, emps, leaves, accrualsByEmp) {
  const rows = [];
  emps.forEach(e => {
    const mine = leaves.filter(l => l.EmployeeID === e.EmployeeID && (l.Status === 'Approved' || l.Status === 'Cancelled'))
      .reduce((a, l) => a.concat((l.Lines || []).filter(x => lv.payMonthOf(x) === month).map(x => Object.assign({ TypeName: l.LeaveTypeName }, x))), []);
    const acc = accrualsByEmp[e.EmployeeID] || [];
    if (!mine.length && !acc.length) return;
    const groups = {};
    let unpaid = 0, absent = 0, duty = 0, adjust = 0;
    mine.forEach(x => {
      if (x.Date.slice(0, 7) !== month || x.Reversal) adjust = round2(adjust + x.Fraction);
      if (x.Absence) absent = round2(absent + x.Fraction);
      if (x.Pay === 'Unpaid') { unpaid = round2(unpaid + x.Fraction); return; }
      if (x.Pay === 'Duty') { duty = round2(duty + x.Fraction); return; }
      const key = [x.Code, x.Pay, x.Percent, (x.Elements || []).join(',')].join('|');
      if (!groups[key]) groups[key] = { Code: x.Code, Name: x.Split ? 'Unpaid' : x.TypeName, Pay: x.Pay, PayLabel: x.Pay === 'Elements' ? 'Selected elements' : PAY_LABEL[x.Pay], Percent: x.Percent, Elements: x.Elements || [], Days: 0 };
      groups[key].Days = round2(groups[key].Days + x.Fraction);
    });
    rows.push({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, EmployeeName: e.FullName, PaidLeave: Object.values(groups).filter(g => g.Days),
      UnpaidDays: unpaid, AbsentDays: absent, DutyDays: duty, AdjustmentDays: adjust, Accrued: acc.map(a => ({ Code: a.Code, Days: a.Days })) });
  });
  return rows.sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
}

// Each employee's accrual for the month, at their grade now (decision 12),
// less the unpaid days paid in the month (decision 11).
async function monthAccruals(month, emps, leaves) {
  const start = month + '-01', end = lv.monthEnd(start);
  const types = (await leaveTypes()).filter(t => t.Kind === 'Leave' && t.UsesBalance);
  const openings = docs(await OPENINGS().get());
  const out = [];
  for (const e of emps) {
    if (e.JoinDate > end || (e.Status === 'Left' && e.LeavingDate && e.LeavingDate < start)) continue;
    const grade = await lv.gradeLevel(e);
    const unpaid = lv.unpaidLines(leaves.filter(l => l.EmployeeID === e.EmployeeID));
    for (const t of types) {
      const op = openings.find(o => o.EmployeeID === e.EmployeeID && o.LeaveTypeID === t.LeaveTypeID);
      const from = [start, op ? lv.nextDay(op.AsOf) : e.JoinDate].sort().pop();
      if (from > end) continue;
      const days = round2(lv.accrued(t, e, grade ? grade.Level : null, from, end, { unpaid }));
      out.push({ EmployeeID: e.EmployeeID, LeaveTypeID: t.LeaveTypeID, Code: t.Code, Days: days, GradeCode: grade ? grade.Code : '', GradeLevel: grade ? grade.Level : null });
    }
  }
  return out;
}
// When a month can be locked (payroll step 7, decision 56): from the
// company's cut-off day (Payroll Setup → Payroll Accounting, e.g. 25), so
// the month is paid before it ends; with none, after it ends. Leave dated
// after the lock for the rest of the month is paid in the next month, as
// an adjustment (its pay month is set when it is approved).
async function lockFrom(co, month) {
  const day = Number(((await firestore.collection('payrollSettings').doc(co).get()).data() || {}).CutOffDay) || 0;
  const end = lv.monthEnd(month + '-01');
  return day ? { date: month + '-' + String(day).padStart(2, '0'), day } : { date: lv.nextDay(end), day: 0 };
}
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

const byEmp = list => list.reduce((a, x) => { (a[x.EmployeeID] = a[x.EmployeeID] || []).push(x); return a; }, {});

// ---------- callables: months ----------

exports.getLeaveMonths = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const co = await companyFor(user, (request.data || {}).companyId);
  const list = await monthsOf(co);
  const latest = latestLocked(list);
  const thisMonth = today().slice(0, 7);
  // The last twelve months to this one, and any locked before them.
  const shown = new Set(list.map(m => m.Month));
  for (let m = thisMonth, i = 0; i < 13; m = prevMonth(m), i++) shown.add(m);
  const from = {};
  for (const m of shown) from[m] = await lockFrom(co, m);
  const months = [...shown].sort().reverse().map(m => {
    const rec = list.find(x => x.Month === m);
    // Ended: lockable by date (from the cut-off day, else after the month).
    return { Month: m, Status: rec ? rec.Status : 'Open', LockedAt: rec && rec.LockedAt || '', LockedByName: rec && rec.LockedByName || '',
      History: rec ? rec.History || [] : [], Ended: from[m].date <= today(), LockFrom: from[m].date, CutOffDay: from[m].day };
  });
  const nextLockable = latest ? lv.nextMonth(latest) : '';
  return { companyId: co, months, latestLocked: latest, nextLockable, canLock: await can(user, 'lock'), canReopen: await can(user, 'reopen') };
});

// The month's summary: as locked, or as it stands (not yet locked).
exports.getLeaveMonthSummary = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) bad('Choose a month.');
  const rec = (await MONTHS().doc(co + '_' + month).get()).data();
  if (rec && rec.Status === 'Locked') return { month, status: 'Locked', rows: rec.Rows || [], lockedAt: rec.LockedAt, lockedByName: rec.LockedByName };
  const [emps, leaves] = await Promise.all([employeesOf(co), companyLeaves(co)]);
  const acc = await monthAccruals(month, emps, leaves);
  return { month, status: 'Open', rows: summaryRows(month, emps, leaves, byEmp(acc)) };
});

exports.lockLeaveMonth = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'lock');
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) bad('Choose a month.');
  const end = lv.monthEnd(month + '-01');
  const from = await lockFrom(co, month);
  if (from.date > today()) {
    throw new HttpsError('failed-precondition', from.day ? 'A month is locked from its cut-off day, the ' + ordinal(from.day) + ' (Payroll Setup → Payroll Accounting): ' + month + ' from ' + from.date + '.'
      : 'A month is locked after it ends.');
  }
  // Before the month ends, only the leave dated up to today must be decided.
  const upTo = end < today() ? end : today();
  const list = await monthsOf(co);
  const latest = latestLocked(list);
  if (list.some(m => m.Month === month && m.Status === 'Locked')) throw new HttpsError('failed-precondition', month + ' is already locked.');
  if (latest && month !== lv.nextMonth(latest)) throw new HttpsError('failed-precondition', 'Months are locked in order: the next to lock is ' + lv.nextMonth(latest) + '.');
  const [emps, leaves] = await Promise.all([employeesOf(co), companyLeaves(co)]);
  const open = leaves.filter(l => ['Draft', 'PendingManager', 'PendingApproval'].includes(l.Status) && l.FromDate <= upTo);
  if (open.length) {
    throw new HttpsError('failed-precondition', 'Decide or delete the leave dated up to ' + (upTo === end ? 'the month\'s end' : 'today') + ' first: ' +
      open.slice(0, 5).map(l => (l.LeaveNumber || 'draft') + ' (' + l.EmployeeName + (l.Status === 'PendingManager' ? ', with the line manager' : '') + ')').join(', ') + (open.length > 5 ? ' and ' + (open.length - 5) + ' more' : '') + '.');
  }
  const acc = await monthAccruals(month, emps, leaves);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  acc.forEach(a => batch.set(ACCRUALS().doc(a.EmployeeID + '_' + a.LeaveTypeID + '_' + month), {
    EmployeeID: a.EmployeeID, CompanyID: co, LeaveTypeID: a.LeaveTypeID, Month: month, Days: a.Days, GradeCode: a.GradeCode, GradeLevel: a.GradeLevel, PostedAt: now }));
  const prev = list.find(m => m.Month === month);
  batch.set(MONTHS().doc(co + '_' + month), { CompanyID: co, Month: month, Status: 'Locked', LockedAt: now, LockedBy: user.uid, LockedByName: actorName(user),
    Rows: summaryRows(month, emps, leaves, byEmp(acc)), History: ((prev && prev.History) || []).concat([{ Event: 'Locked', By: actorName(user), At: now }]) });
  await batch.commit();
  return { success: true, employees: new Set(acc.map(a => a.EmployeeID)).size };
});

exports.reopenLeaveMonth = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'reopen');
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  const list = await monthsOf(co);
  const latest = latestLocked(list);
  if (!latest || month !== latest) throw new HttpsError('failed-precondition', latest ? 'Only the latest locked month (' + latest + ') can be reopened.' : 'No month is locked.');
  // Payroll (docs/modules/HR_PAYROLL.md, step 3): the leave a submitted or
  // posted run paid stays as it was; later leave is paid in the next month.
  const run = (await firestore.collection('payrollRuns').doc(co + '_' + month).get()).data();
  if (run && run.Status !== 'Draft') throw new HttpsError('failed-precondition', 'The payroll run for ' + month + ' is ' + (run.Status === 'Posted' ? 'posted' : 'submitted') + ': the month\'s leave stays locked. Leave entered now is paid in the next open month.');
  const reason = text(d.reason, 500);
  if (!reason) bad('Give the reason for reopening.');
  const closed = (await YEARS().doc(co + '_' + month.slice(0, 4)).get()).exists;
  if (closed && month.endsWith('-12')) throw new HttpsError('failed-precondition', 'The leave year ' + month.slice(0, 4) + ' is closed: December stays locked.');
  const now = new Date().toISOString();
  const rec = list.find(m => m.Month === month);
  const batch = firestore.batch();
  (await ACCRUALS().where('CompanyID', '==', co).get()).docs.filter(x => x.data().Month === month).forEach(x => batch.delete(x.ref));
  batch.update(MONTHS().doc(co + '_' + month), { Status: 'Open', LastRows: rec.Rows || [], Rows: [], ReopenedAt: now,
    History: (rec.History || []).concat([{ Event: 'Reopened', By: actorName(user), At: now, Note: reason }]) });
  await batch.commit();
  return { success: true };
});

// ---------- the year close ----------

async function yearRows(co, year) {
  const asOf = year + '-12-31';
  const types = (await leaveTypes()).filter(t => t.Kind === 'Leave' && t.UsesBalance);
  const emps = (await employeesOf(co)).filter(e => e.Status !== 'Left' && e.JoinDate <= asOf);
  const openings = docs(await OPENINGS().get());
  const rows = [];
  for (const e of emps) {
    const leaves = await lv.leavesOf(e.EmployeeID);
    const grade = await lv.gradeLevel(e);
    for (const t of types) {
      const op = openings.find(o => o.EmployeeID === e.EmployeeID && o.LeaveTypeID === t.LeaveTypeID);
      if (op && op.AsOf >= asOf) continue; // the opening balance is after the year
      const b = await lv.balanceOf(e, t, asOf, null, { leaves, grade });
      // At the year end: what was earned and adjusted, less what was taken.
      const atEnd = round2(b.Opening + b.Accrued + b.Adjustments - b.Taken);
      const cap = t.CarryForwardCap == null ? Infinity : t.CarryForwardCap;
      const carry = round2(Math.min(Math.max(atEnd, 0), cap));
      rows.push({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, EmployeeName: e.FullName, LeaveTypeID: t.LeaveTypeID, Code: t.Code, Name: t.Name,
        Balance: atEnd, Cap: t.CarryForwardCap, Carry: carry, Lapse: round2(Math.max(0, atEnd - carry)) });
    }
  }
  return rows.sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)) || a.Code.localeCompare(b.Code));
}

// confirm: false shows what it would do (or what it did, once closed).
exports.closeLeaveYear = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, (request.data || {}).confirm === true ? 'lock' : null);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const year = Number(d.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) bad('Choose a year.');
  const done = (await YEARS().doc(co + '_' + year).get()).data();
  if (done) {
    if (d.confirm === true) throw new HttpsError('failed-precondition', 'The leave year ' + year + ' is already closed (' + done.ClosedAt.slice(0, 10) + ').');
    return { year, closed: true, closedAt: done.ClosedAt, closedByName: done.ClosedByName, rows: done.Rows };
  }
  const dec = (await MONTHS().doc(co + '_' + year + '-12').get()).data();
  const decLocked = Boolean(dec && dec.Status === 'Locked');
  const rows = await yearRows(co, year);
  if (d.confirm !== true) return { year, closed: false, decemberLocked: decLocked, rows };
  if (!decLocked) throw new HttpsError('failed-precondition', 'Lock December ' + year + ' first.');
  const now = new Date().toISOString();
  const batch = firestore.batch();
  rows.filter(r => r.Lapse > 0).forEach(r => batch.set(ADJUSTMENTS().doc(), { EmployeeID: r.EmployeeID, CompanyID: co, LeaveTypeID: r.LeaveTypeID, Date: year + '-12-31',
    Days: -r.Lapse, Kind: 'Lapse', Reason: 'Lapsed at the end of ' + year + ' (carry up to ' + r.Cap + ')', By: user.uid, ByName: actorName(user), At: now }));
  batch.set(YEARS().doc(co + '_' + year), { CompanyID: co, Year: year, Rows: rows, ClosedAt: now, ClosedBy: user.uid, ClosedByName: actorName(user) });
  await batch.commit();
  return { year, closed: true, rows, lapsed: round2(rows.reduce((s, r) => s + r.Lapse, 0)) };
});
