const { HttpsError } = require('firebase-functions/v2/https');
const { onCallInCorporate } = require('./callable');
const { requireUser } = require('./auth');
const { ensureRolesSeeded } = require('./roles');
const { buildTreeForRole } = require('./tree');
const { rtdb, corporateId: currentCorporate } = require('./firebaseAdmin');
const { signInConfig } = require('./corporates');

// The Corporate ID the user typed must be the corporate this request is
// for (docs/modules/MULTI_CORPORATE.md §2, M1): the one whose Auth signed
// the user in (callable.js, corporates.js). Corporate 100, the firm's own,
// is this project; a client's is in the directory. The client signs in to
// that Auth first, then calls completeLogin, so a correct password with the
// wrong Corporate ID means the person briefly holds a valid Firebase Auth
// session before this check rejects them. The client is responsible for
// signing them back out (auth.signOut()) the moment completeLogin throws,
// so they're never left in a signed-in-to-Firebase-but-not-into-the-app
// limbo state.
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

  // The user's own light / dark choice, on every device; light for one who
  // never chose (owner, 2026-10-24, decision 272).
  const prefs = (await rtdb.ref('userPreferences/' + user.uid).get()).val() || {};
  return {
    uid: user.uid,
    theme: prefs.Theme === 'dark' ? 'dark' : 'light',
    fullName: user.profile.fullName || '',
    role: user.profile.role || 'VIEWER',
    roleName: roleName,
    data: await buildTreeForRole(user.profile.role || 'VIEWER')
  };
}

exports.completeLogin = onCallInCorporate(onCallOptions, async (request) => {
  const corporateId = String(request.data && request.data.corporateId || '').trim();
  if (!corporateId || corporateId !== currentCorporate()) {
    throw new HttpsError('permission-denied', 'Invalid Corporate ID.');
  }
  const session = await buildSessionResponse(request);
  // User Management's Last Login (bug, 2026-10-14: nothing ever set it, so
  // every user showed "Never"). Only a real sign-in counts, not a
  // restoreSession on reload. UTC here; the screen shows it in local time.
  await rtdb.ref('users/' + session.uid + '/lastLogin').set(new Date().toISOString());
  return session;
});

// Before sign-in, no user yet: what the sign-in screen needs for a
// Corporate ID (this project's Auth for 100, else the corporate's public
// web config). An unknown or inactive ID is refused as completeLogin
// refuses it.
exports.corporateSignIn = onCallInCorporate(onCallOptions, async (request) => {
  return signInConfig(request.data && request.data.corporateId);
});

exports.restoreSession = onCallInCorporate(onCallOptions, async (request) => {
  return buildSessionResponse(request);
});

// Public entry point for the home-screen Refresh action — re-fetches
// and re-filters the nav tree for the current user without a full
// session rebuild. Ported from getMyTree.
exports.getMyTree = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  return buildTreeForRole(user.profile.role);
});
