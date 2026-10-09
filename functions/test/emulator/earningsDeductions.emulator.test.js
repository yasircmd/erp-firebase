// HR Payroll, step 7b (owner, 2026-10-09; docs/modules/HR_PAYROLL.md, step 7,
// points 4-5, decision 57): Earnings & Deductions entries made before the
// run; the run takes them and knows when they changed; locked once the run
// leaves its draft; a run's old inputs moved to entries; an earning paid by
// Interim Payroll instead (left out of the run, its own journal, reversed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, SARA, OT, BONUS, RUN;
const M = '2026-07';
const ed = (extra, uid) => call(uid || 'u-admin', 'saveEarningsDeductions', Object.assign({ companyId: 'C1', month: M }, extra));
const list = () => call('u-admin', 'getEarningsDeductions', { companyId: 'C1', month: M });
const getRun = () => call('u-admin', 'getPayrollRun', { runId: RUN });
const amt = (slip, code) => { const l = slip.Lines.find(x => x.Code === code); return l ? l.Amount : undefined; };
const slipOf = (r, emp) => r.slips.find(s => s.EmployeeID === emp);
const sums = e => { const o = {}; e.Lines.forEach(l => { o[l.AccountCode] = Math.round(((o[l.AccountCode] || 0) + (l.Debit || 0) - (l.Credit || 0)) * 100) / 100; }); return o; };

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-BON': { AccountCode: '6050', AccountName: 'Bonus', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-OT': { AccountCode: '6060', AccountName: 'Overtime', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = name => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan'); SARA = await emp('Sara Khan');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  BONUS = els.BONUS;
  for (const id of [ALI, SARA]) await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  OT = (await call('u-admin', 'savePayElement', { element: { Code: 'OT', Name: 'Overtime', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'savePayElementPayroll', { elementId: OT, glAccountId: 'A-OT', inGross: true, category: 'Overtime', overtime: { Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Schedule', Weightage: 1.25 } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: BONUS, glAccountId: 'A-BON', inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [], hoursPerDay: 10 });
});

test('entries before the run: checked; the right; the run takes them', async () => {
  const empty = await list();
  assert.deepEqual([empty.run, empty.runOpen, empty.entries, empty.employees.map(e => e.Name)], [null, true, [], ['Ali Hassan', 'Sara Khan']]);
  assert.deepEqual(empty.elements.map(e => [e.Code, e.Hours, e.Interim]), [['BONUS', false, true], ['COMM', false, true], ['OT', true, false]]);
  await assert.rejects(ed({ entry: { EmployeeID: ALI, Code: 'BONUS', Amount: 100 } }, 'u-viewer'), /permission to enter earnings and deductions/);
  await assert.rejects(ed({ entry: { EmployeeID: ALI, Code: 'BASIC', Amount: 1 } }), /Basic Salary is not entered per run/);
  await assert.rejects(ed({ entry: { EmployeeID: ALI, ElementID: OT, Amount: 100 } }), /Overtime is paid by the hour/);
  await assert.rejects(ed({ entry: { EmployeeID: ALI, ElementID: OT, Hours: 2, PayBy: 'Interim' } }), /Overtime is paid with the salary: only an earning by amount/);
  await assert.rejects(ed({ rows: [{ EmployeeID: ALI, Code: 'BONUS', Amount: 1 }, { EmployeeNo: 'EMP-9999', Code: 'BONUS', Amount: 1 }] }), /Row 2: employee "EMP-9999" is not on payroll in the month/);
  await assert.rejects(ed({ month: '2026-13', entry: {} }), /Choose the month/);
  await assert.rejects(call('u-other', 'getEarningsDeductions', { companyId: 'C1', month: M }), /access to that company/);
  assert.equal((await ed({ rows: [{ EmployeeID: ALI, ElementID: OT, Hours: '10', Note: 'July weekends' }, { EmployeeID: ALI, Code: 'BONUS', Amount: '1,500' }] })).saved, 2);
  const l = await list();
  assert.deepEqual(l.entries.map(x => [x.Code, x.Hours, x.Amount, x.PayBy, x.State, x.Editable]), [['BONUS', null, 1500, 'Run', 'For the run', true], ['OT', 10, null, 'Run', 'For the run', true]]);
  // The run: 6,000 ÷ 30 ÷ 10 hours × 1.25 = 25 an hour.
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: M });
  RUN = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: M })).runId;
  const r = await getRun();
  assert.deepEqual([amt(slipOf(r, ALI), 'OT'), amt(slipOf(r, ALI), 'BONUS'), r.run.Net, r.inputsChanged], [250, 1500, 13750, false]);
  assert.equal((await list()).entries[0].State, 'In the draft run');
});

test('changed under the draft run: flagged, submit refused until recalculated; then locked while it is past its draft', async () => {
  const bonus = (await list()).entries.find(x => x.Code === 'BONUS');
  await ed({ entry: { EntryID: bonus.EntryID, EmployeeID: ALI, Code: 'BONUS', Amount: 2000, Note: 'Q2 target' } });
  assert.equal((await getRun()).inputsChanged, true);
  await assert.rejects(call('u-admin', 'submitPayrollRun', { runId: RUN }), /earnings and deductions changed since the run was calculated: recalculate it first/);
  await call('u-admin', 'recalculatePayrollRun', { runId: RUN });
  const r = await getRun();
  assert.deepEqual([amt(slipOf(r, ALI), 'BONUS'), r.inputsChanged], [2000, false]);
  await call('u-admin', 'submitPayrollRun', { runId: RUN }); // none set up: approved and posted at once
  assert.equal((await getRun()).run.Status, 'Posted');
  const l = await list();
  assert.deepEqual([l.runOpen, l.entries.map(x => [x.State, x.Editable])], [false, [['Posted with the run', false], ['Posted with the run', false]]]);
  await assert.rejects(ed({ entry: { EmployeeID: SARA, Code: 'BONUS', Amount: 100 } }), /the 2026-07 run is posted: its earnings and deductions can no longer change\./);
  await assert.rejects(call('u-admin', 'deleteEarningsDeduction', { entryId: bonus.EntryID }), /run is past its draft/);
  // The run's own inputs call writes entries too, and only while it is a draft.
  await assert.rejects(call('u-admin', 'savePayrollInputs', { runId: RUN, rows: [] }), /can no longer change/);
});

