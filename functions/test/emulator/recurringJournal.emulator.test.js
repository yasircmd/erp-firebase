// Recurring Journal Entries (docs/modules/RECURRING_JOURNAL.md): the
// template lifecycle (draft, activate, pause/edit/resume, end), posting
// due runs by hand with catch-up and exactly-once, fixed and spread
// amounts, failed runs and retry, skip, reversal and re-post, vendor
// lines as New Ref, approval of activation, the Home task, and the
// GL-side guards (JV can't reverse a run; GL Report routes here).
//
// The server decides "today" itself (Asia/Dubai) and never trusts a
// client date, so every schedule here is built relative to that day.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, rtdb, call, reset, baseFixture, val } = require('./_helpers');
const S = require('../../src/recurringSchedule');

const TODAY = S.todayIn('Asia/Dubai');
// First day of the month `offset` months from this one.
function monthStart(offset) {
  const d = new Date(TODAY.substring(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().substring(0, 10);
}
const monthEnd = offset => S.addDays(monthStart(offset + 1), -1);

function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-RENT': { AccountCode: '6100', AccountName: 'Rent Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-PRE': { AccountCode: '1500', AccountName: 'Prepaid Rent', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-PROV': { AccountCode: '2300', AccountName: 'Provision for Audit Fee', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-HDR': { AccountCode: '6000', AccountName: 'Expenses (header)', AccountType: 'Expense', Status: 'Active', IsPostable: false }
  });
  f.currencies = { AED: { Code: 'AED', Status: 'Active', IsDefault: true } };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const err = async (p) => (await p.catch(e => e)).message;
const rent = (o) => Object.assign({
  CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Rent {MONTH}', Reference: 'Lease 7', AmountMode: 'Fixed',
  Schedule: { Frequency: 'MonthlyDay', Day: 1, StartDate: monthStart(-2), EndMode: 'Count', RunCount: 6 },
  Lines: [
    { AccountCode: '6100', Debit: 1000, Credit: 0, Description: 'Rent {MONTH}' },
    { AccountCode: '1500', Debit: 0, Credit: 1000, Description: 'Prepaid rent released' }
  ]
}, o);
const save = (data, uid) => call(uid || 'u-admin', 'saveRecurringJournalDraft', data);
const activate = (templateId, uid) => call(uid || 'u-admin', 'activateRecurringJournal', { templateId });
const postDue = (templateIds, uid, upTo) => call(uid || 'u-admin', 'postRecurringJournalRuns', { templateIds, upTo });
async function active(data) {
  const s = ok(await save(data));
  ok(await activate(s.templateId));
  return s.templateId;
}
const rec = (id) => val('recurringJournals/' + id);
const detail = (id) => call('u-admin', 'getRecurringJournal', { templateId: id });
const gl = async (jvId) => (await firestore.collection('journalEntries').doc(jvId).get()).data();
const glLines = async (jvId) => (await gl(jvId)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']);
async function balance(accountId) {
  const snap = await firestore.collection('journalEntries').get();
  let b = 0;
  snap.docs.forEach(d => (d.data().Lines || []).forEach(l => { if (l.AccountID === accountId) b += (l.Debit || 0) - (l.Credit || 0); }));
  return Math.round(b * 100) / 100;
}
const entriesOf = async (id) => (await firestore.collection('journalEntries').where('SourceTransactionID', '==', id).get()).docs.map(d => d.data());

test('fixed monthly: activate, catch-up of past dates, exactly once, reverse and re-post, skip, pause/edit/resume, end', async () => {
  await reset(fixture());
  const s = ok(await save(rent()));
  let t = await rec(s.templateId);
  assert.deepEqual([t.Status, t.TemplateNumber, t.CurrencyCode, t.ScheduleText], ['Draft', '', 'AED', 'Day 1 of every month, from ' + monthStart(-2) + ', 6 runs']);
  assert.deepEqual(t.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.CostCenterID]), [['6100', 1000, 0, 'CC1'], ['1500', 0, 1000, 'CC1']], 'header cost center fills the lines');
  let d = await detail(s.templateId);
  assert.deepEqual(d.Plan.map(r => r.Date), [0, 1, 2, 3, 4, 5].map(i => monthStart(i - 2)));
  assert.ok(d.Plan.every(r => r.Status === 'Scheduled' && !r.Due && r.Amount === 1000), 'a draft has nothing due');

  // Activating: a number, and the three past/current dates are due (nothing is posted by itself).
  ok(await activate(s.templateId));
  t = await rec(s.templateId);
  assert.equal(t.Status, 'Active');
  assert.match(t.TemplateNumber, /^RJT-\d{2}-01-000001$/);
  d = await detail(s.templateId);
  assert.deepEqual([d.DueCount, d.PostedCount, d.NextRunDate], [3, 0, monthStart(-2)]);
  assert.equal((await entriesOf(s.templateId)).length, 0);
  const home = await call('u-admin', 'getRecurringJournalsDueForUser', {});
  assert.deepEqual(home.map(h => [h.ModuleID, h.DocumentNumber, h.DueCount, h.OldestDueDate]), [['RECURRINGJV', t.TemplateNumber, 3, monthStart(-2)]]);
  assert.deepEqual(await call('u-viewer', 'getRecurringJournalsDueForUser', {}), [], 'no post right, no task');

  // Future dates can't be posted ahead of time.
  assert.match(await err(postDue([s.templateId], 'u-admin', S.addDays(TODAY, 1))), /ahead of their date/);
  assert.match(await err(postDue([s.templateId], 'u-viewer')), /permission to activate, post or reverse/);

  const r1 = ok(await postDue([s.templateId]));
  assert.deepEqual([r1.posted, r1.failed], [3, 0]);
  assert.deepEqual(r1.results.map(r => r.Date), [monthStart(-2), monthStart(-1), monthStart(0)], 'oldest first');
  const entries = await entriesOf(s.templateId);
  assert.equal(entries.length, 3);
  const first = entries.find(e => e.RecurringRunDate === monthStart(-2));
  assert.equal(first.VoucherType, 'RecurringJV');
  assert.match(first.JVNumber, /^RJV-\d{2}-01-\d{6}$/);
  assert.equal(first.JVDate, monthStart(-2), 'dated the run date');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(monthStart(-2).substring(5, 7)) - 1] + '-' + monthStart(-2).substring(0, 4);
  assert.deepEqual([first.Description, first.Reference, first.Lines[0].Description, first.CurrencyCode], ['Rent ' + mon, 'Lease 7', 'Rent ' + mon, 'AED']);
  assert.equal(await balance('A-RENT'), 3000);
  assert.equal(await balance('A-PRE'), -3000);

  // Exactly once: posting again finds nothing due.
  const r2 = ok(await postDue([s.templateId]));
  assert.deepEqual([r2.posted, r2.results.length], [0, 0]);
  assert.equal((await entriesOf(s.templateId)).length, 3);
  assert.deepEqual(await call('u-admin', 'getRecurringJournalsDueForUser', {}), []);

  // JV can't reverse a run; GL Report routes a run to this module.
  const runJv = (await rec(s.templateId)).Runs[monthStart(-1)].JVID;
  const jvRev = await call('u-admin', 'reverseJournalEntry', { jvId: runJv, reversalDate: TODAY });
  assert.match(jvRev.error, /posted by RecurringJV/);

  // Reverse one run: a mirror entry; the date waits for a re-post (not due by itself).
  assert.match(await err(call('u-admin', 'reverseRecurringJournalRun', { templateId: s.templateId, date: monthStart(-1), reversalDate: TODAY, reason: '' })), /reason is required/);
  assert.match(await err(call('u-admin', 'reverseRecurringJournalRun', { templateId: s.templateId, date: monthStart(-1), reversalDate: monthStart(-2), reason: 'x' })), /before the run date/);
  const rev = ok(await call('u-admin', 'reverseRecurringJournalRun', { templateId: s.templateId, date: monthStart(-1), reversalDate: TODAY, reason: 'Posted twice by hand' }));
  t = await rec(s.templateId);
  const run = t.Runs[monthStart(-1)];
  assert.deepEqual([run.Status, run.ReversalJVNumber, run.Reason], ['Reversed', rev.reversalNumber, 'Posted twice by hand']);
  assert.deepEqual(await glLines(run.ReversalJVID), [['6100', 0, 1000, ''], ['1500', 1000, 0, '']]);
  assert.equal((await gl(run.JVID)).ReversedByJV, run.ReversalJVID);
  assert.equal(await balance('A-RENT'), 2000);
  assert.equal(ok(await postDue([s.templateId])).posted, 0, 'a reversed run is not re-posted by "Post due runs"');
  const again = ok(await call('u-admin', 'repostRecurringJournalRun', { templateId: s.templateId, date: monthStart(-1) }));
  assert.equal(again.Status, 'Posted');
  assert.equal(await balance('A-RENT'), 3000);
  assert.match(await err(call('u-admin', 'repostRecurringJournalRun', { templateId: s.templateId, date: monthStart(-1) })), /is Posted/);

  // Skip a future date.
  ok(await call('u-admin', 'skipRecurringJournalRun', { templateId: s.templateId, date: monthStart(2), reason: 'Rent-free month' }));
  assert.match(await err(call('u-admin', 'skipRecurringJournalRun', { templateId: s.templateId, date: monthStart(0), reason: 'x' })), /is not open/);

  // Editing needs a pause; the edit is logged; resuming re-activates.
  assert.match(await err(save(rent({ TemplateID: s.templateId }))), /Pause this recurring entry before editing it/);
  ok(await call('u-admin', 'pauseRecurringJournal', { templateId: s.templateId }));
  assert.match(await err(postDue([s.templateId])), /Only an Active recurring entry posts runs/);
  const edited = rent({ TemplateID: s.templateId });
  edited.Lines[0].Debit = 1200; edited.Lines[1].Credit = 1200;
  ok(await save(edited));
  // The period can't drop a date already in the log.
  const shorter = rent({ TemplateID: s.templateId, Schedule: Object.assign({}, rent().Schedule, { RunCount: 2 }) });
  assert.match(await err(save(shorter)), /no longer includes .* already posted/);
  ok(await activate(s.templateId));
  t = await rec(s.templateId);
  assert.equal(t.Status, 'Active');
  const events = t.History.map(h => h.Event);
  assert.deepEqual(events.filter(e => !/^Run /.test(e)), ['Activated', 'Paused', 'Edited', 'Resumed']);
  assert.match(t.History.find(h => h.Event === 'Edited').Note, /TotalDebit: 1000 → 1200; lines changed/);
  d = await detail(s.templateId);
  assert.deepEqual(d.Plan.map(r => [r.Status, r.Amount]), [['Posted', 1000], ['Posted', 1000], ['Posted', 1000], ['Scheduled', 1200], ['Skipped', 0], ['Scheduled', 1200]]);

  // End: no more runs, gone from Home.
  assert.match(await err(call('u-admin', 'endRecurringJournal', { templateId: s.templateId })), /reason is required/);
  ok(await call('u-admin', 'endRecurringJournal', { templateId: s.templateId, reason: 'Lease terminated' }));
  t = await rec(s.templateId);
  assert.deepEqual([t.Status, t.EndReason], ['Ended', 'Lease terminated']);
  assert.match(await err(activate(s.templateId)), /Only a draft, rejected or paused/);
  assert.match(await err(call('u-admin', 'deleteRecurringJournalDraft', { templateId: s.templateId })), /never activated/);
});

