// Company Documents (owner, 2026-10-03; docs/modules/COMPANY_DOCUMENTS.md):
// a register of legal documents, contracts and licences per company, with
// files in the document storage (Legal Documents folder), its own
// permission (view / change), categories Admin manages, renewals, removal
// that keeps the record, vendor / customer documents, and the 30-day
// "Documents expiring" Home task.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb } = require('./_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const T = todayIn('Asia/Dubai');
const PDF = Buffer.from('%PDF-1.4\n% licence scan\n').toString('base64');

function fixture() {
  const f = baseFixture();
  f.permissions.DOCUMENTSTORAGE.access = ['Admin'];
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Gulf Retail', Status: 'Active', CompanyID: 'C1' } };
  return f;
}
const cats = async () => (await call('u-admin', 'getCompanyDocuments', {})).categories;
const catId = async name => (await cats()).find(c => c.Name === name).CategoryID;
async function create(doc, uid) {
  const r = await call(uid || 'u-admin', 'saveCompanyDocument', { document: Object.assign({ CompanyID: 'C1', CategoryID: await catId('Trade Licence'), Title: 'Trade licence' }, doc) });
  assert.equal(r.success, true);
  return r.documentId;
}
const list = async uid => (await call(uid || 'u-admin', 'getCompanyDocuments', {})).documents;
const mem = async () => (await firestore.collection('__documentStorage').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
async function pathOf(fileId) {
  const all = await mem();
  const names = [];
  let cur = all.find(x => x.id === fileId);
  while (cur) { names.unshift(cur.Name); cur = all.find(x => x.id === cur.Parent); }
  return names.join('/');
}

test.beforeEach(async () => { await reset(fixture()); });

test('categories: the nine to start with; Admin adds, renames, deactivates', async () => {
  assert.deepEqual((await cats()).map(c => c.Name), ['Trade Licence', 'Memorandum / Articles', 'VAT / Tax Registration', 'Contract',
    'Lease / Tenancy', 'Insurance', 'Bank', 'Power of Attorney', 'Other']);
  await assert.rejects(call('u-viewer', 'saveCompanyDocumentCategory', { Name: 'Visas' }), /Only Admin can change the document categories/);
  const r = await call('u-admin', 'saveCompanyDocumentCategory', { Name: 'Visas' });
  await assert.rejects(call('u-admin', 'saveCompanyDocumentCategory', { Name: 'visas' }), /already a category "visas"/);
  await call('u-admin', 'saveCompanyDocumentCategory', { CategoryID: r.categoryId, Name: 'Staff Visas', Active: false });
  const c = (await cats()).find(x => x.CategoryID === r.categoryId);
  assert.deepEqual([c.Name, c.Active], ['Staff Visas', false]);
  await assert.rejects(create({ CategoryID: r.categoryId }), /"Staff Visas" is no longer in use/);
});

test('the register: who sees and changes it, and what is checked', async () => {
  await assert.rejects(create({}, 'u-viewer'), /You can view Company Documents but not change them/);
  await assert.rejects(create({ Title: '' }), /Enter the title/);
  await assert.rejects(create({ CompanyID: 'C2' }), /do not have access to that company/);
  await assert.rejects(create({ IssueDate: '2026-05-01', ExpiryDate: '2026-04-01' }), /expiry date is before the issue date/);
  await assert.rejects(create({ ExpiryDate: '2026-02-30' }), /expiry date is not a valid date/);
  await assert.rejects(create({ PartyType: 'Vendor', PartyID: 'nope' }), /Choose the vendor/);
  await assert.rejects(create({ PartyType: 'Other' }), /Enter the party's name/);
  const id = await create({ ReferenceNo: 'TL-123', IssueDate: '2026-01-01', ExpiryDate: addDays(T, 100), PartyType: 'Other', PartyName: 'DED' });
  const v = (await list('u-viewer')).find(d => d.DocumentID === id);
  assert.deepEqual([v.Title, v.CategoryName, v.ReferenceNo, v.PartyName, v.DisplayStatus, v.FileCount], ['Trade licence', 'Trade Licence', 'TL-123', 'DED', 'Active', 0]);
  assert.equal((await call('u-viewer', 'getCompanyDocuments', {})).canWrite, false);
  assert.deepEqual(await list('u-other'), [], 'another company\'s user sees none');
  await assert.rejects(call('u-other', 'getCompanyDocument', { documentId: id }), /do not have access to that company/);
  await rtdb.ref('permissions/COMPANYDOCS/access').set(['Admin']);
  await assert.rejects(list('u-viewer'), /do not have access to Company Documents/);
  // Edit: logged with what changed; the company stays.
  await call('u-admin', 'saveCompanyDocument', { document: Object.assign(v, { ReferenceNo: 'TL-124' }) });
  await assert.rejects(call('u-admin', 'saveCompanyDocument', { document: Object.assign({}, v, { CompanyID: 'C2' }) }), /do not have access to that company/);
  const h = (await call('u-admin', 'getCompanyDocument', { documentId: id })).history;
  assert.deepEqual(h.map(x => [x.Action, x.Detail]), [['Edit', 'ReferenceNo'], ['Create', '']]);
});

test('files: in Legal Documents; only those who can change the register add or remove them', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const id = await create({ ReferenceNo: 'TL-123' });
  await assert.rejects(call('u-viewer', 'uploadAttachment', { module: 'COMPANYDOCS', docId: id, fileName: 'scan.pdf', data: PDF }), /You can view these documents but not add to them/);
  const up = await call('u-admin', 'uploadAttachment', { module: 'COMPANYDOCS', docId: id, fileName: 'scan.pdf', data: PDF });
  const a = (await firestore.collection('attachments').doc(up.file.AttachmentID).get()).data();
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/01 - Test Co One/Legal Documents/Trade Licence/Trade licence - TL-123/scan.pdf');
  const asViewer = await call('u-viewer', 'getAttachments', { module: 'COMPANYDOCS', docId: id });
  assert.deepEqual([asViewer.canAdd, asViewer.files.map(f => f.CanRemove)], [false, [false]]);
  await assert.rejects(call('u-viewer', 'removeAttachment', { attachmentId: up.file.AttachmentID }), /Only users who can change Company Documents can remove its files/);
  assert.equal((await call('u-viewer', 'openAttachment', { attachmentId: up.file.AttachmentID })).data, PDF, 'viewers open them');
  // Admin removes a file another user added (owner decision 4: whoever can change).
  await rtdb.ref('permissions/COMPANYDOCS/write').set(['Admin', 'Viewer']);
  const theirs = await call('u-viewer', 'uploadAttachment', { module: 'COMPANYDOCS', docId: id, fileName: 'annex.pdf', data: PDF });
  assert.equal((await call('u-admin', 'getAttachments', { module: 'COMPANYDOCS', docId: id })).files.find(f => f.FileName === 'annex.pdf').CanRemove, true);
  assert.equal((await call('u-admin', 'removeAttachment', { attachmentId: theirs.file.AttachmentID })).success, true);
  assert.equal((await list()).find(d => d.DocumentID === id).FileCount, 1);
});

test('expiry: Expiring within 30 days, Expired after; the Home task for those who can change them', async () => {
  const soon = await create({ Title: 'Insurance', ExpiryDate: addDays(T, 10) });
  const gone = await create({ Title: 'Lease', ExpiryDate: addDays(T, -3) });
  const later = await create({ Title: 'VAT certificate', ExpiryDate: addDays(T, 31) });
  const ended = await create({ Title: 'Old contract', ExpiryDate: addDays(T, 5) });
  const none = await create({ Title: 'MOA' });
  const ds = Object.fromEntries((await list()).map(d => [d.DocumentID, d.DisplayStatus]));
  assert.deepEqual([ds[soon], ds[gone], ds[later], ds[none]], ['Expiring', 'Expired', 'Active', 'Active']);
  const d = (await call('u-admin', 'getCompanyDocument', { documentId: ended })).document;
  await call('u-admin', 'saveCompanyDocument', { document: Object.assign(d, { Status: 'Terminated' }) });
  const tasks = await call('u-admin', 'getDocumentsExpiringForUser', {});
  assert.deepEqual(tasks.map(t => [t.Title, t.DaysLeft]), [['Lease', -3], ['Insurance', 10]]);
  assert.deepEqual(await call('u-viewer', 'getDocumentsExpiringForUser', {}), [], 'view-only users have no task');
  assert.deepEqual(await call('u-other', 'getDocumentsExpiringForUser', {}), [], 'nor other companies\' users');
});

test('renewal keeps the old record as Superseded; removal keeps the record and moves its files', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const old = await create({ ReferenceNo: 'TL-1', IssueDate: '2025-01-01', ExpiryDate: addDays(T, 5) });
  await call('u-admin', 'uploadAttachment', { module: 'COMPANYDOCS', docId: old, fileName: 'old.pdf', data: PDF });
  const r = await call('u-admin', 'renewCompanyDocument', { documentId: old, document: { ReferenceNo: 'TL-2', IssueDate: T, ExpiryDate: addDays(T, 365) } });
  await assert.rejects(call('u-admin', 'renewCompanyDocument', { documentId: old, document: {} }), /Only an active or terminated document can be renewed/);
  const n = await call('u-admin', 'getCompanyDocument', { documentId: r.documentId });
  assert.deepEqual([n.document.ReferenceNo, n.document.Title, n.document.DisplayStatus, n.document.PreviousID], ['TL-2', 'Trade licence', 'Active', old]);
  assert.deepEqual(n.versions.map(v => [v.ReferenceNo, v.Status, v.Earlier]), [['TL-1', 'Superseded', true]]);
  await assert.rejects(call('u-admin', 'saveCompanyDocument', { document: Object.assign({}, n.versions[0], { DocumentID: old, CompanyID: 'C1', CategoryID: n.document.CategoryID }) }), /superseded: it can no longer be changed/);
  assert.deepEqual((await call('u-admin', 'getDocumentsExpiringForUser', {})).map(t => t.Title), [], 'the renewed one is no longer expiring');

  await assert.rejects(call('u-admin', 'removeCompanyDocument', { documentId: old }), /Give the reason/);
  await assert.rejects(call('u-viewer', 'removeCompanyDocument', { documentId: old, reason: 'x' }), /not change them/);
  const rm = await call('u-admin', 'removeCompanyDocument', { documentId: old, reason: 'Scanned twice' });
  assert.equal(rm.filesRemoved, 1);
  const after = (await call('u-admin', 'getCompanyDocument', { documentId: old })).document;
  assert.deepEqual([after.Status, after.RemoveReason, after.StatusBeforeRemoval], ['Removed', 'Scanned twice', 'Superseded']);
  const a = (await firestore.collection('attachments').where('DocID', '==', old).get()).docs[0].data();
  assert.equal(a.Removed, true);
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/Removed/Trade licence - TL-1 - old.pdf', 'moved, not deleted');
  await assert.rejects(call('u-admin', 'uploadAttachment', { module: 'COMPANYDOCS', docId: old, fileName: 'x.pdf', data: PDF }), /This record was removed/);
});

