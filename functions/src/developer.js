// Developer (docs/modules/MULTI_CORPORATE.md, M2; owner, 2026-10-19,
// decisions 247 and 250–257): the firm's own screen for its corporates,
// in Corporate 100 only. New development, hand-written.
//
// For each corporate:
// - Connection: its directory entry (corporates.js) and a connection test;
// - Modules: which modules it may use (entitlements.js);
// - Notes: the firm's internal notes on it, never shown to the client
//   (Firestore corporateNotes, in the firm's project; no client data in a
//   note, as for Help);
// - Tree: whether it follows the main tree (Corporate 100's), or has its
//   own; "Back to the main tree"; and bringing the ones that follow up to
//   date after the main tree changes.
//
// The directory and the notes are the firm's (firebaseAdmin.firm). A
// corporate's own database is reached only inside runInCorporate, for the
// connection test and its tree.
'use strict';
const { createHash, randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore, admin, firm, HOME_ID, corporateId, runInCorporate } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { DIRECTORY } = require('./corporates');
const { MODULE_REGISTRY } = require('./moduleRegistry');
const { isBaseline } = require('./entitlements');
const { levelOf } = require('./coaScheme');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'DEVELOPER';
const NOTES = 'corporateNotes';
const GROUPS = 'corporateGroups';
// What the firm holds about a client is deleted this long after it is set
// Inactive (decision 265).
const KEEP_AFTER_LEAVING_DAYS = 90;
const VALID_ID = /^[A-Za-z0-9-]{1,20}$/;
const NOTE_TYPES = ['Note', 'Task', 'Bug', 'Change request'];
const NOTE_STATUSES = ['Open', 'In progress', 'Done'];
// A client's Admin needs these to run its own ERP: never switched off.
const ALWAYS_ON = ['USERMGMT', 'ROLES', 'TREEMGMT'];
const HOME_ONLY = new Set(MODULE_REGISTRY.filter(m => m.homeOnly).map(m => m.id));

const nameOf = user => user.profile.fullName || user.profile.username || user.uid;
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);

// The Developer screen's caller: Corporate 100, with the capability.
async function developer(request, cap) {
  if (corporateId() !== HOME_ID) throw new HttpsError('permission-denied', 'The Developer module is only in Corporate 100.');
  const user = await requireUser(request);
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change the corporates.' : 'You do not have access to the Developer module.');
  }
  return user;
}

// ---------- the directory ----------

const entryRef = id => firm.firestore.doc(DIRECTORY + '/' + id);
async function entryOf(id) {
  const key = str(id, 20);
  if (!VALID_ID.test(key) || key === HOME_ID) throw new HttpsError('invalid-argument', 'Unknown corporate.');
  const snap = await entryRef(key).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Corporate ' + key + ' is not in the directory.');
  return { id: key, entry: snap.data() };
}

function validEntry(d) {
  const e = {
    Name: str(d.Name, 120),
    ProjectID: str(d.ProjectID, 40),
    DatabaseURL: str(d.DatabaseURL, 200).replace(/\/+$/, ''),
    Status: d.Status === 'Inactive' ? 'Inactive' : 'Active',
    WebConfig: {}
  };
  const w = d.WebConfig || {};
  ['apiKey', 'authDomain', 'appId', 'messagingSenderId'].forEach(k => { if (str(w[k])) e.WebConfig[k] = str(w[k]); });
  e.WebConfig.projectId = e.ProjectID;
  if (!e.Name) throw new HttpsError('invalid-argument', 'Give the corporate a name.');
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(e.ProjectID)) throw new HttpsError('invalid-argument', 'The project ID is the client\'s Firebase project ID: 6–30 lower-case letters, digits or hyphens.');
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/.test(e.DatabaseURL)) {
    throw new HttpsError('invalid-argument', 'The database URL is the client\'s Realtime Database URL, e.g. https://' + (e.ProjectID || 'project') + '-default-rtdb.firebaseio.com.');
  }
  if (!e.WebConfig.apiKey) throw new HttpsError('invalid-argument', 'The web config needs the API key (Firebase console → Project settings → Your apps).');
  if (!e.WebConfig.authDomain) e.WebConfig.authDomain = e.ProjectID + '.firebaseapp.com';
  return e;
}