test('spread a total: equal installments, rounding on the last, completes; edits re-spread what is left', async () => {
  await reset(fixture());
  // 10,000 over 3 month ends, all in the past: 3333.33, 3333.33, 3333.34, then Completed.
  const a = await active(rent({
    AmountMode: 'Spread', Description: 'Insurance {MONTH}',
    Schedule: { Frequency: 'MonthEnd', StartDate: monthStart(-4), EndMode: 'Count', RunCount: 3 },
    Lines: [{ AccountCode: '6100', Debit: 10000, Description: 'Insurance' }, { AccountCode: '1500', Credit: 10000, Description: 'Prepaid insurance' }]
  }));
  const plan = (await detail(a)).Plan.map(r => r.Amount);
  assert.deepEqual(plan, [3333.33, 3333.33, 3333.34]);
  assert.equal(ok(await postDue([a])).posted, 3);
  const t = await rec(a);
  assert.equal(t.Status, 'Completed');
  assert.deepEqual(Object.keys(t.Runs).sort().map(k => t.Runs[k].Amount), [3333.33, 3333.33, 3333.34]);
  assert.equal(await balance('A-RENT'), 10000);
  assert.equal(await balance('A-PRE'), -10000);

  // 12,000 over 12 month ends: 1,000 each; two are past.
  const b = await active(rent({
    AmountMode: 'Spread',
    Schedule: { Frequency: 'MonthEnd', StartDate: monthStart(-2), EndMode: 'Count', RunCount: 12 },
    Lines: [{ AccountCode: '6100', Debit: 12000, Description: 'Rent' }, { AccountCode: '1500', Credit: 12000, Description: 'Prepaid rent' }]
  }));
  assert.ok((await detail(b)).Plan.every(r => r.Amount === 1000));
  const posted = ok(await postDue([b])).posted;
  assert.equal(posted, TODAY === monthEnd(0) ? 3 : 2);
  // The total goes up to 13,000: what's left (13,000 − posted) is spread over the open dates.
  ok(await call('u-admin', 'pauseRecurringJournal', { templateId: b }));
  const more = rent({
    TemplateID: b, AmountMode: 'Spread', Schedule: { Frequency: 'MonthEnd', StartDate: monthStart(-2), EndMode: 'Count', RunCount: 12 },
    Lines: [{ AccountCode: '6100', Debit: 13000, Description: 'Rent' }, { AccountCode: '1500', Credit: 13000, Description: 'Prepaid rent' }]
  });
  ok(await save(more));
  const open = 12 - posted;
  const each = Math.round((13000 - 1000 * posted) / open * 100) / 100;
  const after = (await detail(b)).Plan.filter(r => r.Status === 'Scheduled').map(r => r.Amount);
  assert.equal(after.length, open);
  assert.ok(after.slice(0, -1).every(x => x === each));
  assert.equal(Math.round(after.reduce((s, x) => s + x, 0) * 100) / 100, 13000 - 1000 * posted);
  // Once runs have posted, a spread entry's accounts can't change.
  const other = JSON.parse(JSON.stringify(more));
  other.Lines[1].AccountCode = '2300';
  assert.match(await err(save(other)), /accounts and sides can no longer change/);
  // Nor can the total drop below what's already posted.
  const less = JSON.parse(JSON.stringify(more));
  less.Lines[0].Debit = 500; less.Lines[1].Credit = 500;
  assert.match(await err(save(less)), /already been posted, more than its total/);
});

