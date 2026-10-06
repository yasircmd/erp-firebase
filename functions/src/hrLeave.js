// HR: Attendance and Leave Register, step 2: the Leave Register (owner,
// 2026-10-03; docs/modules/HR_LEAVE.md). HR records each employee's leave
// (owner point 1); it is approved through Approval Configuration (decision
// 2: the amount is the leave's days) and then counts against the balance.
//
// A leave is stored with one line per day it counts (decision 8: working
// or calendar days, per type), each with its fraction (half days), what it
// is (the type, or Unpaid when it goes over the balance, decision 5, or an
// absence after a late return, decision 7) and how it is paid (the leave
// pay rule for the employee's grade level and the day's number in the
// leave year, owner point 3). The month summary and payroll (step 3, then
// Payroll) read these lines.
//
// The balance of a type that uses one: the opening balance (imported, on
// its as-of date), plus the entitlement accrued since (decision 3: monthly,
// pro-rata by days; the row for the employee's current grade level and
// completed years of service), plus adjustments, less approved and pending
// leave. The year-end carry forward and lapse are step 3.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { loadSetup } = require('./hrSetup');
const { leaveTypes, calendarFor, PAY_LABEL } = require('./hrLeaveSetup');
const { addDay, countedDays } = require('./workCalendar');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'LEAVE';
const LEAVES = () => firestore.collection('leaveRequests');
const OPENINGS = () => firestore.collection('leaveOpenings');
const ADJUSTMENTS = () => firestore.collection('leaveAdjustments');
const EMPLOYEES = () => firestore.collection('employees');
const ELEMENTS = () => firestore.collection('hrPayElements');
const LIVE = ['Draft', 'PendingApproval', 'Approved']; // hold their days
const COUNTING = ['PendingApproval', 'Approved']; // count against balances and limits
const ACCRUALS = () => firestore.collection('leaveAccruals');
const MONTHS = () => firestore.collection('leaveMonths');
// Step 3 (decision 9): each line is paid in a month (PayMonth): its own, or
// the next open one when its month is locked. A line taken away after its
// month was locked is reversed (Reversal, a negative fraction) in the next
// open month. Reversals are pay adjustments only: never days taken.
const live = x => !x.Reversal;
const payMonthOf = x => x.PayMonth || x.Date.slice(0, 7);
const nextMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); };

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const today = () => todayIn('Asia/Dubai');
const round2 = n => Math.round(n * 100) / 100;
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const actorOf = user => user.profile.username || user.uid; // as other documents (My Drafts reads it)
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const histEntry = (event, user, note) => ({ Event: event, By: actorName(user), At: new Date().toISOString(), Note: note || '' });
const dayWord = n => n + (n === 1 ? ' day' : ' days');

