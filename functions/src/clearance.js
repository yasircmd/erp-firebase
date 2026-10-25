// A leaver's clearance, step by step (UX round 2, item 28; owner,
// 2026-10-25; docs/modules/LEAVER_CLEARANCE.md, decisions Q278, Q301-Q304).
//   - Set up per company (module CLEARANCE, "setup"): the steps in order,
//     each with its team (ERP users) and its checklist; whether they run in
//     order or all at once (Q301); the deduction pay element an amount to
//     recover posts through. No set-up: the default, Finance → IT → HR. An
//     empty list of steps: the company has no clearance.
//   - A clearance for each employee on notice or left whose final settlement
//     is not posted, started when it is first needed (the employee saved,
//     the list, the portal, the settlement): the company's steps as they are
//     that day.
//   - Each step: its team (or anyone with "manage") ticks the checklist,
//     writes notes, may enter an amount to recover with a note, and signs it
//     off. In order, a step opens once the ones before are signed. "manage"
//     reopens a signed step with a reason, until the settlement is posted.
//   - The settlement (payrollSettlement.js) is submitted only once every step
//     is signed (Q303), and takes each amount to recover as a deduction line
//     (Q302). The leaver sees the steps in the portal, without the notes or
//     amounts (Q304).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability, ensurePermissionsSeeded } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'CLEARANCE';
const CLEARANCES = () => firestore.collection('clearances');
const SETUP = () => firestore.collection('clearanceSetup');
const EMPLOYEES = () => firestore.collection('employees');
const SETTLEMENTS = () => firestore.collection('payrollSettlements');
const LEAVING = ['On notice', 'Left'];
const MODES = ['InOrder', 'AllAtOnce'];
const MAX_STEPS = 12, MAX_ITEMS = 20;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);

// The default steps (Q278), for a company with no set-up of its own.
const DEFAULT_STEPS = [
  { StepID: 'finance', Name: 'Finance', TeamUserIDs: [], Checklist: ['Loans and advances settled', 'Petty cash returned', 'Company credit card returned'] },
  { StepID: 'it', Name: 'IT', TeamUserIDs: [], Checklist: ['Laptop returned', 'Phone returned', 'Access card returned', 'Email and system access closed'] },
  { StepID: 'hr', Name: 'HR', TeamUserIDs: [], Checklist: ['Company documents returned', 'Exit interview held'] }
];
async function setupOf(companyId) {
  const s = (await SETUP().doc(String(companyId || '-')).get()).data();
  if (!s) return { CompanyID: companyId, Mode: 'InOrder', Steps: DEFAULT_STEPS, RecoveryElementID: '', Default: true };
  return { CompanyID: companyId, Mode: MODES.includes(s.Mode) ? s.Mode : 'InOrder', Steps: s.Steps || [], RecoveryElementID: s.RecoveryElementID || '', Default: false };
}

// A step's state: Signed; else Open, or (in order) Waiting for the ones before.
function withStates(c) {
  let blocked = false;
  const steps = (c.Steps || []).map(st => {
    const state = st.SignedAt ? 'Signed' : (c.Mode === 'InOrder' && blocked ? 'Waiting' : 'Open');
    if (!st.SignedAt) blocked = true;
    return Object.assign({}, st, { State: state });
  });
  const signed = steps.filter(s => s.State === 'Signed').length;
  return Object.assign({}, c, { Steps: steps, Signed: signed, Progress: signed + ' of ' + steps.length + ' signed' });
}

async function settlementPosted(employeeId) {
  const snap = await SETTLEMENTS().where('EmployeeID', '==', employeeId).get();
  return snap.docs.some(d => d.data().Status === 'Posted');
}

