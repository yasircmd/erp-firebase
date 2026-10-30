// The Employee Portal page for UI checks: public/ess.html with its Firebase
// SDK block swapped for one that signs in through the Auth emulator and
// calls the functions emulator directly (essPortal.ui.js, essRequests.ui.js).
const fs = require('fs');
const path = require('path');
const { PROJECT } = require('../emulator/_helpers');
const AUTH = 'http://127.0.0.1:9099';

// public/ess.html with its Firebase SDK block swapped for one that signs in
// through the Auth emulator and calls the functions emulator directly.
function portalPage() {
  const page = fs.readFileSync(path.join(__dirname, '../../../public/ess.html'), 'utf8');
  const a = page.indexOf('<!-- ---------- ESS SDK ---------- -->'), b = page.indexOf('<!-- ---------- END ESS SDK ---------- -->');
  if (a < 0 || b < 0) throw new Error('could not locate the SDK block');
  const stub = `<script>
  (function () {
    const KEY = 'ess-test-user';
    let user = null;
    try { user = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { user = null; }
    const preset = new URLSearchParams(location.search).get('uid');
    if (preset) user = { uid: preset };
    const subs = [];
    const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(user)); } catch (e) {} };
    const emit = () => subs.forEach(cb => cb(user));
    const b64 = o => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\\+/g, '-').replace(/\\//g, '_');
    const token = uid => { const now = Math.floor(Date.now() / 1000); return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/${PROJECT}', aud: '${PROJECT}', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600 }) + '.'; };
    const CODES = { INVALID_LOGIN_CREDENTIALS: 'auth/invalid-credential', INVALID_PASSWORD: 'auth/wrong-password', EMAIL_NOT_FOUND: 'auth/user-not-found', USER_DISABLED: 'auth/user-disabled' };
    window.__essLog = [];
    window.__ess = {
      // Corporate 100 only (a client corporate's sign-in is in
      // corporateSignIn.ui.js): the Corporate ID is checked by the server.
      corporateId: () => '100',
      useCorporate: async id => {
        const res = await fetch('http://127.0.0.1:5001/${PROJECT}/us-central1/corporateSignIn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { corporateId: id } }) });
        const body = await res.json();
        if (body.error) throw new Error(body.error.message);
        if (!body.result.home) throw new Error('This test page signs in to Corporate 100 only.');
      },
      signIn: async (email, password) => {
        const res = await fetch('${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
        const body = await res.json();
        if (body.error) { const e = new Error(body.error.message); e.code = CODES[String(body.error.message).split(' ')[0]] || 'auth/unknown'; throw e; }
        user = { uid: body.localId }; save(); setTimeout(emit, 0);
        return { uid: user.uid };
      },
      signOut: async () => { user = null; save(); setTimeout(emit, 0); },
      onUser: cb => { subs.push(cb); setTimeout(() => cb(user), 0); },
      call: async (name, data) => {
        const res = await fetch('http://127.0.0.1:5001/${PROJECT}/us-central1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(user.uid) }, body: JSON.stringify({ data }) });
        const body = await res.json();
        window.__essLog.push({ name, action: data && data.action, ok: !body.error });
        if (body.error) throw new Error(body.error.message);
        return body.result;
      }
    };
    window.dispatchEvent(new Event('ess-sdk-ready'));
  })();
  </script>`;
  return page.slice(0, a) + stub + page.slice(b);
}


// A browser context on a phone (or as opts say) with the Tailwind styles:
// from the CDN, else from ESS_TAILWIND_CSS where the CDN is blocked.
const BUILT_ESS = path.join(__dirname, '../../../public/css/ess.css');
const twFile = process.env.ESS_TAILWIND_CSS || (fs.existsSync(BUILT_ESS) ? BUILT_ESS : '');
const twCss = twFile ? fs.readFileSync(twFile, 'utf8') : null;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function portalContext(browser, opts) {
  const ctx = await browser.newContext(Object.assign({}, PHONE, opts || {}));
  await ctx.route('https://cdn.tailwindcss.com/**', async route => {
    try { await route.fulfill({ response: await route.fetch() }); } catch (e) {
      if (!twCss) throw new Error('the Tailwind CDN is unreachable: set ESS_TAILWIND_CSS');
      await route.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = {}; (function () { const s = document.createElement("style"); s.textContent = ' + JSON.stringify(twCss) + '; document.head.appendChild(s); })();' });
    }
  });
  // The portal links /css/ess.css, built ahead of time (docs/modules/PWA.md).
  await ctx.route('**/css/ess.css', route => {
    if (!twCss) throw new Error('no built styles: run tools/build-styles.sh (or set ESS_TAILWIND_CSS)');
    return route.fulfill({ contentType: 'text/css', body: twCss });
  });
  return ctx;
}

module.exports = { portalPage, portalContext, AUTH, PHONE };
