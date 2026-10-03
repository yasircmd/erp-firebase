// HR: employee documents, step 2 (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md):
// a record per document (type, number, dates), checked against its type;
// files in <company>/Employees/<no. - name>/<type>/; seeing them needs the
// Employees "sensitive" right, changing them "write" too; renew and
// remove keep the records; the 60-day Home task.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb } = require('./_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const T = todayIn('Asia/Dubai');
const PDF = Buffer.from('%PDF-1.4\n% passport scan\n').toString('base64');
let EMP, TYPES;
async function seed() {
  const f = baseFixture();
  f.permissions.DOCUMENTSTORAGE.access = ['Admin'];
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G5', Level: 5 } })).gradeId;
  const d = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  EMP = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-03-01', DesignationID: d, GradeID: g } })).employeeId;
  TYPES = Object.fromEntries((await call('u-admin', 'getHrSetup', {})).documentTypes.map(t => [t.Name, t.DocumentTypeID]));
}
const add = (doc, uid) => call(uid || 'u-admin', 'saveEmployeeDocument', { document: Object.assign({ EmployeeID: EMP }, doc) });
const list = uid => call(uid || 'u-admin', 'getEmployeeDocuments', { employeeId: EMP });
const mem = async () => (await firestore.collection('__documentStorage').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
async function pathOf(fileId) {
  const all = await mem();
  const names = [];
  let cur = all.find(x => x.id === fileId);
  while (cur) { names.unshift(cur.Name); cur = all.find(x => x.id === cur.Parent); }
  return names.join('/');
}

test.beforeEach(seed);

test('a document per type: number and expiry when the type has them; only with the sensitive right', async () => {
  await assert.rejects(add({ DocumentTypeID: TYPES.Passport, ExpiryDate: addDays(T, 300) }), /Enter the Passport number/);
  await assert.rejects(add({ DocumentTypeID: TYPES.Passport, DocNumber: 'P1' }), /Enter the Passport expiry date/);
  await assert.rejects(add({ DocumentTypeID: TYPES.Passport, DocNumber: 'P1', IssueDate: '2026-05-01', ExpiryDate: '2026-04-01' }), /expiry date is before the issue date/);
  await assert.rejects(add({ DocumentTypeID: 'nope' }), /Choose the document type/);
  const p = (await add({ DocumentTypeID: TYPES.Passport, DocNumber: 'P123', IssueDate: '2020-01-01', ExpiryDate: addDays(T, 40) })).documentId;
  await add({ DocumentTypeID: TYPES['Education Certificate'], Notes: 'B.Com' });
  const docs = (await list()).documents;
  assert.deepEqual(docs.map(d => [d.DocTypeName, d.DocNumber, d.DisplayStatus, d.DaysLeft]), [['Education Certificate', '', 'Active', null], ['Passport', 'P123', 'Expiring', 40]]);
  // The Viewer has Employees access but not the sensitive right.
  await assert.rejects(list('u-viewer'), /do not have the right to see employee documents/);
  await assert.rejects(add({ DocumentTypeID: TYPES.Passport, DocNumber: 'X', ExpiryDate: T }, 'u-viewer'), /right to see employee documents/);
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set(['Admin', 'Viewer']);
  assert.equal((await list('u-viewer')).canWrite, false);
  await assert.rejects(add({ DocumentTypeID: TYPES.Passport, DocNumber: 'X', ExpiryDate: T }, 'u-viewer'), /can view employee documents but not change them/);
  await assert.rejects(call('u-other', 'getEmployeeDocuments', { employeeId: EMP }), /do not have access to that company/);
  const h = (await call('u-admin', 'getEmployee', { employeeId: EMP })).history;
  assert.deepEqual(h.slice(0, 2).map(x => [x.Action, x.Reason]), [['Document added', 'Education Certificate'], ['Document added', 'Passport P123 (expires ' + addDays(T, 40) + ')']]);
  assert.ok(p);
});

test('files: in Employees/<no. - name>/<type>/; view with sensitive, add and remove with write too', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const p = (await add({ DocumentTypeID: TYPES.Passport, DocNumber: 'P123', ExpiryDate: addDays(T, 400) })).documentId;
  const up = await call('u-admin', 'uploadAttachment', { module: 'EMPDOCS', docId: p, fileName: 'passport.pdf', data: PDF });
  const a = (await firestore.collection('attachments').doc(up.file.AttachmentID).get()).data();
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/01 - Test Co One/Employees/EMP-0001 - Ali Hassan/Passport/P123/passport.pdf');
  await assert.rejects(call('u-viewer', 'getAttachments', { module: 'EMPDOCS', docId: p }), /right to see Employee Documents/);
  await assert.rejects(call('u-viewer', 'openAttachment', { attachmentId: up.file.AttachmentID }), /right to see Employee Documents/);
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set(['Admin', 'Viewer']);
  const v = await call('u-viewer', 'getAttachments', { module: 'EMPDOCS', docId: p });
  assert.deepEqual([v.canAdd, v.files.map(f => f.CanRemove)], [false, [false]]);
  assert.equal((await call('u-viewer', 'openAttachment', { attachmentId: up.file.AttachmentID })).data, PDF);
  await assert.rejects(call('u-viewer', 'uploadAttachment', { module: 'EMPDOCS', docId: p, fileName: 'x.pdf', data: PDF }), /view these documents but not add/);
  assert.equal((await list()).documents[0].FileCount, 1);
});

