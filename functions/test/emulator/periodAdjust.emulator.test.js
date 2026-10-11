// Period Closing, step 1c (docs/modules/PERIOD_CLOSING.md, decisions 131,
// 136-139): a payroll or depreciation posting whose month is closed is,
// on the user's Continue (adjustInOpenMonth), posted on the first day of
// the first open month instead: a payroll run's reversal and its redo, a
// payroll payment's reversal, a depreciation run's reversal and its redo.
// Without the Continue it is refused with the offer; other reversals are
// not adjustable; a reopened month posts as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.notEqual(r && r.success, false, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => e); return r instanceof Error ? r.message : (r && r.error) || 'no error: ' + JSON.stringify(r); };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const closeThrough = month => rtdb.ref('periodClosing/C1/ClosedThrough').set(month);
const OFFER = /2026-07 is closed for Test Co One\. It can be adjusted in the first open month: it is posted on 2026-08-01 \(the run or document keeps its own month\)\. Continue to adjust it there, or reopen 2026-07 in Period Closing first\./;

function payrollFixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  return f;
}
// One employee, paid 3,000 a month; July run posted (dated 2026-07-31).
async function julyRun() {
  await reset(payrollFixture());
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G1', Level: 1 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk' } })).designationId;
  const emp = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01',
    CostCenterID: 'CC1', BankName: 'ENBD', IBAN: 'AE070331234567890123456' } })).employeeId;
  const el = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: emp, compensation: { Lines: [{ ElementID: el.BASIC, Amount: 3000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: el.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  const sys = (await call('u-admin', 'getPayrollSetup', {})).elements.find(e => e.Code === 'UNPAIDLV');
  await call('u-admin', 'savePayElementPayroll', { elementId: sys.ElementID, glAccountId: 'A-SAL' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  const runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId })).status, 'Posted');
  return runId;
}
const runOf = async id => (await call('u-admin', 'getPayrollRun', { runId: id })).run;

test('payroll run (131, 136, 137): refused with the offer; on Continue reversed on the first open day; the redo posts there too, the run keeps its month', async () => {
  const runId = await julyRun();
  const posted = await runOf(runId);
  await closeThrough('2026-07');
  assert.match(await err(call('u-admin', 'reversePayrollRun', { runId, reason: 'Wrong basic' })), OFFER);
  assert.equal((await runOf(runId)).Status, 'Posted');
  const r = ok(await call('u-admin', 'reversePayrollRun', { runId, reason: 'Wrong basic', adjustInOpenMonth: true }));
  const original = await jv(posted.JVID);
  const reversal = await jv(original.ReversedByJV);
  assert.deepEqual([original.JVDate, reversal.JVDate, reversal.AdjustedFromDate, reversal.JVNumber], ['2026-07-31', '2026-08-01', '2026-07-31', r.reversalNumber]);
  const back = await runOf(runId);
  assert.deepEqual([back.Status, back.Month, back.AdjustInOpenMonth], ['Draft', '2026-07', true]);
  assert.match(back.History[back.History.length - 1].Note, /Wrong basic \(posted on 2026-08-01: 2026-07 is closed\)/);
  // The redo: no second question, posted on the first open day, still the July run.
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId })).status, 'Posted');
  const redone = await runOf(runId);
  const entry = await jv(redone.JVID);
  assert.deepEqual([redone.Month, entry.JVDate, entry.AdjustedFromDate, entry.TotalDebit], ['2026-07', '2026-08-01', '2026-07-31', 3000]);
});

test('payroll payment reversal (138): offered, then posted on the first open day; a JV reversal is not adjustable; a reopened month posts as before', async () => {
  const runId = await julyRun();
  const paid = ok(await call('u-admin', 'markPayrollPaid', { runId, paymentDate: '2026-07-31', way: 'BankFile', accountId: 'A-BANK' }));
  const run = await runOf(runId);
  const payment = run.Payments.find(p => !p.ReversedAt);
  await closeThrough('2026-07');
  assert.match(await err(call('u-admin', 'reversePayrollPayment', { runId, paymentId: payment.PaymentID, reason: 'Bounced' })), OFFER);
  ok(await call('u-admin', 'reversePayrollPayment', { runId, paymentId: payment.PaymentID, reason: 'Bounced', adjustInOpenMonth: true }));
  const orig = await jv(payment.JVID);
  assert.deepEqual([(await jv(orig.ReversedByJV)).JVDate, (await jv(orig.ReversedByJV)).AdjustedFromDate], ['2026-08-01', '2026-07-31']);
  assert.ok(paid);

  // A plain journal's reversal is not adjustable: the agreement changes nothing.
  const j = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-08-05', Description: 'x', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 5, Description: 'a' }, { AccountCode: '1100', Credit: 5, Description: 'b' }] } })).jvId;
  ok(await call('u-admin', 'postJournalEntry', { jvId: j }));
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: j, reversalDate: '2026-07-20', adjustInOpenMonth: true })), /2026-07 is closed for Test Co One \(closed through 2026-07\)/);

  // Reopened: the run reverses on its own date again, no offer.
  await closeThrough('2026-06');
  ok(await call('u-admin', 'reversePayrollRun', { runId, reason: 'Reopened' }));
  const again = await jv(run.JVID);
  assert.equal((await jv(again.ReversedByJV)).JVDate, '2026-07-31');
  assert.equal((await runOf(runId)).AdjustInOpenMonth, undefined);
});

