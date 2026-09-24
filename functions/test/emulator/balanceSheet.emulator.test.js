// BALANCESHEET through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

const L = (acct, code, d, c) => ({ AccountID: acct, AccountCode: code, AccountName: code, Debit: d, Credit: c });
const je = (id, date, co, lines) => firestore.collection('journalEntries').doc(id).set({ JVDate: date, JVNumber: id, Status: 'Posted', VoucherType: 'JV', CompanyID: co, Lines: lines });

test.before(async () => {
  await reset(baseFixture());
  await je('J1', '2026-08-01', 'C1', [L('A-CASH', '1000', 1000, 0), L('A-EQ', '3000', 0, 1000)]);        // capital
  await je('J2', '2026-08-05', 'C1', [L('A-INV', '1300', 300, 0), L('A-AP', '2000', 0, 300)]);           // stock on credit
  await je('J3', '2026-09-10', 'C1', [L('A-AR', '1200', 500, 0), L('A-REV', '4000', 0, 500)]);           // sale
  await je('J4', '2026-09-10', 'C1', [L('A-COGS', '5000', 200, 0), L('A-INV', '1300', 0, 200)]);          // cost of sale
});
test.after(async () => { await app.delete(); });

test('assets = liabilities + equity, with current-period earnings as a synthetic equity line', async () => {
  const r = await call('u-admin', 'getBalanceSheet', { params: { AsOfDate: '2026-09-30' } });
  assert.deepEqual(r.assets.map(a => [a.AccountCode, a.Amount]), [['1000', 1000], ['1200', 500], ['1300', 100]]);
  assert.deepEqual(r.liabilities.map(a => [a.AccountCode, a.Amount]), [['2000', 300]]);
  assert.deepEqual(r.equity.map(a => [a.AccountName, a.Amount]), [['Retained Earnings (Current Period — not yet closed)', 300], ['Capital', 1000]]);
  assert.equal(r.totalAssets, 1600); assert.equal(r.totalLiabilities, 300); assert.equal(r.totalEquity, 1300);
  assert.equal(r.balanced, true);
});

test('as-of date before the sale', async () => {
  const r = await call('u-admin', 'getBalanceSheet', { params: { AsOfDate: '2026-08-31' } });
  assert.equal(r.totalAssets, 1300);
  assert.equal(r.equity.length, 1);
  assert.equal(r.balanced, true);
});
