// Sign-in by Corporate ID (docs/modules/MULTI_CORPORATE.md §2, M1) in the
// real public/index.html, headless. No emulators needed: the Firebase SDK
// is replaced with stubs that keep one Auth per Firebase app, as the real
// SDK does, so this checks the shell's own part: Corporate 100 signs in to
// this project's Auth and calls as always; a client corporate (200) signs
// in to its own Auth, and every call then carries its corporate and that
// Auth's token; the corporate is remembered for a reload; signing in to
// another corporate leaves the first; an unknown Corporate ID is refused
// before any sign-in; a password reset comes from the corporate entered.
//   node functions/test/ui/corporateSignIn.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const INDEX = fs.readFileSync(path.join(__dirname, '../../../public/index.html'));
const ESS = fs.readFileSync(path.join(__dirname, '../../../public/ess.html'));
const SDK = {
  'firebase-app.js': `
    export function initializeApp(options, name) { return { name: name || '[DEFAULT]', options }; }`,
  'firebase-auth.js': `
    const auths = {};
    const KEY = n => 'stub-user:' + n;
    function emit(a) { a.subs.forEach(cb => setTimeout(() => cb(a.currentUser), 0)); }
    function userOf(name, uid) { return uid && { uid, getIdToken: async () => 'tok:' + name + ':' + uid }; }
    export function getAuth(app) {
      if (!auths[app.name]) auths[app.name] = { app, subs: [], currentUser: userOf(app.name, sessionStorage.getItem(KEY(app.name))) };
      return auths[app.name];
    }
    export function onAuthStateChanged(a, cb) {
      a.subs.push(cb); setTimeout(() => cb(a.currentUser), 0);
      return () => { a.subs = a.subs.filter(x => x !== cb); };
    }
    export async function signOut(a) { a.currentUser = null; sessionStorage.removeItem(KEY(a.app.name)); window.__log.push('signOut ' + a.app.name); emit(a); }
    export async function signInWithEmailAndPassword(a, email, password) {
      window.__log.push('signIn ' + a.app.name + ' ' + email);
      const uid = ((window.__accounts || {})[a.app.name] || {})[email + ':' + password];
      if (!uid) { const e = new Error('bad'); e.code = 'auth/invalid-credential'; throw e; }
      a.currentUser = userOf(a.app.name, uid); sessionStorage.setItem(KEY(a.app.name), uid); emit(a);
    }
    export async function sendPasswordResetEmail(a, email) { window.__log.push('reset ' + a.app.name + ' ' + email); }
    export async function reauthenticateWithCredential() {}
    export async function updatePassword() {}
    export const EmailAuthProvider = { credential() {} };`,
  'firebase-functions.js': `
    export function getFunctions() { return {}; }
    export function httpsCallable(_i, name) { return async (arg) => ({ data: await window.__stub(name, arg) }); }`
};

