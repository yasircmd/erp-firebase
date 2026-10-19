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
const { call, reset, baseFixture, firestore } = require('../emulator/_helpers');

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
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
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
    assert.deepEqual(Object.values((await clientApp.database().ref('tree').get()).val()).map(n => n.Text).sort(), ['Finance', 'Journal Entry']);
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
