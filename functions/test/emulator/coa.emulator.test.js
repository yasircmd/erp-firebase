// COA (Chart of Accounts) through its screen's callables. saveAccount
// runs under the global lock (LockService shim → lock.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

test('create header + postable child; code follows the account-type digit', async () => {
  const hdr = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Current Assets X', AccountType: 'Asset', IsPostable: false, CashFlowCategory: 'Operating' } });
  assert.equal(hdr.success, true, JSON.stringify(hdr));
  assert.match(hdr.accountCode, /^1/);
  const child = await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Petty Cash X', AccountType: 'Asset', IsPostable: true, ParentAccountID: hdr.accountId } });
  assert.equal(child.success, true, JSON.stringify(child));
  assert.match(child.accountCode, /^1/);
  assert.equal((await val('coa/' + child.accountId)).ParentAccountID, hdr.accountId);
  const list = await call('u-admin', 'getChartOfAccounts');
  assert.ok(list.some(a => a.AccountName === 'Petty Cash X'));
  // Header with children can't become postable.
  const bad = await call('u-admin', 'saveAccount', { accountData: { AccountID: hdr.accountId, AccountName: 'Current Assets X', AccountType: 'Asset', IsPostable: true } });
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
  const [a, b] = await Promise.all([
    call('u-admin', 'saveAccount', { accountData: { AccountName: 'Conc A', AccountType: 'Expense', IsPostable: true } }),
    call('u-admin', 'saveAccount', { accountData: { AccountName: 'Conc B', AccountType: 'Expense', IsPostable: true } })
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
