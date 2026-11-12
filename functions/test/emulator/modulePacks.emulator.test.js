// Module Builder, phase 6 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q493-Q496): packs. A pack in the code published from the Packs tab (its
// modules as new versions only where they changed); provided to a group,
// which switches its modules and Pack setup on and installs it in each
// member (a menu folder, Admin only; the rights; the starter reports and
// tiles for the first Admin); a later version adds only what is new, never
// putting back what the client removed; taken away, its modules off. Pack
// setup's checklist: a module's Setup and the rights ticked by themselves,
// tax and manual items by hand. The Developer and Packs functions run
// in-process (.run), so the test can add its own pack to the code's list.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ERP_REACH_MS = '5000';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const firebaseAdmin = require('../../src/firebaseAdmin');
const { rtdb, firestore, call, reset, baseFixture } = require('./_helpers');
const developer = require('../../src/developer');
const packs = require('../../src/builtPacks');
const { PACKS } = require('../../src/packs');
const { moduleAvailable } = require('../../src/entitlements');

const ROOM = { id: 'X_DROOM', label: 'Demo room', kind: 'master', fields: [{ key: 'rate', label: 'Rate', type: 'amount' }] };
const STAY = { id: 'X_DSTAY', label: 'Demo stay', kind: 'document', numbering: { prefix: 'DS' },
  fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER' }, { key: 'room', label: 'Room', type: 'link', target: 'X_DROOM' }, { key: 'nights', label: 'Nights', type: 'number' }, { key: 'rate', label: 'Rate', type: 'amount' },
    { key: 'amount', label: 'Amount', type: 'calc', op: 'product', of: ['nights', 'rate'] }],
  statuses: [{ name: 'Booked' }, { name: 'Out' }, { name: 'Cancelled', final: true }],
  actions: [{ key: 'invoice', label: 'Invoice', target: 'CUSTOMERINVOICE', statuses: ['Out'], party: 'guest', amount: 'amount' }] };
const PACK = { id: 'P_DEMO', label: 'Demo stays', description: 'A pack for the test.', modules: ['X_DROOM', 'X_DSTAY'],
  menu: { folder: 'Demo stays', items: [{ module: 'X_DSTAY', text: 'Stays' }, { module: 'X_DROOM', text: 'Rooms' }] },
  reports: [{ key: 'byRoom', name: 'Nights by room', dataset: 'x:X_DSTAY', months: 1, spec: { view: 'group', groupBy: ['f_room'], measures: [{ field: 'f_nights', agg: 'sum' }] }, tile: 'chart' }],
  checklist: [{ key: 'books', kind: 'setup', module: 'X_DSTAY', text: 'Set the stay\'s books in its Setup.' }, { key: 'tax', kind: 'tax', text: 'Add the municipality fee in Tax Configuration.' },
    { key: 'roles', kind: 'rights', text: 'Give the front desk its rights.' }, { key: 'train', kind: 'manual', text: 'Show the staff.' }] };
PACKS.push({ pack: PACK, definitions: [ROOM, STAY] });

const C200 = { id: '200', project: 'erp-client-pack', db: 'https://erp-client-pack-default-rtdb.firebaseio.com' };
const client = admin.initializeApp({ projectId: C200.project, databaseURL: C200.db }, 'pack-' + process.pid);
test.after(async () => { PACKS.pop(); await Promise.all(admin.apps.map(a => a.delete())); });

const run = (mod, fn, data, uid) => mod[fn].run({ data: data || {}, auth: { uid: uid || 'u-admin' }, rawRequest: { headers: {} } });
const entry = async () => (await firestore.doc('corporateDirectory/200').get()).data();
const inC200 = async fn => firebaseAdmin.runInCorporate({ id: '200', entry: await entry() }, fn);
const ctree = async () => (await client.database().ref('tree').get()).val() || {};

test.beforeEach(async () => {
  await reset(baseFixture());
  await firestore.doc('corporateDirectory/200').set({ Name: 'Client 200', ProjectID: C200.project, DatabaseURL: C200.db, Status: 'Active', WebConfig: { apiKey: 'k', projectId: C200.project }, Modules: {} });
  await client.database().ref('/').set({
    users: { a1: { username: 'boss', fullName: 'Example Owner', role: 'ADMIN', status: 'Active', AssignedCompanies: ['K9'], createdAt: '2026-01-01' } },
    companies: { K9: { CompanyRefCode: 'K9', LegalName: 'Example Hotel LLC', Status: 'Active' } },
    tree: { N1: { Text: 'Finance', ParentID: '', ModuleID: '', Order: 0, AllowedRoles: ['ADMIN'] } }
  });
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + C200.project + '/databases/(default)/documents', { method: 'DELETE' });
});

