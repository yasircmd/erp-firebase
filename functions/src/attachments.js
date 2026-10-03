// Supporting documents on entries (owner, 2026-10-03; docs/modules/ATTACHMENTS.md).
// Files go to the connected document storage (Google Drive; see
// documentStorage.js) in folders the ERP makes itself:
//   <root>/<company Ref Code - name>/<year of the document>/<voucher type>/<document number>/
// A document without a number yet (a draft) keeps its files in
//   <root>/Drafts/<voucher type> - <id>/
// and that folder is renamed and moved under its year once the document is
// numbered (the next time its documents are listed or added).
// Owner's rules:
//   - anyone who can open the entry (module access + company access, and the
//     module's own visibility rule, e.g. Purchase Requisition) sees its files
//     and adds files, at any time, even after posting;
//   - a file is removed by its uploader or Admin before the document is
//     numbered (posted), by Admin only after; a removed file moves to
//     <root>/Removed/, never deleted;
//   - PDF, Word, Excel / CSV and images, at most 10 MB each.
// Admin = access to the Document Storage module (default ADMIN). Only Admin
// sees the storage link. Users get files only through these functions.
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { moduleIdForEntry } = require('./masterData');
const { canSeeRequisition } = require('./prVisibility');
const { MODULE_REGISTRY } = require('./moduleRegistry');
const store = require('./documentStorage');

const onCallOptions = { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }; // 300 s: a 10 MB file on a slow line (the screens wait as long)
const MAX_BYTES = 10 * 1024 * 1024;
const ATTACH = () => firestore.collection('attachments');
const FOLDERS = () => firestore.collection('attachmentFolders');
const LOG = () => firestore.collection('attachmentLog');

// ---------- the 27 entry modules: where each entry is ----------

const stock = type => ({ rtdb: 'stock/transactions', is: r => r.TransactionType === type, number: 'TransactionNumber', date: 'TransactionDate' });
const posting = id => ({ fs: 'faPostings', is: r => r.ModuleID === id, number: 'PostingNumber', date: 'Date' });
const SOURCES = {
  JV: { fs: 'journalEntries', is: r => moduleIdForEntry(r) === 'JV', number: 'JVNumber', date: 'JVDate' },
  CBT: { fs: 'journalEntries', is: r => moduleIdForEntry(r) === 'CBT', number: 'JVNumber', date: 'JVDate' },
  RECURRINGJV: { rtdb: 'recurringJournals', number: 'TemplateNumber', date: 'StartDate' },
  PDCRECEIVED: { rtdb: 'pdcCheques', is: r => r.Direction === 'Received', number: 'TransactionNumber', date: 'TransactionDate' },
  PDCISSUED: { rtdb: 'pdcCheques', is: r => r.Direction === 'Issued', number: 'TransactionNumber', date: 'TransactionDate' },
  PURCHASEREQUISITION: { rtdb: 'purchaseRequisitions', number: 'PRNumber', date: 'PRDate', visible: canSeeRequisition },
  INVENTORYPURCHASEREQUISITION: { rtdb: 'inventoryPurchaseRequisitions', number: 'IPRNumber', date: 'PRDate' },
  PURCHASEORDER: { rtdb: 'purchaseOrders', number: 'PONumber', date: 'PODate' },
  JOBORDERREQUEST: { rtdb: 'jobOrderBatches', number: 'BatchNumber', date: 'JODate' },
  SALESORDER: { rtdb: 'salesOrders', number: 'SONumber', date: 'SODate' },
  GRN: stock('GRN'), MATERIALISSUE: stock('MaterialIssue'), PRODUCTION: stock('Production'),
  WAREHOUSEMOVEMENT: stock('WarehouseMovement'), STOCKADJUSTMENT: stock('StockAdjustment'), PHYSICALCOUNT: stock('PhysicalCount'),
  DELIVERYNOTE: stock('DeliveryNote'), PURCHASERETURN: stock('PurchaseReturn'), SALESRETURN: stock('SalesReturn'),
  VENDORINVOICE: { rtdb: 'vendorInvoices', number: 'TransactionNumber', date: 'InvoiceDate' },
  CUSTOMERINVOICE: { rtdb: 'customerInvoices', number: 'TransactionNumber', date: 'InvoiceDate' },
  FAASSET: { fs: 'faAssets', number: 'AssetNumber', date: 'CapitalizationDate' },
  FAACQ: posting('FAACQ'), FAAUC: posting('FAAUC'), FAADDDEP: posting('FAADDDEP'), FARETIRE: posting('FARETIRE'),
  FADEPRUN: { fs: 'faRuns', number: 'JVNumber', date: 'Period' }
};
const MODULE_LABELS = Object.fromEntries(MODULE_REGISTRY.map(m => [m.id, m.label]));
// Folder names: the voucher type, readable and safe for any storage.
const typeFolder = module => (MODULE_LABELS[module] || module).replace(/[\\/:*?"<>|]/g, '-');
const safeName = v => String(v || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 150);

// The entry, if it exists and is of that module.
async function loadEntry(module, docId) {
  const src = SOURCES[module];
  if (!src) throw new HttpsError('invalid-argument', 'Documents can\'t be attached to this kind of entry.');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(docId || ''))) throw new HttpsError('invalid-argument', 'Save the entry first.');
  let rec = null;
  if (src.fs) {
    const snap = await firestore.collection(src.fs).doc(docId).get();
    rec = snap.exists ? snap.data() : null;
  } else {
    rec = (await rtdb.ref(src.rtdb + '/' + docId).get()).val();
  }
  if (!rec || (src.is && !src.is(rec))) throw new HttpsError('not-found', 'Entry not found.');
  const number = String(rec[src.number] || '').trim();
  const date = String(rec[src.date] || rec.Date || rec.TransactionDate || rec.CreatedAt || '').trim();
  return { src, rec, number, year: (date.match(/^(\d{4})/) || [])[1] || String(new Date().getFullYear()), companyId: rec.CompanyID || '' };
}

