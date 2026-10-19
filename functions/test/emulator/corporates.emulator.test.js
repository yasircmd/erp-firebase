// One request, one corporate (docs/modules/MULTI_CORPORATE.md §2–§4, M1):
// a second corporate in its own project (erp-client-demo) next to
// Corporate 100, each request reaching only its own corporate's data, a
// token only opening the corporate whose Auth signed it, the lock per
// corporate, and nothing reachable outside a request.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const firebaseAdmin = require('../../src/firebaseAdmin');
const { rtdb, firestore, reset, baseFixture, call, PROJECT } = require('./_helpers');
const lock = require('../../src/lock');
const attachments = require('../../src/attachments');

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const ENTRY = { Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', WebConfig: { apiKey: 'demo-api-key', authDomain: CLIENT + '.firebaseapp.com', projectId: CLIENT, appId: '1:1:web:1', Note: 'not for the client' } };
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'client-' + process.pid);
const clientRtdb = clientApp.database();
const clientFs = clientApp.firestore();

test.after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

function tokenFor(uid, project) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid,
    auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' }
  }) + '.';
}
// A call from a client corporate's app: no Authorization header (this
// project's Auth has no such user), the client's token in the envelope.
async function callIn(corporateId, idToken, fn, data) {
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { __corporate: { id: corporateId, idToken }, __data: data === undefined ? null : data } })
  });
  const body = await res.json();
  if (body.error) { const e = new Error(body.error.message); e.status = body.error.status; throw e; }
  return body.result;
}
const cara = (fn, data) => callIn('200', tokenFor('u-cara', CLIENT), fn, data);

async function setUp() {
  await reset(baseFixture());
  await firestore.doc('corporateDirectory/200').set(ENTRY);
  await firestore.doc('corporateDirectory/300').set(Object.assign({}, ENTRY, { Status: 'Inactive' }));
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/databases/(default)/documents', { method: 'DELETE' });
  const f = baseFixture();
  f.users = { 'u-cara': { status: 'Active', role: 'Admin', username: 'cara', fullName: 'Cara Client', AssignedCompanies: ['K1'] } };
  f.companies = { K1: { Status: 'Active', LegalName: 'Client Co', CompanyRefCode: '01', CreatedAt: '2025-01-01' } };
  await clientRtdb.ref('/').set(f);
  // The client's own Auth (the emulator checks a token's user exists).
  await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/accounts', { method: 'DELETE' });
  await clientApp.auth().createUser({ uid: 'u-cara', email: 'cara@client.test', password: 'secret-1' });
}
test.beforeEach(setUp);

test('sign-in: 100 is this project, a directory corporate gives only its public web config, others are refused', async () => {
  assert.deepEqual(await call('u-admin', 'corporateSignIn', { corporateId: '100' }), { corporateId: '100', home: true });
  const c = await callIn('', '', 'corporateSignIn', { corporateId: '200' }).catch(() => null);
  assert.equal(c, null, 'an envelope with no corporate is refused');
  const cfg = await (await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/corporateSignIn', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { corporateId: ' 200 ' } })
  })).json();
  assert.deepEqual(cfg.result, { corporateId: '200', home: false, webConfig: { apiKey: 'demo-api-key', authDomain: CLIENT + '.firebaseapp.com', projectId: CLIENT, appId: '1:1:web:1' } }, 'no other field of the entry');
  for (const id of ['300', '999', '200/x', '']) {
    await assert.rejects(call('u-admin', 'corporateSignIn', { corporateId: id }), /Invalid Corporate ID/, 'refused: ' + id);
  }
});

test('a client corporate\'s call reaches its own data only, and its token opens no other corporate', async () => {
  const s = await cara('completeLogin', { corporateId: '200' });
  assert.deepEqual([s.uid, s.fullName], ['u-cara', 'Cara Client']);
  assert.ok((await clientRtdb.ref('users/u-cara/lastLogin').get()).val(), 'Last Login in the client\'s database');
  assert.equal((await rtdb.ref('users/u-cara').get()).val(), null, 'nothing in the firm\'s');
  const companies = JSON.stringify(await cara('getActiveCompanies', {}));
  assert.ok(companies.includes('Client Co') && !companies.includes('Test Co One'), 'the client\'s companies, not Corporate 100\'s: ' + companies);
  // Corporate 100 is unchanged.
  assert.equal((await call('u-admin', 'completeLogin', { corporateId: '100' })).fullName, 'Admin User');
  assert.equal((await clientRtdb.ref('users/u-admin').get()).val(), null);

  // The typed ID must be the corporate whose Auth signed the user in.
  await assert.rejects(cara('completeLogin', { corporateId: '100' }), /Invalid Corporate ID/);
  await assert.rejects(call('u-admin', 'completeLogin', { corporateId: '200' }), /Invalid Corporate ID/);
  // A token from another project is not this corporate's.
  await assert.rejects(callIn('200', tokenFor('u-admin', PROJECT), 'restoreSession'), /Please sign in again/);
  // No token: as for any callable, no user.
  await assert.rejects(callIn('200', '', 'restoreSession'), /Please sign in again/);
  // An inactive or unknown corporate is refused before anything runs.
  await assert.rejects(callIn('300', tokenFor('u-cara', CLIENT), 'restoreSession'), /Invalid Corporate ID/);
  await assert.rejects(callIn('100', tokenFor('u-admin', PROJECT), 'restoreSession'), /Invalid Corporate ID/, '100 is never in an envelope');
});