const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to the Leave Register.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'post' ? 'You do not have permission to submit, cancel or close leave.' : 'You do not have permission to enter leave.');
}
async function loadEmployee(user, id) {
  const s = await EMPLOYEES().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Employee not found.');
  const e = Object.assign({ EmployeeID: s.id }, s.data());
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return e;
}
async function loadLeave(user, id) {
  const s = await LEAVES().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Leave not found.');
  const l = Object.assign({ LeaveID: s.id }, s.data());
  if (!userCanAccessCompany(user.profile, l.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return l;
}
async function typeById(id) {
  const t = (await leaveTypes()).find(x => x.LeaveTypeID === text(id, 80));
  if (!t) bad('Choose the leave type.');
  return t;
}
async function gradeLevel(emp) {
  const g = (await loadSetup()).grades.find(x => x.GradeID === emp.GradeID);
  return g ? { Code: g.Code, Level: g.Level } : null;
}
const docs = snap => snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
async function leavesOf(employeeId) { return docs(await LEAVES().where('EmployeeID', '==', employeeId).get()).map(l => Object.assign(l, { LeaveID: l._id })); }

// ---------- the balance ----------

const yearsBetween = (from, to) => {
  let y = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (to.slice(5) < from.slice(5)) y -= 1;
  return Math.max(0, y);
};
const monthEnd = d => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const daysIn = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
// Days accrued from..to (inclusive): each month's rate (a twelfth of the
// row's days a year), pro-rata by the days of that month in the range, less
// its unpaid days (decision 11). A locked month's posted accrual is used as
// it is (posted: { 'yyyy-mm': days }); unpaid: [{ Month, Date, Fraction }].
function accrued(type, emp, level, from, to, ctx) {
  const posted = (ctx && ctx.posted) || {}, unpaid = (ctx && ctx.unpaid) || [];
  let total = 0;
  for (let start = from; start <= to; start = addDay(monthEnd(start), 1)) {
    const end = monthEnd(start) < to ? monthEnd(start) : to;
    const m = start.slice(0, 7);
    if (posted[m] != null && end === monthEnd(start)) { total += posted[m]; continue; }
    const years = yearsBetween(emp.JoinDate, start);
    // The employee's own entitlement, if HR set one (Payroll step 5, decision 31).
    const own = ((emp.LeaveOverrides || {})[type.LeaveTypeID] || {}).DaysPerYear;
    const row = own != null ? { DaysPerYear: own } : level == null ? null : (type.Entitlements || []).find(r => r.LevelFrom <= level && level <= r.LevelTo && r.ServiceFrom <= years && (r.ServiceTo == null || years <= r.ServiceTo));
    if (!row) continue;
    const off = unpaid.filter(u => u.Month === m && u.Date <= end).reduce((a, u) => a + u.Fraction, 0);
    total += row.DaysPerYear / 12 * Math.max(0, daysIn(start, end) - off) / daysIn(m + '-01', monthEnd(start));
  }
  return total;
}
// The unpaid days of approved (and reversed) leave, by the month they're paid in.
function unpaidLines(leaves) {
  const out = [];
  leaves.filter(l => l.Status === 'Approved' || l.Status === 'Cancelled').forEach(l => (l.Lines || []).forEach(x => {
    if (x.Pay === 'Unpaid') out.push({ Month: payMonthOf(x), Date: x.Date, Fraction: x.Fraction });
  }));
  return out;
}
// The balance of one type on a date. Leave and adjustments from before the
// opening balance's date are already in it.
async function balanceOf(emp, type, asOf, excludeId, cache) {
  const c = cache || {};
  const [openSnap, adjSnap, leaves, grade, accSnap] = await Promise.all([
    OPENINGS().where('EmployeeID', '==', emp.EmployeeID).get(), ADJUSTMENTS().where('EmployeeID', '==', emp.EmployeeID).get(),
    c.leaves || leavesOf(emp.EmployeeID), c.grade !== undefined ? c.grade : gradeLevel(emp), ACCRUALS().where('EmployeeID', '==', emp.EmployeeID).get()]);
  const posted = Object.fromEntries(docs(accSnap).filter(a => a.LeaveTypeID === type.LeaveTypeID).map(a => [a.Month, a.Days]));
  const opening = docs(openSnap).find(o => o.LeaveTypeID === type.LeaveTypeID) || null;
  const after = opening ? opening.AsOf : '';
  const start = opening ? addDay(opening.AsOf, 1) : emp.JoinDate;
  const acc = asOf >= start ? accrued(type, emp, grade ? grade.Level : null, start, asOf, { posted, unpaid: unpaidLines(leaves) }) : 0;
  const adj = docs(adjSnap).filter(a => a.LeaveTypeID === type.LeaveTypeID && a.Date > after && a.Date <= asOf).reduce((s, a) => s + a.Days, 0);
  let taken = 0, booked = 0;
  leaves.filter(l => l.LeaveID !== excludeId && COUNTING.includes(l.Status)).forEach(l => (l.Lines || []).filter(live).forEach(x => {
    if (x.Code !== type.Code || x.Date <= after) return;
    if (l.Status === 'Approved' && x.Date <= asOf) taken += x.Fraction; else booked += x.Fraction;
  }));
  const r = {
    Opening: opening ? opening.Days : 0, OpeningAsOf: opening ? opening.AsOf : '', Accrued: round2(acc), Adjustments: round2(adj),
    Taken: round2(taken), Booked: round2(booked)
  };
  r.Available = round2(r.Opening + r.Accrued + r.Adjustments - r.Taken - r.Booked);
  return r;
}

// ---------- checking a leave ----------

function payText(line, names) {
  if (line.Pay === 'Duty') return 'paid as working';
  if (line.Pay === 'Unpaid') return 'Unpaid';
  const what = line.Pay === 'Elements' ? line.Elements.map(id => names[id] || id).join(' + ') : PAY_LABEL[line.Pay];
  return what + (line.Percent === 100 ? '' : ' at ' + line.Percent + '%');
}
// Consecutive lines that read the same, added up: "6 days Annual Leave —
// Basic only", "4 days Unpaid (over the balance)".
function summarize(lines, typeName, names) {
  const out = [];
  lines.forEach(l => {
    const label = l.Absence ? (l.Late ? 'Absent (late return), unpaid' : 'Absent, unpaid') : l.Split ? 'Unpaid (over the balance)' : typeName + ' — ' + payText(l, names);
    const last = out[out.length - 1];
    if (last && last.Label === label) last.Days = round2(last.Days + l.Fraction); else out.push({ Label: label, Days: l.Fraction });
  });
  return out;
}
async function elementNames() { return Object.fromEntries((await ELEMENTS().get()).docs.map(d => [d.id, d.data().Name])); }
function nextWorkingDay(cal, d) {
  for (let x = addDay(d, 1), i = 0; i < 60; x = addDay(x, 1), i++) if (countedDays(cal, x, x, 'Working').length) return x;
  return addDay(d, 1);
}

// Once an employee's final settlement is submitted (payroll step 5c), it
// has paid their leave up to the leaving date: their leave stays as it is.
async function requireNoSettlement(employeeId, name) {
  const s = (await firestore.collection('payrollSettlements').doc('fs_' + employeeId).get()).data();
  if (s && s.Status !== 'Draft') throw new HttpsError('failed-precondition', (name || 'The employee') + ' has a final settlement (' + s.Number + '): their leave can no longer change.');
}

// The leave as asked, checked; returns what to store.
async function evaluate(input, emp, excludeId) {
  const d = input || {};
  await requireNoSettlement(emp.EmployeeID, emp.FullName);
  const type = await typeById(d.LeaveTypeID);
  const from = text(d.FromDate, 10), to = text(d.ToDate, 10);
  if (!isDate(from) || !isDate(to)) bad('Enter the first and last day of the leave.');
  if (to < from) bad('The last day is before the first.');
  if (daysIn(from, to) > 366) bad('A leave is at most a year: enter longer leave in parts.');
  if (emp.Status === 'Left') throw new HttpsError('failed-precondition', emp.FullName + ' has left.');
  if (from < emp.JoinDate) bad('The leave starts before the date of joining (' + emp.JoinDate + ').');
  if (type.Active === false && !excludeId) bad(type.Name + ' is no longer in use.');
  if (type.Gender !== 'Any' && emp.Gender !== type.Gender) {
    bad(type.Name + ' is for ' + (type.Gender === 'Female' ? 'women' : 'men') + (emp.Gender ? '.' : ': set the employee\'s gender first.'));
  }
  if (type.AfterProbation && emp.ProbationEndDate && from <= emp.ProbationEndDate) bad(type.Name + ' starts after probation (ends ' + emp.ProbationEndDate + ').');
  const halfStart = d.HalfStart === true, halfEnd = d.HalfEnd === true;
  if ((halfStart || halfEnd) && !type.HalfDays) bad(type.Name + ' is taken in whole days.');
  if (from === to && halfStart && halfEnd) bad('A single half day: tick only one half.');
  const cal = await calendarFor(emp); // the employee's work schedule (Payroll step 0)
  const counts = ((emp.LeaveOverrides || {})[type.LeaveTypeID] || {}).Counts || type.Counts; // the employee's own (decision 31)
  const dates = countedDays(cal, from, to, counts);
  if (counts === 'Working') {
    if (!dates.length) bad('There are no working days in those dates.');
    if (dates[0] !== from) bad('The leave starts on a day off (weekend or holiday): start it on the first working day.');
    if (dates[dates.length - 1] !== to) bad('The leave ends on a day off (weekend or holiday): end it on the last working day.');
  }
  const fraction = (dt, i) => (i === 0 && halfStart) || (i === dates.length - 1 && halfEnd) ? 0.5 : 1;
  const days = round2(dates.reduce((s, dt, i) => s + fraction(dt, i), 0));
  if (type.MaxPerInstance != null && days > type.MaxPerInstance) bad(type.Name + ' is at most ' + dayWord(type.MaxPerInstance) + ' at a time.');

  const others = (await leavesOf(emp.EmployeeID)).filter(l => l.LeaveID !== excludeId);
  const clash = others.find(l => LIVE.includes(l.Status) && l.FromDate <= to && from <= (l.EffectiveTo || l.ToDate));
  if (clash) bad(emp.FullName + ' already has leave ' + (clash.LeaveNumber || '(draft)') + ' from ' + clash.FromDate + ' to ' + (clash.EffectiveTo || clash.ToDate) + '.');
  const usedIn = (year, beforeDate) => others.filter(l => COUNTING.includes(l.Status)).reduce((s, l) => s + (l.Lines || []).filter(live)
    .filter(x => x.Code === type.Code && x.Date.slice(0, 4) === year && (!beforeDate || x.Date < beforeDate)).reduce((a, x) => a + x.Fraction, 0), 0);
  if (type.MaxPerYear != null) {
    for (const year of [...new Set(dates.map(x => x.slice(0, 4)))]) {
      const mine = dates.reduce((s, dt, i) => s + (dt.slice(0, 4) === year ? fraction(dt, i) : 0), 0);
      const used = usedIn(year);
      if (used + mine > type.MaxPerYear) bad(type.Name + ' is at most ' + dayWord(type.MaxPerYear) + ' a year: ' + dayWord(round2(used)) + ' already taken or booked in ' + year + '.');
    }
  }

  // Over the balance: the rest becomes Unpaid (decision 5).
  const warnings = [];
  const grade = await gradeLevel(emp);
  let balance = null, typeDays = days;
  if (type.Kind === 'Leave' && type.UsesBalance) {
    const b = await balanceOf(emp, type, from, excludeId, { leaves: others, grade });
    typeDays = Math.min(days, Math.max(0, Math.floor(b.Available * 2) / 2));
    balance = { Before: b.Available, After: round2(b.Available - typeDays) };
    if (typeDays < days) warnings.push(dayWord(round2(days - typeDays)) + ' over the balance (' + b.Available + ') will be unpaid.');
  }
  // The lines, each paid by the rule for its day number in the year.
  const lines = [];
  let left = typeDays;
  const running = {};
  dates.forEach((dt, i) => {
    const f = fraction(dt, i);
    const mine = Math.min(f, left);
    left = round2(left - mine);
    if (mine > 0) {
      const year = dt.slice(0, 4);
      if (running[year] == null) running[year] = usedIn(year, from);
      running[year] = round2(running[year] + mine);
      if (type.Kind === 'Duty') lines.push({ Date: dt, Fraction: mine, Code: type.Code, Pay: 'Duty', Percent: 100, Elements: [] });
      // An unauthorised absence (decision 10): always unpaid, no balance.
      else if (type.Kind === 'Absence') lines.push({ Date: dt, Fraction: mine, Code: type.Code, Pay: 'Unpaid', Percent: 0, Elements: [], Absence: true });
      else {
        const dayNo = Math.ceil(running[year]);
        if (!grade) bad(emp.FullName + ' has no grade: set it before entering leave.');
        const rule = (type.PayRules || []).find(r => r.LevelFrom <= grade.Level && grade.Level <= r.LevelTo && r.DayFrom <= dayNo && (r.DayTo == null || dayNo <= r.DayTo));
        if (!rule) bad('No leave pay rule for ' + type.Name + ' at grade ' + grade.Code + ' (level ' + grade.Level + '), day ' + dayNo + ' of ' + year + ': set it in HR Setup → Leave Types.');
        lines.push({ Date: dt, Fraction: mine, Code: type.Code, Pay: rule.Pay, Percent: rule.Percent, Elements: rule.Elements || [] });
      }
    }
    if (f - mine > 0) lines.push({ Date: dt, Fraction: round2(f - mine), Code: 'UNPAID', Pay: 'Unpaid', Percent: 0, Elements: [], Split: true });
  });
  const docNeeded = type.DocumentAfterDays != null && days > type.DocumentAfterDays;
  return {
    LeaveTypeID: type.LeaveTypeID, LeaveTypeCode: type.Code, LeaveTypeName: type.Name, Kind: type.Kind, FromDate: from, ToDate: to, HalfStart: halfStart, HalfEnd: halfEnd,
    Reason: text(d.Reason, 1000), Days: days, TypeDays: round2(typeDays), UnpaidDays: round2(days - typeDays), Lines: lines,
    Summary: summarize(lines, type.Name, await elementNames()), Balance: balance, Warnings: warnings, DocumentNeeded: docNeeded,
    DocumentAfterDays: type.DocumentAfterDays, ConfirmReturn: Boolean(type.ConfirmReturn) && type.Kind === 'Leave', ExpectedReturn: nextWorkingDay(cal, to),
    GradeCode: grade ? grade.Code : '', GradeLevel: grade ? grade.Level : null
  };
}
async function fileCount(leaveId) {
  return (await firestore.collection('attachments').where('DocKey', '==', MODULE_ID + ':' + leaveId).get()).docs.filter(d => !d.data().Removed).length;
}
async function requireDocument(v, leaveId) {
  if (v.DocumentNeeded && !(await fileCount(leaveId))) {
    bad('Attach the supporting document (e.g. a medical certificate) below the leave: ' + v.LeaveTypeName + ' over ' + dayWord(v.DocumentAfterDays) + ' needs one.');
  }
}

// ---------- callables: the register ----------

exports.getLeaves = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const leaves = docs(await LEAVES().get()).filter(l => userCanAccessCompany(user.profile, l.CompanyID))
    .map(l => ({ LeaveID: l._id, LeaveNumber: l.LeaveNumber || '', Status: l.Status, EmployeeID: l.EmployeeID, EmployeeNo: l.EmployeeNo, EmployeeName: l.EmployeeName,
      CompanyID: l.CompanyID, LeaveTypeID: l.LeaveTypeID, LeaveTypeName: l.LeaveTypeName, FromDate: l.FromDate, ToDate: l.ToDate, EffectiveTo: l.EffectiveTo || '',
      Days: l.Days, UnpaidDays: l.UnpaidDays || 0, LateDays: l.LateDays || 0, ReturnDate: l.ReturnDate || '', ConfirmReturn: Boolean(l.ConfirmReturn), UpdatedAt: l.UpdatedAt || l.CreatedAt }))
    .sort((a, b) => String(b.FromDate).localeCompare(String(a.FromDate)) || String(b.UpdatedAt).localeCompare(String(a.UpdatedAt)));
  return { leaves, canDraft: await can(user, 'draft'), canPost: await can(user, 'post'), today: today() };
});