async function isStorageAdmin(user) {
  return moduleHasCapability('DOCUMENTSTORAGE', 'access', user.profile.role);
}

// Anyone who can open the entry: module access, company access, and the
// module's own visibility rule.
async function requireEntryAccess(user, module, docId) {
  if (!SOURCES[module]) throw new HttpsError('invalid-argument', 'Documents can\'t be attached to this kind of entry.');
  if (!(await moduleHasCapability(module, 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to ' + (MODULE_LABELS[module] || module) + '.');
  }
  const e = await loadEntry(module, docId);
  if (e.companyId && !userCanAccessCompany(user.profile, e.companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (e.src.visible && !(await e.src.visible(user, docId, e.rec))) throw new HttpsError('permission-denied', 'You do not have access to this entry.');
  return e;
}

// ---------- folders ----------

async function folderFor(api, s, parentId, name, cacheKey) {
  const key = (cacheKey || (parentId + '|' + name)).replace(/\//g, '_').slice(0, 500);
  const cached = await FOLDERS().doc(key).get();
  if (cached.exists && cached.data().RootFolderID === s.RootFolderID) return cached.data().FolderID;
  let id = await api.findFolder(s, parentId, name);
  if (!id) id = await api.createFolder(s, parentId, name);
  await FOLDERS().doc(key).set({ FolderID: id, RootFolderID: s.RootFolderID, Name: name, Parent: parentId });
  return id;
}

async function companyFolderName(companyId) {
  const c = companyId ? (await rtdb.ref('companies/' + companyId).get()).val() : null;
  return c ? safeName((c.CompanyRefCode ? c.CompanyRefCode + ' - ' : '') + (c.LegalName || companyId)) : 'All Companies';
}

// The document's own folder; a numbered document's draft folder is moved
// under its year and renamed to the number.
async function documentFolder(api, s, module, docId, e) {
  const docKey = 'doc_' + module + '_' + docId;
  const known = (await FOLDERS().doc(docKey).get()).data();
  if (e.number) {
    const companyId = await folderFor(api, s, s.RootFolderID, await companyFolderName(e.companyId), 'co_' + (e.companyId || 'all'));
    const yearId = await folderFor(api, s, companyId, e.year, 'yr_' + (e.companyId || 'all') + '_' + e.year);
    const typeId = await folderFor(api, s, yearId, typeFolder(module), 'ty_' + (e.companyId || 'all') + '_' + e.year + '_' + module);
    if (known && known.RootFolderID === s.RootFolderID) {
      if (known.Numbered) return known.FolderID;
      await api.move(s, known.FolderID, typeId, known.Parent, safeName(e.number));
      await FOLDERS().doc(docKey).set({ FolderID: known.FolderID, RootFolderID: s.RootFolderID, Parent: typeId, Numbered: true, Name: e.number });
      return known.FolderID;
    }
    const id = await api.createFolder(s, typeId, safeName(e.number));
    await FOLDERS().doc(docKey).set({ FolderID: id, RootFolderID: s.RootFolderID, Parent: typeId, Numbered: true, Name: e.number });
    return id;
  }
  if (known && known.RootFolderID === s.RootFolderID) return known.FolderID;
  const draftsId = await folderFor(api, s, s.RootFolderID, 'Drafts', 'drafts');
  const id = await api.createFolder(s, draftsId, safeName(typeFolder(module) + ' - ' + docId));
  await FOLDERS().doc(docKey).set({ FolderID: id, RootFolderID: s.RootFolderID, Parent: draftsId, Numbered: false, Name: docId });
  return id;
}

// ---------- files ----------

const TYPES = {
  pdf: { mime: 'application/pdf', sig: b => b.slice(0, 4).toString('latin1') === '%PDF' },
  doc: { mime: 'application/msword', sig: b => b.slice(0, 4).toString('hex') === 'd0cf11e0' },
  xls: { mime: 'application/vnd.ms-excel', sig: b => b.slice(0, 4).toString('hex') === 'd0cf11e0' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: b => b.slice(0, 2).toString('latin1') === 'PK' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: b => b.slice(0, 2).toString('latin1') === 'PK' },
  csv: { mime: 'text/csv', sig: b => !b.slice(0, 4096).includes(0) },
  jpg: { mime: 'image/jpeg', sig: b => b.slice(0, 3).toString('hex') === 'ffd8ff' },
  jpeg: { mime: 'image/jpeg', sig: b => b.slice(0, 3).toString('hex') === 'ffd8ff' },
  png: { mime: 'image/png', sig: b => b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' },
  webp: { mime: 'image/webp', sig: b => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  heic: { mime: 'image/heic', sig: b => b.slice(4, 8).toString('latin1') === 'ftyp' }
};
const ALLOWED = 'PDF, Word (.doc, .docx), Excel (.xls, .xlsx, .csv) and images (.jpg, .png, .webp, .heic)';

function checkFile(fileName, base64) {
  const name = safeName(fileName);
  const ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
  const t = ext && TYPES[ext.toLowerCase()];
  if (!name || !t) throw new HttpsError('invalid-argument', '"' + (fileName || '') + '": only ' + ALLOWED + ' can be attached.');
  const data = Buffer.from(String(base64 || ''), 'base64');
  if (!data.length) throw new HttpsError('invalid-argument', '"' + name + '" is empty.');
  if (data.length > MAX_BYTES) throw new HttpsError('invalid-argument', '"' + name + '" is ' + (data.length / 1048576).toFixed(1) + ' MB; the limit is 10 MB per file.');
  if (!t.sig(data)) throw new HttpsError('invalid-argument', '"' + name + '" is not really a .' + ext.toLowerCase() + ' file.');
  return { name, mime: t.mime, data };
}

const actorName = user => user.profile.fullName || user.profile.username || user.uid;
async function log(action, a, user) {
  await LOG().add({ Action: action, AttachmentID: a.id || a.AttachmentID || '', Module: a.Module, DocID: a.DocID, FileName: a.FileName, By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
}

function publicFile(id, a) {
  return { AttachmentID: id, FileName: a.FileName, MimeType: a.MimeType, Size: a.Size, UploadedBy: a.UploadedBy, UploadedByName: a.UploadedByName, UploadedAt: a.UploadedAt };
}

// Owner decision 3: uploader or Admin before posting; Admin only after.
function canRemove(a, user, posted, admin) {
  return admin || (!posted && a.UploadedBy === user.uid);
}

async function listFiles(module, docId) {
  const snap = await ATTACH().where('DocKey', '==', module + ':' + docId).get();
  return snap.docs.filter(d => !d.data().Removed).map(d => ({ id: d.id, a: d.data() }))
    .sort((x, y) => String(x.a.UploadedAt).localeCompare(String(y.a.UploadedAt)));
}

// ---------- callables: entries ----------

exports.getAttachments = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const module = String(d.module || ''), docId = String(d.docId || '');
  const e = await requireEntryAccess(user, module, docId);
  const admin = await isStorageAdmin(user);
  const posted = Boolean(e.number);
  const files = await listFiles(module, docId);
  // Numbered since its files were added: move its folder from Drafts.
  if (posted && files.length) {
    const known = (await FOLDERS().doc('doc_' + module + '_' + docId).get()).data();
    if (known && !known.Numbered) {
      const { s, api } = await store.connected();
      await documentFolder(api, s, module, docId, e);
    }
  }
  return {
    posted, files: files.map(f => Object.assign(publicFile(f.id, f.a), { CanRemove: canRemove(f.a, user, posted, admin) })),
    maxBytes: MAX_BYTES, allowed: ALLOWED
  };
});

exports.uploadAttachment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const module = String(d.module || ''), docId = String(d.docId || '');
  const e = await requireEntryAccess(user, module, docId);
  const file = checkFile(d.fileName, d.data);
  const { s, api } = await store.connected();
  const folderId = await documentFolder(api, s, module, docId, e);
  const fileId = await api.upload(s, folderId, file.name, file.mime, file.data);
  const now = new Date().toISOString();
  const rec = {
    DocKey: module + ':' + docId, Module: module, DocID: docId, CompanyID: e.companyId, DocNumber: e.number,
    FileName: file.name, MimeType: file.mime, Size: file.data.length, StorageFileID: fileId, FolderID: folderId,
    RootFolderID: s.RootFolderID, UploadedBy: user.uid, UploadedByName: actorName(user), UploadedAt: now, Removed: false
  };
  const ref = await ATTACH().add(rec);
  await log('Upload', Object.assign({ id: ref.id }, rec), user);
  return { success: true, file: publicFile(ref.id, rec) };
});

async function attachmentFor(user, attachmentId) {
  const snap = await ATTACH().doc(String(attachmentId || '')).get();
  if (!snap.exists || snap.data().Removed) throw new HttpsError('not-found', 'Document not found.');
  const a = snap.data();
  const e = await requireEntryAccess(user, a.Module, a.DocID);
  return { a, e, ref: snap.ref };
}

exports.openAttachment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const { a, ref } = await attachmentFor(user, (request.data || {}).attachmentId);
  const { s, api } = await store.connected();
  const data = await api.download(s, a.StorageFileID);
  await log('Open', Object.assign({ id: ref.id }, a), user);
  return { fileName: a.FileName, mimeType: a.MimeType, data: data.toString('base64') };
});

exports.removeAttachment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const { a, e, ref } = await attachmentFor(user, (request.data || {}).attachmentId);
  const admin = await isStorageAdmin(user);
  if (!canRemove(a, user, Boolean(e.number), admin)) {
    throw new HttpsError('permission-denied', e.number
      ? 'This entry is posted: only Admin can remove its documents.'
      : 'Only the person who added this document, or Admin, can remove it.');
  }
  const { s, api } = await store.connected();
  const removedId = await folderFor(api, s, s.RootFolderID, 'Removed', 'removed');
  await api.move(s, a.StorageFileID, removedId, a.FolderID, safeName((e.number || a.DocNumber || a.DocID) + ' - ' + a.FileName));
  await ref.update({ Removed: true, RemovedBy: user.uid, RemovedByName: actorName(user), RemovedAt: new Date().toISOString() });
  await log('Remove', Object.assign({ id: ref.id }, a), user);
  return { success: true };
});

// How many documents each entry has (the paperclip in the lists).
exports.getAttachmentCounts = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const module = String(d.module || '');
  if (!SOURCES[module] || !(await moduleHasCapability(module, 'access', user.profile.role))) return {};
  const ids = [...new Set((d.docIds || []).map(String))].slice(0, 300);
  const out = {};
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await ATTACH().where('DocKey', 'in', ids.slice(i, i + 30).map(id => module + ':' + id)).get();
    snap.docs.forEach(doc => { const a = doc.data(); if (!a.Removed) out[a.DocID] = (out[a.DocID] || 0) + 1; });
  }
  return out;
});

