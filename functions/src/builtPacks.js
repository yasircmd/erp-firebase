// Module Builder, phase 6 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q493-Q499): packs. A pack is a bundle of the firm's built modules provided
// as one (Q493): its modules, a menu folder, starter reports and dashboard
// tiles, and a setup checklist (Q495). New development, hand-written.
//
// The firm's packs are written in the code (src/packs/), so they are read,
// tested and reviewed like it; the Module Builder's Packs tab publishes one:
// each of its module definitions as a new version where it changed, then
// the pack itself as a new version, kept in the firm's Firestore:
//   modulePacks/{P_ID}  { Published: pack, Version, PublishedAt, PublishedBy }
//   modulePacks/{P_ID}/versions/{n}  { pack, PublishedAt, PublishedBy }
// The Developer screen provides a pack to a group or a corporate like a
// module (developer.js): its modules and Pack Setup switched on, and the pack
// installed in each corporate (installIn): a menu folder with its screens
// (Admin only), the rights Admin only (the modules' defaults), the starter
// reports and tiles for the corporate's first Admin. A later version adds
// what is new; nothing the client changed or removed is put back. Taking a
// pack away switches its modules off, the data kept (entitlements.js).
// Each corporate keeps what was installed:
//   Firestore packInstalls/{P_ID}  { Version, Offered: [X_ID], FolderID,
//     Reports: { key: reportId }, ReportsFor, Ticks: { key: true }, ... }
// Pack Setup (PACKSETUP) is the client's checklist (Q495, Q496): the
// module's Setup, the tax components its Help names, the roles to give
// rights, each ticked when done (read from the corporate where possible).
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore, firm, HOME_ID, corporateId, corporateEntry } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const B = require('./builtDefinitions');

const onCallOptions = { region: 'us-central1' };
const PACK_ID = /^P_[A-Z][A-Z0-9_]{1,30}$/;
const KEY = /^[a-z][a-zA-Z0-9]{0,30}$/;
const KINDS = Object.freeze(['setup', 'tax', 'rights', 'manual']);
const MAX_REPORTS = 10;
const SETUP_MODULE = 'PACKSETUP';
const PACKS = () => firm.firestore.collection('modulePacks');
const INSTALLS = () => firestore.collection('packInstalls');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
function fail(msg) { const e = new Error(msg); e.code = 'invalid-argument'; throw e; }
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
// The same whatever order its keys come back in (Firestore sorts them), without `version`.
function same(a, b) {
  const norm = v => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.keys(v).filter(k => k !== 'version' && v[k] !== undefined).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {}) : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
const checked = fn => { try { return fn(); } catch (err) { if (err && err.code === 'invalid-argument') bad(err.message); throw err; } };

// ---------- pure: a pack, checked against its modules' definitions ----------

