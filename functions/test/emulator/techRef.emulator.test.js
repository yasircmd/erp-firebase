// The Technical Reference (owner, 2026-11-07; docs/modules/TECH_REFERENCE.md,
// Q419-Q422): built from the repository into a screens release, served to
// the firm's users with the TECHREF access right; refused to others and to
// every client corporate (firm-only); a release without it says so.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const admin = require('firebase-admin');
const { firestore, rtdb, reset, baseFixture, call, PROJECT } = require('./_helpers');
const { MODULE_REGISTRY } = require('../../src/moduleRegistry');
const sr = require('../../../tools/screen-release');

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'techref-client-' + process.pid);
test.after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

// The parts, built as the release builds them (its own process).
const partsFile = path.join(os.tmpdir(), 'techref-test-' + process.pid + '.json');
const built = spawnSync(process.execPath, [path.join(__dirname, '../../../tools/techref/build.js'), '--parts', partsFile, '--commit', 'abc1234'], { encoding: 'utf8' });
const PARTS = JSON.parse(fs.readFileSync(partsFile, 'utf8'));
fs.unlinkSync(partsFile);

function tokenFor(uid, project) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid,
    auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' } }) + '.';
}
async function asClient(fn, data) {
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { __corporate: { id: '200', idToken: tokenFor('u-cara', CLIENT) }, __data: data } }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
let seq = 0;
const release = techref => sr.releaseScreens(firestore, { screens: sr.loadScreens(), registryIds: MODULE_REGISTRY.map(m => m.id), commit: 'tr' + (++seq), techref });

test.before(async () => {
  assert.equal(built.status, 0, built.stdout + built.stderr);
  await reset(baseFixture());
  await firestore.doc('corporateDirectory/200').set({ Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', Modules: {},
    WebConfig: { apiKey: 'demo-api-key', authDomain: CLIENT + '.firebaseapp.com', projectId: CLIENT } });
  const c = baseFixture();
  c.users = { 'u-cara': { status: 'Active', role: 'Admin', username: 'cara', fullName: 'Cara Client', AssignedCompanies: ['K1'] } };
  await clientApp.database().ref('/').set(c);
  await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/accounts', { method: 'DELETE' });
  await clientApp.auth().createUser({ uid: 'u-cara', email: 'cara@client.test', password: 'secret-1' }).catch(() => {});
});

test('a release carries the reference; the firm\'s admin reads its parts and searches its documents', async () => {
  const id = await release(PARTS);
  const rel = (await firestore.doc('screenReleases/' + id).get()).data();
  assert.equal(rel.techrefParts, Object.keys(PARTS).length);
  const m = await call('u-admin', 'getTechRefPart', { part: 'meta' });
  assert.equal(m.release, id);
  assert.equal(m.data.commit, 'abc1234');
  assert.deepEqual(m.data.issues, []);
  assert.equal(m.data.counts.functions, JSON.parse(PARTS.cat_functions).length);
  const mods = (await call('u-admin', 'getTechRefPart', { part: 'cat_modules' })).data;
  const tr = mods.find(x => x.id === 'TECHREF');
  assert.ok(tr.firmOnly && tr.ownFunctions.includes('getTechRefPart'));
  const arch = m.data.documents.find(d => d.id === 'docs/ARCHITECTURE.md');
  const doc = (await call('u-admin', 'getTechRefPart', { part: arch.part })).data;
  assert.match(doc.html, /<h2[^>]*>Architecture overview<\/h2>/);
  const s = await call('u-admin', 'searchTechRef', { q: 'correction reclassify' });
  assert.ok(s.hits.some(h => h.id === 'docs/modules/CORRECTION_JV.md'), JSON.stringify(s.hits.map(h => h.id)));
  assert.match(s.hits[0].snippet, /\S/);
  await assert.rejects(call('u-admin', 'getTechRefPart', { part: '../screens/JV' }), /Unknown part/);
});

test('refused without the access right, and in every client corporate (firm-only)', async () => {
  await release(PARTS);
  await rtdb.ref('permissions/TECHREF').set({ access: ['Admin'] }); // the default: ADMIN only (the suites' fixture opens every module to Viewer)
  await assert.rejects(call('u-viewer', 'getTechRefPart', { part: 'meta' }), /do not have access to the Technical Reference/);
  await assert.rejects(call('u-viewer', 'searchTechRef', { q: 'lock' }), /do not have access to the Technical Reference/);
  await assert.rejects(asClient('getTechRefPart', { part: 'meta' }), /access/);
});

test('a release made without it says to release again', async () => {
  await release(null);
  await assert.rejects(call('u-admin', 'getTechRefPart', { part: 'meta' }), /has no Technical Reference: release the screens again/);
});