test('failed runs are logged and retried; recovery of a run whose marker was left at Committing', async () => {
  await reset(fixture());
  const id = await active(rent({ Schedule: { Frequency: 'MonthlyDay', Day: 1, StartDate: monthStart(-1), EndMode: 'Count', RunCount: 3 } }));
  // The expense account goes inactive: both due runs fail, with the reason, and stay due.
  await rtdb.ref('coa/A-RENT/Status').set('Inactive');
  const r = ok(await postDue([id]));
  assert.deepEqual([r.posted, r.failed], [0, 2]);
  assert.match(r.results[0].Error, /6100 is inactive/);
  let t = await rec(id);
  assert.equal(t.Runs[monthStart(-1)].Status, 'Failed');
  const home = await call('u-admin', 'getRecurringJournalsDueForUser', {});
  assert.deepEqual(home.map(h => [h.DueCount, h.FailedCount]), [[2, 2]]);
  await rtdb.ref('coa/A-RENT/Status').set('Active');
  assert.equal(ok(await postDue([id])).posted, 2);
  t = await rec(id);
  assert.equal(t.Runs[monthStart(-1)].Error, undefined, 'a posted run carries no old error');

  // A call died after writing the GL entry: the run is found, not posted twice.
  const date = monthStart(-1);
  const jvId = t.Runs[date].JVID;
  await rtdb.ref('recurringJournals/' + id + '/Runs/' + date).set({ Status: 'Committing', AttemptID: 'x', Amounts: [1000, 1000] });
  const rec1 = ok(await postDue([id]));
  assert.deepEqual(rec1.results.map(x => [x.Date, x.Status, x.Recovered, x.JVID]), [[date, 'Posted', true, jvId]]);
  assert.equal((await entriesOf(id)).filter(e => e.RecurringRunDate === date).length, 1);
  // A call died before writing it: the run is posted now.
  const date2 = monthStart(0);
  await firestore.collection('journalEntries').doc((await rec(id)).Runs[date2].JVID).delete();
  await rtdb.ref('recurringJournals/' + id + '/Runs/' + date2).set({ Status: 'Committing', AttemptID: 'y', Amounts: [1000, 1000] });
  const rec2 = ok(await postDue([id]));
  assert.deepEqual(rec2.results.map(x => [x.Date, x.Status, Boolean(x.Recovered)]), [[date2, 'Posted', false]]);
  assert.equal((await entriesOf(id)).filter(e => e.RecurringRunDate === date2).length, 1);
});

