// HR Payroll, step 1: the setup (owner, 2026-10-04; docs/modules/HR_PAYROLL.md,
// points 1-3, decisions 2-3): the daily-rate method and Salaries Payable per
// company; each element's GL account (the group's, a company's override),
// prorated and in gross; overtime elements and their formula; the worked
// examples; the arithmetic itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');
const calc = require('../../src/payrollCalc');

test.after(async () => { await app.delete(); });

let EL;
test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SAL2': { AccountCode: '6001', AccountName: 'Salaries (Co Two)', AccountType: 'Expense', Status: 'Active', IsPostable: true, CompanyID: 'C2' },
    'A-SALC1': { AccountCode: '6002', AccountName: 'Salaries (Co One)', AccountType: 'Expense', Status: 'Active', IsPostable: true, CompanyID: 'C1' },
    'A-OT': { AccountCode: '6010', AccountName: 'Overtime', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-HDR': { AccountCode: '6999', AccountName: 'Staff Costs (header)', AccountType: 'Expense', Status: 'Active', IsPostable: false }
  });
  await reset(f);
  EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
});

test('the arithmetic: the three daily-rate methods (leap years too) and the overtime hourly rate', () => {
  assert.equal(calc.divisor('DIV30', '2026-02'), 30);
  assert.equal(calc.divisor('MONTHDAYS', '2026-02'), 28);
  assert.equal(calc.divisor('MONTHDAYS', '2028-02'), 29);
  assert.equal(calc.divisor('MONTHDAYS', '2026-07'), 31);
  assert.equal(calc.divisor('YEARDAYS', '2026-02'), 365 / 12);
  assert.equal(calc.divisor('YEARDAYS', '2028-09'), 366 / 12);
  assert.equal(calc.dailyText(6000, 'YEARDAYS', '2028-02'), '6,000.00 × 12 ÷ 366 = 196.72');
  assert.equal(calc.dailyText(5000, 'MONTHDAYS', '2026-02'), '5,000.00 ÷ 28 = 178.57');
  // The owner's example: basic ÷ month days ÷ 8 hours × 1.5.
  const ot = calc.overtimeRate({ Base: 'Basic', DaysMode: 'Company', HoursMode: 'Fixed', FixedHours: 8, Weightage: 1.5 }, { basic: 6200, gross: 9000, method: 'MONTHDAYS', month: '2026-07', hoursPerDay: 9 });
  assert.equal(Math.round(ot.rate * 100) / 100, 37.5); // 6200 / 31 / 8 x 1.5
  // On the gross, fixed 30 days, the employee's 9-hour schedule, double.
  const ot2 = calc.overtimeRate({ Base: 'Gross', DaysMode: 'Fixed', FixedDays: 30, HoursMode: 'Schedule', Weightage: 2 }, { basic: 6200, gross: 9000, method: 'MONTHDAYS', month: '2026-07', hoursPerDay: 9 });
  assert.equal(Math.round(ot2.rate * 100) / 100, 66.67); // 9000 / 30 / 9 x 2
  assert.equal(ot2.text, '9,000.00 (gross) ÷ 30 days ÷ 9 hours × 2 = 66.67 an hour');
});

test('per company: the daily-rate method and Salaries Payable (a liability, shared or the company\'s); own companies only', async () => {
  let s = await call('u-admin', 'getPayrollSetup', {});
  assert.deepEqual(s.settings, [{ CompanyID: 'C1', DailyRateMethod: 'DIV30', PayableAccountID: '' }]);
  assert.deepEqual(Object.keys(s.methods), ['DIV30', 'MONTHDAYS', 'YEARDAYS']);
  assert.ok(s.accounts.some(a => a.AccountID === 'A-SALC1') && !s.accounts.some(a => a.AccountID === 'A-SAL2') && !s.accounts.some(a => a.AccountID === 'A-HDR'));
  await assert.rejects(call('u-viewer', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'MONTHDAYS' }), /permission to change HR Setup/);
  await assert.rejects(call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV31' }), /how the daily rate is worked out/);
  await assert.rejects(call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'MONTHDAYS', payableAccountId: 'A-SAL' }), /must be Liability/);
  await assert.rejects(call('u-admin', 'savePayrollCompany', { companyId: 'C2', dailyRateMethod: 'MONTHDAYS' }), /access to that company/);
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'MONTHDAYS', payableAccountId: 'A-SALPAY' });
  s = await call('u-admin', 'getPayrollSetup', {});
  assert.deepEqual(s.settings, [{ CompanyID: 'C1', DailyRateMethod: 'MONTHDAYS', PayableAccountID: 'A-SALPAY' }]);
});