test('vendor and customer documents: linked, checked, counted for their masters', async () => {
  const v = await create({ Title: 'Supply contract', CategoryID: await catId('Contract'), PartyType: 'Vendor', PartyID: 'V1' });
  await create({ Title: 'Distribution agreement', CategoryID: await catId('Contract'), PartyType: 'Customer', PartyID: 'CU1' });
  const gone = await create({ Title: 'Vendor licence', PartyType: 'Vendor', PartyID: 'V1' });
  await call('u-admin', 'removeCompanyDocument', { documentId: gone, reason: 'Wrong vendor' });
  const d = (await list()).find(x => x.DocumentID === v);
  assert.deepEqual([d.PartyName, d.PartyCode], ['Acme Metals', 'V001']);
  assert.deepEqual(await call('u-viewer', 'getPartyDocumentCounts', { partyType: 'Vendor' }), { access: true, counts: { V1: 1 } }, 'the removed one is not counted');
  assert.deepEqual(await call('u-viewer', 'getPartyDocumentCounts', { partyType: 'Customer' }), { access: true, counts: { CU1: 1 } });
  assert.deepEqual(await call('u-viewer', 'getPartyDocumentCounts', { partyType: 'Company' }), { access: true, counts: { C1: 2 } });
  await rtdb.ref('permissions/COMPANYDOCS/access').set(['Admin']);
  assert.deepEqual(await call('u-viewer', 'getPartyDocumentCounts', { partyType: 'Vendor' }), { access: false, counts: {} }, 'no access: no link');
  await rtdb.ref('vendors/V2').set({ VendorCode: 'V002', VendorName: 'Other Co Vendor', Status: 'Active', CompanyID: 'C2' });
  await assert.rejects(create({ PartyType: 'Vendor', PartyID: 'V2' }), /That vendor belongs to another company/);
});
