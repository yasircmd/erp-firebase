const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { runInCorporate } = require('./firebaseAdmin');
const { resolveCorporate } = require('./corporates');
const perf = require('./perf');

// onCall, run inside the request's corporate (docs/modules/
// MULTI_CORPORATE.md §4): every database handle the handler reaches
// (firebaseAdmin.js) is that corporate's, for the whole request. Every
// callable goes through this (unit/corporateContext checks).
// Each call is timed (perf.js, docs/modules/PERFORMANCE.md P1), from before
// its corporate is found to its answer.
// .inCorporate(request): the same handler for a caller already inside a
// corporate (the task-email summary asks Home's task readers for a user,
// docs/modules/TASK_EMAILS.md); the corporate is the caller's, never the request's.
// The variant a call names, when it is a published variant (MODULE_BUILDER.md,
// Q484): { id, base, label, prefix, fields }; none named, null; named but
// unknown, refused. fields: the variant's extra fields the call sends
// (__variantFields; variantDocuments checks them when the document is written).
async function variantOf(data) {
  const id = data && data.__variant;
  if (id == null || id === '') return null;
  const vid = String(id).trim().toUpperCase().slice(0, 33);
  const def = await require('./builtDefinitions').publishedDef(vid);
  if (!def || def.kind !== 'variant') throw new HttpsError('invalid-argument', 'Unknown variant: ' + vid);
  const f = data.__variantFields;
  return { id: def.id, base: def.base, label: def.label, prefix: def.numbering.prefix, fields: f && typeof f === 'object' && !Array.isArray(f) ? f : null };
}

// Who may call (docs/modules/CALLABLE_ACCESS.md, Q489-Q491), options.access:
//   'user' (the default): signed in, with an Active ERP profile within its
//     AccessUntil (requireUser), checked before the handler runs;
//   'portal': signed in; the handler checks the employee itself (essPortal,
//     whose users have no ERP profile);
//   'public': anyone (the sign-in screen's own calls; the list is in
//     unit/callableAccess, which checks it both ways).
// The sign-in check comes before anything is read; fn.access says which.
const ACCESS = ['user', 'portal', 'public'];

function onCallInCorporate(options, handler) {
  const { access = 'user', ...onCallOpts } = options || {};
  if (!ACCESS.includes(access)) throw new Error('Unknown access: ' + access);
  const fn = onCall(onCallOpts, (request) => perf.timed(async () => {
    const corporate = await resolveCorporate(request);
    perf.setCorporate(corporate && corporate.id);
    if (access !== 'public' && !(request.auth && request.auth.uid)) throw new HttpsError('unauthenticated', 'Please sign in again.');
    // The published built modules join the registry (MODULE_BUILDER.md; the firm's, at most every 30 s).
    await require('./builtDefinitions').refresh();
    // A call from a variant's screen (MODULE_BUILDER.md, phase 4): checked, then the request runs in it.
    const variant = await variantOf(request.data);
    return runInCorporate(corporate, async () => {
      // Once per request: the handler's own requireUser reuses it (auth.js).
      if (access === 'user') await require('./auth').requireUser(request);
      return require('./variantContext').runWithVariant(variant, () => handler(request));
    });
  }));
  fn.inCorporate = handler;
  fn.access = access;
  return fn;
}

// onCallInCorporate, plus one guarantee the original GAS functions had: the
// user sees WHY a call failed. Shared logic throughout this codebase
// (stockMovement's insufficient-stock guard, approvals, permission
// checks, the lock timeout) throws plain Errors, and Cloud Functions
// deliberately replaces any non-HttpsError with a bare "INTERNAL" on
// the client — so a blocked reversal or a missing permission showed
// the user nothing actionable. The original caught every error and
// returned err.message to the screen; this does the same, as an
// HttpsError('failed-precondition'), while still logging the full
// error (with stack) server-side. HttpsErrors pass through untouched.
function onCallWithMessages(options, handler) {
  return onCallInCorporate(options, async (request) => {
    try {
      // A closed month's payroll / depreciation adjustment the user agreed to
      // (docs/modules/PERIOD_CLOSING.md, step 1c): seen by the GL writer.
      // ...and a budget overrun the user chose to go ahead with (docs/modules/BUDGET.md, step B3).
      const d = request.data || {};
      return await require('./periodLock').runWithConsent(d.adjustInOpenMonth,
        () => require('./budgetConsent').runWithBudgetConsent(d.budgetConsent, () => handler(request)));
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error(err);
      throw new HttpsError('failed-precondition', (err && err.message) || 'Something went wrong.');
    }
  });
}

module.exports = { onCallInCorporate, onCallWithMessages };
