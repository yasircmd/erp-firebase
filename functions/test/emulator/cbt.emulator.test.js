// CBT (cash and bank vouchers) through its screen's callables: Dr/Cr
// inferred from the voucher type, ledger account prefix rules, posting
// through the shared JV engine with the type's own voucher prefix
// (CP/CR/BP/BR), list scoped to CBT types, reversal, access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-BANK2'] = { AccountCode: '1101', AccountName: 'C2 Bank', AccountType: 'Asset', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  f.coa['A-BHDR'] = { AccountCode: '1199', AccountName: 'Banks header', AccountType: 'Asset', Status: 'Active', IsPostable: false };
  return f;
}
test.after(async () => { await app.delete(); });

const opp = (o) => Object.assign({ AccountCode: '6000', Amount: '250.50', Description: 'Stationery', CostCenterID: 'CC1' }, o);
const draft = (type, ledger, lines, extra, uid) => call(uid || 'u-admin', 'saveCbtDraft', {
  cbtData: Object.assign({ VoucherType: type, SelectedAccountCode: ledger, JVDate: D, Description: 'Voucher', CompanyID: 'C1', CostCenterID: 'CC1', OppositeLines: lines }, extra || {})
});
const doc = async (id) => (await firestore.collection('journalEntries').doc(id).get()).data();
const dc = (rec) => rec.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]);

test('payment credits the ledger, receipt debits it; posts with the type prefix', async () => {
  await reset(fixture());
  const bp = await draft('Bank Payment', '1100', [opp(), opp({ Amount: '49.50', Description: 'Pens' }), opp({ AccountCode: '' })]);
  assert.equal(bp.success, true, bp.error);
  let rec = await doc(bp.jvId);
  assert.equal(rec.VoucherType, 'Bank Payment');
  assert.equal(rec.SelectedAccountCode, '1100');
  assert.deepEqual(dc(rec), [['1100', 0, 300], ['6000', 250.5, 0], ['6000', 49.5, 0]]);
  assert.equal(rec.Lines[0].Description, 'Voucher', 'ledger line mirrors the header description');
  const p = await call('u-admin', 'postJournalEntry', { jvId: bp.jvId });
  assert.equal(p.status, 'Posted', p.error);
  assert.match(p.jvNumber, /^BP/);

  const cr = await draft('Cash Receipt', '1000', [opp({ AccountCode: '4000', Amount: 80, Description: 'Sale' })]);
  assert.equal(cr.success, true, cr.error);
  assert.deepEqual(dc(await doc(cr.jvId)), [['1000', 80, 0], ['4000', 0, 80]]);
  assert.match((await call('u-admin', 'postJournalEntry', { jvId: cr.jvId })).jvNumber, /^CR/);

  const list = await call('u-admin', 'getCbtEntries', {});
  assert.equal(list.total, 2);
  // A plain JV doesn't appear in the CBT list, and vice versa.
  await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'JV', CompanyID: 'C1', Lines: [{ AccountCode: '1000', Debit: 1, Description: 'a' }, { AccountCode: '1100', Credit: 1, Description: 'b' }] } });
  assert.equal((await call('u-admin', 'getCbtEntries', {})).total, 2);
  assert.equal((await call('u-admin', 'getJournalEntries', {})).total, 1);

  const r = await call('u-admin', 'reverseJournalEntry', { jvId: bp.jvId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.match(r.jvNumber, /^BP/);
  const rev = await doc(r.jvId);
  assert.equal(rev.VoucherType, 'Bank Payment');
  assert.deepEqual(dc(rev), [['1100', 300, 0], ['6000', 0, 250.5], ['6000', 0, 49.5]]);
});

test('ledger and line validation', async () => {
  await reset(fixture());
  assert.match((await draft('Petty Cash', '1000', [opp()])).error, /Select a transaction type/);
  assert.match((await draft('Bank Payment', '', [opp()])).error, /Select a cash or bank ledger/);
  assert.match((await draft('Bank Payment', '1000', [opp()])).error, /not a valid Bank ledger account/);
  assert.match((await draft('Cash Payment', '1100', [opp()])).error, /not a valid Cash ledger account/);
  assert.match((await draft('Bank Payment', '1199', [opp()])).error, /header account/);
  assert.match((await draft('Bank Payment', '9999', [opp()])).error, /ledger account not found/);
  assert.match((await draft('Bank Payment', '1101', [opp()])).error, /restricted to a specific company/);
  assert.match((await draft('Bank Payment', '1100', [opp({ AccountCode: '1100' })])).error, /same account selected as the bank ledger/);
  assert.match((await draft('Bank Payment', '1100', [opp({ Amount: '0' })])).error, /amount greater than zero/);
  assert.match((await draft('Bank Payment', '1100', [])).error, /at least one line/);
  assert.match((await draft('Bank Payment', '1100', [opp({ CostCenterID: '' })], { CostCenterID: '' })).error, /requires a Cost Center/);
  await rtdb.ref('coa/A-BANK/Status').set('Inactive');
  assert.match((await draft('Bank Payment', '1100', [opp()])).error, /ledger account is inactive/);
});

test('access and approval gate keyed to CBT', async () => {
  const f = fixture();
  f.approvalConfigurations = { CBT: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { CBT: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  assert.equal((await draft('Cash Payment', '1000', [opp()], {}, 'u-viewer')).success, false);
  assert.deepEqual(await draft('Cash Payment', '1000', [opp()], {}, 'u-other'), { success: false, error: 'You do not have access to that company.' });
  const s = await draft('Cash Payment', '1000', [opp()]);
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'PendingApproval');
  const ok = await call('u-approver', 'decideJournalEntryApproval', { jvId: s.jvId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);
  assert.equal((await doc(s.jvId)).Status, 'Posted');
  assert.equal((await call('u-other', 'getCbtEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getCbtEntries', {})).total, 1);
});
