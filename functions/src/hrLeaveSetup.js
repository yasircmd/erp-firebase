// HR: Attendance and Leave Register, step 1: the setup (owner, 2026-10-03;
// docs/modules/HR_LEAVE.md).
//   - Leave Types: code, name, Leave or Duty (business travel: paid as
//     working, not an absence), whether it uses a balance, counts working
//     or calendar days (decision 8), half days, gender, after probation,
//     maximum days per year / per instance, a document after N days, and
//     whether HR confirms the return (decision 7). Nine to start; HR Setup
//     admins add more (owner point 2).
//   - Entitlements (types that use a balance): days per year by grade
//     level and completed years of service, accrued monthly over the
//     calendar year (decision 3); a carry-forward cap, the excess lapses
//     (decision 4). One set for the group (decision 6).
//   - Leave Pay Rules (owner point 3): by grade level and day band (days of
//     that type in the leave year, e.g. sick leave 1-15 full, 16-45 half),
//     pay = Full salary (all fixed earnings), Basic only, Selected elements,
//     or Unpaid, at a %. One set for the group (decision 6).
//   - Working Calendar, per company: the weekend days and the public
//     holidays (ranges). workingDays() counts days for the Leave Register.
// Rights: HR Setup (read: HR Setup or Employees access; change: HR Setup
// write). The calendar is changed only for the user's own companies.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { loadSetup } = require('./hrSetup');
const { addDay, countedDays } = require('./workCalendar');

const onCallOptions = { region: 'us-central1' };
const TYPES = () => firestore.collection('hrLeaveTypes');
const CALENDARS = () => firestore.collection('hrWorkCalendars');
const ELEMENTS = () => firestore.collection('hrPayElements');
const KINDS = ['Leave', 'Duty'];
const COUNTS = ['Working', 'Calendar'];
const GENDERS = ['Any', 'Female', 'Male'];
const PAY = ['Full', 'Basic', 'Elements', 'Unpaid'];
const PAY_LABEL = { Full: 'Full salary', Basic: 'Basic only', Elements: 'Selected elements', Unpaid: 'Unpaid' };
const DEFAULT_WEEKEND = [0, 6]; // Sunday and Saturday (UAE since 2022)
const ALL = [{ LevelFrom: 1, LevelTo: 99 }];
// [code, name, settings, entitlement rows, carry cap, pay rules]. A start
// only: the owner edits them (e.g. Annual at lower grades on basic only).
const START = [
  ['ANNUAL', 'Annual Leave', { UsesBalance: true, Counts: 'Working', HalfDays: true, AfterProbation: true, ConfirmReturn: true },
    [{ LevelFrom: 1, LevelTo: 99, ServiceFrom: 0, ServiceTo: null, DaysPerYear: 30 }], 30,
    [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: null, Pay: 'Full', Percent: 100 }]],
  ['SICK', 'Sick Leave', { Counts: 'Calendar', HalfDays: true, MaxPerYear: 90, DocumentAfterDays: 1 }, null, null,
    [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: 15, Pay: 'Full', Percent: 100 }, { LevelFrom: 1, LevelTo: 99, DayFrom: 16, DayTo: 45, Pay: 'Full', Percent: 50 },
      { LevelFrom: 1, LevelTo: 99, DayFrom: 46, DayTo: null, Pay: 'Unpaid', Percent: 0 }]],
  ['UNPAID', 'Unpaid Leave', { Counts: 'Calendar', HalfDays: true }, null, null, [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: null, Pay: 'Unpaid', Percent: 0 }]],
  ['MATERNITY', 'Maternity Leave', { Counts: 'Calendar', Gender: 'Female', MaxPerInstance: 60, ConfirmReturn: true }, null, null,
    [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: 45, Pay: 'Full', Percent: 100 }, { LevelFrom: 1, LevelTo: 99, DayFrom: 46, DayTo: null, Pay: 'Full', Percent: 50 }]],
  ['PATERNITY', 'Paternity Leave', { Counts: 'Working', Gender: 'Male', MaxPerYear: 5 }, null, null, [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: null, Pay: 'Full', Percent: 100 }]],
  ['TRAVEL', 'Business Travel', { Kind: 'Duty', Counts: 'Calendar', HalfDays: true }, null, null, null],
  ['HAJJ', 'Hajj Leave', { Counts: 'Calendar', AfterProbation: true, MaxPerInstance: 30 }, null, null, [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: null, Pay: 'Unpaid', Percent: 0 }]],
  ['COMPASSIONATE', 'Compassionate Leave', { Counts: 'Calendar', MaxPerInstance: 5 }, null, null, [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: null, Pay: 'Full', Percent: 100 }]],
  ['STUDY', 'Study Leave', { Counts: 'Working', MaxPerYear: 10 }, null, null, [{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: null, Pay: 'Full', Percent: 100 }]]
];

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const norm = v => text(v).toLowerCase();
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
// A whole number, or null when blank.
function whole(v, label, min, max) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(label + ' is a whole number from ' + min + ' to ' + max + '.');
  return n;
}
function defaults(s) {
  return Object.assign({ Kind: 'Leave', UsesBalance: false, Counts: 'Calendar', HalfDays: false, Gender: 'Any', AfterProbation: false,
    MaxPerYear: null, MaxPerInstance: null, DocumentAfterDays: null, ConfirmReturn: false }, s);
}

