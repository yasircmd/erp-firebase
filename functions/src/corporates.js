// The Corporate directory and which corporate a request is for
// (docs/modules/MULTI_CORPORATE.md §2–§4, M1). New development,
// hand-written.
//
// The directory is the firm's: Firestore corporateDirectory/{Corporate ID}
// in this project, { Name, ProjectID, DatabaseURL, WebConfig, Status }. It
// holds no client data, only where each client's project is and the
// public web config its sign-in needs. Corporate 100, the firm's own books,
// is this project and is not in it.
//
// A corporate is never taken from what a call says alone, but from the Auth
// that signed its token:
// - a call with no envelope is Corporate 100's: its token, if any, is this
//   project's Auth (Cloud Functions checked it);
// - a client corporate's app signs in to the client's own Auth and sends
//   { __corporate: { id, idToken }, __data } (public/index.html): the
//   token is checked against that corporate's project, so a token from one
//   corporate can never open another's data. The handler then sees __data
//   as request.data and the client's user as request.auth.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { firm, HOME_ID, appFor } = require('./firebaseAdmin');

const DIRECTORY = 'corporateDirectory';
const ENVELOPE = '__corporate';
const VALID_ID = /^[A-Za-z0-9-]{1,20}$/;
const invalid = () => new HttpsError('permission-denied', 'Invalid Corporate ID.');

// An Active corporate's directory entry, or null (unknown, inactive, 100).
async function directoryEntry(id) {
  const key = String(id || '').trim();
  if (!VALID_ID.test(key) || key === HOME_ID) return null;
  const snap = await firm.firestore.doc(DIRECTORY + '/' + key).get();
  const entry = snap.exists ? snap.data() : null;
  return entry && entry.Status === 'Active' ? entry : null;
}

// { id, entry } of the corporate a callable request is for; unwraps a
// client corporate's envelope into request.data and request.auth.
async function resolveCorporate(request) {
  const d = request.data;
  const env = d && typeof d === 'object' && !Array.isArray(d) && Object.prototype.hasOwnProperty.call(d, ENVELOPE) ? d[ENVELOPE] : null;
  if (!env) return { id: HOME_ID };
  const id = String((env && env.id) || '').trim();
  const entry = await directoryEntry(id);
  if (!entry) throw invalid();
  request.data = d.__data === undefined ? null : d.__data;
  // This project's Auth plays no part in a client corporate's call.
  request.auth = undefined;
  if (env.idToken) {
    let decoded;
    try {
      decoded = await appFor(id, entry).auth().verifyIdToken(String(env.idToken));
    } catch (err) {
      throw new HttpsError('unauthenticated', 'Please sign in again.');
    }
    request.auth = { uid: decoded.uid, token: decoded, rawToken: String(env.idToken) };
  }
  return { id, entry };
}

// What the sign-in screen needs for a Corporate ID: nothing more for 100
// (this project's Auth), else that corporate's public web config.
async function signInConfig(corporateId) {
  const id = String(corporateId || '').trim();
  if (id === HOME_ID) return { corporateId: HOME_ID, home: true };
  const entry = await directoryEntry(id);
  if (!entry || !entry.WebConfig || !entry.WebConfig.apiKey) throw invalid();
  const w = entry.WebConfig;
  const webConfig = {};
  ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId'].forEach(k => { if (w[k]) webConfig[k] = String(w[k]); });
  return { corporateId: id, home: false, webConfig };
}

module.exports = { DIRECTORY, ENVELOPE, directoryEntry, resolveCorporate, signInConfig };
