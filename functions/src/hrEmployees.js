// HR: the employee record (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md,
// step 1). Personal, employment, organization and job details, line
// manager, bank details, the flexi fields from HR Setup, and a history of
// every change.
// Owner decisions used here:
//   1  one group series of employee numbers: EMP-0001, ...;
//   3  the cost center is the department;
//   7  a separate right, EMPLOYEES "sensitive", to see pay, bank details,
//      sensitive flexi fields and (later) documents;
//   9-10 after creation, company, grade, designation and organization change
//      only through an approved Employee Change (step 4). A data-entry
//      mistake is fixed with a Correction: HR Setup admins, with a reason,
//      kept in the history.
//   point 4: the line manager is optional; Replace manager moves all of a
//      manager's direct reports in one step.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { loadSetup } = require('./hrSetup');
const { resolveReason } = require('./leavingReasons');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'EMPLOYEES';
const EMPLOYEES = () => firestore.collection('employees');
const HISTORY = () => firestore.collection('employeeHistory');

const GENDERS = ['Male', 'Female'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
const EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Part-time', 'Temporary'];
const STATUSES = ['Active', 'On notice', 'Left'];

// The standard fields: label, kind, and whether they're the job /
// organization fields that change only through an Employee Change.
const FIELDS = {
  FullName: { label: 'Full name', req: true }, PassportName: { label: 'Name as in passport' },
  Gender: { label: 'Gender', values: GENDERS }, DateOfBirth: { label: 'Date of birth', date: true },
  Nationality: { label: 'Nationality' }, MaritalStatus: { label: 'Marital status', values: MARITAL },
  Mobile: { label: 'Mobile' }, PersonalEmail: { label: 'Personal email', email: true }, WorkEmail: { label: 'Work email', email: true },
  Address: { label: 'Address', max: 300 },
  EmergencyName: { label: 'Emergency contact' }, EmergencyRelation: { label: 'Emergency contact relation' }, EmergencyPhone: { label: 'Emergency contact phone' },
  CompanyID: { label: 'Company', req: true, job: true },
  JoinDate: { label: 'Date of joining', req: true, date: true }, ProbationEndDate: { label: 'Probation end', date: true },
  EmploymentType: { label: 'Employment type', values: EMPLOYMENT_TYPES },
  Status: { label: 'Status', values: STATUSES }, LeavingDate: { label: 'Leaving date', date: true }, LeavingReason: { label: 'Leaving reason', max: 300 },
  // The reason is one of Payroll Setup → Leaving Reasons (owner, 2026-10-14);
  // the note keeps any detail.
  LeavingNote: { label: 'Leaving note', max: 300 },
  DivisionID: { label: 'Division', job: true, unit: 'Division' }, BranchID: { label: 'Branch', job: true, unit: 'Branch' },
  CostCenterID: { label: 'Cost center (department)', job: true, unit: 'CostCenter' }, WorkLocation: { label: 'Work location' },
  DesignationID: { label: 'Designation', req: true, job: true }, GradeID: { label: 'Grade', req: true, job: true },
  // Empty: the company's own weekend and hours (docs/modules/HR_PAYROLL.md, step 0).
  ScheduleID: { label: 'Work schedule', job: true },
  ManagerID: { label: 'Line manager' }, UserUID: { label: 'ERP user' },
  BankName: { label: 'Bank', sensitive: true }, IBAN: { label: 'Account no. / IBAN', sensitive: true },
  // For the bank's payment file (WPS), docs/modules/HR_PAYROLL.md decision 20.
  WpsPersonID: { label: 'WPS person ID', sensitive: true, max: 20 }, BankRoutingCode: { label: 'Bank routing code', sensitive: true, max: 20 }
};
const JOB_FIELDS = Object.keys(FIELDS).filter(k => FIELDS[k].job);
const MASK = '•••';

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;

async function can(user, cap) { return moduleHasCapability(MODULE_ID, cap, user.profile.role); }
async function rights(user) {
  const [access, write, sensitive, correct] = await Promise.all([can(user, 'access'), can(user, 'write'), can(user, 'sensitive'),
    moduleHasCapability('HRSETUP', 'write', user.profile.role)]);
  return { access, write, sensitive, correct };
}
async function requireAccess(user) {
  const r = await rights(user);
  if (!r.access) throw new HttpsError('permission-denied', 'You do not have access to Employees.');
  return r;
}

// What a user may see of a record: no bank details or sensitive flexi
// fields without the "sensitive" right.
function visible(e, setup, sensitive) {
  const out = Object.assign({}, e);
  if (sensitive) return out;
  Object.keys(FIELDS).filter(k => FIELDS[k].sensitive).forEach(k => { delete out[k]; });
  const hidden = new Set(setup.fields.filter(f => f.Sensitive).map(f => f.FieldID));
  out.Custom = Object.fromEntries(Object.entries(e.Custom || {}).filter(([k]) => !hidden.has(k)));
  return out;
}

// Required flexi fields (active) left empty on a record.
function missingFields(e, setup) {
  return setup.fields.filter(f => f.Active && f.Required).filter(f => {
    const v = (e.Custom || {})[f.FieldID];
    return v === undefined || v === null || v === '';
  }).map(f => f.Label);
}

// The format is the Numbering module's (docs/modules/NUMBERING.md); its
// default EMP-0001 carries on from hrCounters/EMP.
async function nextEmployeeNo() {
  return require('./numbering').employeeCode();
}

async function allEmployees() {
  return (await EMPLOYEES().get()).docs.map(d => Object.assign({ EmployeeID: d.id }, d.data()));
}

// The managers above an employee (its chain), by id.
function chainAbove(id, byId) {
  const seen = [];
  let cur = byId[id] && byId[id].ManagerID;
  while (cur && byId[cur] && !seen.includes(cur) && seen.length < 500) { seen.push(cur); cur = byId[cur].ManagerID; }
  return seen;
}

async function log(id, action, changes, user, reason) {
  await HISTORY().add({ EmployeeID: id, Action: action, Changes: changes || [], Reason: reason || '', By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
}

// ---------- saving ----------

// Checks and saves one employee (the screen and the import both use it).
// opts.correction: the reason, to correct job / organization fields after
// creation (HR Setup admins).
async function saveEmployeeFor(user, input, opts) {
  opts = opts || {};
  const r = await rights(user);
  if (!r.access || !r.write) throw new HttpsError('permission-denied', 'You do not have permission to change employee records.');
  const d = input || {};
  const [setup, unitsSnap, all] = await Promise.all([loadSetup(), rtdb.ref('orgUnits').get(), allEmployees()]);
  const units = unitsSnap.val() || {};
  const byId = Object.fromEntries(all.map(e => [e.EmployeeID, e]));
  const existing = d.EmployeeID ? byId[d.EmployeeID] : null;
  if (d.EmployeeID && !existing) throw new HttpsError('not-found', 'Employee not found.');
  if (existing && !userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');

  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    let v = text(d[k], f.max || 150);
    if (f.sensitive && !r.sensitive) v = existing ? (existing[k] || '') : ''; // never wiped by someone who can't see it
    out[k] = v;
  }
  if (!out.Status) out.Status = 'Active';
  if (!out.EmploymentType) out.EmploymentType = 'Permanent';
  const bad = msg => { throw new HttpsError('invalid-argument', msg); };
  for (const [k, f] of Object.entries(FIELDS)) {
    if (f.req && !out[k]) bad((f.values || /ID$/.test(k) ? 'Choose the ' : 'Enter the ') + f.label.toLowerCase() + '.');
    if (out[k] && f.date && !isDate(out[k])) bad('The ' + f.label.toLowerCase() + ' is not a valid date.');
    if (out[k] && f.values && !f.values.includes(out[k])) bad('Unknown ' + f.label.toLowerCase() + ' "' + out[k] + '".');
    if (out[k] && f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out[k])) bad('Enter a valid ' + f.label.toLowerCase() + '.');
  }
  ['WpsPersonID', 'BankRoutingCode'].forEach(k => {
    if (out[k]) { out[k] = out[k].replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z0-9]{1,20}$/.test(out[k])) bad('The ' + FIELDS[k].label + ' has letters and digits only (up to 20).'); }
  });
  if (out.IBAN) {
    out.IBAN = out.IBAN.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,34}$/.test(out.IBAN)) bad('The account no. / IBAN has letters and digits only (6 to 34).');
  }
  if (!userCanAccessCompany(user.profile, out.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + out.CompanyID).get()).exists()) bad('Company not found.');
  if (out.ProbationEndDate && out.ProbationEndDate < out.JoinDate) bad('The probation end is before the date of joining.');
  if (out.DateOfBirth && out.DateOfBirth >= out.JoinDate) bad('The date of birth must be before the date of joining.');
  if (out.Status === 'Left' && !out.LeavingDate) bad('Enter the leaving date of an employee who has left.');
  if (out.LeavingDate && out.LeavingDate < out.JoinDate) bad('The leaving date is before the date of joining.');
  if (out.Status === 'Active') Object.assign(out, { LeavingDate: '', LeavingReason: '', LeavingNote: '', LeavingReasonID: '', LeavingType: '' });
  else {
    // On notice or left: a reason from the list (owner, 2026-10-14), by id
    // (the screen) or by name (an import). A record from before the list
    // keeps its reason until its status or reason changes.
    const id = text(d.LeavingReasonID, 80);
    const before = existing && !existing.LeavingReasonID && !id && existing.Status === out.Status && String(existing.LeavingReason || '') === out.LeavingReason;
    if (before) Object.assign(out, { LeavingReasonID: '', LeavingType: existing.LeavingType || '' });
    else {
      const reason = await resolveReason(id, id ? '' : out.LeavingReason, existing && existing.LeavingReasonID);
      if (!reason) bad('Choose the leaving reason of an employee who ' + (out.Status === 'Left' ? 'has left.' : 'is on notice.'));
      Object.assign(out, { LeavingReasonID: reason.ReasonID, LeavingReason: reason.Name, LeavingType: reason.Type });
    }
  }

  // Organization: units of the right type, of this company (or for all).
  for (const [k, f] of Object.entries(FIELDS).filter(([, f]) => f.unit)) {
    if (!out[k]) continue;
    const u = units[out[k]];
    if (!u || u.Type !== f.unit) bad(f.label + ' not found.');
    if (u.CompanyID && u.CompanyID !== out.CompanyID) bad('That ' + f.label.toLowerCase() + ' belongs to another company.');
    if (u.Status !== 'Active' && !(existing && existing[k] === out[k])) bad('That ' + f.label.toLowerCase() + ' is inactive.');
  }
  // Job: designation and grade from HR Setup.
  const des = setup.designations.find(x => x.DesignationID === out.DesignationID);
  const grade = setup.grades.find(x => x.GradeID === out.GradeID);
  if (!des) bad('Designation not found.');
  if (!grade) bad('Grade not found.');
  const unchanged = k => existing && existing[k] === out[k];
  if (!des.Active && !unchanged('DesignationID')) bad('The designation "' + des.Title + '" is no longer in use.');
  if (!grade.Active && !unchanged('GradeID')) bad('The grade "' + grade.Code + '" is no longer in use.');
  if (out.ScheduleID) {
    const sc = setup.workSchedules.find(x => x.ScheduleID === out.ScheduleID);
    if (!sc) bad('Work schedule not found.');
    if (sc.Active === false && !unchanged('ScheduleID')) bad('The work schedule "' + sc.Name + '" is no longer in use.');
  }
  const warnings = [];
  const level = id => (setup.grades.find(x => x.GradeID === id) || {}).Level;
  if ((des.GradeFromID && grade.Level < level(des.GradeFromID)) || (des.GradeToID && grade.Level > level(des.GradeToID))) {
    warnings.push('Grade ' + grade.Code + ' is outside the usual range for ' + des.Title + '.');
  }

  // Line manager (optional): an active employee, not themselves, and not
  // someone who reports to them.
  if (out.ManagerID) {
    const m = byId[out.ManagerID];
    if (!m) bad('Line manager not found.');
    if (existing && out.ManagerID === existing.EmployeeID) bad('An employee can\'t be their own line manager.');
    if (m.Status === 'Left' && !unchanged('ManagerID')) bad(m.FullName + ' has left: choose another line manager.');
    if (existing && chainAbove(out.ManagerID, byId).concat(out.ManagerID).includes(existing.EmployeeID)) {
      bad(m.FullName + ' reports to ' + existing.FullName + ' (directly or further down): they can\'t be the line manager.');
    }
  }
  // Leaving: their reports need a new manager first.
  if (existing && out.Status === 'Left') {
    const reports = all.filter(e => e.ManagerID === existing.EmployeeID && e.Status !== 'Left');
    if (reports.length) bad(existing.FullName + ' still has ' + reports.length + (reports.length === 1 ? ' direct report' : ' direct reports') + ': use Replace manager first.');
  }
  // ERP user: optional, one employee each.
  if (out.UserUID) {
    if (!(await rtdb.ref('users/' + out.UserUID).get()).exists()) bad('ERP user not found.');
    const twin = all.find(e => e.UserUID === out.UserUID && e.EmployeeID !== d.EmployeeID);
    if (twin) bad('That ERP user is already linked to ' + twin.EmployeeNo + ' ' + twin.FullName + '.');
  }

  // Flexi fields: active ones, by type; compulsory ones filled. Sensitive
  // ones are kept as they are for users who can't see them.
  const custom = Object.assign({}, (existing && existing.Custom) || {});
  for (const f of setup.fields.filter(x => x.Active)) {
    if (f.Sensitive && !r.sensitive) continue;
    let v = (d.Custom || {})[f.FieldID];
    v = v === undefined || v === null ? '' : String(v).trim();
    if (v && f.Type === 'date' && !isDate(v)) bad(f.Label + ' is not a valid date.');
    if (v && f.Type === 'amount') {
      const n = Number(v.replace(/,/g, ''));
      if (!isFinite(n)) bad(f.Label + ' is not an amount.');
      v = Math.round(n * 100) / 100;
    }
    if (f.Type === 'text') v = v.slice(0, 500);
    if (f.Required && (v === '' || v === null)) bad('Enter ' + f.Label + ' (compulsory).');
    if (v === '') delete custom[f.FieldID]; else custom[f.FieldID] = v;
  }
  out.Custom = custom;

  // After creation: job and organization fields only through an Employee
  // Change, or a Correction with a reason (HR Setup admins).
  const label = k => (FIELDS[k] && FIELDS[k].label) || ((setup.fields.find(f => f.FieldID === k) || {}).Label) || k;
  if (existing) {
    const jobChanged = JOB_FIELDS.filter(k => String(existing[k] || '') !== String(out[k] || ''));
    const reason = text(opts.correction, 300);
    if (jobChanged.length && !reason) {
      throw new HttpsError('failed-precondition', jobChanged.map(label).join(', ') + ' change through an Employee Change. To fix a mistake, use Correct (HR Setup admins), with the reason.');
    }
    if (jobChanged.length && !r.correct) throw new HttpsError('permission-denied', 'Only HR Setup admins can correct ' + jobChanged.map(label).join(', ') + '.');
    if (reason && !jobChanged.length) bad('Nothing to correct: the company, designation, grade and organization are unchanged.');
  }

  // History shows names, not ids.
  const companies = (await rtdb.ref('companies').get()).val() || {};
  const shown = (k, v) => {
    if (v == null || v === '') return '';
    if (k === 'CompanyID') return companies[v] ? companies[v].LegalName : v;
    if (k === 'DesignationID') return (setup.designations.find(x => x.DesignationID === v) || {}).Title || v;
    if (k === 'GradeID') return (setup.grades.find(x => x.GradeID === v) || {}).Code || v;
    if (FIELDS[k] && FIELDS[k].unit) return units[v] ? units[v].Name : v;
    if (k === 'ManagerID') return byId[v] ? byId[v].FullName : v;
    if (k === 'ScheduleID') return (setup.workSchedules.find(x => x.ScheduleID === v) || {}).Name || v;
    return v;
  };
  const now = new Date().toISOString();
  const sensitiveKeys = new Set(Object.keys(FIELDS).filter(k => FIELDS[k].sensitive).concat(setup.fields.filter(f => f.Sensitive).map(f => f.FieldID)));
  const diff = () => {
    const keys = Object.keys(FIELDS).concat(Object.keys(Object.assign({}, existing.Custom, custom)).map(k => 'Custom.' + k));
    return keys.map(k => {
      const key = k.startsWith('Custom.') ? k.slice(7) : k;
      const from = k.startsWith('Custom.') ? (existing.Custom || {})[key] : existing[k];
      const to = k.startsWith('Custom.') ? custom[key] : out[k];
      if (String(from == null ? '' : from) === String(to == null ? '' : to)) return null;
      return { Field: key, Label: label(key), From: shown(key, from), To: shown(key, to), Sensitive: sensitiveKeys.has(key) };
    }).filter(Boolean);
  };
  if (existing) {
    const changes = diff();
    if (!changes.length) return { success: true, employeeId: existing.EmployeeID, employeeNo: existing.EmployeeNo, warnings, unchanged: true };
    // The schedules by date: a correction fixes the one in force now.
    if (String(existing.ScheduleID || '') !== String(out.ScheduleID || '')) {
      const list = (existing.Schedules && existing.Schedules.length ? existing.Schedules : [{ From: existing.JoinDate, ScheduleID: existing.ScheduleID || '' }])
        .slice().sort((a, b) => a.From.localeCompare(b.From));
      list[list.length - 1] = Object.assign({}, list[list.length - 1], { ScheduleID: out.ScheduleID || '' });
      out.Schedules = list;
    }
    await EMPLOYEES().doc(existing.EmployeeID).update(Object.assign(out, { UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) }));
    const correction = text(opts.correction, 300);
    await log(existing.EmployeeID, correction ? 'Correction' : 'Edit', changes, user, correction || opts.source || '');
    return { success: true, employeeId: existing.EmployeeID, employeeNo: existing.EmployeeNo, warnings };
  }
  const employeeNo = await nextEmployeeNo();
  const ref = EMPLOYEES().doc();
  await ref.set(Object.assign(out, { Schedules: [{ From: out.JoinDate, ScheduleID: out.ScheduleID || '' }], EmployeeNo: employeeNo, CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
  await log(ref.id, 'Create', [], user, opts.source || '');
  return { success: true, employeeId: ref.id, employeeNo, warnings };
}

exports.saveEmployee = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  return saveEmployeeFor(user, d.employee, { correction: d.correction });
});

