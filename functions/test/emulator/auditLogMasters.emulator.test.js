// The audit log, step 2 (owner, 2026-11-13; docs/modules/AUDIT_LOG.md,
// QA2, QA3, QA5, QA6, QA8): a master's or a setting's changed fields, in
// the Realtime Database and in Firestore; sensitive fields as "changed"
// only; ERP sign-ins and sign-outs; and the firm's change to a client in
// both logs, as "The provider" in the client's.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { firestore, call, reset, baseFixture } = require('./_helpers');

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'audit-client-' + process.pid);
test.after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

const entriesIn = async fs => (await fs.collection('auditLog').get()).docs.map(d => d.data()).sort((a, b) => a.At.localeCompare(b.At));
const entries = () => entriesIn(firestore);
const changesOf = e => Object.fromEntries((e.Changes || []).map(c => [c.Field, c.Changed ? 'changed' : [c.From, c.To]]));
const good = { VendorName: 'Gulf Steel Trading', Category: 'RawMaterialSupplier', CompanyID: 'C1', Classification: 'Local',
  TradePayablesAccountID: 'A-AP', PaymentTermsDays: 30, Email: 'ap@gulfsteel.test' };

test('a vendor (Realtime Database, the ported save): its creation, then each changed field before → after (QA2)', async () => {
  await reset(baseFixture());
  const r = await call('u-admin', 'saveVendor', { vendorData: good });
  assert.equal(r.success, true, JSON.stringify(r));
  const id = r.vendorId || Object.keys((await require('./_helpers').rtdb.ref('vendors').get()).val()).find(k => k !== 'V1');
  await call('u-admin', 'saveVendor', { vendorData: Object.assign({}, good, { VendorID: id, PaymentTermsDays: 45, Email: 'pay@gulfsteel.test' }) });
  const e = (await entries()).filter(x => x.Source === 'rtdb:vendors');
  assert.deepEqual(e.map(x => [x.Action, x.ModuleID, x.RecordID, x.RecordLabel, x.UserID, x.Function]), [
    ['create', 'VENDORMASTER', id, 'Gulf Steel Trading', 'u-admin', 'saveVendor'],
    ['change', 'VENDORMASTER', id, 'Gulf Steel Trading', 'u-admin', 'saveVendor']]);
  assert.deepEqual(changesOf(e[1]), { Email: ['ap@gulfsteel.test', 'pay@gulfsteel.test'], PaymentTermsDays: [30, 45] }, 'only what changed; UpdatedAt is not a change');
  assert.equal(changesOf(e[0]).VendorName[1], 'Gulf Steel Trading');
  // The request's own action is still recorded beside it (step 1).
  assert.equal((await entries()).filter(x => !x.Source && x.Function === 'saveVendor').length, 2);
});

test('rights: the whole permission matrix saved, one entry per module whose rights changed', async () => {
  await reset(baseFixture());
  const m = await call('u-admin', 'getModulePermissionsMatrix');
  const next = JSON.parse(JSON.stringify(m.permissions));
  next.UOM.write = ['Admin', 'Viewer'];
  assert.deepEqual(await call('u-admin', 'saveAllModulePermissions', { allPermissions: next }), { success: true });
  const e = (await entries()).filter(x => x.Source === 'rtdb:permissions');
  assert.deepEqual(e.map(x => [x.Action, x.ModuleID, x.RecordID]), [['change', 'ROLES', 'UOM']]);
  assert.deepEqual(changesOf(e[0]), { write: ['["Admin"]', '["Admin","Viewer"]'] });
});

test('an employee (Firestore): changed fields, the IBAN and the pay only as "changed" (QA3, QA8)', async () => {
  await reset(baseFixture());
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G1', Level: 1 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk' } })).designationId;
  const base = { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1', BankName: 'ENBD', IBAN: 'AE070331234567890123456' };
  const emp = (await call('u-admin', 'saveEmployee', { employee: base })).employeeId;
  await call('u-admin', 'saveEmployee', { employee: Object.assign({}, base, { EmployeeID: emp, BankName: 'ADCB', IBAN: 'AE460030000123456789012' }) });
  const el = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(x => [x.Code, x.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: emp, compensation: { Lines: [{ ElementID: el.BASIC, Amount: 3000 }] } });
  const all = await entries();
  const e = all.filter(x => x.Source === 'employees');
  assert.deepEqual(e.map(x => [x.Action, x.ModuleID, x.RecordID, x.RecordLabel]), [['create', 'EMPLOYEES', emp, 'Ali Hassan'], ['change', 'EMPLOYEES', emp, 'Ali Hassan']]);
  const c = changesOf(e[1]);
  assert.deepEqual(c.BankName, ['ENBD', 'ADCB']);
  assert.equal(c.IBAN, 'changed', 'never its value');
  assert.equal(JSON.stringify(all).includes('AE07033'), false, 'the IBAN is nowhere in the log');
  const pay = all.filter(x => x.Source === 'employeeCompensation');
  assert.equal(pay.length, 1);
  assert.ok(pay[0].Changes.length && pay[0].Changes.every(x => x.Changed === true && x.From === undefined), 'pay: every field "changed", no amounts');
  assert.equal(JSON.stringify(pay).includes('3000'), false);
  assert.deepEqual(all.filter(x => x.Source === 'hrGrades').map(x => [x.Action, x.ModuleID]), [['create', 'HRSETUP']]);
});