test('element GL accounts: the group\'s (shared, expense for earnings), a company\'s override; prorated and in gross', async () => {
  const save = (code, extra, uid) => call(uid || 'u-admin', 'savePayElementPayroll', Object.assign({ elementId: EL[code] }, extra));
  // Defaults: fixed elements prorated; fixed earnings in the gross.
  let els = Object.fromEntries((await call('u-admin', 'getPayrollSetup', {})).elements.map(e => [e.Code, e]));
  assert.deepEqual([els.BASIC.Prorated, els.BASIC.InGross, els.BONUS.Prorated, els.BONUS.InGross, els.BASIC.GLAccountID], [true, true, false, false, '']);
  await assert.rejects(save('BASIC', { glAccountId: 'A-AP', prorated: true, inGross: true }), /must be Expense/);
  await assert.rejects(save('BASIC', { glAccountId: 'A-HDR', prorated: true, inGross: true }), /not an active, postable account/);
  await assert.rejects(save('BASIC', { glAccountId: 'A-SALC1', prorated: true, inGross: true }), /the group's account must be a shared one/);
  await assert.rejects(save('BASIC', { glAccountId: 'A-SAL', glByCompany: { C1: 'A-SAL2' }, prorated: true, inGross: true }), /belongs to another company/);
  await assert.rejects(save('BASIC', { glAccountId: 'A-SAL', glByCompany: { C2: 'A-SAL2' }, prorated: true, inGross: true }), /access to that company/);
  await save('BASIC', { glAccountId: 'A-SAL', glByCompany: { C1: 'A-SALC1' }, prorated: true, inGross: true });
  await save('HRA', { glAccountId: 'A-SAL', prorated: false, inGross: true });
  // A deduction posts to any postable account (a liability here), and is never in the gross.
  const loan = (await call('u-admin', 'savePayElement', { element: { Code: 'LOAN', Name: 'Loan recovery', Kind: 'Deduction', Nature: 'Fixed' } })).elementId;
  EL.LOAN = loan;
  await assert.rejects(save('LOAN', { glAccountId: 'A-AP', prorated: false, inGross: true }), /Only earnings count in the gross/);
  await save('LOAN', { glAccountId: 'A-AP', prorated: false });
  els = Object.fromEntries((await call('u-admin', 'getPayrollSetup', {})).elements.map(e => [e.Code, e]));
  assert.deepEqual([els.BASIC.GLAccountID, els.BASIC.GLByCompany, els.HRA.Prorated], ['A-SAL', { C1: 'A-SALC1' }, false]);
  // Editing the element itself (HR Setup → Pay Elements) keeps its payroll settings.
  await call('u-admin', 'savePayElement', { element: { ElementID: EL.HRA, Code: 'HRA', Name: 'Housing', Kind: 'Earning', Nature: 'Fixed' } });
  els = Object.fromEntries((await call('u-admin', 'getPayrollSetup', {})).elements.map(e => [e.Code, e]));
  assert.deepEqual([els.HRA.Name, els.HRA.GLAccountID, els.HRA.Prorated], ['Housing', 'A-SAL', false]);
  assert.equal(calc.accountFor(els.BASIC, 'C1'), 'A-SALC1');
  assert.equal(calc.accountFor(els.BASIC, 'C2'), 'A-SAL');
});

test('overtime elements: variable earnings, by amount or hours with their formula; the worked examples', async () => {
  const ot = (await call('u-admin', 'savePayElement', { element: { Code: 'OT125', Name: 'Overtime (normal)', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  const save = overtime => call('u-admin', 'savePayElementPayroll', { elementId: ot, glAccountId: 'A-OT', category: 'Overtime', overtime });
  await assert.rejects(call('u-admin', 'savePayElementPayroll', { elementId: EL.BASIC, category: 'Overtime', overtime: { Mode: 'Amount' } }), /Overtime is a variable earning/);
  await assert.rejects(save({ Mode: 'Hours', Base: 'Basic', Weightage: 0 }), /weightage is more than 0/);
  await assert.rejects(save({ Mode: 'Hours', Base: 'Basic', DaysMode: 'Fixed', FixedDays: 40, Weightage: 1.25 }), /fixed days are 1 to 31/);
  await assert.rejects(save({ Mode: 'Minutes' }), /an amount, or worked out from hours/);
  await save({ Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Fixed', FixedHours: 8, Weightage: 1.25 });
  const e = (await call('u-admin', 'getPayrollSetup', {})).elements.find(x => x.ElementID === ot);
  assert.deepEqual([e.Category, e.Overtime, e.Prorated, e.InGross], ['Overtime', { Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Fixed', FixedDays: null, FixedHours: 8, Weightage: 1.25 }, false, false]);
  const p = await call('u-admin', 'previewPayrollFormula', { method: 'MONTHDAYS', month: '2026-02', basic: 5600, overtime: e.Overtime });
  assert.deepEqual([p.daily, p.overtime], ['5,600.00 ÷ 28 = 200.00', '5,600.00 (basic) ÷ 28 days ÷ 8 hours × 1.25 = 31.25 an hour']);
});

test('an element whose kind or nature changes loses the payroll settings that no longer fit', async () => {
  const id = (await call('u-admin', 'savePayElement', { element: { Code: 'OTX', Name: 'Overtime (holiday)', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-OT', category: 'Overtime', overtime: { Mode: 'Amount' } });
  const get = async () => (await call('u-admin', 'getPayrollSetup', {})).elements.find(x => x.ElementID === id);
  // Now fixed: no longer overtime; prorated by default again; the account stays (still an earning).
  await call('u-admin', 'savePayElement', { element: { ElementID: id, Code: 'OTX', Name: 'Overtime (holiday)', Kind: 'Earning', Nature: 'Fixed' } });
  let e = await get();
  assert.deepEqual([e.Category, e.Overtime, e.Prorated, e.InGross, e.GLAccountID], ['Normal', null, true, true, 'A-OT']);
  await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-OT', prorated: false, inGross: false });
  // A name change keeps them.
  await call('u-admin', 'savePayElement', { element: { ElementID: id, Code: 'OTX', Name: 'Holiday pay', Kind: 'Earning', Nature: 'Fixed' } });
  e = await get();
  assert.deepEqual([e.Prorated, e.InGross, e.GLAccountID], [false, false, 'A-OT']);
  // Now a deduction: the expense account and "in gross" go.
  await call('u-admin', 'savePayElement', { element: { ElementID: id, Code: 'OTX', Name: 'Holiday pay', Kind: 'Deduction', Nature: 'Fixed' } });
  e = await get();
  assert.deepEqual([e.GLAccountID, e.GLByCompany, e.InGross, e.Prorated], ['', {}, false, false]);
});
