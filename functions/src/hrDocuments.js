// HR: employee documents (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md,
// step 2). Passport, Emirates ID, visa, labour card, certificates,
// contract...: a record per document (type, number, issue and expiry
// dates) with its files in the document storage (attachments.js, EMPDOCS:
// <company>/Employees/<no. - name>/<type>/...).
// Owner decisions used here:
//   6  a "Employee documents expiring" Home task 60 days ahead (and once
//      expired), for the users who can change employee records;
//   7  seeing documents needs the Employees "sensitive" right; adding,
//      renewing and removing them "write" too.
// As for Company Documents: Renew makes a new record and keeps the old one
// (Superseded); Remove moves the files to Removed and keeps the record.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn, addDays } = require('./recurringSchedule');
const { loadSetup } = require('./hrSetup');
const attachments = require('./attachments');

const onCallOptions = { region: 'us-central1' };
const SOURCE = 'EMPDOCS';
const REMIND_DAYS = 60;
const DOCS = () => firestore.collection('employeeDocuments');
const EMPLOYEES = () => firestore.collection('employees');
const HISTORY = () => firestore.collection('employeeHistory');

const today = () => todayIn('Asia/Dubai');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const daysLeft = (expiry, asOf) => Math.round((new Date(expiry + 'T00:00:00Z') - new Date(asOf + 'T00:00:00Z')) / 86400000);
function displayStatus(d, asOf) {
  if (d.Status !== 'Active') return d.Status;
  if (d.ExpiryDate && d.ExpiryDate < asOf) return 'Expired';
  if (d.ExpiryDate && d.ExpiryDate <= addDays(asOf, REMIND_DAYS)) return 'Expiring';
  return 'Active';
}

const can = (user, cap) => moduleHasCapability('EMPLOYEES', cap, user.profile.role);
async function requireSee(user) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Employees.');
  if (!(await can(user, 'sensitive'))) throw new HttpsError('permission-denied', 'You do not have the right to see employee documents.');
}
async function requireChange(user) {
  await requireSee(user);
  if (!(await can(user, 'write'))) throw new HttpsError('permission-denied', 'You can view employee documents but not change them.');
}
async function loadEmployee(user, id) {
  const snap = await EMPLOYEES().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Employee not found.');
  const e = snap.data();
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return Object.assign({ EmployeeID: snap.id }, e);
}
async function loadDoc(user, id) {
  const snap = await DOCS().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Document not found.');
  const d = snap.data();
  await loadEmployee(user, d.EmployeeID);
  return { ref: snap.ref, d };
}
async function log(employeeId, action, detail, user) {
  await HISTORY().add({ EmployeeID: employeeId, Action: action, Changes: [], Reason: detail || '', By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
}
const describe = d => [d.DocTypeName, d.DocNumber].filter(Boolean).join(' ') + (d.ExpiryDate ? ' (expires ' + d.ExpiryDate + ')' : '');

// The fields of a document, checked against its type.
async function clean(input, existing) {
  const d = input || {};
  const types = (await loadSetup()).documentTypes;
  const t = types.find(x => x.DocumentTypeID === text(d.DocumentTypeID, 80));
  if (!t) throw new HttpsError('invalid-argument', 'Choose the document type.');
  if (t.Active === false && !(existing && existing.DocumentTypeID === t.DocumentTypeID)) throw new HttpsError('invalid-argument', 'The document type "' + t.Name + '" is no longer in use.');
  const out = { DocumentTypeID: t.DocumentTypeID, DocTypeName: t.Name, DocNumber: text(d.DocNumber, 60), IssueDate: text(d.IssueDate, 10), ExpiryDate: text(d.ExpiryDate, 10), Notes: text(d.Notes, 1000) };
  if (t.HasNumber && !out.DocNumber) throw new HttpsError('invalid-argument', 'Enter the ' + t.Name + ' number.');
  if (t.HasExpiry && !out.ExpiryDate) throw new HttpsError('invalid-argument', 'Enter the ' + t.Name + ' expiry date.');
  for (const f of ['IssueDate', 'ExpiryDate']) if (out[f] && !isDate(out[f])) throw new HttpsError('invalid-argument', 'The ' + (f === 'IssueDate' ? 'issue' : 'expiry') + ' date is not a valid date.');
  if (out.IssueDate && out.ExpiryDate && out.ExpiryDate < out.IssueDate) throw new HttpsError('invalid-argument', 'The expiry date is before the issue date.');
  return out;
}

exports.getEmployeeDocuments = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSee(user);
  const emp = await loadEmployee(user, (request.data || {}).employeeId);
  const asOf = today();
  const [snap, counts, setup] = await Promise.all([DOCS().where('EmployeeID', '==', emp.EmployeeID).get(), attachments.fileCounts(SOURCE), loadSetup()]);
  const documents = snap.docs.map(x => Object.assign({ DocumentID: x.id }, x.data()))
    .map(d => Object.assign(d, { DisplayStatus: displayStatus(d, asOf), DaysLeft: d.ExpiryDate ? daysLeft(d.ExpiryDate, asOf) : null, FileCount: counts[d.DocumentID] || 0 }))
    .sort((a, b) => String(a.DocTypeName).localeCompare(String(b.DocTypeName)) || String(b.ExpiryDate || b.CreatedAt).localeCompare(String(a.ExpiryDate || a.CreatedAt)));
  return { documents, documentTypes: setup.documentTypes, canWrite: await can(user, 'write'), remindDays: REMIND_DAYS };
});

