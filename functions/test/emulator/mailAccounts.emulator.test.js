// Task emails, phase 2 (owner, 2026-11-09; docs/modules/TASK_EMAILS.md,
// Q457-Q460): a company's and the corporate's own sending mailbox, set with
// Company Master's rights; the password encrypted (never sent back); an
// approval's email from its company's mailbox, else the corporate's, else
// (Corporate 100) the firm's, else not sent. A fake transport: no mail is sent.
// Needs functions/.secret.local with TASK_MAIL_KEY (README, Testing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rtdb, firestore, call, reset, baseFixture } = require('./_helpers');
// The emulator's key (functions/.secret.local), for the sends made here.
const KEY = (/^TASK_MAIL_KEY=(.*)$/m.exec(fs.readFileSync(path.join(__dirname, '../../.secret.local'), 'utf8')) || [])[1];
process.env.TASK_MAIL_KEY = KEY;
const taskMail = require('../../src/taskMail');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const ok = r => { assert.equal(r && r.success, true, JSON.stringify(r)); return r; };

function fixture() {
  const f = baseFixture();
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-admin', ThresholdAmount: 0 }] } } };
  return f;
}
const clear = async () => { for (const c of ['mailQueue', 'mailLog', 'mailSummaries', 'mailAccounts']) for (const d of (await firestore.collection(c).get()).docs) await d.ref.delete(); };
async function pendingJv() {
  const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'PendingApproval');
}
// What would have gone: [from, to] and the account each was sent with.
function fakes() {
  const sent = [];
  return { sent, make: a => ({ sendMail: async m => { sent.push([m.from, m.to, a.pass]); } }) };
}
const sweep = (f, firmAccount) => taskMail.sweepCorporate({ firmAccount: firmAccount || null, secret: KEY, makeTransport: f.make, now: new Date('2026-09-10T02:00:00Z') });

test('saving a mailbox: Company Master write, the company\'s access, a valid address, the password once and never shown', async () => {
  await reset(fixture());
  await clear();
  assert.match(await refused(call('u-viewer', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example', password: 'abcd efgh ijkl mnop' })), /Company Master/);
  assert.match(await refused(call('u-other', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example', password: 'abcdefghijklmnop' })), /access to that company/);
  assert.match(await refused(call('u-admin', 'saveMailAccount', { key: 'NOPE', address: 'tasks@c1.example', password: 'abcdefghijklmnop' })), /Choose a company/);
  assert.match(await refused(call('u-admin', 'saveMailAccount', { key: 'C1', address: 'not an address', password: 'abcdefghijklmnop' })), /address/);
  assert.match(await refused(call('u-admin', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example' })), /app password/);
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', address: 'Tasks@C1.example', password: 'abcd efgh ijkl mnop' }));
  ok(await call('u-admin', 'saveMailAccount', { key: 'CORPORATE', address: 'erp@corp.example', password: 'qrstuvwxqrstuvwx' }));

  // Never sent back; stored encrypted, not as typed.
  const g = await call('u-admin', 'getMailAccounts', {});
  assert.deepEqual([g.canWrite, g.keySet, g.corporate.Address, g.companies.C1.Address, g.companies.C1.HasPassword], [true, true, 'erp@corp.example', 'tasks@c1.example', true]);
  assert.equal(JSON.stringify(g).includes('abcd'), false, 'no password in the answer');
  const stored = (await firestore.collection('mailAccounts').doc('C1').get()).data().Password;
  assert.match(stored, /^v1:/);
  assert.equal(stored.includes('abcd'), false);
  // A viewer sees the addresses, may not change them; a company they can't open is left out.
  const v = await call('u-viewer', 'getMailAccounts', {});
  assert.deepEqual([v.canWrite, Object.keys(v.companies)], [false, ['C1']]);
  assert.deepEqual(Object.keys((await call('u-other', 'getMailAccounts', {})).companies), []);

  // Blank keeps the password; a new address needs its own.
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example' }));
  assert.equal((await firestore.collection('mailAccounts').doc('C1').get()).data().Password, stored);
  assert.match(await refused(call('u-admin', 'saveMailAccount', { key: 'C1', address: 'other@c1.example' })), /new address needs its own app password/);

  // The test email: with none saved, says so (no email is sent from anywhere else).
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', remove: true }));
  ok(await call('u-admin', 'saveMailAccount', { key: 'CORPORATE', remove: true }));
  const t = await call('u-admin', 'testMailAccount', { key: 'C1' });
  assert.deepEqual([t.success, t.result, t.to], [false, 'not sent: no mail account set', 'admin@test.local']);
});

test('which mailbox sends: the company\'s, else the corporate\'s, else the firm\'s (Corporate 100), else not sent', async () => {
  await reset(fixture());
  await clear();
  await rtdb.ref('users/u-admin/email').set('admin@test.local');
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example', password: 'abcd efgh ijkl mnop' }));
  ok(await call('u-admin', 'saveMailAccount', { key: 'CORPORATE', address: 'erp@corp.example', password: 'qrstuvwxqrstuvwx' }));
  const FIRM = { user: 'firm@firm.example', pass: 'firmpassfirmpass' };

  // The JV is C1's: from C1's mailbox, with its password decrypted.
  await pendingJv();
  // The company is found when sending (the queued email is as before phase 2).
  assert.deepEqual((await firestore.collection('mailQueue').get()).docs.map(d => d.data().CompanyID), [undefined]);
  let f = fakes();
  await sweep(f, FIRM);
  assert.deepEqual(f.sent, [['"ERP tasks" <tasks@c1.example>', 'admin@test.local', 'abcdefghijklmnop']]);
  assert.equal((await firestore.collection('mailLog').get()).docs[0].data().From, 'tasks@c1.example');

  // No company mailbox: the corporate's.
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', remove: true }));
  await pendingJv();
  f = fakes();
  await sweep(f, FIRM);
  assert.deepEqual(f.sent.map(x => x[0]), ['"ERP tasks" <erp@corp.example>']);

  // Neither: the firm's, in Corporate 100 only; without it, not sent.
  ok(await call('u-admin', 'saveMailAccount', { key: 'CORPORATE', remove: true }));
  await pendingJv();
  f = fakes();
  await sweep(f, FIRM);
  assert.deepEqual(f.sent.map(x => x[0]), ['"ERP tasks" <firm@firm.example>']);
  await clear();
  await pendingJv();
  f = fakes();
  await sweep(f, null);
  assert.deepEqual(f.sent, []);
  assert.deepEqual((await firestore.collection('mailLog').get()).docs.map(d => d.data().Result), [taskMail.NO_ACCOUNT]);

  // A password saved under another key can't be read: said, not sent.
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example', password: 'abcd efgh ijkl mnop' }));
  await clear();
  ok(await call('u-admin', 'saveMailAccount', { key: 'C1', address: 'tasks@c1.example', password: 'abcd efgh ijkl mnop' }));
  await pendingJv();
  f = fakes();
  await taskMail.sweepCorporate({ firmAccount: FIRM, secret: 'another-key', makeTransport: f.make, now: new Date('2026-09-10T02:00:00Z') });
  assert.deepEqual(f.sent, [], 'never falls back to another mailbox');
  assert.match((await firestore.collection('mailLog').get()).docs[0].data().Result, /saved password of tasks@c1\.example can't be read/);
});
