// User Management: Add New User right after an Edit creates a NEW user and
// leaves the edited one alone (bug, 2026-10-14: the edited user's id stayed
// in the hidden um-form-id, and the "new" user was saved over them).
// Last Login (recorded at sign-in, in UTC) shows in local time, dd/mm/yyyy.
// Needs the Auth emulator (the create path makes a real Auth account).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/userMgmt.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val, PROJECT } = require('../emulator/_helpers');

const AUTH = 'http://127.0.0.1:9099';
const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const up = await fetch(AUTH + '/').then(r => r.ok || r.status < 500, () => false);
  if (!up) throw new Error('Auth emulator not reachable on 127.0.0.1:9099 — refusing to create users (it would hit production Auth).');
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' }); // emulator-only endpoint
  const f = baseFixture();
  f.users['u-other'].lastLogin = '2026-10-14T05:07:00.000Z';
  // A leaver's last day of access (leaverAccess.js): one ended, one to come.
  f.users['u-other'].AccessUntil = '2026-01-31';
  f.users['u-viewer'].AccessUntil = '2099-12-31';
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8161);
  const browser = await chromium.launch();
  const page = await browser.newPage({ timezoneId: 'Asia/Dubai' }); // UTC+4, to show the local-time conversion
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8161/?module=USERMGMT&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  const row = text => page.locator('#um-table-body tr', { hasText: text });

  await check('Last Login: a sign-in shows in local time as dd/mm/yyyy HH:MM; never signed in shows Never', async () => {
    await row('Other Co').waitFor({ timeout: 30000 });
    const lastLogin = name => row(name).first().locator('td').nth(4).textContent();
    assert.equal((await lastLogin('Other Co')).trim(), '14/10/2026 09:07');
    assert.equal((await lastLogin('viewer')).trim(), 'Never');
  });

  await check('a leaver: the status shows access to come, or ended (owner, 2026-10-14)', async () => {
    const status = name => row(name).first().locator('td').nth(3).textContent();
    assert.match((await status('Other Co')).replace(/\s+/g, ' '), /Active ?Access ended 31\/01\/2026/);
    assert.match((await status('viewer')).replace(/\s+/g, ' '), /Active ?Leaving: access until 31\/12\/2099/);
    assert.doesNotMatch(await status('Admin'), /access/i);
  });

  await check('Add New User after an Edit: a new user is created, the edited one is unchanged', async () => {
    await row('viewer').first().waitFor({ timeout: 30000 });
    await row('viewer').first().locator('.um-edit').click();
    await page.waitForSelector('#um-modal:not(.hidden)');
    assert.equal(await page.inputValue('#um-form-fullname'), 'Viewer');
    await page.click('#um-modal-cancel');
    await page.click('#um-add-btn');
    await page.waitForSelector('#um-modal:not(.hidden)');
    assert.equal(await page.inputValue('#um-form-id'), '', 'the form starts with no user id');
    await page.fill('#um-form-username', 'newbie');
    await page.fill('#um-form-email', 'newbie@example.test');
    await page.fill('#um-form-fullname', 'New Person');
    await page.fill('#um-form-password', 'secret123');
    await page.click('#um-save-btn');
    await page.waitForFunction(() => document.getElementById('um-modal').classList.contains('hidden'), null, { timeout: 20000 });
    const viewer = await val('users/u-viewer');
    assert.equal(viewer.fullName, 'Viewer', 'the edited user keeps their name');
    assert.equal(viewer.role, 'Viewer');
    const users = (await val('users')) || {};
    const created = Object.entries(users).find(([, u]) => u.email === 'newbie@example.test');
    assert.ok(created, 'a new profile exists for the new user');
    assert.equal(created[1].fullName, 'New Person');
    await row('New Person').waitFor({ timeout: 20000 });
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
