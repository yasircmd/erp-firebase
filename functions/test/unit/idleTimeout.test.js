// The ERP signs an idle user out after 30 minutes (owner, 2026-11-06;
// docs/modules/UX_ROUND3.md item 9), warning 30 seconds before; the Help says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');

test('auto log-off after 30 minutes idle, the warning 30 seconds before; the Help agrees', () => {
  const shell = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(shell, /const IDLE_TIMEOUT_MS = 30 \* 60 \* 1000;/);
  assert.match(shell, /const IDLE_WARNING_LEAD_MS = 30 \* 1000;/);
  for (const page of ['getting-started', 'working-with-screens']) {
    const md = fs.readFileSync(path.join(root, 'help/pages', page + '.md'), 'utf8');
    assert.match(md, /30 minutes/, page);
    assert.doesNotMatch(md, /10 minutes/, page);
  }
});