test('writes go to the request\'s corporate (a hand-written callable and a ported one)', async () => {
  await cara('toggleFavorite', { moduleId: 'JV' });
  assert.deepEqual((await clientRtdb.ref('userFavorites/u-cara').get()).val(), [{ moduleId: 'JV', label: 'JV' }], 'the client\'s favourite');
  assert.equal((await rtdb.ref('userFavorites/u-cara').get()).val(), null);
  const fav100 = await call('u-admin', 'getMyFavorites', {});
  assert.equal(JSON.stringify(fav100).includes('JV'), false, '100 sees none of it');
  // The data going in arrives as the handler's request.data, unwrapped.
  assert.equal(JSON.stringify(await cara('getMyFavorites', {})).includes('JV'), true);
});

test('screens come from the firm\'s one release, behind the corporate\'s own access check', async () => {
  await firestore.doc('system/screens').set({ activeRelease: 'r-m1' });
  await firestore.doc('screenReleases/r-m1/screens/JV').set({ html: '<p>the one JV screen</p>' });
  assert.equal((await cara('getModuleFragment', { moduleId: 'JV' })).html, '<p>the one JV screen</p>');
  assert.equal((await clientFs.doc('system/screens').get()).exists, false, 'no release in the client\'s database');
  // The access check is the corporate's: no right to JV in 200, no screen.
  await clientRtdb.ref('permissions/JV/access').set(['Viewer']);
  await assert.rejects(cara('getModuleFragment', { moduleId: 'JV' }), /You do not have access to this module/);
  assert.equal((await call('u-admin', 'getModuleFragment', { moduleId: 'JV' })).html, '<p>the one JV screen</p>', '100\'s rights unchanged');
});

test('the lock is per corporate: one corporate never waits on another', async () => {
  await firestore.doc(lock.LOCK_DOC_PATH).set({ lockedAt: Date.now(), lockedBy: 'someone in 100' });
  const t0 = Date.now();
  const got = await firebaseAdmin.runInCorporate({ id: '200', entry: ENTRY }, () => lock.withGlobalLock('cara', async () => (await clientFs.doc(lock.LOCK_DOC_PATH).get()).data().lockedBy));
  assert.equal(got, 'cara', 'the lock taken is in the client\'s Firestore');
  assert.ok(Date.now() - t0 < lock.LOCK_TIMEOUT_MS / 2, 'not held up by 100\'s lock');
  assert.equal((await firestore.doc(lock.LOCK_DOC_PATH).get()).data().lockedBy, 'someone in 100', '100\'s lock untouched');
  await firestore.doc(lock.LOCK_DOC_PATH).delete();
});

test('concurrent requests each keep their own corporate; outside one, nothing is reachable', async () => {
  const name = () => firebaseAdmin.rtdb.ref('users').get().then(s => Object.keys(s.val() || {}).sort().join(','));
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const [a, b] = await Promise.all([
    firebaseAdmin.runInCorporate({ id: '200', entry: ENTRY }, async () => { await pause(30); return [firebaseAdmin.corporateId(), await name()]; }),
    firebaseAdmin.runInCorporate({ id: '100' }, async () => { await pause(5); return [firebaseAdmin.corporateId(), await name()]; })
  ]);
  assert.deepEqual(a, ['200', 'u-cara']);
  assert.deepEqual(b, ['100', 'u-admin,u-approver,u-other,u-viewer']);
  firebaseAdmin.useCorporateOutsideRequests(null);
  try {
    assert.throws(() => firebaseAdmin.rtdb.ref('users'), /No corporate for this request/);
    assert.throws(() => firebaseAdmin.firestore.collection('x'), /No corporate for this request/);
    assert.throws(() => firebaseAdmin.admin.auth(), /No corporate for this request/);
  } finally {
    firebaseAdmin.useCorporateOutsideRequests({ id: '100' });
  }
  assert.throws(() => firebaseAdmin.runInCorporate({ id: '200' }, () => 1), /Corporate 200 is not set up/, 'a client corporate needs its entry');
});

test('Drive sign-in: the link carries its corporate, and Google\'s return finds it', async () => {
  await clientFs.doc('settings/documentStorage').set({ ClientID: '1-x.apps.googleusercontent.com', ClientSecret: 's' });
  const url = new URL((await cara('startDriveConnect', {})).url);
  const state = url.searchParams.get('state');
  assert.match(state, /^200\./);
  assert.ok((await clientFs.doc('settings/documentStorage/pending/' + state).get()).exists, 'pending in the client\'s own database');
  assert.deepEqual(await attachments._corporateOfState(state), { id: '200', entry: ENTRY });
  assert.deepEqual(await attachments._corporateOfState('100.abc'), { id: '100' });
  assert.deepEqual(await attachments._corporateOfState('a-link-from-before'), { id: '100' });
  assert.equal(await attachments._corporateOfState('300.abc'), null, 'an inactive corporate');
  // The return page, end to end: the expired message comes from the
  // client's database (no such pending record there).
  const page = await (await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/driveOAuthCallback?state=200.nope&code=x')).text();
  assert.match(page, /This sign-in link has expired/);
});
