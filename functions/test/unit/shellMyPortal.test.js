// My Portal in the ERP shell (docs/modules/EMPLOYEE_PORTAL.md, decision 89):
// since 2026-10-10 (owner) one link only, the first item of the user menu,
// in blue; no button in the top bar. Shown only to an ERP user linked to an
// employee record. (The menu is not in the UI harness, so this guards it.)
//   node --test functions/test/unit/shellMyPortal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const shell = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');

test('one My Portal link, first in the user menu, blue, hidden until the user is linked', () => {
  assert.doesNotMatch(shell, /id="my-portal-btn"/);
  assert.equal((shell.match(/href="\/ess\.html"/g) || []).length, 1);
  const panel = shell.slice(shell.indexOf('<div id="user-menu-panel"'));
  const firstItem = panel.slice(panel.indexOf('>') + 1).match(/<(a|button)\b[^>]*>/)[0];
  assert.match(firstItem, /id="my-portal-menu"/);
  assert.match(firstItem, /class="hidden [^"]*bg-indigo-600[^"]*text-white/);
  assert.match(shell, /document\.getElementById\('my-portal-menu'\)\.classList\.toggle\('hidden', !\(result && result\.linked\)\)/);
});
