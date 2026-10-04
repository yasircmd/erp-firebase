// HR: Pay Elements and compensation (owner, 2026-10-03;
// docs/modules/HR_EMPLOYEES.md, step 3).
//   - Pay Elements (decision 4: built now, the first piece of Payroll):
//     code, name, earning or deduction, fixed (a monthly amount on the
//     employee) or variable (bonus, commission: agreed terms on the record,
//     decision 4b; actual amounts per payroll run). One fixed earning is
//     the Basic, which the grade's pay band is checked against.
//   - Compensation: effective-dated versions; a change never overwrites
//     (owner point 6). The first is set directly; later changes come from
//     an approved Employee Change (step 4, decision 9-10), and a mistake is
//     fixed with a Correction (HR Setup admins, with a reason; decision 13).
//   - The band (decision 5): a Basic outside the company's band for the
//     employee's grade is allowed, with a warning.
//   - Seeing and setting pay needs the Employees "sensitive" right
//     (decision 7), setting it "write" too.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { FieldValue } = require('firebase-admin/firestore');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');

const onCallOptions = { region: 'us-central1' };
const ELEMENTS = () => firestore.collection('hrPayElements');
const COMP = () => firestore.collection('employeeCompensation');
const EMPLOYEES = () => firestore.collection('employees');
const HISTORY = () => firestore.collection('employeeHistory');
const KINDS = ['Earning', 'Deduction'];
const NATURES = ['Fixed', 'Variable'];
const BASES = ['Amount', 'Percent'];
const FREQUENCIES = ['Monthly', 'Quarterly', 'Half-yearly', 'Annual', 'One-time'];
const START = [
  ['BASIC', 'Basic Salary', 'Earning', 'Fixed', true], ['HRA', 'Housing Allowance', 'Earning', 'Fixed', false],
  ['TRANS', 'Transport Allowance', 'Earning', 'Fixed', false], ['OTHER', 'Other Allowance', 'Earning', 'Fixed', false],
  ['BONUS', 'Bonus', 'Earning', 'Variable', false], ['COMM', 'Commission', 'Earning', 'Variable', false]
];

const SYSTEM_ELEMENTS = require('./payrollCalc').SYSTEM;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const norm = v => text(v).toLowerCase();
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const round2 = n => Math.round(n * 100) / 100;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- Pay Elements ----------

// Every element, the system ones included: the deductions for leave and
// absence a payroll run makes (docs/modules/HR_PAYROLL.md, decision 13),
// which have a GL account but aren't entered or edited.
async function allElements() {
  let snap = await ELEMENTS().get();
  const have = snap.docs.map(d => d.data());
  const batch = firestore.batch();
  let n = 0;
  if (!have.some(e => !e.System)) {
    START.forEach(([code, name, kind, nature, basic], i) => { n++; batch.set(ELEMENTS().doc('pe-' + code.toLowerCase()),
      { Code: code, Name: name, Kind: kind, Nature: nature, IsBasic: basic, Active: true, Sort: i + 1 }); });
  }
  Object.entries(SYSTEM_ELEMENTS).forEach(([code, x], i) => {
    if (have.some(e => e.System && e.Code === code)) return;
    n++;
    batch.set(ELEMENTS().doc('sys-' + code.toLowerCase()), { Code: code, Name: x.Name, Kind: 'Deduction', Nature: 'Variable', IsBasic: false, Active: true, System: true, Sort: 900 + i });
  });
  if (n) { await batch.commit(); snap = await ELEMENTS().get(); }
  return snap.docs.map(d => Object.assign({ ElementID: d.id }, d.data())).sort((a, b) => (a.Sort || 999) - (b.Sort || 999) || a.Code.localeCompare(b.Code));
}
// The elements people set up and use (not the system ones).
async function elements() { return (await allElements()).filter(e => !e.System); }

async function canSetup(user, cap) { return moduleHasCapability('HRSETUP', cap, user.profile.role); }
// The pay elements are set up in Payroll Setup (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, step 4); HR Setup (leave pay rules) and
// Employees (compensation) read them.
async function canPayrollSetup(user, cap) { return moduleHasCapability('PAYROLLSETUP', cap, user.profile.role); }

exports.getPayElements = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const ok = (await canPayrollSetup(user, 'access')) || (await canSetup(user, 'access')) || (await moduleHasCapability('EMPLOYEES', 'access', user.profile.role));
  if (!ok) throw new HttpsError('permission-denied', 'You do not have access to Payroll Setup.');
  return { elements: await elements(), canWrite: await canPayrollSetup(user, 'write'), kinds: KINDS, natures: NATURES, frequencies: FREQUENCIES };
});

