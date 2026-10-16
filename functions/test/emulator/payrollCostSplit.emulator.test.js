// Payroll cost centres (owner, 2026-10-16; docs/modules/PAYROLL_COST_SPLIT.md,
// decisions 173-178): a cost split by % set by a Transfer (Employee Change),
// checked and logged; every expense line of the run shared across it (the
// rounding to the largest share), balance-sheet lines not; a cost centre
// changed for one run only, with a reason, kept by a recalculation, by
// whoever may draft the run; the payslip shows the slip's own cost centre
// (not the employee's current one).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');
const { todayIn } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });
const T = todayIn('Asia/Dubai');
const err = async p => (await p.catch(e => e)).message;
let ALI, BEN, G, DES;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const byCc = (e, code) => e.Lines.filter(l => l.AccountCode === code).map(l => [l.CostCenterID, l.Debit, l.Credit, l.Description.replace(/ — payroll.*/, '')])
  .sort((a, b) => String(a).localeCompare(String(b)));
const transfer = (empId, after) => call('u-admin', 'saveEmployeeChange', { change: { EmployeeID: empId, Type: 'Transfer', EffectiveDate: T,
  After: Object.assign({ CompanyID: 'C1', DesignationID: DES, GradeID: G, CostCenterID: 'CC1', DivisionID: '', BranchID: '' }, after) } });

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.CC3 = { Type: 'CostCenter', Code: 'CC3', Name: 'Store', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.CCX = { Type: 'CostCenter', Code: 'CCX', Name: 'Other Co', Status: 'Active', CompanyID: 'C2' };
  await reset(f);
  G = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  DES = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, cc) => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: DES, GradeID: G, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: cc, BankName: 'ENBD', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan', 'CC1'); BEN = await emp('Ben Okafor', 'CC2');
  const EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 6000 }, { ElementID: EL.HRA, Amount: 3001 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: BEN, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 2000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: EL.HRA, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-08' });
});

test('a split by % is set by a Transfer: checked (100%, the main cost centre in it, the company\'s), applied and logged', async () => {
  const split = list => transfer(ALI, { CostSplit: list });
  assert.match(await err(split([{ CostCenterID: 'CC1', Percent: 60 }, { CostCenterID: 'CC2', Percent: 30 }])), /add up to 90%, not 100%/);
  assert.match(await err(split([{ CostCenterID: 'CC2', Percent: 50 }, { CostCenterID: 'CC3', Percent: 50 }])), /include the main cost center/);
  assert.match(await err(split([{ CostCenterID: 'CC1', Percent: 100 }])), /at least two cost centers/);
  assert.match(await err(split([{ CostCenterID: 'CC1', Percent: 50 }, { CostCenterID: 'CCX', Percent: 50 }])), /belongs to another company/);
  assert.match(await err(split([{ CostCenterID: 'CC1', Percent: 50 }, { CostCenterID: 'CC1', Percent: 50 }])), /listed twice/);
  const r = await split([{ CostCenterID: 'CC1', Percent: 60 }, { CostCenterID: 'CC2', Percent: 40 }]);
  const list = await call('u-admin', 'getEmployeeChanges', {});
  assert.match(list.changes.find(c => c.ChangeID === r.changeId).Summary, /Cost split: none → Workshop 60%, Office 40%/);
  await call('u-admin', 'submitEmployeeChange', { changeId: r.changeId }); // no approval set up: applied at once
  const e = await call('u-admin', 'getEmployee', { employeeId: ALI });
  assert.deepEqual(e.employee.CostSplit, [{ CostCenterID: 'CC1', Percent: 60 }, { CostCenterID: 'CC2', Percent: 40 }]);
  assert.equal(e.employee.CostCenterID, 'CC1', 'the main cost centre stays');
  assert.ok(e.history.some(h => h.Changes.some(c => c.Field === 'CostSplit' && c.To === 'Workshop 60%, Office 40%')), JSON.stringify(e.history));
  assert.deepEqual((await call('u-admin', 'getEmployeeChangeStart', { employeeId: ALI })).employee.CostSplit.map(x => x.Percent), [60, 40]);
});