// The corporates, with their open notes counted.
exports.getDeveloperCorporates = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'access');
  const [dir, notes, groups] = await Promise.all([firm.firestore.collection(DIRECTORY).get(), firm.firestore.collection(NOTES).where('Status', 'in', ['Open', 'In progress']).get(),
    firm.firestore.collection(GROUPS).get()]);
  const open = {};
  notes.forEach(n => { const c = n.get('CorporateID'); open[c] = (open[c] || 0) + 1; });
  const corporates = dir.docs.map(d => Object.assign({ CorporateID: d.id, OpenNotes: open[d.id] || 0 }, d.data()))
    .sort((a, b) => a.CorporateID.localeCompare(b.CorporateID, undefined, { numeric: true }));
  return {
    canWrite: await moduleHasCapability(MODULE_ID, 'write', user.profile.role),
    corporates,
    modules: MODULE_REGISTRY.filter(m => !m.homeOnly).map(m => ({ id: m.id, label: m.label, alwaysOn: ALWAYS_ON.includes(m.id), baseline: isBaseline(m.id) })),
    groups: groups.docs.map(g => Object.assign({ GroupID: g.id }, g.data())).sort((a, b) => String(a.Name).localeCompare(String(b.Name))),
    keepAfterLeavingDays: KEEP_AFTER_LEAVING_DAYS,
    noteTypes: NOTE_TYPES, noteStatuses: NOTE_STATUSES
  };
});

// Adds a corporate (isNew) or changes its entry. Its modules, notes and
// tree are kept apart (below).
exports.saveDeveloperCorporate = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const d = request.data || {};
  const id = str(d.CorporateID, 20);
  if (!VALID_ID.test(id)) throw new HttpsError('invalid-argument', 'A Corporate ID is 1–20 letters, digits or hyphens.');
  if (id === HOME_ID) throw new HttpsError('invalid-argument', 'Corporate 100 is the firm\'s own, in this project.');
  const e = validEntry(d);
  const now = new Date().toISOString();
  const ref = entryRef(id);
  // Its group (decision 259): joining one gives it the modules provided to
  // the group.
  // (Not given: it keeps its group.)
  const groupGiven = d.Group !== undefined;
  const groupId = str(d.Group, 40);
  const group = groupGiven && groupId ? await firm.firestore.doc(GROUPS + '/' + groupId).get() : null;
  if (group && !group.exists) throw new HttpsError('invalid-argument', 'That group is not there any more.');
  await firm.firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (d.isNew === true && snap.exists) throw new HttpsError('already-exists', 'Corporate ' + id + ' is already in the directory.');
    if (d.isNew !== true && !snap.exists) throw new HttpsError('not-found', 'Corporate ' + id + ' is not in the directory.');
    const was = snap.exists ? snap.data() : {};
    e.Group = groupGiven ? groupId : (was.Group || '');
    const modules = Object.assign({}, was.Modules || {});
    if (group && was.Group !== groupId) (group.get('Modules') || []).forEach(m => { modules[m] = true; });
    // When it stopped being Active: what the firm holds about it is deleted
    // KEEP_AFTER_LEAVING_DAYS later (decision 265).
    const inactiveSince = e.Status === 'Inactive' ? (was.Status === 'Inactive' && was.InactiveSince ? was.InactiveSince : now) : '';
    Object.assign(e, { Modules: modules, InactiveSince: inactiveSince, UpdatedAt: now, UpdatedBy: nameOf(user) });
    if (snap.exists) tx.update(ref, e);
    else tx.set(ref, Object.assign(e, { CreatedAt: now, CreatedBy: nameOf(user) }));
  });
  return { success: true, CorporateID: id };
});

