// Every Font Awesome icon the shell, the Employee Portal and the screens
// (shown inside the shell) use exists in the version loaded (6.0.0, from cdnjs): a newer icon name renders as
// a blank space (the portal's Team tab, owner 2026-10-11). The list is
// 6.0.0's own (@fortawesome/fontawesome-free@6.0.0, css/all.css).
//   node --test functions/test/unit/iconsExist.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const known = new Set(fs.readFileSync(path.join(__dirname, 'fixtures/fontawesome-6.0.0-icons.txt'), 'utf8').split('\n').filter(Boolean));
const STYLES = new Set(['fa-solid', 'fa-regular', 'fa-brands', 'fa-spin', 'fa-lg', 'fa-xs', 'fa-sm', 'fa-2x', 'fa-3x', 'fa-fw']);

for (const file of ['public/ess.html', 'public/index.html']) {
  test(file + ': loads Font Awesome 6.0.0 and uses only its icons', () => {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.0\.0\/css\/all\.min\.css/, 'the version the list is for');
    const missing = [...new Set(html.match(/fa-[a-z0-9-]+/g) || [])].filter(n => !STYLES.has(n) && !known.has(n));
    assert.deepEqual(missing, []);
  });
}

test('the screens use only 6.0.0\'s icons (they show inside the shell)', () => {
  const dir = path.join(root, 'screens');
  const missing = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const n of new Set(html.match(/fa-[a-z0-9-]+/g) || [])) if (!STYLES.has(n) && !known.has(n)) missing.push(f + ': ' + n);
  }
  assert.deepEqual(missing, []);
});
