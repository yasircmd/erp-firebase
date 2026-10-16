// HR: Employee Records, step 1 (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md):
// HR Setup (grades with company pay bands, designations, extra fields,
// document types), the employee record (group numbers, checks, extra
// fields, the "sensitive" right), job fields only by Correction after
// creation, the line manager rules and Replace manager, history, and the
// Employees sheet of Master Data Import.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });

function fixture() {
  const f = baseFixture();
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Finance', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.CCX = { Type: 'CostCenter', Code: 'CCX', Name: 'Other Co CC', Status: 'Active', CompanyID: 'C2' };
  return f;
}
let G = {}, D = {};
async function setup() {
  for (const [code, level] of [['G3', 3], ['G5', 5], ['G8', 8]]) {
    const r = await call('u-admin', 'saveHrGrade', { grade: { Code: code, Name: 'Grade ' + level, Level: level, Bands: { C1: { Min: level * 1000, Mid: level * 1500, Max: level * 2000 } } } });
    G[code] = r.gradeId;
  }
  D.acc = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant', GradeFromID: G.G3, GradeToID: G.G5 } })).designationId;
  D.mgr = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Finance Manager', GradeFromID: G.G8, GradeToID: G.G8 } })).designationId;
}
const emp = (over) => Object.assign({ FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-03-01', DesignationID: D.acc, GradeID: G.G5, CostCenterID: 'CC1' }, over || {});
const save = (e, uid, correction) => call(uid || 'u-admin', 'saveEmployee', { employee: e, correction });
const get = (id, uid) => call(uid || 'u-admin', 'getEmployee', { employeeId: id });

test.beforeEach(async () => { await reset(fixture()); G = {}; D = {}; await setup(); });

test('HR Setup: grades with company pay bands, designations, extra fields, document types', async () => {
  await assert.rejects(call('u-viewer', 'saveHrGrade', { grade: { Code: 'G1', Level: 1 } }), /permission to change HR Setup/);
  await assert.rejects(call('u-admin', 'saveHrGrade', { grade: { Code: 'g5', Level: 6 } }), /Grade code "g5" is already in use/);
  await assert.rejects(call('u-admin', 'saveHrGrade', { grade: { Code: 'G9', Level: 0 } }), /level is a whole number from 1 to 99/);
  await assert.rejects(call('u-admin', 'saveHrGrade', { grade: { Code: 'G9', Level: 9, Bands: { C1: { Min: 10, Mid: 5, Max: 20 } } } }), /minimum ≤ midpoint ≤ maximum/);
  await assert.rejects(call('u-admin', 'saveHrGrade', { grade: { Code: 'G9', Level: 9, Bands: { C2: { Min: 1, Mid: 2, Max: 3 } } } }), /do not have access to that company/);
  // Another company's band stays when one company's is edited.
  await rtdb.ref('users/u-admin/AssignedCompanies').set(['C1', 'C2']);
  await call('u-admin', 'saveHrGrade', { grade: { GradeID: G.G5, Code: 'G5', Name: 'Grade 5', Level: 5, Bands: { C2: { Min: 1, Mid: 2, Max: 3 } } } });
  await rtdb.ref('users/u-admin/AssignedCompanies').set(['C1']);
  await call('u-admin', 'saveHrGrade', { grade: { GradeID: G.G5, Code: 'G5', Name: 'Grade 5', Level: 5, Bands: { C1: { Min: 5000, Mid: 7000, Max: 9000 } } } });
  const g5 = (await firestore.collection('hrGrades').doc(G.G5).get()).data();
  assert.deepEqual(g5.Bands, { C1: { Min: 5000, Mid: 7000, Max: 9000 }, C2: { Min: 1, Mid: 2, Max: 3 } });
  assert.deepEqual(Object.keys((await call('u-admin', 'getHrSetup', {})).grades.find(g => g.GradeID === G.G5).Bands), ['C1'], 'only the user\'s companies');
  await assert.rejects(call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk', GradeFromID: G.G8, GradeToID: G.G3 } }), /from the lower grade to the higher one/);
  await assert.rejects(call('u-admin', 'saveHrDesignation', { designation: { Title: 'accountant' } }), /already a designation "accountant"/);
  // Extra fields: type checked; a used field keeps its type.
  await assert.rejects(call('u-admin', 'saveHrField', { field: { Label: 'Visa no.', Type: 'number' } }), /date, text or amount/);
  const f = (await call('u-admin', 'saveHrField', { field: { Label: 'Visa expiry', Type: 'date' } })).fieldId;
  await save(emp({ Custom: { [f]: '2027-01-31' } }));
  await assert.rejects(call('u-admin', 'saveHrField', { field: { FieldID: f, Label: 'Visa expiry', Type: 'text' } }), /type can't change/);
  const s = await call('u-viewer', 'getHrSetup', {});
  assert.deepEqual(s.documentTypes.map(t => t.Name).slice(0, 4), ['Passport', 'Emirates ID', 'Visa / Residence', 'Labour Card']);
  assert.equal(s.canWrite, false);
});

test('the employee record: group numbers, checks, extra fields, warnings; company access', async () => {
  const visa = (await call('u-admin', 'saveHrField', { field: { Label: 'Emirates ID no.', Type: 'text', Required: true, Section: 'Personal' } })).fieldId;
  const allowance = (await call('u-admin', 'saveHrField', { field: { Label: 'Agreed notice (days)', Type: 'amount' } })).fieldId;
  await assert.rejects(save(emp({ Custom: {} })), /Enter Emirates ID no\. \(compulsory\)/);
  await assert.rejects(save(emp({ FullName: '', Custom: { [visa]: '784-1' } })), /Enter the full name/);
  await assert.rejects(save(emp({ GradeID: '', Custom: { [visa]: '784-1' } })), /Choose the grade/);
  await assert.rejects(save(emp({ JoinDate: '2024-02-30', Custom: { [visa]: '784-1' } })), /date of joining is not a valid date/);
  await assert.rejects(save(emp({ CostCenterID: 'CCX', Custom: { [visa]: '784-1' } })), /belongs to another company/);
  await assert.rejects(save(emp({ Custom: { [visa]: '784-1', [allowance]: 'thirty' } })), /Agreed notice \(days\) is not an amount/);
  await assert.rejects(save(emp({ Custom: { [visa]: '784-1' } }), 'u-viewer'), /permission to change employee records/);
  const a = await save(emp({ Custom: { [visa]: '784-1', [allowance]: '30' } }));
  const b = await save(emp({ FullName: 'Sara Khan', GradeID: G.G8, Custom: { [visa]: '784-2' } }));
  assert.deepEqual([a.employeeNo, b.employeeNo], ['EMP-0001', 'EMP-0002']);
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(b.warnings, ['Grade G8 is outside the usual range for Accountant.'], 'a warning, not a refusal');
  const list = (await call('u-viewer', 'getEmployees', {})).employees;
  assert.deepEqual(list.map(e => [e.EmployeeNo, e.FullName, e.DesignationTitle, e.GradeCode, e.CostCenterName, e.Status]),
    [['EMP-0001', 'Ali Hassan', 'Accountant', 'G5', 'Workshop', 'Active'], ['EMP-0002', 'Sara Khan', 'Accountant', 'G8', 'Workshop', 'Active']]);
  assert.equal((await get(a.employeeId)).employee.Custom[allowance], 30);
  assert.deepEqual((await call('u-other', 'getEmployees', {})).employees, [], 'another company\'s user sees none');
  await assert.rejects(get(a.employeeId, 'u-other'), /do not have access to that company/);
  // A compulsory field added later shows as missing on existing employees.
  await call('u-admin', 'saveHrField', { field: { Label: 'Passport no.', Type: 'text', Required: true } });
  assert.deepEqual((await get(a.employeeId)).missing, ['Passport no.']);
  assert.equal((await call('u-admin', 'getEmployees', {})).employees[0].Missing, 1);
});

test('the sensitive right: bank details and sensitive extra fields; never wiped by someone who can\'t see them', async () => {
  const eid = (await call('u-admin', 'saveHrField', { field: { Label: 'Emirates ID no.', Type: 'text', Sensitive: true } })).fieldId;
  const a = await save(emp({ BankName: 'ENBD', IBAN: 'ae07 0331 2345 6789 0123 456', Custom: { [eid]: '784-1990' } }));
  const mine = (await get(a.employeeId)).employee;
  assert.deepEqual([mine.BankName, mine.IBAN, mine.Custom[eid]], ['ENBD', 'AE070331234567890123456', '784-1990']);
  const v = await get(a.employeeId, 'u-viewer');
  assert.deepEqual([v.employee.BankName, v.employee.IBAN, v.employee.Custom[eid], v.canSeeSensitive], [undefined, undefined, undefined, false]);
  // A user who can change records but not see bank details: their save keeps them.
  await rtdb.ref('permissions/EMPLOYEES/write').set(['Admin', 'Viewer']);
  const r = await save(Object.assign({}, v.employee, { Mobile: '050 111' }), 'u-viewer');
  assert.equal(r.success, true);
  const after = (await get(a.employeeId)).employee;
  assert.deepEqual([after.BankName, after.IBAN, after.Custom[eid], after.Mobile], ['ENBD', 'AE070331234567890123456', '784-1990', '050 111']);
  // History: sensitive values masked for them.
  await save(Object.assign({}, after, { IBAN: 'AE000000000000000000001' }));
  const h = (await get(a.employeeId, 'u-viewer')).history.find(x => x.Changes.some(c => c.Field === 'IBAN'));
  assert.deepEqual([h.Changes[0].From, h.Changes[0].To], ['•••', '•••']);
  await assert.rejects(save(Object.assign({}, after, { IBAN: 'AE-07 xx' })), /letters and digits only/);
});

test('after creation: grade, designation and organization by Correction only (reason, HR Setup admins); history with names', async () => {
  const a = await save(emp());
  const e = (await get(a.employeeId)).employee;
  await assert.rejects(save(Object.assign({}, e, { GradeID: G.G3 })), /Grade change through an Employee Change\. To fix a mistake, use Correct/);
  await assert.rejects(save(Object.assign({}, e, { Mobile: '1' }), 'u-admin', 'typo'), /Nothing to correct/);
  await rtdb.ref('permissions/HRSETUP/write').set([]);
  await assert.rejects(save(Object.assign({}, e, { GradeID: G.G3 }), 'u-admin', 'Entered wrongly'), /Only HR Setup admins can correct Grade/);
  await rtdb.ref('permissions/HRSETUP/write').set(['Admin']);
  await save(Object.assign({}, e, { GradeID: G.G3, CostCenterID: 'CC2' }), 'u-admin', 'Entered wrongly');
  await save(Object.assign({}, e, { GradeID: G.G3, CostCenterID: 'CC2', Mobile: '055' }));
  const h = (await get(a.employeeId)).history;
  assert.deepEqual(h.map(x => x.Action), ['Edit', 'Correction', 'Create']);
  assert.equal(h[1].Reason, 'Entered wrongly');
  assert.deepEqual(h[1].Changes.map(c => [c.Label, c.From, c.To]), [['Cost center (department)', 'Workshop', 'Finance'], ['Grade', 'G5', 'G3']]);
  // Status: Left needs the leaving date.
  await assert.rejects(save(Object.assign({}, e, { GradeID: G.G3, CostCenterID: 'CC2', Status: 'Left' })), /Enter the leaving date/);
});

test('line manager: optional, no loops, not someone who left; Replace manager moves the reports', async () => {
  const boss = (await save(emp({ FullName: 'Omar Boss', DesignationID: D.mgr, GradeID: G.G8 }))).employeeId;
  const m1 = (await save(emp({ FullName: 'Mona One', ManagerID: boss }))).employeeId;
  const r1 = (await save(emp({ FullName: 'Rami', ManagerID: m1 }))).employeeId;
  const r2 = (await save(emp({ FullName: 'Rana', ManagerID: m1 }))).employeeId;
  const r3 = (await save(emp({ FullName: 'Raed', ManagerID: m1 }))).employeeId;
  const bossRec = (await get(boss)).employee;
  await assert.rejects(save(Object.assign({}, bossRec, { ManagerID: boss })), /own line manager/);
  await assert.rejects(save(Object.assign({}, bossRec, { ManagerID: r1 })), /Rami reports to Omar Boss .*can't be the line manager/);
  const m1Rec = (await get(m1)).employee;
  await assert.rejects(save(Object.assign({}, m1Rec, { Status: 'Left', LeavingDate: '2026-09-30', LeavingReason: 'Personal reasons' })), /still has 3 direct reports: use Replace manager first/);
  assert.deepEqual((await get(m1)).reports.map(x => x.FullName).sort(), ['Raed', 'Rami', 'Rana']);

  await assert.rejects(call('u-viewer', 'replaceManager', { fromEmployeeId: m1, toEmployeeId: boss }), /permission to change employee records/);
  // Promote a report: Rana takes the team; she reports to Mona's manager.
  const res = await call('u-admin', 'replaceManager', { fromEmployeeId: m1, toEmployeeId: r2, reason: 'Mona leaving' });
  assert.equal(res.moved, 3);
  const mgrOf = async id => (await get(id)).employee.ManagerID;
  assert.deepEqual([await mgrOf(r1), await mgrOf(r3), await mgrOf(r2)], [r2, r2, boss]);
  const h = (await get(r1)).history[0];
  assert.deepEqual([h.Action, h.Reason, h.Changes[0].From, h.Changes[0].To], ['Replace manager', 'Mona leaving', 'Mona One', 'Rana']);
  // Now Mona can leave; a leaver can't become a manager.
  await save(Object.assign({}, m1Rec, { Status: 'Left', LeavingDate: '2026-09-30', LeavingReason: 'Personal reasons' }));
  await assert.rejects(save(emp({ FullName: 'New', ManagerID: m1 })), /Mona One has left/);
  // Loop: Rana's team can't be moved under Rami (who reports to Rana).
  await assert.rejects(call('u-admin', 'replaceManager', { fromEmployeeId: boss, toEmployeeId: r1 }), /Rami reports to Rana .*move them first/);
  await assert.rejects(call('u-admin', 'replaceManager', { fromEmployeeId: r1, toEmployeeId: boss }), /Rami has no direct reports/);
});

test('Master Data Import: an Employees sheet with the extra fields, a manager from a row above; the sensitive columns', async () => {
  const eid = (await call('u-admin', 'saveHrField', { field: { Label: 'Emirates ID no.', Type: 'text', Required: true } })).fieldId;
  const specs = await call('u-admin', 'getMasterImportSpecs', {});
  const sheet = specs.find(s => s.key === 'EMPLOYEE');
  assert.ok(sheet.columns.some(c => c.header === 'Emirates ID no.' && c.required));
  const tsv = rows => rows.map(r => r.join('\t')).join('\n');
  const head = ['Full Name', 'Company', 'Date of Joining', 'Designation', 'Grade', 'Line Manager', 'Cost Center (Department)', 'Emirates ID no.', 'Account No. / IBAN'];
  const rows = [head,
    ['Omar Boss', '01', '01/01/2020', 'Finance Manager', 'G8', '', 'CC2', '784-1', ''],
    ['Ali Hassan', '01', '01/03/2024', 'Accountant', 'G5', 'Omar Boss', 'Finance', '784-2', 'AE070331234567890123456']];
  // Importing employees needs the same right as entering them by hand.
  await rtdb.ref('permissions/MASTERIMPORT/access').set(['Admin', 'Viewer']);
  const chk = await call('u-viewer', 'checkMasterImport', { master: 'EMPLOYEE', text: tsv([head, ['X', '01', '01/01/2020', 'Accountant', 'G5', '', '', '1', '']]) });
  assert.deepEqual(chk.issues.map(i => i.message), ['You do not have permission to change Employees (the import needs the same right as entering it by hand).']);
  const bad = await call('u-admin', 'checkMasterImport', { master: 'EMPLOYEE', text: tsv([head, ['Zed', '01', '31/02/2024', 'Clerk', 'G5', '', '', '', '']]) });
  assert.deepEqual(bad.issues.map(i => i.column).sort(), ['Date of Joining', 'Designation', 'Emirates ID no.']);
  const r = await call('u-admin', 'runMasterImport', { master: 'EMPLOYEE', text: tsv(rows) });
  assert.equal(r.success, true, JSON.stringify(r.issues));
  assert.deepEqual(r.codes, ['EMP-0001', 'EMP-0002']);
  const list = (await call('u-admin', 'getEmployees', {})).employees;
  const ali = list.find(e => e.FullName === 'Ali Hassan');
  assert.deepEqual([ali.ManagerName, ali.CostCenterName], ['Omar Boss', 'Finance']);
  assert.equal((await get(ali.EmployeeID)).employee.Custom[eid], '784-2');
  assert.equal((await get(ali.EmployeeID)).employee.IBAN, 'AE070331234567890123456');
  // The same paste again: the same people.
  const again = await call('u-admin', 'checkMasterImport', { master: 'EMPLOYEE', text: tsv(rows) });
  assert.ok(again.issues.some(i => /already exists \(EMP-0001\)/.test(i.message)));
  // Without the sensitive right: the bank column is refused.
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set([]);
  const s = await call('u-admin', 'checkMasterImport', { master: 'EMPLOYEE', text: tsv([head, ['Nadia', '01', '01/05/2024', 'Accountant', 'G5', '', '', '784-9', 'AE07']]) });
  assert.deepEqual(s.issues.map(i => i.message), ['You do not have the right to enter Account No. / IBAN (Employees: sensitive).']);
});

test('Location (owner, 2026-10-14): an org unit of type Location, the company\'s or shared; changed by an ordinary edit', async () => {
  await rtdb.ref('orgUnits').update({
    LOC1: { Type: 'Location', Code: 'LOC1', Name: 'Dubai office', Status: 'Active' },
    LOC2: { Type: 'Location', Code: 'LOC2', Name: 'Abu Dhabi yard', Status: 'Active', CompanyID: 'C2' },
    LOC3: { Type: 'Location', Code: 'LOC3', Name: 'Sharjah store', Status: 'Active', CompanyID: 'C1' }
  });
  await assert.rejects(save(emp({ LocationID: 'LOC2' })), /That location belongs to another company/);
  await assert.rejects(save(emp({ LocationID: 'CC1' })), /Location not found/);
  const id = (await save(emp({ LocationID: 'LOC1' }))).employeeId;
  const e = (await get(id)).employee;
  assert.equal(e.LocationID, 'LOC1');
  await save(Object.assign({}, e, { LocationID: 'LOC3' }));
  const after = await get(id);
  assert.equal(after.employee.LocationID, 'LOC3');
  assert.match(JSON.stringify(after.history), /Location.*Dubai office.*Sharjah store/);
});
