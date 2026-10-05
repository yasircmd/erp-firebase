// Master Data Import, Part 3 (owner, 2026-10-05; docs/modules/MASTER_IMPORT.md,
// decisions 8-11): "Update existing" for Employees. The key column
// (Employee No.) finds each record; only the pasted columns change; a
// blank cell keeps the value and "-" clears it; job and organization
// columns are refused (Employee Change); line managers are checked across
// the whole paste; a failed save puts back the rows saved before it;
// "Copy current records" gives a sheet that pastes back unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore, PROJECT } = require('./_helpers');
const admin = require('firebase-admin');
if (!admin.apps.some(a => a.name === '[DEFAULT]')) admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const mi = require('../../src/masterImport');

test.after(async () => { await app.delete(); await admin.app().delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const check = (rows, uid) => call(uid || 'u-admin', 'checkMasterImport', { master: 'EMPLOYEE', mode: 'update', text: tsv(rows) });
const run = (rows, uid) => call(uid || 'u-admin', 'runMasterImport', { master: 'EMPLOYEE', mode: 'update', text: tsv(rows) });
const msgs = r => r.issues.map(i => (i.row ? 'R' + i.row : 'H') + (i.column ? ' ' + i.column : '') + ': ' + i.message);
const emp = async id => (await firestore.collection('employees').doc(id).get()).data();
let E = {};

test.before(async () => {
  const f = baseFixture();
  f.roles.HR = { Name: 'HR', Status: 'Active' };
  f.users['u-hr'] = { status: 'Active', role: 'HR', username: 'hr', fullName: 'HR Officer', AssignedCompanies: ['C1'] };
  f.permissions.MASTERIMPORT.access.push('HR');
  f.permissions.EMPLOYEES.access.push('HR');
  f.permissions.EMPLOYEES.write.push('HR'); // but not "sensitive"
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const add = (name, x) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01',
    Mobile: '050 111', WorkEmail: name.split(' ')[0].toLowerCase() + '@x.test', IBAN: 'AE070331234567890123456' }, x) }).then(r => r.employeeId);
  E.sara = await add('Sara Khan'); E.ali = await add('Ali Hassan'); E.ben = await add('Ben Okafor'); E.omar = await add('Omar Said', { Status: 'Left', LeavingDate: '2026-06-30' });
});

