// CASHFLOW through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

const L = (acct, code, d, c) => ({ AccountID: acct, AccountCode: code, AccountName: code, Debit: d, Credit: c });
const je = (id, date, lines) => firestore.collection('journalEntries').doc(id).set({ JVDate: date, JVNumber: id, Status: 'Posted', VoucherType: 'JV', CompanyID: 'C1', Lines: lines });

test.before(async () => {
  const f = baseFixture();
  // Cash accounts are identified by code prefix 10/11 (A-CASH 1000, A-BANK 1100).
  f.coa.HFA = { AccountCode: '16', AccountName: 'Fixed Assets', AccountType: 'Asset', Status: 'Active', IsPostable: false, CashFlowCategory: 'Investing' };
  f.coa.HFA2 = { AccountCode: '161', AccountName: 'Equipment (sub-header, no own category)', AccountType: 'Asset', Status: 'Active', IsPostable: false, ParentAccountID: 'HFA', CashFlowCategory: '' };
  f.coa['A-EQP'] = { AccountCode: '1611', AccountName: 'Machinery', AccountType: 'Asset', Status: 'Active', IsPostable: true, ParentAccountID: 'HFA2' };
  f.coa.HEQ = { AccountCode: '30', AccountName: 'Equity', AccountType: 'Equity', Status: 'Active', IsPostable: false, CashFlowCategory: 'Financing' };
  f.coa['A-EQ'].ParentAccountID = 'HEQ';
  await reset(f);
  await je('J0', '2026-08-01', [L('A-BANK', '1100', 1000, 0), L('A-EQ', '3000', 0, 1000)]);          // before period: capital
  await je('J1', '2026-09-02', [L('A-BANK', '1100', 500, 0), L('A-EQ', '3000', 0, 500)]);            // financing +500
  await je('J2', '2026-09-05', [L('A-EQP', '1611', 300, 0), L('A-BANK', '1100', 0, 300)]);           // investing -300
  await je('J3', '2026-09-07', [L('A-CONS', '5100', 50, 0), L('A-CASH', '1000', 0, 50)]);            // operating -50
  await je('J4', '2026-09-08', [L('A-CASH', '1000', 20, 0), L('A-BANK', '1100', 0, 20)]);            // cash-to-cash: no effect
});
test.after(async () => { await app.delete(); });

test('categories resolve through nested headers; reconciles to the cash movement', async () => {
  const r = await call('u-admin', 'getCashFlowStatement', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.equal(r.totalFinancing, 500);
  assert.equal(r.totalInvesting, -300, 'machinery under a blank sub-header inherits Investing from the top header');
  assert.equal(r.totalOperating, -50);
  assert.equal(r.openingCash, 1000); assert.equal(r.closingCash, 1150); assert.equal(r.netChange, 150);
  assert.equal(r.reconciles, true);
});

test('start date required', async () => {
  await assert.rejects(call('u-admin', 'getCashFlowStatement', { params: {} }), /Select a start date\./);
});