async function canSetup(user, cap) { return moduleHasCapability('HRSETUP', cap, user.profile.role); }
async function requireWrite(user) {
  if (!(await canSetup(user, 'write'))) throw new HttpsError('permission-denied', 'You do not have permission to change HR Setup.');
}
async function requireRead(user) {
  if (await canSetup(user, 'access')) return;
  if (await moduleHasCapability('EMPLOYEES', 'access', user.profile.role)) return;
  throw new HttpsError('permission-denied', 'You do not have access to HR Setup.');
}

async function leaveTypes() {
  let snap = await TYPES().get();
  if (snap.empty) {
    const batch = firestore.batch();
    START.forEach(([code, name, s, ent, cap, rules], i) => batch.set(TYPES().doc('lt-' + code.toLowerCase()), Object.assign(defaults(s), {
      Code: code, Name: name, Active: true, Sort: i + 1, Entitlements: ent || [], CarryForwardCap: cap == null ? null : cap, PayRules: rules || []
    })));
    await batch.commit();
    snap = await TYPES().get();
  }
  return snap.docs.map(d => Object.assign({ LeaveTypeID: d.id }, d.data())).sort((a, b) => (a.Sort || 999) - (b.Sort || 999) || a.Code.localeCompare(b.Code));
}

// ---------- the checks ----------

// [from, to] ranges, to null = no end.
const overlaps = (a1, a2, b1, b2) => a1 <= (b2 == null ? Infinity : b2) && b1 <= (a2 == null ? Infinity : a2);
// The gaps in [start, ∞) left by ranges (sorted, may overlap-free).
function gaps(ranges, start) {
  const out = []; let next = start;
  ranges.slice().sort((a, b) => a[0] - b[0]).forEach(([f, t]) => {
    if (next === null) return;
    if (f > next) out.push([next, f - 1]);
    next = t == null ? null : Math.max(next, t + 1);
  });
  if (next !== null) out.push([next, null]);
  return out;
}
const span = ([f, t], unit) => t == null ? unit + ' ' + f + ' onward' : f === t ? unit + ' ' + f : unit + 's ' + f + '–' + t;
// Rules not covering a grade (by its level) leave it without an
// entitlement or a pay rule: listed as warnings on the setup.
function coverage(rows, grades, fromKey, toKey, start, unit) {
  const out = [];
  grades.filter(g => g.Active !== false).forEach(g => {
    const mine = rows.filter(r => r.LevelFrom <= g.Level && g.Level <= r.LevelTo).map(r => [r[fromKey], r[toKey]]);
    if (!mine.length) return out.push(g.Code + ' (level ' + g.Level + '): no rule.');
    gaps(mine, start).forEach(gap => out.push(g.Code + ' (level ' + g.Level + '): no rule for ' + span(gap, unit) + '.'));
  });
  return out;
}
function warningsFor(t, grades) {
  const w = {};
  if (t.Kind === 'Leave' && t.UsesBalance) w.entitlements = coverage(t.Entitlements || [], grades, 'ServiceFrom', 'ServiceTo', 0, 'service year');
  if (t.Kind === 'Leave') w.payRules = coverage(t.PayRules || [], grades, 'DayFrom', 'DayTo', 1, 'day');
  return w;
}
function levelRange(r, i) {
  const from = whole(r.LevelFrom, 'Row ' + i + ': the grade level from', 1, 99), to = whole(r.LevelTo, 'Row ' + i + ': the grade level to', 1, 99);
  if (from == null || to == null) bad('Row ' + i + ': enter the grade levels from and to.');
  if (from > to) bad('Row ' + i + ': the grade levels run from the lower to the higher.');
  return [from, to];
}

