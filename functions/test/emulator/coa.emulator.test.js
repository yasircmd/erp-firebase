// COA (Chart of Accounts) through its screen's callables. saveAccount
// runs under the global lock (LockService shim → lock.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

test('create header + postable child; code follows the account-type digit', async () => {
  // A class (no parent), a group under it, an account under the group (docs/modules/COA_NUMBERING.md).
  const cls = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Assets X', AccountType: 'Asset', IsPostable: false } });
  assert.deepEqual([cls.success, cls.accountCode], [true, '100000'], JSON.stringify(cls));
  const hdr = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Current Assets X', AccountType: 'Asset', IsPostable: false, CashFlowCategory: 'Operating', ParentAccountID: cls.accountId } });
  assert.equal(hdr.success, true, JSON.stringify(hdr));
  assert.match(hdr.accountCode, /^1[1-9]0000$/);
  const child = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Petty Cash X', AccountType: 'Asset', IsPostable: true, ParentAccountID: hdr.accountId } });
  assert.equal(child.success, true, JSON.stringify(child));
  assert.match(child.accountCode, /^1/);
  assert.equal((await val('coa/' + child.accountId)).ParentAccountID, hdr.accountId);
  const list = await call('u-admin', 'getChartOfAccounts');
  assert.ok(list.some(a => a.AccountName === 'Petty Cash X'));
  // Header with children can't become postable.
  const bad = await call('u-admin', 'saveAccount', { accountData: { AccountID: hdr.accountId, AccountName: 'Current Assets X', AccountType: 'Asset', IsPostable: true, ParentAccountID: cls.accountId } });
  assert.equal(bad.error, 'This account has child accounts and cannot be marked postable.');
});

test('validation: type, parent type mismatch, self-parent', async () => {
  let r = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'X', AccountType: 'Bogus', IsPostable: true } });
  assert.match(r.error, /Account type must be one of/);
  r = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'X', AccountType: 'Expense', IsPostable: true, ParentAccountID: 'A-INV' } });
  assert.equal(r.error, 'Parent account must be the same account type.');
  r = await call('u-admin', 'saveAccount', { accountData: { AccountID: 'A-INV', AccountName: 'Inventory', AccountType: 'Asset', IsPostable: true, ParentAccountID: 'A-INV' } });
  assert.equal(r.error, 'An account cannot be its own parent.');
});

test('concurrent saves serialize under the global lock and get distinct codes; lock released', async () => {
  const expenses = (await call('u-admin', 'getChartOfAccounts')).find(x => x.AccountCode === '600000');
  const g = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Office X', AccountType: 'Expense', IsPostable: false, ParentAccountID: expenses.AccountID } });
  assert.equal(g.success, true, JSON.stringify(g));
  const [a, b] = await Promise.all([
    call('u-admin', 'saveAccount', { accountData: { AccountName: 'Conc A', AccountType: 'Expense', IsPostable: true, ParentAccountID: g.accountId } }),
    call('u-admin', 'saveAccount', { accountData: { AccountName: 'Conc B', AccountType: 'Expense', IsPostable: true, ParentAccountID: g.accountId } })
  ]);
  assert.equal(a.success, true, JSON.stringify(a));
  assert.equal(b.success, true, JSON.stringify(b));
  assert.notEqual(a.accountCode, b.accountCode);
  assert.equal((await firestore.doc('system/globalLock').get()).exists, false, 'lock released');
});

test('Viewer cannot modify; deactivate/reactivate', async () => {
  const v = await call('u-viewer', 'saveAccount', { accountData: { AccountName: 'X', AccountType: 'Asset', IsPostable: true } });
  assert.equal(v.success, false);
  assert.equal((await call('u-admin', 'deactivateAccount', { accountId: 'A-EQ' })).success, true);
  assert.equal((await val('coa/A-EQ')).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateAccount', { accountId: 'A-EQ' })).success, true);
});
