// HR Payroll, step 5a: provisions (owner, 2026-10-05; docs/modules/HR_PAYROLL.md,
// the owner's points 1-3, decisions 28-33): each company's gratuity and leave
// salary settings; accrual types by grade with employee exceptions; opening
// provisions; each run provides the change in each employee's liability
// (gratuity, leave salary) and the accruals' share, posted with its journal;
// an accrual paid with the salary or by a claim; a reversed run takes its
// provisions back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');
const calc = require('../../src/payrollCalc');

test.after(async () => { await app.delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
let ALI, BEN, FLIGHT, JULY, AUG;
const slipOf = async (runId, emp) => (await call('u-admin', 'getPayrollRun', { runId })).slips.find(s => s.EmployeeID === emp);
const prov = (s, kind) => (s.Provisions || []).find(p => p.Kind === kind) || null;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const balances = async () => Object.fromEntries((await call('u-admin', 'getProvisionBalances', { companyId: 'C1' })).employees.map(e => [e.EmployeeID, e.Balances]));
const r2 = n => Math.round(n * 100) / 100;
const gratuity = (base, asOf) => calc.gratuityFor({}, { base, joinDate: '2021-01-01', asOf, provision: true }).amount;

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-FEXP': { AccountCode: '6120', AccountName: 'Air Ticket Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FPRO': { AccountCode: '2420', AccountName: 'Air Ticket Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const g7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, join, g) => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: join, CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan', '2021-01-01', g3); BEN = await emp('Ben Okafor', '2026-01-01', g7);
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }, { ElementID: els.HRA, Amount: 3000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: BEN, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 3000 }] } });
  for (const id of [els.BASIC, els.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: types.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '10', '30/06/2026']]) });
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
});

test('Payroll Setup → Provisions: the company\'s gratuity (UAE to start) and leave salary; an accrual by grade with an exception; checked', async () => {
  const s = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  assert.deepEqual([s.Gratuity.Enabled, s.Gratuity.MinYears, s.Gratuity.Slabs, s.Gratuity.DayRule, s.Gratuity.CapYears, s.Gratuity.StartsFrom, s.LeaveSalary.Base],
    [false, 1, [{ FromYear: 0, ToYear: 5, Days: 21 }, { FromYear: 5, ToYear: null, Days: 30 }], 'UAE365', 2, 'AfterYear', 'Basic']);
  const save = (g, l, uid) => call(uid || 'u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s.Gratuity, g), leaveSalary: Object.assign({}, s.LeaveSalary, l) });
  await assert.rejects(save({ Enabled: true }, {}), /Gratuity expense: account not found/);
  await assert.rejects(save({ Enabled: true, ExpenseAccountID: 'A-GPRO', ProvisionAccountID: 'A-GPRO' }, {}), /must be an expense/);
  await assert.rejects(save({ Slabs: [{ FromYear: 0, ToYear: 6, Days: 21 }, { FromYear: 5, ToYear: null, Days: 30 }] }, {}), /rows overlap/);
  await assert.rejects(save({}, {}, 'u-viewer'), /permission to change Payroll Setup/);
  await save({ Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' });
  const type = x => call('u-admin', 'saveAccrualType', { accrualType: Object.assign({ Name: 'Air ticket', Code: 'FLIGHT', Basis: 'Fixed', PaidAtLeaving: true, ExpenseAccountID: 'A-FEXP', ProvisionAccountID: 'A-FPRO',
    Rules: [{ LevelFrom: 1, LevelTo: 5, Value: 2400 }, { LevelFrom: 6, LevelTo: 99, Value: 6000 }], Exceptions: { [BEN]: { Value: 1200 } } }, x) });
  await assert.rejects(type({ Code: 'BASIC' }), /is a pay element's/);
  await assert.rejects(type({ Rules: [{ LevelFrom: 1, LevelTo: 5, Value: 1 }, { LevelFrom: 5, LevelTo: 9, Value: 1 }] }), /overlap/);
  await assert.rejects(type({ ProvisionAccountID: 'A-FEXP' }), /must be a liability/);
  FLIGHT = (await type({})).accrualTypeId;
});

test('opening provisions (Master Data Import): already in the GL, the first run provides only the change', async () => {
  const run = rows => call('u-admin', 'runMasterImport', { master: 'PROVOPEN', text: tsv([['Employee', 'Provision', 'Amount', 'Provided To']].concat(rows)) });
  const bad = await run([['EMP-0001', 'Pension', '100', '30/06/2026']]);
  assert.equal(bad.success, false);
  assert.match(JSON.stringify(bad.issues), /Gratuity, Leave salary, or an accrual/);
  const ok = await run([['EMP-0001', 'Gratuity', '20000', '30/06/2026'], ['EMP-0001', 'flight', '600', '30/06/2026']]);
  assert.equal(ok.success, true, JSON.stringify(ok.issues));
});

test('the run provides each liability\'s change and the accruals\' share; posted with its journal (expense by cost center, provision)', async () => {
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  const ali = await slipOf(JULY, ALI), ben = await slipOf(JULY, BEN);
  const gJul = gratuity(6000, '2026-07-31');
  assert.deepEqual([prov(ali, 'Gratuity').Liability, prov(ali, 'Gratuity').Provided, prov(ali, 'Gratuity').Amount], [gJul, 20000, r2(gJul - 20000)]);
  // Leave salary: 10 days on 30 June + 2 accrued in July = 12 × (6,000 ÷ 30).
  assert.deepEqual([prov(ali, 'LeaveSalary').Liability, prov(ali, 'LeaveSalary').Amount, prov(ali, 'LeaveSalary').Text], [2400, 2400, '12 days × 200.00 = 2,400.00']);
  assert.deepEqual([prov(ali, 'Accrual').Amount, prov(ali, 'Accrual').Liability], [200, 800], 'opening 600 + 200');
  // Ben: under a year, no gratuity yet (it starts once the year is done); his own air ticket, 1,200 a year.
  assert.deepEqual([prov(ben, 'Gratuity'), prov(ben, 'Accrual').Amount, prov(ben, 'LeaveSalary').Liability], [null, 100, 14 * 100]);
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: JULY })).status, 'Posted');
  const e = await jv((await call('u-admin', 'getPayrollRun', { runId: JULY })).run.JVID);
  const sum = (code, side) => r2(e.Lines.filter(l => l.AccountCode === code).reduce((t, l) => t + l[side], 0));
  assert.deepEqual([sum('6100', 'Debit'), sum('2400', 'Credit'), sum('6110', 'Debit'), sum('2410', 'Credit'), sum('6120', 'Debit'), sum('2420', 'Credit')],
    [r2(gJul - 20000), r2(gJul - 20000), 2400 + 1400, 2400 + 1400, 300, 300]);
  assert.ok(e.Lines.filter(l => l.AccountCode === '6100').every(l => l.CostCenterID === 'CC1'));
  assert.equal(e.TotalDebit, e.TotalCredit);
});