// What the form needs: the employees the user may enter leave for, and the
// leave types in use.
exports.getLeaveForm = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const employees = docs(await EMPLOYEES().get()).filter(e => e.Status !== 'Left' && userCanAccessCompany(user.profile, e.CompanyID))
    .map(e => ({ EmployeeID: e._id, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID })).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  const types = (await leaveTypes()).filter(t => t.Active !== false).map(t => ({ LeaveTypeID: t.LeaveTypeID, Code: t.Code, Name: t.Name, Kind: t.Kind, HalfDays: t.HalfDays, UsesBalance: t.UsesBalance, Counts: t.Counts }));
  return { employees, types };
});

exports.getLeave = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const l = await loadLeave(user, (request.data || {}).leaveId);
  const inst = l.ApprovalInstanceID ? (await rtdb.ref('approvalInstances/' + l.ApprovalInstanceID).get()).val() : null;
  const decided = new Set(((inst && inst.Decisions) || []).map(x => x.LevelNumber));
  const myLevels = inst && inst.Status === 'Pending' ? (inst.RequiredLevels || []).filter(x => x.ApproverUserID === user.uid && !decided.has(x.LevelNumber)).map(x => x.LevelNumber) : [];
  return { leave: l, approval: inst ? { Status: inst.Status, Levels: inst.RequiredLevels || [], Decisions: inst.Decisions || [] } : null,
    myLevels, canDraft: await can(user, 'draft'), canPost: await can(user, 'post'), today: today() };
});