exports.savePayElement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await canPayrollSetup(user, 'write'))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
  const e = (request.data || {}).element || {};
  const out = { Code: text(e.Code, 20).toUpperCase(), Name: text(e.Name, 80), Kind: text(e.Kind, 20), Nature: text(e.Nature, 20), IsBasic: e.IsBasic === true, Active: e.Active !== false };
  if (!/^[A-Z0-9_-]{1,20}$/.test(out.Code)) throw new HttpsError('invalid-argument', 'The code is letters, digits, - or _ (up to 20).');
  if (!out.Name) throw new HttpsError('invalid-argument', 'Enter the element\'s name.');
  if (!KINDS.includes(out.Kind)) throw new HttpsError('invalid-argument', 'An element is an Earning or a Deduction.');
  if (!NATURES.includes(out.Nature)) throw new HttpsError('invalid-argument', 'An element is Fixed (a monthly amount) or Variable (bonus, commission).');
  if (out.IsBasic && (out.Kind !== 'Earning' || out.Nature !== 'Fixed')) throw new HttpsError('invalid-argument', 'The Basic is a fixed earning.');
  const list = await elements();
  if (SYSTEM_ELEMENTS[out.Code]) throw new HttpsError('already-exists', 'Code "' + out.Code + '" is kept for the payroll\'s own deductions.');
  if (list.some(x => x.ElementID !== e.ElementID && x.Code === out.Code)) throw new HttpsError('already-exists', 'Code "' + out.Code + '" is already in use.');
  if (list.some(x => x.ElementID !== e.ElementID && norm(x.Name) === norm(out.Name))) throw new HttpsError('already-exists', 'There is already an element "' + out.Name + '".');
  const cur = e.ElementID ? list.find(x => x.ElementID === e.ElementID) : null;
  if (e.ElementID && !cur) throw new HttpsError('not-found', 'Pay element not found.');
  if (cur && (cur.Kind !== out.Kind || cur.Nature !== out.Nature)) {
    // Compensation already holding it would no longer fit.
    const used = (await COMP().get()).docs.some(d => (d.data().Lines || []).concat(d.data().Terms || []).some(l => l.ElementID === cur.ElementID));
    if (used) throw new HttpsError('failed-precondition', '"' + cur.Name + '" is used in employees\' pay: its kind and nature can\'t change. Add a new element instead.');
  }
  const batch = firestore.batch();
  // One Basic only: marking this one unmarks the other.
  if (out.IsBasic) list.filter(x => x.IsBasic && x.ElementID !== e.ElementID).forEach(x => batch.update(ELEMENTS().doc(x.ElementID), { IsBasic: false }));
  const ref = cur ? ELEMENTS().doc(cur.ElementID) : ELEMENTS().doc();
  // Merged: the payroll settings (GL account, prorating, overtime; payrollSetup.js)
  // stay, less those that no longer fit a new kind or nature (back to their defaults).
  const drop = {};
  if (cur && (cur.Kind !== out.Kind || cur.Nature !== out.Nature)) {
    if (out.Kind !== 'Earning' || out.Nature !== 'Variable') Object.assign(drop, { Category: FieldValue.delete(), Overtime: FieldValue.delete() });
    drop.InGross = FieldValue.delete(); // its default follows both
    if (cur.Nature !== out.Nature) drop.Prorated = FieldValue.delete();
    if (cur.Kind !== out.Kind) Object.assign(drop, { GLAccountID: FieldValue.delete(), GLByCompany: FieldValue.delete() });
  }
  batch.set(ref, Object.assign(out, { Sort: cur ? cur.Sort || 0 : list.length + 1 }, drop), { merge: true });
  await batch.commit();
  return { success: true, elementId: ref.id };
});

// ---------- compensation ----------