test('weekly and Nth-weekday schedules; validation; vendor line as New Ref; company access', async () => {
  await reset(fixture());
  const s = ok(await save(rent({ Schedule: { Frequency: 'Weekly', Weekday: 4, StartDate: monthStart(0), EndMode: 'EndDate', EndDate: monthEnd(0) } })));
  const plan = (await detail(s.templateId)).Plan.map(r => r.Date);
  assert.ok(plan.length >= 4 && plan.every(dt => new Date(dt + 'T00:00:00Z').getUTCDay() === 4), 'every Thursday of the month');
  const p = await call('u-admin', 'previewRecurringJournal', {
    AmountMode: 'Fixed', Lines: [{ Debit: 50 }, { Credit: 50 }],
    Schedule: { Frequency: 'MonthlyWeekday', Nth: -1, Weekday: 5, StartDate: monthStart(0), EndMode: 'Count', RunCount: 2 }
  });
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows.every(r => new Date(r.Date + 'T00:00:00Z').getUTCDay() === 5 && S.addDays(r.Date, 7).substring(0, 7) !== r.Date.substring(0, 7)), 'last Friday');
  assert.match(p.scheduleText, /^The last Friday of every month/);

  assert.match(await err(save(rent({ Description: '' }))), /Description is required/);
  assert.match(await err(save(rent({ Lines: [{ AccountCode: '6100', Debit: 100, Description: 'a' }, { AccountCode: '1500', Credit: 90, Description: 'b' }] }))), /not balanced/);
  assert.match(await err(save(rent({ Lines: [{ AccountCode: '6000', Debit: 100, Description: 'a' }, { AccountCode: '1500', Credit: 100, Description: 'b' }] }))), /header account/);
  assert.match(await err(save(rent({ CostCenterID: '', Lines: [{ AccountCode: '6100', Debit: 100, Description: 'a' }, { AccountCode: '1500', Credit: 100, Description: 'b' }] }))), /requires a Cost Center/);
  assert.match(await err(save(rent({ AmountMode: '' }))), /amount mode/);
  assert.match(await err(save(rent({ Schedule: { Frequency: 'MonthEnd', StartDate: monthStart(0) } }))), /how the period ends/);
  assert.match(await err(save(rent({ Lines: [{ AccountCode: '2000', Debit: 100, Description: 'a' }, { AccountCode: '1500', Credit: 100, Description: 'b' }] }))), /control account — select the Vendor or Customer/);
  assert.match(await err(save(rent(), 'u-viewer')), /permission to create or edit entries in RECURRINGJV/);
  assert.match(await err(save(rent({ CompanyID: 'C2' }))), /do not have access to that company/);
  assert.match(await err(call('u-other', 'getRecurringJournal', { templateId: s.templateId })), /do not have access to that company/);
  assert.equal((await call('u-other', 'getRecurringJournals', {})).entries.length, 0);

  // A vendor line (e.g. a monthly fee accrued to the vendor): tagged, posted as a New Ref.
  const v = await active(rent({
    Schedule: { Frequency: 'MonthlyDay', Day: 1, StartDate: monthStart(0), EndMode: 'Count', RunCount: 1 },
    Lines: [{ AccountCode: '6100', Debit: 250, Description: 'Service fee' }, { AccountCode: '2000', Credit: 250, Description: 'Acme fee', PartyType: 'Vendor', PartyID: 'V1' }]
  }));
  assert.equal((await rec(v)).Lines[1].PartyName.includes('Acme Metals'), true);
  assert.equal(ok(await postDue([v])).posted, 1);
  const e = (await entriesOf(v))[0];
  assert.deepEqual(e.PartyKeys, ['Vendor:V1']);
  assert.deepEqual(e.Lines[1].Allocations.map(x => [x.RefType, x.Amount]), [['New', 250]]);
  assert.equal((await rec(v)).Status, 'Completed');
  const open = await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' });
  assert.deepEqual(open.map(i => [i.Outstanding, i.Side]), [[250, 'Cr']]);
  const soa = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1', fromDate: monthStart(-1), toDate: TODAY });
  assert.deepEqual(soa.Rows.map(x => [x.Type, x.Credit]), [['Recurring Journal', 250]], 'the vendor\'s statement shows the run');

  // Delete: a never-activated draft only.
  ok(await call('u-admin', 'deleteRecurringJournalDraft', { templateId: s.templateId }));
  assert.equal(await rec(s.templateId), null);
});

