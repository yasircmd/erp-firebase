// CBT Fund Transfer (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md,
// addendum): money moved between the company's own cash and bank accounts.
// One From account (credited), one To account (debited), both cash or bank,
// same company; numbered FT-; its own Approval Configuration entry, which
// starts as a copy of Bank Payment's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
test.after(async () => { await app.delete(); });

function fixture() {
  const f = baseFixture();
  f.users['u-approver2'] = { status: 'Active', role: 'Admin', username: 'approver2', fullName: 'Approver Two', AssignedCompanies: ['C1'] };
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-PETTY'] = { AccountCode: '1001', AccountName: 'Petty Cash', AccountType: 'Asset', SubCategory: 'Cash', CashBank: 'Cash', Status: 'Active', IsPostable: true };
  f.coa['A-BANK2'] = { AccountCode: '1101', AccountName: 'C2 Bank', AccountType: 'Asset', SubCategory: 'Bank', CashBank: 'Bank', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  return f;
}
const ft = (from, to, amount, extra, lines) => call('u-admin', 'saveCbtDraft', { cbtData: Object.assign({
  VoucherType: 'Fund Transfer', SelectedAccountCode: from, JVDate: D, Description: 'Cash deposit', CompanyID: 'C1', CostCenterID: 'CC1',
  OppositeLines: lines || [{ AccountCode: to, Amount: amount, Description: 'Deposit' }] }, extra || {}) });
const doc = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const dc = rec => rec.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]);

