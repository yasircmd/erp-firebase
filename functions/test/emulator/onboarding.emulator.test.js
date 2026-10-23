// Onboarding and each release (docs/modules/MULTI_CORPORATE.md, M4;
// decisions 258-265): client groups and a module added after the baseline
// (off until the firm provides it to a group or a corporate); the first
// Admin; the chart's headings; deleting what the firm holds about a client
// 90 days after it left; and the release to every corporate (rules, tree,
// leavers). The Developer functions run in-process (.run), so the test can
// add a stand-in "later" module to the registry.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const firebaseAdmin = require('../../src/firebaseAdmin');
const { MODULE_REGISTRY } = require('../../src/moduleRegistry');
// A module added after the baseline (moduleBaseline.js), as a later release would.
MODULE_REGISTRY.push({ id: 'LATERMOD', label: 'A later module', capabilities: ['access'] });
const { rtdb, firestore, reset, baseFixture } = require('./_helpers');
const developer = require('../../src/developer');
const { moduleAvailable } = require('../../src/entitlements');
const release = require('../../../tools/release-corporates');

const corp = (id, project) => ({ id, project, db: 'https://' + project + '-default-rtdb.firebaseio.com' });
const C200 = corp('200', 'erp-client-demo'), C300 = corp('300', 'erp-client-two');
const apps = {};
for (const c of [C200, C300]) apps[c.id] = admin.initializeApp({ projectId: c.project, databaseURL: c.db }, 'onb-' + c.id + '-' + process.pid);

test.after(async () => { MODULE_REGISTRY.pop(); await Promise.all(admin.apps.map(a => a.delete())); });

const dev = (fn, data, uid) => developer[fn].run({ data: data || {}, auth: { uid: uid || 'u-admin' }, rawRequest: { headers: {} } });
const entry = async id => (await firestore.doc('corporateDirectory/' + id).get()).data();
const has = async (c, moduleId) => firebaseAdmin.runInCorporate({ id: c.id, entry: await entry(c.id) }, () => moduleAvailable(moduleId));
const saveCorp = (c, o) => dev('saveDeveloperCorporate', Object.assign({ CorporateID: c.id, Name: 'Client ' + c.id, ProjectID: c.project, DatabaseURL: c.db, WebConfig: { apiKey: 'k' }, Status: 'Active' }, o));

async function setUp() {
  await reset(baseFixture());
  for (const c of [C200, C300]) {
    await firestore.doc('corporateDirectory/' + c.id).set({ Name: 'Client ' + c.id, ProjectID: c.project, DatabaseURL: c.db, Status: 'Active', WebConfig: { apiKey: 'k', projectId: c.project }, Modules: {} });
    await apps[c.id].database().ref('/').set(null);
    await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + c.project + '/databases/(default)/documents', { method: 'DELETE' });
    await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + c.project + '/accounts', { method: 'DELETE' });
  }
}
test.beforeEach(setUp);

