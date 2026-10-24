// Leaving reasons (owner, 2026-10-14; docs/modules/HR_EMPLOYEES.md,
// "Leaving reasons"): a list kept in HR Setup → Leaving Reasons (Payroll
// Setup until 2026-10-24, owner: it is HR's, and its rights follow HR
// Setup's), each
// of a type (Resignation, Termination or Other), with defaults the owner
// can add to. An employee on notice or who has left has one of them
// (hrEmployees.js).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');

const onCallOptions = { region: 'us-central1' };
const REASONS = () => firestore.collection('hrLeavingReasons');
const TYPES = ['Resignation', 'Termination', 'Other'];
// Made the first time the list is read, if it is empty.
const DEFAULTS = [
  ['Better opportunity', 'Resignation'], ['Personal reasons', 'Resignation'], ['Relocation', 'Resignation'], ['Further studies', 'Resignation'],
  ['Performance', 'Termination'], ['Misconduct', 'Termination'], ['Redundancy', 'Termination'], ['End of contract', 'Termination'], ['Absconding', 'Termination'],
  ['Retirement', 'Other'], ['Death', 'Other'], ['Mutual agreement', 'Other']
];

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const byTypeThenName = (a, b) => TYPES.indexOf(a.Type) - TYPES.indexOf(b.Type) || a.Name.localeCompare(b.Name);

async function reasons() {
  let snap = await REASONS().get();
  if (snap.empty) {
    // Two first readers at once could both seed: the ids are fixed, so the
    // second write is the same as the first.
    const batch = firestore.batch();
    DEFAULTS.forEach(([Name, Type], i) => batch.set(REASONS().doc('default-' + String(i + 1).padStart(2, '0')), { Name, Type, Active: true }));
    await batch.commit();
    snap = await REASONS().get();
  }
  return snap.docs.map(d => Object.assign({ ReasonID: d.id }, d.data())).sort(byTypeThenName);
}

// The reason an employee's save names: by id (the screen) or by name (an
// import). Null when neither is given. A reason no longer in use is
// accepted only if the employee already has it.
async function resolveReason(id, name, current) {
  if (!id && !name) return null;
  const all = await reasons();
  const r = id ? all.find(x => x.ReasonID === id) : all.find(x => x.Name.toLowerCase() === String(name).trim().toLowerCase());
  if (!r) bad(id ? 'Leaving reason not found.' : 'Unknown leaving reason "' + name + '": choose one of HR Setup → Leaving Reasons.');
  if (r.Active === false && r.ReasonID !== current) bad('The leaving reason "' + r.Name + '" is no longer in use.');
  return r;
}

exports.leavingReasonSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const [setupRead, setupWrite, employees] = await Promise.all([moduleHasCapability('HRSETUP', 'access', user.profile.role),
    moduleHasCapability('HRSETUP', 'write', user.profile.role), moduleHasCapability('EMPLOYEES', 'access', user.profile.role)]);
  // The Employees screen reads the list to choose from.
  if (d.action === 'list') {
    if (!setupRead && !employees) throw new HttpsError('permission-denied', 'You do not have access to the leaving reasons.');
    return { reasons: await reasons(), types: TYPES, canWrite: setupWrite };
  }
  if (d.action !== 'save') bad('Unknown request.');
  if (!setupWrite) throw new HttpsError('permission-denied', 'You do not have permission to change HR Setup.');
  const r = d.reason || {};
  const id = text(r.ReasonID, 80);
  const all = await reasons();
  if (id && !all.some(x => x.ReasonID === id)) throw new HttpsError('not-found', 'Leaving reason not found.');
  const out = { Name: text(r.Name, 60), Type: text(r.Type, 20), Active: r.Active !== false };
  if (!out.Name) bad('Name the reason.');
  if (!TYPES.includes(out.Type)) bad('Choose the type: Resignation, Termination or Other.');
  if (all.some(x => x.ReasonID !== id && x.Name.toLowerCase() === out.Name.toLowerCase())) throw new HttpsError('already-exists', 'There is already a reason "' + out.Name + '".');
  const ref = id ? REASONS().doc(id) : REASONS().doc();
  await ref.set(out);
  return { success: true, reasonId: ref.id };
});

module.exports.reasons = reasons;
module.exports.resolveReason = resolveReason;
module.exports.TYPES = TYPES;
