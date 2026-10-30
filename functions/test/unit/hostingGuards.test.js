// The Hosting deploy's own checks (tools/deploy-hosting.sh), run here so a
// page that would stop the deploy fails the tests first: each page Hosting
// serves carries the real Firebase config (no REPLACE_ME anywhere in it,
// comments included, since the deploy greps the whole file), and public/
// holds nothing else. (A comment naming the placeholder stopped a Hosting
// deploy on 2026-10-10, run #121.)
//   node --test functions/test/unit/hostingGuards.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const PAGES = ['public/index.html', 'public/ess.html'];

test('the pages Hosting serves have no REPLACE_ME, and the real project config', () => {
  for (const p of PAGES) {
    const s = fs.readFileSync(path.join(REPO, p), 'utf8');
    const lines = s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('REPLACE_ME'));
    assert.deepEqual(lines.map(([n]) => p + ':' + n), [], 'deploy-hosting.sh stops on these');
    assert.match(s, /projectId: 'erp1-8f4cd'/, p + ': the Firebase config');
  }
});

// Besides the two pages: the public Help (docs/modules/HELP.md, decision
// 148), public/help/ and public/robots.txt, whose every file must be one the
// help build makes (functions/test/unit/help.test.js).
// And the installable app (docs/modules/PWA.md): its service worker, its two
// manifests, icons/ (PNGs only) and css/ (the two styles built at deploy; not
// committed, so absent until built).
test('the deploy script checks those pages, and public/ holds only them, its README, the built Help and the app\'s files', () => {
  const sh = fs.readFileSync(path.join(REPO, 'tools/deploy-hosting.sh'), 'utf8');
  for (const p of PAGES) assert.ok(sh.includes(p), 'deploy-hosting.sh names ' + p);
  const files = fs.readdirSync(path.join(REPO, 'public')).filter(n => n !== 'css').sort();
  assert.deepEqual(files, ['README.md', 'ess.html', 'ess.webmanifest', 'help', 'icons', 'index.html', 'manifest.webmanifest', 'robots.txt', 'sw.js']);
  assert.ok(fs.readdirSync(path.join(REPO, 'public/icons')).every(n => /^[a-z0-9-]+\.png$/.test(n)), 'public/icons/ holds only PNGs');
  if (fs.existsSync(path.join(REPO, 'public/css'))) assert.deepEqual(fs.readdirSync(path.join(REPO, 'public/css')).sort(), ['erp.css', 'ess.css'], 'public/css/ holds only the built styles');
  assert.ok(fs.readdirSync(path.join(REPO, 'public/help')).every(n => /^[a-z0-9-]+\.(html|css|js|json|xml)$/.test(n)), 'public/help/ holds only built files, no folders');
});