// defs: the pack's module definitions (cleaned), in the pack's order.
function cleanPack(p, defs) {
  const x = p || {};
  const id = text(x.id, 33).toUpperCase();
  if (!PACK_ID.test(id)) fail('A pack\'s id starts with P_, then capital letters, digits or _ (for example P_HOTEL).');
  const label = text(x.label, 60);
  if (!label) fail(id + ': give the pack a name.');
  const byId = Object.fromEntries((defs || []).map(d => [d.id, d]));
  const modules = [...new Set((Array.isArray(x.modules) ? x.modules : []).map(m => text(m, 33)))];
  if (!modules.length) fail(id + ': a pack has at least one module.');
  modules.forEach(m => { if (!byId[m]) fail(id + ': its module ' + m + ' is not one of its definitions.'); });
  // The menu: its screens in order (each module once), the pack's setup first.
  const items = (Array.isArray((x.menu || {}).items) ? x.menu.items : modules.map(m => ({ module: m }))).map((it, i) => {
    const m = text(it && it.module, 33);
    if (!modules.includes(m)) fail(id + ': menu item ' + (i + 1) + ' is not one of its modules.');
    return { module: m, text: text(it.text, 60) || byId[m].label };
  });
  if (new Set(items.map(i => i.module)).size !== items.length) fail(id + ': a module is in its menu twice.');
  const menu = { folder: text((x.menu || {}).folder, 60) || label, items };
  // Starter reports: MIS builder reports on its modules' data sets (or the ERP's).
  const sets = require('./builtMis').datasetsOf(defs);
  const ERP_SETS = require('./misBuilder').DATASETS;
  const reports = (Array.isArray(x.reports) ? x.reports : []).map((r, i) => {
    const at = id + ': report ' + (i + 1) + ': ';
    const key = text(r && r.key, 31);
    if (!KEY.test(key)) fail(at + 'its key starts with a small letter, then letters or digits.');
    const name = text(r.name, 60);
    if (!name) fail(at + 'give it a name.');
    const dataset = text(r.dataset, 40);
    const ds = sets[dataset] || (dataset === 'sales' || dataset === 'purchases' ? ERP_SETS[dataset] : null);
    if (!ds) fail(at + '"' + dataset + '" is not a data set of the pack\'s modules (or sales, purchases).');
    const fields = ds === ERP_SETS[dataset] ? Object.assign({}, ds.fields, require('./builtMis').variantColumns(defs, dataset === 'sales' ? 'CUSTOMERINVOICE' : 'VENDORINVOICE').fields) : ds.fields;
    let spec;
    try { spec = require('./misQuery').cleanSpec(r.spec, fields); } catch (e) { fail(at + e.message); }
    const tile = r.tile === 'chart' || r.tile === 'top' ? r.tile : '';
    return { key, name, dataset, months: Math.min(24, Math.max(1, Math.floor(Number(r.months) || 1))), spec, chart: r.chart === 'line' ? 'line' : 'bar', tile };
  });
  if (reports.length > MAX_REPORTS) fail(id + ': at most ' + MAX_REPORTS + ' starter reports.');
  if (new Set(reports.map(r => r.key)).size !== reports.length) fail(id + ': two reports have the same key.');
  // The checklist (Q495, Q496).
  const checklist = (Array.isArray(x.checklist) ? x.checklist : []).map((c, i) => {
    const at = id + ': checklist item ' + (i + 1) + ': ';
    const key = text(c && c.key, 31);
    if (!KEY.test(key)) fail(at + 'its key starts with a small letter, then letters or digits.');
    const kind = KINDS.includes(c.kind) ? c.kind : fail(at + 'its kind is setup, tax, rights or manual.');
    const item = { key, kind, text: text(c.text, 300) || fail(at + 'say what to do.') };
    if (kind === 'setup') {
      const m = text(c.module, 33);
      if (!modules.includes(m) || !(byId[m].actions || []).length) fail(at + 'its module is one of the pack\'s with actions (its Setup).');
      item.module = m;
    }
    return item;
  });
  if (new Set(checklist.map(c => c.key)).size !== checklist.length) fail(id + ': two checklist items have the same key.');
  return { id, label, description: text(x.description, 400), modules, menu, reports, checklist, help: text(x.help, 60) };
}

// The firm's packs in the code, each { pack, definitions } (src/packs/).
const catalogue = () => require('./packs').PACKS;

// A pack's definitions cleaned in order (a later one may link to an earlier
// master), with the masters already published.
function cleanDefinitions(entry, publishedMasters) {
  const masters = publishedMasters.slice();
  return entry.definitions.map(d => {
    const def = B.cleanDefinition(d, masters);
    if (def.kind === 'master' && !masters.includes(def.id)) masters.push(def.id);
    return def;
  });
}

// ---------- the firm: the Packs tab (Corporate 100, BUILDER) ----------