test('a transfer credits From and debits To; FT- numbers; listed with CBT; reversed as FT-', async () => {
  await reset(fixture());
  const s = await ft('1000', '1100', 500);
  assert.equal(s.success, true, s.error);
  const rec = await doc(s.jvId);
  assert.equal(rec.VoucherType, 'Fund Transfer');
  assert.deepEqual(dc(rec), [['1000', 0, 500], ['1100', 500, 0]], 'cash to bank: a deposit');
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.status, 'Posted', p.error);
  assert.match(p.jvNumber, /^FT/);
  assert.deepEqual((await call('u-admin', 'getCbtEntries', {})).entries.map(e => e.VoucherType), ['Fund Transfer']);
  assert.equal((await call('u-admin', 'getJournalEntries', {})).total, 0, 'not a JV');

  // Bank to bank and cash to cash are allowed too.
  await rtdb.ref('coa/A-BANK3').set({ AccountCode: '1102', AccountName: 'Savings', AccountType: 'Asset', SubCategory: 'Bank', CashBank: 'Bank', Status: 'Active', IsPostable: true, NormalBalance: 'Debit' });
  assert.equal((await ft('1100', '1102', 100)).success, true);
  assert.equal((await ft('1000', '1001', 50)).success, true);

  const r = await call('u-admin', 'reverseJournalEntry', { jvId: s.jvId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.match(r.jvNumber, /^FT/);
  assert.deepEqual(dc(await doc(r.jvId)), [['1000', 500, 0], ['1100', 0, 500]]);
});

test('checks: From and To both cash or bank, different, one line, one company; no party tags', async () => {
  await reset(fixture());
  const err = async p => (await p).error;
  assert.match(await err(ft('1000', '6000', 10)), /goes to another cash or bank account; 6000 is neither/);
  assert.match(await err(ft('6000', '1100', 10)), /Transfer from a cash or bank account/);
  assert.match(await err(ft('1000', '1000', 10)), /same account selected as the From ledger/);
  assert.match(await err(ft('1000', null, 0, {}, [{ AccountCode: '1100', Amount: 5, Description: 'a' }, { AccountCode: '1001', Amount: 5, Description: 'b' }])), /one To account/);
  assert.match(await err(ft('1000', null, 0, {}, [])), /Select the account to transfer to/);
  assert.match(await err(ft('', '1100', 10)), /Select the account to transfer from/);
  assert.match(await err(ft('1000', '1101', 10)), /belongs to another company/);
  const s = await ft('1000', null, 0, {}, [{ AccountCode: '1100', Amount: 20, Description: 'x', PartyType: 'Vendor', PartyID: 'V1' }]);
  assert.equal(s.success, true, s.error);
  assert.ok((await doc(s.jvId)).Lines.every(l => !l.PartyType), 'party tags dropped');
});

test('Cash Flow: a transfer is neither an inflow nor an outflow', async () => {
  await reset(fixture());
  const s = await ft('1000', '1100', 300);
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'Posted');
  const r = await call('u-admin', 'getCashFlowStatement', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.deepEqual([r.totalOperating, r.totalInvesting, r.totalFinancing, r.netChange], [0, 0, 0, 0]);
  assert.equal(r.reconciles, true);
});

const level = uid => ({ Levels: [{ LevelNumber: 1, ApproverUserID: uid, ThresholdAmount: 0 }] });
test('approvals: its own entry, starting as a copy of Bank Payment\'s (once); the task names it', async () => {
  const f = fixture();
  // Live today: the four-way split already done, Bank Payment set up.
  f.approvalMigrations = { cbtSplit: { DoneAt: '2026-09-29T08:00:00Z', CopiedFromCBT: true } };
  f.approvalConfigurations = { CBT_BANKPAYMENT: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' }, CBT_CASHPAYMENT: { Enabled: false, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { CBT_BANKPAYMENT: { GLOBAL: level('u-approver2') } };
  await reset(f);
  const list = await call('u-admin', 'getApprovalConfigurations', {});
  const m = list.find(x => x.ModuleID === 'CBT_FUNDTRANSFER');
  assert.deepEqual([m.Label, m.Enabled, m.ScopeType], ['Cash & Bank — Fund Transfer', true, 'Global']);
  assert.deepEqual(await val('approvalLevels/CBT_FUNDTRANSFER/GLOBAL'), level('u-approver2'));

  const s = await ft('1100', '1000', 70);
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'PendingApproval');
  const [t] = await call('u-approver2', 'getPendingApprovalsForUser', {});
  assert.deepEqual([t.DocumentID, t.ConfigKey, t.ModuleLabel], [s.jvId, 'CBT_FUNDTRANSFER', 'Cash & Bank — Fund Transfer']);
  const ok = await call('u-approver2', 'decideJournalEntryApproval', { jvId: s.jvId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(ok.status, 'Approved', ok.error);

  // Edited afterwards: the copy never runs again.
  await rtdb.ref('approvalConfigurations/CBT_FUNDTRANSFER/Enabled').set(false);
  await rtdb.ref('approvalLevels/CBT_BANKPAYMENT/GLOBAL').set(level('u-approver'));
  await call('u-admin', 'getApprovalConfigurations', {});
  assert.equal(await val('approvalConfigurations/CBT_FUNDTRANSFER/Enabled'), false);
  assert.equal(await val('approvalLevels/CBT_FUNDTRANSFER/GLOBAL/Levels/0/ApproverUserID'), 'u-approver2');
});

test('approvals: a system that never split CBT gets all five from the CBT setup; an own setup is kept', async () => {
  const f = fixture();
  f.approvalConfigurations = { CBT: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { CBT: { GLOBAL: level('u-approver') } };
  await reset(f);
  await call('u-admin', 'getApprovalConfigurations', {});
  assert.deepEqual(await val('approvalLevels/CBT_FUNDTRANSFER/GLOBAL'), level('u-approver'), 'via Bank Payment, itself from CBT');

  const g = fixture();
  g.approvalMigrations = { cbtSplit: { DoneAt: 'x' } };
  g.approvalConfigurations = { CBT_BANKPAYMENT: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' }, CBT_FUNDTRANSFER: { Enabled: false, ScopeType: 'Company', GateType: 'Flat' } };
  g.approvalLevels = { CBT_BANKPAYMENT: { GLOBAL: level('u-approver2') } };
  await reset(g);
  await call('u-admin', 'getApprovalConfigurations', {});
  assert.deepEqual(await val('approvalConfigurations/CBT_FUNDTRANSFER'), { Enabled: false, ScopeType: 'Company', GateType: 'Flat' });
  assert.equal(await val('approvalLevels/CBT_FUNDTRANSFER'), null);
});