// ---------- Admin: Document Storage ----------

async function requireStorageAdmin(user) {
  if (!(await isStorageAdmin(user))) throw new HttpsError('permission-denied', 'Only Admin can manage the document storage.');
}
const redirectUri = () => 'https://us-central1-' + (process.env.GCLOUD_PROJECT || 'erp1-8f4cd') + '.cloudfunctions.net/driveOAuthCallback';
const folderLink = id => id ? 'https://drive.google.com/drive/folders/' + id : '';

exports.getDocumentStorage = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireStorageAdmin(user);
  const s = await store.getSettings();
  return {
    provider: s.Provider || 'GoogleDrive', clientId: s.ClientID || '', hasClientSecret: Boolean(s.ClientSecret),
    connected: Boolean(s.RootFolderID && (s.RefreshToken || s.Provider === 'Memory')), account: s.Account || '',
    rootFolderLink: s.Provider === 'Memory' ? '' : folderLink(s.RootFolderID), connectedAt: s.ConnectedAt || '', connectedBy: s.ConnectedBy || '',
    redirectUri: redirectUri(), onEmulator: store.onEmulator()
  };
});

exports.saveDocumentStorageClient = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireStorageAdmin(user);
  const d = request.data || {};
  const clientId = String(d.clientId || '').trim(), clientSecret = String(d.clientSecret || '').trim();
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new HttpsError('invalid-argument', 'Paste the OAuth client ID from Google Cloud (it ends with .apps.googleusercontent.com).');
  const s = await store.getSettings();
  if (!clientSecret && !s.ClientSecret) throw new HttpsError('invalid-argument', 'Paste the client secret too.');
  // A different client can't use the old connection (its refresh token
  // belongs to the old client): connect again.
  const changed = Boolean(s.ClientID && s.ClientID !== clientId);
  await store.saveSettings(Object.assign({ ClientID: clientId, UpdatedAt: new Date().toISOString(), UpdatedBy: actorName(user) },
    clientSecret ? { ClientSecret: clientSecret } : {}, changed ? { RefreshToken: '', ConnectedAt: '' } : {}));
  return { success: true };
});