// Reaches the corporate's database, Firestore and Auth through the grant,
// each told apart, and says what it found.
exports.testDeveloperCorporate = onCallWithMessages(onCallOptions, async (request) => {
  await developer(request, 'access');
  const { id, entry } = await entryOf((request.data || {}).CorporateID);
  const part = async fn => { try { return { ok: true, detail: await fn() }; } catch (err) { return { ok: false, detail: (err && err.message) || String(err) }; } };
  let result;
  try {
    result = await runInCorporate({ id, entry }, async () => ({
      database: await part(async () => {
        const users = (await rtdb.ref('users').get()).val() || {};
        return Object.keys(users).length ? Object.keys(users).length + ' ERP user(s)' : 'reachable, no ERP users yet';
      }),
      firestore: await part(async () => { await firestore.doc('settings/documentStorage').get(); return 'reachable'; }),
      auth: await part(async () => { await admin.auth().listUsers(1); return 'reachable'; })
    }));
  } catch (err) {
    const failed = { ok: false, detail: (err && err.message) || String(err) };
    result = { database: failed, firestore: failed, auth: failed };
  }
  const ok = result.database.ok && result.firestore.ok && result.auth.ok;
  await entryRef(id).update({ LastTest: { At: new Date().toISOString(), Ok: ok } });
  return Object.assign({ ok }, result);
});

// ---------- modules ----------

// modules: { MODULEID: true | false } for every module ticked or not.
exports.saveDeveloperModules = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const d = request.data || {};
  const { id } = await entryOf(d.CorporateID);
  const given = d.modules || {};
  // A baseline module is kept only when switched off; a later one only when
  // switched on (entitlements.js).
  const set = {};
  MODULE_REGISTRY.forEach(m => {
    if (HOME_ONLY.has(m.id) || ALWAYS_ON.includes(m.id)) return;
    if (isBaseline(m.id)) { if (given[m.id] === false) set[m.id] = false; } else if (given[m.id] === true) set[m.id] = true;
  });
  // The whole map is replaced (a set, not a merge of fields).
  await entryRef(id).update({ Modules: set, ModulesUpdatedAt: new Date().toISOString(), ModulesUpdatedBy: nameOf(user) });
  return { success: true, off: Object.keys(set).filter(k => set[k] === false), on: Object.keys(set).filter(k => set[k] === true) };
});

// ---------- groups (decision 259) ----------
//
// A group (Firestore corporateGroups, the firm's) is a category of client
// corporates. The firm provides a module that came after the baseline to
// groups: every corporate in a ticked group gets it, and one in a group
// it is taken from loses it. A corporate can still be ticked one by one
// afterwards (Modules).

exports.saveDeveloperGroup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const d = request.data || {};
  const name = str(d.Name, 80);
  if (!name) throw new HttpsError('invalid-argument', 'Give the group a name.');
  const now = new Date().toISOString();
  const all = await firm.firestore.collection(GROUPS).get();
  if (all.docs.some(g => g.id !== d.GroupID && String(g.get('Name')).toLowerCase() === name.toLowerCase())) throw new HttpsError('already-exists', 'There is a group "' + name + '" already.');
  if (d.GroupID) {
    const ref = firm.firestore.doc(GROUPS + '/' + str(d.GroupID, 40));
    if (!(await ref.get()).exists) throw new HttpsError('not-found', 'That group is not there any more.');
    await ref.update({ Name: name, UpdatedAt: now, UpdatedBy: nameOf(user) });
    return { success: true, GroupID: ref.id };
  }
  const ref = await firm.firestore.collection(GROUPS).add({ Name: name, Modules: [], CreatedAt: now, CreatedBy: nameOf(user), UpdatedAt: now, UpdatedBy: nameOf(user) });
  return { success: true, GroupID: ref.id };
});