exports.saveEmployeeDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireChange(user);
  const input = (request.data || {}).document || {};
  const now = new Date().toISOString();
  if (input.DocumentID) {
    const { ref, d } = await loadDoc(user, input.DocumentID);
    if (d.Status !== 'Active') throw new HttpsError('failed-precondition', 'This document is ' + (d.Status === 'Superseded' ? 'renewed' : 'removed') + ': it can no longer be changed.');
    const fields = await clean(input, d);
    await ref.update(Object.assign(fields, { UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) }));
    await log(d.EmployeeID, 'Document changed', describe(fields), user);
    return { success: true, documentId: ref.id };
  }
  const emp = await loadEmployee(user, input.EmployeeID);
  const fields = await clean(input, null);
  const ref = await DOCS().add(Object.assign(fields, { EmployeeID: emp.EmployeeID, CompanyID: emp.CompanyID, Status: 'Active', PreviousID: '', NextID: '',
    CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
  await log(emp.EmployeeID, 'Document added', describe(fields), user);
  return { success: true, documentId: ref.id };
});

// A new passport / visa...: a new record, the old one kept as Superseded.
exports.renewEmployeeDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireChange(user);
  const data = request.data || {};
  const { ref, d } = await loadDoc(user, data.documentId);
  if (d.Status !== 'Active') throw new HttpsError('failed-precondition', 'Only an active document can be renewed.');
  const fields = await clean(Object.assign({ DocumentTypeID: d.DocumentTypeID }, data.document || {}), d);
  const now = new Date().toISOString();
  const newRef = DOCS().doc();
  await firestore.runTransaction(async tx => {
    const cur = await tx.get(ref);
    if (cur.data().NextID) throw new HttpsError('failed-precondition', 'This document has already been renewed.');
    tx.set(newRef, Object.assign(fields, { EmployeeID: d.EmployeeID, CompanyID: d.CompanyID, Status: 'Active', PreviousID: ref.id, NextID: '',
      CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
    tx.update(ref, { Status: 'Superseded', NextID: newRef.id, UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) });
  });
  await log(d.EmployeeID, 'Document renewed', describe(d) + ' → ' + describe(fields), user);
  return { success: true, documentId: newRef.id };
});

exports.removeEmployeeDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireChange(user);
  const data = request.data || {};
  const { ref, d } = await loadDoc(user, data.documentId);
  if (d.Status === 'Removed') throw new HttpsError('failed-precondition', 'This document was already removed.');
  const reason = text(data.reason, 300);
  if (!reason) throw new HttpsError('invalid-argument', 'Give the reason for removing it.');
  const files = await attachments.removeAllFiles(SOURCE, ref.id, d.DocNumber || d.DocTypeName, user);
  await ref.update({ Status: 'Removed', StatusBeforeRemoval: d.Status, RemovedAt: new Date().toISOString(), RemovedBy: user.uid, RemovedByName: actorName(user), RemoveReason: reason });
  await log(d.EmployeeID, 'Document removed', describe(d) + ': ' + reason + (files ? ' (' + files + (files === 1 ? ' file' : ' files') + ' moved to Removed)' : ''), user);
  return { success: true, filesRemoved: files };
});

// The Home task (owner decision 6): documents of current employees expiring
// within 60 days, or expired, for users who can change employee records
// (and see their documents).
exports.getEmployeeDocumentsExpiringForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const [a, w, s] = await Promise.all([can(user, 'access'), can(user, 'write'), can(user, 'sensitive')]);
  if (!a || !w || !s) return [];
  const asOf = today();
  const until = addDays(asOf, REMIND_DAYS);
  const [docs, emps] = await Promise.all([DOCS().where('Status', '==', 'Active').get(), EMPLOYEES().get()]);
  const byId = Object.fromEntries(emps.docs.map(x => [x.id, x.data()]));
  return docs.docs.map(x => Object.assign({ DocumentID: x.id }, x.data()))
    .filter(d => d.ExpiryDate && d.ExpiryDate <= until && byId[d.EmployeeID] && byId[d.EmployeeID].Status !== 'Left' && userCanAccessCompany(user.profile, d.CompanyID))
    .map(d => ({ ModuleID: 'EMPLOYEES', DocumentID: d.EmployeeID, EmployeeDocumentID: d.DocumentID, EmployeeNo: byId[d.EmployeeID].EmployeeNo,
      EmployeeName: byId[d.EmployeeID].FullName, DocTypeName: d.DocTypeName, ExpiryDate: d.ExpiryDate, DaysLeft: daysLeft(d.ExpiryDate, asOf) }))
    .sort((x, y) => x.ExpiryDate.localeCompare(y.ExpiryDate) || x.EmployeeName.localeCompare(y.EmployeeName));
});
