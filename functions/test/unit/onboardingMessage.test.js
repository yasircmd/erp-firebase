// The covering message to a client (docs/ONBOARDING_MESSAGE.md, owner
// 2026-10-24) restates facts of ONBOARDING.md's Part A. This keeps them in
// step: the grants' "OK" lines, the functions' account, the domains, and
// the deploy account left as a placeholder (it stays out of this public
// repository).
//   node --test functions/test/unit/onboardingMessage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const guide = fs.readFileSync(path.join(REPO, 'docs/ONBOARDING.md'), 'utf8');
const message = fs.readFileSync(path.join(REPO, 'docs/ONBOARDING_MESSAGE.md'), 'utf8');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

test('the message says as many "OK" lines as the guide\'s grants print', () => {
  const loops = [...guide.matchAll(/for R in ([^;]+); do/g)].map(m => m[1].trim().split(/\s+/));
  assert.equal(loops.length, 2, 'the two grant loops');
  const n = loops.reduce((a, l) => a + l.length, 0);
  assert.match(guide, new RegExp('prints ' + WORDS[n] + ' "OK" lines'));
  assert.match(message, new RegExp('print ' + WORDS[n] + ' "OK" lines'));
});

test('the same account, domains and steps; the deploy account only as a placeholder', () => {
  const app = guide.match(/APP=serviceAccount:(\S+)/)[1];
  assert.ok(message.includes(app), 'the functions\' account');
  for (const d of ['erp1-8f4cd.web.app', 'erp1-8f4cd.firebaseapp.com', 'us-central1']) {
    assert.ok(guide.includes(d) && message.includes(d), d);
  }
  assert.match(message, /\[DEPLOY ACCOUNT EMAIL\]/);
  assert.doesNotMatch(message, /`(?!name@)[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com`/, 'no real deploy account (the form `name@…` only)');
  assert.match(message, /the \*\*first\*\* switch/, 'Email/Password, as the dry run found it');
  assert.match(message, /valid for one hour/);
});
