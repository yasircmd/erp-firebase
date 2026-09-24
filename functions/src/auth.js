const { HttpsError } = require('firebase-functions/v2/https');
const { rtdb } = require('./firebaseAdmin');
const { DEFAULT_PERMISSIONS } = require('./moduleRegistry');

// Callable functions verify the caller's Firebase ID token automatically,
// before this code ever runs — context.auth.uid is already trustworthy
// by the time we see it. That's what actually replaces Code.gs's old
// manual accounts:lookup REST call in requireUser_; this function only
// needs to do what accounts:lookup COULDN'T tell you — whether this
// uid has an ERP profile at all, and whether that profile is Active.
// Same return shape as the old requireUser_ ({ uid, profile }) on
// purpose, so every subsequent ported function can call this exactly
// the way the old code called requireUser_(idToken).
async function requireUser(context) {
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError('unauthenticated', 'Please sign in again.');
  }
  const uid = context.auth.uid;
  const snap = await rtdb.ref('users/' + uid).get();
  const profile = snap.val();
  if (!profile || profile.status !== 'Active') {
    throw new HttpsError('permission-denied', 'This ERP account is inactive or not configured.');
  }
  return { uid, profile };
}

// Ported from ensurePermissionsSeeded_ — identical lazy-seed behavior:
// any module missing from the live permissions node gets its default
// written in, without ever overwriting an admin's own customization
// of a module that's already present.
async function ensurePermissionsSeeded() {
  const snap = await rtdb.ref('permissions').get();
  const existing = snap.val() || {};
  let changed = false;

  Object.keys(DEFAULT_PERMISSIONS).forEach(moduleId => {
    if (!existing[moduleId]) {
      existing[moduleId] = DEFAULT_PERMISSIONS[moduleId];
      changed = true;
    }
  });

  if (changed) {
    try {
      await rtdb.ref('permissions').set(existing);
    } catch (err) {
      // Same as the old code's own comment: read-only caller (or a
      // transient write failure) — proceed with in-memory defaults
      // for this call rather than failing the whole request over a
      // seeding write that isn't strictly required to answer it.
    }
  }
  return existing;
}

// Ported from moduleHasCapability_ — identical logic, just async
// (RTDB reads via the Admin SDK are promise-based, not the synchronous
// UrlFetchApp calls GAS made).
async function moduleHasCapability(moduleId, capability, roleId) {
  const permissions = await ensurePermissionsSeeded();
  const modulePerm = permissions[moduleId] || {};
  return (modulePerm[capability] || []).includes(roleId);
}

module.exports = { requireUser, ensurePermissionsSeeded, moduleHasCapability };