const can = (user, cap) => moduleHasCapability('EMPLOYEES', cap, user.profile.role);
async function rights(user) {
  const [access, write, sensitive, correct] = await Promise.all([can(user, 'access'), can(user, 'write'), can(user, 'sensitive'), canSetup(user, 'write')]);
  return { access, write, sensitive, correct };
}
async function loadEmployee(user, id) {
  const snap = await EMPLOYEES().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Employee not found.');
  const e = snap.data();
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return Object.assign({ EmployeeID: snap.id }, e);
}
async function versions(employeeId) {
  return (await COMP().where('EmployeeID', '==', employeeId).get()).docs.map(d => Object.assign({ VersionID: d.id }, d.data()))
    .sort((a, b) => String(b.EffectiveFrom).localeCompare(String(a.EffectiveFrom)) || String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
}
// The version in force on a date: the latest one from on or before it.
function inForce(list, date) {
  return list.find(v => v.Status === 'Active' && v.EffectiveFrom <= date) || null;
}
async function band(emp) {
  const g = emp.GradeID ? (await firestore.collection('hrGrades').doc(emp.GradeID).get()).data() : null;
  const b = g && (g.Bands || {})[emp.CompanyID];
  return b ? { GradeCode: g.Code, Min: b.Min, Mid: b.Mid, Max: b.Max } : (g ? { GradeCode: g.Code } : null);
}
function bandWarning(basic, b) {
  if (basic == null || !b || b.Min == null) return '';
  if (basic < b.Min) return 'The basic ' + money(basic) + ' is below the ' + b.GradeCode + ' band (minimum ' + money(b.Min) + ').';
  if (basic > b.Max) return 'The basic ' + money(basic) + ' is above the ' + b.GradeCode + ' band (maximum ' + money(b.Max) + ').';
  return '';
}

// A version's lines and terms, checked against the pay elements.
async function clean(input) {
  const d = input || {};
  const list = await elements();
  const byId = Object.fromEntries(list.map(x => [x.ElementID, x]));
  const lines = [];
  for (const l of d.Lines || []) {
    if (l.Amount === '' || l.Amount == null) continue;
    const el = byId[text(l.ElementID, 80)];
    if (!el) throw new HttpsError('invalid-argument', 'Pay element not found.');
    if (el.Nature !== 'Fixed') throw new HttpsError('invalid-argument', el.Name + ' is variable: enter it as agreed terms.');
    const amount = Number(String(l.Amount).replace(/,/g, ''));
    if (!isFinite(amount) || amount < 0) throw new HttpsError('invalid-argument', 'The ' + el.Name + ' amount must be 0 or more.');
    if (lines.some(x => x.ElementID === el.ElementID)) throw new HttpsError('invalid-argument', el.Name + ' is entered twice.');
    if (!el.Active) throw new HttpsError('invalid-argument', 'The pay element "' + el.Name + '" is no longer in use.');
    lines.push({ ElementID: el.ElementID, Code: el.Code, Name: el.Name, Kind: el.Kind, IsBasic: Boolean(el.IsBasic), Amount: round2(amount) });
  }
  const terms = [];
  for (const t of d.Terms || []) {
    if ((t.Value === '' || t.Value == null) && !text(t.Notes)) continue;
    const el = byId[text(t.ElementID, 80)];
    if (!el) throw new HttpsError('invalid-argument', 'Pay element not found.');
    if (el.Nature !== 'Variable') throw new HttpsError('invalid-argument', el.Name + ' is fixed: enter it as a monthly amount.');
    const basis = text(t.Basis, 10) || 'Amount';
    const value = Number(String(t.Value == null ? '' : t.Value).replace(/,/g, ''));
    if (!BASES.includes(basis)) throw new HttpsError('invalid-argument', 'A term is an amount or a %.');
    if (!isFinite(value) || value < 0 || (basis === 'Percent' && value > 100)) throw new HttpsError('invalid-argument', 'The ' + el.Name + ' term must be ' + (basis === 'Percent' ? 'a % from 0 to 100.' : 'an amount, 0 or more.'));
    const frequency = text(t.Frequency, 20) || 'Annual';
    if (!FREQUENCIES.includes(frequency)) throw new HttpsError('invalid-argument', 'Unknown frequency "' + frequency + '".');
    terms.push({ ElementID: el.ElementID, Code: el.Code, Name: el.Name, Basis: basis, Value: round2(value), Of: text(t.Of, 80), Frequency: frequency, Notes: text(t.Notes, 300) });
  }
  if (!lines.length) throw new HttpsError('invalid-argument', 'Enter at least one monthly amount (e.g. the basic salary).');
  const basic = lines.find(l => l.IsBasic);
  const earnings = round2(lines.filter(l => l.Kind === 'Earning').reduce((s, l) => s + l.Amount, 0));
  const deductions = round2(lines.filter(l => l.Kind === 'Deduction').reduce((s, l) => s + l.Amount, 0));
  return { Lines: lines, Terms: terms, Basic: basic ? basic.Amount : null, MonthlyEarnings: earnings, MonthlyDeductions: deductions, MonthlyNet: round2(earnings - deductions) };
}

const describe = v => v.Lines.map(l => l.Code + ' ' + money(l.Amount)).join(', ') + (v.Terms.length ? '; ' + v.Terms.map(t => t.Code + ' ' + (t.Basis === 'Percent' ? t.Value + '%' : money(t.Value)) + (t.Of ? ' ' + t.Of : '') + ' ' + t.Frequency.toLowerCase()).join(', ') : '');
async function log(employeeId, action, detail, user, reason) {
  await HISTORY().add({ EmployeeID: employeeId, Action: action, Changes: [{ Field: 'Compensation', Label: 'Pay', From: '', To: detail, Sensitive: true }], Reason: reason || '',
    By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
}

exports.getCompensation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await rights(user);
  if (!r.access) throw new HttpsError('permission-denied', 'You do not have access to Employees.');
  if (!r.sensitive) throw new HttpsError('permission-denied', 'You do not have the right to see employees\' pay.');
  const emp = await loadEmployee(user, (request.data || {}).employeeId);
  const [list, b, els] = await Promise.all([versions(emp.EmployeeID), band(emp), elements()]);
  const today = todayIn('Asia/Dubai');
  const current = inForce(list, today);
  return {
    versions: list, current, upcoming: list.filter(v => v.Status === 'Active' && v.EffectiveFrom > today), band: b,
    warning: current ? bandWarning(current.Basic, b) : '', elements: els, frequencies: FREQUENCIES,
    canSet: r.write && !list.some(v => v.Status === 'Active'), canCorrect: r.write && r.correct && list.some(v => v.Status === 'Active')
  };
});

// The first compensation (decision 9-10: set directly only when the
// employee has none), or a Correction of the latest (with a reason).
exports.saveCompensation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await rights(user);
  if (!r.access || !r.write || !r.sensitive) throw new HttpsError('permission-denied', 'You do not have the right to set employees\' pay.');
  const d = request.data || {};
  const emp = await loadEmployee(user, d.employeeId);
  const fields = await clean(d.compensation);
  const list = await versions(emp.EmployeeID);
  const active = list.filter(v => v.Status === 'Active');
  const reason = text(d.correction, 300);
  const now = new Date().toISOString();
  const b = await band(emp);
  const warning = bandWarning(fields.Basic, b);
  if (!active.length) {
    if (reason) throw new HttpsError('invalid-argument', 'Nothing to correct: this employee has no pay yet.');
    const from = text((d.compensation || {}).EffectiveFrom, 10) || emp.JoinDate;
    if (!isDate(from)) throw new HttpsError('invalid-argument', 'The effective date is not a valid date.');
    if (from < emp.JoinDate) throw new HttpsError('invalid-argument', 'The pay can\'t start before the date of joining (' + emp.JoinDate + ').');
    const ref = await COMP().add(Object.assign(fields, { EmployeeID: emp.EmployeeID, CompanyID: emp.CompanyID, EffectiveFrom: from, Status: 'Active', Source: 'Initial', Reason: '',
      BandWarning: warning, CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
    await log(emp.EmployeeID, 'Pay set', 'From ' + from + ': ' + describe(fields), user);
    return { success: true, versionId: ref.id, warning };
  }
  // Later: only through an Employee Change, or a Correction of the latest.
  if (!reason) throw new HttpsError('failed-precondition', 'Pay changes through an Employee Change (promotion or increment). To fix a mistake, use Correct (HR Setup admins), with the reason.');
  if (!r.correct) throw new HttpsError('permission-denied', 'Only HR Setup admins can correct pay.');
  const latest = active[0];
  const ref = COMP().doc();
  const batch = firestore.batch();
  batch.set(ref, Object.assign(fields, { EmployeeID: emp.EmployeeID, CompanyID: emp.CompanyID, EffectiveFrom: latest.EffectiveFrom, Status: 'Active', Source: 'Correction', Reason: reason,
    Replaces: latest.VersionID, BandWarning: warning, CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
  batch.update(COMP().doc(latest.VersionID), { Status: 'Replaced', ReplacedBy: ref.id, ReplacedAt: now });
  await batch.commit();
  await log(emp.EmployeeID, 'Pay corrected', 'From ' + latest.EffectiveFrom + ': ' + describe(latest) + ' → ' + describe(fields), user, reason);
  return { success: true, versionId: ref.id, warning };
});

module.exports.elements = elements;
module.exports.allElements = allElements;
module.exports.cleanCompensation = clean; // Employee Changes (step 4) use them
module.exports.versions = versions;
module.exports.inForce = inForce;
module.exports.bandWarning = bandWarning;
module.exports.band = band;