test('a later module is off for every client until provided to its group or to it; the baseline stays as it was', async () => {
  assert.deepEqual([await has(C200, 'LATERMOD'), await has(C200, 'JV')], [false, true]);
  assert.equal(await firebaseAdmin.runInCorporate({ id: '100' }, () => moduleAvailable('LATERMOD')), true, 'Corporate 100 has it at once');
  const listed = (await dev('getDeveloperCorporates')).modules.find(m => m.id === 'LATERMOD');
  assert.deepEqual([listed.baseline, (await dev('getDeveloperCorporates')).modules.find(m => m.id === 'JV').baseline], [false, true]);

  await assert.rejects(dev('saveDeveloperGroup', { Name: ' ' }), /a name/);
  const retail = (await dev('saveDeveloperGroup', { Name: 'Retail' })).GroupID;
  await assert.rejects(dev('saveDeveloperGroup', { Name: 'retail' }), /already/);
  await saveCorp(C200, { Group: retail });
  assert.equal(await has(C200, 'LATERMOD'), false, 'in the group, nothing provided yet');
  const r = await dev('saveDeveloperGroupModules', { GroupID: retail, modules: ['LATERMOD', 'JV'] });
  assert.deepEqual([r.modules, r.corporates], [['LATERMOD'], ['200']], 'only later modules are provided by group');
  assert.deepEqual([await has(C200, 'LATERMOD'), await has(C300, 'LATERMOD')], [true, false]);
  // Joining the group gives it what the group has.
  await saveCorp(C300, { Group: retail });
  assert.equal(await has(C300, 'LATERMOD'), true);
  // Taken from the group: its corporates lose it.
  await dev('saveDeveloperGroupModules', { GroupID: retail, modules: [] });
  assert.deepEqual([await has(C200, 'LATERMOD'), await has(C300, 'LATERMOD')], [false, false]);
  // One corporate on its own: ticked in its Modules.
  const saved = await dev('saveDeveloperModules', { CorporateID: '300', modules: { LATERMOD: true, JV: false } });
  assert.deepEqual([saved.on, saved.off], [['LATERMOD'], ['JV']]);
  assert.deepEqual([await has(C300, 'LATERMOD'), await has(C300, 'JV')], [true, false]);
  await assert.rejects(dev('saveDeveloperGroup', { Name: 'X' }, 'u-viewer'), /permission/);
});

test('the first Admin: made in the client\'s own Auth with its ERP profile, once', async () => {
  await assert.rejects(dev('createDeveloperAdmin', { CorporateID: '200', Name: 'Ann', Email: 'nope' }), /email address/);
  const r = await dev('createDeveloperAdmin', { CorporateID: '200', Name: 'Ann Admin', Email: 'Ann@Client.test' });
  assert.equal(r.email, 'ann@client.test');
  const account = await apps['200'].auth().getUserByEmail('ann@client.test');
  assert.equal(account.uid, r.uid);
  const profile = (await apps['200'].database().ref('users/' + r.uid).get()).val();
  assert.deepEqual([profile.role, profile.status, profile.fullName], ['ADMIN', 'Active', 'Ann Admin']);
  assert.ok((await apps['200'].database().ref('roles/ADMIN').get()).exists(), 'its roles seeded');
  assert.equal((await rtdb.ref('users/' + r.uid).get()).val(), null, 'nothing in the firm\'s database');
  assert.equal((await entry('200')).FirstAdmin.Email, 'ann@client.test');
  await assert.rejects(dev('createDeveloperAdmin', { CorporateID: '200', Name: 'Bob', Email: 'bob@client.test' }), /has an Admin already/);
});

test('the chart starts with Corporate 100\'s current headings only, into an empty chart', async () => {
  const acc = (code, name, o) => Object.assign({ AccountCode: code, AccountName: name, AccountType: 'Asset', NormalBalance: 'Debit', IsPostable: false, Status: 'Active', CompanyID: '' }, o);
  await rtdb.ref('coa').set({
    A1: acc('100000', 'Assets'), A2: acc('110000', 'Cash', { ParentAccountID: 'A1', CashBank: 'Cash' }), A3: acc('111000', 'Petty cash', { ParentAccountID: 'A2', CompanyID: 'C1' }),
    A4: acc('110001', 'Main cash', { ParentAccountID: 'A2', IsPostable: true, CompanyID: 'C1' }), A5: acc('120000', 'Old heading', { ParentAccountID: 'A1', Status: 'Inactive' }),
    A6: acc('121000', 'Under an inactive one', { ParentAccountID: 'A5' })
  });
  const r = await dev('copyDeveloperChartHeaders', { CorporateID: '200' });
  assert.equal(r.count, 4);
  const coa = (await apps['200'].database().ref('coa').get()).val();
  assert.deepEqual(Object.keys(coa).sort(), ['A1', 'A2', 'A3', 'A6']);
  assert.deepEqual([coa.A3.CompanyID, coa.A3.ParentAccountID, coa.A2.CashBank, coa.A6.ParentAccountID, coa.A1.IsPostable], ['', 'A2', 'Cash', '', false],
    'shared, parents kept, a parent not copied: at the top');
  assert.equal(coa.A4, undefined, 'no posting account');
  await assert.rejects(dev('copyDeveloperChartHeaders', { CorporateID: '200' }), /has accounts already/);
});

