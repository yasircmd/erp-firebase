// Where supporting documents are kept (owner, 2026-10-03; docs/modules/ATTACHMENTS.md).
// One small adapter, so the screens and the rules never depend on the
// provider:
//   - Google Drive (for now the owner's own Drive): the ERP signs in as the
//     account Admin connected (OAuth, scope drive.file: only what the ERP
//     itself creates), with the stored refresh token;
//   - an in-memory stand-in on the emulators (tests), kept in Firestore so
//     every function instance sees the same files.
// The settings (client, token, root folder) live in Firestore
// settings/documentStorage, read and written by Cloud Functions only.
'use strict';
const { randomUUID } = require('crypto');
const { firestore, corporateId } = require('./firebaseAdmin');

const SETTINGS = () => firestore.collection('settings').doc('documentStorage');
const FOLDER = 'application/vnd.google-apps.folder';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const onEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);

async function getSettings() {
  const snap = await SETTINGS().get();
  return snap.exists ? snap.data() : {};
}
async function saveSettings(fields) { await SETTINGS().set(fields, { merge: true }); }

// ---------- Google Drive ----------

// Per corporate (docs/modules/MULTI_CORPORATE.md §4): each one's Drive is
// its own. { Corporate ID: { token, expires, refresh } }
const cachedTokens = new Map();
async function accessToken(s) {
  const corp = corporateId();
  const cachedToken = cachedTokens.get(corp);
  if (cachedToken && cachedToken.refresh === s.RefreshToken && cachedToken.expires > Date.now() + 60000) return cachedToken.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.ClientID, client_secret: s.ClientSecret, refresh_token: s.RefreshToken, grant_type: 'refresh_token' })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error('Google Drive refused the connection (' + (body.error_description || body.error || res.status) + '). Admin: reconnect it in Document Storage.');
  }
  cachedTokens.set(corp, { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3000) * 1000, refresh: s.RefreshToken });
  return body.access_token;
}

async function driveCall(s, url, init) {
  const token = await accessToken(s);
  const res = await fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + token }, (init && init.headers) || {}) }));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Google Drive: ' + res.status + ' ' + text.slice(0, 200));
  }
  return res;
}

const q = v => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const drive = {
  async findFolder(s, parentId, name) {
    const query = "mimeType = '" + FOLDER + "' and trashed = false and name = '" + q(name) + "' and '" + q(parentId) + "' in parents";
    const res = await driveCall(s, DRIVE + '/files?fields=files(id,name)&q=' + encodeURIComponent(query));
    const files = (await res.json()).files || [];
    return files.length ? files[0].id : '';
  },
  async createFolder(s, parentId, name) {
    const res = await driveCall(s, DRIVE + '/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: parentId ? [parentId] : [] })
    });
    return (await res.json()).id;
  },
  async upload(s, parentId, name, mimeType, buffer) {
    const boundary = 'erp' + randomUUID().replace(/-/g, '');
    const meta = JSON.stringify({ name, parents: [parentId] });
    const body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n'),
      buffer, Buffer.from('\r\n--' + boundary + '--')
    ]);
    const res = await driveCall(s, UPLOAD + '/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
    return (await res.json()).id;
  },
  async download(s, fileId) {
    const res = await driveCall(s, DRIVE + '/files/' + encodeURIComponent(fileId) + '?alt=media');
    return Buffer.from(await res.arrayBuffer());
  },
  async move(s, fileId, newParentId, oldParentId, newName) {
    const params = new URLSearchParams({ addParents: newParentId, removeParents: oldParentId, fields: 'id' });
    await driveCall(s, DRIVE + '/files/' + encodeURIComponent(fileId) + '?' + params, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newName ? { name: newName } : {})
    });
  },
  async remove(s, fileId) {
    await driveCall(s, DRIVE + '/files/' + encodeURIComponent(fileId), { method: 'DELETE' });
  },
  async whoAmI(s) {
    const res = await driveCall(s, DRIVE + '/about?fields=user(emailAddress)');
    return ((await res.json()).user || {}).emailAddress || '';
  }
};

// ---------- the emulator stand-in ----------

const MEM = () => firestore.collection('__documentStorage');
const memory = {
  async findFolder(s, parentId, name) {
    const snap = await MEM().where('Parent', '==', parentId).where('Name', '==', name).where('Folder', '==', true).get();
    return snap.empty ? '' : snap.docs[0].id;
  },
  async createFolder(s, parentId, name) {
    const id = 'mf-' + randomUUID();
    await MEM().doc(id).set({ Parent: parentId, Name: name, Folder: true });
    return id;
  },
  async upload(s, parentId, name, mimeType, buffer) {
    const id = 'm-' + randomUUID();
    await MEM().doc(id).set({ Parent: parentId, Name: name, Folder: false, MimeType: mimeType, Data: buffer.toString('base64') });
    return id;
  },
  async download(s, fileId) {
    const snap = await MEM().doc(fileId).get();
    if (!snap.exists) throw new Error('The file is no longer in the document storage.');
    return Buffer.from(snap.data().Data, 'base64');
  },
  async move(s, fileId, newParentId, oldParentId, newName) {
    await MEM().doc(fileId).update(Object.assign({ Parent: newParentId }, newName ? { Name: newName } : {}));
  },
  async remove(s, fileId) { await MEM().doc(fileId).delete(); },
  async whoAmI() { return 'emulator@local'; }
};

// The connected storage: { s (settings), api }, or an error saying what to do.
async function connected() {
  const s = await getSettings();
  if (onEmulator() && s.Provider === 'Memory') return { s, api: memory };
  if (!s.RefreshToken || !s.RootFolderID) throw new Error('Document storage is not connected yet. Admin: connect Google Drive in Document Storage.');
  return { s, api: drive };
}

module.exports = { getSettings, saveSettings, connected, drive, memory, onEmulator, TOKEN_URL, FOLDER };
