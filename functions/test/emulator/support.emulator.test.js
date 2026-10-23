// Support (docs/modules/MULTI_CORPORATE.md, M3): a client corporate's Admin
// sends issues, confirming each time that they are shared with the firm;
// they are kept in the firm's project with their files in its Cloud
// Storage; each client sees only its own; the firm's queue has every
// corporate's and answers them. Two client corporates: 200
// (erp-client-demo) and 300 (erp-client-two).
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { firestore, reset, baseFixture, call, PROJECT, app } = require('./_helpers');

const PDF = Buffer.from('%PDF-1.4 support test').toString('base64');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const corp = (id, project) => ({ id, project, db: 'https://' + project + '-default-rtdb.firebaseio.com' });
const C200 = corp('200', 'erp-client-demo'), C300 = corp('300', 'erp-client-two');
const apps = {};
for (const c of [C200, C300]) apps[c.id] = admin.initializeApp({ projectId: c.project, databaseURL: c.db }, 'sup-' + c.id + '-' + process.pid);
const bucket = () => app.storage().bucket('erp1-8f4cd.firebasestorage.app');

test.after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

function tokenFor(uid, project) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + project, aud: project, sub: uid, user_id: uid,
    auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' }
  }) + '.';
}
const as = (c, uid) => async (fn, data) => {
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { __corporate: { id: c.id, idToken: tokenFor(uid, c.project) }, __data: data === undefined ? null : data } })
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
};
const cara = as(C200, 'u-cara'), clerk = as(C200, 'u-clerk'), dina = as(C300, 'u-dina');
const firmAdmin = (fn, data) => call('u-admin', fn, data);

async function setUp() {
  await reset(baseFixture());
  await firestore.doc('system/screens').set({ activeRelease: 'r-m3' });
  for (const [c, name, users] of [[C200, 'Demo client', { 'u-cara': 'Admin', 'u-clerk': 'Clerk' }], [C300, 'Second client', { 'u-dina': 'Admin' }]]) {
    await firestore.doc('corporateDirectory/' + c.id).set({ Name: name, ProjectID: c.project, DatabaseURL: c.db, Status: 'Active', WebConfig: { apiKey: 'k', projectId: c.project }, Modules: {} });
    const f = baseFixture();
    f.users = {};
    Object.entries(users).forEach(([uid, role]) => { f.users[uid] = { status: 'Active', role, username: uid.slice(2), fullName: uid.slice(2).toUpperCase() }; });
    await apps[c.id].database().ref('/').set(f);
    await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + c.project + '/databases/(default)/documents', { method: 'DELETE' });
    await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + c.project + '/accounts', { method: 'DELETE' });
    for (const uid of Object.keys(users)) await apps[c.id].auth().createUser({ uid });
  }
  const [files] = await bucket().getFiles({ prefix: 'support/' }).catch(() => [[]]);
  await Promise.all(files.map(f => f.delete()));
}
test.beforeEach(setUp);

const issue = o => Object.assign({ Type: 'Bug', Title: 'Invoice total wrong', Text: 'The total shows 0.', Screen: 'CUSTOMERINVOICE', shareConfirmed: true }, o || {});

test('only a client corporate\'s Support right sends issues, and only after confirming they are shared', async () => {
  await assert.rejects(cara('submitSupportIssue', issue({ shareConfirmed: false })), /Confirm first that what you send is shared/);
  await assert.rejects(cara('submitSupportIssue', issue({ Type: 'Idea' })), /Choose what it is/);
  await assert.rejects(cara('submitSupportIssue', issue({ Text: ' ' })), /Say what happened/);
  await assert.rejects(clerk('submitSupportIssue', issue()), /You do not have access to Support/, 'not given the right');
  const a = await cara('submitSupportIssue', issue());
  const b = await cara('submitSupportIssue', issue({ Type: 'Question', Title: 'How do I close a month?', Screen: '' }));
  const c = await dina('submitSupportIssue', issue({ Title: 'Second client issue' }));
  assert.deepEqual([a.Number, b.Number, c.Number], ['200-00001', '200-00002', '300-00001'], 'numbered per corporate');
  const saved = (await firestore.doc('supportIssues/' + a.IssueID).get()).data();
  assert.deepEqual([saved.CorporateID, saved.CorporateName, saved.Status, saved.Screen, saved.Context.AppVersion, saved.CreatedByName, saved.Shared],
    ['200', 'Demo client', 'New', { id: 'CUSTOMERINVOICE', label: 'Customer Invoice Processing' }, 'r-m3', 'CARA', true]);
  assert.ok(saved.Context.At && saved.Context.UserAgent !== undefined);
  // Kept in the firm's project, never in the client's.
  assert.equal((await apps['200'].firestore().collection('supportIssues').get()).size, 0);
  // Corporate 100 is the firm: Support is not its module, though its tree can hold the item.
  await assert.rejects(firmAdmin('submitSupportIssue', issue()), /sent from a client corporate/);
  await assert.rejects(firmAdmin('getModuleFragment', { moduleId: 'SUPPORT' }), /You do not have access to this module/);
  assert.ok((await firmAdmin('getModuleRegistry', {})).some(m => m.id === 'SUPPORT'), 'linkable in the main tree');
  const area = await firmAdmin('saveTreeNode', { nodeData: { Text: 'SYSTEM ADMIN', ParentID: '', ModuleID: '', AllowedRoles: ['Admin'] } });
  assert.equal((await firmAdmin('saveTreeNode', { nodeData: { Text: 'Support', ParentID: area.nodeId, ModuleID: 'SUPPORT', AllowedRoles: ['Admin'] } })).success, true);
  assert.equal((await firmAdmin('getMyTree', {})).some(t => t.moduleId === 'SUPPORT'), false, 'but not in its own menu');
  assert.equal((await cara('getModuleRegistry', {})).some(m => m.id === 'SUPPORT'), true);
});

