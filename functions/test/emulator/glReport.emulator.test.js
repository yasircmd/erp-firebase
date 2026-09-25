// GLREPORT through its screen's callable (Firestore GL entries).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

function je(id, date, status, companyId, lines) {
  return firestore.collection('journalEntries').doc(id).set({ JVDate: date, JVNumber: id, TransactionRef: 'T-' + id, Description: 'Entry ' + id,
    Status: status, VoucherType: 'JV', CompanyID: companyId, Lines: lines });
}
const L = (acct, code, d, c, cc) => ({ AccountID: acct, AccountCode: code, AccountName: code, Description: '', Debit: d, Credit: c, CostCenterID: cc || '' });

test.before(async () => {
  const f = baseFixture();
  // Header H1 > (A-CASH, sub-header H2 > A-BANK) — the live chart nests like this.
  f.coa.H1 = { AccountCode: '10', AccountName: 'Cash & Bank', AccountType: 'Asset', Status: 'Active', IsPostable: false };
  f.coa.H2 = { AccountCode: '11', AccountName: 'Banks', AccountType: 'Asset', Status: 'Active', IsPostable: false, ParentAccountID: 'H1' };
  f.coa['A-CASH'].ParentAccountID = 'H1';
  f.coa['A-BANK'].ParentAccountID = 'H2';
  await reset(f);
  await je('J1', '2026-08-15', 'Posted', 'C1', [L('A-CASH', '1000', 100, 0), L('A-EQ', '3000', 0, 100)]);
  await je('J2', '2026-09-05', 'Posted', 'C1', [L('A-BANK', '1100', 40, 0, 'CC1'), L('A-CASH', '1000', 0, 40)]);
  await je('J3', '2026-09-06', 'Draft', 'C1', [L('A-CASH', '1000', 7, 0), L('A-EQ', '3000', 0, 7)]);
  await je('J4', '2026-09-07', 'Posted', 'C2', [L('A-CASH', '1000', 999, 0), L('A-EQ', '3000', 0, 999)]);
});
test.after(async () => { await app.delete(); });

const rep = (p) => call('u-admin', 'getGlReport', { params: Object.assign({ FromDate: '2026-09-01', ToDate: '2026-09-30' }, p) });

test('postable account: opening from earlier entries, running balance, other company and drafts excluded', async () => {
  const r = await rep({ AccountID: 'A-CASH' });
  assert.equal(r.openingBalance, 100);
  assert.deepEqual(r.rows.map(x => [x.JVNumber, x.Debit, x.Credit, x.Balance]), [['J2', 0, 40, 60]]);
  assert.equal(r.closingBalance, 60);
  const withDraft = await rep({ AccountID: 'A-CASH', IncludeDraft: true });
  assert.equal(withDraft.closingBalance, 67);
});

test('header rolls up ALL descendants (incl. accounts under a sub-header)', async () => {
  const r = await rep({ AccountID: 'H1' });
  assert.equal(r.account.IsRollup, true);
  assert.equal(r.openingBalance, 100);
  assert.deepEqual(r.rows.map(x => [x.AccountCode, x.Debit, x.Credit]).sort(), [['1000', 0, 40], ['1100', 40, 0]]);
  assert.equal(r.closingBalance, 100, 'cash 60 + bank 40');
});

test('dimension filter and validation', async () => {
  const r = await rep({ AccountID: 'A-BANK', CostCenterID: 'CC1' });
  assert.equal(r.closingBalance, 40);
  await assert.rejects(call('u-admin', 'getGlReport', { params: {} }), /Select an account\./);
});
