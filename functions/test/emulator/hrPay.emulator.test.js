// HR: Pay Elements and compensation, step 3 (owner, 2026-10-03;
// docs/modules/HR_EMPLOYEES.md): the elements (six to start, one Basic),
// the first pay set directly, then only Correct (reason, HR Setup admins)
// until Employee Changes; versions never overwritten; the band warning;
// the sensitive right.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });

let EMP, EL;
async function seed() {
  await reset(baseFixture());
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G5', Level: 5, Bands: { C1: { Min: 8000, Mid: 10000, Max: 12000 } } } })).gradeId;
  const d = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  EMP = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-03-01', DesignationID: d, GradeID: g } })).employeeId;
  EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
}
const pay = (lines, terms, extra) => Object.assign({ Lines: Object.entries(lines).map(([c, a]) => ({ ElementID: EL[c], Amount: a })), Terms: terms || [] }, extra || {});
const save = (comp, uid, correction) => call(uid || 'u-admin', 'saveCompensation', { employeeId: EMP, compensation: comp, correction });
const get = uid => call(uid || 'u-admin', 'getCompensation', { employeeId: EMP });

test.beforeEach(seed);

test('Pay Elements: six to start, one Basic, checked; a used element keeps its kind', async () => {
  const s = await call('u-viewer', 'getPayElements', {});
  assert.deepEqual(s.elements.map(e => [e.Code, e.Kind, e.Nature, e.IsBasic]), [['BASIC', 'Earning', 'Fixed', true], ['HRA', 'Earning', 'Fixed', false],
    ['TRANS', 'Earning', 'Fixed', false], ['OTHER', 'Earning', 'Fixed', false], ['BONUS', 'Earning', 'Variable', false], ['COMM', 'Earning', 'Variable', false]]);
  assert.equal(s.canWrite, false);
  await assert.rejects(call('u-viewer', 'savePayElement', { element: { Code: 'X', Name: 'X', Kind: 'Earning', Nature: 'Fixed' } }), /permission to change HR Setup/);
  await assert.rejects(call('u-admin', 'savePayElement', { element: { Code: 'hra', Name: 'Housing 2', Kind: 'Earning', Nature: 'Fixed' } }), /Code "HRA" is already in use/);
  await assert.rejects(call('u-admin', 'savePayElement', { element: { Code: 'LOAN', Name: 'Loan', Kind: 'Deduction', Nature: 'Fixed', IsBasic: true } }), /The Basic is a fixed earning/);
  const loan = (await call('u-admin', 'savePayElement', { element: { Code: 'LOAN', Name: 'Loan recovery', Kind: 'Deduction', Nature: 'Fixed' } })).elementId;
  // A new Basic replaces the old mark.
  const b2 = (await call('u-admin', 'savePayElement', { element: { Code: 'BASIC2', Name: 'Basic (new)', Kind: 'Earning', Nature: 'Fixed', IsBasic: true } })).elementId;
  const after = (await call('u-admin', 'getPayElements', {})).elements;
  assert.deepEqual(after.filter(e => e.IsBasic).map(e => e.ElementID), [b2]);
  EL.LOAN = loan;
  await save(pay({ BASIC: 9000, LOAN: 500 }));
  await assert.rejects(call('u-admin', 'savePayElement', { element: { ElementID: loan, Code: 'LOAN', Name: 'Loan recovery', Kind: 'Earning', Nature: 'Fixed' } }), /used in employees' pay: its kind and nature can't change/);
});