test('renew keeps the old one; remove keeps the record and moves its files; the 60-day Home task', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const old = (await add({ DocumentTypeID: TYPES.Passport, DocNumber: 'P1', ExpiryDate: addDays(T, 20) })).documentId;
  const visa = (await add({ DocumentTypeID: TYPES['Visa / Residence'], DocNumber: 'V1', ExpiryDate: addDays(T, -5) })).documentId;
  await add({ DocumentTypeID: TYPES['Emirates ID'], DocNumber: 'E1', ExpiryDate: addDays(T, 61) });
  const home = await call('u-admin', 'getEmployeeDocumentsExpiringForUser', {});
  assert.deepEqual(home.map(x => [x.EmployeeNo, x.DocTypeName, x.DaysLeft]), [['EMP-0001', 'Visa / Residence', -5], ['EMP-0001', 'Passport', 20]]);
  assert.equal(home[0].DocumentID, EMP, 'opens the employee');
  assert.deepEqual(await call('u-viewer', 'getEmployeeDocumentsExpiringForUser', {}), [], 'no task without write and sensitive');

  const r = await call('u-admin', 'renewEmployeeDocument', { documentId: old, document: { DocNumber: 'P2', IssueDate: T, ExpiryDate: addDays(T, 3650) } });
  await assert.rejects(call('u-admin', 'renewEmployeeDocument', { documentId: old, document: {} }), /Only an active document can be renewed/);
  await assert.rejects(add({ DocumentID: old, DocumentTypeID: TYPES.Passport, DocNumber: 'P1x', ExpiryDate: T }), /renewed: it can no longer be changed/);
  const docs = (await list()).documents;
  assert.deepEqual(docs.filter(d => d.DocTypeName === 'Passport').map(d => [d.DocNumber, d.Status]).sort(), [['P1', 'Superseded'], ['P2', 'Active']]);
  assert.ok(docs.find(d => d.DocumentID === r.documentId).PreviousID === old);

  await call('u-admin', 'uploadAttachment', { module: 'EMPDOCS', docId: visa, fileName: 'visa.pdf', data: PDF });
  await assert.rejects(call('u-admin', 'removeEmployeeDocument', { documentId: visa }), /Give the reason/);
  assert.equal((await call('u-admin', 'removeEmployeeDocument', { documentId: visa, reason: 'Cancelled' })).filesRemoved, 1);
  const a = (await firestore.collection('attachments').where('DocID', '==', visa).get()).docs[0].data();
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/Removed/V1 - visa.pdf');
  assert.deepEqual(await call('u-admin', 'getEmployeeDocumentsExpiringForUser', {}), [], 'renewed and removed ones are not due');
  // Someone who has left: no reminders.
  await add({ DocumentTypeID: TYPES['Labour Card'], DocNumber: 'L1', ExpiryDate: addDays(T, 10) });
  const e = (await call('u-admin', 'getEmployee', { employeeId: EMP })).employee;
  await call('u-admin', 'saveEmployee', { employee: Object.assign(e, { Status: 'Left', LeavingDate: T }) });
  assert.deepEqual(await call('u-admin', 'getEmployeeDocumentsExpiringForUser', {}), []);
});
