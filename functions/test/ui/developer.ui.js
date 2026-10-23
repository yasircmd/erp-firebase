// The Developer screen (docs/modules/MULTI_CORPORATE.md, M2) in the shell
// harness, Corporate 100: the corporates listed; one added (a wrong entry
// told plainly); the connection test; modules ticked off; internal notes
// added, edited and deleted (owner and due date only for a task or bug);
// the tree given the main one; a Viewer sees it read-only.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/developer.ui.js
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const admin = require('firebase-admin');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { call, reset, baseFixture, firestore, rtdb } = require('../emulator/_helpers');
let promptAnswer = '';

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'dev-ui-client');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.tree = { N1: { Text: 'Finance', ParentID: '', Order: 0, ModuleID: '', AllowedRoles: ['Admin'] }, N2: { Text: 'Journal Entry', ParentID: 'N1', Order: 1, ModuleID: 'JV', AllowedRoles: ['Admin'] } };
  await reset(f);
  await firestore.doc('corporateDirectory/200').set({ Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', WebConfig: { apiKey: 'demo-key', projectId: CLIENT }, Modules: {} });
  const c = baseFixture();
  c.users = { 'u-cara': { status: 'Active', role: 'Admin', username: 'cara', fullName: 'Cara Client' } };
  delete c.tree;
  delete c.coa; // an empty chart, for the headings
  await clientApp.database().ref('/').set(c);
  // The emulator starts each function on its first call: start them before the browser times them.
  for (const fn of ['getDeveloperCorporates', 'getDeveloperNotes', 'getDeveloperTree', 'testDeveloperCorporate']) await call('u-admin', fn, { CorporateID: '200' }).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8191);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); if (d.type() === 'prompt') d.accept(promptAnswer); else d.accept(); });
    await page.goto('http://127.0.0.1:8191/?module=DEVELOPER&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#dv-list tr[data-id="200"]', { timeout: 30000 });
    return page;
  }
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const dialogs = async (p, n) => { for (let i = 0; i < 300 && p.__dialogs.length < n; i++) await new Promise(r => setTimeout(r, 100)); };
  const entry = async id => (await firestore.doc('corporateDirectory/' + id).get()).data();
  const p = await open('u-admin');

  await check('the list; a corporate added, a wrong entry told plainly', async () => {
    assert.match(await p.textContent('#dv-list tr[data-id="200"]'), /200\s*Demo client\s*erp-client-demo\s*Active/);
    await p.click('#dv-add');
    assert.equal(await p.textContent('#dv-title'), 'New corporate');
    assert.equal(await p.isDisabled('#dv-tabs [data-tab="notes"]'), true, 'notes once saved');
    await p.fill('#dv-id', '300'); await p.fill('#dv-name', 'Third Co'); await p.fill('#dv-project', 'Third Co');
    await p.fill('#dv-dburl', 'https://third-co-erp-default-rtdb.firebaseio.com'); await p.fill('#dv-apikey', 'k3');
    await p.click('#dv-save');
    await dialogs(p, 1);
    assert.match(p.__dialogs[0], /project ID is the client's Firebase project ID/);
    await p.fill('#dv-project', 'third-co-erp');
    await p.click('#dv-save');
    await dialogs(p, 2);
    assert.equal(p.__dialogs[1], 'Saved.');
    await p.waitForSelector('#dv-list tr[data-id="300"]');
    assert.equal(await p.textContent('#dv-title'), '300 — Third Co');
    assert.equal((await entry('300')).WebConfig.authDomain, 'third-co-erp.firebaseapp.com');
  });

  await check('the connection test: each part told apart', async () => {
    await p.click('#dv-list tr[data-id="200"]');
    await p.click('#dv-test');
    await until(p, () => /Authentication/.test(document.getElementById('dv-test-result').textContent));
    const text = await p.textContent('#dv-test-result');
    assert.match(text, /Realtime Database: 1 ERP user\(s\)\s*Firestore: reachable\s*Authentication: reachable/);
    await until(p, () => /OK/.test(document.querySelector('#dv-list tr[data-id="200"]').textContent));
    // Still on screen after the list reloads (dry run, 2026-10-23), with the password check.
    await p.waitForTimeout(500);
    assert.equal(await p.isVisible('#dv-test-result'), true);
    assert.match(await p.textContent('#dv-test-result'), /Authentication: reachable, password sign-in on/);
  });

  await check('modules: one ticked off and saved; the always-on ones cannot be', async () => {
    p.__dialogs = [];
    await p.click('#dv-tabs [data-tab="modules"]');
    assert.equal(await p.isDisabled('#dv-modules input[data-mod="USERMGMT"]'), true);
    assert.equal(await p.locator('#dv-modules input[data-mod="DEVELOPER"]').count(), 0);
    await p.uncheck('#dv-modules input[data-mod="JV"]');
    await p.click('#dv-mod-save');
    await dialogs(p, 1);
    assert.equal(p.__dialogs[0], '1 module(s) switched off.');
    assert.deepEqual((await entry('200')).Modules, { JV: false });
    await until(p, () => /200\s*Demo client\s*erp-client-demo\s*Active\s*1/.test(document.querySelector('#dv-list tr[data-id="200"]').textContent));
  });

  await check('notes: a task with its owner and due date, a plain note without; edited, deleted', async () => {
    p.__dialogs = [];
    await p.click('#dv-tabs [data-tab="notes"]');
    await until(p, () => /No notes yet/.test(document.getElementById('dv-notes').textContent));
    await p.selectOption('#dv-note-type', 'Note');
    assert.equal(await p.isHidden('#dv-note-owner'), true, 'no owner for a plain note');
    await p.selectOption('#dv-note-type', 'Task');
    assert.equal(await p.isVisible('#dv-note-owner'), true);
    await p.fill('#dv-note-title', 'Set up payroll'); await p.fill('#dv-note-text', 'Before the first run');
    await p.selectOption('#dv-note-owner', 'u-approver'); await p.fill('#dv-note-due', '2026-11-01');
    await p.click('#dv-note-save');
    await until(p, () => /Set up payroll/.test(document.getElementById('dv-notes').textContent));
    assert.match(await p.textContent('#dv-notes'), /Task\s*Open\s*Approver\s*01\/11\/2026/, 'the due date shown dd/mm/yyyy');
    await until(p, () => /Active\s*1\s*1/.test(document.querySelector('#dv-list tr[data-id="200"]').textContent));
    await p.click('#dv-notes .dv-note-edit');
    assert.equal(await p.inputValue('#dv-note-title'), 'Set up payroll');
    await p.selectOption('#dv-note-status', 'Done');
    await p.click('#dv-note-save');
    await until(p, () => /Done/.test(document.getElementById('dv-notes').textContent));
    await p.click('#dv-notes .dv-note-del');
    await until(p, () => /No notes yet/.test(document.getElementById('dv-notes').textContent));
    assert.match(p.__dialogs[0], /Delete the note "Set up payroll"\?/);
  });

  await check('the tree: no menu yet, then given the main one', async () => {
    p.__dialogs = [];
    await p.click('#dv-tabs [data-tab="tree"]');
    await until(p, () => /No menu yet/.test(document.getElementById('dv-tree-status').textContent));
    await p.click('#dv-tree-reset');
    await until(p, () => /Follows the main tree/.test(document.getElementById('dv-tree-status').textContent));
    assert.match(p.__dialogs[0], /Give 200 the main tree\?/);
    assert.equal(await p.isHidden('#dv-tree-reset'), true, 'nothing to put back');
    // Set up says so at once, without opening the corporate again (dry run, 2026-10-23).
    await p.click('#dv-tabs [data-tab="setup"]');
    await until(p, () => /3\. Menu: given the main tree/.test(document.getElementById('dv-setup').textContent));
    assert.deepEqual(Object.values((await clientApp.database().ref('tree').get()).val()).map(n => n.Text).sort(), ['Finance', 'Journal Entry']);
  });

  await check('groups: one added, a corporate put in it', async () => {
    p.__dialogs = [];
    promptAnswer = 'Retail';
    await p.click('#dv-group-add');
    await until(p, () => /Retail\s*no corporate yet/.test(document.getElementById('dv-groups').textContent));
    assert.match(await p.textContent('#dv-groups'), /No module has come after the groups yet/);
    await p.click('#dv-list tr[data-id="200"]');
    await p.click('#dv-tabs [data-tab="connection"]');
    await p.selectOption('#dv-group', { label: 'Retail' });
    await p.click('#dv-save');
    await until(p, () => /Retail\s*200/.test(document.getElementById('dv-groups').textContent));
    assert.ok((await entry('200')).Group);
  });

  await check('set up: the steps, the chart headings and the first Admin', async () => {
    p.__dialogs = [];
    await rtdb.ref('coa/H1').set({ AccountCode: '100000', AccountName: 'Assets', AccountType: 'Asset', NormalBalance: 'Debit', IsPostable: false, Status: 'Active', CompanyID: '' });
    await p.click('#dv-list tr[data-id="200"]');
    await p.click('#dv-tabs [data-tab="setup"]');
    const steps = await p.textContent('#dv-setup');
    assert.match(steps, /1\. Connection test: passed/);
    assert.match(steps, /2\. Rules: not yet: run the Deploy workflow's "database rules" task/);
    assert.match(steps, /3\. Menu: given the main tree/);
    assert.match(steps, /5\. First Admin: not yet/);
    await p.click('#dv-headings');
    await until(p, () => /4\. Chart headings: \d+ copied/.test(document.getElementById('dv-setup').textContent));
    assert.ok(Object.values((await clientApp.database().ref('coa').get()).val()).every(a => a.IsPostable === false), 'headings only');
    assert.equal(await p.isHidden('#dv-headings'), true, 'once');
    await p.fill('#dv-admin-name', 'Ann Admin'); await p.fill('#dv-admin-email', 'ann@client.test');
    await p.click('#dv-admin-create');
    await until(p, () => /5\. First Admin: Ann Admin <ann@client\.test>/.test(document.getElementById('dv-setup').textContent));
    assert.match(p.__dialogs.join(' | '), /Create Ann Admin <ann@client\.test> as 200's first Admin/);
    assert.equal((await clientApp.auth().getUserByEmail('ann@client.test')).email, 'ann@client.test', 'in the client\'s own Auth');
    assert.equal(await p.isHidden('#dv-admin-form'), true);
    // The password email again, from the corporate's own Auth (its link lasts an hour; dry run, 2026-10-23).
    await p.evaluate(() => { window.__firebaseSdk = { authFor: cfg => cfg, sendPasswordResetEmail: async (auth, email) => { window.__sent = [auth.corporateId, auth.webConfig.projectId, auth.webConfig.apiKey, email]; } }; });
    await p.click('#dv-admin-resend');
    await until(p, () => window.__sent);
    assert.deepEqual(await p.evaluate(() => window.__sent), ['200', 'erp-client-demo', 'demo-key', 'ann@client.test']);
    for (let i = 0; i < 50 && !p.__dialogs.some(x => /Sent to ann@client\.test\. The link lasts an hour\./.test(x)); i++) await p.waitForTimeout(100);
    assert.match(p.__dialogs.join(' | '), /Send ann@client\.test the email to set a password again\?.*Sent to ann@client\.test\. The link lasts an hour\./);
  });

  await check('a Viewer sees it read-only', async () => {
    const v = await open('u-viewer');
    assert.equal(await v.isHidden('#dv-add'), true);
    await v.click('#dv-list tr[data-id="200"]');
    assert.equal(await v.isHidden('#dv-save'), true);
    await v.click('#dv-tabs [data-tab="modules"]');
    assert.equal(await v.isDisabled('#dv-modules input[data-mod="COA"]'), true);
    assert.equal(await v.isHidden('#dv-mod-save'), true);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await check('no page errors', async () => { assert.deepEqual(p.__errors, []); });

  await browser.close(); server.close();
  await Promise.all(admin.apps.map(a => a.delete()));
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : 'all ' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
