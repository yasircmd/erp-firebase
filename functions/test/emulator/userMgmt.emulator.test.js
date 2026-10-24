// USERMGMT through its screen's callables. saveFirebaseUser's create path
// creates a real Firebase Auth account (runtime.js → admin.auth()), so this
// suite REQUIRES the Auth emulator: it checks the emulator is up before
// creating anything, and afterwards that the account exists THERE.
//   firebase emulators:start --only auth,database,firestore,functions --project erp1-8f4cd
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, PROJECT } = require('./_helpers');

const AUTH = 'http://127.0.0.1:9099';

test.before(async () => {
  const up = await fetch(AUTH + '/').then(r => r.ok || r.status < 500, () => false);
  if (!up) throw new Error('Auth emulator not reachable on 127.0.0.1:9099 — refusing to test user creation (it would hit production Auth).');
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' }); // emulator-only endpoint
  await reset(baseFixture());
});
test.after(async () => { await app.delete(); });

async function emulatorAccounts() {
  const r = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:query', {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}'
  });
  return ((await r.json()).userInfo || []).map(u => ({ uid: u.localId, email: u.email }));
}

test('create user: Auth account (in the emulator) + ERP profile', async () => {
  const r = await call('u-admin', 'saveFirebaseUser', { userData: { username: 'jdoe', email: 'JDoe@Example.test', fullName: 'Jane Doe', role: 'Viewer', password: 'secret123', assignedCompanies: ['C1'] } });
  const acct = (await emulatorAccounts()).find(a => a.email === 'jdoe@example.test');
  assert.ok(acct, 'account created in the Auth EMULATOR');
  // The new user's id comes back too (patch import-user-id, for Master Data Import).
  assert.deepEqual(r, { success: true, userId: acct.uid });
  const profile = await val('users/' + acct.uid);
  assert.equal(profile.fullName, 'Jane Doe');
  assert.equal(profile.role, 'Viewer');
  assert.deepEqual(profile.AssignedCompanies, ['C1']);
  const list = await call('u-admin', 'getAllFirebaseUsers');
  assert.ok(list.some(u => u.email === 'jdoe@example.test' && u.lastLogin === 'Never'));
});

test('validation: short password, unknown role, duplicate email', async () => {
  assert.equal((await call('u-admin', 'saveFirebaseUser', { userData: { username: 'a', fullName: 'A', email: 'a@example.test', password: '123', role: 'Viewer' } })).error, 'Password must be at least 6 characters.');
  assert.equal((await call('u-admin', 'saveFirebaseUser', { userData: { username: 'a', fullName: 'A', email: 'a@example.test', password: '123456', role: 'Pilot' } })).error, 'Unknown role: Pilot');
  assert.equal((await call('u-admin', 'saveFirebaseUser', { userData: { username: 'j2', fullName: 'J2', email: 'jdoe@example.test', password: '123456', role: 'Viewer' } })).error, 'EMAIL_EXISTS');
});

test('edit + delete (profile only); cannot delete yourself; Viewer refused', async () => {
  assert.deepEqual(await call('u-admin', 'saveFirebaseUser', { userData: { id: 'u-viewer', username: 'viewer', fullName: 'Viewer Renamed', role: 'Viewer', status: 'Active', assignedCompanies: ['C1'] } }), { success: true, userId: 'u-viewer' });
  assert.equal((await val('users/u-viewer')).fullName, 'Viewer Renamed');
  assert.equal((await call('u-admin', 'deleteFirebaseUser', { userId: 'u-admin' })).error, 'You cannot delete your own administrator profile.');
  assert.equal((await call('u-viewer', 'getAllFirebaseUsers').catch(e => e.message)), 'You do not have permission to manage users.');
  assert.deepEqual(await call('u-admin', 'deleteFirebaseUser', { userId: 'u-other' }), { success: true });
  assert.equal(await val('users/u-other'), null);
});

test('Last Login: set by a sign-in (completeLogin), not by a wrong Corporate ID or a restored session', async () => {
  await assert.rejects(call('u-viewer', 'completeLogin', { corporateId: '999' }), /Invalid Corporate ID/);
  assert.equal((await val('users/u-viewer')).lastLogin, undefined, 'a refused sign-in records nothing');
  const before = Date.now();
  await call('u-viewer', 'completeLogin', { corporateId: '100' });
  const stamp = (await val('users/u-viewer')).lastLogin;
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(stamp) >= before - 1000 && Date.parse(stamp) <= Date.now() + 1000, 'stamped now');
  await call('u-viewer', 'restoreSession');
  assert.equal((await val('users/u-viewer')).lastLogin, stamp, 'a reload is not a login');
  const list = await call('u-admin', 'getAllFirebaseUsers');
  assert.equal(list.find(u => u.id === 'u-viewer').lastLogin, stamp);
});