test('a run\'s inputs from before step 7b move to entries the first time it is worked out', async () => {
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-08' });
  const aug = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  await firestore.collection('payrollRuns').doc(aug).collection('slips').doc(SARA).update({ Inputs: [{ ElementID: BONUS, Amount: 700, Note: 'kept from the run' }] });
  await call('u-admin', 'recalculatePayrollRun', { runId: aug });
  const e = (await call('u-admin', 'getEarningsDeductions', { companyId: 'C1', month: '2026-08' })).entries;
  assert.deepEqual(e.map(x => [x.EmployeeName, x.Code, x.Amount, x.Note, x.CreatedByName]), [['Sara Khan', 'BONUS', 700, 'kept from the run', 'Moved from the run']]);
  const r = await call('u-admin', 'getPayrollRun', { runId: aug });
  assert.equal(amt(slipOf(r, SARA), 'BONUS'), 700);
  await call('u-admin', 'deletePayrollRun', { runId: aug });
});

test('an earning paid by Interim Payroll: left out of the run; paid in a batch by its own journal; reversed, free again', async () => {
  const S = '2026-08';
  const x = (await call('u-admin', 'saveEarningsDeductions', { companyId: 'C1', month: S, entry: { EmployeeID: SARA, Code: 'COMM', Amount: 800, PayBy: 'Interim', Note: 'Deal 42' } })).saved;
  assert.equal(x, 1);
  // COMM has no GL account yet: the payment will need one.
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'savePayElementPayroll', { elementId: els.COMM, glAccountId: 'A-BON', inGross: true });
  const aug = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: S })).runId;
  const r = await call('u-admin', 'getPayrollRun', { runId: aug });
  assert.equal(amt(slipOf(r, SARA), 'COMM'), undefined, 'not paid by the run');
  const entry = (await call('u-admin', 'getEarningsDeductions', { companyId: 'C1', month: S })).entries.find(x => x.Code === 'COMM');
  assert.deepEqual([entry.State, entry.Editable], ['For interim payroll', true]);
  const fresh = await call('u-admin', 'getInterimBatch', { companyId: 'C1' });
  assert.deepEqual(fresh.candidates.map(i => [i.Kind, i.EmployeeName, i.What, i.Amount]), [['Payment', 'Sara Khan', 'Commission — Deal 42', 800]]);
  const b = await call('u-admin', 'saveInterimBatch', { companyId: 'C1', paymentDate: '2026-08-20', items: fresh.candidates.map(i => ({ Kind: i.Kind, ID: i.ID })) });
  await assert.rejects(call('u-admin', 'saveEarningsDeductions', { companyId: 'C1', month: S, entry: { EntryID: entry.EntryID, EmployeeID: SARA, Code: 'COMM', Amount: 900, PayBy: 'Interim' } }), /in interim payroll IP-0001: it can no longer change/);
  await assert.rejects(call('u-admin', 'deleteEarningsDeduction', { entryId: entry.EntryID }), /take it out of the batch first/);
  assert.equal((await call('u-admin', 'submitInterimBatch', { interimId: b.interimId })).status, 'Approved');
  const paid = await call('u-admin', 'markInterimPaid', { interimId: b.interimId, way: 'BankFile', accountId: 'A-BANK' });
  assert.equal(paid.paid, true);
  const e1 = (await call('u-admin', 'getEarningsDeductions', { companyId: 'C1', month: S })).entries.find(x => x.Code === 'COMM');
  assert.deepEqual([e1.State, e1.InterimPaid, e1.Editable], ['Paid by IP-0001', true, false]);
  const jv = (await firestore.collection('journalEntries').doc(e1.PaymentJVID).get()).data();
  assert.deepEqual([jv.VoucherType, sums(jv), jv.Lines.find(l => l.AccountCode === '6050').CostCenterID], ['PayrollPayment', { 6050: 800, 1100: -800 }, 'CC1']);
  assert.match(jv.TransactionRef, /^PRL-/);
  // Reversed: the batch Reversed (step 7a), the entry unpaid and free again.
  await call('u-admin', 'reverseInterimPayment', { interimId: b.interimId, reason: 'Wrong amount' });
  const e2 = (await call('u-admin', 'getEarningsDeductions', { companyId: 'C1', month: S })).entries.find(x => x.Code === 'COMM');
  assert.deepEqual([e2.State, e2.InterimPaid, e2.Editable], ['For interim payroll', false, true]);
  assert.deepEqual((await firestore.collection('journalEntries').doc(e1.PaymentJVID).get()).data().ReversedByJV.length > 0, true);
  await call('u-admin', 'saveEarningsDeductions', { companyId: 'C1', month: S, entry: { EntryID: e2.EntryID, EmployeeID: SARA, Code: 'COMM', Amount: 900, PayBy: 'Interim' } });
});