function cleanEntitlements(rows) {
  if (!Array.isArray(rows) || !rows.length) bad('Add at least one row.');
  if (rows.length > 50) bad('At most 50 rows.');
  const out = rows.map((r, n) => {
    const i = n + 1;
    const [LevelFrom, LevelTo] = levelRange(r, i);
    const ServiceFrom = whole(r.ServiceFrom, 'Row ' + i + ': service from', 0, 60) || 0;
    const ServiceTo = whole(r.ServiceTo, 'Row ' + i + ': service to', 0, 60);
    if (ServiceTo != null && ServiceTo < ServiceFrom) bad('Row ' + i + ': the service years run from the lower to the higher.');
    const days = Number(r.DaysPerYear);
    if (!(days > 0 && days <= 366) || Math.round(days * 2) !== days * 2) bad('Row ' + i + ': days a year is more than 0, in half days.');
    return { LevelFrom, LevelTo, ServiceFrom, ServiceTo, DaysPerYear: days };
  });
  out.forEach((a, x) => out.forEach((b, y) => {
    if (y > x && overlaps(a.LevelFrom, a.LevelTo, b.LevelFrom, b.LevelTo) && overlaps(a.ServiceFrom, a.ServiceTo, b.ServiceFrom, b.ServiceTo)) {
      bad('Rows ' + (x + 1) + ' and ' + (y + 1) + ' overlap: a grade level and service year can match only one row.');
    }
  }));
  return out;
}
function cleanPayRules(rows, fixedEarnings) {
  if (!Array.isArray(rows) || !rows.length) bad('Add at least one row.');
  if (rows.length > 50) bad('At most 50 rows.');
  const out = rows.map((r, n) => {
    const i = n + 1;
    const [LevelFrom, LevelTo] = levelRange(r, i);
    const DayFrom = whole(r.DayFrom, 'Row ' + i + ': day from', 1, 366) || 1;
    const DayTo = whole(r.DayTo, 'Row ' + i + ': day to', 1, 366);
    if (DayTo != null && DayTo < DayFrom) bad('Row ' + i + ': the days run from the lower to the higher.');
    const Pay = text(r.Pay, 20);
    if (!PAY.includes(Pay)) bad('Row ' + i + ': choose how the days are paid.');
    let Percent = 0, Elements = [];
    if (Pay !== 'Unpaid') {
      Percent = Number(r.Percent);
      if (!(Percent > 0 && Percent <= 100)) bad('Row ' + i + ': the % paid is more than 0 and at most 100 (or choose Unpaid).');
      Percent = Math.round(Percent * 100) / 100;
    }
    if (Pay === 'Elements') {
      Elements = [...new Set((Array.isArray(r.Elements) ? r.Elements : []).map(e => text(e, 80)))];
      if (!Elements.length) bad('Row ' + i + ': tick the pay elements paid.');
      Elements.forEach(id => { if (!fixedEarnings.some(e => e.ElementID === id)) bad('Row ' + i + ': only fixed earnings can be paid during leave.'); });
    }
    return { LevelFrom, LevelTo, DayFrom, DayTo, Pay, Percent, Elements };
  });
  out.forEach((a, x) => out.forEach((b, y) => {
    if (y > x && overlaps(a.LevelFrom, a.LevelTo, b.LevelFrom, b.LevelTo) && overlaps(a.DayFrom, a.DayTo, b.DayFrom, b.DayTo)) {
      bad('Rows ' + (x + 1) + ' and ' + (y + 1) + ' overlap: a grade level and day can match only one row.');
    }
  }));
  return out;
}
async function fixedEarnings() {
  return (await ELEMENTS().get()).docs.map(d => Object.assign({ ElementID: d.id }, d.data())).filter(e => e.Kind === 'Earning' && e.Nature === 'Fixed');
}