// The employee's clearance, started when needed: on notice or left, with a
// leaving date, the settlement not posted, the company not switched off.
// An employee active again: a clearance nobody has signed yet goes; one
// with a signature is kept, Cancelled.
async function ensureFor(employee) {
  const e = employee.EmployeeID ? employee : Object.assign({ EmployeeID: employee._id }, employee);
  const ref = CLEARANCES().doc(e.EmployeeID);
  const snap = await ref.get();
  const now = new Date().toISOString();
  if (!LEAVING.includes(e.Status) || !e.LeavingDate) {
    if (snap.exists && snap.data().Status === 'Open') {
      if ((snap.data().Steps || []).some(s => s.SignedAt)) await ref.update({ Status: 'Cancelled', UpdatedAt: now });
      else await ref.delete();
    }
    return null;
  }
  if (snap.exists) {
    const c = snap.data();
    if (c.Status === 'Cancelled') { await ref.update({ Status: c.Steps.every(s => s.SignedAt) ? 'Complete' : 'Open', LeavingDate: e.LeavingDate, UpdatedAt: now }); return Object.assign({}, c, { Status: 'Open' }); }
    if (c.LeavingDate !== e.LeavingDate) await ref.update({ LeavingDate: e.LeavingDate, UpdatedAt: now });
    return Object.assign({}, c, { LeavingDate: e.LeavingDate });
  }
  if (await settlementPosted(e.EmployeeID)) return null;
  const setup = await setupOf(e.CompanyID);
  if (!setup.Steps.length) return null;
  const c = {
    EmployeeID: e.EmployeeID, CompanyID: e.CompanyID, EmployeeNo: e.EmployeeNo || '', EmployeeName: e.FullName || '', LeavingDate: e.LeavingDate,
    Mode: setup.Mode, RecoveryElementID: setup.RecoveryElementID, Status: 'Open',
    Steps: setup.Steps.map(s => ({ StepID: s.StepID, Name: s.Name, TeamUserIDs: s.TeamUserIDs || [], Items: (s.Checklist || []).map(t => ({ Text: t, Done: false })),
      Notes: '', RecoverAmount: 0, RecoverNote: '', SignedAt: '', SignedBy: '', SignedByName: '' })),
    History: [{ Event: 'Started', At: now, ByName: 'System' }], StartedAt: now, UpdatedAt: now
  };
  await ref.set(c);
  return c;
}
// Every leaver of a company: their clearances, started where needed.
async function ensureForCompany(companyId) {
  const snap = await EMPLOYEES().where('CompanyID', '==', companyId).get();
  const leavers = snap.docs.map(d => Object.assign({ EmployeeID: d.id }, d.data())).filter(e => LEAVING.includes(e.Status) && e.LeavingDate);
  for (const e of leavers) await ensureFor(e);
}

async function requireAccess(user) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Clearances.');
}
function requireCompany(user, companyId) {
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
async function loadFor(user, employeeId) {
  const snap = await EMPLOYEES().doc(text(employeeId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Employee not found.');
  const e = Object.assign({ EmployeeID: snap.id }, snap.data());
  requireCompany(user, e.CompanyID);
  const c = await ensureFor(e);
  if (!c) throw failed(e.FullName + ' has no clearance: not leaving, already settled, or the company has none.');
  return { e, c };
}
// May this user work on this step: its team, or anyone with "manage".
const mayWork = (user, step, manage) => manage || (step.TeamUserIDs || []).includes(user.uid);

// ---------- set-up ----------

// The ERP users who may be on a team: active, with Clearances access, in the company.
async function candidates(companyId) {
  const [users, perms] = await Promise.all([rtdb.ref('users').get(), ensurePermissionsSeeded()]);
  const roles = ((perms[MODULE_ID] || {}).access) || [];
  return Object.entries(users.val() || {}).filter(([, u]) => u && u.status === 'Active' && roles.includes(u.role) && userCanAccessCompany(u, companyId))
    .map(([uid, u]) => ({ Uid: uid, Name: u.fullName || u.username || uid })).sort((a, b) => a.Name.localeCompare(b.Name));
}

exports.getClearanceSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const companyId = text((request.data || {}).companyId, 80);
  requireCompany(user, companyId);
  const els = await require('./payrollSetup').payrollElements();
  return {
    setup: await setupOf(companyId), users: await candidates(companyId), canSetup: await can(user, 'setup'),
    deductionElements: els.filter(e => e.Kind === 'Deduction' && !e.System && e.Active !== false).map(e => ({ ElementID: e.ElementID, Code: e.Code, Name: e.Name }))
  };
});

exports.saveClearanceSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  if (!(await can(user, 'setup'))) throw new HttpsError('permission-denied', 'You do not have permission to set up clearances.');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const mode = MODES.includes(d.mode) ? d.mode : bad('Choose whether the steps run in order or all at once.');
  const raw = Array.isArray(d.steps) ? d.steps : [];
  if (raw.length > MAX_STEPS) bad('At most ' + MAX_STEPS + ' steps.');
  const allowed = new Set((await candidates(companyId)).map(u => u.Uid));
  const seen = new Set();
  const steps = raw.map((s, i) => {
    const name = text(s.Name, 60);
    if (!name) bad('Step ' + (i + 1) + ' needs a name.');
    if (seen.has(name.toLowerCase())) bad('Two steps are called ' + name + '.');
    seen.add(name.toLowerCase());
    const team = [...new Set((s.TeamUserIDs || []).map(x => text(x, 80)).filter(Boolean))];
    const stranger = team.find(u => !allowed.has(u));
    if (stranger) bad(name + ': a team member must be an active user with Clearances access in the company.');
    const items = (s.Checklist || []).map(t => text(t, 120)).filter(Boolean);
    if (items.length > MAX_ITEMS) bad(name + ': at most ' + MAX_ITEMS + ' checklist items.');
    return { StepID: text(s.StepID, 40) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step' + (i + 1), Name: name, TeamUserIDs: team, Checklist: items };
  });
  const elementId = text(d.recoveryElementId, 80);
  if (elementId) {
    const el = (await require('./payrollSetup').payrollElements()).find(e => e.ElementID === elementId);
    if (!el || el.Kind !== 'Deduction' || el.System) bad('An amount to recover posts through a deduction pay element.');
  }
  await SETUP().doc(companyId).set({ Mode: mode, Steps: steps, RecoveryElementID: elementId, UpdatedAt: new Date().toISOString(), UpdatedBy: user.uid, UpdatedByName: actorName(user) });
  return { success: true, steps: steps.length };
});

