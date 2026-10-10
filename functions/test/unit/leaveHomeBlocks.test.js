// "On Leave Today" and "Leave Returns to Record" (docs/modules/HR_LEAVE.md,
// step 4; payroll step 7, decision 59) moved from ERP Home to the Employee
// Portal (owner, 2026-10-10; docs/modules/EMPLOYEE_PORTAL.md): the line
// manager sees them in Team (and a Home card), the employee their own
// return due on Home. This guards the wiring on both sides.
//   node --test functions/test/unit/leaveHomeBlocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const shell = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
const ess = fs.readFileSync(path.join(__dirname, '../../../public/ess.html'), 'utf8');

test('ERP Home no longer shows or counts them', () => {
  for (const id of ['home-leave-today', 'home-leave-returns']) assert.doesNotMatch(shell, new RegExp('id="' + id + '-(block|list)"'));
  assert.doesNotMatch(shell, /getLeaveTasksForUser|renderLeaveTasks|homeLeaveTodayCount|homeLeaveReturnsCount/);
});

test('the portal shows them: Team (away today, returns due) and Home (own return, the team card)', () => {
  const team = ess.slice(ess.indexOf('function pageTeam('), ess.indexOf('async function decide('));
  assert.match(team, /id="tm-away"/);
  assert.match(team, /id="tm-returns"/);
  assert.match(team, /awayHtml \+ returnsHtml/);
  const home = ess.slice(ess.indexOf('function pageHome('), ess.indexOf('// ---------- Leave ----------'));
  assert.match(home, /h\.myReturnDue \?/);
  assert.match(home, /id="home-team-away"/);
});
