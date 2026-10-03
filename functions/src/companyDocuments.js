// Company Documents: legal documents, contracts, licences (owner,
// 2026-10-03; docs/modules/COMPANY_DOCUMENTS.md). A register of records
// per company (category, reference, party, dates); their files are kept
// in the connected document storage through attachments.js (module
// COMPANYDOCS), in <company>/Legal Documents/<category>/<title - reference>.
// Owner decisions:
//   1. its own permission (access to view, write to add and change), plus
//      company access;
//   2. nine starting categories; Admin adds, renames, deactivates more;
//   3. a "Documents expiring" Home task 30 days ahead (and once expired),
//      for the users who can change the register;
//   4. users who can change it remove records and files: files move to
//      Removed in the storage, the record stays as Removed;
//   5. vendor / customer documents in the same register (Party), counted
//      on the Vendor / Customer Master.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn, addDays } = require('./recurringSchedule');
const attachments = require('./attachments');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'COMPANYDOCS';
const REMIND_DAYS = 30;
const DOCS = () => firestore.collection('companyDocuments');
const CATEGORIES = () => firestore.collection('companyDocumentCategories');
const LOG = () => firestore.collection('companyDocumentLog');
const STATUSES = ['Active', 'Terminated'];
const PARTY_TYPES = ['', 'Vendor', 'Customer', 'Other'];
const START_CATEGORIES = ['Trade Licence', 'Memorandum / Articles', 'VAT / Tax Registration', 'Contract', 'Lease / Tenancy',
  'Insurance', 'Bank', 'Power of Attorney', 'Other'];

const today = () => todayIn('Asia/Dubai');
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
// A real calendar date (2026-02-30 is not: Date would roll it to 2 March).
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

async function can(user, cap) { return moduleHasCapability(MODULE_ID, cap, user.profile.role); }
async function requireAccess(user) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Company Documents.');
}
async function requireWrite(user) {
  await requireAccess(user);
  if (!(await can(user, 'write'))) throw new HttpsError('permission-denied', 'You can view Company Documents but not change them.');
}

// What the list shows: Active records by their expiry date.
function displayStatus(d, asOf) {
  if (d.Status !== 'Active') return d.Status;
  if (d.ExpiryDate && d.ExpiryDate < asOf) return 'Expired';
  if (d.ExpiryDate && d.ExpiryDate <= addDays(asOf, REMIND_DAYS)) return 'Expiring';
  return 'Active';
}
function daysLeft(expiry, asOf) {
  return Math.round((new Date(expiry + 'T00:00:00Z') - new Date(asOf + 'T00:00:00Z')) / 86400000);
}

async function log(action, id, d, user, detail) {
  await LOG().add({ Action: action, DocumentID: id, CompanyID: d.CompanyID || '', Title: d.Title || '', Detail: detail || '',
    By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
}

// ---------- categories ----------

async function categories() {
  let snap = await CATEGORIES().get();
  if (snap.empty) {
    const batch = firestore.batch();
    START_CATEGORIES.forEach((name, i) => batch.set(CATEGORIES().doc('cat-' + String(i + 1).padStart(2, '0')), { Name: name, Active: true, Sort: i + 1 }));
    await batch.commit();
    snap = await CATEGORIES().get();
  }
  return snap.docs.map(d => Object.assign({ CategoryID: d.id }, d.data()))
    .sort((a, b) => (a.Sort || 999) - (b.Sort || 999) || String(a.Name).localeCompare(String(b.Name)));
}

exports.saveCompanyDocumentCategory = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await attachments.isStorageAdmin(user))) throw new HttpsError('permission-denied', 'Only Admin can change the document categories.');
  const d = request.data || {};
  const name = text(d.Name, 80);
  if (!name) throw new HttpsError('invalid-argument', 'Enter the category name.');
  const all = await categories();
  if (all.some(c => c.CategoryID !== d.CategoryID && c.Name.toLowerCase() === name.toLowerCase())) {
    throw new HttpsError('already-exists', 'There is already a category "' + name + '".');
  }
  const active = d.Active !== false;
  if (d.CategoryID) {
    const cur = all.find(c => c.CategoryID === d.CategoryID);
    if (!cur) throw new HttpsError('not-found', 'Category not found.');
    await CATEGORIES().doc(cur.CategoryID).update({ Name: name, Active: active });
    return { success: true, categoryId: cur.CategoryID };
  }
  const ref = await CATEGORIES().add({ Name: name, Active: active, Sort: all.length + 1 });
  return { success: true, categoryId: ref.id };
});