test('the run shares every expense line across the split (the rounding to the largest share); balance-sheet lines are not split', async () => {
  const id = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  const out = await call('u-admin', 'submitPayrollRun', { runId: id });
  assert.equal(out.status, 'Posted');
  const r = await call('u-admin', 'getPayrollRun', { runId: id });
  const e = await jv(r.run.JVID);
  // Ali: basic 6,000 → 3,600 / 2,400; housing 3,001 → 1,800.60 / 1,200.40; Ben's 2,000 basic on CC2 (clubbed).
  assert.deepEqual(byCc(e, '6000'), [
    ['CC1', 1800.6, 0, 'Housing Allowance'], ['CC1', 3600, 0, 'Basic Salary'], ['CC2', 1200.4, 0, 'Housing Allowance'], ['CC2', 4400, 0, 'Basic Salary']]);
  assert.deepEqual(byCc(e, '2300'), [['', 0, 11001, 'Salaries Payable']]);
  assert.equal(e.TotalDebit, e.TotalCredit);
});

test('a cost centre for one run only, with a reason, by whoever may draft; kept by a recalculation; back to the employee\'s', async () => {
  const id = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  const set = (data, uid) => call(uid || 'u-admin', 'setPayrollCostOverride', Object.assign({ runId: id, employeeId: BEN }, data));
  assert.match(await err(set({ costCenterId: 'CC3', reason: 'x' }, 'u-viewer')), /permission/);
  assert.match(await err(set({ costCenterId: 'CC3' })), /reason/);
  assert.match(await err(set({ costCenterId: 'CCX', reason: 'x' })), /cost center of the company/);
  await set({ costCenterId: 'CC3', reason: 'Worked at the store in August' });
  await call('u-admin', 'recalculatePayrollRun', { runId: id });
  let r = await call('u-admin', 'getPayrollRun', { runId: id });
  let ben = r.slips.find(s => s.EmployeeID === BEN);
  assert.deepEqual([ben.CostCenterID, ben.CostOverride.Reason, ben.CostOverride.ByName], ['CC3', 'Worked at the store in August', 'Admin User']);
  assert.ok(r.run.History.some(h => /Cost centre changed for Ben Okafor: Worked at the store/.test(h.Event)));
  assert.equal((await call('u-admin', 'getEmployee', { employeeId: BEN })).employee.CostCenterID, 'CC2', 'the employee record stays');
  // A split for one run too; then back to the employee's.
  await set({ costCenterId: 'CC2', costSplit: [{ CostCenterID: 'CC2', Percent: 50 }, { CostCenterID: 'CC3', Percent: 50 }], reason: 'Half the month at the store' });
  r = await call('u-admin', 'getPayrollRun', { runId: id });
  assert.deepEqual(r.slips.find(s => s.EmployeeID === BEN).CostSplit.map(x => x.CostCenterID), ['CC2', 'CC3']);
  await set({ clear: true });
  r = await call('u-admin', 'getPayrollRun', { runId: id });
  ben = r.slips.find(s => s.EmployeeID === BEN);
  assert.deepEqual([ben.CostCenterID, ben.CostSplit, ben.CostOverride], ['CC2', [], null]);
  await set({ costCenterId: 'CC3', reason: 'Store again' });
  await call('u-admin', 'submitPayrollRun', { runId: id });
  r = await call('u-admin', 'getPayrollRun', { runId: id });
  const e = await jv(r.run.JVID);
  assert.ok(byCc(e, '6000').some(l => l[0] === 'CC3' && l[1] === 2000 && l[3] === 'Basic Salary'), JSON.stringify(byCc(e, '6000')));
  assert.match(await err(set({ costCenterId: 'CC2', reason: 'x' })), /The run is Posted/);
});

test('the payslip shows the slip\'s own cost centre, not the employee\'s current one', async () => {
  const runs = (await call('u-admin', 'getPayrollRuns', { companyId: 'C1' })).runs || [];
  const july = runs.find(x => x.Month === '2026-07');
  const c = await transfer(BEN, { CostCenterID: 'CC3' });
  await call('u-admin', 'submitEmployeeChange', { changeId: c.changeId });
  assert.equal((await call('u-admin', 'getEmployee', { employeeId: BEN })).employee.CostCenterID, 'CC3');
  const p = await call('u-admin', 'getPayrollPayslips', { runId: july.RunID, employeeId: BEN });
  assert.equal(p.slips[0].CostCenterName, 'Office', 'July posted to Office (CC2)');
  const a = await call('u-admin', 'getPayrollPayslips', { runId: july.RunID, employeeId: ALI });
  assert.equal(a.slips[0].CostSplitText, 'Workshop 60%, Office 40%');
});