test('spread by service period: partial first month by days, 13 month ends, exact total, stable after posting', async () => {
  await reset(fixture());
  const from = S.addDays(monthStart(-2), 15); // the 16th, two months back
  const toDate = S.addDays(String(Number(from.substring(0, 4)) + 1) + from.substring(4), -1); // one year of service
  const data = rent({
    AmountMode: 'Period', Description: 'Insurance {MONTH}', Schedule: { ServiceFrom: from, ServiceTo: toDate },
    Lines: [{ AccountCode: '6100', Debit: 12000, Description: 'Insurance' }, { AccountCode: '1500', Credit: 12000, Description: 'Prepaid insurance' }]
  });
  const id = await active(data);
  const t = await rec(id);
  assert.match(t.ScheduleText, /^Month end, by days of the service period .* \((365|366) days\)$/);
  let d = await detail(id);
  const totalDays = d.Plan.reduce((s, r) => s + r.Days, 0);
  assert.equal(d.Plan.length, 13);
  assert.equal(d.Plan[0].Date, monthEnd(-2));
  assert.equal(d.Plan[12].Date, S.monthEndOf(toDate), 'last run at the end month\'s month end');
  const firstDays = Number(monthEnd(-2).substring(8)) - 15;
  assert.equal(d.Plan[0].Days, firstDays);
  assert.equal(d.Plan[0].Amount, Math.round(12000 * firstDays / totalDays * 100) / 100);
  assert.equal(Math.round(d.Plan.reduce((s, r) => s + r.Amount, 0) * 100) / 100, 12000);
  const planned = d.Plan.map(r => r.Amount);

  // Two month ends are past: posted with the planned amounts; the rest don't move.
  assert.equal(ok(await postDue([id])).posted, 2);
  d = await detail(id);
  assert.deepEqual(d.Plan.map(r => r.Amount), planned);
  assert.deepEqual(d.Plan.slice(0, 3).map(r => r.Status), ['Posted', 'Posted', 'Scheduled']);
  assert.equal(await balance('A-RENT'), Math.round((planned[0] + planned[1]) * 100) / 100);

  // Validation: the period is required and ordered.
  assert.match(await err(save(rent({ AmountMode: 'Period', Schedule: { ServiceFrom: from } }))), /end date is required/);
  // Preview for the screen: days on every row.
  const p = await call('u-admin', 'previewRecurringJournal', { AmountMode: 'Period', Schedule: { ServiceFrom: from, ServiceTo: toDate }, Lines: [{ Debit: 12000 }, { Credit: 12000 }] });
  assert.deepEqual(p.rows.map(r => r.Amount), planned);
  assert.equal(p.rows[0].Days, firstDays);
});

