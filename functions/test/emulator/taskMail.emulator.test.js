// Task emails (owner, 2026-11-08; docs/modules/TASK_EMAILS.md, Q450-Q456),
// through the real JV approval flow: an approval queues an email for each
// approver who has the task; the sweep sends what is still open, by each
// user's timing; a rejection goes to its submitter; a portal update to the
// employee (unless they turned it off); the summary once a day at the
// user's own time and days; with no mail account, everything is logged
// "not sent" and the queue still empties. A fake transport: no mail is sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rtdb, firestore, call, reset, baseFixture } = require('./_helpers');
const taskMail = require('../../src/taskMail');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.roles.Approver = { Name: 'Approver', Status: 'Active' };
  f.permissions.JV.access.push('Approver'); f.permissions.JV.post.push('Approver');
  const u = (name, email) => ({ status: 'Active', role: 'Approver', username: name.toLowerCase(), fullName: name, email, AssignedCompanies: ['C1'] });
  Object.assign(f.users, { 'u-anna': u('Anna', 'anna@test.local'), 'u-ben': u('Ben', 'ben@test.local'), 'u-cara': u('Cara', '') });
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [
    { LevelNumber: 1, ApproverUserID: 'u-anna', ThresholdAmount: 0 },
    { LevelNumber: 2, ApproverUserID: 'u-ben', ThresholdAmount: 0 }] } } };
  return f;
}
async function pendingJv(amount) {
  const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: amount || 40, Description: 'a' }, { AccountCode: '1100', Credit: amount || 40, Description: 'b' }] } });
  assert.equal(s.success, true, s.error);
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.status, 'PendingApproval', p.error);
  const rec = (await firestore.collection('journalEntries').doc(s.jvId).get()).data();
  return { jvId: s.jvId, instanceId: rec.ApprovalInstanceID, number: rec.JVNumber || rec.DocumentNumber };
}
const decide = (uid, jvId, levelNumber, decision) => call(uid, 'decideJournalEntryApproval', { jvId, levelNumber, decision, reason: decision === 'Rejected' ? 'Wrong account' : '' });
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };

// A fake nodemailer transport: what would have gone, in order.
function fakeTransport() {
  const sent = [];
  return { sent, sendMail: async m => { sent.push(m); return { messageId: String(sent.length) }; } };
}
const ACCOUNT = { user: 'tasks@test.local', pass: 'x' };
const sweep = (transport, now) => taskMail.sweepCorporate({ account: transport ? ACCOUNT : null, transport, now: now || new Date('2026-09-10T02:00:00Z') });
const queued = async () => (await firestore.collection('mailQueue').get()).docs.map(d => d.data());
const logs = async () => (await firestore.collection('mailLog').get()).docs.map(d => d.data()).sort((a, b) => (a.At + a.To).localeCompare(b.At + b.To));
const clearMail = async () => { for (const c of ['mailQueue', 'mailLog', 'mailSummaries']) for (const d of (await firestore.collection(c).get()).docs) await d.ref.delete(); };
const setting = (uid, s) => firestore.collection('userEmailSettings').doc(uid).set(Object.assign({ SummaryTime: '07:00', SummaryDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }, s));

test('the settings: the defaults, a choice saved, wrong ones refused', async () => {
  await reset(fixture());
  for (const d of (await firestore.collection('userEmailSettings').get()).docs) await d.ref.delete();
  const s = await call('u-anna', 'getMyEmailSettings', {});
  assert.deepEqual([s.Timing, s.SummaryTime, s.SummaryDays, s.email, s.timeZone, s.saved], ['approvals-instant', '07:00', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 'anna@test.local', 'Asia/Dubai', false]);
  assert.equal((await call('u-anna', 'saveMyEmailSettings', { Timing: 'daily', SummaryTime: '18:30', SummaryDays: ['Sun', 'Mon', 'Sun'] })).success, true);
  const t = await call('u-anna', 'getMyEmailSettings', {});
  assert.deepEqual([t.Timing, t.SummaryTime, t.SummaryDays, t.saved], ['daily', '18:30', ['Mon', 'Sun'], true]);
  assert.match(await refused(call('u-anna', 'saveMyEmailSettings', { Timing: 'hourly', SummaryTime: '07:00', SummaryDays: [] })), /Choose when you are emailed/);
  assert.match(await refused(call('u-anna', 'saveMyEmailSettings', { Timing: 'daily', SummaryTime: '07:15', SummaryDays: [] })), /hour or half hour/);
  assert.match(await refused(call('u-anna', 'saveMyEmailSettings', { Timing: 'daily', SummaryTime: '07:00', SummaryDays: ['Funday'] })), /Unknown day/);
});

