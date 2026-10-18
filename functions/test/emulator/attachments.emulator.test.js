// Supporting documents on entries (owner, 2026-10-03; docs/modules/ATTACHMENTS.md),
// against the emulator stand-in for Google Drive: anyone who can open the
// entry lists, adds and opens its documents; files are checked (type by
// name and content, 10 MB); folders company / year / voucher type /
// number, a draft's folder moved there once numbered; removal by the
// uploader before posting, Admin only after, into Removed; the storage
// screen is Admin only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb, put } = require('./_helpers');

test.after(async () => { await app.delete(); });

const D = '2026-09-10';
const PDF = Buffer.from('%PDF-1.4\n% test document\n').toString('base64');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('rest of image')]).toString('base64');
const XLSX = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('zip body')]).toString('base64');

function fixture() {
  const f = baseFixture();
  f.permissions.DOCUMENTSTORAGE.access = ['Admin'];
  return f;
}
const jvDraft = async () => {
  const r = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Bank charges', CompanyID: 'C1', CurrencyCode: 'AED',
    Lines: [{ AccountCode: '1100', Debit: 0, Credit: 50, Description: 'x' }, { AccountCode: '1000', Debit: 50, Credit: 0, Description: 'x' }] } });
  assert.equal(r.success, true, r.error);
  return r.jvId;
};
const upload = (uid, module, docId, fileName, data) => call(uid, 'uploadAttachment', { module, docId, fileName, data });
const list = (uid, module, docId) => call(uid, 'getAttachments', { module, docId });
const mem = async () => (await firestore.collection('__documentStorage').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
async function pathOf(fileId) {
  const all = await mem();
  const names = [];
  let cur = all.find(x => x.id === fileId);
  while (cur) { names.unshift(cur.Name); cur = all.find(x => x.id === cur.Parent); }
  return names.join('/');
}

test.beforeEach(async () => { await reset(fixture()); });

test('not connected: a clear message; the storage set-up is Admin only', async () => {
  const jv = await jvDraft();
  await assert.rejects(upload('u-admin', 'JV', jv, 'a.pdf', PDF), /Document storage is not connected yet\. Admin: connect Google Drive in Document Storage\./);
  await assert.rejects(call('u-viewer', 'getDocumentStorage', {}), /Only Admin can manage the document storage/);
  await assert.rejects(call('u-viewer', 'useTestDocumentStorage', {}), /Only Admin/);
  await assert.rejects(call('u-admin', 'saveDocumentStorageClient', { clientId: 'abc', clientSecret: 's' }), /ends with \.apps\.googleusercontent\.com/);
  assert.equal((await call('u-admin', 'saveDocumentStorageClient', { clientId: '123-x.apps.googleusercontent.com', clientSecret: 'shh' })).success, true);
  const s = await call('u-admin', 'getDocumentStorage', {});
  assert.deepEqual([s.clientId, s.hasClientSecret, s.connected], ['123-x.apps.googleusercontent.com', true, false]);
  assert.equal(JSON.stringify(s).includes('shh'), false, 'the secret never leaves the server');
  const url = new URL((await call('u-admin', 'startDriveConnect', {})).url);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(['client_id', 'scope', 'access_type', 'redirect_uri'].map(k => url.searchParams.get(k)),
    ['123-x.apps.googleusercontent.com', 'https://www.googleapis.com/auth/drive.file', 'offline', s.redirectUri]);
  assert.ok(url.searchParams.get('state'));
  // A different OAuth client drops the old connection (its token belongs to the old client).
  await firestore.collection('settings').doc('documentStorage').set({ RefreshToken: 'rt', RootFolderID: 'root' }, { merge: true });
  await call('u-admin', 'saveDocumentStorageClient', { clientId: '123-x.apps.googleusercontent.com', clientSecret: '' });
  assert.equal((await call('u-admin', 'getDocumentStorage', {})).connected, true, 'the same client keeps it');
  await call('u-admin', 'saveDocumentStorageClient', { clientId: '456-y.apps.googleusercontent.com', clientSecret: '' });
  assert.equal((await call('u-admin', 'getDocumentStorage', {})).connected, false, 'a new client must connect again');
});

test('anyone who can open the entry adds, lists and opens documents; the files are checked', async () => {
  assert.equal((await call('u-admin', 'useTestDocumentStorage', {})).success, true);
  const jv = await jvDraft();
  const up = await upload('u-viewer', 'JV', jv, 'invoice scan.pdf', PDF);
  assert.equal(up.success, true);
  assert.equal(up.file.UploadedByName, 'Viewer');
  await upload('u-admin', 'JV', jv, 'calc.xlsx', XLSX);
  const l = await list('u-viewer', 'JV', jv);
  assert.equal(l.posted, false);
  assert.deepEqual(l.files.map(f => [f.FileName, f.Size, f.CanRemove]), [['invoice scan.pdf', 25, true], ['calc.xlsx', 12, false]]);
  const o = await call('u-viewer', 'openAttachment', { attachmentId: up.file.AttachmentID });
  assert.deepEqual([o.fileName, o.mimeType, o.data], ['invoice scan.pdf', 'application/pdf', PDF]);
  assert.deepEqual(await call('u-viewer', 'getAttachmentCounts', { module: 'JV', docIds: [jv, 'nope'] }), { [jv]: 2 });
  // A draft's files wait in Drafts.
  const a = (await firestore.collection('attachments').doc(up.file.AttachmentID).get()).data();
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/Drafts/Journal Entry Processing (JV) - ' + jv + '/invoice scan.pdf');
  // Checks: the type by name and by content, the size, empty files.
  await assert.rejects(upload('u-viewer', 'JV', jv, 'tool.exe', PDF), /only PDF, Word \(\.doc, \.docx\), Excel \(\.xls, \.xlsx, \.csv\) and images/);
  await assert.rejects(upload('u-viewer', 'JV', jv, 'fake.pdf', PNG), /"fake\.pdf" is not really a \.pdf file/);
  await assert.rejects(upload('u-viewer', 'JV', jv, 'empty.pdf', ''), /"empty\.pdf" is empty/);
  const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10 * 1024 * 1024 - 3)]).toString('base64');
  await assert.rejects(upload('u-viewer', 'JV', jv, 'big.pdf', big), /"big\.pdf" is 10\.0 MB; the limit is 10 MB per file/);
  assert.equal((await upload('u-viewer', 'JV', jv, 'photo.PNG', PNG)).success, true);
});

