// The Chart of Accounts numbering (owner, 2026-10-16; docs/modules/
// COA_NUMBERING.md, decisions 197-210): the seeded chart (a class per type,
// its groups under it, Cash and Bank marked); an account always under a
// group (never the class, never no parent); Cash / Bank by the group's
// mark, which its accounts follow, and which Cash and Bank Transactions
// reads instead of the code; Renumber a used account within its heading,
// every stored copy of the old code rewritten; the accounts to fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-09-10';
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const ok = r => { assert.equal(r.success, true, r.error); return r; };
let chart, idOf;
const save = (data, uid) => call(uid || 'u-admin', 'saveAccount', { accountData: Object.assign({ AccountType: 'Asset', IsPostable: true, Status: 'Active', CompanyID: '' }, data) });
const cbt = (type, ledger, code) => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: type, SelectedAccountCode: ledger, JVDate: D, Description: 'Voucher', CompanyID: 'C1', CostCenterID: 'CC1',
  OppositeLines: [{ AccountCode: code || '4000', Amount: '100', Description: 'x', CostCenterID: 'CC1' }] } });

test.before(async () => {
  await reset(baseFixture());
  chart = await call('u-admin', 'getChartOfAccounts', {}); // seeds the chart
  idOf = code => (chart.find(a => a.AccountCode === code) || {}).AccountID;
});

test('the seeded chart: a class per type, its groups under it; 110000 Cash and 120000 Bank marked', async () => {
  const by = Object.fromEntries(chart.map(a => [a.AccountCode, a]));
  assert.deepEqual(['100000', '200000', '300000', '400000', '500000', '600000'].map(c => [by[c].IsPostable, by[c].ParentAccountID]), Array(6).fill([false, '']));
  assert.deepEqual([by['110000'].ParentAccountID, by['120000'].ParentAccountID, by['320000'].ParentAccountID, by['630000'].ParentAccountID],
    [idOf('100000'), idOf('100000'), idOf('300000'), idOf('600000')]);
  assert.deepEqual([by['110000'].CashBank, by['120000'].CashBank, by['130000'].CashBank], ['Cash', 'Bank', '']);
});

