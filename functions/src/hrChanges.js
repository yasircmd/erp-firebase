// HR: Employee Changes (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md,
// step 4). A promotion, an increment or a transfer is a document: draft,
// submit, approve through Approval Configuration (decision 8: levels of
// named approvers by company / division / branch / cost center, thresholds
// on the monthly increase), then applied from its effective date. After an
// employee is created, grade, designation, pay and organization change
// only this way (decisions 9-10), so the history is always complete.
//
// Rules (not asked; noted in the design doc):
//   - Promotion: a higher grade or a new designation (pay optional);
//     Increment: new pay, same job and organization; Transfer: a new
//     company, division, branch or cost center (pay optional).
//   - One open change (draft, pending, rejected) per employee at a time.
//   - The effective date can be in the past; a pay change can't start
//     before the employee's latest pay version. A job / organization change
//     dated in the future is applied on that date (the first time anyone
//     opens Employees or Employee Changes from then).
//   - Pay in a change is seen with the Employees "sensitive" right, or by
//     the change's own approvers.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { loadSetup } = require('./hrSetup');
const pay = require('./hrPay');
const costSplit = require('./costSplit');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'EMPCHANGE';
const CHANGES = () => firestore.collection('employeeChanges');
const EMPLOYEES = () => firestore.collection('employees');
const HISTORY = () => firestore.collection('employeeHistory');
const TYPES = ['Promotion', 'Increment', 'Transfer'];
const ORG = ['CompanyID', 'DivisionID', 'BranchID', 'CostCenterID', 'ScheduleID'];
const JOB = ['DesignationID', 'GradeID'];
const UNIT_TYPE = { DivisionID: 'Division', BranchID: 'Branch', CostCenterID: 'CostCenter' };
const LABEL = { CompanyID: 'Company', DivisionID: 'Division', BranchID: 'Branch', CostCenterID: 'Cost center (department)', DesignationID: 'Designation', GradeID: 'Grade', ScheduleID: 'Work schedule' };
const OPEN = ['Draft', 'PendingApproval', 'Rejected'];

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const today = () => todayIn('Asia/Dubai');
const actorOf = user => user.profile.username || user.uid; // as other documents (My Drafts reads it)
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const round2 = n => Math.round(n * 100) / 100;
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const can = (user, cap, mod) => moduleHasCapability(mod || MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Employee Changes.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'post' ? 'You do not have permission to submit Employee Changes.' : 'You do not have permission to prepare Employee Changes.');
}
async function loadEmployee(id) {
  const s = await EMPLOYEES().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Employee not found.');
  return Object.assign({ EmployeeID: s.id }, s.data());
}
async function loadChange(user, id) {
  const s = await CHANGES().doc(text(id, 80) || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'Employee Change not found.');
  const c = Object.assign({ ChangeID: s.id }, s.data());
  if (!userCanAccessCompany(user.profile, c.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return c;
}
const histEntry = (event, user, note) => ({ Event: event, By: actorName(user), At: new Date().toISOString(), Note: note || '' });

// Names for ids, for the history and the screen.
async function namer() {
  const [setup, units, companies, emps] = await Promise.all([loadSetup(), rtdb.ref('orgUnits').get(), rtdb.ref('companies').get(), EMPLOYEES().get()]);
  const u = units.val() || {}, c = companies.val() || {};
  return (k, v) => {
    if (!v) return '';
    if (k === 'CompanyID') return c[v] ? c[v].LegalName : v;
    if (k === 'DesignationID') return (setup.designations.find(x => x.DesignationID === v) || {}).Title || v;
    if (k === 'GradeID') return (setup.grades.find(x => x.GradeID === v) || {}).Code || v;
    if (k === 'ScheduleID') return (setup.workSchedules.find(x => x.ScheduleID === v) || {}).Name || v;
    if (UNIT_TYPE[k]) return u[v] ? u[v].Name : v;
    if (k === 'EmployeeID') { const e = emps.docs.find(d => d.id === v); return e ? e.data().FullName : v; }
    return v;
  };
}

// ---------- checking a change ----------

// The proposed job, organization and pay, checked; returns what to store.
async function evaluate(user, input, emp) {
  const d = input || {};
  const type = text(d.Type, 20);
  if (!TYPES.includes(type)) throw new HttpsError('invalid-argument', 'Choose the type: Promotion, Increment or Transfer.');
  const effective = text(d.EffectiveDate, 10);
  if (!isDate(effective)) throw new HttpsError('invalid-argument', 'Enter the effective date.');
  if (effective < emp.JoinDate) throw new HttpsError('invalid-argument', 'The effective date is before the date of joining (' + emp.JoinDate + ').');
  if (emp.Status === 'Left') throw new HttpsError('failed-precondition', emp.FullName + ' has left.');
  const [setup, unitsSnap] = await Promise.all([loadSetup(), rtdb.ref('orgUnits').get()]);
  const units = unitsSnap.val() || {};
  const after = {};
  for (const k of JOB.concat(ORG)) after[k] = text((d.After || {})[k], 80) || (k === 'CompanyID' || JOB.includes(k) ? emp[k] || '' : '');
  // The work schedule (docs/modules/HR_PAYROLL.md, step 0): kept as it is
  // when not given (an empty one is the company's own).
  if ((d.After || {}).ScheduleID === undefined) after.ScheduleID = emp.ScheduleID || '';
  // Organization: units of the right type, of the (new) company.
  if (!userCanAccessCompany(user.profile, after.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + after.CompanyID).get()).exists()) throw new HttpsError('invalid-argument', 'Company not found.');
  for (const [k, t] of Object.entries(UNIT_TYPE)) {
    if (!after[k]) continue;
    const un = units[after[k]];
    if (!un || un.Type !== t) throw new HttpsError('invalid-argument', LABEL[k] + ' not found.');
    if (un.CompanyID && un.CompanyID !== after.CompanyID) throw new HttpsError('invalid-argument', 'That ' + LABEL[k].toLowerCase() + ' belongs to another company.');
  }
  if (after.ScheduleID && after.ScheduleID !== (emp.ScheduleID || '')) {
    const sc = setup.workSchedules.find(x => x.ScheduleID === after.ScheduleID);
    if (!sc || sc.Active === false) throw new HttpsError('invalid-argument', 'Work schedule not found or no longer in use.');
  }
  const des = setup.designations.find(x => x.DesignationID === after.DesignationID);
  const grade = setup.grades.find(x => x.GradeID === after.GradeID);
  if (!des || !grade) throw new HttpsError('invalid-argument', 'Choose the designation and grade.');
  const oldGrade = setup.grades.find(x => x.GradeID === emp.GradeID);
  // The cost split by % (PAYROLL_COST_SPLIT.md, decision 176): set or changed by a Transfer.
  // Not given: kept, unless the main cost center changed and it no longer includes it.
  const wantSplit = (d.After || {}).CostSplit;
  const kept = (emp.CostSplit || []).some(x => x.CostCenterID === after.CostCenterID) ? (emp.CostSplit || []) : [];
  try { after.CostSplit = wantSplit === undefined ? kept : costSplit.clean(wantSplit, after.CostCenterID, units, after.CompanyID); }
  catch (e) { throw new HttpsError('invalid-argument', e.message); }
  const changed = k => k === 'CostSplit' ? JSON.stringify(emp.CostSplit || []) !== JSON.stringify(after.CostSplit) : String(emp[k] || '') !== String(after[k] || '');
  const jobChanged = JOB.filter(changed), orgChanged = ORG.concat(['CostSplit']).filter(changed);
  if ((jobChanged.includes('DesignationID') && !des.Active) || (jobChanged.includes('GradeID') && !grade.Active)) throw new HttpsError('invalid-argument', 'That designation or grade is no longer in use.');

  // Pay: the proposed version, against the one in force on the date.
  let newPay = null;
  const wantsPay = d.NewPay && (d.NewPay.Lines || []).some(l => l.Amount !== '' && l.Amount != null);
  if (wantsPay) {
    if (!(await can(user, 'sensitive', 'EMPLOYEES'))) throw new HttpsError('permission-denied', 'You do not have the right to change employees\' pay.');
    newPay = await pay.cleanCompensation(d.NewPay);
  }
  const versions = await pay.versions(emp.EmployeeID);
  const active = versions.filter(v => v.Status === 'Active');
  const before = pay.inForce(active, effective);
  if (newPay && active.length && effective <= active[0].EffectiveFrom) {
    throw new HttpsError('invalid-argument', 'The pay can\'t change before its latest version starts (' + active[0].EffectiveFrom + '): use a later effective date.');
  }
  const payChanged = Boolean(newPay) && (!before || JSON.stringify(before.Lines.map(l => [l.ElementID, l.Amount])) !== JSON.stringify(newPay.Lines.map(l => [l.ElementID, l.Amount])) ||
    JSON.stringify(before.Terms) !== JSON.stringify(newPay.Terms));
  if (type === 'Promotion') {
    if (!jobChanged.length) throw new HttpsError('invalid-argument', 'A promotion changes the grade or the designation.');
    if (jobChanged.includes('GradeID') && oldGrade && grade.Level <= oldGrade.Level) throw new HttpsError('invalid-argument', 'A promotion moves to a higher grade (from ' + oldGrade.Code + ').');
  }
  if (type === 'Increment') {
    if (!payChanged) throw new HttpsError('invalid-argument', 'An increment changes the pay.');
    if (jobChanged.length || orgChanged.length) throw new HttpsError('invalid-argument', 'An increment keeps the job and organization: use a Promotion or a Transfer for those.');
  }
  if (type === 'Transfer') {
    if (!orgChanged.length) throw new HttpsError('invalid-argument', 'A transfer changes the company, division, branch, cost center, cost split or work schedule.');
    if (jobChanged.length) throw new HttpsError('invalid-argument', 'A transfer keeps the grade and designation: use a Promotion for those.');
  }
  // Warnings the approvers see (decision 5).
  const warnings = [];
  const level = id => (setup.grades.find(x => x.GradeID === id) || {}).Level;
  if ((des.GradeFromID && grade.Level < level(des.GradeFromID)) || (des.GradeToID && grade.Level > level(des.GradeToID))) warnings.push('Grade ' + grade.Code + ' is outside the usual range for ' + des.Title + '.');
  const basic = newPay ? newPay.Basic : before ? before.Basic : null;
  const b = grade.Bands && grade.Bands[after.CompanyID];
  const bw = pay.bandWarning(basic, b ? { GradeCode: grade.Code, Min: b.Min, Max: b.Max } : null);
  if (bw) warnings.push(bw);
  const fromEarn = before ? before.MonthlyEarnings : 0;
  const toEarn = newPay ? newPay.MonthlyEarnings : fromEarn;
  return {
    Type: type, EffectiveDate: effective, Reason: text(d.Reason, 1000), After: after,
    Before: Object.assign(Object.fromEntries(JOB.concat(ORG).map(k => [k, emp[k] || ''])), { CostSplit: emp.CostSplit || [] }),
    PayBefore: before ? { VersionID: before.VersionID, EffectiveFrom: before.EffectiveFrom, Lines: before.Lines, Terms: before.Terms, MonthlyEarnings: before.MonthlyEarnings, Basic: before.Basic } : null,
    NewPay: payChanged ? newPay : null,
    Increase: round2(toEarn - fromEarn), IncreasePercent: fromEarn ? round2((toEarn - fromEarn) / fromEarn * 100) : null,
    Warnings: warnings
  };
}

// ---------- applying an approved change ----------

const splitChanged = c => c.After.CostSplit !== undefined && JSON.stringify(c.Before.CostSplit || []) !== JSON.stringify(c.After.CostSplit || []);

async function applyJob(c, user) {
  const emp = await loadEmployee(c.EmployeeID);
  const name = await namer();
  const keys = JOB.concat(ORG).filter(k => String(emp[k] || '') !== String(c.After[k] || ''));
  if (keys.length) {
    await EMPLOYEES().doc(emp.EmployeeID).update(Object.assign(Object.fromEntries(keys.map(k => [k, c.After[k] || ''])),
      { UpdatedAt: new Date().toISOString(), UpdatedBy: user ? user.uid : 'system', UpdatedByName: user ? actorName(user) : 'Employee Change (scheduled)' }));
    await HISTORY().add({ EmployeeID: emp.EmployeeID, Action: c.Type, Changes: keys.map(k => ({ Field: k, Label: LABEL[k], From: name(k, emp[k]), To: name(k, c.After[k]), Sensitive: false })),
      Reason: c.ChangeNumber + ', effective ' + c.EffectiveDate, By: user ? user.uid : 'system', ByName: user ? actorName(user) : 'Employee Change (scheduled)', At: new Date().toISOString() });
  }
  // The cost split (decision 176), when the change carries one (changes made before it don't).
  if (c.After.CostSplit !== undefined && JSON.stringify(emp.CostSplit || []) !== JSON.stringify(c.After.CostSplit || [])) {
    const units = (await rtdb.ref('orgUnits').get()).val() || {};
    await EMPLOYEES().doc(emp.EmployeeID).update({ CostSplit: c.After.CostSplit || [], UpdatedAt: new Date().toISOString() });
    await HISTORY().add({ EmployeeID: emp.EmployeeID, Action: c.Type, Changes: [{ Field: 'CostSplit', Label: 'Cost split', From: costSplit.describe(emp.CostSplit, units) || 'none',
      To: costSplit.describe(c.After.CostSplit, units) || 'none', Sensitive: false }], Reason: c.ChangeNumber + ', effective ' + c.EffectiveDate,
      By: user ? user.uid : 'system', ByName: user ? actorName(user) : 'Employee Change (scheduled)', At: new Date().toISOString() });
  }
  await CHANGES().doc(c.ChangeID).update({ JobApplied: true, Scheduled: false, JobAppliedAt: new Date().toISOString() });
}
async function apply(c, user) {
  // Pay: a new version from the effective date (future ones wait as Upcoming).
  if (c.NewPay) {
    const ref = await firestore.collection('employeeCompensation').add(Object.assign({}, c.NewPay, {
      EmployeeID: c.EmployeeID, CompanyID: c.After.CompanyID, EffectiveFrom: c.EffectiveDate, Status: 'Active', Source: 'Employee Change', Reason: c.Type + ' ' + c.ChangeNumber,
      ChangeID: c.ChangeID, BandWarning: (c.Warnings || []).find(w => /band/.test(w)) || '', CreatedAt: new Date().toISOString(), CreatedBy: user.uid, CreatedByName: actorName(user)
    }));
    await HISTORY().add({ EmployeeID: c.EmployeeID, Action: c.Type, Changes: [{ Field: 'Compensation', Label: 'Pay', From: c.PayBefore ? money(c.PayBefore.MonthlyEarnings) : '', To: 'From ' + c.EffectiveDate + ': ' + money(c.NewPay.MonthlyEarnings) + ' a month', Sensitive: true }],
      Reason: c.ChangeNumber, By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
    await CHANGES().doc(c.ChangeID).update({ PayVersionID: ref.id });
  }
  // A new work schedule counts from the effective date at once, so leave
  // booked ahead is counted by it; the record shows it from that date.
  if (String(c.Before.ScheduleID || '') !== String(c.After.ScheduleID || '')) {
    const emp = await loadEmployee(c.EmployeeID);
    const list = (emp.Schedules && emp.Schedules.length ? emp.Schedules : [{ From: emp.JoinDate, ScheduleID: emp.ScheduleID || '' }])
      .filter(x => x.From < c.EffectiveDate).concat([{ From: c.EffectiveDate, ScheduleID: c.After.ScheduleID || '' }]);
    await EMPLOYEES().doc(c.EmployeeID).update({ Schedules: list.sort((a, b) => a.From.localeCompare(b.From)) });
  }
  const hasJob = JOB.concat(ORG).some(k => String(c.Before[k] || '') !== String(c.After[k] || '')) || splitChanged(c);
  if (!hasJob) return CHANGES().doc(c.ChangeID).update({ JobApplied: true, Scheduled: false });
  if (c.EffectiveDate <= today()) return applyJob(c, user);
  return CHANGES().doc(c.ChangeID).update({ Scheduled: true });
}
// Future-dated job / organization changes whose date has come.
async function applyDueChanges() {
  const snap = await CHANGES().where('Scheduled', '==', true).get();
  const due = snap.docs.map(d => Object.assign({ ChangeID: d.id }, d.data())).filter(c => c.Status === 'Approved' && c.EffectiveDate <= today());
  for (const c of due.sort((a, b) => a.EffectiveDate.localeCompare(b.EffectiveDate))) await applyJob(c, null);
  return due.length;
}

// ---------- callables ----------

async function payVisible(user, c) {
  if (await can(user, 'sensitive', 'EMPLOYEES')) return true;
  if (!c.ApprovalInstanceID) return false;
  const inst = (await rtdb.ref('approvalInstances/' + c.ApprovalInstanceID).get()).val();
  return Boolean(inst && (inst.RequiredLevels || []).some(l => l.ApproverUserID === user.uid));
}
function withoutPay(c) {
  return Object.assign({}, c, { NewPay: c.NewPay ? { Hidden: true } : null, PayBefore: c.PayBefore ? { Hidden: true } : null, Increase: null, IncreasePercent: null,
    Warnings: (c.Warnings || []).filter(w => !/basic/i.test(w)) });
}

exports.getEmployeeChanges = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  await applyDueChanges();
  const name = await namer();
  const units = (await rtdb.ref('orgUnits').get()).val() || {};
  const seesPay = await can(user, 'sensitive', 'EMPLOYEES');
  const changes = (await CHANGES().get()).docs.map(d => Object.assign({ ChangeID: d.id }, d.data()))
    .filter(c => userCanAccessCompany(user.profile, c.CompanyID))
    .map(c => ({ ChangeID: c.ChangeID, ChangeNumber: c.ChangeNumber || '', Type: c.Type, Status: c.Status, EmployeeID: c.EmployeeID, EmployeeNo: c.EmployeeNo, EmployeeName: c.EmployeeName,
      CompanyID: c.CompanyID, EffectiveDate: c.EffectiveDate, Scheduled: Boolean(c.Scheduled), Increase: seesPay ? c.Increase : null,
      Summary: JOB.concat(ORG).filter(k => String(c.Before[k] || '') !== String(c.After[k] || '')).map(k => LABEL[k] + ': ' + name(k, c.Before[k]) + ' → ' + name(k, c.After[k]))
        .concat(splitChanged(c) ? ['Cost split: ' + (costSplit.describe(c.Before.CostSplit, units) || 'none') + ' → ' + (costSplit.describe(c.After.CostSplit, units) || 'none')] : []).join('; '),
      UpdatedAt: c.UpdatedAt || c.CreatedAt }))
    .sort((a, b) => String(b.UpdatedAt).localeCompare(String(a.UpdatedAt)));
  return { changes, canDraft: await can(user, 'draft'), canPost: await can(user, 'post'), canSeePay: seesPay, types: TYPES };
});

exports.getEmployeeChange = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const c = await loadChange(user, (request.data || {}).changeId);
  const inst = c.ApprovalInstanceID ? (await rtdb.ref('approvalInstances/' + c.ApprovalInstanceID).get()).val() : null;
  const decided = new Set(((inst && inst.Decisions) || []).map(x => x.LevelNumber));
  const myLevels = inst && inst.Status === 'Pending' ? (inst.RequiredLevels || []).filter(l => l.ApproverUserID === user.uid && !decided.has(l.LevelNumber)).map(l => l.LevelNumber) : [];
  const name = await namer();
  const seesPay = await payVisible(user, c);
  const names = Object.fromEntries(JOB.concat(ORG).map(k => [k, { Before: name(k, c.Before[k]), After: name(k, c.After[k]) }]));
  const units = (await rtdb.ref('orgUnits').get()).val() || {};
  names.CostSplit = { Before: costSplit.describe(c.Before.CostSplit, units) || 'none', After: costSplit.describe(c.After.CostSplit, units) || 'none' };
  return { change: seesPay ? c : withoutPay(c), names, approval: inst ? { Status: inst.Status, Levels: inst.RequiredLevels || [], Decisions: inst.Decisions || [] } : null,
    myLevels, canSeePay: seesPay, canDraft: await can(user, 'draft'), canPost: await can(user, 'post') };
});