// modules: the later (non-baseline) modules provided to the group.
exports.saveDeveloperGroupModules = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const d = request.data || {};
  const ref = firm.firestore.doc(GROUPS + '/' + (str(d.GroupID, 40) || '-'));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That group is not there any more.');
  const later = MODULE_REGISTRY.filter(m => !isBaseline(m.id) && !m.homeOnly).map(m => m.id);
  const wanted = (Array.isArray(d.modules) ? d.modules : []).filter(m => later.includes(m));
  const before = snap.get('Modules') || [];
  const now = new Date().toISOString();
  const members = await firm.firestore.collection(DIRECTORY).where('Group', '==', snap.id).get();
  const batch = firm.firestore.batch();
  batch.update(ref, { Modules: wanted, UpdatedAt: now, UpdatedBy: nameOf(user) });
  members.forEach(c => {
    const modules = Object.assign({}, c.get('Modules') || {});
    wanted.forEach(m => { modules[m] = true; });
    before.filter(m => !wanted.includes(m)).forEach(m => { delete modules[m]; });
    batch.update(c.ref, { Modules: modules, ModulesUpdatedAt: now, ModulesUpdatedBy: nameOf(user) });
  });
  await batch.commit();
  return { success: true, corporates: members.docs.map(c => c.id), modules: wanted };
});

// ---------- notes ----------

exports.getDeveloperNotes = onCallWithMessages(onCallOptions, async (request) => {
  await developer(request, 'access');
  const { id } = await entryOf((request.data || {}).CorporateID);
  const [snap, users] = await Promise.all([
    firm.firestore.collection(NOTES).where('CorporateID', '==', id).get(),
    rtdb.ref('users').get()
  ]);
  const all = users.val() || {};
  const staff = Object.keys(all).filter(uid => all[uid] && all[uid].status === 'Active')
    .map(uid => ({ uid, name: all[uid].fullName || all[uid].username || uid })).sort((a, b) => a.name.localeCompare(b.name));
  const notes = snap.docs.map(n => Object.assign({ NoteID: n.id }, n.data()))
    .sort((a, b) => String(b.UpdatedAt).localeCompare(String(a.UpdatedAt)));
  return { notes, staff };
});

exports.saveDeveloperNote = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const d = request.data || {};
  const { id } = await entryOf(d.CorporateID);
  const type = NOTE_TYPES.includes(d.Type) ? d.Type : null;
  if (!type) throw new HttpsError('invalid-argument', 'Choose the note\'s type: ' + NOTE_TYPES.join(', ') + '.');
  const note = {
    CorporateID: id, Type: type, Title: str(d.Title, 150), Text: str(d.Text, 5000),
    Status: NOTE_STATUSES.includes(d.Status) ? d.Status : 'Open', OwnerUID: '', OwnerName: '', DueDate: ''
  };
  if (!note.Title) throw new HttpsError('invalid-argument', 'Give the note a title.');
  // Who has it and by when: for a task or a bug (decision 251).
  if (type === 'Task' || type === 'Bug') {
    note.DueDate = str(d.DueDate, 10);
    if (note.DueDate && !/^\d{4}-\d{2}-\d{2}$/.test(note.DueDate)) throw new HttpsError('invalid-argument', 'The due date is not a date.');
    const owner = str(d.OwnerUID, 128);
    if (owner) {
      const p = (await rtdb.ref('users/' + owner).get()).val();
      if (!p || p.status !== 'Active') throw new HttpsError('invalid-argument', 'The owner must be an active user here.');
      note.OwnerUID = owner;
      note.OwnerName = p.fullName || p.username || owner;
    }
  }
  const now = new Date().toISOString();
  const noteId = str(d.NoteID, 64);
  if (noteId) {
    const ref = firm.firestore.collection(NOTES).doc(noteId);
    const snap = await ref.get();
    if (!snap.exists || snap.get('CorporateID') !== id) throw new HttpsError('not-found', 'That note is not there any more.');
    await ref.update(Object.assign(note, { UpdatedAt: now, UpdatedBy: nameOf(user) }));
    return { success: true, NoteID: noteId };
  }
  const ref = await firm.firestore.collection(NOTES).add(Object.assign(note, { CreatedAt: now, CreatedBy: nameOf(user), UpdatedAt: now, UpdatedBy: nameOf(user) }));
  return { success: true, NoteID: ref.id };
});