// The Google sign-in page for "Connect Google Drive".
exports.startDriveConnect = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireStorageAdmin(user);
  const s = await store.getSettings();
  if (!s.ClientID || !s.ClientSecret) throw new HttpsError('failed-precondition', 'Save the OAuth client ID and secret first.');
  const state = randomUUID();
  await firestore.collection('settings').doc('documentStorage').collection('pending').doc(state).set({ By: user.uid, ByName: actorName(user), At: Date.now() });
  const params = new URLSearchParams({
    client_id: s.ClientID, redirect_uri: redirectUri(), response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive.file', state
  });
  return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params };
});

const page = (title, text) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title +
  '</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>' + title + '</h2><p>' + text + '</p></body>';
const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Google returns here after the sign-in: keep the refresh token and make the
// root folder.
async function finishConnect(query, fetchImpl) {
  const state = String(query.state || '');
  if (query.error) return page('Not connected', 'Google said: ' + esc(query.error) + '. Close this tab and try again from Document Storage.');
  const pendingRef = firestore.collection('settings').doc('documentStorage').collection('pending').doc(state || '-');
  const pending = await pendingRef.get();
  if (!state || !pending.exists || Date.now() - pending.data().At > 15 * 60 * 1000) {
    return page('Not connected', 'This sign-in link has expired. Close this tab and click Connect Google Drive again.');
  }
  await pendingRef.delete();
  const s = await store.getSettings();
  const res = await (fetchImpl || fetch)(store.TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(query.code || ''), client_id: s.ClientID, client_secret: s.ClientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.refresh_token) {
    return page('Not connected', 'Google did not give a lasting connection (' + esc(body.error_description || body.error || res.status) + '). Close this tab and try again.');
  }
  const next = Object.assign({}, s, { RefreshToken: body.refresh_token, Provider: 'GoogleDrive' });
  const account = await store.drive.whoAmI(next).catch(() => '');
  let rootId = s.RootFolderID && s.Account === account ? s.RootFolderID : '';
  if (!rootId) rootId = await store.drive.createFolder(next, '', 'ERP Documents');
  await store.saveSettings({ RefreshToken: body.refresh_token, Provider: 'GoogleDrive', RootFolderID: rootId, Account: account,
    ConnectedAt: new Date().toISOString(), ConnectedBy: pending.data().ByName });
  return page('Google Drive connected', 'Documents will be kept in the folder "ERP Documents" in ' + esc(account || 'this Google account') +
    '. Close this tab and click Test connection in Document Storage.');
}
exports.driveOAuthCallback = onRequest({ region: 'us-central1' }, async (req, res) => {
  try {
    res.set('Content-Type', 'text/html; charset=utf-8').status(200).send(await finishConnect(req.query || {}));
  } catch (e) {
    res.set('Content-Type', 'text/html; charset=utf-8').status(200).send(page('Not connected', esc(e.message)));
  }
});

