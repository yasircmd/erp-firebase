// TRIALBALANCE through its screen's callable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb } = require('./_helpers');

const L = (acct, code, d, c) => ({ AccountID: acct, AccountCode: code, AccountName: code, Debit: d, Credit: c });
const je = (id, date, status, co, lines) => firestore.collection('journalEntries').doc(id).set({ JVDate: date, JVNumber: id, Status: status, VoucherType: 'JV', CompanyID: co, Lines: lines });

test.before(async () => {
  await reset(baseFixture());
  await je('J1', '2026-08-01', 'Posted', 'C1', [L('A-CASH', '1000', 500, 0), L('A-EQ', '3000', 0, 500)]);
  await je('J2', '2026-09-10', 'Posted', 'C1', [L('A-CONS', '5100', 120, 0), L('A-CASH', '1000', 0, 120)]);
  await je('J3', '2026-09-20', 'Draft', 'C1', [L('A-CONS', '5100', 1, 0), L('A-CASH', '1000', 0, 1)]);
  await je('J4', '2026-09-10', 'Posted', 'C2', [L('A-CASH', '1000', 777, 0), L('A-EQ', '3000', 0, 777)]);
  // October: cash to bank and back, so Bank moves but opens and closes at nil.
  await je('J5', '2026-10-05', 'Posted', 'C1', [L('A-BANK', '1100', 200, 0), L('A-CASH', '1000', 0, 200)]);
  await je('J6', '2026-10-06', 'Posted', 'C1', [L('A-CASH', '1000', 200, 0), L('A-BANK', '1100', 0, 200)]);
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

// getTrialBalancePeriod: opening / transactions / closing (2026-09-27).
const cols = r => [r.AccountCode, r.OpeningDebit, r.OpeningCredit, r.PeriodDebit, r.PeriodCredit, r.ClosingDebit, r.ClosingCredit];

test('period TB: opening before From, gross debits and credits in the period, closing', async () => {
  const r = await call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.deepEqual(r.rows.map(cols), [
    ['1000', 500, 0, 0, 120, 380, 0],
    ['3000', 0, 500, 0, 0, 0, 500],
    ['5100', 0, 0, 120, 0, 120, 0]
  ]);
  assert.deepEqual(r.totals, { OpeningDebit: 500, OpeningCredit: 500, PeriodDebit: 120, PeriodCredit: 120, ClosingDebit: 500, ClosingCredit: 500 });
  assert.equal(r.fromDate, '2026-09-01'); assert.equal(r.toDate, '2026-09-30');
});

test('period TB: From and To are inclusive, later entries and drafts excluded, closing equals the as-of TB', async () => {
  const r = await call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-08-01', ToDate: '2026-09-10', CompanyID: 'C1' } });
  assert.deepEqual(r.rows.map(cols), [
    ['1000', 0, 0, 500, 120, 380, 0],
    ['3000', 0, 0, 0, 500, 0, 500],
    ['5100', 0, 0, 120, 0, 120, 0]
  ]);
  const asOf = await call('u-admin', 'getTrialBalance', { params: { AsOfDate: '2026-09-10' } });
  assert.deepEqual(r.rows.map(x => [x.AccountCode, x.ClosingDebit, x.ClosingCredit]), asOf.rows.map(x => [x.AccountCode, x.Debit, x.Credit]));
});

test('period TB: gross movement shown even when it nets to nil; accounts with only an opening balance shown; empty period', async () => {
  const r = await call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-10-01', ToDate: '2026-10-31' } });
  assert.deepEqual(r.rows.map(cols), [
    ['1000', 380, 0, 200, 200, 380, 0],
    ['1100', 0, 0, 200, 200, 0, 0],
    ['3000', 0, 500, 0, 0, 0, 500],
    ['5100', 120, 0, 0, 0, 120, 0]
  ]);
  const early = await call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-01-01', ToDate: '2026-07-31' } });
  assert.deepEqual(early.rows, []);
  assert.equal(early.totals.ClosingDebit, 0);
});

test('period TB: both dates required, From not after To, company access, module access', async () => {
  await assert.rejects(call('u-admin', 'getTrialBalancePeriod', { params: { ToDate: '2026-09-30' } }), /Select both a From date and a To date\./);
  await assert.rejects(call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-30', ToDate: '2026-09-01' } }), /The From date is after the To date\./);
  await assert.rejects(call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30', CompanyID: 'C2' } }), /You do not have access to that company\./);
  const other = await call('u-other', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.deepEqual(other.rows.map(cols), [['1000', 0, 0, 777, 0, 777, 0], ['3000', 0, 0, 0, 777, 0, 777]]);
  const viewer = await call('u-viewer', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.equal(viewer.rows.length, 3);
  await rtdb.ref('permissions/TRIALBALANCE/access').set(['Admin']);
  try {
    await assert.rejects(call('u-viewer', 'getTrialBalancePeriod', { params: { FromDate: '2026-09-01', ToDate: '2026-09-30' } }), /You do not have access to Trial Balance\./);
  } finally {
    await rtdb.ref('permissions/TRIALBALANCE/access').set(['Admin', 'Viewer']);
  }
});