test('an account always under a group: never straight under the class or with no parent; a group under the class, a sub-group under a group', async () => {
  assert.match(await err(save({ AccountName: 'Loose cash', ParentAccountID: idOf('100000') })), /can't sit straight under the class 100000/);
  assert.match(await err(save({ AccountName: 'Loose cash', ParentAccountID: '' })), /sits under a group/);
  assert.match(await err(save({ AccountName: 'Second assets class', ParentAccountID: '', IsPostable: false })), /class 100000 already exists/);
  const petty = ok(await save({ AccountName: 'Petty cash', ParentAccountID: idOf('110000') }));
  assert.equal(petty.accountCode, '110001');
  assert.equal((await val('coa/' + petty.accountId)).CashBank, 'Cash', 'it takes its group\'s mark');
  const g = ok(await save({ AccountName: 'Deposits', ParentAccountID: idOf('100000'), IsPostable: false }));
  assert.equal(g.accountCode, '150000');
  const sub = ok(await save({ AccountName: 'Current accounts', ParentAccountID: idOf('120000'), IsPostable: false }));
  assert.equal(sub.accountCode, '121000');
  const bank = ok(await save({ AccountName: 'Bank A current', ParentAccountID: sub.accountId }));
  assert.deepEqual([bank.accountCode, (await val('coa/' + bank.accountId)).CashBank], ['121001', 'Bank'], 'through the sub-group');
  // A heading does not become an account.
  assert.match(await err(save({ AccountID: g.accountId, AccountName: 'Deposits', ParentAccountID: idOf('100000'), IsPostable: true })), /is a heading/);
  // The mark: an Assets group only, not a class.
  assert.match(await err(save({ AccountName: 'Odd', AccountType: 'Expense', ParentAccountID: idOf('600000'), IsPostable: false, CashBank: 'Cash' })), /Only an Assets group/);
  assert.match(await err(save({ AccountID: idOf('100000'), AccountName: 'Assets', ParentAccountID: '', IsPostable: false, CashBank: 'Bank' })), /not a class/);
});

test('Cash and Bank Transactions go by the mark: a group marked Cash gives cash accounts; unmarked, they are not; the accounts follow the group', async () => {
  chart = await call('u-admin', 'getChartOfAccounts', {});
  const g = idOf('150000');
  const wallet = ok(await save({ AccountName: 'Cash wallets', ParentAccountID: g }));
  assert.equal(wallet.accountCode, '150001');
  assert.match(await err(cbt('Cash Payment', '150001')), /not a valid Cash ledger account/);
  ok(await save({ AccountID: g, AccountName: 'Deposits', ParentAccountID: idOf('100000'), IsPostable: false, CashBank: 'Cash' }));
  assert.equal((await val('coa/' + wallet.accountId)).CashBank, 'Cash', 'the account under it follows');
  ok(await cbt('Cash Payment', '150001'));
  assert.match(await err(cbt('Bank Payment', '150001')), /not a valid Bank ledger account/);
  ok(await save({ AccountID: g, AccountName: 'Deposits', ParentAccountID: idOf('100000'), IsPostable: false, CashBank: '' }));
  assert.equal((await val('coa/' + wallet.accountId)).CashBank, '');
  // The old codes mean nothing now: 1000 is cash only because it is marked.
  ok(await cbt('Cash Payment', '1000'));
  await rtdb.ref('coa/A-CASH/CashBank').set('');
  assert.match(await err(cbt('Cash Payment', '1000')), /not a valid Cash ledger account/);
  await rtdb.ref('coa/A-CASH/CashBank').set('Cash');
});

test('Renumber a used account within its heading: every copy of the old code rewritten, the old code kept; refused outside the heading', async () => {
  chart = await call('u-admin', 'getChartOfAccounts', {});
  const petty = idOf('110001');
  const jv = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Float', CompanyID: 'C1', CurrencyCode: 'AED',
    Lines: [{ AccountCode: '110001', Debit: 100, Description: 'Float' }, { AccountCode: '1100', Credit: 100, Description: 'Float' }] } }));
  const posted = ok(await call('u-admin', 'postJournalEntry', { jvId: jv.jvId }));
  const draft = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Top up', CompanyID: 'C1', CurrencyCode: 'AED',
    Lines: [{ AccountCode: '110001', Debit: 5, Description: 'x' }, { AccountCode: '1100', Credit: 5, Description: 'x' }] } }));
  await rtdb.ref('recurringJournals/RJ1').set({ Name: 'Monthly float', Lines: [{ AccountCode: '110001', Debit: 10 }, { AccountCode: '1100', Credit: 10 }] });
  const codes = await call('u-admin', 'getAccountRenumberCodes', { accountId: petty });
  assert.deepEqual([codes.heading.AccountCode, codes.codes[0], codes.codes.includes('110001'), codes.codes.length], ['110000', '110002', false, 998]);
  assert.match(await err(call('u-viewer', 'renumberAccount', { accountId: petty, newCode: '110007', reason: 'x' })), /permission to change the Chart of Accounts/);
  assert.match(await err(call('u-admin', 'renumberAccount', { accountId: petty, newCode: '110007' })), /reason/);
  assert.match(await err(call('u-admin', 'renumberAccount', { accountId: petty, newCode: '120005', reason: 'x' })), /not a free code of 110000/);
  assert.match(await err(call('u-admin', 'renumberAccount', { accountId: idOf('110000'), newCode: '110009', reason: 'x' })), /Only an account that takes postings/);
  const r = ok(await call('u-admin', 'renumberAccount', { accountId: petty, newCode: '110007', reason: 'Match the old ledger' }));
  assert.deepEqual([r.from, r.to], ['110001', '110007']);
  const a = await val('coa/' + petty);
  assert.deepEqual([a.AccountCode, a.FormerCodes.map(f => [f.Code, f.Reason])], ['110007', [['110001', 'Match the old ledger']]]);
  const lines = async id => (await firestore.collection('journalEntries').doc(id).get()).data().Lines.map(l => l.AccountCode);
  assert.deepEqual(await lines(posted.jvId || jv.jvId), ['110007', '1100'], 'the posted lines');
  assert.deepEqual(await lines(draft.jvId), ['110007', '1100'], 'the draft');
  assert.deepEqual((await val('recurringJournals/RJ1')).Lines.map(l => l.AccountCode), ['110007', '1100'], 'the template');
  const log = Object.values(await val('coaRenumberLog'));
  assert.deepEqual([log.length, log[0].From, log[0].To, log[0].By], [1, '110001', '110007', 'Admin User']);
  // The balance is where it was (by the account's ID), and a save keeps the old code on record.
  const tb = await call('u-admin', 'getTrialBalance', { companyId: 'C1', fromDate: '2026-01-01', toDate: '2026-12-31' }).catch(() => null);
  if (tb && tb.rows) assert.ok(tb.rows.some(x => x.AccountCode === '110007' && (x.PeriodDebit || x.Debit) === 100), JSON.stringify(tb.rows.slice(0, 5)));
  ok(await save({ AccountID: petty, AccountName: 'Petty cash', ParentAccountID: idOf('110000') }));
  assert.deepEqual((await val('coa/' + petty)).FormerCodes.map(f => f.Code), ['110001']);
  // The old code is free again.
  assert.equal(ok(await save({ AccountName: 'Till', ParentAccountID: idOf('110000') })).accountCode, '110001');
});

test('the accounts to fix: those that take postings outside a group', async () => {
  await rtdb.ref('coa/X1').set({ AccountCode: '100001', AccountName: 'Old cash', AccountType: 'Asset', Status: 'Active', IsPostable: true, ParentAccountID: idOf('100000') });
  const r = await call('u-admin', 'getCoaAccountsToFix', {});
  const fix = Object.fromEntries(r.accounts.map(x => [x.AccountCode, x.Problem]));
  assert.equal(fix['100001'], 'sits straight under the class 100000');
  assert.equal(fix['1000'], 'has no group above it', 'the test chart\'s own accounts');
  assert.equal(fix['110007'], undefined);
});

test('a save that doesn\'t send the mark (an import) keeps it', async () => {
  chart = await call('u-admin', 'getChartOfAccounts', {});
  ok(await call('u-admin', 'saveAccount', { accountData: { AccountID: idOf('120000'), AccountName: 'Bank Accounts', AccountType: 'Asset', IsPostable: false, Status: 'Active', CompanyID: '', ParentAccountID: idOf('100000') } }));
  assert.equal((await val('coa/' + idOf('120000'))).OwnCashBank, 'Bank');
});