test('a pack published (its modules only where they changed), provided to a group: menu, rights, starter reports and tiles; a later version adds only what is new; taken away', async () => {
  let list = (await run(packs, 'getModulePacks')).packs.find(p => p.id === 'P_DEMO');
  assert.deepEqual([list.version, list.changed, list.problem, list.modules.map(m => m.id), list.reports, list.checklist], [0, true, '', ['X_DROOM', 'X_DSTAY'], 1, 4]);
  const one = await run(packs, 'publishModulePack', { id: 'P_DEMO' });
  assert.deepEqual([one.version, one.modules], [1, [{ id: 'X_DROOM', version: 1 }, { id: 'X_DSTAY', version: 1 }]]);
  assert.equal((await run(packs, 'getModulePacks')).packs.find(p => p.id === 'P_DEMO').changed, false);
  assert.deepEqual((await run(packs, 'publishModulePack', { id: 'P_DEMO' })).modules, [], 'unchanged modules are not published again');
  await assert.rejects(run(packs, 'publishModulePack', { id: 'P_DEMO' }, 'u-viewer'), /publish packs/);

  // Provided to a group: its modules and Pack setup on, installed in the member.
  const g = (await run(developer, 'saveDeveloperGroup', { Name: 'Hotels' })).GroupID;
  await run(developer, 'saveDeveloperCorporate', { CorporateID: '200', Name: 'Client 200', ProjectID: C200.project, DatabaseURL: C200.db, WebConfig: { apiKey: 'k', projectId: C200.project }, Status: 'Active', Group: g });
  assert.equal(await inC200(() => moduleAvailable('X_DSTAY')), false);
  const r = await run(developer, 'saveDeveloperGroupModules', { GroupID: g, modules: [], packs: ['P_DEMO', 'P_NONE'] });
  assert.deepEqual(r.packs.map(x => [x.corporate, x.pack, x.menu, x.reports]), [['200', 'P_DEMO', ['PACKSETUP', 'X_DSTAY', 'X_DROOM'], ['byRoom']]]);
  assert.deepEqual([(await entry()).Packs, await inC200(() => moduleAvailable('X_DSTAY')), await inC200(() => moduleAvailable('PACKSETUP'))], [{ P_DEMO: true }, true, true]);
  let tree = await ctree();
  const folder = Object.entries(tree).find(([, n]) => n.Text === 'Demo stays');
  assert.ok(folder, JSON.stringify(tree));
  const kids = Object.values(tree).filter(n => n.ParentID === folder[0]).sort((a, b) => a.Order - b.Order);
  assert.deepEqual(kids.map(n => [n.Text, n.ModuleID, n.AllowedRoles.join()]), [['Pack setup', 'PACKSETUP', 'ADMIN'], ['Stays', 'X_DSTAY', 'ADMIN'], ['Rooms', 'X_DROOM', 'ADMIN']]);
  assert.equal(tree.N1.Text, 'Finance', 'the client\'s own menu kept');
  const perms = (await client.database().ref('permissions').get()).val();
  assert.deepEqual([perms.X_DSTAY.access, perms.PACKSETUP.write], [['ADMIN'], ['ADMIN']]);
  const cfs = client.firestore();
  const rep = (await cfs.collection('misReports').get()).docs.map(d => d.data());
  assert.deepEqual(rep.map(x => [x.Name, x.OwnerUID, x.CompanyID, x.Builder.dataset]), [['Nights by room', 'a1', 'K9', 'x:X_DSTAY']]);
  const dash = (await cfs.doc('misDashboards/a1').get()).data();
  assert.ok(dash.Tiles.length === 8 && /^saved:/.test(dash.Tiles[7].type), 'the starter tiles, then the pack\'s');

  // The client removes a screen from the folder; a new version adds only what is new.
  const rooms = Object.entries(tree).find(([, n]) => n.ModuleID === 'X_DROOM')[0];
  await client.database().ref('tree/' + rooms).remove();
  const NOTE = { id: 'X_DNOTE', label: 'Demo note', kind: 'master', fields: [{ key: 'text', label: 'Text', type: 'text' }] };
  PACKS[PACKS.length - 1] = { pack: Object.assign({}, PACK, { modules: PACK.modules.concat(['X_DNOTE']), menu: { folder: 'Demo stays', items: PACK.menu.items.concat([{ module: 'X_DNOTE', text: 'Notes' }]) } }), definitions: [ROOM, STAY, NOTE] };
  const two = await run(packs, 'publishModulePack', { id: 'P_DEMO' });
  assert.deepEqual([two.version, two.modules.map(m => m.id), two.corporates.map(c => [c.corporate, c.menu, c.reports])], [2, ['X_DNOTE'], [['200', ['X_DNOTE'], []]]]);
  tree = await ctree();
  assert.deepEqual(Object.values(tree).filter(n => n.ParentID === folder[0]).map(n => n.ModuleID).sort(), ['PACKSETUP', 'X_DNOTE', 'X_DSTAY'], 'the removed screen is not put back');
  assert.equal((await cfs.collection('misReports').get()).size, 1, 'no second copy of a report');
  assert.equal(await inC200(() => moduleAvailable('X_DNOTE')), false, 'a module a later version adds is provided again with the pack');
  await run(developer, 'saveDeveloperGroupModules', { GroupID: g, modules: [], packs: ['P_DEMO'] });
  assert.equal(await inC200(() => moduleAvailable('X_DNOTE')), true);

  // Taken away: its modules off, its data and menu kept.
  await run(developer, 'saveDeveloperGroupModules', { GroupID: g, modules: [], packs: [] });
  assert.deepEqual([(await entry()).Packs, await inC200(() => moduleAvailable('X_DSTAY')), await inC200(() => moduleAvailable('PACKSETUP'))], [{}, false, false]);
  PACKS[PACKS.length - 1] = { pack: PACK, definitions: [ROOM, STAY] };
});