// Decision 272 (owner, 2026-10-24): light / dark saved with the user, on
// every device; light for one who never chose. Kept apart from the profile,
// so a User Management save can't lose it.
test('theme: light until chosen; saved with the user; kept through a User Management save', async () => {
  assert.equal((await call('u-viewer', 'restoreSession')).theme, 'light');
  assert.deepEqual(await call('u-viewer', 'saveMyTheme', { theme: 'dark' }), { theme: 'dark' });
  assert.equal((await call('u-viewer', 'restoreSession')).theme, 'dark');
  assert.equal((await call('u-admin', 'restoreSession')).theme, 'light', 'each user their own');
  const saved = await call('u-admin', 'saveFirebaseUser', { userData: { id: 'u-viewer', username: 'viewer', fullName: 'Viewer', role: 'Viewer', status: 'Active', assignedCompanies: ['C1'] } });
  assert.equal(saved.success, true, JSON.stringify(saved));
  assert.equal((await call('u-viewer', 'restoreSession')).theme, 'dark');
  await assert.rejects(call('u-viewer', 'saveMyTheme', { theme: 'blue' }), /light or dark/);
});

// Decision 271 (owner, 2026-10-24): sign-in with the Username, unique in the
// corporate (ignoring case). The email is told only for the right password,
// and every failure says the same, so nothing tells which user IDs exist.
const anon = async (fn, data) => {
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
};
const FAILED = /Invalid user ID or password\. A user ID shared by two users signs in by email\.$/;

test('usernames are unique, ignoring case; a user keeps their own on a save', async () => {
  const add = (username, email) => call('u-admin', 'saveFirebaseUser', { userData: { username, email, fullName: 'Kim ' + username, role: 'Viewer', password: 'secret123', assignedCompanies: ['C1'] } });
  const kim = await add('kim', 'kim@example.test');
  assert.equal(kim.success, true, kim.error);
  assert.equal((await add('KIM', 'kim2@example.test')).error, 'The username "KIM" is already Kim kim\'s: choose another.');
  // A rename onto another's is refused; saving with one's own is not.
  assert.match((await call('u-admin', 'saveFirebaseUser', { userData: { id: 'u-viewer', username: 'Kim', fullName: 'Viewer', role: 'Viewer', status: 'Active', assignedCompanies: ['C1'] } })).error, /already Kim kim's/);
  assert.equal((await call('u-admin', 'saveFirebaseUser', { userData: { id: kim.userId, username: 'kim', fullName: 'Kim Lee', role: 'Viewer', status: 'Active', assignedCompanies: ['C1'] } })).success, true);
});

test('sign-in by user ID: the email once the password is right; otherwise the same message for everything', async () => {
  assert.deepEqual(await anon('userIdSignIn', { corporateId: '100', userId: ' KIM ', password: 'secret123' }), { email: 'kim@example.test' });
  await assert.rejects(anon('userIdSignIn', { corporateId: '100', userId: 'kim', password: 'wrong-one' }), FAILED);
  await assert.rejects(anon('userIdSignIn', { corporateId: '100', userId: 'nobody', password: 'secret123' }), FAILED);
  await assert.rejects(anon('userIdSignIn', { corporateId: '999', userId: 'kim', password: 'secret123' }), /Invalid Corporate ID/);
  // Two users sharing one from before (written directly): by email only.
  await rtdb.ref('users/u-dup').set({ username: 'Kim', email: 'other@example.test', fullName: 'Other Kim', role: 'Viewer', status: 'Active' });
  await assert.rejects(anon('userIdSignIn', { corporateId: '100', userId: 'kim', password: 'secret123' }), FAILED);
  await rtdb.ref('users/u-dup').remove();
  // An inactive user signs in by no route.
  const kimUid = Object.entries((await rtdb.ref('users').get()).val()).find(([, u]) => u.username === 'kim')[0];
  await rtdb.ref('users/' + kimUid + '/status').set('Inactive');
  await assert.rejects(anon('userIdSignIn', { corporateId: '100', userId: 'kim', password: 'secret123' }), FAILED);
});