exports.saveEmployeeChange = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = (request.data || {}).change || {};
  const now = new Date().toISOString();
  if (d.ChangeID) {
    const c = await loadChange(user, d.ChangeID);
    if (c.Status !== 'Draft' && c.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only a draft or rejected change can be edited.');
    const emp = await loadEmployee(c.EmployeeID);
    const v = await evaluate(user, Object.assign({}, d, { NewPay: d.NewPay === undefined && c.NewPay ? c.NewPay : d.NewPay }), emp);
    await CHANGES().doc(c.ChangeID).update(Object.assign(v, { CompanyID: emp.CompanyID, UpdatedAt: now, UpdatedBy: actorOf(user),
      Description: v.Type + ' — ' + emp.FullName, History: (c.History || []).concat([histEntry('Edited', user)]) }));
    return { success: true, changeId: c.ChangeID, warnings: v.Warnings };
  }
  const emp = await loadEmployee(d.EmployeeID);
  if (!userCanAccessCompany(user.profile, emp.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const open = (await CHANGES().where('EmployeeID', '==', emp.EmployeeID).get()).docs.map(x => x.data()).find(x => OPEN.includes(x.Status));
  if (open) throw new HttpsError('failed-precondition', emp.FullName + ' already has an open Employee Change' + (open.ChangeNumber ? ' (' + open.ChangeNumber + ')' : '') + ': finish or delete it first.');
  const v = await evaluate(user, d, emp);
  const ref = await CHANGES().add(Object.assign(v, { EmployeeID: emp.EmployeeID, EmployeeNo: emp.EmployeeNo, EmployeeName: emp.FullName, CompanyID: emp.CompanyID,
    Description: v.Type + ' — ' + emp.FullName, Status: 'Draft', ChangeNumber: '', CreatedAt: now, CreatedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user),
    History: [histEntry('Created', user)] }));
  return { success: true, changeId: ref.id, warnings: v.Warnings };
});

