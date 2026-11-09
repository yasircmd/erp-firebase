const { HttpsError } = require('firebase-functions/v2/https');
const { onCallInCorporate } = require('./callable');
const { requireUser, moduleHasCapability } = require('./auth');
const { MODULE_REGISTRY } = require('./moduleRegistry');
const { firm } = require('./firebaseAdmin');

// Ported from getModuleFragment in Code.gs. Deliberately preserves the
// EXACT same access-control sequence as the original — requireUser,
// then look up the module, then explicitly check 'access' capability
// for the caller's own role — because this function is not just
// serving static content, it's the gate deciding whether this user is
// even allowed to see this module's UI code at all. A version of this
// that just read the file and returned it, skipping the capability
// check, would quietly let any authenticated user pull the HTML/JS of
// an Admin-only module like User Management — the actual data
// operations would still be blocked at their own RPC layer, but
// that's a real loss of defense-in-depth, not a cosmetic detail.
//
// The one thing that changes from the original: GAS's
// HtmlService.createHtmlOutputFromFile(id) read a file living alongside
// Code.gs. Here the screen comes from the active screen release in
// Firestore (docs/modules/SCREENS_ON_HOSTING.md; written by
// tools/release-screens.sh from screens/), so a screen change needs no
// function deploy. The release is read only AFTER the access check, and
// a release never changes once written, so caching its screens in memory
// is safe; the cache is dropped whenever the active release changes.
const onCallOptions = { region: 'us-central1' };
let cachedRelease = null;
const cache = new Map();

exports.getModuleFragment = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const id = String(request.data && request.data.moduleId || '').trim().toUpperCase();
  let moduleDef = MODULE_REGISTRY.find(m => m.id === id);
  // A built module published a moment ago by another instance (MODULE_BUILDER.md).
  if (!moduleDef && /^X_/.test(id)) { await require('./builtDefinitions').publishedDef(id); moduleDef = MODULE_REGISTRY.find(m => m.id === id); }

  if (!moduleDef) {
    throw new HttpsError('not-found', 'Unknown module: ' + (request.data && request.data.moduleId));
  }

  const canAccess = await moduleHasCapability(id, 'access', user.profile.role);
  if (!canAccess) {
    throw new HttpsError('permission-denied', 'You do not have access to this module.');
  }

  // The release is the firm's code, in this project, for every corporate
  // (docs/modules/MULTI_CORPORATE.md §5): never the corporate's database.
  const pointer = await firm.firestore.doc('system/screens').get();
  const release = pointer.exists ? pointer.get('activeRelease') : null;
  if (release !== cachedRelease) { cache.clear(); cachedRelease = release; }
  // A built module (MODULE_BUILDER.md) runs on the one runtime screen, told which module it is.
  const screenId = moduleDef.built ? 'BUILT' : id;
  let html = cache.get(screenId);
  if (html === undefined && release) {
    const snap = await firm.firestore.doc('screenReleases/' + release + '/screens/' + screenId).get();
    if (snap.exists) { html = snap.get('html'); cache.set(screenId, html); }
  }
  if (html && moduleDef.built) html = '<script>window.__builtModuleId = ' + JSON.stringify(id) + ';</script>' + html;
  if (!html) {
    throw new HttpsError('not-found', 'Module "' + id + '" has no fragment file yet.');
  }

  const canWrite = moduleDef.capabilities.includes('write') && await moduleHasCapability(id, 'write', user.profile.role);

  return { html: html, canWrite: canWrite };
});
