// Every yellow, amber or orange text colour a screen or the shell uses has a
// light-theme override (public/index.html, LIGHT THEME): the dark theme's pale
// yellows are hard to read on white (owner, 2026-11-06; docs/modules/UX_ROUND3.md item 2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');

test('each yellow / amber / orange text class in use is darkened in the light theme', () => {
  const shell = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const files = fs.readdirSync(path.join(root, 'screens')).filter(f => f.endsWith('.html')).map(f => path.join(root, 'screens', f)).concat([path.join(root, 'public/index.html')]);
  const used = new Set();
  files.forEach(f => (fs.readFileSync(f, 'utf8').match(/\btext-(yellow|amber|orange|lime)-[1-4]00(\/\d+)?\b/g) || []).forEach(c => used.add(c)));
  assert.ok(used.has('text-amber-300'), 'the classes are found');
  const missing = [...used].filter(c => !shell.includes('[data-theme="light"] .' + c.replace('/', '\\/') + ' {'));
  assert.deepEqual(missing, []);
});