exports.deleteDeveloperNote = onCallWithMessages(onCallOptions, async (request) => {
  await developer(request, 'write');
  const d = request.data || {};
  const { id } = await entryOf(d.CorporateID);
  const ref = firm.firestore.collection(NOTES).doc(str(d.NoteID, 64) || '-');
  const snap = await ref.get();
  if (!snap.exists || snap.get('CorporateID') !== id) throw new HttpsError('not-found', 'That note is not there any more.');
  await ref.delete();
  return { success: true };
});

// ---------- the tree ----------
//
// The main tree is Corporate 100's (the firm keeps it in Tree
// Management). Its layout is what a fingerprint covers: each item's
// place, text and module, in order; not who may see it (roles are each
// corporate's own). A homeOnly module's item (Developer) is no other
// corporate's and is left out.
//   - "Follows the main tree": the corporate's layout is the main one.
//   - "Behind the main tree": unchanged since it was last given the main
//     tree, but the main tree has changed since. "Update" brings it up to
//     date (MULTI_CORPORATE.md, M4: each release will do it too).
//   - "Own layout": its Admin has changed it in Tree Management; it keeps
//     it. (A module a release adds will go into its "New modules" folder:
//     M3, decision 255.)

function layout(nodes) {
  const kids = {};
  Object.keys(nodes || {}).forEach(id => {
    const n = nodes[id];
    if (!n || HOME_ONLY.has(n.ModuleID || '')) return;
    (kids[n.ParentID || ''] = kids[n.ParentID || ''] || []).push(id);
  });
  Object.values(kids).forEach(list => list.sort((a, b) => (nodes[a].Order || 0) - (nodes[b].Order || 0) || a.localeCompare(b)));
  const lines = [];
  (function walk(parent, depth) {
    (kids[parent] || []).forEach(id => {
      lines.push({ id, depth, text: String(nodes[id].Text || ''), moduleId: String(nodes[id].ModuleID || '') });
      walk(id, depth + 1);
    });
  })('', 0);
  return lines;
}
const fingerprint = nodes => {
  const lines = layout(nodes);
  return lines.length ? createHash('sha256').update(JSON.stringify(lines.map(l => [l.depth, l.text, l.moduleId]))).digest('hex').slice(0, 16) : '';
};

// Read in the Developer's own request, which is Corporate 100's.
const mainTree = async () => (await rtdb.ref('tree').get()).val() || {};
// fn(rtdb) in the corporate's own database (the handle follows it).
const treeIn = (c, fn) => runInCorporate(c, () => fn(rtdb));

function treeStatus(entry, mainPrint, ownPrint) {
  if (!ownPrint) return 'empty';
  if (ownPrint === mainPrint) return 'main';
  if (entry.TreeSynced && ownPrint === entry.TreeSynced) return 'behind';
  return 'own';
}

exports.getDeveloperTree = onCallWithMessages(onCallOptions, async (request) => {
  await developer(request, 'access');
  const c = await entryOf((request.data || {}).CorporateID);
  const main = fingerprint(await mainTree());
  const own = fingerprint(await treeIn(c, async db => (await db.ref('tree').get()).val()));
  return { status: treeStatus(c.entry, main, own), syncedAt: c.entry.TreeSyncedAt || '', syncedBy: c.entry.TreeSyncedBy || '' };
});

