// TRIALBALANCE through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

const L = (acct, code, d, c) => ({ AccountID: acct, AccountCode: code, AccountName: code, Debit: d, Credit: c });
const je = (id, date, status, co, lines) => firestore.collection('journalEntries').doc(id).set({ JVDate: date, JVNumber: id, Status: status, VoucherType: 'JV', CompanyID: co, Lines: lines });

test.before(async () => {
  await reset(baseFixture());
  await je('J1', '2026-08-01', 'Posted', 'C1', [L('A-CASH', '1000', 500, 0), L('A-EQ', '3000', 0, 500)]);
  await je('J2', '2026-09-10', 'Posted', 'C1', [L('A-CONS', '5100', 120, 0), L('A-CASH', '1000', 0, 120)]);
  await je('J3', '2026-09-20', 'Draft', 'C1', [L('A-CONS', '5100', 1, 0), L('A-CASH', '1000', 0, 1)]);
  await je('J4', '2026-09-10', 'Posted', 'C2', [L('A-CASH', '1000', 777, 0), L('A-EQ', '3000', 0, 777)]);
});
test.after(async () => { await app.delete(); });

test('balanced, net per account, drafts and other companies excluded, sorted by code', async () => {
  const r = await call('u-admin', 'getTrialBalance', { params: { AsOfDate: '2026-09-30' } });
  assert.deepEqual(r.rows.map(x => [x.AccountCode, x.Debit, x.Credit]), [['1000', 380, 0], ['3000', 0, 500], ['5100', 120, 0]]);
  assert.equal(r.totalDebit, 500); assert.equal(r.totalCredit, 500);
});

test('as-of date and explicit company', async () => {
  const r = await call('u-admin', 'getTrialBalance', { params: { AsOfDate: '2026-08-31', CompanyID: 'C1' } });
  assert.deepEqual(r.rows.map(x => [x.AccountCode, x.Debit, x.Credit]), [['1000', 500, 0], ['3000', 0, 500]]);
  await assert.rejects(call('u-admin', 'getTrialBalance', { params: { CompanyID: 'C2' } }), /You do not have access to that company\./);
});
