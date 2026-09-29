// The shell's MODULE LOADING block (public/index.html) is exercised by
// functions/test/ui/moduleLoading.ui.js through the UI harness, which has
// its own openModule. This checks the real shell is wired the same way:
// every opened module is watched, and the end of each server call is
// reported to it.
//   node --test functions/test/unit/shellLoading.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const shell = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');

test('openModule watches the module it injects, before initModule runs', () => {
  const open = shell.slice(shell.indexOf('function openModule('));
  assert.match(open, /injectHtmlWithScripts\(container, result\.html\);\s*watchModuleLoading\(container\);[\s\S]*?window\.initModule\(/);
});

test('the end of every server call is reported to it', () => {
  const finish = shell.slice(shell.indexOf('function __rpcFinish('), shell.indexOf('// ---------- RPC BRIDGE ----------'));
  assert.match(finish, /if \(__rpcPendingCount === 0\) \{[\s\S]*moduleLoadingIdle\(\);/);
  assert.match(shell, /function moduleLoadingIdle\(\) \{ if \(moduleLoading\) moduleLoading\.idle\(\); \}/);
});