async function requireBuilder(user, capability) {
  if (String(corporateId()) !== HOME_ID) throw new HttpsError('permission-denied', 'Packs are the firm\'s (Corporate 100).');
  if (!(await moduleHasCapability('BUILDER', capability, user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to ' + (capability === 'publish' ? 'publish packs' : 'open the Module Builder') + ' (Module Builder: ' + capability + ').');
}
const by = user => user.profile.username || user.uid;

// Every pack in the code with its published version, and whether the code changed since.
exports.getModulePacks = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'access');
  const published = Object.fromEntries((await PACKS().get()).docs.map(d => [d.id, d.data()]));
  const defsDocs = Object.fromEntries((await firm.firestore.collection('moduleDefinitions').get()).docs.map(d => [d.id, d.data()]));
  const masters = Object.values(defsDocs).map(x => x.Published).filter(d => d && d.kind === 'master').map(d => d.id);
  const packs = catalogue().map(entry => {
    let pack = null, problem = '', defs = [];
    try { defs = cleanDefinitions(entry, masters); pack = cleanPack(entry.pack, defs); } catch (e) { problem = e.message; }
    const p = published[(entry.pack || {}).id] || {};
    const changed = pack ? (!p.Published || !same(p.Published, pack) || defs.some(d => { const was = (defsDocs[d.id] || {}).Published; return !was || !same(was, d); })) : false;
    return { id: (entry.pack || {}).id, label: (entry.pack || {}).label, description: (entry.pack || {}).description || '', modules: (entry.definitions || []).map(d => ({ id: d.id, label: d.label, kind: d.kind })),
      reports: pack ? pack.reports.length : 0, checklist: pack ? pack.checklist.length : 0, version: p.Version || 0, publishedAt: p.PublishedAt || '', changed, problem };
  });
  return { packs, rights: { publish: await moduleHasCapability('BUILDER', 'publish', user.profile.role) } };
});

// Publish a pack: its definitions as new versions where they changed, then the pack.
exports.publishModulePack = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'publish');
  const id = text((request.data || {}).id, 33).toUpperCase();
  const entry = catalogue().find(e => e.pack && e.pack.id === id);
  if (!entry) throw new HttpsError('not-found', 'No such pack.');
  const { compatible } = require('./moduleBuilder');
  const DEFS = firm.firestore.collection('moduleDefinitions');
  const docs = Object.fromEntries((await DEFS.get()).docs.map(d => [d.id, d.data()]));
  const masters = Object.values(docs).map(x => x.Published).filter(d => d && d.kind === 'master').map(d => d.id);
  const defs = checked(() => cleanDefinitions(entry, masters));
  const pack = checked(() => cleanPack(entry.pack, defs));
  const { MODULE_REGISTRY } = require('./moduleRegistry');
  defs.forEach(d => { if (MODULE_REGISTRY.some(m => m.id === d.id && !m.built)) bad(d.id + ' is a module of the ERP\'s own.'); compatible(d, (docs[d.id] || {}).Published || null); });
  const now = new Date().toISOString();
  const published = [];
  for (const def of defs) {
    const was = (docs[def.id] || {}).Published;
    if (was && same(was, def)) continue;
    const version = ((docs[def.id] || {}).Version || 0) + 1;
    const ref = DEFS.doc(def.id);
    await ref.collection('versions').doc(String(version)).set({ def, PublishedAt: now, PublishedBy: by(user), Pack: id });
    await ref.set({ Draft: def, Published: Object.assign({}, def, { version }), Version: version, PublishedAt: now, PublishedBy: by(user), UpdatedAt: now, UpdatedBy: by(user), Pack: id }, { merge: true });
    published.push({ id: def.id, version });
  }
  const ref = PACKS().doc(id);
  const s = await ref.get();
  // Nothing changed: no new version.
  if (!published.length && s.exists && s.data().Published && same(s.data().Published, pack)) return { success: true, version: s.data().Version, modules: [], unchanged: true, corporates: [] };
  const version = (s.exists ? s.data().Version || 0 : 0) + 1;
  await ref.collection('versions').doc(String(version)).set({ pack, PublishedAt: now, PublishedBy: by(user) });
  await ref.set({ Published: Object.assign({}, pack, { version }), Version: version, PublishedAt: now, PublishedBy: by(user) });
  await B.refresh(true);
  // The corporates that have it get what the version adds (Q467, Q493).
  const installed = await require('./developer').installPackInCorporates(id);
  return { success: true, version, modules: published, corporates: installed };
});

