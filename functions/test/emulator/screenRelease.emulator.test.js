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

test('verification reads back in groups: a missing or an extra screen still fails it; progress is logged', async () => {
  const good = await release();
  await assert.rejects(release({ hooks: { afterWrite: ref => ref.collection('screens').doc('WAREHOUSEMOVEMENT').delete() } }),
    /failed verification \(WAREHOUSEMOVEMENT\); the active release is unchanged/);
  await assert.rejects(release({ hooks: { afterWrite: ref => ref.collection('screens').doc('EXTRA').set({ html: 'x', sha256: 'y' }) } }),
    /failed verification \(unexpected screens\); the active release is unchanged/);
  assert.equal(await pointer(), good);
  const lines = [];
  await release({ log: m => lines.push(m) });
  const n = Object.keys(SCREENS).length;
  assert.ok(lines.includes('written ' + n + '/' + n) && lines.includes('verified ' + n + '/' + n), lines.join(' | '));
  assert.ok(lines.filter(l => l.startsWith('verified ')).length >= 5, 'read back in groups of 10');
});

test('a stalled read is retried, and given up after three tries', async () => {
  let calls = 0;
  const stallTwice = () => (++calls <= 2 ? new Promise(() => {}) : Promise.resolve('ok'));
  const logged = [];
  assert.equal(await sr.withRetry(stallTwice, 'x', { timeoutMs: 50, log: m => logged.push(m) }), 'ok');
  assert.equal(calls, 3);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /retrying x \(timed out after 0\.05s reading x\)/);
  await assert.rejects(sr.withRetry(() => new Promise(() => {}), 'y', { timeoutMs: 50 }), /timed out after 0\.05s reading y/);
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

// The Deploy workflow's warning after a functions deploy without screens
// (owner, 2026-10-02): compare screens/ with the active release.
test('compare: no release yet, a match, then changed / new / removed screens', async () => {
  const none = await sr.compareWithActive(firestore, SCREENS);
  assert.equal(none.active, null);
  assert.equal(none.added.length, Object.keys(SCREENS).length, 'with no release, every screen is new');
  await release();
  assert.deepEqual(await sr.compareWithActive(firestore, SCREENS), { active: await pointer(), changed: [], added: [], removed: [] });
  const local = { ...SCREENS, JV: SCREENS.JV + '<!-- edited -->', NEWMOD: '<div></div>' };
  delete local.COA;
  const d = await sr.compareWithActive(firestore, local);
  assert.deepEqual([d.changed, d.added, d.removed], [['JV'], ['NEWMOD'], ['COA']]);
});

test('compare on the command line: exit 0 when the active release matches screens/, 3 (and the list) when not', async () => {
  const cli = () => spawnSync('node', [path.join(__dirname, '../../../tools/screen-release.js'), 'compare', '--project', PROJECT],
    { env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080' }, encoding: 'utf8' });
  await release();
  const same = cli();
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /Screens: the active release matches screens\//);
  // A release made from older screens: the live JV and CBT differ from screens/.
  await release({ screens: { ...SCREENS, JV: SCREENS.JV + '<!-- old -->', CBT: SCREENS.CBT + '<!-- old -->' } });
  const diff = cli();
  assert.equal(diff.status, 3, diff.stderr);
  assert.match(diff.stdout, /Screens NOT released: 2 differ from the active release\.\n {2}changed: CBT, JV\n/);
});
