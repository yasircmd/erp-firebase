const fs = require('fs');
const path = require('path');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { requireUser, moduleHasCapability } = require('./auth');
const { MODULE_REGISTRY } = require('./moduleRegistry');

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
// The one thing that actually changes from the original: GAS's
// HtmlService.createHtmlOutputFromFile(id) read a file living
// alongside Code.gs in the same Apps Script project. Here, each
// module's .html file is bundled into this Cloud Function's own
// deployment package under modules/ — see that folder's own README
// for exactly what needs to be copied there from the old project.
const onCallOptions = { region: 'us-central1' };

exports.getModuleFragment = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const id = String(request.data && request.data.moduleId || '').trim().toUpperCase();
  const moduleDef = MODULE_REGISTRY.find(m => m.id === id);

  if (!moduleDef) {
    throw new HttpsError('not-found', 'Unknown module: ' + (request.data && request.data.moduleId));
  }

  const canAccess = await moduleHasCapability(id, 'access', user.profile.role);
  if (!canAccess) {
    throw new HttpsError('permission-denied', 'You do not have access to this module.');
  }

  let html;
  try {
    html = fs.readFileSync(path.join(__dirname, '..', 'modules', id + '.html'), 'utf8');
  } catch (err) {
    throw new HttpsError('not-found', 'Module "' + id + '" has no fragment file yet.');
  }

  const canWrite = moduleDef.capabilities.includes('write') && await moduleHasCapability(id, 'write', user.profile.role);

  return { html: html, canWrite: canWrite };
});
