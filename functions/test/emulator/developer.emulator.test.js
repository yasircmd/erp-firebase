// The Developer module (docs/modules/MULTI_CORPORATE.md, M2): Corporate 100
// only; the directory; the modules a client corporate may use, enforced in
// its tree, screens, functions, Roles and Tree Management; the firm's
// internal notes; and the tree that follows the main one (Corporate 100's).
// A client corporate (200) is project erp-client-demo, as in the
// corporates suite.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { rtdb, firestore, reset, baseFixture, call, PROJECT } = require('./_helpers');
// What each release runs (tools/release-corporates.js), in-process: its
// button was removed (decision 269).
const developer = require('../../src/developer');
const follow = () => developer._release.updateFollowers({ uid: 'release', profile: { fullName: 'Release test' } });

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const ENTRY = { Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', WebConfig: { apiKey: 'demo-api-key', authDomain: CLIENT + '.firebaseapp.com', projectId: CLIENT }, Modules: {} };
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'dev-client-' + process.pid);
const clientRtdb = clientApp.database();

test.after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

function tokenFor(uid, project) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid,
    auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' }
  }) + '.';
}
async function cara(fn, data) {
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { __corporate: { id: '200', idToken: tokenFor('u-cara', CLIENT) }, __data: data === undefined ? null : data } })
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const entry = async id => (await firestore.doc('corporateDirectory/' + id).get()).data();

// A small tree: a folder with JV and Developer in it, and a second folder.
const node = (Text, ParentID, Order, ModuleID, AllowedRoles) => ({ Text, ParentID, Order, ModuleID: ModuleID || '', AllowedRoles: AllowedRoles || ['Admin', 'Viewer'] });
const MAIN = {
  N1: node('Finance', '', 0), N2: node('Journal Entry', 'N1', 1, 'JV'), N3: node('Developer', 'N1', 2, 'DEVELOPER', ['Admin']),
  N4: node('Admin', '', 3), N5: node('Roles', 'N4', 4, 'ROLES', ['Admin'])
};

async function setUp() {
  const f = baseFixture();
  f.tree = MAIN;
  await reset(f);
  await firestore.doc('corporateDirectory/200').set(ENTRY);
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/databases/(default)/documents', { method: 'DELETE' });
  const c = baseFixture();
  c.users = { 'u-cara': { status: 'Active', role: 'Admin', username: 'cara', fullName: 'Cara Client', AssignedCompanies: ['K1'] } };
  c.roles = { Admin: { Name: 'Admin', Status: 'Active' }, Clerk: { Name: 'Clerk', Status: 'Active' } };
  await clientRtdb.ref('/').set(c);
  await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/accounts', { method: 'DELETE' });
  await clientApp.auth().createUser({ uid: 'u-cara', email: 'cara@client.test', password: 'secret-1' });
  await firestore.doc('system/screens').set({ activeRelease: 'r-m2' });
  for (const id of ['JV', 'DEVELOPER', 'ROLES']) await firestore.doc('screenReleases/r-m2/screens/' + id).set({ html: '<p>' + id + '</p>' });
}
test.beforeEach(setUp);

test('the Developer module is Corporate 100\'s only, and changing it needs its write right', async () => {
  const r = await call('u-admin', 'getDeveloperCorporates', {});
  assert.equal(r.canWrite, true);
  assert.deepEqual(r.corporates.map(c => [c.CorporateID, c.Name, c.OpenNotes]), [['200', 'Demo client', 0]]);
  assert.equal(r.modules.some(m => m.id === 'DEVELOPER'), false, 'not a module a client can be given');
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'DEVELOPER' })).html, '<p>DEVELOPER</p>');
  // Viewer: may look, not change.
  assert.equal((await call('u-viewer', 'getDeveloperCorporates', {})).canWrite, false);
  await assert.rejects(call('u-viewer', 'saveDeveloperModules', { CorporateID: '200', modules: {} }), /permission to change the corporates/);
  // A client corporate never has it, whatever its roles say.
  await assert.rejects(cara('getDeveloperCorporates', {}), /only in Corporate 100/);
  await assert.rejects(cara('getModuleFragment', { moduleId: 'DEVELOPER' }), /You do not have access to this module/);
});

