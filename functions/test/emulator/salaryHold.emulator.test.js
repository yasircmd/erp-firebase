// Stop salary (UX round 2, item 29; docs/modules/SALARY_HOLD.md, Q279,
// Q299, Q300): a hold placed by Payroll's post right, refused without the
// Salary held account or in a posted month; the held month's payslip with a
// Stop Salary deduction to zero, credited to Salary held; released, the
// months held paid in the next run from Salary held; a leaver's settlement
// taking what is still held.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, BEN, DAN;
const run = id => call('u-admin', 'getPayrollRun', { runId: id });
const slipOf = (r, emp) => r.slips.find(s => s.EmployeeID === emp);
const amt = (s, code) => { const l = s.Lines.find(x => x.Code === code); return l ? l.Amount : undefined; };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const on = (e, code) => e.Lines.filter(l => l.AccountCode === code).reduce((t, l) => [t[0] + l.Debit, t[1] + l.Credit], [0, 0]);
const company = extra => call('u-admin', 'savePayrollCompany', Object.assign({ companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' }, extra || {}));
async function posted(month) {
  const id = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: id })).status, 'Posted');
  return run(id);
}

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-HELD': { AccountCode: '2310', AccountName: 'Salary Held', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, extra) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01',
    CostCenterID: 'CC1', BankName: 'ENBD', IBAN: 'AE070331234567890123456' }, extra || {}) }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan'); BEN = await emp('Ben Okafor');
  DAN = await emp('Dan Ito', { Status: 'On notice', LeavingDate: '2026-10-31', LeavingReason: 'Personal reasons' });
  const EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  const pay = (id, lines) => call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: lines } });
  await pay(ALI, [{ ElementID: EL.BASIC, Amount: 6000 }, { ElementID: EL.HRA, Amount: 3000 }]);
  await pay(BEN, [{ ElementID: EL.BASIC, Amount: 2000 }]);
  await pay(DAN, [{ ElementID: EL.BASIC, Amount: 1000 }]);
  for (const id of [EL.BASIC, EL.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await company();
  for (const m of ['2026-07', '2026-08', '2026-09']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
});

test('placing a hold: Payroll\'s post right, a reason, the Salary held account set, not in a posted month, not twice', async () => {
  const place = (d, uid) => call(uid || 'u-admin', 'placeSalaryHold', Object.assign({ employeeId: ALI, fromMonth: '2026-07', reason: 'Absconding: not reported since 1 July' }, d));
  await assert.rejects(place({}), /Set the company's Salary held account in Payroll Setup/);
  await assert.rejects(company({ heldAccountId: 'A-REC' }), /Salary held: .* must be Liability/);
  await assert.rejects(company({ heldAccountId: 'A-SALPAY' }), /its own account, not Salaries Payable/);
  await company({ heldAccountId: 'A-HELD' });
  await company(); // a save that doesn't send it keeps it (an older screen)
  assert.equal((await call('u-admin', 'getPayrollSetup', {})).settings.find(s => s.CompanyID === 'C1').HeldAccountID, 'A-HELD');
  await assert.rejects(place({}, 'u-viewer'), /do not have access to Payroll|permission to hold/);
  await assert.rejects(place({ reason: '' }), /Give the reason/);
  await assert.rejects(place({ untilMonth: '2026-06' }), /ends before it starts/);
  assert.equal((await place({})).success, true);
  await assert.rejects(place({ fromMonth: '2026-08' }), /already a hold from 2026-07/);
  assert.equal((await place({ employeeId: DAN, reason: 'Documents not returned' })).success, true);
  const hist = (await firestore.collection('employeeHistory').where('EmployeeID', '==', ALI).get()).docs.map(d => d.data());
  assert.ok(hist.some(h => h.Action === 'Salary held' && h.Changes[0].To === 'Held from 2026-07 until released'));
});

test('held months: a normal payslip with Stop Salary to zero, credited to Salary held; released, paid in the next run from Salary held; a leaver\'s settlement takes what is held', async () => {
  let r = await posted('2026-07');
  let ali = slipOf(r, ALI);
  assert.deepEqual([amt(ali, 'BASIC'), amt(ali, 'HRA'), amt(ali, 'STOPSAL'), ali.Net], [6000, 3000, 9000, 0]);
  assert.ok(ali.Warnings.some(w => /Salary held from 2026-07: Absconding/.test(w)));
  assert.equal(slipOf(r, BEN).Net, 2000, 'others as usual');
  let e = await jv(r.run.JVID);
  assert.deepEqual([on(e, '2310'), on(e, '2300')], [[0, 10000], [0, 2000]], 'Ali 9,000 and Dan 1,000 to Salary held; Ben to Salaries Payable');

  await assert.rejects(call('u-admin', 'placeSalaryHold', { employeeId: BEN, fromMonth: '2026-07', reason: 'x' }), /payroll for 2026-07 is posted/);
  r = await posted('2026-08');
  assert.equal(amt(slipOf(r, ALI), 'STOPSAL'), 9000);

  let holds = (await call('u-admin', 'getSalaryHolds', { companyId: 'C1' })).holds;
  const aliHold = holds.find(h => h.EmployeeID === ALI);
  assert.deepEqual([aliHold.HeldAmount, aliHold.HeldMonths, aliHold.Status], [18000, ['2026-07', '2026-08'], 'Active']);

  const release = d => call('u-admin', 'releaseSalaryHold', Object.assign({ holdId: aliHold.HoldID, fromMonth: '2026-09', note: 'Returned to work' }, d));
  await assert.rejects(release({ fromMonth: '2026-08' }), /payroll for 2026-08 is posted/);
  await assert.rejects(release({ note: '' }), /Add a note/);
  assert.equal((await release({})).heldAmount, 18000);
  await assert.rejects(release({}), /already released/);

  r = await posted('2026-09');
  ali = slipOf(r, ALI);
  assert.deepEqual([amt(ali, 'SALREL'), amt(ali, 'STOPSAL'), ali.Net], [18000, undefined, 27000]);
  assert.equal(amt(slipOf(r, DAN), 'STOPSAL'), 1000, 'Dan still held');
  e = await jv(r.run.JVID);
  assert.deepEqual(on(e, '2310'), [18000, 1000], 'Dr Salary held for Ali\'s release, Cr for Dan\'s month');
  holds = (await call('u-admin', 'getSalaryHolds', { companyId: 'C1' })).holds;
  assert.deepEqual(holds.filter(h => h.EmployeeID === ALI).map(h => [h.Status, h.HeldAmount]), [['Released', 0]]);

  // Dan leaves: his settlement pays the three months held, from Salary held.
  const s = (await call('u-admin', 'getSettlement', { employeeId: DAN })).settlement;
  const line = s.Lines.find(l => l.Key === 'HeldSalary');
  assert.deepEqual([line.Name, line.Kind, line.Amount, line.Text], ['Salary released', 'Earning', 3000, 'held 2026-07, 2026-08, 2026-09']);
});