// ---------- reading ----------

function names(e, ctx) {
  const unit = id => (id && ctx.units[id] ? ctx.units[id].Name : '');
  const m = e.ManagerID ? ctx.byId[e.ManagerID] : null;
  const des = ctx.setup.designations.find(x => x.DesignationID === e.DesignationID);
  const grade = ctx.setup.grades.find(x => x.GradeID === e.GradeID);
  const co = ctx.companies[e.CompanyID];
  return {
    CompanyName: co ? (co.CompanyRefCode ? co.CompanyRefCode + ' - ' : '') + co.LegalName : '',
    DesignationTitle: des ? des.Title : '', GradeCode: grade ? grade.Code : '',
    DivisionName: unit(e.DivisionID), BranchName: unit(e.BranchID), CostCenterName: unit(e.CostCenterID),
    ManagerName: m ? m.FullName : '', ManagerNo: m ? m.EmployeeNo : '',
    ScheduleName: e.ScheduleID ? ((ctx.setup.workSchedules || []).find(x => x.ScheduleID === e.ScheduleID) || {}).Name || '' : ''
  };
}
async function context() {
  const [setup, units, companies, all] = await Promise.all([loadSetup(), rtdb.ref('orgUnits').get(), rtdb.ref('companies').get(), allEmployees()]);
  return { setup, units: units.val() || {}, companies: companies.val() || {}, all, byId: Object.fromEntries(all.map(e => [e.EmployeeID, e])) };
}