test('an ERP sign-in and sign-out are recorded; the sign-in\'s Last Login is not a change (QA5)', async () => {
  await reset(baseFixture());
  await call('u-admin', 'completeLogin', { corporateId: '100' });
  await call('u-admin', 'recordSignOut', {});
  const all = await entries();
  const e = all.filter(x => !x.Source);
  assert.deepEqual(e.map(x => [x.Action, x.UserID, x.UserName, x.RecordLabel]), [['signin', 'u-admin', 'Admin User', 'ERP'], ['signout', 'u-admin', 'Admin User', 'ERP']]);
  assert.equal(all.filter(x => x.Source === 'rtdb:users').length, 0, 'Last Login is not a change');
  // This fixture has no tree, so the sign-in seeds it: too many records to list, one summary.
  assert.deepEqual(all.filter(x => x.Source === 'rtdb:tree').map(x => [x.Action, x.ModuleID, /^\(\d+ records?\)$/.test(x.RecordID)]), [['change', 'TREEMGMT', true]]);
});

test('the firm changes a client\'s limits: in the firm\'s log, and in the client\'s as "The provider" (QA6)', async () => {
  await reset(baseFixture());
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/databases/(default)/documents', { method: 'DELETE' });
  await firestore.doc('corporateDirectory/200').set({ Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', Modules: {} });
  assert.equal((await call('u-admin', 'saveDeveloperLimits', { CorporateID: '200', MaxCompanies: 3, MaxUsers: '' })).success, true);
  const mine = (await entries()).filter(x => x.Source === 'corporateDirectory');
  assert.deepEqual(mine.map(x => [x.Action, x.RecordID, x.ClientCorporate, x.UserID]), [['change', '200', '200', 'u-admin']]);
  assert.deepEqual(changesOf(mine[0]), { MaxCompanies: [null, 3] });
  const theirs = await entriesIn(clientApp.firestore());
  assert.deepEqual(theirs.map(x => [x.Action, x.UserName, x.Role, x.UserID, x.RecordID]), [['change', 'The provider', 'Provider', '', '200']]);
  assert.deepEqual(changesOf(theirs[0]), { MaxCompanies: [null, 3] });
});

test('the firm working inside a client (its chart headings): in the client\'s log as "The provider", and in the firm\'s (QA6)', async () => {
  await reset(baseFixture());
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/databases/(default)/documents', { method: 'DELETE' });
  await clientApp.database().ref('/').set(null);
  await firestore.doc('corporateDirectory/200').set({ Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', Modules: {} });
  const acc = (code, name, o) => Object.assign({ AccountCode: code, AccountName: name, AccountType: 'Asset', NormalBalance: 'Debit', IsPostable: false, Status: 'Active', CompanyID: '' }, o);
  await require('./_helpers').rtdb.ref('coa').set({ H1: acc('100000', 'Assets'), H2: acc('110000', 'Cash', { ParentAccountID: 'H1' }) });
  assert.equal((await call('u-admin', 'copyDeveloperChartHeaders', { CorporateID: '200' })).count, 2);
  // The chart is a large list written whole: one summary, its records named.
  const theirs = (await entriesIn(clientApp.firestore())).filter(x => x.Source === 'rtdb:coa');
  assert.deepEqual(theirs.map(x => [x.Action, x.ModuleID, x.RecordID, x.UserName, x.Function]), [['change', 'COA', '(2 records)', 'The provider', 'copyDeveloperChartHeaders']]);
  const mine = (await entries()).filter(x => x.Source === 'rtdb:coa');
  assert.deepEqual(mine.map(x => [x.Action, x.ClientCorporate, x.UserID]), [['change', '200', 'u-admin']]);
  // Its directory entry, changed in the same request, in both logs too.
  assert.equal((await entries()).filter(x => x.Source === 'corporateDirectory' && x.ClientCorporate === '200').length, 1);
});

test('a directory change made in a transaction is seen (saveDeveloperCorporate)', async () => {
  await reset(baseFixture());
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/databases/(default)/documents', { method: 'DELETE' });
  const entry = { Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', WebConfig: { apiKey: 'demo-api-key', authDomain: CLIENT + '.firebaseapp.com', projectId: CLIENT }, Modules: {} };
  await firestore.doc('corporateDirectory/200').set(entry);
  const r = await call('u-admin', 'saveDeveloperCorporate', Object.assign({ CorporateID: '200' }, entry, { Name: 'Demo client LLC' }));
  assert.equal(r.success, true, JSON.stringify(r));
  const mine = (await entries()).filter(x => x.Source === 'corporateDirectory');
  assert.equal(mine.length, 1);
  assert.deepEqual(changesOf(mine[0]).Name, ['Demo client', 'Demo client LLC']);
  assert.equal((await entriesIn(clientApp.firestore())).filter(x => x.Source === 'corporateDirectory').length, 1);
});
