// Sign-in by user ID (owner, 2026-10-24, decision 271) checks the password
// through Google's sign-in with Corporate 100's public web API key, which
// must be the one public/index.html signs in with.
//   node --test functions/test/unit/userIdSignIn.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { HOME_WEB_API_KEY } = require('../../src/corporates');

test('Corporate 100\'s web API key is the page\'s', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
  const m = page.match(/apiKey: '([^']+)'/);
  assert.ok(m, 'the page has its key');
  assert.equal(HOME_WEB_API_KEY, m[1]);
});
