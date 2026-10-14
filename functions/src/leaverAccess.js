// A leaver's sign-in (owner, 2026-10-14; docs/modules/HR_EMPLOYEES.md,
// "A leaver's access"): an employee on notice or who has left keeps the ERP
// and the Employee Portal until the final settlement is paid (not before
// the last working day), and never more than 30 days after the last
// working day. Admin or HR (Employees, write) can extend it to a date, keep
// access, or go back to the rule, at any time, with a reason.
//
// The last day of access is kept on the employee (AccessUntil) and on the
// linked ERP user (users/{uid}/AccessUntil), worked out again whenever
// something it depends on changes: the employee's status, leaving date or
// ERP user, the settlement being paid or its payment reversed, an override.
// requireUser (auth.js) and the portal (essPortal.js) refuse a sign-in after
// it. Nothing runs on a schedule: the date itself does the switching off.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');

const onCallOptions = { region: 'us-central1' };
const EMPLOYEES = () => firestore.collection('employees');
const SETTLEMENTS = () => firestore.collection('payrollSettlements');
const HISTORY = () => firestore.collection('employeeHistory');
const GRACE_DAYS = 30;
const TIME_ZONE = 'Asia/Dubai';

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// The last day of access ('' = no end): the override if any; else, for
// someone on notice or who has left, the settlement's payment date (not
// before the last working day), at most 30 days after the last working day.
function lastDay(emp, paymentDate) {
  if (!emp || emp.Status === 'Active' || !emp.LeavingDate) return '';
  const o = emp.AccessOverride || {};
  if (o.Mode === 'Keep') return '';
  if (o.Mode === 'Extend' && isDate(o.Until)) return o.Until;
  const latest = addDays(emp.LeavingDate, GRACE_DAYS);
  if (!paymentDate) return latest;
  const paid = paymentDate < emp.LeavingDate ? emp.LeavingDate : paymentDate;
  return paid < latest ? paid : latest;
}
// Whether access has ended (today is after the last day).
const ended = until => Boolean(until) && today() > until;

async function paymentDateOf(employeeId) {
  const paid = (await SETTLEMENTS().where('EmployeeID', '==', employeeId).get()).docs.map(d => d.data()).filter(s => s.PaidAt && s.PaymentDate);
  return paid.map(s => s.PaymentDate).sort().pop() || '';
}

// Works the employee's last day out again and writes it to the employee and
// to the linked ERP user (clearing it from a user no longer linked).
async function refresh(employeeId, previousUserUid) {
  const ref = EMPLOYEES().doc(employeeId);
  const emp = (await ref.get()).data();
  if (!emp) return '';
  const until = lastDay(emp, await paymentDateOf(employeeId));
  if ((emp.AccessUntil || '') !== until) await ref.update({ AccessUntil: until });
  if (emp.UserUID && (await rtdb.ref('users/' + emp.UserUID).get()).exists()) await rtdb.ref('users/' + emp.UserUID + '/AccessUntil').set(until || null);
  if (previousUserUid && previousUserUid !== emp.UserUID) await rtdb.ref('users/' + previousUserUid + '/AccessUntil').set(null);
  return until;
}

// Admin or HR: extend to a date, keep access, or back to the rule.
exports.setLeaverAccess = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('EMPLOYEES', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change employee records.');
  const d = request.data || {};
  const ref = EMPLOYEES().doc(text(d.employeeId, 80) || '-');
  const emp = (await ref.get()).data();
  if (!emp) throw new HttpsError('not-found', 'Employee not found.');
  if (!userCanAccessCompany(user.profile, emp.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (emp.Status === 'Active' || !emp.LeavingDate) bad(emp.FullName + ' is not leaving: there is no access to end.');
  const mode = text(d.mode, 10);
  const reason = text(d.reason, 300);
  if (!['Extend', 'Keep', 'Rule'].includes(mode)) bad('Choose: extend to a date, keep access, or the rule.');
  if (!reason) bad('Give the reason.');
  const until = text(d.until, 10);
  if (mode === 'Extend' && (!isDate(until) || until < today())) bad('Extend to a date from today on.');
  const now = new Date().toISOString();
  const by = user.profile.fullName || user.profile.username || user.uid;
  const override = mode === 'Rule' ? null : { Mode: mode, Until: mode === 'Extend' ? until : '', Reason: reason, By: by, ByUid: user.uid, At: now };
  const before = emp.AccessUntil || '';
  await ref.update({ AccessOverride: override });
  const after = await refresh(ref.id);
  const shown = v => (v ? v : 'no end');
  await HISTORY().add({ EmployeeID: ref.id, Action: 'Access after leaving', Reason: reason, By: user.uid, ByName: by, At: now,
    Changes: [{ Field: 'AccessUntil', Label: 'Access until', From: shown(before), To: mode === 'Keep' ? 'kept (no end)' : shown(after) + (mode === 'Rule' ? ' (the rule)' : ''), Sensitive: false }] });
  return { success: true, accessUntil: after };
});

// Once, after this went live: the last day for everyone already on notice
// or gone (the Employees screen asks; a marker keeps it to once).
exports.refreshLeaverAccess = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('EMPLOYEES', 'write', user.profile.role))) return { success: true, done: 0 };
  const marker = firestore.collection('appState').doc('leaverAccess');
  if ((await marker.get()).exists) return { success: true, done: 0 };
  const ids = (await EMPLOYEES().where('Status', 'in', ['On notice', 'Left']).get()).docs.map(d => d.id);
  for (const id of ids) await refresh(id);
  await marker.set({ BackfilledAt: new Date().toISOString(), By: user.uid, Count: ids.length });
  return { success: true, done: ids.length };
});

module.exports.lastDay = lastDay;
module.exports.ended = ended;
module.exports.refresh = refresh;
module.exports.today = today;
module.exports.GRACE_DAYS = GRACE_DAYS;