// The main tree's layout given to a corporate. Who may see each item stays
// the corporate's: an item it already had (the same module, or the same
// folder path) keeps its roles; a new one gets the main tree's roles that
// the corporate has.
async function giveMainTree(c, user) {
  const main = await mainTree();
  const lines = layout(main);
  if (!lines.length) throw new HttpsError('failed-precondition', 'The main tree is empty.');
  const print = fingerprint(main);
  await treeIn(c, async db => {
    const [ownSnap, rolesSnap] = await Promise.all([db.ref('tree').get(), db.ref('roles').get()]);
    const own = ownSnap.val() || {};
    const roles = new Set(Object.keys(rolesSnap.val() || {}));
    const pathOf = (nodes, id) => { const p = []; for (let n = nodes[id]; n; n = nodes[n.ParentID]) p.unshift(String(n.Text || '')); return p.join(' / '); };
    const rolesOwn = {};
    Object.keys(own).forEach(id => {
      const n = own[id];
      rolesOwn[n.ModuleID ? 'm:' + n.ModuleID : 'p:' + pathOf(own, id)] = n.AllowedRoles || [];
    });
    const now = new Date().toISOString();
    const out = {};
    lines.forEach((l, i) => {
      const n = main[l.id];
      const key = l.moduleId ? 'm:' + l.moduleId : 'p:' + pathOf(main, l.id);
      const allowed = rolesOwn[key] || (n.AllowedRoles || []).filter(r => !roles.size || roles.has(r));
      out[l.id] = {
        Text: n.Text || '', ParentID: n.ParentID || '', Order: i, ModuleID: n.ModuleID || '', AllowedRoles: allowed,
        CreatedAt: n.CreatedAt || now, CreatedBy: n.CreatedBy || 'SYSTEM', UpdatedAt: now, UpdatedBy: nameOf(user)
      };
    });
    await db.ref('tree').set(out);
  });
  // What it has been offered: every module of the main tree (decision 255).
  const offered = [...new Set(lines.map(l => l.moduleId).filter(Boolean))];
  await entryRef(c.id).update({ TreeSynced: print, TreeOffered: offered, TreeSyncedAt: new Date().toISOString(), TreeSyncedBy: nameOf(user) });
  return print;
}

// "Back to the main tree": the corporate's own layout is replaced.
exports.resetDeveloperTree = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const c = await entryOf((request.data || {}).CorporateID);
  await giveMainTree(c, user);
  return { success: true, status: 'main' };
});

// A corporate with its own layout gets the main tree's modules it has
// never been offered (a module a release added) in a "New modules" folder
// at the top of its menu, for its Admin to place (decision 255). A module
// it was offered once and took out stays out. Its layout is otherwise
// left as it is. Returns the modules added.
const NEW_MODULES = 'New modules';
async function offerNewModules(c, main) {
  const mainLines = layout(main).filter(l => l.moduleId);
  const first = !Array.isArray(c.entry.TreeOffered);
  const offered = new Set(first ? mainLines.map(l => l.moduleId) : c.entry.TreeOffered);
  const added = [];
  await treeIn(c, async db => {
    const [ownSnap, rolesSnap] = await Promise.all([db.ref('tree').get(), db.ref('roles').get()]);
    const own = ownSnap.val() || {};
    const roles = new Set(Object.keys(rolesSnap.val() || {}));
    const has = new Set(Object.values(own).map(n => n.ModuleID).filter(Boolean));
    has.forEach(m => offered.add(m));
    const toOffer = mainLines.filter(l => !offered.has(l.moduleId) && !has.has(l.moduleId));
    if (!toOffer.length) return;
    const now = new Date().toISOString();
    const updates = {};
    let folderId = Object.keys(own).find(id => !own[id].ParentID && !own[id].ModuleID && own[id].Text === NEW_MODULES);
    const order = Math.max(-1, ...Object.values(own).map(n => Number(n.Order) || 0)) + 1;
    const allowedOf = n => (n.AllowedRoles || []).filter(r => !roles.size || roles.has(r));
    const folderRoles = new Set(folderId ? own[folderId].AllowedRoles || [] : []);
    toOffer.forEach((l, i) => {
      const n = main[l.id];
      allowedOf(n).forEach(r => folderRoles.add(r));
      updates['NODE-' + randomUUID().split('-')[0].toUpperCase()] = {
        Text: n.Text || l.moduleId, ParentID: '', Order: order + 1 + i, ModuleID: l.moduleId, AllowedRoles: allowedOf(n),
        CreatedAt: now, CreatedBy: 'SYSTEM', UpdatedAt: now, UpdatedBy: 'SYSTEM'
      };
      added.push(l.moduleId);
      offered.add(l.moduleId);
    });
    if (!folderId) {
      folderId = 'NODE-' + randomUUID().split('-')[0].toUpperCase();
      updates[folderId] = { Text: NEW_MODULES, ParentID: '', Order: order, ModuleID: '', AllowedRoles: [], CreatedAt: now, CreatedBy: 'SYSTEM', UpdatedAt: now, UpdatedBy: 'SYSTEM' };
    }
    Object.keys(updates).forEach(id => { if (id !== folderId) updates[id].ParentID = folderId; });
    updates[folderId] = Object.assign({}, own[folderId] || updates[folderId], { AllowedRoles: [...folderRoles], UpdatedAt: now });
    const write = {};
    Object.keys(updates).forEach(id => { write[id] = updates[id]; });
    await db.ref('tree').update(write);
  });
  if (first || added.length) await entryRef(c.id).update({ TreeOffered: [...offered] });
  return added;
}