test('an approval emails its approvers by their timing; only what is still open goes; a rejection goes to the submitter', async () => {
  await reset(fixture());
  await clearMail();
  for (const d of (await firestore.collection('userEmailSettings').get()).docs) await d.ref.delete();

  // Both levels' approvers have a JV's task at once (as Home shows it): both queued, both sent.
  const a = await pendingJv(4250);
  assert.deepEqual((await queued()).map(q => [q.Kind, q.ToUid]).sort(), [['approval', 'u-anna'], ['approval', 'u-ben']]);
  let t = fakeTransport();
  assert.deepEqual(await sweep(t), { queued: 2, summaries: 0 });
  assert.deepEqual(t.sent.map(m => m.to).sort(), ['anna@test.local', 'ben@test.local']);
  const m = t.sent.find(x => x.to === 'anna@test.local');
  assert.match(m.subject, /^Waiting for your approval: /);
  assert.match(m.text, /4,250\.00, waiting for your approval \(level 1\)/);
  assert.match(m.text, /https:\/\/erp1-8f4cd\.web\.app\//);
  assert.equal(m.from, '"ERP tasks" <tasks@test.local>');
  assert.deepEqual(await queued(), [], 'the queue is emptied');
  assert.deepEqual((await logs()).map(l => [l.Kind, l.To, l.Result]).sort(), [['approval', 'anna@test.local', 'sent'], ['approval', 'ben@test.local', 'sent']]);

  // Ben chooses the summary only: his approvals are not emailed at once.
  await setting('u-ben', { Timing: 'daily' });
  // Anna decides before the sweep: her task is gone, so her email is not sent (checked at sending).
  const b = await pendingJv();
  assert.equal((await decide('u-anna', b.jvId, 1, 'Approved')).error, undefined);
  t = fakeTransport();
  assert.deepEqual(await sweep(t), { queued: 0, summaries: 0 });
  assert.deepEqual(await queued(), []);

  // A rejection: to the submitter (u-admin), only with "instant".
  await clearMail();
  assert.equal((await decide('u-ben', b.jvId, 2, 'Rejected')).error, undefined);
  assert.deepEqual((await queued()).map(q => [q.Kind, q.ToUid]), [['rejected', 'u-admin']]);
  t = fakeTransport();
  await sweep(t);
  assert.deepEqual(t.sent, [], 'approvals-instant: a rejection waits for the summary');
  await setting('u-admin', { Timing: 'instant' });
  const c = await pendingJv();
  await clearMail();
  assert.equal((await decide('u-anna', c.jvId, 1, 'Rejected')).error, undefined);
  t = fakeTransport();
  await sweep(t);
  assert.deepEqual(t.sent.map(x => x.to), ['admin@test.local']);
  assert.match(t.sent[0].subject, /^Rejected: /);
  assert.match(t.sent[0].text, /was rejected by Anna: Wrong account\./);

  // No mail account set: logged "not sent", the queue still empties; no address: logged too.
  await clearMail();
  await rtdb.ref('approvalLevels/JV/GLOBAL/Levels/0/ApproverUserID').set('u-cara');
  await firestore.collection('userEmailSettings').doc('u-ben').delete();
  await pendingJv();
  assert.deepEqual(await sweep(null), { queued: 0, summaries: 0 });
  assert.deepEqual((await logs()).map(l => [l.Uid, l.Result]).sort(), [['u-ben', taskMail.NO_ACCOUNT], ['u-cara', 'not sent: no email address']]);
  assert.deepEqual(await queued(), []);
  void a;
});

test('a delegated level: its new approver is emailed', async () => {
  await reset(fixture());
  const { instanceId } = await pendingJv();
  await clearMail();
  const r = await call('u-admin', 'delegateApproval', { instanceId, levelNumber: 1, toUserId: 'u-cara', reason: 'On annual leave' });
  assert.equal(r.success, true, r.error);
  assert.deepEqual((await queued()).map(q => [q.Kind, q.ToUid, q.Check.LevelNumber]), [['approval', 'u-cara', 1]]);
});

test('the summary: at the user\'s own time and day, once a day, with Home\'s tasks; none when nothing is open', async () => {
  await reset(fixture());
  await clearMail();
  for (const d of (await firestore.collection('userEmailSettings').get()).docs) await d.ref.delete();
  await pendingJv(100);
  await pendingJv(200);
  for (const d of (await firestore.collection('mailQueue').get()).docs) await d.ref.delete();
  await setting('u-anna', { Timing: 'daily', SummaryTime: '07:00', SummaryDays: ['Thu'] });
  await setting('u-ben', { Timing: 'off' });

  // 2026-09-10 is a Thursday; 03:10Z is 07:10 in Dubai (UTC+4).
  const thu0710 = new Date('2026-09-10T03:10:00Z');
  let t = fakeTransport();
  const out = await sweep(t, new Date('2026-09-10T02:50:00Z')); // 06:50: not yet
  assert.deepEqual([out.summaries, t.sent.length], [0, 0]);
  t = fakeTransport();
  await sweep(t, thu0710);
  // Anna (Thu 07:00): her two approvals; Ben (off): none; the admin (default 07:00 weekdays): nothing open, so none.
  assert.deepEqual(t.sent.map(m => m.to), ['anna@test.local']);
  assert.match(t.sent[0].subject, /^Your ERP tasks, 10\/09\/2026: 2 open$/, 'dates read dd/mm/yyyy');
  assert.match(t.sent[0].text, /Waiting for your approval \(2\)\n- .*100\.00\n- .*200\.00/);
  // Once a day: a second run that day sends nothing.
  t = fakeTransport();
  await sweep(t, new Date('2026-09-10T03:25:00Z'));
  assert.deepEqual(t.sent, []);
  // Not her day.
  await firestore.collection('mailSummaries').doc('u-anna_2026-09-10').delete();
  await setting('u-anna', { Timing: 'daily', SummaryTime: '07:00', SummaryDays: ['Fri'] });
  t = fakeTransport();
  await sweep(t, thu0710);
  assert.deepEqual(t.sent, []);
});

test('an Employee Portal update goes to the employee\'s work email, unless they turned it off', async () => {
  await reset(fixture());
  await clearMail();
  await firestore.collection('employees').doc('E1').set({ FullName: 'Sam Example', CompanyID: 'C1', WorkEmail: 'sam@test.local', PersonalEmail: 'sam@home.test' });
  await firestore.collection('employeeEmailSettings').doc('E1').delete();
  // Through HR's real action: a query rejected.
  await firestore.collection('employeeRequests').doc('RQ1').set({ Type: 'Query', Category: 'Overtime', Number: 'PQ-26-0001', Status: 'New', EmployeeID: 'E1', EmployeeName: 'Sam Example', CompanyID: 'C1',
    CreatedAt: '2026-09-01T00:00:00Z', LastAt: '2026-09-01T00:00:00Z', History: [], Messages: [] });
  assert.equal((await call('u-admin', 'employeeRequests', { action: 'reject', id: 'RQ1', text: 'Paid in August' })).success, true);
  let t = fakeTransport();
  await sweep(t);
  assert.deepEqual(t.sent.map(m => [m.to, m.subject]), [['sam@test.local', 'Your request PQ-26-0001: rejected by HR: Paid in August']]);
  assert.match(t.sent[0].text, /ess\.html#requests\/view\/RQ1/);

  // Turned off in the portal: nothing goes.
  await taskMail.saveEmployeeSetting('E1', false);
  assert.deepEqual(await taskMail.employeeSetting('E1'), { on: false });
  await taskMail.portalUpdate('E1', 'Your request PQ-26-0001: resolved by HR', 'Resolved.', 'requests/view/RQ1');
  t = fakeTransport();
  await sweep(t);
  assert.deepEqual(t.sent, []);
  assert.deepEqual(await queued(), []);
});