// ---------- in a corporate: installing a pack ----------

// The published pack, or null.
async function publishedPack(id) {
  const s = await PACKS().doc(String(id || '-')).get();
  return s.exists ? s.data().Published || null : null;
}

// The corporate's first active Admin (the starter reports' owner), or null.
async function firstAdmin() {
  const users = (await rtdb.ref('users').get()).val() || {};
  const admins = Object.entries(users).filter(([, u]) => u && u.role === 'ADMIN' && u.status === 'Active').sort((a, b) => String(a[1].createdAt || '').localeCompare(String(b[1].createdAt || '')) || a[0].localeCompare(b[0]));
  return admins.length ? { uid: admins[0][0], profile: admins[0][1] } : null;
}
// The first company (by its code) a user may open, or ''.
async function firstCompany(profile) {
  const { userCanAccessCompany } = require('./glWriting');
  const companies = Object.entries((await rtdb.ref('companies').get()).val() || {}).filter(([cid, c]) => c && c.Status !== 'Inactive' && (!profile || userCanAccessCompany(profile, cid)))
    .sort((a, b) => String(a[1].CompanyRefCode || a[0]).localeCompare(String(b[1].CompanyRefCode || b[0])));
  return companies.length ? companies[0][0] : '';
}

// The starter reports and tiles for one user (owner), in their first company.
// Returns { key: reportId } of the reports made now and kept before.
async function installReports(pack, record, owner) {
  const out = Object.assign({}, record.Reports || {});
  if (!pack.reports.length || !owner) return out;
  const companyId = await firstCompany(owner.profile);
  if (!companyId) return out;
  const now = new Date().toISOString();
  const REPORTS = firestore.collection('misReports');
  for (const r of pack.reports) {
    if (out[r.key] && (await REPORTS.doc(out[r.key]).get()).exists) continue;
    const ref = REPORTS.doc();
    await ref.set({ Name: r.name, Type: 'builder', CompanyID: companyId, Mode: 'prevMonth', Chart: r.chart, Period: { kind: 'latest' },
      Builder: { dataset: r.dataset, months: r.months, spec: r.spec }, OwnerUID: owner.uid, OwnerName: owner.profile.fullName || owner.profile.username || owner.uid,
      SharedRoles: [], CreatedAt: now, UpdatedAt: now, Pack: pack.id });
    out[r.key] = ref.id;
  }
  // The tiles: on the owner's own dashboard (the starter set first when they had none).
  const tiles = pack.reports.filter(r => r.tile && out[r.key]).map(r => ({ id: 'p' + randomUUID().split('-')[0], kind: r.tile, type: 'saved:' + out[r.key], mode: 'prevMonth', chart: r.chart, title: r.name }));
  if (tiles.length) {
    const D = require('./misDashboard');
    const ref = firestore.collection('misDashboards').doc(owner.uid);
    const s = await ref.get();
    const had = s.exists && Array.isArray(s.data().Tiles) ? s.data().Tiles : D.STARTER.map(t => Object.assign({}, t));
    const have = new Set(had.map(t => t.type));
    const merged = had.concat(tiles.filter(t => !have.has(t.type))).slice(0, D.MAX_TILES);
    await ref.set({ Tiles: merged, UpdatedAt: now }, { merge: true });
  }
  return out;
}

