// MIS Dashboard (owner, 2026-11-08; docs/modules/MIS.md, phase 2, Q439-Q442):
// a dashboard of tiles per user, with a default per role. New development,
// hand-written.
//
// A tile shows one MIS report (mis.js CATALOGUE) as a key figure, a chart, a
// top list or a gauge; its figures are worked out when the dashboard opens,
// each tile through runMisReport (Q442), so a dashboard keeps no figures.
//
//   Firestore misDashboards/{uid}      { Tiles: [tile], ShowOnHome, UpdatedAt }
//   Firestore misRoleDashboards/{role} { Tiles: [tile], UpdatedAt, UpdatedBy }
//   tile { id, kind: 'kpi'|'chart'|'top'|'gauge', type (a report type),
//          key (the row: kpi, gauge), mode (the comparison), chart: 'bar'|'line',
//          low, high (the gauge's good band), title }
//
// What a user sees (Q440): their own dashboard once saved, else their role's
// default, else the starter set below. Saving their own needs MIS "design";
// a role's default needs MIS "publish". Viewing needs MISDASHBOARD access,
// and each tile's figures MIS access (runMisReport checks it).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { CATALOGUE } = require('./mis');
const { MODES } = require('./misCalc');

const onCallOptions = { region: 'us-central1' };
const MINE = uid => firestore.collection('misDashboards').doc(uid);
const ROLE = role => firestore.collection('misRoleDashboards').doc(role);
const KINDS = Object.freeze(['kpi', 'chart', 'top', 'gauge']);
const CHARTS = Object.freeze(['bar', 'line']);
const MAX_TILES = 24;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 80);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };

// A new user's dashboard when neither they nor their role has one.
const STARTER = Object.freeze([
  { id: 't1', kind: 'kpi', type: 'kpis', key: 'sales', mode: 'prevMonth', title: 'Sales' },
  { id: 't2', kind: 'kpi', type: 'kpis', key: 'netProfit', mode: 'prevMonth', title: 'Net profit' },
  { id: 't3', kind: 'kpi', type: 'kpis', key: 'bank', mode: 'prevMonth', title: 'Bank and cash' },
  { id: 't4', kind: 'kpi', type: 'kpis', key: 'receivables', mode: 'prevMonth', title: 'Receivables' },
  { id: 't5', kind: 'chart', type: 'trend', mode: 'prevMonth', chart: 'line', title: '12-month trend' },
  { id: 't6', kind: 'top', type: 'receivables', mode: 'prevMonth', title: 'Largest receivables' },
  { id: 't7', kind: 'gauge', type: 'ratios', key: 'current', mode: 'prevMonth', low: 1, high: 2, title: 'Current ratio' }
].map(Object.freeze));

// One tile, checked and cleaned; i is its place (for the message).
function cleanTile(t, i) {
  const at = 'Tile ' + (i + 1) + ': ';
  if (!t || typeof t !== 'object') bad(at + 'not a tile.');
  const kind = text(t.kind, 10);
  if (!KINDS.includes(kind)) bad(at + 'choose a key figure, chart, top list or gauge.');
  const type = text(t.type, 40);
  if (!CATALOGUE.some(c => c.type === type)) bad(at + 'unknown report.');
  const mode = MODES.includes(t.mode) ? t.mode : 'prevMonth';
  const out = { id: text(t.id, 20) || ('t' + (i + 1)), kind, type, mode, title: text(t.title, 60) };
  if (kind === 'kpi' || kind === 'gauge') {
    out.key = text(t.key, 60);
    if (!out.key) bad(at + 'choose the figure it shows.');
  }
  if (kind === 'chart') out.chart = CHARTS.includes(t.chart) ? t.chart : 'bar';
  if (kind === 'gauge') {
    const low = Number(t.low), high = Number(t.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || !(low < high)) bad(at + 'the good band needs a low under its high.');
    Object.assign(out, { low, high });
  }
  return out;
}
function cleanTiles(tiles) {
  if (!Array.isArray(tiles)) bad('No tiles given.');
  if (tiles.length > MAX_TILES) bad('A dashboard has at most ' + MAX_TILES + ' tiles.');
  const out = tiles.map(cleanTile);
  const seen = new Set();
  out.forEach((t, i) => { while (seen.has(t.id)) t.id = 't' + (i + 1) + '-' + seen.size; seen.add(t.id); });
  return out;
}