test('approval gates activation and resume; rejection hands it back; approval tasks', async () => {
  await reset(Object.assign(fixture(), {
    approvalConfigurations: { RECURRINGJV: { Enabled: true, ScopeType: 'Global' } },
    approvalLevels: { RECURRINGJV: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } }
  }));
  const s = ok(await save(rent()));
  const a = ok(await activate(s.templateId));
  assert.equal(a.status, 'PendingApproval');
  let t = await rec(s.templateId);
  assert.equal(t.Status, 'PendingApproval');
  assert.equal(ok(await postDue([])).results.length, 0, 'nothing posts while pending');
  const tasks = await call('u-approver', 'getPendingApprovalsForUser', {});
  assert.deepEqual(tasks.map(x => [x.ModuleID, x.ModuleLabel, x.DocumentNumber]), [['RECURRINGJV', 'Recurring Journal Entries', t.TemplateNumber]]);

  ok(await call('u-approver', 'decideRecurringJournalApproval', { templateId: s.templateId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong cost center' }));
  t = await rec(s.templateId);
  assert.deepEqual([t.Status, t.RejectionReason], ['Rejected', 'Wrong cost center']);
  ok(await save(rent({ TemplateID: s.templateId })));
  ok(await activate(s.templateId));
  ok(await call('u-approver', 'decideRecurringJournalApproval', { templateId: s.templateId, levelNumber: 1, decision: 'Approved', reason: '' }));
  t = await rec(s.templateId);
  assert.equal(t.Status, 'Active');
  assert.equal(ok(await postDue([s.templateId])).posted, 3);

  // Resuming after a pause goes through approval again.
  ok(await call('u-admin', 'pauseRecurringJournal', { templateId: s.templateId }));
  assert.equal(ok(await activate(s.templateId)).status, 'PendingApproval');
  ok(await call('u-approver', 'decideRecurringJournalApproval', { templateId: s.templateId, levelNumber: 1, decision: 'Approved', reason: '' }));
  t = await rec(s.templateId);
  assert.equal(t.Status, 'Active');
  assert.ok(t.History.some(h => h.Event === 'Resumed (approved)'));
});