function faFixture() {
  const f = baseFixture();
  const acc = (code, name, type) => ({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true });
  Object.assign(f.coa, { 'A-FACLR': acc('2300', 'Fixed Asset Clearing', 'Liability'), 'A-VEH': acc('1600', 'Vehicles', 'Asset'),
    'A-VEHAD': acc('1690', 'Acc. Depreciation Vehicles', 'Asset'), 'A-DEP': acc('6200', 'Depreciation Expense', 'Expense') });
  f.orgUnits.PC1 = { Type: 'ProfitCenter', Code: 'PC1', Name: 'Trading', Status: 'Active', CompanyID: 'C1' };
  f.currencies = { CUR1: { Code: 'AED', Name: 'Dirham', IsDefault: true, Status: 'Active' } };
  return f;
}

test('depreciation run (131, 136): its reversal offered, then on the first open day; the period redone there too; asset records keep the period', async () => {
  await reset(faFixture());
  ok(await call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLR' }));
  const det = ok(await call('u-admin', 'saveFaAccountDetermination', { Code: 'VEH', Name: 'Vehicles', ByCompany: { SHARED: {
    AssetCostAccountID: 'A-VEH', AccumDepAccountID: 'A-VEHAD', DepExpenseAccountID: 'A-DEP' } } }));
  const cls = ok(await call('u-admin', 'saveFaClass', { Code: 'veh', Name: 'Vehicles', Kind: 'Tangible', DefaultMethod: 'SL', DefaultUsefulLifeMonths: 120, AccountDeterminationID: det.determinationId }));
  const a = ok(await call('u-admin', 'saveFaAsset', { CompanyID: 'C1', ClassID: cls.classId, Description: 'Van', CostCenterID: 'CC1', ProfitCenterID: 'PC1', DepStartDate: '2026-07-01' }));
  const buy = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-07-01', Description: 'Van', CompanyID: 'C1', Lines: [
    { AccountCode: '2300', Debit: 120000, Description: 'Van' }, { AccountCode: '1100', Credit: 120000, Description: 'Bank' }] } })).jvId;
  ok(await call('u-admin', 'postJournalEntry', { jvId: buy }));
  const item = (await call('u-admin', 'getFaClearingItems', { companyId: 'C1' })).items.find(i => i.JVID === buy);
  const cap = ok(await call('u-admin', 'saveFaPostingDraft', { Type: 'Capitalization', CompanyID: 'C1', Date: '2026-07-01', Description: 'Capitalize',
    Lines: [{ AssetID: a.assetId, Items: [{ JVID: item.JVID, LineNo: item.LineNo, Amount: item.Open }] }] }));
  ok(await call('u-admin', 'postFaPosting', { postingId: cap.postingId }));
  const r1 = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-07' }));
  const run1 = (await firestore.collection('faRuns').doc(r1.runId).get()).data();
  assert.equal((await jv(run1.JVID)).JVDate, '2026-07-31');

  await closeThrough('2026-07');
  const offer = /Depreciation 2026-07: 2026-07 is closed for Test Co One\. It can be adjusted in the first open month: it is posted on 2026-08-01/;
  assert.match(await err(call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-07', reason: 'Wrong life' })), offer);
  ok(await call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-07', reason: 'Wrong life', adjustInOpenMonth: true }));
  const reversal = await jv((await jv(run1.JVID)).ReversedByJV);
  assert.equal(reversal.JVDate, '2026-08-01');
  const txn = (await firestore.collection('faTransactions').doc(r1.runId + '_' + a.assetId + '_R').get()).data();
  assert.deepEqual([txn.Period, txn.Date], ['2026-07', '2026-07-31']); // the asset record keeps the period
  // The redo of July: on the first open day, no second question.
  const r2 = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-07' }));
  const run2 = (await firestore.collection('faRuns').doc(r2.runId).get()).data();
  const e2 = await jv(run2.JVID);
  assert.deepEqual([run2.Period, e2.JVDate, e2.AdjustedFromDate, e2.TotalDebit], ['2026-07', '2026-08-01', '2026-07-31', 1000]);
  // August runs normally on its own date.
  const r3 = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-08' }));
  assert.equal((await jv((await firestore.collection('faRuns').doc(r3.runId).get()).data().JVID)).JVDate, '2026-08-31');
});
