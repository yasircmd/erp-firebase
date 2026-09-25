// JV (manual journal entries, Firestore-backed) through its screen's
// callables: draft, post (re-validated against live COA, balanced,
// voucher number + lifetime TXN ref), approval gate (ref only once
// Posted), reject -> edit -> repost, reversal, delete, list, default
// currency, access. Plus the port fix: reverseJournalEntry refuses the GL
// side of a stock/invoice posting.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-HDR'] = { AccountCode: '9000', AccountName: 'Header', AccountType: 'Expense', Status: 'Active', IsPostable: false };
  f.coa['A-OLD'] = { AccountCode: '9100', AccountName: 'Old', AccountType: 'Expense', Status: 'Inactive', IsPostable: true };
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.currencies = { CUR1: { Code: 'AED', Name: 'Dirham', Symbol: 'AED', IsDefault: true, Status: 'Active' } };
  return f;
}
test.after(async () => { await app.delete(); });

const L = (code, dr, cr, o) => Object.assign({ AccountCode: code, Debit: dr, Credit: cr, Description: 'Line' }, o);
const lines = () => [L('6000', 100, 0, { CostCenterID: 'CC1' }), L('1000', 0, 100)];
const draft = (ls, extra, uid) => call(uid || 'u-admin', 'saveJournalDraft', {
  jvData: Object.assign({ JVDate: D, Description: 'Office supplies', Reference: 'R1', CompanyID: 'C1', CurrencyCode: 'AED', Lines: ls }, extra || {})
});
const doc = async (id) => { const s = await firestore.collection('journalEntries').doc(id).get(); return s.exists ? s.data() : null; };

test('draft -> post: numbered, lifetime TXN ref, listed; posted entries are locked', async () => {
  await reset(fixture());
  const s = await draft(lines());
  assert.equal(s.success, true, s.error);
  assert.match(s.jvId, /^JVD-/);
  let rec = await doc(s.jvId);
  assert.deepEqual([rec.Status, rec.VoucherType, rec.JVNumber, rec.TotalDebit, rec.TotalCredit], ['Draft', 'JV', '', 100, 100]);

  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.success, true, p.error);
  assert.equal(p.status, 'Posted');
  assert.match(p.jvNumber, /^JV/);
  assert.equal(p.transactionRef, 'TXN-00000001');
  rec = await doc(s.jvId);
  assert.equal(rec.Status, 'Posted');
  assert.equal(rec.TransactionRef, 'TXN-00000001');
  assert.ok(rec.PostedAt);

  const s2 = await draft(lines());
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s2.jvId })).transactionRef, 'TXN-00000002');

  const list = await call('u-admin', 'getJournalEntries', { limit: 'all' });
  assert.equal(list.total, 2);
  assert.deepEqual(list.entries.map(e => e.JVID).sort(), [s.jvId, s2.jvId].sort());

  assert.match((await draft(lines(), { JVID: s.jvId })).error, /Only draft or rejected entries can be edited/);
  assert.match((await call('u-admin', 'deleteJournalDraft', { jvId: s.jvId })).error, /Only draft entries can be deleted/);
  assert.match((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).error, /Only draft or rejected entries can be posted/);
});

test('validation at save and again at post (live COA)', async () => {
  await reset(fixture());
  assert.match((await draft(lines(), { CompanyID: '' })).error, /Select a Company/);
  assert.match((await draft(lines(), { Description: '' })).error, /Description is required/);
  assert.match((await draft(lines(), { JVDate: '' })).error, /Entry date is required/);
  assert.match((await draft([L('9000', 100, 0), L('1000', 0, 100)])).error, /header account/);
  assert.match((await draft([L('9100', 100, 0, { CostCenterID: 'CC1' }), L('1000', 0, 100)])).error, /inactive/);
  assert.match((await draft([L('7777', 100, 0), L('1000', 0, 100)])).error, /not found/);
  assert.match((await draft([L('6000', 100, 0), L('1000', 0, 100)])).error, /requires a Cost Center/);
  assert.match((await draft([L('1000', 100, 5), L('1100', 0, 95)])).error, /either a debit or a credit/);
  assert.match((await draft([L('1000', -5, 0), L('1100', 0, 5)])).error, /cannot be negative/);

  const unbalanced = await draft([L('1000', 100, 0), L('1100', 0, 90)]);
  assert.equal(unbalanced.success, true, 'a draft may be unbalanced');
  assert.match((await call('u-admin', 'postJournalEntry', { jvId: unbalanced.jvId })).error, /not balanced: total debit 100.00 vs total credit 90.00/);
  const single = await draft([L('1000', 100, 0)]);
  assert.match((await call('u-admin', 'postJournalEntry', { jvId: single.jvId })).error, /at least two lines/);

  // An account deactivated after the draft was saved is caught at post.
  const s = await draft(lines());
  await rtdb.ref('coa/A-EXP/Status').set('Inactive');
  assert.match((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).error, /6000 is inactive/);
  assert.equal((await doc(s.jvId)).Status, 'Draft');
});