// ---------- the register ----------

async function partyName(type, id) {
  if (type !== 'Vendor' && type !== 'Customer') return null;
  const p = (await rtdb.ref((type === 'Vendor' ? 'vendors/' : 'customers/') + id).get()).val();
  if (!p) return null;
  return { name: (type === 'Vendor' ? p.VendorName : p.CustomerName) || '', code: (type === 'Vendor' ? p.VendorCode : p.CustomerCode) || '', companyId: p.CompanyID || '' };
}

// The fields a user may set, checked. `existing` is the record being edited.
async function cleanFields(user, input, existing) {
  const d = input || {};
  const out = {
    CompanyID: text(d.CompanyID, 80), CategoryID: text(d.CategoryID, 80), Title: text(d.Title, 150), ReferenceNo: text(d.ReferenceNo, 80),
    PartyType: text(d.PartyType, 20), PartyID: text(d.PartyID, 80), PartyName: text(d.PartyName, 150),
    IssueDate: text(d.IssueDate, 10), ExpiryDate: text(d.ExpiryDate, 10), Notes: text(d.Notes, 2000)
  };
  if (!out.CompanyID) throw new HttpsError('invalid-argument', 'Choose the company.');
  if (!userCanAccessCompany(user.profile, out.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + out.CompanyID).get()).exists()) throw new HttpsError('invalid-argument', 'Company not found.');
  const cat = (await categories()).find(c => c.CategoryID === out.CategoryID);
  if (!cat) throw new HttpsError('invalid-argument', 'Choose the category.');
  if (!cat.Active && !(existing && existing.CategoryID === cat.CategoryID)) throw new HttpsError('invalid-argument', 'The category "' + cat.Name + '" is no longer in use.');
  out.CategoryName = cat.Name;
  if (!out.Title) throw new HttpsError('invalid-argument', 'Enter the title.');
  for (const f of ['IssueDate', 'ExpiryDate']) if (out[f] && !isDate(out[f])) throw new HttpsError('invalid-argument', 'The ' + (f === 'IssueDate' ? 'issue' : 'expiry') + ' date is not a valid date.');
  if (out.IssueDate && out.ExpiryDate && out.ExpiryDate < out.IssueDate) throw new HttpsError('invalid-argument', 'The expiry date is before the issue date.');
  if (!PARTY_TYPES.includes(out.PartyType)) throw new HttpsError('invalid-argument', 'Unknown party type.');
  if (out.PartyType === 'Vendor' || out.PartyType === 'Customer') {
    const p = await partyName(out.PartyType, out.PartyID);
    if (!p) throw new HttpsError('invalid-argument', 'Choose the ' + out.PartyType.toLowerCase() + '.');
    if (p.companyId && p.companyId !== out.CompanyID) throw new HttpsError('invalid-argument', 'That ' + out.PartyType.toLowerCase() + ' belongs to another company.');
    out.PartyName = p.name; out.PartyCode = p.code;
  } else {
    out.PartyID = ''; out.PartyCode = '';
    if (out.PartyType === 'Other' && !out.PartyName) throw new HttpsError('invalid-argument', 'Enter the party\'s name.');
    if (!out.PartyType) out.PartyName = '';
  }
  return out;
}