exports.getEmployees = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await requireAccess(user);
  await require('./hrChanges').applyDueChanges(); // future-dated Employee Changes whose date has come
  const ctx = await context();
  const employees = ctx.all.filter(e => userCanAccessCompany(user.profile, e.CompanyID)).map(e => Object.assign({
    EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID, Status: e.Status, JoinDate: e.JoinDate,
    DesignationID: e.DesignationID, GradeID: e.GradeID, DivisionID: e.DivisionID || '', BranchID: e.BranchID || '', CostCenterID: e.CostCenterID || '',
    ManagerID: e.ManagerID || '', Mobile: e.Mobile || '', WorkEmail: e.WorkEmail || '',
    Missing: missingFields(e, ctx.setup).length,
    Reports: ctx.all.filter(x => x.ManagerID === e.EmployeeID && x.Status !== 'Left').length
  }, names(e, ctx))).sort((a, b) => a.EmployeeNo.localeCompare(b.EmployeeNo));
  return { employees, canWrite: r.write, canSeeSensitive: r.sensitive, canCorrect: r.write && r.correct };
});

exports.getEmployee = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await requireAccess(user);
  await require('./hrChanges').applyDueChanges();
  const ctx = await context();
  const e = ctx.byId[String((request.data || {}).employeeId || '')];
  if (!e) throw new HttpsError('not-found', 'Employee not found.');
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const hist = (await HISTORY().where('EmployeeID', '==', e.EmployeeID).get()).docs.map(x => x.data())
    .sort((a, b) => String(b.At).localeCompare(String(a.At)))
    .map(h => Object.assign({}, h, { Changes: (h.Changes || []).map(c => (c.Sensitive && !r.sensitive ? Object.assign({}, c, { From: MASK, To: MASK }) : c)) }));
  const reports = ctx.all.filter(x => x.ManagerID === e.EmployeeID && x.Status !== 'Left')
    .map(x => Object.assign({ EmployeeID: x.EmployeeID, EmployeeNo: x.EmployeeNo, FullName: x.FullName }, names(x, ctx)));
  const user_ = e.UserUID ? (await rtdb.ref('users/' + e.UserUID).get()).val() : null;
  return {
    employee: Object.assign(visible(e, ctx.setup, r.sensitive), names(e, ctx), { UserName: user_ ? (user_.fullName || user_.username || '') : '' }),
    missing: missingFields(e, ctx.setup), history: hist, reports,
    canWrite: r.write, canSeeSensitive: r.sensitive, canCorrect: r.write && r.correct
  };
});