// Install (or bring up to date) a pack in the current corporate: menu, rights,
// starter reports. Nothing the client changed or removed is put back.
async function installIn(pack, byName) {
  const ref = INSTALLS().doc(pack.id);
  const snap = await ref.get();
  const record = snap.exists ? snap.data() : { Offered: [], Reports: {}, Ticks: {} };
  const now = new Date().toISOString();
  // The menu: a folder with the pack's screens (and its setup first), Admin only.
  const tree = (await rtdb.ref('tree').get()).val() || {};
  const offered = new Set(record.Offered || []);
  const inTree = new Set(Object.values(tree).map(n => n && n.ModuleID).filter(Boolean));
  let folderId = record.FolderID && tree[record.FolderID] ? record.FolderID : '';
  const updates = {};
  const node = (fields) => Object.assign({ AllowedRoles: ['ADMIN'], CreatedAt: now, CreatedBy: 'SYSTEM', UpdatedAt: now, UpdatedBy: 'SYSTEM', PackID: pack.id }, fields);
  const want = [{ module: SETUP_MODULE, text: 'Pack setup' }].concat(pack.menu.items).filter(i => !offered.has(i.module) && !inTree.has(i.module));
  if (want.length) {
    if (!folderId && !snap.exists) {
      folderId = 'NODE-' + randomUUID().split('-')[0].toUpperCase();
      updates[folderId] = node({ Text: pack.menu.folder, ParentID: '', ModuleID: '', Order: Math.max(-1, ...Object.values(tree).map(n => Number((n || {}).Order) || 0)) + 1 });
    }
    const base = Math.max(-1, ...Object.values(tree).filter(n => n && n.ParentID === folderId).map(n => Number(n.Order) || 0));
    want.forEach((it, i) => { updates['NODE-' + randomUUID().split('-')[0].toUpperCase()] = node({ Text: it.text, ParentID: folderId, ModuleID: it.module, Order: base + 1 + i }); offered.add(it.module); });
    await rtdb.ref('tree').update(updates);
  }
  // The rights: each module's defaults (Admin only) where the corporate has none yet.
  const { DEFAULT_PERMISSIONS } = require('./moduleRegistry');
  const perms = (await rtdb.ref('permissions').get()).val() || {};
  const permUpdates = {};
  pack.modules.concat([SETUP_MODULE]).forEach(m => { if (!perms[m] && DEFAULT_PERMISSIONS[m]) permUpdates[m] = DEFAULT_PERMISSIONS[m]; });
  if (Object.keys(permUpdates).length) await rtdb.ref('permissions').update(permUpdates);
  // The starter reports and tiles, for the corporate's first Admin (once).
  const owner = record.ReportsFor ? null : await firstAdmin();
  const reports = await installReports(pack, record, owner);
  const next = { Version: pack.version || 0, Offered: [...offered], FolderID: folderId || record.FolderID || '', Reports: reports, ReportsFor: record.ReportsFor || (owner && Object.keys(reports).length ? owner.uid : ''),
    Ticks: record.Ticks || {}, UpdatedAt: now, UpdatedBy: byName || 'SYSTEM' };
  if (!snap.exists) next.InstalledAt = now;
  await ref.set(next, { merge: true });
  return { menu: want.map(i => i.module), reports: Object.keys(reports).filter(k => !(record.Reports || {})[k]) };
}

// ---------- in a corporate: Pack Setup (the client's checklist) ----------

// The packs this corporate has: those provided to it (Corporate 100: every published one).
async function packsHere() {
  if (String(corporateId()) === HOME_ID) return (await PACKS().get()).docs.map(d => d.data().Published).filter(Boolean);
  const ids = Object.keys(((corporateEntry() || {}).Packs) || {}).filter(k => corporateEntry().Packs[k]);
  return (await Promise.all(ids.map(publishedPack))).filter(Boolean);
}

