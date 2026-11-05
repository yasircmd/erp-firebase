// One module title (owner, 2026-11-04): the shell hides a screen's own
// heading (h2.text-2xl and the area line above it) on screen, so the app
// bar's title is the module's one name. Every screen with such a heading
// must therefore set #app-title itself, or the bar would show the last
// module's name (the Project Report did not).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../../../screens');

test('every screen with its own heading sets the app bar title', () => {
  const missing = fs.readdirSync(dir).filter(f => f.endsWith('.html')).filter(f => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    return /<h2 class="text-2xl font-bold/.test(s) && !/app-title/.test(s);
  });
  assert.deepEqual(missing, []);
});

test('the shell hides the screens\' own heading on screen only', () => {
  const s = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
  const i = s.indexOf('---------- ENTRY LAYOUT CSS ----------'), j = s.indexOf('---------- END ENTRY LAYOUT CSS ----------');
  const block = s.slice(i, j);
  assert.match(block, /@media screen \{\s*#module-container h2\.text-2xl\.font-bold,\s*#module-container div\.uppercase\.mb-1:has\(\+ h2\.text-2xl\.font-bold\) \{ display: none; \}/);
});