test('Pack setup: the checklist, a module\'s Setup and the rights ticked by themselves, the others by hand; my own starter reports', async () => {
  await run(packs, 'publishModulePack', { id: 'P_DEMO' });
  // Admin's rights only (the test helper gives every module a Viewer's access).
  for (const m of ['X_DROOM', 'X_DSTAY']) await rtdb.ref('permissions/' + m).set({ access: ['Admin'], write: ['Admin'], void: ['Admin'] });
  // Corporate 100 has every published pack (the firm tries them).
  const setup = async () => (await call('u-admin', 'getPackSetup', {})).packs.find(p => p.id === 'P_DEMO');
  let s = await setup();
  assert.deepEqual(s.checklist.map(c => [c.key, c.done, c.auto]), [['books', false, true], ['tax', false, false], ['roles', false, true], ['train', false, false]]);
  assert.deepEqual([s.haveReports, s.reports.map(r => r.name)], [false, ['Nights by room']]);
  await assert.rejects(call('u-admin', 'tickPackItem', { pack: 'P_DEMO', key: 'books', done: true }), /ticked by itself/);
  await call('u-admin', 'tickPackItem', { pack: 'P_DEMO', key: 'tax', done: true });
  await assert.rejects(call('u-viewer', 'tickPackItem', { pack: 'P_DEMO', key: 'train', done: true }), /Pack setup: (write|access)/);
  await rtdb.ref('salesTypes/ST1').set({ Name: 'Rooms', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' });
  await call('u-admin', 'saveBuiltSetup', { moduleId: 'X_DSTAY', companyId: 'C1', actions: { invoice: { SalesTypeID: 'ST1', AccountCode: '4000' } } });
  await rtdb.ref('permissions/X_DROOM/access').set(['ADMIN', 'Viewer']);
  s = await setup();
  assert.deepEqual(s.checklist.map(c => c.done), [true, true, true, false]);
  await rtdb.ref('permissions/MIS').set({ access: ['Admin'], design: ['Admin'], publish: ['Admin'] });
  assert.equal((await call('u-admin', 'addPackReports', { pack: 'P_DEMO' })).reports, 1);
  assert.equal((await call('u-admin', 'addPackReports', { pack: 'P_DEMO' })).reports, 1, 'once');
  assert.equal((await firestore.collection('misReports').where('OwnerUID', '==', 'u-admin').get()).size, 1);
  assert.equal((await setup()).haveReports, true);
});