exports.deleteEmployeeChange = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const c = await loadChange(user, (request.data || {}).changeId);
  if (c.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only a draft can be deleted.');
  await CHANGES().doc(c.ChangeID).delete();
  return { success: true };
});

async function nextNumber(effective) {
  // The format is the Numbering module's (docs/modules/NUMBERING.md).
  return require('./numbering').hrNumber('EC', Number(effective.slice(0, 4)));
}

// Submit: checked again against the employee as they are now; approval if
// configured (decision 8), else applied at once.
exports.submitEmployeeChange = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const c = await loadChange(user, (request.data || {}).changeId);
  if (c.Status !== 'Draft' && c.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only a draft or rejected change can be submitted.');
  const emp = await loadEmployee(c.EmployeeID);
  const v = await evaluate(user, Object.assign({}, c, { NewPay: c.NewPay }), emp);
  const number = c.ChangeNumber || await nextNumber(v.EffectiveDate);
  const now = new Date().toISOString();
  const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: emp.CompanyID, DivisionID: emp.DivisionID, BranchID: emp.BranchID, CostCenterID: emp.CostCenterID });
  const approval = await beginApprovalInstance(MODULE_ID, c.ChangeID, number, scopeKey, Math.max(0, v.Increase || 0), user.uid);
  const base = Object.assign(v, { ChangeNumber: number, CompanyID: emp.CompanyID, SubmittedAt: now, SubmittedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user), RejectionReason: '' });
  if (approval.required) {
    await CHANGES().doc(c.ChangeID).update(Object.assign(base, { Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, History: (c.History || []).concat([histEntry('Submitted for approval', user)]) }));
    return { success: true, status: 'PendingApproval', changeNumber: number };
  }
  await CHANGES().doc(c.ChangeID).update(Object.assign(base, { Status: 'Approved', ApprovedAt: now, History: (c.History || []).concat([histEntry('Submitted (no approval needed)', user)]) }));
  await apply(Object.assign({}, c, base, { ChangeID: c.ChangeID }), user);
  return { success: true, status: 'Approved', changeNumber: number };
});

