// Test connection's errors as one readable sentence (owner, 2026-10-24: for
// C101 the Authentication part showed Google's whole raw response).
//   node --test functions/test/unit/developerErrors.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shortError } = require('../../src/developer')._text;

// As the Admin SDK reported it for C101 (the project's name made up).
const SAY = 'Caller does not have required permission to use project client-test-x. Grant the caller the roles/serviceusage.serviceUsageConsumer role, or a custom role with the serviceusage.services.use permission, by visiting https://console.developers.google.com/iam-admin/iam?project=client-test-x and then retry. Propagation of the new permission may take a few minutes.';
const RAW = SAY + ' Raw server response: "' + JSON.stringify({
  error: { code: 403, message: SAY, errors: [{ message: SAY, domain: 'global', reason: 'forbidden' }], status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'USER_PROJECT_DENIED', domain: 'googleapis.com', metadata: { service: 'identitytoolkit.googleapis.com' } }] }
}) + '"';

test('a raw server response gives its own error message, once', () => {
  assert.equal(shortError(new Error(RAW)), SAY);
});

test('a plain message is kept, folded, and capped', () => {
  assert.equal(shortError(new Error('7 PERMISSION_DENIED:  Missing or insufficient\n permissions.')), '7 PERMISSION_DENIED: Missing or insufficient permissions.');
  const long = shortError(new Error('x'.repeat(1000)));
  assert.equal(long.length, 400);
  assert.ok(long.endsWith('...'));
  assert.equal(shortError('a string'), 'a string');
});

test('a raw response that is not JSON keeps the text before it', () => {
  assert.equal(shortError(new Error('Something failed. Raw server response: "<html>oops"')), 'Something failed.');
});
