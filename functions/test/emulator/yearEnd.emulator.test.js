// Period Closing, step 2: the year-end close (docs/modules/PERIOD_CLOSING.md,
// decisions 125, 129, 140-143): the closing entry by account, cost center
// and profit center to Retained Earnings, dated the year's last day (the
// one posting into a closed month), every income / cost / expense balance
// at zero after it (an inactive account and a line with no cost center
// included); the P&L leaves it out, the Trial Balance has it unless asked
// "before closing", the Balance Sheet carries the profit in Retained
// Earnings; the year's months stay closed until it is reopened; reopening
// reverses the entry; years close in order; rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.notEqual(r && r.success, false, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => e); return r instanceof Error ? r.message : (r && r.error) || 'no error: ' + JSON.stringify(r); };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();

function fixture() {
  const f = baseFixture();
  const acc = (code, name, type, extra) => Object.assign({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true }, extra || {});
  Object.assign(f.coa, {
    'A-RE': acc('310000', 'Retained Earnings', 'Equity'),
    'A-EXP': acc('6100', 'Freight', 'Expense'),
    'A-OLD': acc('6900', 'Old Expense', 'Expense', { Status: 'Inactive' })
  });
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.PC1 = { Type: 'ProfitCenter', Code: 'PC1', Name: 'Trading', Status: 'Active', CompanyID: 'C1' };
  return f;
}
async function postJv(date, lines) {
  const id = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: 'Entry', CompanyID: 'C1', Lines: lines } })).jvId;
  ok(await call('u-admin', 'postJournalEntry', { jvId: id }));
  return id;
}
const L = (code, dr, cr, cc, pc) => ({ AccountCode: code, Debit: dr, Credit: cr, Description: 'x', CostCenterID: cc || '', ProfitCenterID: pc || '' });
const pl = (from, to) => call('u-admin', 'getProfitAndLoss', { params: { FromDate: from, ToDate: to, CompanyID: 'C1' } });
const tb = (from, to, before) => call('u-admin', 'getTrialBalancePeriod', { params: { FromDate: from, ToDate: to, CompanyID: 'C1', BeforeYearEndClose: before } });
const row = (r, code) => r.rows.find(x => x.AccountCode === code) || {};
const year = y => call('u-admin', 'getPeriodClosing', { companyId: 'C1', year: y });

async function seeded() {
  await reset(fixture());
  await postJv('2025-03-10', [L('1100', 1000, 0), L('4000', 0, 1000, 'CC1', 'PC1')]); // sales
  await postJv('2025-06-15', [L('6100', 300, 0, 'CC1'), L('1100', 0, 300)]);
  await postJv('2025-09-20', [L('6100', 200, 0, 'CC2'), L('1100', 0, 200)]);
  await postJv('2026-01-05', [L('1100', 50, 0), L('4000', 0, 50, 'CC1', 'PC1')]); // the next year
  // An old entry: an expense now inactive, no cost center.
  await firestore.collection('journalEntries').doc('OLD1').set({ CompanyID: 'C1', JVDate: '2024-05-01', Status: 'Posted', VoucherType: 'JV', JVNumber: 'JV-OLD',
    Lines: [{ AccountID: 'A-OLD', AccountCode: '6900', Debit: 70, Credit: 0 }, { AccountID: 'A-BANK', AccountCode: '1100', Debit: 0, Credit: 70 }] });
}