// The days, balance and pay a leave would have, without saving it.
exports.previewLeave = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = (request.data || {}).leave || {};
  const emp = await loadEmployee(user, d.EmployeeID);
  return { preview: await evaluate(d, emp, text(d.LeaveID, 80) || null) };
});

exports.saveLeave = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = (request.data || {}).leave || {};
  const now = new Date().toISOString();
  if (d.LeaveID) {
    const l = await loadLeave(user, d.LeaveID);
    if (l.Status !== 'Draft' && l.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only a draft or rejected leave can be edited.');
    const emp = await loadEmployee(user, l.EmployeeID);
    const v = await evaluate(d, emp, l.LeaveID);
    await LEAVES().doc(l.LeaveID).update(Object.assign(v, { Description: v.LeaveTypeName + ' — ' + emp.FullName, UpdatedAt: now, UpdatedBy: actorOf(user),
      History: (l.History || []).concat([histEntry('Edited', user)]) }));
    return { success: true, leaveId: l.LeaveID, warnings: v.Warnings };
  }
  const emp = await loadEmployee(user, d.EmployeeID);
  const v = await evaluate(d, emp, null);
  const ref = await LEAVES().add(Object.assign(v, { EmployeeID: emp.EmployeeID, EmployeeNo: emp.EmployeeNo, EmployeeName: emp.FullName, CompanyID: emp.CompanyID,
    Description: v.LeaveTypeName + ' — ' + emp.FullName, Status: 'Draft', LeaveNumber: '', CreatedAt: now, CreatedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user),
    History: [histEntry('Created', user)] }));
  return { success: true, leaveId: ref.id, warnings: v.Warnings };
});

