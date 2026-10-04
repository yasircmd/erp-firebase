// The shell's Home blocks for leave (docs/modules/HR_LEAVE.md, step 4):
// "On Leave Today" and "Leave Returns to Record", filled from
// getLeaveTasksForUser, opening the leave, and counted in the Home tasks.
// (The Home view itself is checked in home.ui.js; this guards the wiring.)
//   node --test functions/test/unit/leaveHomeBlocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const shell = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');

test('both blocks are on Home, hidden until there is something to show', () => {
  for (const id of ['home-leave-today', 'home-leave-returns']) {
    assert.match(shell, new RegExp('<div id="' + id + '-block" class="hidden[^"]*">'));
    assert.match(shell, new RegExp('<div id="' + id + '-list"'));
  }
});

test('filled from getLeaveTasksForUser; each row opens its leave', () => {
  assert.match(shell, /\.withSuccessHandler\(result => \{ renderLeaveTasks\(result \|\| \{\}\); \}\)\s*\.withFailureHandler\(\(\) => \{ renderLeaveTasks\(\{\}\); \}\)\s*\.getLeaveTasksForUser\(\);/);
  const fn = shell.slice(shell.indexOf('function renderLeaveTasks('), shell.indexOf('function renderLeaveTasks(') + 3000);
  assert.match(fn, /openHomeTaskDocument\(item\.ModuleID, item\.DocumentID\)/);
  assert.match(fn, /toggle\('hidden', !today\.length\)/);
  assert.match(fn, /toggle\('hidden', !returns\.length\)/);
});

test('both are counted in the Home tasks total', () => {
  const fn = shell.slice(shell.indexOf('function updateHomeTasksToggleButton('), shell.indexOf('function updateHomeTasksToggleButton(') + 600);
  assert.match(fn, /homeLeaveTodayCount \+ homeLeaveReturnsCount/);
});