test('close the year: only when its months are closed; the entry by account, cost center and profit center to Retained Earnings; the reports after it', async () => {
  await seeded();
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2025-11');
  let y = (await year('2025-01')).Year;
  assert.deepEqual([y.Closed, y.CanClose, y.CloseNote, y.End], [false, false, 'Close all its months first.', '2025-12-31']);
  assert.match(await err(call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' })), /can't be closed yet: Close all its months first/);
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2025-12');
  assert.match(await err(call('u-viewer', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' })), /permission to close/);
  assert.match(await err(call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-02' })), /Choose the financial year/);
  const r = ok(await call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' }));
  y = (await year('2025-01')).Year;
  assert.deepEqual([y.Closed, y.JVNumber, y.CanReopen, y.ClosedBy], [true, r.jvNumber, true, 'Admin User']);
  assert.match(r.jvNumber, /^YEC-/);
  const e = await jv(y.JVID);
  assert.deepEqual([e.VoucherType, e.JVDate, e.Status, e.TotalDebit, e.TotalCredit], ['YearEndClose', '2025-12-31', 'Posted', 1570, 1570]);
  const lines = e.Lines.map(l => [l.AccountCode, l.CostCenterID, l.ProfitCenterID, l.Debit, l.Credit]).sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(lines, [
    ['310000', '', '', 70, 0], // the old year's loss, carried by the first close
    ['310000', 'CC1', '', 300, 0],
    ['310000', 'CC1', 'PC1', 0, 1000],
    ['310000', 'CC2', '', 200, 0],
    ['4000', 'CC1', 'PC1', 1000, 0],
    ['6100', 'CC1', '', 0, 300],
    ['6100', 'CC2', '', 0, 200],
    ['6900', '', '', 0, 70]
  ].sort((a, b) => String(a).localeCompare(String(b))));

  // P&L: the closed year still shows its figures; the new year only its own.
  const p25 = await pl('2025-01-01', '2025-12-31');
  assert.deepEqual([p25.totalRevenue, p25.totalExpense, p25.netIncome], [1000, 500, 500]);
  assert.deepEqual([(await pl('2026-01-01', '2026-01-31')).totalRevenue], [50]);
  // Trial Balance: the new year opens with nothing on income and expense; "before closing" shows them.
  const t = await tb('2026-01-01', '2026-01-31');
  assert.deepEqual([row(t, '4000').OpeningCredit || 0, row(t, '4000').PeriodCredit, row(t, '310000').OpeningCredit, row(t, '6900').OpeningDebit || 0], [0, 50, 430, 0]);
  const tBefore = await tb('2026-01-01', '2026-01-31', true);
  assert.deepEqual([row(tBefore, '4000').OpeningCredit, row(tBefore, '310000').OpeningCredit || 0, tBefore.beforeYearEndClose], [1000, 0, true]);
  assert.deepEqual([t.totals.ClosingDebit, tBefore.totals.ClosingDebit], [t.totals.ClosingCredit, tBefore.totals.ClosingCredit]); // balances either way
  // Balance Sheet: last year's profit in Retained Earnings, the new year's as "not yet closed".
  const bs = await call('u-admin', 'getBalanceSheet', { params: { AsOfDate: '2026-01-31', CompanyID: 'C1' } });
  assert.deepEqual(bs.equity.map(x => [x.AccountCode, x.Amount]), [['', 50], ['310000', 430]]);
  assert.equal(bs.balanced, true);

  // Years close in order: an earlier year can't close after a later one; nor twice.
  assert.match(await err(call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2024-01' })), /A later year is already closed/);
  assert.match(await err(call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' })), /already closed/);
  // The entry is the close's own: not reversed from the JV screen.
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: y.JVID, reversalDate: '2026-02-01' })), /posted by YearEndClose — reverse it from that module/);
  // The financial year is fixed now (129).
  assert.match(await err(call('u-admin', 'savePeriodClosingSettings', { companyId: 'C1', settings: { FiscalYearStart: 'Apr', RetainedEarningsAccountID: 'A-RE' } })), /can't change after/);
});

test('the months: a closed year\'s month stays closed until the year is reopened (143); the next year\'s months close before it (142); reopening the year reverses its entry', async () => {
  await seeded();
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2025-12');
  const r = ok(await call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' }));
  assert.match(await err(call('u-admin', 'reopenPeriod', { companyId: 'C1', month: '2025-06', reason: 'x' })), /The financial year 2025 is closed: reopen the year first, then the month/);
  // 142: January 2026 closes and reopens freely.
  ok(await call('u-admin', 'closePeriod', { companyId: 'C1', month: '2026-01' }));
  ok(await call('u-admin', 'reopenPeriod', { companyId: 'C1', month: '2026-01', reason: 'Late bill' }));
  // Reopening the year: a reason; its entry reversed on the same date; the reports as before the close.
  assert.match(await err(call('u-admin', 'reopenFinancialYear', { companyId: 'C1', year: '2025-01', reason: '' })), /reason/);
  assert.match(await err(call('u-viewer', 'reopenFinancialYear', { companyId: 'C1', year: '2025-01', reason: 'x' })), /permission to reopen/);
  const back = ok(await call('u-admin', 'reopenFinancialYear', { companyId: 'C1', year: '2025-01', reason: 'Audit adjustment' }));
  const y = (await year('2025-01')).Year;
  assert.deepEqual([y.Closed, y.CanClose], [false, true]);
  const yec = (await firestore.collection('journalEntries').where('VoucherType', '==', 'YearEndClose').get()).docs.map(d => d.data());
  const original = yec.find(x => x.JVNumber === r.jvNumber), reversal = yec.find(x => x.JVNumber === back.reversalNumber);
  assert.deepEqual([reversal.JVDate, reversal.TotalDebit, original.ReversedByJV !== '', reversal.ReversalOfJV !== ''], ['2025-12-31', 1570, true, true]);
  assert.equal(row(await tb('2026-01-01', '2026-01-31'), '4000').OpeningCredit, 1000);
  // Now the month reopens; the log has the year's close and reopen.
  ok(await call('u-admin', 'reopenPeriod', { companyId: 'C1', month: '2025-06', reason: 'Audit adjustment' }));
  const log = (await year('2025-01')).Log.map(l => l.Action);
  assert.deepEqual(log.slice(0, 3), ['Reopen', 'Reopen year', 'Reopen']);
  assert.ok(log.includes('Close year'));
  // Closed again later: a new entry (the reversed pair stays in the GL).
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2025-12');
  const again = ok(await call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' }));
  assert.notEqual(again.jvNumber, r.jvNumber);
  assert.equal(row(await tb('2026-01-01', '2026-01-31'), '4000').OpeningCredit || 0, 0);
});

test('the reports propose the company\'s financial year; April-March', async () => {
  await reset(fixture());
  assert.deepEqual(await call('u-admin', 'getFinancialYearStart', { companyId: 'C1', date: '2026-02-10' }), { FiscalYearStart: 'Jan', Start: '2026-01-01', End: '2026-12-31' });
  ok(await call('u-admin', 'savePeriodClosingSettings', { companyId: 'C1', settings: { FiscalYearStart: 'Apr', RetainedEarningsAccountID: 'A-RE' } }));
  assert.deepEqual(await call('u-viewer', 'getFinancialYearStart', { companyId: 'C1', date: '2026-02-10' }), { FiscalYearStart: 'Apr', Start: '2025-04-01', End: '2026-03-31' });
  assert.deepEqual((await call('u-admin', 'getFinancialYearStart', { companyId: '', date: '2026-02-10' })).Start, '2026-01-01');
  assert.match(await err(call('u-other', 'getFinancialYearStart', { companyId: 'C1' })), /access to that company/);
  // An April year closes on 31 March.
  await postJv('2025-05-01', [L('1100', 10, 0), L('4000', 0, 10, 'CC1')]);
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2026-03');
  const r = ok(await call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-04' }));
  const e = (await firestore.collection('journalEntries').where('JVNumber', '==', r.jvNumber).get()).docs[0].data();
  assert.deepEqual([e.JVDate, e.FinancialYearStart], ['2026-03-31', '2025-04']);
});