exports.deleteLeave = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const l = await loadLeave(user, (request.data || {}).leaveId);
  if (l.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only a draft can be deleted.');
  await LEAVES().doc(l.LeaveID).delete();
  return { success: true };
});

// The months locked for payroll in a company (docs/modules/HR_LEAVE.md, step 3).
async function lockedMonths(companyId) {
  return new Set(docs(await MONTHS().where('CompanyID', '==', companyId).get()).filter(m => m.Status === 'Locked').map(m => m.Month));
}
function openFrom(locked, m) { let x = m; while (locked.has(x)) x = nextMonth(x); return x; }
const lineKey = x => [x.Date, x.Code, x.Pay, x.Percent, x.Fraction, x.Split ? 1 : 0, x.Absence ? 1 : 0].join('|');
// newLines replace oldLines: unchanged lines keep their pay month; new
// ones are paid in their month, or the next open one if it is locked; a
// line taken away after its pay month was locked is reversed in the next
// open month (decision 9). Earlier reversals stay.
function withPayMonths(newLines, oldLines, locked) {
  const pool = (oldLines || []).filter(live).slice();
  const out = newLines.filter(live).map(x => {
    const i = pool.findIndex(o => lineKey(o) === lineKey(x));
    if (i >= 0) { const o = pool.splice(i, 1)[0]; return Object.assign({}, x, { PayMonth: payMonthOf(o) }); }
    return Object.assign({}, x, { PayMonth: openFrom(locked, x.Date.slice(0, 7)) });
  });
  pool.forEach(o => { if (locked.has(payMonthOf(o))) out.push(Object.assign({}, o, { Fraction: -o.Fraction, Reversal: true, PayMonth: openFrom(locked, payMonthOf(o)) })); });
  return out.concat((oldLines || []).filter(x => x.Reversal));
}
// Absences go through their own Approval Configuration entry (decision 10).
const approvalKeyOf = v => (v.Kind === 'Absence' ? 'LEAVE_ABSENCE' : MODULE_ID);

async function nextNumber(from) {
  const year = from.slice(0, 4);
  const res = await rtdb.ref('hrCounters/LV-' + year).transaction(cur => (Number(cur) || 0) + 1);
  return 'LV-' + year + '-' + String(res.snapshot.val()).padStart(4, '0');
}

