// Data Reset for every module (owner, 2026-10-24; docs/modules/DATA_RESET.md,
// decisions 283-286): the categories dataReset.js adds; a master refused
// while what uses it remains (284); the Employee Portal sign-ins (283) and
// the supporting documents' files (286) go with their categories;
// sub-collections are cleared too; and a reset in one corporate never
// touches another's data (UX_ROUND2.md item 37).
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { app, rtdb, firestore, call, reset, baseFixture, val, PROJECT } = require('./_helpers');

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'reset-client-' + process.pid);
test.after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

const root = (fn, data) => call('u-root', fn, data);
const clear = keys => root('clearDataCategories', { categoryKeys: keys, confirmPhrase: 'DELETE' });
const count = async col => (await firestore.collection(col).get()).size;

async function fixture() {
  const f = baseFixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Unused Vendor', Status: 'Active' };
  f.vendorCounters = { VEN: 2 };
  f.hrCounters = { EMP: 2, 'LV-2026': 1 };
  f.salesReps = { E1: { CompanyID: 'C1', Active: true } };
  f.periodClosing = { C1: { Months: { '2026-08': { Closed: true } } } };
  f.salesOrders = { SO1: { SONumber: 'SO-1', CompanyID: 'C1', Status: 'Reserved', Lines: [] } };
  f.stock = { reservations: { R1: { SourceID: 'SO1', ItemID: 'I1', Quantity: 2, Status: 'Active' }, R2: { SourceID: 'SO9', ItemID: 'I1', Quantity: 1, Status: 'Active' } } };
  await reset(f);
  for (const [id, data] of [['E1', { FullName: 'Ali Hassan', CompanyID: 'C1' }], ['E2', { FullName: 'Sara Khan', CompanyID: 'C1' }]]) await firestore.doc('employees/' + id).set(data);
  await firestore.doc('employeeCompensation/E1').set({ Basic: 5000 });
  await firestore.doc('payrollRuns/RUN1').set({ RunNumber: 'PR-1', Month: '2026-09', Status: 'Draft' });
  await firestore.doc('payrollRuns/RUN1/slips/E1').set({ Net: 5000 });
  await firestore.doc('hrGrades/G1').set({ Code: 'G1' });
  // Employee Portal sign-ins: two employees', and one pointing at an ERP
  // user's account (never deleted).
  const auth = app.auth();
  await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  for (const uid of ['ess-e1', 'ess-e2', 'u-admin']) await auth.createUser({ uid, email: uid + '@test.local', password: 'secret-1' });
  await firestore.doc('essAccounts/E1').set({ Uid: 'ess-e1' });
  await firestore.doc('essUids/ess-e1').set({ EmployeeID: 'E1' });
  await firestore.doc('essUids/ess-e2').set({ EmployeeID: 'E2' });
  await firestore.doc('essUids/u-admin').set({ EmployeeID: 'E2' });
  // A supporting document, its file in the (emulator) document storage.
  await firestore.doc('settings/documentStorage').set({ Provider: 'Memory', RootFolderID: 'mf-root' });
  await firestore.doc('__documentStorage/m-file1').set({ Parent: 'mf-x', Name: 'contract.pdf', Folder: false, Data: '' });
  await firestore.doc('attachments/A1').set({ Module: 'EMPDOCS', DocID: 'D1', StorageFileID: 'm-file1', FileName: 'contract.pdf' });
}

test('the counts: every new category, in its group, browsable only where records may go one by one', async () => {
  await fixture();
  const c = await root('getDataResetCounts');
  assert.equal(Object.keys(c).length, 18 + 36); // Credit Limits & Holds and Credit Control Setup the latest (CREDIT_CONTROL.md)
  assert.deepEqual([c.taxConfig.label, c.taxConfig.group], ['Tax Configuration', 'setup']);
  assert.deepEqual([c.budgets.label, c.budgets.group, c.budgets.browse, c.budgetSetup.group], ['Budgets', 'transactional', true, 'setup']);
  assert.deepEqual([c.creditLimits.label, c.creditLimits.group, c.creditLimits.browse, c.creditSetup.group], ['Credit Limits & Holds', 'master', true, 'setup']);
  assert.deepEqual([c.clearances.group, c.clearances.browse], ['transactional', true]);
  assert.deepEqual([c.repReceipts.label, c.repReceipts.group, c.repReceipts.browse], ['Sales Rep Receipts', 'transactional', true]);
  assert.deepEqual([c.employees.group, c.employees.count, c.employees.browse], ['master', 2, false], 'the employees, not their compensation or sign-ins');
  assert.deepEqual([c.payrollRuns.group, c.payrollRuns.count, c.payrollRuns.browse], ['transactional', 1, true]);
  assert.deepEqual([c.hrSetup.group, c.hrSetup.count], ['setup', 1]);
  assert.deepEqual([c.vendors.group, c.vendors.count], ['master', 2], 'records only, not the counter');
  assert.equal(c.items.browse, true, 'the ported categories keep their Browse');
  assert.equal(c.salesOrders.count, 1, 'the order (its reservations go with it)');
});

test('a master is refused while what uses it remains (284); nothing is deleted', async () => {
  await fixture();
  const r = await clear(['employees']);
  assert.equal(r.success, false);
  assert.match(r.error, /^Employees is still used by Payroll Runs & Payslips \(1\)\. Select those too, or clear them first\. Nothing was deleted\.$/);
  assert.equal(await count('employees'), 2);
  // A ported master too: the items, used by a Sales Order.
  const i = await clear(['items']);
  assert.match(i.error, /^Item Master is still used by Sales Orders & Reservations \(1\)/);
  assert.ok(await val('items/I1'));
  // Chosen together, it goes ahead.
  assert.equal((await clear(['employees', 'payrollRuns'])).success, true);
});