async function loadDoc(user, id) {
  const snap = await DOCS().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Document not found.');
  const d = snap.data();
  if (!userCanAccessCompany(user.profile, d.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return { ref: snap.ref, d };
}

exports.getCompanyDocuments = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const asOf = today();
  const [snap, cats, counts] = await Promise.all([DOCS().get(), categories(), attachments.fileCounts(MODULE_ID)]);
  const documents = snap.docs.map(doc => Object.assign({ DocumentID: doc.id }, doc.data()))
    .filter(d => userCanAccessCompany(user.profile, d.CompanyID))
    .map(d => Object.assign(d, { DisplayStatus: displayStatus(d, asOf), DaysLeft: d.ExpiryDate ? daysLeft(d.ExpiryDate, asOf) : null, FileCount: counts[d.DocumentID] || 0 }))
    .sort((a, b) => String(a.CompanyID).localeCompare(String(b.CompanyID)) || String(a.CategoryName).localeCompare(String(b.CategoryName)) || String(a.Title).localeCompare(String(b.Title)));
  return { documents, categories: cats, canWrite: await can(user, 'write'), canEditCategories: await attachments.isStorageAdmin(user), today: asOf, remindDays: REMIND_DAYS };
});

exports.getCompanyDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const { ref, d } = await loadDoc(user, (request.data || {}).documentId);
  const asOf = today();
  // The renewal chain: earlier and later versions of this document.
  const versions = [];
  const seen = new Set([ref.id]);
  for (const dir of ['PreviousID', 'NextID']) {
    let id = d[dir];
    while (id && !seen.has(id) && versions.length < 50) {
      seen.add(id);
      const s = await DOCS().doc(id).get();
      if (!s.exists) break;
      const v = s.data();
      versions.push({ DocumentID: id, Title: v.Title, ReferenceNo: v.ReferenceNo || '', IssueDate: v.IssueDate || '', ExpiryDate: v.ExpiryDate || '', Status: v.Status, Earlier: dir === 'PreviousID' });
      id = v[dir];
    }
  }
  const logSnap = await LOG().where('DocumentID', '==', ref.id).get();
  const history = logSnap.docs.map(x => x.data()).sort((a, b) => String(b.At).localeCompare(String(a.At)));
  return { document: Object.assign({ DocumentID: ref.id }, d, { DisplayStatus: displayStatus(d, asOf), DaysLeft: d.ExpiryDate ? daysLeft(d.ExpiryDate, asOf) : null }), versions, history, canWrite: await can(user, 'write') };
});

exports.saveCompanyDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const input = (request.data || {}).document || {};
  const now = new Date().toISOString();
  if (input.DocumentID) {
    const { ref, d } = await loadDoc(user, input.DocumentID);
    if (d.Status === 'Removed' || d.Status === 'Superseded') throw new HttpsError('failed-precondition', 'This document is ' + d.Status.toLowerCase() + ': it can no longer be changed.');
    const fields = await cleanFields(user, input, d);
    const status = text(input.Status, 20) || d.Status;
    if (!STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Unknown status.');
    if (fields.CompanyID !== d.CompanyID) throw new HttpsError('invalid-argument', 'The company of a saved document can\'t be changed.');
    const changed = Object.keys(fields).filter(k => String(fields[k] || '') !== String(d[k] || ''));
    if (status !== d.Status) changed.push('Status');
    await ref.update(Object.assign(fields, { Status: status, UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) }));
    await log(status !== d.Status && status === 'Terminated' ? 'Terminate' : 'Edit', ref.id, fields, user, changed.join(', '));
    return { success: true, documentId: ref.id };
  }
  const fields = await cleanFields(user, input, null);
  const ref = await DOCS().add(Object.assign(fields, { Status: 'Active', PreviousID: '', NextID: '',
    CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
  await log('Create', ref.id, fields, user);
  return { success: true, documentId: ref.id };
});

// Renewal: a new record with the new dates (its own files); the old one
// becomes Superseded and stays for history.
exports.renewCompanyDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const data = request.data || {};
  const { ref, d } = await loadDoc(user, data.documentId);
  if (d.Status !== 'Active' && d.Status !== 'Terminated') throw new HttpsError('failed-precondition', 'Only an active or terminated document can be renewed.');
  const input = Object.assign({}, d, data.document || {}, { CompanyID: d.CompanyID });
  const fields = await cleanFields(user, input, d);
  const now = new Date().toISOString();
  const newRef = DOCS().doc();
  await firestore.runTransaction(async tx => {
    const cur = await tx.get(ref);
    if (cur.data().NextID) throw new HttpsError('failed-precondition', 'This document has already been renewed.');
    tx.set(newRef, Object.assign(fields, { Status: 'Active', PreviousID: ref.id, NextID: '', CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user) }));
    tx.update(ref, { Status: 'Superseded', NextID: newRef.id, UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) });
  });
  await log('Renew', ref.id, d, user, 'Renewed as a new record');
  await log('Create', newRef.id, fields, user, 'Renewal of an earlier record');
  return { success: true, documentId: newRef.id };
});