test('what the firm holds about a client is deleted 90 days after it left, not before', async () => {
  const issue = await firestore.collection('supportIssues').add({ CorporateID: '300', Title: 'x', Status: 'New', UpdatedAt: 'x' });
  await issue.collection('messages').add({ Text: 'hello', At: 'x' });
  await firestore.collection('supportIssues').add({ CorporateID: '200', Title: 'kept', Status: 'New', UpdatedAt: 'x' });
  await firestore.collection('corporateNotes').add({ CorporateID: '300', Title: 'n', Status: 'Open' });
  await saveCorp(C300, { Status: 'Inactive' });
  const since = Date.parse((await entry('300')).InactiveSince);
  assert.ok(since);
  await saveCorp(C300, { Status: 'Inactive', Name: 'Renamed' });
  assert.equal(Date.parse((await entry('300')).InactiveSince), since, 'still from when it left');
  assert.deepEqual(await developer._release.purgeLeavers(since + 89 * 86400000), [], 'too early');
  assert.deepEqual(await developer._release.purgeLeavers(since + 91 * 86400000), ['300']);
  assert.deepEqual((await firestore.collection('supportIssues').get()).docs.map(d => d.get('CorporateID')), ['200'], 'only the leaver\'s');
  assert.equal((await firestore.collection('corporateNotes').get()).size, 0);
  assert.equal((await issue.collection('messages').get()).size, 0);
  assert.ok((await entry('300')).PurgedAt);
  assert.deepEqual(await developer._release.purgeLeavers(since + 200 * 86400000), [], 'once');
  // Active again before the time: nothing to delete.
  await saveCorp(C200, { Status: 'Inactive' });
  await saveCorp(C200, { Status: 'Active' });
  assert.equal((await entry('200')).InactiveSince, '');
});

test('each release: rules to every Active corporate (one not reached is reported), the followers\' tree, the leavers', async () => {
  await rtdb.ref('tree').set({ N1: { Text: 'Finance', ParentID: '', Order: 0, ModuleID: '', AllowedRoles: ['Admin'] }, N2: { Text: 'JV', ParentID: 'N1', Order: 1, ModuleID: 'JV', AllowedRoles: ['Admin'] } });
  await dev('resetDeveloperTree', { CorporateID: '200' });
  await rtdb.ref('tree/N3').set({ Text: 'Reports', ParentID: '', Order: 2, ModuleID: '', AllowedRoles: ['Admin'] });
  await firestore.doc('corporateDirectory/400').set({ Name: 'Gone', ProjectID: 'erp-client-gone', DatabaseURL: 'https://x.firebaseio.com', Status: 'Inactive' });
  const deployed = [];
  const r = await release.main({ deploy: p => { if (p === 'erp-client-two') throw new Error('Permission denied on erp-client-two'); deployed.push(p); } });
  assert.deepEqual(deployed, ['erp-client-demo'], 'Active ones only');
  assert.deepEqual([r.rules.done.length, r.rules.failed.length], [1, 1]);
  assert.match(r.rules.failed[0], /^300 \(erp-client-two\): Permission denied/);
  const [e200, e300] = [await entry('200'), await entry('300')];
  assert.deepEqual([e200.Rules.Ok, e300.Rules.Ok, e300.Rules.Error], [true, false, 'Permission denied on erp-client-two']);
  assert.deepEqual(r.tree.updated, ['200'], 'the follower brought up to date');
  assert.ok(Object.values((await apps['200'].database().ref('tree').get()).val()).some(n => n.Text === 'Reports'));
  assert.deepEqual(r.purged, []);
});
