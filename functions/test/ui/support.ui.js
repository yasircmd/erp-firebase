// Support (docs/modules/MULTI_CORPORATE.md, M3) in the shell harness: a
// client corporate's Admin (200) sends an issue with a screenshot, after
// confirming it is shared (Cancel sends nothing); the firm answers it from
// the Developer screen's queue (Corporate 100); the client answers back
// and closes it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/support.ui.js
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const admin = require('firebase-admin');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { call, reset, baseFixture, firestore } = require('../emulator/_helpers');

const CLIENT = 'erp-client-demo';
const CLIENT_DB = 'https://' + CLIENT + '-default-rtdb.firebaseio.com';
const clientApp = admin.initializeApp({ projectId: CLIENT, databaseURL: CLIENT_DB }, 'sup-ui-client');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  await firestore.doc('corporateDirectory/200').set({ Name: 'Demo client', ProjectID: CLIENT, DatabaseURL: CLIENT_DB, Status: 'Active', WebConfig: { apiKey: 'k', projectId: CLIENT }, Modules: {} });
  const c = baseFixture();
  c.users = { 'u-cara': { status: 'Active', role: 'Admin', username: 'cara', fullName: 'Cara Client', AssignedCompanies: ['C1'] } };
  await clientApp.database().ref('/').set(c);
  await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + CLIENT + '/accounts', { method: 'DELETE' });
  await clientApp.auth().createUser({ uid: 'u-cara' });
  for (const fn of ['getSupportIssues', 'getSupportIssue', 'submitSupportIssue', 'addSupportFile', 'replySupportIssue', 'getDeveloperCorporates']) await call('u-admin', fn, {}).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8193);
  const browser = await chromium.launch();
  async function open(query, ready, answer) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); if (answer && answer(d) === 'dismiss') d.dismiss(); else d.accept(); });
    await page.goto('http://127.0.0.1:8193/?' + query);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector(ready, { timeout: 30000 });
    return page;
  }
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const dialogs = async (p, n) => { for (let i = 0; i < 300 && p.__dialogs.length < n; i++) await new Promise(r => setTimeout(r, 100)); };
  let cancelNext = true;
  const p = await open('module=SUPPORT&uid=u-cara&corp=200&project=' + CLIENT, '#sp-list', d => {
    if (cancelNext && /Send it\?/.test(d.message())) { cancelNext = false; return 'dismiss'; }
    return 'accept';
  });

  await check('the warning; nothing sent when the sharing is not confirmed', async () => {
    assert.match(await p.textContent('#sp-warning'), /Shared with the support team/);
    await until(p, () => /No issues yet/.test(document.getElementById('sp-list').textContent));
    await p.click('#sp-new');
    await p.selectOption('#sp-type', 'Bug');
    await p.fill('#sp-title', 'Invoice total wrong');
    await p.selectOption('#sp-screen', 'CUSTOMERINVOICE');
    await p.fill('#sp-text', 'The total shows 0 after saving.');
    await p.setInputFiles('#sp-files', { name: 'screen.png', mimeType: 'image/png', buffer: PNG });
    await p.click('#sp-send');
    await dialogs(p, 1);
    assert.match(p.__dialogs[0], /kept in their account, outside your organisation's own/);
    await new Promise(r => setTimeout(r, 800));
    assert.equal((await firestore.collection('supportIssues').get()).size, 0, 'Cancel sent nothing');
  });

  await check('sent with its screenshot, numbered, shown with the file', async () => {
    p.__dialogs = [];
    await p.click('#sp-send');
    await dialogs(p, 2);
    assert.match(p.__dialogs[1], /Sent: 200-00001/);
    await until(p, () => /200-00001/.test(document.getElementById('sp-list').textContent));
    assert.match(await p.textContent('#sp-list'), /200-00001\s*Invoice total wrong\s*Bug\s*New\s*Cara Client/);
    await until(p, () => /screen\.png/.test(document.getElementById('sp-thread').textContent));
    assert.match(await p.textContent('#sp-issue-meta'), /Bug · New · Customer Invoice Processing · sent by Cara Client/);
  });

  await check('the firm\'s queue (Corporate 100): every corporate\'s, answered with a status', async () => {
    const d = await open('module=DEVELOPER&uid=u-admin', '#dv-pages');
    // On its own tab (owner, 2026-10-24), its count shown on the tab.
    await until(d, () => /\(1\)/.test(document.getElementById('dv-q-tab-count').textContent));
    assert.ok(await d.isHidden('#dv-q-list'));
    await d.click('#dv-pages [data-page="support"]');
    await d.waitForSelector('#dv-q-list tr[data-id]');
    assert.match(await d.textContent('#dv-q-list'), /200-00001\s*200 Demo client\s*Invoice total wrong\s*Bug\s*New/);
    await d.click('#dv-q-list tr[data-id]');
    await until(d, () => /The total shows 0/.test(document.getElementById('dv-q-thread').textContent));
    assert.match(await d.textContent('#dv-q-meta'), /release /);
    assert.match(await d.textContent('#dv-q-thread'), /screen\.png/);
    await d.fill('#dv-q-reply', 'Which invoice number?');
    assert.equal(await d.inputValue('#dv-q-status'), 'Waiting for you', 'the default');
    await d.click('#dv-q-send');
    await until(d, () => /Waiting for you/.test(document.getElementById('dv-q-list').textContent));
    assert.deepEqual(d.__errors, []);
    await d.close();
  });

  await check('the client sees the answer, answers back (confirmed again), and closes the issue', async () => {
    p.__dialogs = [];
    await p.click('#sp-refresh');
    await until(p, () => /Waiting for you/.test(document.getElementById('sp-list').textContent));
    await p.click('#sp-list tr[data-id]');
    await until(p, () => /Which invoice number\?/.test(document.getElementById('sp-thread').textContent));
    assert.match(await p.textContent('#sp-thread'), /Support · Admin User/);
    await p.fill('#sp-reply', 'INV-26-01-000001');
    await p.click('#sp-reply-send');
    await until(p, () => /In progress/.test(document.getElementById('sp-list').textContent));
    assert.match(p.__dialogs[0], /Send it\?/);
    await p.click('#sp-close');
    await until(p, () => /Closed/.test(document.getElementById('sp-issue-meta').textContent));
    assert.equal(await p.isHidden('#sp-reply-box'), true, 'no more answers on a closed issue');
  });

  await check('no page errors', async () => { assert.deepEqual(p.__errors, []); });

  await browser.close(); server.close();
  await Promise.all(admin.apps.map(a => a.delete()));
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : 'all ' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
