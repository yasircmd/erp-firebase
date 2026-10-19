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
const { createHash } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore, admin, firm, HOME_ID, corporateId, runInCorporate } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { DIRECTORY } = require('./corporates');
const { MODULE_REGISTRY } = require('./moduleRegistry');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'DEVELOPER';
const NOTES = 'corporateNotes';
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
  const [dir, notes] = await Promise.all([firm.firestore.collection(DIRECTORY).get(), firm.firestore.collection(NOTES).where('Status', 'in', ['Open', 'In progress']).get()]);
  const open = {};
  notes.forEach(n => { const c = n.get('CorporateID'); open[c] = (open[c] || 0) + 1; });
  const corporates = dir.docs.map(d => Object.assign({ CorporateID: d.id, OpenNotes: open[d.id] || 0 }, d.data()))
    .sort((a, b) => a.CorporateID.localeCompare(b.CorporateID, undefined, { numeric: true }));
  return {
    canWrite: await moduleHasCapability(MODULE_ID, 'write', user.profile.role),
    corporates,
    modules: MODULE_REGISTRY.filter(m => !m.homeOnly).map(m => ({ id: m.id, label: m.label, alwaysOn: ALWAYS_ON.includes(m.id) })),
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
  await firm.firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (d.isNew === true && snap.exists) throw new HttpsError('already-exists', 'Corporate ' + id + ' is already in the directory.');
    if (d.isNew !== true && !snap.exists) throw new HttpsError('not-found', 'Corporate ' + id + ' is not in the directory.');
    if (snap.exists) tx.update(ref, Object.assign(e, { UpdatedAt: now, UpdatedBy: nameOf(user) }));
    else tx.set(ref, Object.assign(e, { Modules: {}, CreatedAt: now, CreatedBy: nameOf(user), UpdatedAt: now, UpdatedBy: nameOf(user) }));
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
  const off = {};
  MODULE_REGISTRY.forEach(m => {
    if (HOME_ONLY.has(m.id) || ALWAYS_ON.includes(m.id)) return;
    if (given[m.id] === false) off[m.id] = false;
  });
  // The whole map is replaced (a set, not a merge of fields).
  await entryRef(id).update({ Modules: off, ModulesUpdatedAt: new Date().toISOString(), ModulesUpdatedBy: nameOf(user) });
  return { success: true, off: Object.keys(off) };
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
  await entryRef(c.id).update({ TreeSynced: print, TreeSyncedAt: new Date().toISOString(), TreeSyncedBy: nameOf(user) });
  return print;
}

// "Back to the main tree": the corporate's own layout is replaced.
exports.resetDeveloperTree = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const c = await entryOf((request.data || {}).CorporateID);
  await giveMainTree(c, user);
  return { success: true, status: 'main' };
});

// Brings every Active corporate that follows the main tree, but is behind
// it, up to date. Own layouts are left as they are.
exports.updateDeveloperTreeFollowers = onCallWithMessages(onCallOptions, async (request) => {
  const user = await developer(request, 'write');
  const main = fingerprint(await mainTree());
  const dir = await firm.firestore.collection(DIRECTORY).where('Status', '==', 'Active').get();
  const updated = [], failed = [];
  for (const d of dir.docs) {
    const c = { id: d.id, entry: d.data() };
    try {
      const own = fingerprint(await treeIn(c, async db => (await db.ref('tree').get()).val()));
      if (treeStatus(c.entry, main, own) === 'behind') { await giveMainTree(c, user); updated.push(c.id); }
    } catch (err) {
      failed.push({ CorporateID: c.id, error: (err && err.message) || String(err) });
    }
  }
  return { success: true, updated, failed };
});

module.exports._layout = { layout, fingerprint, treeStatus };
