// The Audit Log module (owner, 2026-11-13; docs/modules/AUDIT_LOG.md step 3,
// Q509, QA9): who changed what and when, read only, Admin only (its access
// right). Every corporate has it (moduleRegistry.js: everywhere). New
// development, hand-written.
//
// The log is written by audit.js only; this module only reads it. A query
// is the newest MAX entries matching one indexed filter (a record, a user,
// a module or an action, each with At: firestore.indexes.json) and the
// dates; the other filters narrow those in memory.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { MODULE_REGISTRY } = require('./moduleRegistry');
const audit = require('./audit');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'AUDITLOG';
const MAX = 500;
const ACTIONS = ['create', 'change', 'delete', 'save', 'submit', 'approve', 'reject', 'post', 'reverse', 'cancel', 'close', 'confirm', 'finalise', 'status',
  'run', 'publish', 'reset', 'import', 'signin', 'signout'];

async function requireAccess(request) {
  const user = await requireUser(request);
  if (!(await moduleHasCapability(MODULE_ID, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to the Audit Log.');
  return user;
}
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// The filters the screen offers: users (this corporate's), modules, actions.
exports.getAuditLogFilters = onCallWithMessages(onCallOptions, async (request) => {
  await requireAccess(request);
  const users = (await rtdb.ref('users').get()).val() || {};
  return {
    users: Object.keys(users).map(id => ({ UserID: id, Name: String(users[id].fullName || users[id].username || id) })).sort((a, b) => a.Name.localeCompare(b.Name)),
    modules: MODULE_REGISTRY.map(m => ({ id: m.id, label: m.label })).sort((a, b) => a.label.localeCompare(b.label)),
    actions: ACTIONS,
    keepYears: audit.KEEP_YEARS
  };
});

// data: { userId, moduleId, record, action, fromAt, toAt } (fromAt/toAt: UTC
// ISO times, the screen's dates in the user's own time). Newest first.
exports.getAuditLog = onCallWithMessages(onCallOptions, async (request) => {
  await requireAccess(request);
  const d = request.data || {};
  const f = { userId: text(d.userId), moduleId: text(d.moduleId, 40), record: text(d.record), action: text(d.action, 20), fromAt: text(d.fromAt, 30), toAt: text(d.toAt, 30) };
  if ((f.fromAt && !ISO.test(f.fromAt)) || (f.toAt && !ISO.test(f.toAt))) throw new HttpsError('invalid-argument', 'Enter valid dates.');
  if (f.fromAt && f.toAt && f.fromAt > f.toAt) throw new HttpsError('invalid-argument', 'The From date is after the To date.');
  const ranged = q => {
    if (f.fromAt) q = q.where('At', '>=', f.fromAt);
    if (f.toAt) q = q.where('At', '<=', f.toAt);
    return q.orderBy('At', 'desc').limit(MAX);
  };
  const col = firestore.collection(audit.COLLECTION);
  let snaps;
  if (f.record) snaps = await Promise.all([ranged(col.where('RecordID', '==', f.record)).get(), ranged(col.where('RecordLabel', '==', f.record)).get()]);
  else if (f.userId) snaps = [await ranged(col.where('UserID', '==', f.userId)).get()];
  else if (f.moduleId) snaps = [await ranged(col.where('ModuleID', '==', f.moduleId)).get()];
  else if (f.action) snaps = [await ranged(col.where('Action', '==', f.action)).get()];
  else snaps = [await ranged(col).get()];
  const seen = new Set();
  let rows = [];
  snaps.forEach(s => s.docs.forEach(doc => { if (!seen.has(doc.id)) { seen.add(doc.id); rows.push(Object.assign({ id: doc.id }, doc.data())); } }));
  rows = rows.filter(r => (!f.userId || r.UserID === f.userId) && (!f.moduleId || r.ModuleID === f.moduleId) && (!f.action || r.Action === f.action))
    .sort((a, b) => String(b.At).localeCompare(String(a.At)));
  const more = snaps.some(s => s.size === MAX);
  return { rows: rows.slice(0, MAX), more, max: MAX };
});