// Writes, reads back and removes a small file in the root folder.
exports.testDocumentStorage = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireStorageAdmin(user);
  const { s, api } = await store.connected();
  const text = Buffer.from('ERP document storage test ' + new Date().toISOString());
  const id = await api.upload(s, s.RootFolderID, 'connection-test.txt', 'text/plain', text);
  const back = await api.download(s, id);
  await api.remove(s, id);
  if (!back.equals(text)) throw new HttpsError('internal', 'The test file came back different.');
  return { success: true, account: await api.whoAmI(s).catch(() => s.Account || '') };
});

exports.disconnectDocumentStorage = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireStorageAdmin(user);
  await store.saveSettings({ RefreshToken: '', ConnectedAt: '', DisconnectedAt: new Date().toISOString(), DisconnectedBy: actorName(user) });
  return { success: true };
});

// Emulator only: a stand-in storage for the tests.
exports.useTestDocumentStorage = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireStorageAdmin(user);
  if (!store.onEmulator()) throw new HttpsError('failed-precondition', 'Only on the test emulators.');
  const rootId = await store.memory.createFolder({}, '', 'ERP Documents');
  await store.saveSettings({ Provider: 'Memory', RootFolderID: rootId, Account: 'emulator@local', ConnectedAt: new Date().toISOString(), ConnectedBy: actorName(user) });
  return { success: true };
});

module.exports.SOURCES = SOURCES;
module.exports._finishConnect = finishConnect; // for the tests
module.exports._checkFile = checkFile;
