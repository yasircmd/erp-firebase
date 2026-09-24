const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { requireUser } = require('./auth');
const { ensureRolesSeeded } = require('./roles');
const { buildTreeForRole } = require('./tree');

// Same server-only constant, same reasoning as the original Code.gs:
// a shared, organization-wide code, deliberately not stored anywhere
// editable — only someone with access to this function's own source
// can ever change it. The one thing that DOES change with the client
// SDK migration: this is no longer checked before Firebase Auth even
// attempts the sign-in (the old loginWithFirebase's own sequencing).
// The client now signs in DIRECTLY against Firebase Auth first, then
// calls completeLogin — so a correct password with the wrong
// Corporate ID now means the person briefly holds a valid Firebase
// Auth session before this check rejects them. The client is
// responsible for signing them back out (auth.signOut()) the moment
// completeLogin throws, so they're never left in a signed-in-to-
// Firebase-but-not-into-the-app limbo state.
const CORPORATE_ID = '100';
const onCallOptions = { region: 'us-central1' };

// Shared by completeLogin and restoreSession — both ultimately need
// the same thing (a valid, Active profile plus that role's own
// visible tree), they just differ on whether the Corporate ID gate
// applies. Same success shape as the old loginWithFirebase/
// restoreSession returned, minus the token itself (the client SDK
// already holds its own session — nothing here needs to hand a token
// back for the client to store, unlike the old google.script.run flow).
async function buildSessionResponse(context) {
  const user = await requireUser(context);
  const roles = await ensureRolesSeeded();
  const roleName = (roles[user.profile.role] && roles[user.profile.role].Name) || user.profile.role || 'VIEWER';

  return {
    uid: user.uid,
    fullName: user.profile.fullName || '',
    role: user.profile.role || 'VIEWER',
    roleName: roleName,
    data: await buildTreeForRole(user.profile.role || 'VIEWER')
  };
}

exports.completeLogin = onCall(onCallOptions, async (request) => {
  const corporateId = String(request.data && request.data.corporateId || '').trim();
  if (corporateId !== CORPORATE_ID) {
    throw new HttpsError('permission-denied', 'Invalid Corporate ID.');
  }
  return buildSessionResponse(request);
});

exports.restoreSession = onCall(onCallOptions, async (request) => {
  return buildSessionResponse(request);
});

// Public entry point for the home-screen Refresh action — re-fetches
// and re-filters the nav tree for the current user without a full
// session rebuild. Ported from getMyTree.
exports.getMyTree = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  return buildTreeForRole(user.profile.role);
});
