// HR Payroll, step 7c: the Provisions module (owner, 2026-10-09;
// docs/modules/HR_PAYROLL.md, step 7, point 9, decisions 58, 60-63): the
// statement for a period (opening, accrued, released, utilised, closing),
// the same figures the run uses; each row's movements; the provision
// accounts' GL check; openings on screen; Payroll's rights; a claim's
// journal opens here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, rtdb, call, reset, baseFixture } = require('./_helpers');
const calc = require('../../src/payrollCalc');

test.after(async () => { await app.delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
let ALI, BEN, FLIGHT, CLAIM;
const r2 = n => Math.round(n * 100) / 100;
const gratuity = (base, asOf) => calc.gratuityFor({}, { base, joinDate: '2021-01-01', asOf, provision: true }).amount;
const statement = (from, to, uid) => call(uid || 'u-admin', 'getProvisionStatement', { companyId: 'C1', from, to });
const row = (s, emp, key) => { const r = s.rows.find(x => x.EmployeeID === emp && x.Key === key); return r ? [r.Opening, r.Accrued, r.Released, r.Utilised, r.Closing] : null; };
const gl = (s, code) => { const g = s.glChecks.find(x => x.AccountCode === code); return [g.Statement, g.GL, g.Difference]; };
// The openings are in the GL from the opening balances (a journal, as at go-live).
const openingJournal = (id, date, lines) => firestore.collection('journalEntries').doc(id).set({ JVNumber: id, JVDate: date, CompanyID: 'C1', Status: 'Posted', VoucherType: 'OpeningBalance',
  Lines: lines.map(([acc, code, dr, cr]) => ({ AccountID: acc, AccountCode: code, Debit: dr, Credit: cr })) });

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


test('the setup, openings and runs of step 5a: July and August posted, an air ticket paid with August\'s salary, a claim and a reversed claim', async () => {
  const s = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  FLIGHT = (await call('u-admin', 'saveAccrualType', { accrualType: { Name: 'Air ticket', Code: 'FLIGHT', Basis: 'Fixed', PaidAtLeaving: true, ExpenseAccountID: 'A-FEXP', ProvisionAccountID: 'A-FPRO',
    Rules: [{ LevelFrom: 1, LevelTo: 5, Value: 2400 }, { LevelFrom: 6, LevelTo: 99, Value: 6000 }], Exceptions: { [BEN]: { Value: 1200 } } } })).accrualTypeId;
  const imp = rows => call('u-admin', 'runMasterImport', { master: 'PROVOPEN', text: tsv([['Employee', 'Provision', 'Amount', 'Provided To']].concat(rows)) });
  assert.equal((await imp([['EMP-0001', 'Gratuity', '20000', '30/06/2026'], ['EMP-0001', 'flight', '600', '30/06/2026']])).success, true);
  await openingJournal('OB-1', '2026-06-30', [['A-GPRO', '2400', 0, 20000], ['A-FPRO', '2420', 0, 600], ['A-SALPAY', '2300', 20600, 0]]);
  const july = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: july });
  // Ben's leave salary opening, imported after July's run (over-provided): it
  // replaces July's for him, and August releases the excess.
  assert.equal((await imp([['EMP-0002', 'Leave salary', '5000', '31/07/2026']])).success, true);
  await openingJournal('OB-2', '2026-07-31', [['A-LPRO', '2410', 0, 5000], ['A-SALPAY', '2300', 5000, 0]]);
  const aug = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  await call('u-admin', 'savePayrollInputs', { runId: aug, rows: [{ EmployeeID: ALI, Code: 'FLIGHT', Amount: 300, Note: 'Ticket home' }] });
  await call('u-admin', 'submitPayrollRun', { runId: aug });
  CLAIM = (await call('u-admin', 'recordAccrualClaim', { employeeId: ALI, accrualTypeId: FLIGHT, date: '2026-09-10', amount: 500, accountId: 'A-CASH', note: 'School trip' })).claimId;
  const gone = (await call('u-admin', 'recordAccrualClaim', { employeeId: ALI, accrualTypeId: FLIGHT, date: '2026-09-12', amount: 50, accountId: 'A-CASH' })).claimId;
  await call('u-admin', 'reverseAccrualClaim', { claimId: gone, reason: 'Duplicate' });
});