test('the directory: add, check, change; a new corporate can sign in', async () => {
  const add = o => call('u-admin', 'saveDeveloperCorporate', Object.assign({
    isNew: true, CorporateID: '300', Name: 'Third Co', ProjectID: 'third-co-erp', DatabaseURL: 'https://third-co-erp-default-rtdb.firebaseio.com/', WebConfig: { apiKey: 'k3', appId: '1:3:web:3' }
  }, o));
  await assert.rejects(add({ CorporateID: '100' }), /firm's own/);
  await assert.rejects(add({ CorporateID: 'a/b' }), /1–20 letters/);
  await assert.rejects(add({ ProjectID: 'Bad Project' }), /project ID/);
  await assert.rejects(add({ DatabaseURL: 'https://evil.example.com' }), /Realtime Database URL/);
  await assert.rejects(add({ WebConfig: {} }), /API key/);
  await assert.rejects(add({ Name: '' }), /a name/);
  // Active only once Test connection has passed (owner, 2026-10-23).
  await assert.rejects(add({ Status: 'Active' }), /Add it Inactive, then Test connection/);
  assert.equal((await add({ Status: 'Inactive' })).CorporateID, '300');
  await assert.rejects(add({ Status: 'Inactive' }), /already in the directory/);
  const e = await entry('300');
  assert.deepEqual([e.DatabaseURL, e.WebConfig, e.Modules, e.CreatedBy], ['https://third-co-erp-default-rtdb.firebaseio.com', { apiKey: 'k3', appId: '1:3:web:3', projectId: 'third-co-erp', authDomain: 'third-co-erp.firebaseapp.com' }, {}, 'Admin User']);
  const save = o => call('u-admin', 'saveDeveloperCorporate', Object.assign({ CorporateID: '300', Name: 'Third Co', ProjectID: 'third-co-erp', DatabaseURL: e.DatabaseURL, Status: 'Active', WebConfig: { apiKey: 'k3' } }, o));
  await assert.rejects(save(), /Test connection first/);
  await firestore.doc('corporateDirectory/300').update({ LastTest: { At: '2026-10-23T10:00:00Z', Ok: false, ProjectID: 'third-co-erp', DatabaseURL: e.DatabaseURL } });
  await assert.rejects(save(), /Test connection first/, 'a failed test');
  assert.equal((await call('u-admin', 'testDeveloperCorporate', { CorporateID: '300' })).ok, true);
  assert.deepEqual([(await entry('300')).LastTest.ProjectID, (await entry('300')).LastTest.DatabaseURL], ['third-co-erp', e.DatabaseURL], 'what was tested');
  assert.equal((await save()).CorporateID, '300');
  assert.deepEqual((await call('u-admin', 'corporateSignIn', { corporateId: '300' })).webConfig.projectId, 'third-co-erp');
  // Active: its other details save as before; another project is tested first.
  assert.equal((await save({ Name: 'Third Co' })).CorporateID, '300');
  await assert.rejects(save({ ProjectID: 'third-co-two', DatabaseURL: 'https://third-co-two-default-rtdb.firebaseio.com' }), /A new project or database URL is tested before it is used/);
  assert.equal((await entry('300')).ProjectID, 'third-co-erp', 'unchanged');
  // A change keeps its modules; Inactive refuses its sign-in.
  await firestore.doc('corporateDirectory/300').update({ Modules: { JV: false } });
  await call('u-admin', 'saveDeveloperCorporate', { CorporateID: '300', Name: 'Third Co LLC', ProjectID: 'third-co-erp', DatabaseURL: e.DatabaseURL, Status: 'Inactive', WebConfig: { apiKey: 'k3' } });
  assert.deepEqual([(await entry('300')).Name, (await entry('300')).Modules], ['Third Co LLC', { JV: false }]);
  await assert.rejects(call('u-admin', 'corporateSignIn', { corporateId: '300' }), /Invalid Corporate ID/);
  await assert.rejects(call('u-admin', 'saveDeveloperCorporate', { CorporateID: '400', Name: 'x', ProjectID: 'four-co-erp', DatabaseURL: 'https://four-co-erp.firebaseio.com', WebConfig: { apiKey: 'k' } }), /not in the directory/);
});

test('the connection test reaches the corporate\'s database, Firestore and Auth', async () => {
  const r = await call('u-admin', 'testDeveloperCorporate', { CorporateID: '200' });
  assert.deepEqual([r.ok, r.database.ok, r.database.detail, r.firestore.ok, r.auth.ok], [true, true, '1 ERP user(s)', true, true]);
  assert.equal((await entry('200')).LastTest.Ok, true);
  await assert.rejects(call('u-admin', 'testDeveloperCorporate', { CorporateID: '999' }), /not in the directory/);
});

test('modules switched off leave the corporate\'s tree, screens, functions, Roles and Tree Management', async () => {
  await clientRtdb.ref('tree').set(MAIN);
  const r = await call('u-admin', 'saveDeveloperModules', { CorporateID: '200', modules: { JV: false, USERMGMT: false, DEVELOPER: true, COA: true } });
  assert.deepEqual(r.off, ['JV'], 'always-on and Corporate-100 modules are not the firm\'s to tick');
  assert.deepEqual((await entry('200')).Modules, { JV: false });

  const tree = await cara('getMyTree', {});
  assert.deepEqual(tree.map(t => t.moduleId).filter(Boolean), ['ROLES'], 'no JV, never Developer');
  await assert.rejects(cara('getModuleFragment', { moduleId: 'JV' }), /You do not have access to this module/);
  // A function of the module refuses it too (its capability check).
  assert.deepEqual(await cara('getModulePermissionsForUser', { moduleId: 'JV' }), { canDraft: false, canPost: false, canRematch: false });
  const registry = (await cara('getModuleRegistry', {})).map(m => m.id);
  assert.ok(!registry.includes('JV') && !registry.includes('DEVELOPER') && registry.includes('COA'));
  const matrix = await cara('getModulePermissionsMatrix', {});
  assert.ok(!matrix.modules.some(m => m.id === 'JV'));
  // Roles saves what it lists; JV's rights are kept for when it is back.
  const jvBefore = (await clientRtdb.ref('permissions/JV').get()).val();
  const lists = {};
  matrix.modules.forEach(m => { lists[m.id] = matrix.permissions[m.id]; });
  assert.equal((await cara('saveAllModulePermissions', { allPermissions: lists })).success, true);
  assert.deepEqual((await clientRtdb.ref('permissions/JV').get()).val(), jvBefore);
  // Tree Management cannot link it.
  const saved = await cara('saveTreeNode', { nodeData: { Text: 'JV again', ParentID: '', ModuleID: 'JV', AllowedRoles: ['Admin'] } });
  assert.match(saved.error || '', /Unknown module: JV/);

  // Corporate 100 keeps every module.
  assert.ok((await call('u-admin', 'getMyTree', {})).some(t => t.moduleId === 'JV'));
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'JV' })).html, '<p>JV</p>');
  // Back on: everything is there again, rights as they were.
  await call('u-admin', 'saveDeveloperModules', { CorporateID: '200', modules: { JV: true } });
  assert.equal((await cara('getModuleFragment', { moduleId: 'JV' })).html, '<p>JV</p>');
  assert.ok((await cara('getMyTree', {})).some(t => t.moduleId === 'JV'));
});