test('who may see them: company, module access, the entry\'s own visibility rule', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const jv = await jvDraft();
  await assert.rejects(list('u-other', 'JV', jv), /do not have access to that company/);
  await assert.rejects(upload('u-other', 'JV', jv, 'a.pdf', PDF), /do not have access to that company/);
  await assert.rejects(list('u-viewer', 'CBT', jv), /Entry not found/, 'a JV is not a CBT entry');
  await assert.rejects(list('u-viewer', 'JV', 'missing'), /Entry not found/);
  await assert.rejects(list('u-viewer', 'NOTAMODULE', jv), /can't be attached to this kind of entry/);
  await rtdb.ref('permissions/JV/access').set(['Admin']);
  await assert.rejects(list('u-viewer', 'JV', jv), /do not have access to Journal Entry Processing \(JV\)/);
  // Purchase Requisition: a draft is seen only by its raiser (and Admins).
  await put('purchaseRequisitions/PR1', { PRNumber: '', Status: 'Draft', CompanyID: 'C1', RequestedBy: 'admin', RequestedByUID: 'u-admin', PRDate: D, Lines: [] });
  assert.equal((await list('u-admin', 'PURCHASEREQUISITION', 'PR1')).files.length, 0);
  await assert.rejects(list('u-viewer', 'PURCHASEREQUISITION', 'PR1'), /do not have access to this entry/);
});

test('posting moves the folder to company / year / voucher type / number; removal: uploader before, Admin only after', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const jv = await jvDraft();
  const mine = (await upload('u-viewer', 'JV', jv, 'mine.pdf', PDF)).file;
  const gone = (await upload('u-viewer', 'JV', jv, 'gone.pdf', PDF)).file;
  const theirs = (await upload('u-admin', 'JV', jv, 'theirs.pdf', PDF)).file;
  await assert.rejects(call('u-viewer', 'removeAttachment', { attachmentId: theirs.AttachmentID }), /Only the person who added this document, or Admin, can remove it/);
  assert.equal((await call('u-viewer', 'removeAttachment', { attachmentId: gone.AttachmentID })).success, true);

  const p = await call('u-admin', 'postJournalEntry', { jvId: jv });
  assert.equal(p.success, true, p.error);
  const l = await list('u-viewer', 'JV', jv);
  assert.equal(l.posted, true);
  assert.deepEqual(l.files.map(f => [f.FileName, f.CanRemove]), [['mine.pdf', false], ['theirs.pdf', false]]);
  const a = (await firestore.collection('attachments').doc(mine.AttachmentID).get()).data();
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/01 - Test Co One/2026/Journal Entry Processing (JV)/' + p.jvNumber + '/mine.pdf');
  // Added after posting: straight into the numbered folder.
  const late = (await upload('u-viewer', 'JV', jv, 'late.pdf', PDF)).file;
  const la = (await firestore.collection('attachments').doc(late.AttachmentID).get()).data();
  assert.equal(await pathOf(la.StorageFileID), 'ERP Documents/01 - Test Co One/2026/Journal Entry Processing (JV)/' + p.jvNumber + '/late.pdf');

  await assert.rejects(call('u-viewer', 'removeAttachment', { attachmentId: mine.AttachmentID }), /This entry is posted: only Admin can remove its documents/);
  assert.equal((await call('u-admin', 'removeAttachment', { attachmentId: mine.AttachmentID })).success, true);
  assert.deepEqual((await list('u-admin', 'JV', jv)).files.map(f => [f.FileName, f.CanRemove]), [['theirs.pdf', true], ['late.pdf', true]]);
  assert.equal(await pathOf(a.StorageFileID), 'ERP Documents/Removed/' + p.jvNumber + ' - mine.pdf', 'moved, not deleted');
  await assert.rejects(call('u-viewer', 'openAttachment', { attachmentId: mine.AttachmentID }), /Document not found/);
  const logged = (await firestore.collection('attachmentLog').get()).docs.map(d => d.data().Action).sort();
  assert.deepEqual(logged, ['Remove', 'Remove', 'Upload', 'Upload', 'Upload', 'Upload']);
});

test('the same for a stock document (GRN) and for the storage test', async () => {
  await call('u-admin', 'useTestDocumentStorage', {});
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: D, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, UnitCost: 5, Description: 'in' }] });
  const f = (await upload('u-viewer', 'GRN', g.grnId, 'delivery note.jpg', Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64'))).file;
  const p = await call('u-admin', 'postGrn', { grnId: g.grnId });
  assert.equal(p.success, true, p.error);
  await list('u-viewer', 'GRN', g.grnId);
  const a = (await firestore.collection('attachments').doc(f.AttachmentID).get()).data();
  assert.match(await pathOf(a.StorageFileID), /^ERP Documents\/01 - Test Co One\/2026\/Goods Receipt \(GRN\)\/GRN-26-01-\d{6}\/delivery note\.jpg$/);
  assert.equal((await call('u-admin', 'testDocumentStorage', {})).success, true);
});