async function requireView(user) {
  if (!(await moduleHasCapability('MISDASHBOARD', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to the MIS Dashboard.');
}
const rightsOf = async role => ({
  design: await moduleHasCapability('MIS', 'design', role),
  publish: await moduleHasCapability('MIS', 'publish', role),
  reports: await moduleHasCapability('MIS', 'access', role)
});

// The dashboard to show: { tiles, source: 'mine'|'role'|'starter', showOnHome, rights, catalogue, roles? }.
exports.getMisDashboard = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireView(user);
  const role = user.profile.role || '';
  const [mine, byRole, rights] = await Promise.all([MINE(user.uid).get(), role ? ROLE(role).get() : null, rightsOf(role)]);
  const m = mine.exists ? mine.data() : null;
  const r = byRole && byRole.exists ? byRole.data() : null;
  const out = m && Array.isArray(m.Tiles) ? { tiles: m.Tiles, source: 'mine' } : r && Array.isArray(r.Tiles) ? { tiles: r.Tiles, source: 'role' } : { tiles: STARTER, source: 'starter' };
  Object.assign(out, { showOnHome: Boolean(m && m.ShowOnHome), rights, role, hasRoleDefault: Boolean(r), catalogue: CATALOGUE, modes: MODES });
  if (rights.publish) {
    const roles = (await rtdb.ref('roles').get()).val() || {};
    out.roles = Object.keys(roles).filter(id => (roles[id] || {}).Status !== 'Inactive').map(id => ({ id, name: (roles[id] || {}).Name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
});

// Home asks only this (Q439): whether to show the dashboard there, cheaply.
exports.getMisHomeChoice = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('MISDASHBOARD', 'access', user.profile.role))) return { showOnHome: false };
  const m = await MINE(user.uid).get();
  return { showOnHome: Boolean(m.exists && m.data().ShowOnHome) };
});

// Save one's own dashboard (MIS design), or only the Home choice (any viewer).
exports.saveMisDashboard = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireView(user);
  const d = request.data || {};
  const fields = { UpdatedAt: new Date().toISOString() };
  if (d.tiles !== undefined) {
    if (!(await moduleHasCapability('MIS', 'design', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to change your dashboard (MIS: design).');
    fields.Tiles = cleanTiles(d.tiles);
  }
  if (d.showOnHome !== undefined) fields.ShowOnHome = d.showOnHome === true;
  await MINE(user.uid).set(fields, { merge: true });
  return { success: true };
});

// Back to the role's default (or the starter set): one's own tiles removed, the Home choice kept.
exports.resetMisDashboard = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireView(user);
  const ref = MINE(user.uid);
  const m = await ref.get();
  if (m.exists) {
    const { FieldValue } = require('firebase-admin/firestore');
    await ref.update({ Tiles: FieldValue.delete(), UpdatedAt: new Date().toISOString() });
  }
  return { success: true };
});

// A role's default (MIS publish, Q440); tiles null removes it.
exports.saveMisRoleDashboard = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireView(user);
  if (!(await moduleHasCapability('MIS', 'publish', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to set a role\'s dashboard (MIS: publish).');
  const d = request.data || {};
  const role = text(d.role, 60);
  if (!role || !(await rtdb.ref('roles/' + role).get()).exists()) bad('Choose a role.');
  if (d.tiles === null) { await ROLE(role).delete(); return { success: true, removed: true }; }
  await ROLE(role).set({ Tiles: cleanTiles(d.tiles), UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

module.exports = Object.assign(exports, { cleanTile, cleanTiles, STARTER, KINDS, MAX_TILES });