// Submit: checked again (the balance may have moved); approval if
// configured (decision 2), else approved at once.
exports.submitLeave = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const l = await loadLeave(user, (request.data || {}).leaveId);
  if (l.Status !== 'Draft' && l.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only a draft or rejected leave can be submitted.');
  const emp = await loadEmployee(user, l.EmployeeID);
  const v = await evaluate(l, emp, l.LeaveID);
  await requireDocument(v, l.LeaveID);
  const number = l.LeaveNumber || await nextNumber(v.FromDate);
  const now = new Date().toISOString();
  const key = approvalKeyOf(v);
  const scopeKey = await resolveApprovalScopeKeyForDocument(key, { CompanyID: emp.CompanyID, DivisionID: emp.DivisionID, BranchID: emp.BranchID, CostCenterID: emp.CostCenterID });
  const approval = await beginApprovalInstance(MODULE_ID, l.LeaveID, number, scopeKey, v.Days, user.uid, key === MODULE_ID ? undefined : key);
  const base = Object.assign(v, { LeaveNumber: number, SubmittedAt: now, SubmittedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user), RejectionReason: '' });
  if (approval.required) {
    await LEAVES().doc(l.LeaveID).update(Object.assign(base, { Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, History: (l.History || []).concat([histEntry('Submitted for approval', user)]) }));
    return { success: true, status: 'PendingApproval', leaveNumber: number };
  }
  base.Lines = withPayMonths(v.Lines, [], await lockedMonths(l.CompanyID));
  await LEAVES().doc(l.LeaveID).update(Object.assign(base, { Status: 'Approved', ApprovedAt: now, History: (l.History || []).concat([histEntry('Submitted (no approval needed)', user)]) }));
  return { success: true, status: 'Approved', leaveNumber: number };
});

exports.decideLeaveApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  const l = await loadLeave(user, d.leaveId);
  if (l.Status !== 'PendingApproval' || !l.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'This leave is not awaiting approval.');
  const result = await recordApprovalDecision(user, l.ApprovalInstanceID, Number(d.levelNumber), d.decision, d.reason);
  const now = new Date().toISOString();
  if (result.status === 'Approved') {
    try {
      // Checked once more: the split over the balance is as of now.
      const emp = (await EMPLOYEES().doc(l.EmployeeID).get()).data();
      const v = await evaluate(l, Object.assign({ EmployeeID: l.EmployeeID }, emp), l.LeaveID);
      v.Lines = withPayMonths(v.Lines, [], await lockedMonths(l.CompanyID));
      await LEAVES().doc(l.LeaveID).update(Object.assign(v, { Status: 'Approved', ApprovedAt: now, UpdatedAt: now, History: (l.History || []).concat([histEntry('Approved', user)]) }));
    } catch (err) {
      // As other modules: undo the decision and hand it back for correcting.
      const inst = (await rtdb.ref('approvalInstances/' + l.ApprovalInstanceID).get()).val();
      if (inst) await rtdb.ref('approvalInstances/' + l.ApprovalInstanceID).update({ Decisions: (inst.Decisions || []).filter(x => x.LevelNumber !== Number(d.levelNumber)), Status: 'Pending', UpdatedAt: now });
      throw new HttpsError('failed-precondition', 'It can\'t be approved: ' + err.message + ' Nothing was changed.');
    }
  } else if (result.status === 'Rejected') {
    await LEAVES().doc(l.LeaveID).update({ Status: 'Rejected', RejectionReason: text(d.reason, 500), UpdatedAt: now, History: (l.History || []).concat([histEntry('Rejected', user, text(d.reason, 500))]) });
  } else {
    await LEAVES().doc(l.LeaveID).update({ UpdatedAt: now, History: (l.History || []).concat([histEntry('Approved level ' + d.levelNumber, user)]) });
  }
  return { success: true, status: result.status, selfApproved: result.selfApproved };
});

// Cancel approved leave that hasn't started: its days return. An absence
// can be cancelled at any time (recorded in error); what was already paid
// in a locked month is reversed in the next open one.
exports.cancelLeave = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};
  const l = await loadLeave(user, d.leaveId);
  if (l.Status !== 'Approved') throw new HttpsError('failed-precondition', 'Only approved leave can be cancelled (a pending one is rejected by its approver).');
  await requireNoSettlement(l.EmployeeID, l.EmployeeName);
  if (l.Kind !== 'Absence' && l.FromDate <= today()) throw new HttpsError('failed-precondition', 'The leave has started: record the return date instead.');
  const reason = text(d.reason, 500);
  if (!reason) bad('Give the reason for cancelling.');
  await LEAVES().doc(l.LeaveID).update({ Status: 'Cancelled', CancelReason: reason, Lines: withPayMonths([], l.Lines, await lockedMonths(l.CompanyID)), CancelledAt: new Date().toISOString(), UpdatedAt: new Date().toISOString(),
    History: (l.History || []).concat([histEntry('Cancelled', user, reason)]) });
  return { success: true };
});