// ---------- callables: leave types, entitlements, pay rules ----------

async function loadLeaveSetup() {
  const [types, setup] = await Promise.all([leaveTypes(), loadSetup()]);
  types.forEach(t => { t.Warnings = warningsFor(t, setup.grades); });
  return types;
}

exports.getLeaveSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireRead(user);
  return { leaveTypes: await loadLeaveSetup(), canWrite: await canSetup(user, 'write'), kinds: KINDS, counts: COUNTS, genders: GENDERS, pay: PAY.map(p => ({ value: p, label: PAY_LABEL[p] })) };
});

exports.saveLeaveType = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const t = (request.data || {}).leaveType || {};
  const out = {
    Code: text(t.Code, 20).toUpperCase(), Name: text(t.Name, 80), Kind: text(t.Kind, 10), UsesBalance: t.UsesBalance === true,
    Counts: text(t.Counts, 10), HalfDays: t.HalfDays === true, Gender: text(t.Gender, 10) || 'Any', AfterProbation: t.AfterProbation === true,
    MaxPerYear: whole(t.MaxPerYear, 'Maximum days a year', 1, 366), MaxPerInstance: whole(t.MaxPerInstance, 'Maximum days at a time', 1, 366),
    DocumentAfterDays: whole(t.DocumentAfterDays, 'Document required after', 0, 366), ConfirmReturn: t.ConfirmReturn === true, Active: t.Active !== false
  };
  if (!/^[A-Z0-9_-]{1,20}$/.test(out.Code)) bad('The code is letters, digits, - or _ (up to 20).');
  if (!out.Name) bad('Enter the leave type\'s name.');
  if (!KINDS.includes(out.Kind)) bad('A type is Leave or Duty (e.g. business travel, paid as working).');
  if (!COUNTS.includes(out.Counts)) bad('Choose whether it counts working days or calendar days.');
  if (!GENDERS.includes(out.Gender)) bad('Unknown gender.');
  if (out.Kind === 'Duty') out.UsesBalance = false;
  if (out.MaxPerYear != null && out.MaxPerInstance != null && out.MaxPerInstance > out.MaxPerYear) bad('The maximum at a time can\'t be more than the maximum a year.');
  const list = await leaveTypes();
  if (list.some(x => x.LeaveTypeID !== t.LeaveTypeID && x.Code === out.Code)) throw new HttpsError('already-exists', 'Code "' + out.Code + '" is already in use.');
  if (list.some(x => x.LeaveTypeID !== t.LeaveTypeID && norm(x.Name) === norm(out.Name))) throw new HttpsError('already-exists', 'There is already a leave type "' + out.Name + '".');
  const cur = t.LeaveTypeID ? list.find(x => x.LeaveTypeID === t.LeaveTypeID) : null;
  if (t.LeaveTypeID && !cur) throw new HttpsError('not-found', 'Leave type not found.');
  const ref = cur ? TYPES().doc(cur.LeaveTypeID) : TYPES().doc();
  // Entitlements and pay rules are saved on their own; a new type starts
  // without them (its warnings say so).
  await ref.set(Object.assign(out, cur ? {} : { Entitlements: [], CarryForwardCap: null, PayRules: [] }, { Sort: cur ? cur.Sort || 0 : list.length + 1 }), { merge: true });
  return { success: true, leaveTypeId: ref.id };
});

async function typeFor(id) {
  const t = (await leaveTypes()).find(x => x.LeaveTypeID === text(id, 80));
  if (!t) throw new HttpsError('not-found', 'Leave type not found.');
  return t;
}

exports.saveLeaveEntitlements = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const d = request.data || {};
  const t = await typeFor(d.leaveTypeId);
  if (t.Kind !== 'Leave' || !t.UsesBalance) bad(t.Name + ' doesn\'t use a balance: it has no entitlement.');
  const rows = cleanEntitlements(d.rows);
  const cap = whole(d.carryForwardCap, 'The carry-forward cap', 0, 366);
  if (cap == null) bad('Enter the most days that carry into the next year (0 for none); the rest lapses.');
  await TYPES().doc(t.LeaveTypeID).update({ Entitlements: rows, CarryForwardCap: cap });
  const setup = await loadSetup();
  return { success: true, warnings: warningsFor(Object.assign({}, t, { Entitlements: rows }), setup.grades).entitlements };
});