// Removing: its files move to Removed in the storage; the record stays,
// as Removed (owner decision 4).
exports.removeCompanyDocument = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const data = request.data || {};
  const { ref, d } = await loadDoc(user, data.documentId);
  if (d.Status === 'Removed') throw new HttpsError('failed-precondition', 'This document was already removed.');
  const reason = text(data.reason, 300);
  if (!reason) throw new HttpsError('invalid-argument', 'Give the reason for removing it.');
  const number = [d.Title, d.ReferenceNo].filter(Boolean).join(' - ');
  const files = await attachments.removeAllFiles(MODULE_ID, ref.id, number, user);
  await ref.update({ Status: 'Removed', StatusBeforeRemoval: d.Status, RemovedAt: new Date().toISOString(), RemovedBy: user.uid, RemovedByName: actorName(user), RemoveReason: reason });
  await log('Remove', ref.id, d, user, reason + (files ? ' (' + files + (files === 1 ? ' file' : ' files') + ' moved to Removed)' : ''));
  return { success: true, filesRemoved: files };
});

// "Documents (n)" on the Company, Vendor and Customer Master: current
// documents (not renewed or removed) per company or per party. access:false
// for users who can't open Company Documents (no link shown).
exports.getPartyDocumentCounts = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await can(user, 'access'))) return { access: false, counts: {} };
  const type = text((request.data || {}).partyType, 20);
  if (type !== 'Vendor' && type !== 'Customer' && type !== 'Company') return { access: true, counts: {} };
  const snap = type === 'Company' ? await DOCS().get() : await DOCS().where('PartyType', '==', type).get();
  const counts = {};
  snap.docs.forEach(doc => {
    const x = doc.data();
    if (x.Status === 'Removed' || x.Status === 'Superseded' || !userCanAccessCompany(user.profile, x.CompanyID)) return;
    const key = type === 'Company' ? x.CompanyID : x.PartyID;
    counts[key] = (counts[key] || 0) + 1;
  });
  return { access: true, counts };
});

// The Home task: expiring within 30 days, or expired, for the users who can
// change the register (owner decision 3).
exports.getDocumentsExpiringForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await can(user, 'access')) || !(await can(user, 'write'))) return [];
  const asOf = today();
  const until = addDays(asOf, REMIND_DAYS);
  const snap = await DOCS().where('Status', '==', 'Active').get();
  return snap.docs.map(doc => Object.assign({ DocumentID: doc.id }, doc.data()))
    .filter(d => d.ExpiryDate && d.ExpiryDate <= until && userCanAccessCompany(user.profile, d.CompanyID))
    .map(d => ({ ModuleID: MODULE_ID, DocumentID: d.DocumentID, Title: d.Title, ReferenceNo: d.ReferenceNo || '', CategoryName: d.CategoryName || '',
      CompanyID: d.CompanyID, PartyName: d.PartyName || '', ExpiryDate: d.ExpiryDate, DaysLeft: daysLeft(d.ExpiryDate, asOf) }))
    .sort((a, b) => a.ExpiryDate.localeCompare(b.ExpiryDate) || a.Title.localeCompare(b.Title));
});

module.exports._displayStatus = displayStatus; // for the tests