function stubs() {
  window.__log = [];
  window.__calls = [];
  window.__accounts = {
    '[DEFAULT]': { 'admin@firm.test:pw100': 'u-admin', 'emp-0007@ess.invalid:e100': 'u-emp7' },
    'corp-200-erp-client-demo': { 'cara@client.test:pw200': 'u-cara', 'emp-0001@ess.invalid:e200': 'u-emp1' }
  };
  const tree = [{ depth: 0, text: 'Accounts Payable' }, { depth: 1, text: 'Vendor Invoice', moduleId: 'VENDORINVOICE' }];
  window.__stub = async (name, arg) => {
    window.__calls.push({ name, arg });
    const env = arg && arg.__corporate;
    const data = env ? arg.__data : arg;
    switch (name) {
      case 'corporateSignIn': {
        const id = String(data && data.corporateId || '').trim();
        if (id === '100') return { corporateId: '100', home: true };
        if (id === '200') return { corporateId: '200', home: false, webConfig: { apiKey: 'demo-key', authDomain: 'erp-client-demo.firebaseapp.com', projectId: 'erp-client-demo', appId: '1:1:web:1' } };
        throw new Error('Invalid Corporate ID.');
      }
      case 'userIdSignIn': {
        // The server's answer (session.js): the email, once the password is right.
        const corp = String(data.corporateId || '');
        const known = { '100:admin': 'admin@firm.test', '200:cara': 'cara@client.test' }[corp + ':' + String(data.userId).toLowerCase()];
        const auth = corp === '100' ? '[DEFAULT]' : 'corp-200-erp-client-demo';
        if (known && window.__accounts[auth][known + ':' + data.password]) return { email: known };
        throw new Error('Invalid user ID or password. A user ID shared by two users signs in by email.');
      }
      case 'completeLogin':
      case 'restoreSession':
        return { fullName: env ? 'Cara Client' : 'Admin User', roleName: 'Administrator', data: tree };
      case 'getMyTree': return tree;
      case 'essPortal': return { me: { MustChange: true, FullName: 'Cara Client', EmployeeNo: 'EMP-0001' }, today: '2026-10-19' };
      default: return [];
    }
  };
}

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 400)]); }); }

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/ess.html') ? ESS : INDEX); }).listen(8137);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('https://www.gstatic.com/firebasejs/**', route => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[file] });
  });
  await ctx.addInitScript(stubs);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const calls = () => page.evaluate(() => window.__calls);
  const log = () => page.evaluate(() => window.__log);
  const remembered = () => page.evaluate(() => localStorage.getItem('erp-corporate'));
  const signIn = async (corp, email, pw) => {
    await page.waitForSelector('#login-card:not(.hidden)');
    await page.fill('#corporate-id', corp); await page.fill('#email', email); await page.fill('#password', pw);
    await page.evaluate(() => { window.__calls = []; window.__log = []; });
    await page.click('#login-btn');
  };
  const signedIn = () => page.waitForSelector('#app-container:not(.hidden) #tree-container li[data-module-id]', { state: 'attached', timeout: 15000 });
  const signOut = async () => { await page.evaluate(() => handleLogout()); await page.waitForSelector('#login-card:not(.hidden)'); };

  await page.goto('http://127.0.0.1:8137/');

  await check('Corporate 100: this project\'s Auth, calls as always, nothing remembered', async () => {
    assert.equal(await page.inputValue('#corporate-id'), '', 'the field starts empty');
    assert.deepEqual(await page.$eval('#corporate-id', el => [el.name, el.autocomplete]), ['corporateId', 'on'], 'one the browser can save');
    await signIn('100', 'admin@firm.test', 'pw100');
    await signedIn();
    assert.deepEqual(await log(), ['signIn [DEFAULT] admin@firm.test']);
    const c = await calls();
    assert.deepEqual(c.find(x => x.name === 'completeLogin').arg, { corporateId: '100' });
    assert.ok(c.every(x => !(x.arg && x.arg.__corporate)), 'no call carries a corporate');
    assert.equal(await remembered(), null);
    await signOut();
  });

  await check('a user ID instead of the email: its email from the corporate, then the usual sign-in (decision 271)', async () => {
    assert.equal(await page.getAttribute('#email', 'type'), 'text', 'not an email-only field');
    await signIn('200', 'Cara', 'wrong');
    await page.waitForSelector('#login-error-msg:not(.hidden)');
    assert.equal(await page.textContent('#login-error-msg'), 'Invalid user ID or password. A user ID shared by two users signs in by email.');
    assert.deepEqual((await log()).filter(x => x.startsWith('signIn')), [], 'no sign-in attempted');
    await signIn('200', 'Cara', 'pw200');
    await signedIn();
    const c = await calls();
    assert.deepEqual(c.find(x => x.name === 'userIdSignIn').arg, { corporateId: '200', userId: 'Cara', password: 'pw200' }, 'asked outside any corporate, like the Corporate ID');
    assert.ok((await log()).includes('signIn corp-200-erp-client-demo cara@client.test'));
    await signOut();
    // An email never asks for one.
    await signIn('100', 'admin@firm.test', 'pw100');
    await signedIn();
    assert.ok(!(await calls()).some(x => x.name === 'userIdSignIn'));
    await signOut();
  });

  await check('an unknown Corporate ID is refused before any sign-in', async () => {
    await signIn('999', 'admin@firm.test', 'pw100');
    await page.waitForSelector('#login-error-msg:not(.hidden)');
    assert.equal(await page.textContent('#login-error-msg'), 'Invalid Corporate ID.');
    assert.deepEqual(await log(), []);
    assert.equal(await page.isEnabled('#login-btn'), true);
  });

  await check('a client corporate: its own Auth, and every call carries its corporate and token', async () => {
    await signIn('200', 'cara@client.test', 'wrong');
    await page.waitForSelector('#login-error-msg:not(.hidden)');
    assert.equal(await page.textContent('#login-error-msg'), 'Invalid email (or user ID) or password.');
    await signIn('200', 'cara@client.test', 'pw200');
    await signedIn();
    assert.ok((await log()).includes('signIn corp-200-erp-client-demo cara@client.test'), JSON.stringify(await log()));
    const c = await calls();
    assert.equal(c[0].name, 'corporateSignIn');
    assert.deepEqual(c[0].arg, { corporateId: '200' }, 'the lookup itself carries no corporate');
    assert.deepEqual(c.find(x => x.name === 'completeLogin').arg, { __corporate: { id: '200', idToken: 'tok:corp-200-erp-client-demo:u-cara' }, __data: { corporateId: '200' } });
    const after = c.slice(c.findIndex(x => x.name === 'completeLogin'));
    assert.ok(after.length > 2 && after.every(x => x.arg && x.arg.__corporate && x.arg.__corporate.id === '200'), 'every call after sign-in: ' + after.map(x => x.name).join(','));
    assert.equal(await page.textContent('#user-info-name'), 'Cara Client');
    assert.equal(JSON.parse(await remembered()).corporateId, '200');
  });

  await check('a reload restores the same corporate\'s session', async () => {
    await page.reload();
    await signedIn();
    const c = await calls();
    assert.deepEqual(c.find(x => x.name === 'restoreSession').arg, { __corporate: { id: '200', idToken: 'tok:corp-200-erp-client-demo:u-cara' }, __data: null });
    assert.equal(await page.inputValue('#corporate-id'), '', 'the field still starts empty');
    await signOut();
    assert.equal(await page.inputValue('#corporate-id'), '', 'and is empty after signing out');
  });

  await check('a password reset comes from the corporate entered, without switching to it', async () => {
    await page.evaluate(() => { window.__log = []; switchTab('changePassword'); });
    assert.equal(await page.inputValue('#pwd-corporate-id'), '', 'empty, as on Sign In');
    await page.fill('#pwd-corporate-id', '100'); await page.fill('#pwd-email', 'admin@firm.test');
    await page.click('#pwd-btn');
    await page.waitForSelector('#pwd-msg:not(.hidden)');
    assert.deepEqual(await log(), ['reset [DEFAULT] admin@firm.test']);
    assert.equal(await page.evaluate(() => window.__firebaseSdk.corporateId), '200', 'still 200');
    await page.fill('#pwd-corporate-id', '999'); await page.fill('#pwd-email', 'x@y.test');
    await page.click('#pwd-btn');
    await page.waitForFunction(() => document.getElementById('pwd-msg').textContent === 'Invalid Corporate ID.');
    await page.evaluate(() => switchTab('login'));
  });

  await check('signing in to another corporate leaves the first', async () => {
    await signIn('200', 'cara@client.test', 'pw200');
    await signedIn();
    // Signed in to 200; the user signs out and in to 100 on the same device.
    await signOut();
    await signIn('100', 'admin@firm.test', 'pw100');
    await signedIn();
    assert.ok((await log()).includes('signOut corp-200-erp-client-demo'), JSON.stringify(await log()));
    const c = await calls();
    assert.ok(c.filter(x => x.name !== 'corporateSignIn').every(x => !(x.arg && x.arg.__corporate)), 'back to 100\'s calls');
    assert.equal(await remembered(), null, '100 is not remembered');
    await page.reload();
    await signedIn();
    assert.equal(await page.textContent('#user-info-name'), 'Admin User', 'the reload restores 100');
  });

  await check('the Employee Portal: Corporate ID first, the same corporate sign-in', async () => {
    await page.evaluate(() => handleLogout());
    await page.goto('http://127.0.0.1:8137/ess.html');
    await page.waitForSelector('#v-signin:not(.hidden)');
    assert.equal(await page.inputValue('#si-corporate'), '', 'the field starts empty');
    assert.deepEqual(await page.$eval('#si-corporate', el => [el.name, el.autocomplete]), ['corporateId', 'on']);
    const essIn = async (corp, code, pw) => {
      await page.evaluate(() => { window.__calls = []; window.__log = []; });
      for (let i = 0; i < 20; i++) { // the page focuses the code 50 ms after showing it: typing before then can land in the wrong field
        await page.fill('#si-corporate', corp); await page.fill('#si-code', code); await page.fill('#si-password', pw); await page.waitForTimeout(100);
        if (await page.evaluate(v => ['si-corporate', 'si-code', 'si-password'].every((id, k) => document.getElementById(id).value.toUpperCase() === v[k].toUpperCase()), [corp, code, pw])) break;
      }
      await page.click('#si-submit');
    };
    await essIn('999', 'EMP-0001', 'e200');
    await page.waitForSelector('#si-error:not(.hidden)');
    assert.equal(await page.textContent('#si-error'), 'Invalid Corporate ID.');
    assert.deepEqual(await log(), [], 'no sign-in attempted');
    await essIn('200', 'EMP-0001', 'e200');
    await page.waitForSelector('#v-change:not(.hidden)');
    assert.ok((await log()).includes('signIn corp-200-erp-client-demo emp-0001@ess.invalid'), JSON.stringify(await log()));
    const portal = (await calls()).find(x => x.name === 'essPortal');
    assert.deepEqual(portal.arg, { __corporate: { id: '200', idToken: 'tok:corp-200-erp-client-demo:u-emp1' }, __data: { action: 'me' } });
    assert.equal(JSON.parse(await remembered()).corporateId, '200', 'shared with the ERP sign-in');
    await page.reload();
    await page.waitForSelector('#v-change:not(.hidden)');
    assert.equal(await page.inputValue('#si-corporate'), '', 'still empty after a reload');
    assert.equal((await calls()).find(x => x.name === 'essPortal').arg.__corporate.id, '200', 'restored in 200');
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });

  await browser.close(); server.close();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : 'all ' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
