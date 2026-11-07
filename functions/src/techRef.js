// Technical Reference (owner, 2026-11-07; docs/modules/TECH_REFERENCE.md,
// Q419-Q422): the app's technical details for the firm's developers, read
// only. The reference is built from the repository by tools/techref/build.js
// and written into each screens release (screenReleases/{id}/techref/{part},
// in the firm's own Firestore, tools/screen-release.js); this serves the
// active release's parts to a user with the TECHREF access right.
// TECHREF is firm-only (homeOnly): moduleHasCapability refuses it in every
// client corporate, whatever a role says. Never public: the reference names
// every function, database path and the security model.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firm } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'TECHREF';

async function requireAccess(request) {
  const user = await requireUser(request);
  if (!(await moduleHasCapability(MODULE_ID, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to the Technical Reference.');
  return user;
}
async function activeRelease() {
  const p = await firm.firestore.doc('system/screens').get();
  const id = p.exists ? p.get('activeRelease') : null;
  if (!id) throw new HttpsError('not-found', 'No screens release yet.');
  return id;
}
async function readPart(release, part) {
  const s = await firm.firestore.doc('screenReleases/' + release + '/techref/' + part).get();
  if (!s.exists) throw new HttpsError('not-found', part === 'meta' ? 'This release has no Technical Reference: release the screens again.' : 'Part ' + part + ' not found.');
  return JSON.parse(s.get('json'));
}

// One part of the active release's reference: 'meta' (counts, the
// documents' list, the release's commit), 'cat_<section>' or 'docNNN'.
exports.getTechRefPart = onCallWithMessages(onCallOptions, async (request) => {
  await requireAccess(request);
  const part = String((request.data && request.data.part) || 'meta');
  if (!/^(meta|cat_[A-Za-z]+|doc\d{3})$/.test(part)) throw new HttpsError('invalid-argument', 'Unknown part.');
  const release = await activeRelease();
  return { release, part, data: await readPart(release, part) };
});

// The documents containing every word of the query, with a snippet each.
exports.searchTechRef = onCallWithMessages(onCallOptions, async (request) => {
  await requireAccess(request);
  const words = String((request.data && request.data.q) || '').toLowerCase().split(/\s+/).filter(w => w.length > 1).slice(0, 8);
  if (!words.length) return { hits: [] };
  const release = await activeRelease();
  const meta = await readPart(release, 'meta');
  const titles = Object.fromEntries(meta.documents.map(d => [d.id, d.title]));
  const refs = (meta.searchParts || []).map(k => firm.firestore.doc('screenReleases/' + release + '/techref/' + k));
  const docs = refs.length ? await firm.firestore.getAll(...refs) : [];
  const hits = [];
  docs.filter(d => d.exists).forEach(d => JSON.parse(d.get('json')).forEach(doc => {
    const low = doc.text.toLowerCase();
    if (!words.every(w => low.includes(w))) return;
    const at = low.indexOf(words[0]);
    hits.push({ id: doc.id, title: titles[doc.id] || doc.id, count: words.reduce((n, w) => n + low.split(w).length - 1, 0),
      snippet: doc.text.slice(Math.max(0, at - 80), at + 160) });
  }));
  hits.sort((a, b) => b.count - a.count);
  return { hits: hits.slice(0, 40) };
});