// Brings every Active corporate that follows the main tree, but is behind
// it, up to date. A corporate with its own layout keeps it, and gets the
// main tree's new modules in its "New modules" folder.
exports.updateDeveloperTreeFollowers = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  return updateFollowers(user);
});

// Also run by each release (tools/release-corporates.js, decision 263), as
// SYSTEM. In Corporate 100.
async function updateFollowers(user) {
  const mainNodes = await mainTree();
  const main = fingerprint(mainNodes);
  const dir = await firm.firestore.collection(DIRECTORY).where('Status', '==', 'Active').get();
  const updated = [], failed = [], offered = [];
  for (const d of dir.docs) {
    const c = { id: d.id, entry: d.data() };
    try {
      const own = fingerprint(await treeIn(c, async db => (await db.ref('tree').get()).val()));
      const status = treeStatus(c.entry, main, own);
      if (status === 'behind') { await giveMainTree(c, user); updated.push(c.id); }
      if (status === 'own') {
        const added = await offerNewModules(c, mainNodes);
        if (added.length) offered.push({ CorporateID: c.id, modules: added });
      }
    } catch (err) {
      failed.push({ CorporateID: c.id, error: (err && err.message) || String(err) });
    }
  }
  return { success: true, updated, offered, failed };
}

// ---------- onboarding (M4) ----------

// The client's first Admin (decision 260): an account in the client's own
// Auth, with no password, and its ERP profile (role ADMIN) in its
// database. The screen then has the client's Auth send the password-setting
// email.
exports.createDeveloperAdmin = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const d = request.data || {};
  const c = await entryOf(d.CorporateID);
  const email = str(d.Email, 200).toLowerCase(), name = str(d.Name, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError('invalid-argument', 'Give the Admin\'s email address.');
  if (!name) throw new HttpsError('invalid-argument', 'Give the Admin\'s name.');
  const out = await runInCorporate(c, async () => {
    const users = (await rtdb.ref('users').get()).val() || {};
    if (Object.values(users).some(u => u && u.role === 'ADMIN' && u.status === 'Active')) {
      throw new HttpsError('failed-precondition', 'Corporate ' + c.id + ' has an Admin already: its own Admin adds users in User Management.');
    }
    let account;
    try { account = await admin.auth().getUserByEmail(email); } catch (err) { account = null; }
    if (!account) account = await admin.auth().createUser({ email, displayName: name, emailVerified: false });
    await require('./roles').ensureRolesSeeded();
    const now = new Date().toISOString();
    await rtdb.ref('users/' + account.uid).set({
      username: email.split('@')[0], fullName: name, email, role: 'ADMIN', status: 'Active', AssignedCompanies: [],
      createdAt: now, createdBy: nameOf(user) + ' (the support team)'
    });
    return { uid: account.uid };
  });
  await entryRef(c.id).update({ FirstAdmin: { Email: email, Name: name, At: new Date().toISOString(), By: nameOf(user) } });
  return { success: true, uid: out.uid, email, webConfig: c.entry.WebConfig || {} };
});