// The return to work (decision 7): early gives the unused days back; late
// adds the working days in between as unpaid absence. confirm: false only
// shows what it would do.
exports.recordLeaveReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};
  const l = await loadLeave(user, d.leaveId);
  if (l.Status !== 'Approved' || l.Kind !== 'Leave') throw new HttpsError('failed-precondition', 'The return is recorded on approved leave.');
  if (l.ReturnDate) throw new HttpsError('failed-precondition', 'The return was recorded on ' + l.ReturnDate + '.');
  await requireNoSettlement(l.EmployeeID, l.EmployeeName);
  const ret = text(d.returnDate, 10);
  if (!isDate(ret)) bad('Enter the day the employee was back at work.');
  if (ret <= l.FromDate) bad('The return is after the first day of leave (to undo the whole leave before it starts, cancel it).');
  if (ret > today()) bad('The return date can\'t be in the future.');
  const cal = await calendarFor(Object.assign({ CompanyID: l.CompanyID }, (await EMPLOYEES().doc(l.EmployeeID).get()).data()));
  const expected = l.ExpectedReturn || nextWorkingDay(cal, l.ToDate);
  let lines = (l.Lines || []).filter(x => live(x) && !x.Absence), late = [];
  if (ret <= l.ToDate) lines = lines.filter(x => x.Date < ret);
  else if (ret > expected) late = countedDays(cal, expected, addDay(ret, -1), 'Working');
  const returned = round2((l.Lines || []).filter(x => live(x) && !x.Absence).reduce((s, x) => s + x.Fraction, 0) - lines.reduce((s, x) => s + x.Fraction, 0));
  const out = { returnDate: ret, expected, early: returned > 0, daysReturned: returned, lateDays: late.length, lateDates: late };
  if (d.confirm !== true) return Object.assign({ success: true, preview: true }, out);
  const all = withPayMonths(lines.concat(late.map(dt => ({ Date: dt, Fraction: 1, Code: 'ABSENT', Pay: 'Unpaid', Percent: 0, Elements: [], Absence: true, Late: true }))),
    l.Lines, await lockedMonths(l.CompanyID));
  const kept = all.filter(live);
  const names = await elementNames();
  const now = new Date().toISOString();
  const note = returned > 0 ? 'early: ' + dayWord(returned) + ' returned' : late.length ? 'late: ' + dayWord(late.length) + ' unpaid absence' : 'on time';
  await LEAVES().doc(l.LeaveID).update({
    ReturnDate: ret, EffectiveTo: addDay(ret, -1), Lines: all, Days: round2(kept.filter(x => !x.Absence).reduce((s, x) => s + x.Fraction, 0)),
    TypeDays: round2(kept.filter(x => !x.Absence && !x.Split).reduce((s, x) => s + x.Fraction, 0)), UnpaidDays: round2(kept.filter(x => x.Split).reduce((s, x) => s + x.Fraction, 0)),
    LateDays: late.length, Summary: summarize(kept, l.LeaveTypeName, names), UpdatedAt: now,
    History: (l.History || []).concat([histEntry('Returned ' + ret, user, note)])
  });
  return Object.assign({ success: true }, out);
});

// ---------- balances ----------

async function balancesFor(emp, asOf) {
  const types = (await leaveTypes()).filter(t => t.Kind === 'Leave');
  const leaves = await leavesOf(emp.EmployeeID);
  const grade = await gradeLevel(emp);
  const year = asOf.slice(0, 4);
  const out = [];
  for (const t of types) {
    if (t.UsesBalance) out.push(Object.assign({ LeaveTypeID: t.LeaveTypeID, Code: t.Code, Name: t.Name, UsesBalance: true }, await balanceOf(emp, t, asOf, null, { leaves, grade })));
    else {
      const used = leaves.filter(l => COUNTING.includes(l.Status)).reduce((s, l) => s + (l.Lines || []).filter(x => live(x) && x.Code === t.Code && x.Date.slice(0, 4) === year).reduce((a, x) => a + x.Fraction, 0), 0);
      if (used || t.MaxPerYear != null) out.push({ LeaveTypeID: t.LeaveTypeID, Code: t.Code, Name: t.Name, UsesBalance: false, UsedThisYear: round2(used), MaxPerYear: t.MaxPerYear });
    }
  }
  return { balances: out, leaves, grade };
}

// The leave card on the employee record.
exports.getLeaveBalances = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  const emp = await loadEmployee(user, d.employeeId);
  const asOf = isDate(text(d.asOf, 10)) ? text(d.asOf, 10) : today();
  const { balances, leaves, grade } = await balancesFor(emp, asOf);
  const adjustments = docs(await ADJUSTMENTS().where('EmployeeID', '==', emp.EmployeeID).get()).sort((a, b) => String(b.Date).localeCompare(String(a.Date)))
    .map(a => ({ Date: a.Date, LeaveTypeID: a.LeaveTypeID, Days: a.Days, Reason: a.Reason, ByName: a.ByName }));
  return {
    asOf, balances, adjustments, grade: grade ? grade.Code : '', own: emp.LeaveOverrides || {},
    leaves: leaves.slice().sort((a, b) => String(b.FromDate).localeCompare(String(a.FromDate)))
      .map(l => ({ LeaveID: l.LeaveID, LeaveNumber: l.LeaveNumber || '', LeaveTypeName: l.LeaveTypeName, FromDate: l.FromDate, ToDate: l.EffectiveTo || l.ToDate, Days: l.Days, UnpaidDays: l.UnpaidDays || 0, Status: l.Status })),
    canDraft: await can(user, 'draft'), canPost: await can(user, 'post')
  };
});

