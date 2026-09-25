const { onCall, HttpsError } = require('firebase-functions/v2/https');

// onCall, plus one guarantee the original GAS functions had: the
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
  return onCall(options, async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error(err);
      throw new HttpsError('failed-precondition', (err && err.message) || 'Something went wrong.');
    }
  });
}

module.exports = { onCallWithMessages };
