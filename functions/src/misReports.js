// MIS "My reports" (owner, 2026-11-08; docs/modules/MIS.md, phase 3,
// Q443-Q445): a report from the catalogue saved with its company,
// comparison, chart and month, private to its owner or shared with roles.
// New development, hand-written.
//
//   Firestore misReports/{id} { OwnerUID, OwnerName, Name, Type, CompanyID,
//     Mode, Chart: 'bar'|'line'|'none', Period: { kind: 'latest'|'fixed', month },
//     SharedRoles: [roleId], CreatedAt, UpdatedAt }
//
// Saving one's own needs MIS "design"; sharing it with roles MIS "publish"
// (Q443). Only the owner changes, shares or deletes it; the roles it is
// shared with see it read-only ("Shared with me"). The month (Q444) is the
// latest month when opened, or the fixed month saved. Its figures are always
// worked out when it is opened (runMisReport), never stored.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { CATALOGUE } = require('./mis');
const { MODES } = require('./misCalc');

const onCallOptions = { region: 'us-central1' };
const REPORTS = () => firestore.collection('misReports');
const CHARTS = Object.freeze(['bar', 'line', 'none']);
const MAX_PER_USER = 100;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 80);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const denied = msg => { throw new HttpsError('permission-denied', msg); };
const can = (cap, user) => moduleHasCapability('MIS', cap, user.profile.role);
const shape = (id, d) => ({ id, name: d.Name, type: d.Type, companyId: d.CompanyID, mode: d.Mode, chart: d.Chart, period: d.Period,
  sharedRoles: d.SharedRoles || [], owner: d.OwnerName || '', updatedAt: d.UpdatedAt || '' });

async function requireAccess(user) { if (!(await can('access', user))) denied('You do not have access to MIS reports.'); }
async function ownReport(user, id) {
  const snap = await REPORTS().doc(text(id, 60) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'That saved report no longer exists.');
  if (snap.data().OwnerUID !== user.uid) denied('Only its owner can change that report.');
  return snap;
}

// Mine, and those shared with my role (not mine).
exports.getMyMisReports = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const role = user.profile.role || '';
  const [mine, shared, design, publish] = await Promise.all([
    REPORTS().where('OwnerUID', '==', user.uid).get(),
    role ? REPORTS().where('SharedRoles', 'array-contains', role).get() : { docs: [] },
    can('design', user), can('publish', user)]);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const out = { mine: mine.docs.map(d => shape(d.id, d.data())).sort(byName),
    shared: shared.docs.filter(d => d.data().OwnerUID !== user.uid).map(d => shape(d.id, d.data())).sort(byName),
    rights: { design, publish } };
  if (publish) {
    const roles = (await rtdb.ref('roles').get()).val() || {};
    out.roles = Object.keys(roles).filter(id => (roles[id] || {}).Status !== 'Inactive').map(id => ({ id, name: (roles[id] || {}).Name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
});

// Save a new report or change one's own (name, report, company, comparison, chart, month).
exports.saveMisReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await can('design', user))) denied('You do not have the right to save reports (MIS: design).');
  const d = request.data || {};
  const name = text(d.name, 60);
  if (!name) bad('Give the report a name.');
  const type = text(d.type, 40);
  if (!CATALOGUE.some(c => c.type === type)) bad('Unknown report.');
  const companyId = text(d.companyId, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) denied('You do not have access to that company.');
  const p = d.period || {};
  const period = p.kind === 'fixed' ? { kind: 'fixed', month: text(p.month, 7) } : { kind: 'latest' };
  if (period.kind === 'fixed' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period.month)) bad('Choose the month the report keeps.');
  const fields = { Name: name, Type: type, CompanyID: companyId, Mode: MODES.includes(d.mode) ? d.mode : 'prevMonth',
    Chart: CHARTS.includes(d.chart) ? d.chart : 'bar', Period: period, UpdatedAt: new Date().toISOString() };
  if (d.id) {
    const snap = await ownReport(user, d.id);
    await snap.ref.update(fields);
    return { success: true, id: snap.id };
  }
  const count = (await REPORTS().where('OwnerUID', '==', user.uid).get()).size;
  if (count >= MAX_PER_USER) bad('You have ' + MAX_PER_USER + ' saved reports: delete one first.');
  const ref = REPORTS().doc();
  await ref.set(Object.assign(fields, { OwnerUID: user.uid, OwnerName: user.profile.fullName || user.profile.username || user.uid, SharedRoles: [], CreatedAt: fields.UpdatedAt }));
  return { success: true, id: ref.id };
});

// Share one's own report with roles (MIS publish, Q443); [] makes it private again.
exports.shareMisReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await can('publish', user))) denied('You do not have the right to share reports (MIS: publish).');
  const d = request.data || {};
  const snap = await ownReport(user, d.id);
  const roles = (await rtdb.ref('roles').get()).val() || {};
  const wanted = [...new Set((Array.isArray(d.roles) ? d.roles : []).map(r => text(r, 60)).filter(Boolean))];
  wanted.forEach(r => { if (!roles[r]) bad('Unknown role: ' + r + '.'); });
  await snap.ref.update({ SharedRoles: wanted, UpdatedAt: new Date().toISOString() });
  return { success: true, sharedRoles: wanted };
});

exports.deleteMisReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const snap = await ownReport(user, (request.data || {}).id);
  await snap.ref.delete();
  return { success: true };
});

module.exports = Object.assign(exports, { MAX_PER_USER });