test('the specs: Employees can be updated, by Employee No., without the job and organization columns; other masters not yet', async () => {
  const specs = await call('u-admin', 'getMasterImportSpecs', {});
  const e = specs.find(s => s.key === 'EMPLOYEE');
  assert.equal(e.update.key, 'Employee No.');
  const cols = e.update.columns.map(c => c.header);
  assert.ok(cols.includes('Line Manager') && cols.includes('Mobile'));
  assert.ok(!cols.includes('Grade') && !cols.includes('Company') && !cols.includes('Designation'));
  assert.equal(specs.find(s => s.key === 'ITEM').update, null);
  assert.match(msgs(await call('u-admin', 'checkMasterImport', { master: 'ITEM', mode: 'update', text: 'Item Code\tItem Name\nRM-0001\tX' })).join(), /can't be updated by import yet/);
});

test('checked: the key, locked columns, clearing a required one, managers across the paste (self, left, a loop), rights', async () => {
  const r1 = await check([['Employee No.', 'Grade', 'Line Manager'], ['EMP-0002', 'G3', 'EMP-0001']]);
  assert.match(msgs(r1).join(' | '), /H Grade: Grade can't be changed here: it changes through an Employee Change/);
  const r2 = await check([['Line Manager'], ['EMP-0001']]);
  assert.match(msgs(r2).join(), /key column "Employee No." is missing/);
  const r3 = await check([['Employee No.', 'Line Manager', 'Full Name'], ['EMP-0009', 'EMP-0001', ''], ['EMP-0002', 'EMP-0002', '-'], ['EMP-0002', 'EMP-0004', ''],
    ['EMP-0003', 'EMP-0001', '']]);
  assert.deepEqual(msgs(r3), [
    'R1 Employee No.: "EMP-0009" not found.',
    'R2 Full Name: Full Name can\'t be cleared.',
    'R3 Employee No.: Same Employee No. as row 2.',
    'R2 Line Manager: An employee can\'t be their own line manager.',
    'R3 Line Manager: Omar Said has left.']);
  // A loop only this paste makes: Sara under Ali, Ali under Sara.
  const r4 = await check([['Employee No.', 'Line Manager'], ['EMP-0001', 'EMP-0002'], ['EMP-0002', 'EMP-0001']]);
  assert.equal(r4.issues.filter(i => /would be a loop/.test(i.message)).length, 2);
  assert.match(msgs(await check([['Employee No.', 'Mobile'], ['Sara Khan', '1']])).join(), /R1 Employee No.: "Sara Khan" not found/, 'the key is the code only (decision 9)');
  assert.match(msgs(await check([['Employee No.', 'Mobile'], ['EMP-0001', '1']], 'u-viewer')).join(), /permission to change Employees/);
  assert.match(msgs(await check([['Employee No.', 'Account No. / IBAN'], ['EMP-0001', 'AE000']], 'u-hr')).join(), /right to change Account No. \/ IBAN \(Employees: sensitive\)/);
});

test('updated: only the pasted columns; a blank keeps, "-" clears; unchanged rows skipped; each change in the history', async () => {
  const rows = [['Employee No.', 'Line Manager', 'Mobile', 'Work Email'], ['EMP-0002', 'EMP-0001', '', '-'], ['EMP-0003', 'Sara Khan', '055 222', ''], ['EMP-0001', '', '', '']];
  const c = await check(rows);
  assert.deepEqual(c.issues, []);
  assert.deepEqual(c.changes, [
    [{ column: 'Line Manager', from: '', to: 'EMP-0001 Sara Khan' }, { column: 'Work Email', from: 'ali@x.test', to: '' }],
    [{ column: 'Line Manager', from: '', to: 'EMP-0001 Sara Khan' }, { column: 'Mobile', from: '050 111', to: '055 222' }],
    []]);
  assert.deepEqual(await run(rows), { success: true, rows: 3, updated: 2 });
  const ali = await emp(E.ali), ben = await emp(E.ben), sara = await emp(E.sara);
  assert.deepEqual([ali.ManagerID, ali.Mobile, ali.WorkEmail, ali.IBAN], [E.sara, '050 111', '', 'AE070331234567890123456']);
  assert.deepEqual([ben.ManagerID, ben.Mobile, ben.WorkEmail], [E.sara, '055 222', 'ben@x.test']);
  assert.equal(sara.ManagerID || '', '');
  const h = (await firestore.collection('employeeHistory').where('EmployeeID', '==', E.ali).get()).docs.map(d => d.data()).filter(x => x.Action === 'Edit');
  assert.deepEqual(h.map(x => [x.Reason, x.Changes.map(c => c.Label + ': ' + c.To)]), [['Import (update)', ['Work email: ', 'Line manager: Sara Khan']]]);
  const log = Object.values(await val('masterImports')).pop();
  assert.deepEqual([log.Mode, log.Status, log.Updated], ['Update', 'Updated', 2]);
});

test('a save that fails during the update puts back the rows saved before it, and their history', async () => {
  const user = { uid: 'u-admin', profile: await val('users/u-admin') };
  const before = await emp(E.ben);
  const res = await mi._updateRows({ auth: { uid: 'u-admin', token: {} } }, user, 'EMPLOYEE', [
    { id: E.ben, row: 1, set: { Mobile: '099 999' } }, { id: E.ali, row: 2, set: { ManagerID: 'no-such-employee' } }]);
  assert.equal(res.failure.row, 2);
  assert.match(res.failure.message, /Line manager not found/);
  assert.equal((await emp(E.ben)).Mobile, before.Mobile);
  const h = (await firestore.collection('employeeHistory').where('EmployeeID', '==', E.ben).get()).docs.map(d => d.data());
  assert.ok(!h.some(x => x.Changes.some(c => c.To === '099 999')), 'its history entry is gone too');
});

test('Copy current records: the key and the columns that can change, in pasteable form; pasted back it changes nothing; bank columns only with the right', async () => {
  const r = await call('u-admin', 'getMasterImportRecords', { master: 'EMPLOYEE' });
  const lines = r.text.split('\n').map(l => l.split('\t'));
  assert.equal(r.count, 4);
  assert.equal(lines[0][0], 'Employee No.');
  assert.ok(!lines[0].includes('Grade'));
  const at = h => lines[0].indexOf(h);
  const ben = lines.find(l => l[0] === 'EMP-0003');
  assert.deepEqual([ben[at('Full Name')], ben[at('Line Manager')], ben[at('Date of Joining')], ben[at('Gender')]], ['Ben Okafor', 'EMP-0001', '01/01/2024', 'Male']);
  const back = await check(lines);
  assert.deepEqual([back.issues, back.changes.every(c => !c.length)], [[], true], JSON.stringify(back.issues));
  const hr = await call('u-hr', 'getMasterImportRecords', { master: 'EMPLOYEE' });
  assert.equal(hr.sensitiveLeftOut, true);
  assert.ok(!hr.text.split('\n')[0].includes('IBAN'));
  await assert.rejects(call('u-admin', 'getMasterImportRecords', { master: 'ITEM' }), /can't be updated by import yet/);
});