// Is each checklist item done here (read from the corporate where it can be).
async function itemsDone(pack, record) {
  const perms = (await rtdb.ref('permissions').get()).val() || {};
  const out = {};
  for (const c of pack.checklist) {
    if (c.kind === 'setup') {
      const def = await B.publishedDef(c.module);
      const needs = (def && def.actions || []).map(a => ({ key: a.key, fields: require('./builtActions').needsOf(a).filter(k => !/^(CostCenterID|ProfitCenterID|ProjectID)$/.test(k)) }));
      const setups = (await firestore.collection('builtSetup').where('ModuleID', '==', c.module).get()).docs.map(d => d.data().Actions || {});
      out[c.key] = Boolean(def) && setups.some(s => needs.every(n => n.fields.every(k => text(((s[n.key]) || {})[k], 80))));
    } else if (c.kind === 'rights') {
      out[c.key] = pack.modules.some(m => ((perms[m] || {}).access || []).some(r => String(r).toUpperCase() !== 'ADMIN'));
    } else out[c.key] = Boolean((record.Ticks || {})[c.key]);
  }
  return out;
}

async function requirePackSetup(user, capability) {
  if (!(await moduleHasCapability(SETUP_MODULE, capability, user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to ' + (capability === 'write' ? 'change' : 'open') + ' Pack setup (Pack setup: ' + capability + ').');
}

exports.getPackSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePackSetup(user, 'access');
  const out = [];
  for (const pack of await packsHere()) {
    const s = await INSTALLS().doc(pack.id).get();
    const record = s.exists ? s.data() : {};
    const done = await itemsDone(pack, record);
    const mine = Object.values(record.Reports || {}).length && record.ReportsFor === user.uid;
    out.push({ id: pack.id, label: pack.label, description: pack.description, version: pack.version || 0, installedVersion: record.Version || 0, help: pack.help || '',
      modules: pack.modules, reports: pack.reports.map(r => ({ key: r.key, name: r.name })), haveReports: Boolean(mine),
      checklist: pack.checklist.map(c => ({ key: c.key, kind: c.kind, text: c.text, module: c.module || '', done: done[c.key], auto: c.kind === 'setup' || c.kind === 'rights' })) });
  }
  return { packs: out, canEdit: await moduleHasCapability(SETUP_MODULE, 'write', user.profile.role) };
});

// Tick (or untick) a tax or manual item.
exports.tickPackItem = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePackSetup(user, 'write');
  const d = request.data || {};
  const pack = (await packsHere()).find(p => p.id === text(d.pack, 33));
  if (!pack) throw new HttpsError('not-found', 'This corporate has no such pack.');
  const item = pack.checklist.find(c => c.key === text(d.key, 31));
  if (!item) bad('No such checklist item.');
  if (item.kind === 'setup' || item.kind === 'rights') bad('That one is ticked by itself when it is done.');
  await INSTALLS().doc(pack.id).set({ Ticks: { [item.key]: d.done === true }, UpdatedAt: new Date().toISOString(), UpdatedBy: by(user) }, { merge: true });
  return { success: true };
});

// The starter reports and tiles for the caller (an Admin who wants their own).
exports.addPackReports = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePackSetup(user, 'write');
  const pack = (await packsHere()).find(p => p.id === text((request.data || {}).pack, 33));
  if (!pack) throw new HttpsError('not-found', 'This corporate has no such pack.');
  if (!(await moduleHasCapability('MIS', 'design', user.profile.role))) throw new HttpsError('permission-denied', 'You need the right to save MIS reports (MIS: design).');
  const ref = INSTALLS().doc(pack.id);
  const s = await ref.get();
  const record = s.exists ? s.data() : {};
  const mine = record.ReportsFor === user.uid ? record : { Reports: {} };
  const reports = await installReports(pack, mine, { uid: user.uid, profile: user.profile });
  if (!Object.keys(reports).length) bad('There is no company you can open to make the reports in.');
  if (record.ReportsFor === user.uid || !record.ReportsFor) await ref.set({ Reports: reports, ReportsFor: user.uid, UpdatedAt: new Date().toISOString(), UpdatedBy: by(user) }, { merge: true });
  return { success: true, reports: Object.keys(reports).length };
});

module.exports = Object.assign(exports, { PACK_ID, SETUP_MODULE, cleanPack, cleanDefinitions, catalogue, publishedPack, installIn, itemsDone });