exports.decideEmployeeChangeApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  const c = await loadChange(user, d.changeId);
  if (c.Status !== 'PendingApproval' || !c.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'This change is not awaiting approval.');
  const result = await recordApprovalDecision(user, c.ApprovalInstanceID, Number(d.levelNumber), d.decision, d.reason);
  const now = new Date().toISOString();
  if (result.status === 'Approved') {
    try {
      // Checked once more against the employee as they are now.
      const emp = await loadEmployee(c.EmployeeID);
      const v = await evaluate(user, Object.assign({}, c, { NewPay: c.NewPay }), emp);
      const fresh = Object.assign({}, c, v, { Status: 'Approved' });
      await CHANGES().doc(c.ChangeID).update(Object.assign(v, { Status: 'Approved', ApprovedAt: now, UpdatedAt: now, History: (c.History || []).concat([histEntry('Approved', user)]) }));
      await apply(fresh, user);
    } catch (err) {
      // As other modules: undo the decision and hand it back for correcting.
      const inst = (await rtdb.ref('approvalInstances/' + c.ApprovalInstanceID).get()).val();
      if (inst) await rtdb.ref('approvalInstances/' + c.ApprovalInstanceID).update({ Decisions: (inst.Decisions || []).filter(x => x.LevelNumber !== Number(d.levelNumber)), Status: 'Pending', UpdatedAt: now });
      throw new HttpsError('failed-precondition', 'It can\'t be applied: ' + err.message + ' Nothing was changed.');
    }
  } else if (result.status === 'Rejected') {
    await CHANGES().doc(c.ChangeID).update({ Status: 'Rejected', RejectionReason: text(d.reason, 500), UpdatedAt: now, History: (c.History || []).concat([histEntry('Rejected', user, text(d.reason, 500))]) });
  } else {
    await CHANGES().doc(c.ChangeID).update({ UpdatedAt: now, History: (c.History || []).concat([histEntry('Approved level ' + d.levelNumber, user)]) });
  }
  return { success: true, status: result.status, selfApproved: result.selfApproved };
});

// What a new change starts from: the employee's job, organization and the
// pay in force (pay only with the sensitive right).
exports.getEmployeeChangeStart = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const emp = await loadEmployee((request.data || {}).employeeId);
  if (!userCanAccessCompany(user.profile, emp.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const seesPay = await can(user, 'sensitive', 'EMPLOYEES');
  const active = (await pay.versions(emp.EmployeeID)).filter(v => v.Status === 'Active');
  const current = pay.inForce(active, today()) || active[active.length - 1] || null;
  return {
    employee: Object.assign({ EmployeeID: emp.EmployeeID, EmployeeNo: emp.EmployeeNo, FullName: emp.FullName, JoinDate: emp.JoinDate, Status: emp.Status },
      Object.fromEntries(JOB.concat(ORG).map(k => [k, emp[k] || ''])), { CostSplit: emp.CostSplit || [] }),
    pay: seesPay ? current : null, latestPayFrom: active.length ? active[0].EffectiveFrom : '', elements: seesPay ? await pay.elements() : [], canSeePay: seesPay
  };
});

module.exports.applyDueChanges = applyDueChanges;