test('the statement for August-September: opening, accrued, released, utilised, closing; the closing is what the run uses next', async () => {
  const s = await statement('2026-08', '2026-09');
  const gJul = gratuity(6000, '2026-07-31'), gAug = gratuity(6000, '2026-08-31');
  assert.deepEqual(s.columns.map(c => c.Name), ['Gratuity', 'Leave salary', 'Air ticket']);
  assert.deepEqual(row(s, ALI, 'Gratuity'), [gJul, r2(gAug - gJul), 0, 0, gAug]);
  assert.deepEqual(row(s, ALI, 'LeaveSalary'), [2400, 400, 0, 0, 2800]);
  // Air ticket: 600 opening + July's 200; August's 200; used: 300 with the salary, 500 claimed (the reversed claim is not a use).
  assert.deepEqual(row(s, ALI, 'Accrual:' + FLIGHT), [800, 200, 0, 800, 200]);
  // Ben: his opening replaces July's leave salary; August's decrease is Released, not Accrued.
  assert.deepEqual(row(s, BEN, 'LeaveSalary'), [5000, 0, 3400, 0, 1600]);
  assert.deepEqual(row(s, BEN, 'Accrual:' + FLIGHT), [100, 100, 0, 0, 200]);
  assert.equal(row(s, BEN, 'Gratuity'), null, 'under a year: none, so no row');
  // The same figures as the run's own "provided before" (getProvisionBalances).
  const bal = Object.fromEntries((await call('u-admin', 'getProvisionBalances', { companyId: 'C1' })).employees.map(e => [e.EmployeeID, e.Balances]));
  s.rows.forEach(r => assert.equal(r.Closing, bal[r.EmployeeID][r.Key], r.EmployeeID + ' ' + r.Key));
  assert.deepEqual(Object.entries(s.balances).filter(([, v]) => v).length, s.rows.length);
  // Year to date: Ali's gratuity opening imported in June counts as accrued in the period.
  assert.deepEqual(row(await statement('2026-01', '2026-09'), ALI, 'Gratuity'), [0, gAug, 0, 0, gAug]);
  // To July: August is not in it.
  assert.deepEqual(row(await statement('2026-07', '2026-07'), ALI, 'Accrual:' + FLIGHT), [600, 200, 0, 0, 800]);
});

test('the GL check: each provision account at the period\'s end against the statement (leave salary differs by July\'s run that Ben\'s opening replaced)', async () => {
  const s = await statement('2026-08', '2026-09');
  const gAug = gratuity(6000, '2026-08-31');
  assert.deepEqual(gl(s, '2400'), [gAug, gAug, 0]);
  assert.deepEqual(gl(s, '2420'), [400, 400, 0]);
  assert.deepEqual(gl(s, '2410'), [4400, 5800, 1400]);
  // At July's end: the accounts as they stood.
  const j = await statement('2026-07', '2026-07');
  assert.deepEqual(gl(j, '2420'), [800 + 100, 900, 0]);
  // A manual journal to the provision shows as a difference.
  await openingJournal('MAN-1', '2026-09-30', [['A-GPRO', '2400', 0, 125], ['A-GEXP', '6100', 125, 0]]);
  assert.deepEqual(gl(await statement('2026-08', '2026-09'), '2400').slice(2), [125]);
  assert.deepEqual(gl(await statement('2026-08', '2026-08'), '2400').slice(2), [0], 'dated after August');
});

test('a row\'s movements: dated, with the document and journal, and a running balance', async () => {
  const m = await call('u-admin', 'getProvisionMovements', { companyId: 'C1', from: '2026-08', to: '2026-09', employeeId: ALI, key: 'Accrual:' + FLIGHT });
  assert.equal(m.opening, 800);
  assert.deepEqual(m.movements.map(x => [x.Date, x.Column, x.Amount, x.Balance, x.Doc.ModuleID]),
    [['2026-08-31', 'Accrued', 200, 1000, 'PAYROLL'], ['2026-08-31', 'Utilised', -300, 700, 'PAYROLL'], ['2026-09-10', 'Utilised', -500, 200, 'PROVISIONS']]);
  assert.match(m.movements[2].What, /Claim — School trip/);
  assert.match(m.movements[2].JVNumber, /^PPR-/);
  assert.ok(m.movements[0].JVNumber, 'the run\'s journal');
  assert.equal(m.closing, 200);
  const b = await call('u-admin', 'getProvisionMovements', { companyId: 'C1', from: '2026-01', to: '2026-09', employeeId: BEN, key: 'LeaveSalary' });
  assert.deepEqual(b.movements.map(x => [x.Column, x.Amount, x.What.replace(/ .*/, '')]), [['Accrued', 5000, 'Opening'], ['Released', -3400, 'Run']]);
});

