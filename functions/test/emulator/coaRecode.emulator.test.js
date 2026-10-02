// Chart of Accounts: moving an account to another head (owner, 2026-10-02;
// docs/modules/COA_RECODE.md). An account that has never been used gets the
// next code under its new head; one that has been used (posted, in a draft,
// a template or a document) or that has child accounts keeps its code and
// the move is refused. Links by ID from master data don't count as use.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });

const acc = (code, name, parent, postable) => ({ AccountCode: code, AccountName: name, AccountType: 'Asset', Status: 'Active', IsPostable: postable !== false, ParentAccountID: parent || '' });
function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    H1: acc('110000', 'Bank Accounts', '', false),
    H2: acc('120000', 'Cash in Hand', '', false),
    L1: acc('110001', 'Petty Cash (wrong head)', 'H1'),
    L2: acc('110002', 'Bank Main', 'H1'),
    L3: acc('110003', 'Bank Draft Only', 'H1'),
    L4: acc('120001', 'Main Cash', 'H2'),
    L5: acc('110004', 'Stock in Transit', 'H1'),
    L6: acc('110005', 'Bank Template Only', 'H1')
  });
  f.items.I1.InventoryAccountID = 'L5';
  return f;
}
const save = (id, extra) => call('u-admin', 'saveAccount', { accountData: Object.assign({ AccountID: id, AccountName: fixture().coa[id].AccountName, AccountType: 'Asset', IsPostable: true, Status: 'Active' }, extra) });

test.beforeEach(async () => { await reset(fixture()); });

test('an unused account moved to another head gets the next code there; the screen is told the old code', async () => {
  const r = await save('L1', { ParentAccountID: 'H2' });
  assert.deepEqual(r, { success: true, accountId: 'L1', accountCode: '120002', codeChangedFrom: '110001' });
  const a = await val('coa/L1');
  assert.deepEqual([a.AccountCode, a.ParentAccountID, a.AccountName], ['120002', 'H2', 'Petty Cash (wrong head)']);
  // Saving it again without moving keeps the new code.
  assert.deepEqual(await save('L1', { ParentAccountID: 'H2', AccountName: 'Petty Cash' }), { success: true, accountId: 'L1', accountCode: '120002', codeChangedFrom: '' });
});

test('an account with a posted entry keeps its code: the move is refused, naming the entry', async () => {
  const d = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Deposit', CompanyID: 'C1', CurrencyCode: 'AED',
    Lines: [{ AccountCode: '110002', Debit: 100, Description: 'Deposit' }, { AccountCode: '1000', Credit: 100, Description: 'Deposit' }] } });
  assert.equal(d.success, true, d.error);
  const p = await call('u-admin', 'postJournalEntry', { jvId: d.jvId });
  assert.equal(p.success, true, p.error);
  const r = await save('L2', { ParentAccountID: 'H2' });
  assert.equal(r.success, false);
  assert.equal(r.error, 'Account 110002 has already been used (Journal entry ' + p.jvNumber + "), so it can't move to another head with a new code. " +
    'Create a new account under the right head, move the balance to it with a JV, and deactivate this one.');
  const a = await val('coa/L2');
  assert.deepEqual([a.AccountCode, a.ParentAccountID], ['110002', 'H1']);
});

test('a draft or a template counts as use too', async () => {
  const d = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Pending', CompanyID: 'C1', CurrencyCode: 'AED',
    Lines: [{ AccountCode: '110003', Debit: 5, Description: 'x' }, { AccountCode: '1000', Credit: 5, Description: 'x' }] } });
  assert.equal(d.success, true, d.error);
  let r = await save('L3', { ParentAccountID: 'H2' });
  assert.match(r.error, /^Account 110003 has already been used \(Journal entry draft\)/);
  await rtdb.ref('recurringJournals/RJ1').set({ Name: 'Monthly bank charge', Lines: [{ AccountCode: '110005', Debit: 10 }] });
  r = await save('L6', { ParentAccountID: 'H2' });
  assert.match(r.error, /^Account 110005 has already been used \(Recurring Journal Monthly bank charge\)/);
});

test('a link from master data (an item\'s Inventory account, by ID) is not use: the move goes ahead', async () => {
  const r = await save('L5', { ParentAccountID: 'H2' });
  assert.equal(r.success, true, r.error);
  assert.equal(r.accountCode, '120002');
  assert.equal((await val('items/I1')).InventoryAccountID, 'L5');
});

test('a head with child accounts can\'t move; renaming without moving keeps every code', async () => {
  const r = await call('u-admin', 'saveAccount', { accountData: { AccountID: 'H1', AccountName: 'Bank Accounts', AccountType: 'Asset', IsPostable: false, ParentAccountID: 'H2', Status: 'Active' } });
  assert.equal(r.error, "This account has child accounts, so it can't move to another head: its code would no longer match theirs. Move or deactivate the child accounts first.");
  const k = await call('u-admin', 'saveAccount', { accountData: { AccountID: 'H1', AccountName: 'Banks', AccountType: 'Asset', IsPostable: false, ParentAccountID: '', Status: 'Active' } });
  assert.deepEqual(k, { success: true, accountId: 'H1', accountCode: '110000', codeChangedFrom: '' });
  const l4 = await save('L4', { ParentAccountID: 'H2', AccountName: 'Main Cash Box' });
  assert.deepEqual(l4, { success: true, accountId: 'L4', accountCode: '120001', codeChangedFrom: '' });
});