exports.saveLeavePayRules = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const d = request.data || {};
  const t = await typeFor(d.leaveTypeId);
  if (t.Kind !== 'Leave') bad(t.Name + ' is duty, paid as working: it has no leave pay rules.');
  const rows = cleanPayRules(d.rows, await fixedEarnings());
  await TYPES().doc(t.LeaveTypeID).update({ PayRules: rows });
  const setup = await loadSetup();
  return { success: true, warnings: warningsFor(Object.assign({}, t, { PayRules: rows }), setup.grades).payRules };
});

// ---------- working calendar ----------

async function calendar(companyId) {
  const snap = await CALENDARS().doc(companyId).get();
  const c = snap.exists ? snap.data() : {};
  return { Weekend: Array.isArray(c.Weekend) ? c.Weekend : DEFAULT_WEEKEND.slice(), Holidays: Array.isArray(c.Holidays) ? c.Holidays : [] };
}
async function workingDays(companyId, from, to, counts) { return countedDays(await calendar(companyId), from, to, counts || 'Working'); }

async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}
function yearOf(v) {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) bad('Choose a year.');
  return y;
}

exports.getWorkCalendar = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireRead(user);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const year = yearOf(d.year);
  const cal = await calendar(co);
  const inYear = h => h.From.slice(0, 4) === String(year) || h.To.slice(0, 4) === String(year);
  return {
    companyId: co, year, weekend: cal.Weekend,
    holidays: cal.Holidays.filter(inYear).sort((a, b) => a.From.localeCompare(b.From)),
    lastYearHolidays: cal.Holidays.filter(h => h.From.slice(0, 4) === String(year - 1)).sort((a, b) => a.From.localeCompare(b.From)),
    workingDays: countedDays(cal, year + '-01-01', year + '-12-31', 'Working').length,
    canWrite: await canSetup(user, 'write')
  };
});

exports.saveWorkCalendar = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const year = yearOf(d.year);
  const weekend = [...new Set((Array.isArray(d.weekend) ? d.weekend : []).map(Number))].sort();
  if (weekend.some(n => !Number.isInteger(n) || n < 0 || n > 6)) bad('Unknown weekend day.');
  if (weekend.length > 3) bad('At most three weekend days.');
  const rows = Array.isArray(d.holidays) ? d.holidays : [];
  if (rows.length > 60) bad('At most 60 holidays a year.');
  const holidays = rows.map((h, n) => {
    const i = n + 1, From = text(h.From, 10), To = text(h.To, 10) || From, Name = text(h.Name, 80);
    if (!isDate(From) || !isDate(To)) bad('Holiday ' + i + ': enter a real date.');
    if (To < From) bad('Holiday ' + i + ': the end is before the start.');
    if (From.slice(0, 4) !== String(year)) bad('Holiday ' + i + ': it starts outside ' + year + '.');
    if (addDay(From, 14) < To) bad('Holiday ' + i + ': a holiday is at most 15 days.');
    if (!Name) bad('Holiday ' + i + ': enter its name.');
    return { From, To, Name };
  }).sort((a, b) => a.From.localeCompare(b.From));
  const cal = await calendar(co);
  // This year's holidays replace the ones saved for it; other years stay.
  const all = cal.Holidays.filter(h => h.From.slice(0, 4) !== String(year)).concat(holidays).sort((a, b) => a.From.localeCompare(b.From));
  all.forEach((h, x) => { if (x && all[x - 1].To >= h.From) bad('"' + all[x - 1].Name + '" (' + all[x - 1].From + ') and "' + h.Name + '" (' + h.From + ') overlap.'); });
  await CALENDARS().doc(co).set({ Weekend: weekend, Holidays: all, UpdatedAt: new Date().toISOString(), UpdatedBy: user.uid });
  return { success: true, workingDays: countedDays({ Weekend: weekend, Holidays: all }, year + '-01-01', year + '-12-31', 'Working').length };
});

module.exports.leaveTypes = leaveTypes;
module.exports.loadLeaveSetup = loadLeaveSetup;
module.exports.calendar = calendar;
module.exports.countedDays = countedDays;
module.exports.workingDays = workingDays;
module.exports.coverage = coverage;
module.exports.PAY_LABEL = PAY_LABEL;