test('files: checked, up to 5 a message, by its author just after sending it; opened by both sides', async () => {
  const a = await cara('submitSupportIssue', issue());
  const add = (who, o) => who('addSupportFile', Object.assign({ IssueID: a.IssueID, MessageID: a.MessageID, fileName: 'screen.png', data: PNG }, o));
  await assert.rejects(add(cara, { fileName: 'tool.exe' }), /only PDF/);
  await assert.rejects(add(cara, { fileName: 'fake.pdf', data: PNG }), /not really a \.pdf/);
  const f1 = await add(cara, { fileName: 'invoice.pdf', data: PDF });
  for (let i = 0; i < 4; i++) await add(cara);
  await assert.rejects(add(cara), /Up to 5 files a message/);
  await assert.rejects(add(dina), /not there any more/, 'another corporate cannot reach it');
  const msg = (await firestore.doc('supportIssues/' + a.IssueID + '/messages/' + a.MessageID).get()).data();
  assert.deepEqual(msg.Files.map(f => f.Name), ['invoice.pdf', 'screen.png', 'screen.png', 'screen.png', 'screen.png']);
  const [stored] = await bucket().file(msg.Files[0].Path).download();
  assert.equal(stored.toString('base64'), PDF, 'in the firm\'s Cloud Storage');
  assert.match(msg.Files[0].Path, new RegExp('^support/200/' + a.IssueID + '/'));
  const open = { IssueID: a.IssueID, MessageID: a.MessageID, FileID: f1.file.FileID };
  assert.equal((await cara('openSupportFile', open)).data, PDF);
  assert.equal((await firmAdmin('openSupportFile', open)).fileName, 'invoice.pdf');
  await assert.rejects(dina('openSupportFile', open), /not there any more/);
  // Later, or on someone else's message: refused.
  const b = await cara('submitSupportIssue', issue());
  await firestore.doc('supportIssues/' + b.IssueID + '/messages/' + b.MessageID).update({ At: '2020-01-01T00:00:00.000Z' });
  await assert.rejects(cara('addSupportFile', { IssueID: b.IssueID, MessageID: b.MessageID, fileName: 'a.pdf', data: PDF }), /Files are added with the message/);
  const reply = await firmAdmin('replySupportIssue', { IssueID: b.IssueID, Text: 'Send the invoice number please.' });
  await assert.rejects(cara('addSupportFile', { IssueID: b.IssueID, MessageID: reply.MessageID, fileName: 'a.pdf', data: PDF }), /your own message/);
});

test('each client sees its own issues; the firm\'s queue has every corporate\'s, and the conversation goes both ways', async () => {
  const a = await cara('submitSupportIssue', issue());
  const c = await dina('submitSupportIssue', issue({ Title: 'Second client issue' }));
  assert.deepEqual((await cara('getSupportIssues', {})).issues.map(i => i.Number), ['200-00001']);
  assert.deepEqual((await dina('getSupportIssues', {})).issues.map(i => i.Number), ['300-00001']);
  await assert.rejects(cara('getSupportIssue', { IssueID: c.IssueID }), /not there any more/);
  const q = await firmAdmin('getSupportIssues', {});
  assert.deepEqual(q.issues.map(i => i.CorporateID + ' ' + i.Status).sort(), ['200 New', '300 New']);
  assert.equal(q.side, 'firm');

  // The firm answers: waiting for the client by default.
  await assert.rejects(call('u-viewer', 'replySupportIssue', { IssueID: a.IssueID, Text: 'x' }), /permission to answer/);
  assert.equal((await call('u-viewer', 'getSupportIssues', {})).issues.length, 2, 'a Viewer sees the queue');
  assert.equal((await firmAdmin('replySupportIssue', { IssueID: a.IssueID, Text: 'Which invoice?' })).Status, 'Waiting for you');
  let seen = await cara('getSupportIssue', { IssueID: a.IssueID });
  assert.deepEqual(seen.messages.map(m => [m.From, m.Text]), [['client', 'The total shows 0.'], ['firm', 'Which invoice?']]);
  assert.equal(seen.Status, 'Waiting for you');
  // The client answers: back with the firm, confirmed as shared again.
  await assert.rejects(cara('replySupportIssue', { IssueID: a.IssueID, Text: 'INV-1' }), /Confirm first/);
  assert.equal((await cara('replySupportIssue', { IssueID: a.IssueID, Text: 'INV-1', shareConfirmed: true })).Status, 'In progress');
  assert.equal((await firmAdmin('replySupportIssue', { IssueID: a.IssueID, Text: 'Fixed.', Status: 'Resolved' })).Status, 'Resolved');
  assert.deepEqual((await firmAdmin('getSupportIssues', {})).issues.map(i => i.CorporateID), ['300'], 'resolved: off the open queue');
  assert.equal((await firmAdmin('getSupportIssues', { filter: 'all' })).issues.length, 2);
  // The client closes it; a closed issue takes no more replies from it.
  await assert.rejects(cara('setSupportIssueStatus', { IssueID: a.IssueID, Status: 'Resolved' }), /You can close the issue/);
  await cara('setSupportIssueStatus', { IssueID: a.IssueID, Status: 'Closed' });
  await assert.rejects(cara('replySupportIssue', { IssueID: a.IssueID, Text: 'more', shareConfirmed: true }), /closed: send a new one/);
  seen = await cara('getSupportIssue', { IssueID: a.IssueID });
  assert.deepEqual([seen.Status, seen.messages.length], ['Closed', 4]);
});