// ---------- Replace manager (owner point 4) ----------

// Moves every direct report of one manager to another in one step. When
// the new manager was one of those reports, they take the outgoing
// manager's own manager instead.
exports.replaceManager = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await rights(user);
  if (!r.access || !r.write) throw new HttpsError('permission-denied', 'You do not have permission to change employee records.');
  const d = request.data || {};
  const all = await allEmployees();
  const byId = Object.fromEntries(all.map(e => [e.EmployeeID, e]));
  const from = byId[String(d.fromEmployeeId || '')], to = byId[String(d.toEmployeeId || '')];
  if (!from) throw new HttpsError('invalid-argument', 'Choose the manager being replaced.');
  if (!to) throw new HttpsError('invalid-argument', 'Choose the new manager.');
  if (from.EmployeeID === to.EmployeeID) throw new HttpsError('invalid-argument', 'Choose a different new manager.');
  if (to.Status === 'Left') throw new HttpsError('invalid-argument', to.FullName + ' has left.');
  const reports = all.filter(e => e.ManagerID === from.EmployeeID && e.Status !== 'Left');
  if (!reports.length) throw new HttpsError('failed-precondition', from.FullName + ' has no direct reports.');
  for (const e of reports.concat([from, to])) {
    if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to the company of ' + e.EmployeeNo + ' ' + e.FullName + '.');
  }
  // The new manager can't end up under someone they now manage.
  const above = chainAbove(to.EmployeeID, byId);
  const loop = reports.find(e => e.EmployeeID !== to.EmployeeID && above.includes(e.EmployeeID));
  if (loop) throw new HttpsError('failed-precondition', to.FullName + ' reports to ' + loop.FullName + ' (further down): move them first.');
  const now = new Date().toISOString();
  const reason = text(d.reason, 300);
  const batch = firestore.batch();
  const logs = [];
  reports.forEach(e => {
    const target = e.EmployeeID === to.EmployeeID ? (from.ManagerID || '') : to.EmployeeID;
    batch.update(EMPLOYEES().doc(e.EmployeeID), { ManagerID: target, UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) });
    logs.push([e.EmployeeID, [{ Field: 'ManagerID', Label: 'Line manager', From: from.FullName, To: target ? byId[target].FullName : '' }]]);
  });
  await batch.commit();
  for (const [id, changes] of logs) await log(id, 'Replace manager', changes, user, reason);
  return { success: true, moved: reports.length };
});

module.exports.saveEmployeeFor = saveEmployeeFor;
module.exports.STANDARD_FIELDS = FIELDS;