test('the first pay: from the date of joining, monthly amounts and agreed terms, totals; the band warning', async () => {
  await assert.rejects(save(pay({})), /Enter at least one monthly amount/);
  await assert.rejects(save(pay({ BASIC: -1 })), /must be 0 or more/);
  await assert.rejects(save(pay({ BASIC: 9000 }, [{ ElementID: EL.BASIC, Value: 1 }])), /Basic Salary is fixed: enter it as a monthly amount/);
  await assert.rejects(save({ Lines: [{ ElementID: EL.BONUS, Amount: 100 }] }), /Bonus is variable: enter it as agreed terms/);
  await assert.rejects(save(pay({ BASIC: 9000 }, [{ ElementID: EL.COMM, Basis: 'Percent', Value: 150 }])), /a % from 0 to 100/);
  await assert.rejects(save(pay({ BASIC: 9000 }, null, { EffectiveFrom: '2024-01-01' })), /can't start before the date of joining/);
  const r = await save(pay({ BASIC: 7000, HRA: 3000, TRANS: 500 }, [{ ElementID: EL.BONUS, Basis: 'Amount', Value: 14000, Frequency: 'Annual', Notes: 'up to 2 months\' basic' },
    { ElementID: EL.COMM, Basis: 'Percent', Value: 3, Of: 'of sales', Frequency: 'Monthly' }]));
  assert.equal(r.warning, 'The basic 7,000.00 is below the G5 band (minimum 8,000.00).');
  const g = await get();
  assert.deepEqual([g.current.EffectiveFrom, g.current.Basic, g.current.MonthlyEarnings, g.current.Terms.length], ['2024-03-01', 7000, 10500, 2]);
  assert.equal(g.warning, r.warning);
  assert.deepEqual(g.band, { GradeCode: 'G5', Min: 8000, Mid: 10000, Max: 12000 });
  assert.deepEqual([g.canSet, g.canCorrect], [false, true]);
  const h = (await call('u-admin', 'getEmployee', { employeeId: EMP })).history[0];
  assert.equal(h.Action, 'Pay set');
  assert.match(h.Changes[0].To, /^From 2024-03-01: BASIC 7,000\.00, HRA 3,000\.00, TRANS 500\.00; BONUS 14,000\.00 annual, COMM 3% of sales monthly$/);
});

test('after the first: changes through an Employee Change; Correct (reason, HR Setup admins) keeps the old version', async () => {
  const first = await save(pay({ BASIC: 9000, HRA: 3000 }));
  await assert.rejects(save(pay({ BASIC: 9500, HRA: 3000 })), /Pay changes through an Employee Change.*use Correct/);
  await rtdb.ref('permissions/HRSETUP/write').set([]);
  await assert.rejects(save(pay({ BASIC: 9500 }), 'u-admin', 'typo'), /Only HR Setup admins can correct pay/);
  await rtdb.ref('permissions/HRSETUP/write').set(['Admin']);
  await save(pay({ BASIC: 9500, HRA: 3000 }), 'u-admin', 'Basic entered wrongly');
  const g = await get();
  assert.deepEqual(g.versions.map(v => [v.Status, v.Basic, v.Source]), [['Active', 9500, 'Correction'], ['Replaced', 9000, 'Initial']]);
  assert.equal(g.versions[1].VersionID, first.versionId);
  assert.equal(g.current.Basic, 9500);
  assert.equal(g.warning, '');
  const h = (await call('u-admin', 'getEmployee', { employeeId: EMP })).history[0];
  assert.deepEqual([h.Action, h.Reason], ['Pay corrected', 'Basic entered wrongly']);
});

test('the sensitive right: needed to see and set pay; history masked without it', async () => {
  await save(pay({ BASIC: 9000 }));
  await assert.rejects(get('u-viewer'), /right to see employees' pay/);
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set(['Admin', 'Viewer']);
  assert.equal((await get('u-viewer')).current.Basic, 9000);
  await assert.rejects(save(pay({ BASIC: 1 }), 'u-viewer'), /right to set employees' pay/);
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set(['Admin']);
  const h = (await call('u-viewer', 'getEmployee', { employeeId: EMP })).history.find(x => x.Action === 'Pay set');
  assert.equal(h.Changes[0].To, '•••');
  await assert.rejects(call('u-other', 'getCompensation', { employeeId: EMP }), /do not have access to that company/);
});