// ---------- clearances ----------

exports.getClearances = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const companyId = text((request.data || {}).companyId, 80);
  requireCompany(user, companyId);
  await ensureForCompany(companyId);
  const snap = await CLEARANCES().where('CompanyID', '==', companyId).get();
  return {
    clearances: snap.docs.map(d => withStates(d.data())).map(c => ({
      EmployeeID: c.EmployeeID, EmployeeNo: c.EmployeeNo, EmployeeName: c.EmployeeName, LeavingDate: c.LeavingDate, Status: c.Status, Progress: c.Progress,
      Now: c.Steps.filter(s => s.State === 'Open').map(s => s.Name), Mine: c.Status === 'Open' && c.Steps.some(s => s.State === 'Open' && (s.TeamUserIDs || []).includes(user.uid))
    })).sort((a, b) => (a.Status === 'Open' ? 0 : 1) - (b.Status === 'Open' ? 0 : 1) || String(a.LeavingDate).localeCompare(String(b.LeavingDate))),
    canManage: await can(user, 'manage'), canSetup: await can(user, 'setup')
  };
});

exports.getClearance = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const { c } = await loadFor(user, (request.data || {}).employeeId);
  const manage = await can(user, 'manage');
  const out = withStates(c);
  out.Steps = out.Steps.map(s => Object.assign(s, { CanWork: c.Status === 'Open' && s.State === 'Open' && mayWork(user, s, manage), CanReopen: manage && s.State === 'Signed' }));
  return { clearance: out, canManage: manage, settled: await settlementPosted(c.EmployeeID) };
});

// One step's checklist, notes and amount to recover (and, with sign, signed off).
async function writeStep(request, sign) {
  const user = await requireUser(request);
  await requireAccess(user);
  const d = request.data || {};
  const { c } = await loadFor(user, d.employeeId);
  if (c.Status !== 'Open') throw failed('This clearance is ' + c.Status.toLowerCase() + '.');
  const states = withStates(c).Steps;
  const i = c.Steps.findIndex(s => s.StepID === text(d.stepId, 40));
  if (i < 0) throw new HttpsError('not-found', 'Step not found.');
  const step = c.Steps[i];
  if (!mayWork(user, step, await can(user, 'manage'))) throw new HttpsError('permission-denied', 'Only ' + step.Name + '\'s team signs off this step.');
  if (states[i].State === 'Signed') throw failed(step.Name + ' is signed off: reopen it first.');
  if (states[i].State === 'Waiting') throw failed(step.Name + ' opens once the steps before it are signed off.');
  const ticks = Array.isArray(d.items) ? d.items : null;
  const items = step.Items.map((it, k) => Object.assign({}, it, { Done: ticks ? Boolean(ticks[k]) : it.Done }));
  const amount = d.recoverAmount == null || d.recoverAmount === '' ? step.RecoverAmount || 0 : round2(Number(String(d.recoverAmount).replace(/,/g, '')));
  if (!(amount >= 0)) bad('The amount to recover is 0 or more.');
  const note = d.recoverNote == null ? step.RecoverNote || '' : text(d.recoverNote, 200);
  if (amount > 0 && !note) bad('Say what the amount is for (e.g. laptop not returned).');
  if (amount > 0 && !c.RecoveryElementID) throw failed('Choose the deduction an amount to recover posts through, in Clearances → Set-up, first.');
  const now = new Date().toISOString();
  const updated = Object.assign({}, step, { Items: items, Notes: d.notes == null ? step.Notes || '' : text(d.notes, 1000), RecoverAmount: amount, RecoverNote: amount > 0 ? note : '' },
    sign ? { SignedAt: now, SignedBy: user.uid, SignedByName: actorName(user) } : {});
  const steps = c.Steps.slice();
  steps[i] = updated;
  const complete = steps.every(s => s.SignedAt);
  const history = (c.History || []).concat(sign ? [{ Event: step.Name + ' signed off', At: now, ByName: actorName(user) }].concat(complete ? [{ Event: 'Clearance complete', At: now, ByName: actorName(user) }] : []) : []);
  await CLEARANCES().doc(c.EmployeeID).update(Object.assign({ Steps: steps, History: history, UpdatedAt: now }, complete ? { Status: 'Complete', CompletedAt: now } : {}));
  return { success: true, complete };
}
exports.saveClearanceStep = onCallWithMessages(onCallOptions, request => writeStep(request, false));
exports.signClearanceStep = onCallWithMessages(onCallOptions, request => writeStep(request, true));