test('approval gate: no TXN ref until approved; reject -> edit -> repost', async () => {
  const f = fixture();
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft(lines());
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.status, 'PendingApproval', p.error);
  assert.equal(p.transactionRef, '');
  let rec = await doc(s.jvId);
  assert.equal(rec.TransactionRef, '');
  assert.equal((await call('u-admin', 'getJournalEntries', {})).total, 1);

  const rej = await call('u-approver', 'decideJournalEntryApproval', { jvId: s.jvId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong account' });
  assert.equal(rej.status, 'Rejected', rej.error);
  rec = await doc(s.jvId);
  assert.equal(rec.Status, 'Rejected');
  assert.equal(rec.RejectionReason, 'Wrong account');
  assert.equal((await draft([L('6000', 80, 0, { CostCenterID: 'CC1' }), L('1100', 0, 80)], { JVID: s.jvId })).success, true);
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'PendingApproval');

  const ok = await call('u-approver', 'decideJournalEntryApproval', { jvId: s.jvId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
  rec = await doc(s.jvId);
  assert.equal(rec.Status, 'Posted');
  assert.equal(rec.TransactionRef, 'TXN-00000001');
  assert.equal(rec.TotalDebit, 80);
  assert.equal(rec.RejectionReason, '');
});

test('reversal mirrors the lines once; PORT FIX: a stock-originated GL entry is refused', async () => {
  await reset(fixture());
  const s = await draft(lines());
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  const r = await call('u-admin', 'reverseJournalEntry', { jvId: s.jvId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  const rev = await doc(r.jvId);
  assert.equal(rev.Status, 'Posted');
  assert.equal(rev.ReversalOfJV, s.jvId);
  assert.equal(rev.Reference, p.jvNumber);
  assert.equal(rev.TransactionRef, 'TXN-00000002');
  assert.deepEqual(rev.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), [['6000', 0, 100], ['1000', 100, 0]]);
  assert.equal((await doc(s.jvId)).ReversedByJV, r.jvId);
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: s.jvId, reversalDate: D })).error, /already been reversed/);

  const draftOnly = await draft(lines());
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: draftOnly.jvId })).error, /Only posted entries/);

  await firestore.collection('journalEntries').doc('GRN-GL').set({
    VoucherType: 'GRN', Status: 'Posted', CompanyID: 'C1', JVNumber: 'GRN-01-26-000001', Description: 'Receipt',
    Lines: [L('1300', 50, 0), L('2100', 0, 50)], TotalDebit: 50, TotalCredit: 50, ReversedByJV: ''
  });
  const g = await call('u-admin', 'reverseJournalEntry', { jvId: 'GRN-GL', reversalDate: D });
  assert.deepEqual(g, { success: false, error: 'This entry was posted by GRN — reverse it from that module, not here.' });
  assert.equal((await doc('GRN-GL')).ReversedByJV, '');
});

test('delete, default currency, list scoping and access', async () => {
  await reset(fixture());
  assert.deepEqual(await call('u-admin', 'getDefaultCurrency', {}), { CurrencyID: 'CUR1', Code: 'AED', Name: 'Dirham', Symbol: 'AED' });
  const s = await draft(lines());
  assert.equal((await draft(lines(), {}, 'u-viewer')).success, false);
  assert.deepEqual(await draft(lines(), {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-viewer', 'postJournalEntry', { jvId: s.jvId })).success, false);
  assert.deepEqual(await call('u-other', 'postJournalEntry', { jvId: s.jvId }), { success: false, error: 'You do not have access to that company.' });
  assert.deepEqual(await call('u-other', 'deleteJournalDraft', { jvId: s.jvId }), { success: false, error: 'You do not have access to that company.' });
  assert.equal((await call('u-other', 'getJournalEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getJournalEntries', {})).total, 1);
  assert.deepEqual(await call('u-admin', 'deleteJournalDraft', { jvId: s.jvId }), { success: true });
  assert.equal(await doc(s.jvId), null);
});