// An employee's own entitlement for a type that uses a balance (Payroll
// step 5, decision 31): the days a year and whether its days count
// calendar or working days, instead of the grade and service rules.
// Months already locked keep their accrual.
exports.setLeaveEntitlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};
  const emp = await loadEmployee(user, d.employeeId);
  const type = await typeById(d.leaveTypeId);
  if (!type.UsesBalance) bad(type.Name + ' doesn\'t use a balance.');
  const own = Object.assign({}, emp.LeaveOverrides || {});
  const clear = d.daysPerYear === '' || d.daysPerYear == null;
  if (clear) delete own[type.LeaveTypeID];
  else {
    const days = Number(d.daysPerYear);
    if (!(days >= 0 && days <= 365)) bad('The days a year are 0 to 365.');
    const counts = text(d.counts, 10);
    if (counts && !['Calendar', 'Working'].includes(counts)) bad('Days count as calendar or working days.');
    own[type.LeaveTypeID] = { DaysPerYear: round2(days), Counts: counts || '' };
  }
  await EMPLOYEES().doc(emp.EmployeeID).update({ LeaveOverrides: own });
  await firestore.collection('employeeHistory').add({ EmployeeID: emp.EmployeeID, Action: 'Leave entitlement', Changes: [{ Field: 'LeaveOverrides', Label: type.Name + ' entitlement',
    From: '', To: clear ? 'the grade rules' : own[type.LeaveTypeID].DaysPerYear + ' days a year' + (own[type.LeaveTypeID].Counts ? ' (' + own[type.LeaveTypeID].Counts.toLowerCase() + ' days)' : '') }],
    Reason: text(d.reason, 300), By: user.uid, ByName: user.profile.fullName || user.profile.username || user.uid, At: new Date().toISOString() });
  return { success: true };
});

// A correction to a balance, with its reason (also how a wrong opening
// balance is fixed).
exports.adjustLeaveBalance = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};
  const emp = await loadEmployee(user, d.employeeId);
  const type = await typeById(d.leaveTypeId);
  if (!type.UsesBalance) bad(type.Name + ' doesn\'t use a balance.');
  const days = Number(d.days);
  if (!days || Math.round(days * 2) !== days * 2 || Math.abs(days) > 366) bad('Enter the days to add (or, with a minus, take away), in half days.');
  const date = text(d.date, 10) || today();
  if (!isDate(date)) bad('Enter the date of the adjustment.');
  const reason = text(d.reason, 500);
  if (!reason) bad('Give the reason for the adjustment.');
  await ADJUSTMENTS().add({ EmployeeID: emp.EmployeeID, CompanyID: emp.CompanyID, LeaveTypeID: type.LeaveTypeID, Date: date, Days: days, Reason: reason,
    By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
  return { success: true };
});

// The opening balance of one employee and type (Master Data Import).
async function saveOpening(user, data) {
  const emp = await loadEmployee(user, data.EmployeeID);
  const type = await typeById(data.LeaveTypeID);
  if (!type.UsesBalance) bad(type.Name + ' doesn\'t use a balance.');
  const days = Number(data.Days);
  if (!(days >= 0) || Math.round(days * 2) !== days * 2) bad('The opening balance is 0 or more, in half days.');
  if (!isDate(data.AsOf)) bad('Enter the date of the balance.');
  if (data.AsOf < emp.JoinDate) bad('The balance date is before the date of joining.');
  const existing = docs(await OPENINGS().where('EmployeeID', '==', emp.EmployeeID).get()).find(o => o.LeaveTypeID === type.LeaveTypeID);
  if (existing) throw new HttpsError('already-exists', emp.FullName + ' already has an opening ' + type.Name + ' balance: correct it with an adjustment.');
  const ref = await OPENINGS().add({ EmployeeID: emp.EmployeeID, CompanyID: emp.CompanyID, LeaveTypeID: type.LeaveTypeID, Days: days, AsOf: data.AsOf, Source: 'Import',
    CreatedAt: new Date().toISOString(), CreatedBy: user.uid });
  return { id: ref.id, code: '' };
}

module.exports.evaluate = evaluate;
module.exports.balanceOf = balanceOf;
module.exports.saveOpening = saveOpening;
module.exports.accrued = accrued;
module.exports.unpaidLines = unpaidLines;
module.exports.leavesOf = leavesOf;
module.exports.gradeLevel = gradeLevel;
module.exports.withPayMonths = withPayMonths;
module.exports.payMonthOf = payMonthOf;
module.exports.live = live;
module.exports.nextMonth = nextMonth;
module.exports.monthEnd = monthEnd;
module.exports.nextDay = d => addDay(d, 1);