// The chart's headings as Corporate 100's are now (decision 261): its
// non-posting accounts at heading codes, with no posting account and no
// balance. Only into an empty chart.
exports.copyDeveloperChartHeaders = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const c = await entryOf((request.data || {}).CorporateID);
  const main = (await rtdb.ref('coa').get()).val() || {};
  const now = new Date().toISOString();
  const headings = {};
  Object.keys(main).forEach(id => {
    const a = main[id];
    if (!a || a.Status !== 'Active' || a.IsPostable !== false || levelOf(a.AccountCode) === 'account') return;
    headings[id] = {
      AccountCode: String(a.AccountCode), AccountName: a.AccountName || '', AccountType: a.AccountType || '', AccountSubType: a.AccountSubType || '',
      NormalBalance: a.NormalBalance || '', CashFlowCategory: a.CashFlowCategory || '', CashBank: a.CashBank || '', OwnCashBank: a.OwnCashBank || '',
      ParentAccountID: a.ParentAccountID || '', IsPostable: false, CompanyID: '', Status: 'Active',
      CreatedAt: now, CreatedBy: 'SYSTEM', UpdatedAt: now, UpdatedBy: 'SYSTEM'
    };
  });
  // A heading whose parent is not copied (a company's own, or inactive) goes to the top.
  Object.values(headings).forEach(h => { if (h.ParentAccountID && !headings[h.ParentAccountID]) h.ParentAccountID = ''; });
  if (!Object.keys(headings).length) throw new HttpsError('failed-precondition', 'Corporate 100 has no headings to copy.');
  await runInCorporate(c, async () => {
    const own = (await rtdb.ref('coa').get()).val() || {};
    if (Object.keys(own).length) throw new HttpsError('failed-precondition', 'Corporate ' + c.id + '\'s chart has accounts already: its Admin keeps it.');
    await rtdb.ref('coa').set(headings);
  });
  await entryRef(c.id).update({ ChartHeadings: { Count: Object.keys(headings).length, At: now, By: nameOf(user) } });
  return { success: true, count: Object.keys(headings).length };
});

// What the firm holds about a client that left (decision 265): its Support
// issues and their files, and the internal notes, KEEP_AFTER_LEAVING_DAYS
// after it was set Inactive. The directory entry stays, marked.
async function purgeLeavers(now) {
  const t = now || Date.now();
  const dir = await firm.firestore.collection(DIRECTORY).where('Status', '==', 'Inactive').get();
  const purged = [];
  for (const d of dir.docs) {
    const since = Date.parse(d.get('InactiveSince') || '');
    if (!since || d.get('PurgedAt') || t - since < KEEP_AFTER_LEAVING_DAYS * 86400000) continue;
    const issues = await firm.firestore.collection('supportIssues').where('CorporateID', '==', d.id).get();
    for (const i of issues.docs) {
      const msgs = await i.ref.collection('messages').get();
      for (const m of msgs.docs) await m.ref.delete();
      await i.ref.delete();
    }
    await firm.bucket().deleteFiles({ prefix: 'support/' + d.id + '/' }).catch(() => {});
    const notes = await firm.firestore.collection(NOTES).where('CorporateID', '==', d.id).get();
    for (const n of notes.docs) await n.ref.delete();
    await firm.firestore.doc('supportCounters/' + d.id).delete().catch(() => {});
    await d.ref.update({ PurgedAt: new Date(t).toISOString(), PurgedIssues: issues.size, PurgedNotes: notes.size });
    purged.push(d.id);
  }
  return purged;
}

exports.purgeDeveloperLeavers = onCallWithMessages(onCallOptions, async (request) => {
  await developer(request, 'write');
  return { success: true, purged: await purgeLeavers() };
});

module.exports._layout = { layout, fingerprint, treeStatus };
module.exports._release = { updateFollowers, purgeLeavers, KEEP_AFTER_LEAVING_DAYS };
