// PROFITLOSS through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

const L = (acct, code, d, c) => ({ AccountID: acct, AccountCode: code, AccountName: code, Debit: d, Credit: c });
const je = (id, date, co, lines) => firestore.collection('journalEntries').doc(id).set({ JVDate: date, JVNumber: id, Status: 'Posted', VoucherType: 'JV', CompanyID: co, Lines: lines });

test.before(async () => {
  await reset(baseFixture());
  await je('J1', '2026-08-20', 'C1', [L('A-AR', '1200', 90, 0), L('A-REV', '4000', 0, 90)]);   // before the period
  await je('J2', '2026-09-10', 'C1', [L('A-AR', '1200', 500, 0), L('A-REV', '4000', 0, 500)]);
  await je('J3', '2026-09-10', 'C1', [L('A-COGS', '5000', 200, 0), L('A-INV', '1300', 0, 200)]);
  await je('J4', '2026-09-15', 'C1', [L('A-CONS', '5100', 50, 0), L('A-CASH', '1000', 0, 50)]);
});
test.after(async () => { await app.delete(); });

test('revenue - COGS = gross profit; - expenses = net income; period-bounded', async () => {
  const r = await call('u-admin', 'getProfitAndLoss', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.equal(r.totalRevenue, 500); assert.equal(r.totalCogs, 200); assert.equal(r.grossProfit, 300);
  assert.equal(r.totalExpense, 50); assert.equal(r.netIncome, 250);
  assert.deepEqual(r.expense.map(e => [e.AccountCode, e.Amount]), [['5100', 50]]);
});

test('start date required; company access', async () => {
  await assert.rejects(call('u-admin', 'getProfitAndLoss', { params: {} }), /Select a start date\./);
  await assert.rejects(call('u-admin', 'getProfitAndLoss', { params: { FromDate: '2026-01-01', CompanyID: 'C2' } }), /You do not have access to that company\./);
});