exports.reopenClearanceStep = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  if (!(await can(user, 'manage'))) throw new HttpsError('permission-denied', 'You do not have permission to reopen a clearance step.');
  const d = request.data || {};
  const reason = text(d.reason, 300);
  if (!reason) bad('Give the reason for reopening the step.');
  const { c } = await loadFor(user, d.employeeId);
  if (await settlementPosted(c.EmployeeID)) throw failed('The final settlement is posted: the clearance can no longer change.');
  const i = c.Steps.findIndex(s => s.StepID === text(d.stepId, 40));
  if (i < 0) throw new HttpsError('not-found', 'Step not found.');
  if (!c.Steps[i].SignedAt) throw failed(c.Steps[i].Name + ' is not signed off.');
  const now = new Date().toISOString();
  const steps = c.Steps.slice();
  steps[i] = Object.assign({}, steps[i], { SignedAt: '', SignedBy: '', SignedByName: '' });
  await CLEARANCES().doc(c.EmployeeID).update({ Steps: steps, Status: 'Open', CompletedAt: '', UpdatedAt: now,
    History: (c.History || []).concat([{ Event: steps[i].Name + ' reopened', Reason: reason, At: now, ByName: actorName(user) }]) });
  return { success: true };
});

// Home: the open steps the user may work on now (their team's, or with
// "manage" a step with no team), in their companies.
exports.getClearanceTasksForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await can(user, 'access'))) return [];
  const manage = await can(user, 'manage');
  const snap = await CLEARANCES().where('Status', '==', 'Open').get();
  const out = [];
  snap.docs.map(d => withStates(d.data())).filter(c => userCanAccessCompany(user.profile, c.CompanyID)).forEach(c => c.Steps.forEach(s => {
    if (s.State !== 'Open') return;
    if ((s.TeamUserIDs || []).includes(user.uid) || (manage && !(s.TeamUserIDs || []).length)) {
      out.push({ EmployeeID: c.EmployeeID, EmployeeName: c.EmployeeName, EmployeeNo: c.EmployeeNo, LeavingDate: c.LeavingDate, Step: s.Name, Progress: c.Progress });
    }
  }));
  return out.sort((a, b) => String(a.LeavingDate).localeCompare(String(b.LeavingDate)));
});

// ---------- for the settlement and the portal ----------

// The settlement's check (Q303) and its deduction lines (Q302): null when
// the employee needs no clearance.
async function forSettlement(employee) {
  const c = await ensureFor(employee);
  if (!c) return null;
  const s = withStates(c);
  return {
    complete: c.Status === 'Complete',
    outstanding: s.Steps.filter(x => x.State !== 'Signed').map(x => x.Name),
    recoveries: c.Steps.filter(x => Number(x.RecoverAmount) > 0).map(x => ({ StepID: x.StepID, Name: x.Name, Amount: round2(Number(x.RecoverAmount)), Note: x.RecoverNote || '', ElementID: c.RecoveryElementID }))
  };
}
// The leaver's own view (Q304): each step's state and what is outstanding,
// never the notes, the team or the amounts.
async function forPortal(employee) {
  const c = await ensureFor(employee);
  if (!c) return null;
  const s = withStates(c);
  return { Status: c.Status, Progress: s.Progress, Steps: s.Steps.map(x => ({ Name: x.Name, State: x.State, SignedAt: x.SignedAt || '',
    Outstanding: x.State === 'Signed' ? [] : x.Items.filter(it => !it.Done).map(it => it.Text) })) };
}

Object.assign(exports, { ensureFor, ensureForCompany, forSettlement, forPortal, setupOf, withStates, DEFAULT_STEPS, MODULE_ID });
