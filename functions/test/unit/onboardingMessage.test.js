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

// The commands in the message are the guide's (owner, 2026-10-24: the
// client's IT runs them from the message), with the guide's placeholders
// for the project and the deploy account; and each role is named in words.
const block = text => {
  const m = text.match(/^ *```bash\n([\s\S]*?)^ *```$/m);
  assert.ok(m, 'a bash block');
  return m[1].split('\n').map(l => l.trim()).filter(Boolean);
};
const ROLE_NAMES = {
  'roles/firebasedatabase.admin': 'Firebase Realtime Database Admin', 'roles/datastore.user': 'Cloud Datastore User',
  'roles/firebaseauth.admin': 'Firebase Authentication Admin', 'roles/serviceusage.serviceUsageConsumer': 'Service Usage Consumer',
  'roles/firebaserules.admin': 'Firebase Rules Admin', 'roles/datastore.indexAdmin': 'Cloud Datastore Index Admin', 'roles/firebase.viewer': 'Firebase Viewer'
};

test('the message\'s grant commands are the guide\'s, placeholders aside', () => {
  const ours = block(message).map(l => l.replace('P=YOUR-PROJECT-ID', 'P=CLIENT_PROJECT').replace('serviceAccount:[DEPLOY ACCOUNT EMAIL]', 'serviceAccount:THE-FIRMS-DEPLOY-ACCOUNT'));
  assert.deepEqual(ours.map(l => l.replace(/\s+#.*$/, '')), block(guide).map(l => l.replace(/\s+#.*$/, '')));
});

test('every role granted is named in the message, for its account', () => {
  const [app, deploy] = [...guide.matchAll(/for R in ([^;]+); do/g)].map(m => m[1].trim().split(/\s+/));
  const part = (from, to) => message.slice(message.indexOf(from), message.indexOf(to, message.indexOf(from))).replace(/\s+/g, ' ');
  const appText = part('**Our application**', '**Our release service**'), deployText = part('**Our release service**', '*Service Usage Consumer* lets');
  app.forEach(r => assert.ok(ROLE_NAMES[r] && appText.includes('*' + ROLE_NAMES[r] + '*'), 'application: ' + r));
  deploy.forEach(r => assert.ok(ROLE_NAMES[r] && deployText.includes('*' + ROLE_NAMES[r] + '*'), 'release service: ' + r));
});