test('openings on screen (Payroll Setup\'s write): saved, corrected, removed; the statement and GL check follow', async () => {
  const save = (d, uid) => call(uid || 'u-admin', 'saveProvisionOpeningEntry', Object.assign({ employeeId: BEN, provision: 'Gratuity', amount: 300, asOf: '2026-07-31' }, d));
  await assert.rejects(save({}, 'u-viewer'), /permission to change Payroll Setup/);
  await assert.rejects(save({}, 'u-other'), /access to that company/);
  await assert.rejects(save({ provision: 'Pension' }), /Gratuity, Leave salary, or an accrual/);
  await assert.rejects(save({ asOf: '' }), /date it was provided to/);
  await save({});
  let s = await statement('2026-08', '2026-09');
  assert.deepEqual(row(s, BEN, 'Gratuity'), [300, 0, 0, 0, 300]);
  assert.equal(gl(s, '2400')[2], -300 + 125, 'not in the GL');
  const op = s.openings.find(o => o.EmployeeID === BEN && o.Key === 'Gratuity');
  assert.deepEqual([op.Provision, op.Amount, op.AsOf], ['Gratuity', 300, '2026-07-31']);
  await save({ amount: 350 });
  s = await statement('2026-08', '2026-09');
  assert.deepEqual(row(s, BEN, 'Gratuity'), [350, 0, 0, 0, 350]);
  assert.equal(s.openings.filter(o => o.EmployeeID === BEN && o.Key === 'Gratuity').length, 1, 'corrected, not added');
  await assert.rejects(call('u-viewer', 'deleteProvisionOpening', { openingId: op.OpeningID }), /permission to change Payroll Setup/);
  await call('u-admin', 'deleteProvisionOpening', { openingId: op.OpeningID });
  assert.equal(row(await statement('2026-08', '2026-09'), BEN, 'Gratuity'), null);
});

test('a final settlement uses the provisions (a lapse is released) and then holds them: no opening changes', async () => {
  await firestore.collection('payrollSettlements').doc('fs_' + BEN).set({ EmployeeID: BEN, CompanyID: 'C1', Status: 'Posted', Number: 'FS-0001', LeavingDate: '2026-09-15', JVNumber: 'PRL-9',
    Lines: [{ Key: 'LeaveSalary', Kind: 'LeaveSalary', Provided: 1600 }, { Key: 'Accrual:' + FLIGHT, Kind: 'Lapse', Provided: 200 }, { Key: 'Salary', Kind: 'Salary', Provided: 0 }] });
  const s = await statement('2026-08', '2026-09');
  assert.deepEqual(row(s, BEN, 'LeaveSalary'), [5000, 0, 3400, 1600, 0]);
  assert.deepEqual(row(s, BEN, 'Accrual:' + FLIGHT), [100, 100, 200, 0, 0]);
  await assert.rejects(call('u-admin', 'saveProvisionOpeningEntry', { employeeId: BEN, provision: 'Gratuity', amount: 1, asOf: '2026-07-31' }), /final settlement \(FS-0001\)/);
  const op = s.openings.find(o => o.EmployeeID === BEN);
  await assert.rejects(call('u-admin', 'deleteProvisionOpening', { openingId: op.OpeningID }), /final settlement/);
  await firestore.collection('payrollSettlements').doc('fs_' + BEN).delete();
});

test('Payroll\'s rights and the company; the period checked; a claim\'s journal opens here', async () => {
  // Payroll's access, Payroll's "pay" and Payroll Setup's "write" (decision 60).
  const v = await statement('2026-08', '2026-09', 'u-viewer');
  assert.deepEqual([v.rows.length > 0, v.canPay, v.canWriteOpenings], [true, false, false]);
  await rtdb.ref('permissions/PAYROLL/access').set(['Admin']);
  await assert.rejects(statement('2026-08', '2026-09', 'u-viewer'), /access to Payroll/, 'the module\'s own access is not enough');
  await assert.rejects(call('u-viewer', 'getProvisionMovements', { companyId: 'C1', from: '2026-08', to: '2026-09', employeeId: ALI, key: 'Gratuity' }), /access to Payroll/);
  await rtdb.ref('permissions/PAYROLL/access').set(['Admin', 'Viewer']);
  await assert.rejects(call('u-other', 'getProvisionStatement', { companyId: 'C1', from: '2026-08', to: '2026-09' }), /access to that company/);
  await assert.rejects(statement('2026-09', '2026-08'), /ends before it starts/);
  await assert.rejects(statement('2026-13', '2026-09'), /Choose the period/);
  const s = await statement('2026-08', '2026-09');
  assert.deepEqual([s.canPay, s.canWriteOpenings], [true, true]);
  const c = s.claims.find(x => x.ClaimID === CLAIM);
  assert.deepEqual(await call('u-admin', 'getPayrollJournalSource', { jvId: c.JVID }), { ModuleID: 'PROVISIONS', ID: CLAIM, CompanyID: 'C1', JVNumber: c.JVNumber });
});
