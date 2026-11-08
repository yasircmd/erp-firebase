// Task emails' pure parts (docs/modules/TASK_EMAILS.md, Q450-Q456): the
// setting, the timing, the corporate's clock, the summary's due time, the
// email's text, the mail account secret and who an approval's write tells.
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../src/taskMail');

test('the setting: cleaned, defaults for a missing or odd one', () => {
  assert.deepEqual(m.cleanSettings({ Timing: 'daily', SummaryTime: '18:30', SummaryDays: ['Sun', 'Mon'] }), { Timing: 'daily', SummaryTime: '18:30', SummaryDays: ['Mon', 'Sun'] });
  assert.throws(() => m.cleanSettings({ Timing: 'weekly', SummaryTime: '07:00' }), /Choose when/);
  assert.throws(() => m.cleanSettings({ Timing: 'off', SummaryTime: '24:00' }), /half hour/);
  assert.throws(() => m.cleanSettings({ Timing: 'off', SummaryTime: '07:00', SummaryDays: ['Monday'] }), /Unknown day/);
  assert.deepEqual(m.settingsOf(null), { Timing: 'approvals-instant', SummaryTime: '07:00', SummaryDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] });
  assert.deepEqual(m.settingsOf({ Timing: 'nonsense' }).Timing, 'approvals-instant');
  assert.deepEqual(m.settingsOf({ Timing: 'off', SummaryTime: '06:30', SummaryDays: [] }), { Timing: 'off', SummaryTime: '06:30', SummaryDays: [] });
});

test('what goes at once under each timing (Q451)', () => {
  const at = t => ['approval', 'rejected', 'summary'].filter(k => m.sendsAtOnce(t, k));
  assert.deepEqual(['instant', 'approvals-instant', 'daily', 'off'].map(at), [['approval', 'rejected'], ['approval'], [], []]);
});

test('the clock and the summary\'s time: the corporate\'s zone, within the hour, the chosen days', () => {
  assert.deepEqual(m.localClock(new Date('2026-11-08T20:45:00Z')), { date: '2026-11-09', day: 'Mon', minutes: 45 }, 'Dubai is UTC+4: past midnight');
  const s = { Timing: 'daily', SummaryTime: '07:00', SummaryDays: ['Mon'] };
  const at = (day, minutes) => m.summaryDue(s, { date: 'x', day, minutes });
  assert.deepEqual([at('Mon', 419), at('Mon', 420), at('Mon', 479), at('Mon', 480), at('Tue', 430)], [false, true, true, false, false]);
  assert.equal(m.summaryDue(Object.assign({}, s, { Timing: 'off' }), { day: 'Mon', minutes: 430 }), false);
  assert.equal(m.summaryDue(Object.assign({}, s, { Timing: 'instant' }), { day: 'Mon', minutes: 430 }), true, 'every choice but Off gets the summary');
});

test('the email: dates read dd/mm/yyyy, text escaped in HTML, the link and the settings hint', () => {
  const e = m.composeEmail('Your ERP tasks, 2026-09-10', [{ title: 'PDCs <due>', lines: ['Cheque 12 dated 2026-09-30, A & B'] }], 'https://erp.example/');
  assert.equal(e.subject, 'Your ERP tasks, 10/09/2026');
  assert.match(e.text, /^PDCs <due>\n- Cheque 12 dated 30\/09\/2026, A & B\n\nOpen the ERP: https:\/\/erp\.example\//);
  assert.match(e.html, /PDCs &lt;due&gt;.*30\/09\/2026, A &amp; B/);
  assert.match(e.text, /Email settings/);
  assert.equal(m.showDate('2026-01-02T10:00:00Z'), '2026-01-02T10:00:00Z', 'a timestamp is left as it is');
});

test('the mail account secret: "address app-password"; none or a bad one is no account', () => {
  assert.deepEqual(m.parseAccount('tasks@example.com abcd efgh ijkl mnop'), { user: 'tasks@example.com', pass: 'abcdefghijklmnop' });
  assert.deepEqual([m.parseAccount(''), m.parseAccount('none'), m.parseAccount('NONE'), m.parseAccount('tasks@example.com'), m.parseAccount('not-an-address pw')], [null, null, null, null, null]);
});

test('who an approval\'s write tells: new approvers with the task, a rejection once', () => {
  const lv = (n, u) => ({ LevelNumber: n, ApproverUserID: u });
  const inst = (o) => Object.assign({ ModuleID: 'JV', Status: 'Pending', CreatedBy: 'u-sub', RequiredLevels: [lv(1, 'a'), lv(2, 'b')], Decisions: [] }, o);
  const who = n => n.waiting.map(l => l.LevelNumber + l.ApproverUserID);
  // Sent: every undecided level's approver (as Home shows a JV).
  assert.deepEqual(who(m.approvalNews(null, inst())), ['1a', '2b']);
  // A decision that leaves it pending tells nobody new; a delegation tells the new approver.
  assert.deepEqual(who(m.approvalNews(inst(), inst({ Decisions: [{ LevelNumber: 1, Decision: 'Approved' }] }))), []);
  assert.deepEqual(who(m.approvalNews(inst(), inst({ RequiredLevels: [lv(1, 'c'), lv(2, 'b')] }))), ['1c']);
  // A Job Order request goes level by level: the next level when the first approves.
  const jo = o => inst(Object.assign({ ModuleID: 'JOBORDERREQUEST' }, o));
  assert.deepEqual(who(m.approvalNews(null, jo())), ['1a']);
  assert.deepEqual(who(m.approvalNews(jo(), jo({ Decisions: [{ LevelNumber: 1, Decision: 'Approved' }] }))), ['2b']);
  // A rejection: told once, to the submitter; later writes of it tell nobody.
  const rej = inst({ Status: 'Rejected', Decisions: [{ LevelNumber: 1, Decision: 'Rejected' }] });
  assert.deepEqual([m.approvalNews(inst(), rej).rejected, m.approvalNews(rej, rej).rejected, m.approvalNews(rej, Object.assign({}, rej, { Status: 'Closed' })).rejected], [true, false, false]);
  assert.deepEqual(m.approvalNews(inst(), null), { waiting: [], rejected: false });
});