test('Employees: their records, sign-ins (283), sales reps and HR numbering; an ERP user\'s account is kept', async () => {
  await fixture();
  const r = await clear(['payrollRuns', 'employees']);
  assert.deepEqual(r, { success: true, cleared: ['Payroll Runs & Payslips', 'Employees'] });
  for (const col of ['employees', 'employeeCompensation', 'essAccounts', 'essUids', 'payrollRuns']) assert.equal(await count(col), 0, col);
  assert.equal((await firestore.collection('payrollRuns/RUN1/slips').get()).size, 0, 'the payslips under the run too');
  assert.equal(await val('salesReps'), null);
  assert.equal(await val('hrCounters'), null);
  const uids = (await app.auth().listUsers()).users.map(u => u.uid).sort();
  assert.deepEqual(uids, ['u-admin'], 'the portal sign-ins gone; the ERP user kept');
  assert.equal(await count('hrGrades'), 1, 'HR Setup is its own category');
});

test('Supporting Documents: links and files, to the storage\'s trash (286); refused when the storage is not connected', async () => {
  await fixture();
  await firestore.doc('settings/documentStorage').delete();
  const no = await clear(['supportingDocuments']);
  assert.match(no.error, /1 file\(s\) in the document storage, which is not connected: connect it in Document Storage first\. Nothing was deleted\./);
  assert.equal(await count('attachments'), 1);
  await firestore.doc('settings/documentStorage').set({ Provider: 'Memory', RootFolderID: 'mf-root' });
  assert.equal((await clear(['supportingDocuments'])).success, true);
  assert.equal(await count('attachments'), 0);
  assert.equal((await firestore.doc('__documentStorage/m-file1').get()).data().Trashed, true);
});

test('one record at a time: a payroll run with its payslips, a Sales Order with its reservations; not for a master others use', async () => {
  await fixture();
  const one = (categoryKey, recordIds) => root('clearSelectedRecords', { categoryKey, recordIds, confirmPhrase: 'DELETE' });
  assert.deepEqual(await one('payrollRuns', ['RUN1']), { success: true, count: 1, linkedCleared: 0 });
  assert.equal((await firestore.collection('payrollRuns/RUN1/slips').get()).size, 0);
  assert.deepEqual(await one('salesOrders', ['SO1']), { success: true, count: 1, linkedCleared: 0 });
  assert.deepEqual(Object.keys(await val('stock/reservations') || {}), ['R2'], 'only its own reservation');
  assert.match((await one('employees', ['E1'])).error, /Unknown or unsupported category/);
  const recs = await root('getCategoryRecords', { categoryKey: 'hrSetup' }).catch(e => e);
  assert.match(String(recs.message || recs), /Unknown or unsupported category/, 'setup is cleared whole');
});

test('the Setup group and the logs: cleared on their own', async () => {
  await fixture();
  await rtdb.ref('numbering/formats/EMP').set({ Prefix: 'E' });
  assert.match((await clear(['hrSetup'])).error, /^HR Setup is still used by Employees \(2\)/, 'its grades and designations are on the employees');
  assert.equal((await clear(['payrollRuns', 'employees', 'hrSetup', 'settings', 'periodClosing'])).success, true);
  assert.equal(await count('hrGrades'), 0);
  assert.equal(await val('numbering'), null);
  assert.equal(await val('periodClosing'), null);
});

test('a reset in a client corporate leaves Corporate 100 as it was, and the other way round (item 37)', async () => {
  await fixture();
  // Corporate 200, its own project, with its own vendors.
  const ENTRY = { Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', WebConfig: { apiKey: 'k', authDomain: CLIENT + '.firebaseapp.com', projectId: CLIENT }, Modules: {} };
  await firestore.doc('corporateDirectory/200').set(ENTRY);
  const c = baseFixture();
  c.users = { 'u-cara': { status: 'Active', role: 'ADMIN', username: 'cara', fullName: 'Cara Client', AssignedCompanies: ['C1'] } };
  c.vendors = { K9: { VendorCode: 'V900', VendorName: 'Client Vendor', Status: 'Active' } };
  await clientApp.database().ref('/').set(c);
  await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/accounts', { method: 'DELETE' });
  await clientApp.auth().createUser({ uid: 'u-cara', email: 'cara@client.test', password: 'secret-1' });
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const token = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/' + CLIENT, aud: CLIENT, sub: 'u-cara', user_id: 'u-cara', auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' } }) + '.';
  const asClient = async (fn, data) => {
    const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { __corporate: { id: '200', idToken: token }, __data: data } }) });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  const r = await asClient('clearDataCategories', { categoryKeys: ['vendors'], confirmPhrase: 'DELETE' });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal((await clientApp.database().ref('vendors').get()).val(), null, 'the client\'s vendors cleared');
  assert.ok(await val('vendors/V1'), 'Corporate 100\'s vendors untouched');
  // And Corporate 100's reset leaves the client's data.
  await clientApp.database().ref('vendors/K9').set({ VendorCode: 'V900', VendorName: 'Client Vendor', Status: 'Active' });
  assert.equal((await clear(['vendors'])).success, true);
  assert.equal(await val('vendors'), null);
  assert.ok((await clientApp.database().ref('vendors/K9').get()).val(), 'the client\'s vendors untouched');
});
