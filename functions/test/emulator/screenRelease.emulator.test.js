// Screen releases (docs/modules/SCREENS_ON_HOSTING.md): getModuleFragment
// serving the active release after its access check, and the release
// logic in tools/screen-release.js (verify before switching, rollback,
// keep the last 10, never guess the target database).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, firestore, call, reset, baseFixture, PROJECT } = require('./_helpers');
const { MODULE_REGISTRY } = require('../../src/moduleRegistry');
const sr = require('../../../tools/screen-release');

const REGISTRY = MODULE_REGISTRY.map(m => m.id);
const SCREENS = sr.loadScreens();
let seq = 0;
const release = (opts = {}) => sr.releaseScreens(firestore, { screens: SCREENS, registryIds: REGISTRY, commit: 'test' + (++seq), ...opts });
const pointer = () => sr.activeRelease(firestore);
const releaseIds = async () => (await firestore.collection('screenReleases').listDocuments()).map(r => r.id).sort();

function fixture() {
  const f = baseFixture();
  f.permissions.COA.access = ['Admin'];        // Viewer can't open Chart of Accounts
  return f;
}

test.beforeEach(async () => { await reset(fixture()); });
test.after(async () => { await app.delete(); });

test('serves the active release, with canWrite as before', async () => {
  await release();
  const admin = await call('u-admin', 'getModuleFragment', { moduleId: 'coa' });
  assert.equal(admin.html, SCREENS.COA);
  assert.equal(admin.canWrite, true);
  const viewer = await call('u-viewer', 'getModuleFragment', { moduleId: 'JV' });
  assert.equal(viewer.html, SCREENS.JV);
  assert.equal(viewer.canWrite, false, 'JV has no write capability in the registry');
});

test('a new release, then a rollback, shows on the next open even with a warm cache', async () => {
  const first = await release();
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'COA' })).html, SCREENS.COA);
  const second = await release({ screens: { ...SCREENS, COA: SCREENS.COA + '<!-- second -->' } });
  assert.equal(await pointer(), second);
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'COA' })).html, SCREENS.COA + '<!-- second -->');
  await sr.rollback(firestore, first);
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'COA' })).html, SCREENS.COA);
});

test('no access is refused before any screen is looked up', async () => {
  // No release at all: if the screen were read first, this would be "no fragment file".
  await assert.rejects(call('u-viewer', 'getModuleFragment', { moduleId: 'COA' }),
    e => e.message === 'You do not have access to this module.' && e.status === 'PERMISSION_DENIED');
  await assert.rejects(call('u-admin', 'getModuleFragment', { moduleId: 'COA' }), /Module "COA" has no fragment file yet\./);
});

test('unknown module, not signed in, missing screen: the same messages as before', async () => {
  const id = await release();
  await assert.rejects(call('u-admin', 'getModuleFragment', { moduleId: 'NOPE' }), /Unknown module: NOPE/);
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/getModuleFragment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { moduleId: 'COA' } })
  });
  assert.equal((await res.json()).error.message, 'Please sign in again.');
  await firestore.doc('screenReleases/' + id + '/screens/UOM').delete();
  await assert.rejects(call('u-admin', 'getModuleFragment', { moduleId: 'UOM' }), /Module "UOM" has no fragment file yet\./);
});

test('a release with a missing, unknown or unconverted screen is refused', async () => {
  const good = await release();
  const { JV, ...noJv } = SCREENS;
  await assert.rejects(release({ screens: noJv }), /no screen for module JV/);
  await assert.rejects(release({ screens: { ...SCREENS, EXTRA: '<div></div>' } }), /screen EXTRA is not in MODULE_REGISTRY/);
  await assert.rejects(release({ screens: { ...SCREENS, UOM: 'google.script.run.x()' } }), /screen UOM still calls google\.script\.run/);
  assert.equal(await pointer(), good);
  assert.deepEqual(await releaseIds(), [good], 'nothing written');
});

test('a release that fails verification leaves the active release unchanged', async () => {
  const good = await release();
  await assert.rejects(release({ hooks: { afterWrite: ref => ref.collection('screens').doc('GRN').update({ html: 'tampered' }) } }),
    /failed verification \(GRN\); the active release is unchanged/);
  assert.equal(await pointer(), good);
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'GRN' })).html, SCREENS.GRN);
  const incomplete = (await sr.listReleases(firestore)).find(r => !r.complete);
  assert.ok(incomplete, 'listed as incomplete');
  await assert.rejects(sr.rollback(firestore, incomplete.id), /No complete release/);
  await assert.rejects(sr.rollback(firestore, 'nope'), /No complete release nope/);
});

test('keeps the last 10 releases, and never deletes the active one', async () => {
  const tiny = { screens: { A: '<a>', B: '<b>' }, registryIds: ['A', 'B'] };
  const at = i => new Date(Date.UTC(2026, 0, 1, 0, 0, i));
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await release({ ...tiny, now: at(i) }));
  assert.deepEqual(await releaseIds(), ids.slice(2));
  await sr.rollback(firestore, ids[2]);                  // the oldest kept one
  ids.push(await release({ ...tiny, now: at(12) }));
  assert.equal(await pointer(), ids[12]);
  // The new release became active before pruning, so ids[2] was no longer
  // active and went as the 11th.
  assert.deepEqual(await releaseIds(), ids.slice(3));
  await sr.rollback(firestore, ids[3]);
  await sr.prune(firestore, 2);
  assert.deepEqual(await releaseIds(), [ids[3], ids[11], ids[12]], 'the active release survives pruning');
});

test('the command line refuses to run without --project', async () => {
  const env = { ...process.env }; delete env.FIRESTORE_EMULATOR_HOST;
  const r = spawnSync('node', [path.join(__dirname, '../../../tools/screen-release.js'), 'release'], { env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: .* --project PROJECT_ID/);
  assert.deepEqual(await releaseIds(), []);
});