test('internal notes: typed, owned and dated for a task or bug, the firm\'s only', async () => {
  const save = o => call('u-admin', 'saveDeveloperNote', Object.assign({ CorporateID: '200', Type: 'Task', Title: 'Set up payroll', Text: 'Before the first run', OwnerUID: 'u-approver', DueDate: '2026-11-01' }, o));
  await assert.rejects(save({ Type: 'Idea' }), /Choose the note's type/);
  await assert.rejects(save({ Title: ' ' }), /a title/);
  await assert.rejects(save({ OwnerUID: 'u-nobody' }), /active user/);
  await assert.rejects(save({ DueDate: '01/11/2026' }), /not a date/);
  const task = await save();
  await save({ Type: 'Note', Title: 'Talks to the CFO', OwnerUID: 'u-approver', DueDate: '2026-11-01' });
  let r = await call('u-admin', 'getDeveloperNotes', { CorporateID: '200' });
  const byTitle = Object.fromEntries(r.notes.map(n => [n.Title, n]));
  assert.deepEqual([byTitle['Set up payroll'].OwnerName, byTitle['Set up payroll'].DueDate, byTitle['Set up payroll'].Status], ['Approver', '2026-11-01', 'Open']);
  assert.deepEqual([byTitle['Talks to the CFO'].OwnerUID, byTitle['Talks to the CFO'].DueDate], ['', ''], 'a plain note has no owner or date');
  assert.ok(r.staff.some(s => s.uid === 'u-admin'), 'owners: the firm\'s active users');
  assert.equal((await call('u-admin', 'getDeveloperCorporates', {})).corporates[0].OpenNotes, 2);
  await save({ NoteID: task.NoteID, Status: 'Done' });
  assert.equal((await call('u-admin', 'getDeveloperCorporates', {})).corporates[0].OpenNotes, 1, 'done is not open');
  // In the firm's project, never the client's.
  assert.equal((await firestore.collection('corporateNotes').where('CorporateID', '==', '200').get()).size, 2);
  await firestore.doc('corporateDirectory/300').set(ENTRY);
  await assert.rejects(save({ CorporateID: '300', NoteID: task.NoteID }), /not there any more/, 'another corporate\'s note');
  await assert.rejects(call('u-viewer', 'deleteDeveloperNote', { CorporateID: '200', NoteID: task.NoteID }), /permission/);
  await call('u-admin', 'deleteDeveloperNote', { CorporateID: '200', NoteID: task.NoteID });
  r = await call('u-admin', 'getDeveloperNotes', { CorporateID: '200' });
  assert.deepEqual(r.notes.map(n => n.Title), ['Talks to the CFO']);
});

test('the tree: given the main one, behind it after a change, brought up to date; an own layout is kept', async () => {
  const status = async () => (await call('u-admin', 'getDeveloperTree', { CorporateID: '200' })).status;
  assert.equal(await status(), 'empty');
  await call('u-admin', 'resetDeveloperTree', { CorporateID: '200' });
  assert.equal(await status(), 'main');
  let own = (await clientRtdb.ref('tree').get()).val();
  assert.deepEqual(Object.values(own).map(n => n.Text).sort(), ['Admin', 'Finance', 'Journal Entry', 'Roles'], 'no Developer item');
  // Who sees what is the corporate's: its own role on JV stays through an update.
  await clientRtdb.ref('tree/N2/AllowedRoles').set(['Clerk']);
  assert.equal(await status(), 'main', 'roles are not the layout');

  // The main tree changes: the corporate is behind; a release brings it up.
  await rtdb.ref('tree/N6').set(node('Reports', '', 5));
  assert.equal(await status(), 'behind');
  assert.deepEqual((await follow()).updated, ['200']);
  assert.equal(await status(), 'main');
  own = (await clientRtdb.ref('tree').get()).val();
  assert.deepEqual(own.N2.AllowedRoles, ['Clerk'], 'its roles kept');
  assert.ok(Object.values(own).some(n => n.Text === 'Reports'));

  // Its Admin changes the layout: its own, left as it is by the update.
  await clientRtdb.ref('tree/N4/Text').set('Administration');
  assert.equal(await status(), 'own');
  await rtdb.ref('tree/N7').set(node('More', '', 6));
  assert.deepEqual((await follow()).updated, []);
  assert.equal((await clientRtdb.ref('tree/N4/Text').get()).val(), 'Administration');
  assert.equal(Object.values((await clientRtdb.ref('tree').get()).val()).some(n => n.Text === 'More'), false, 'its layout kept');

  // A module the main tree gains goes to its "New modules" folder, once
  // (decision 255).
  await rtdb.ref('tree/N8').set(node('Payroll', 'N1', 7, 'PAYROLL', ['Admin', 'Clerk']));
  const r = await follow();
  assert.deepEqual([r.updated, r.offered], [[], [{ CorporateID: '200', modules: ['PAYROLL'] }]]);
  own = (await clientRtdb.ref('tree').get()).val();
  const folder = Object.keys(own).find(id => own[id].Text === 'New modules');
  assert.ok(folder, 'the folder made');
  const placed = Object.values(own).find(n => n.ModuleID === 'PAYROLL');
  assert.deepEqual([placed.ParentID, placed.Text, placed.AllowedRoles, own[folder].ParentID], [folder, 'Payroll', ['Admin', 'Clerk'], '']);
  assert.equal(await status(), 'own', 'still its own layout');
  // Its Admin takes it out: not offered again.
  const payrollId = Object.keys(own).find(id => own[id].ModuleID === 'PAYROLL');
  await clientRtdb.ref('tree/' + payrollId).remove();
  assert.deepEqual((await follow()).offered, []);
  assert.equal(Object.values((await clientRtdb.ref('tree').get()).val()).some(n => n.ModuleID === 'PAYROLL'), false);
  // Back to the main tree, on request.
  await call('u-admin', 'resetDeveloperTree', { CorporateID: '200' });
  assert.equal(await status(), 'main');
  assert.equal((await clientRtdb.ref('tree/N4/Text').get()).val(), 'Admin');
  await assert.rejects(call('u-viewer', 'resetDeveloperTree', { CorporateID: '200' }), /permission/);
});