test('the next month provides only the change; an accrual paid with the salary comes from its provision', async () => {
  // Ben's leave salary was over-provided before: August's provision decreases it.
  const imp = await call('u-admin', 'runMasterImport', { master: 'PROVOPEN', text: tsv([['Employee', 'Provision', 'Amount', 'Provided To'], ['EMP-0002', 'Leave salary', '5000', '31/07/2026']]) });
  assert.equal(imp.success, true, JSON.stringify(imp.issues));
  AUG = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  await call('u-admin', 'savePayrollInputs', { runId: AUG, rows: [{ EmployeeID: ALI, Code: 'FLIGHT', Amount: 300, Note: 'Ticket home' }] });
  const ali = await slipOf(AUG, ALI);
  const gJul = gratuity(6000, '2026-07-31'), gAug = gratuity(6000, '2026-08-31');
  assert.deepEqual([prov(ali, 'Gratuity').Provided, prov(ali, 'Gratuity').Amount], [gJul, r2(gAug - gJul)]);
  assert.deepEqual([prov(ali, 'LeaveSalary').Provided, prov(ali, 'LeaveSalary').Amount], [2400, 400]);
  const payout = ali.Lines.find(l => l.Source === 'AccrualPayout');
  assert.deepEqual([payout.Name, payout.Amount, payout.Kind], ['Air ticket (from the provision)', 300, 'Earning']);
  await call('u-admin', 'submitPayrollRun', { runId: AUG });
  const e = await jv((await call('u-admin', 'getPayrollRun', { runId: AUG })).run.JVID);
  assert.ok(e.Lines.some(l => l.AccountCode === '2420' && l.Debit === 300 && /Air ticket \(from the provision\)/.test(l.Description)), 'Dr the provision, not the expense');
  // A decrease posts the other way: Dr the provision / Cr the expense (16 days × 100 = 1,600 less 5,000).
  assert.equal(prov(await slipOf(AUG, BEN), 'LeaveSalary').Amount, -3400);
  assert.ok(e.Lines.some(l => l.AccountCode === '2410' && l.Debit === 3400) && e.Lines.some(l => l.AccountCode === '6110' && l.Credit === 3400));
  const b = await balances();
  assert.deepEqual([b[ALI].Gratuity, b[ALI].LeaveSalary, b[ALI]['Accrual:' + FLIGHT]], [gAug, 2800, r2(600 + 200 + 200 - 300)]);
});

test('a claim against an accrual: Dr the provision / Cr cash; reversed with a reason; a reversed run takes its provisions back', async () => {
  const claim = (d, uid) => call(uid || 'u-admin', 'recordAccrualClaim', Object.assign({ employeeId: ALI, accrualTypeId: FLIGHT, date: '2026-09-10', amount: 500, accountId: 'A-CASH', note: 'Ticket' }, d));
  await assert.rejects(claim({}, 'u-viewer'), /permission to pay accruals/);
  await assert.rejects(claim({ accountId: 'A-SAL' }), /cash or bank account/);
  const c = await claim({});
  assert.match(c.jvNumber, /^PPR-/);
  assert.deepEqual((await jv((await call('u-admin', 'getProvisionBalances', { companyId: 'C1' })).claims[0].JVID)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort(), [['1000', 0, 500], ['2420', 500, 0]]);
  assert.equal((await balances())[ALI]['Accrual:' + FLIGHT], 200);
  await assert.rejects(call('u-admin', 'reverseAccrualClaim', { claimId: c.claimId }), /reason/);
  await call('u-admin', 'reverseAccrualClaim', { claimId: c.claimId, reason: 'Ticket refunded' });
  assert.equal((await balances())[ALI]['Accrual:' + FLIGHT], 700);
  await call('u-admin', 'reversePayrollRun', { runId: AUG, reason: 'Redo' });
  const b = await balances();
  assert.deepEqual([b[ALI].Gratuity, b[ALI].LeaveSalary, b[ALI]['Accrual:' + FLIGHT]], [gratuity(6000, '2026-07-31'), 2400, 800]);
});
