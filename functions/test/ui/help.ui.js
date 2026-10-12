// Help (docs/modules/HELP.md, decisions 148-151) in headless Chromium, no
// emulators: the public site as Hosting serves it (public/ over plain HTTP)
// — the home page with every area, each page's links and sections resolving,
// search, "?m=MODULE" opening that screen's page or saying it is not written
// yet, robots.txt and the sitemap — and the shell's Help button (the real
// public/index.html with the Firebase SDK stubbed, as home.ui.js): the help
// home on Home, the open screen's page inside a screen, back to the home.
//   node functions/test/ui/help.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '../../../public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };
const SDK = {
  'firebase-app.js': 'export function initializeApp() { return {}; }',
  'firebase-auth.js': `
    const auth = { currentUser: { uid: 'u1' } };
    export function getAuth() { return auth; }
    export function onAuthStateChanged(_a, cb) { setTimeout(() => cb(auth.currentUser), 0); }
    export async function signOut() {}
    export async function signInWithEmailAndPassword() {}
    export async function sendPasswordResetEmail() {}
    export async function reauthenticateWithCredential() {}
    export async function updatePassword() {}
    export const EmailAuthProvider = { credential() {} };`,
  'firebase-functions.js': `
    export function getFunctions() { return {}; }
    export function httpsCallable(_i, name) { return async (arg) => ({ data: await window.__stub(name, arg) }); }`
};
function stubs() {
  const tree = [{ depth: 0, text: 'Purchasing' }, { depth: 1, text: 'Goods Receipt', moduleId: 'GRN' }];
  window.__stub = async (name, arg) => {
    switch (name) {
      case 'restoreSession': return { fullName: 'Test User', roleName: 'Administrator', data: tree };
      case 'getMyTree': return tree;
      case 'getModuleFragment': return { html: '<div id="stub-module">Module ' + arg.moduleId + '</div>', canWrite: true };
      default: return [];
    }
  };
}

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  // As Hosting: a file, or a folder's index.html; anything else 404.
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(PUBLIC, p);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(8192);
  const base = 'http://127.0.0.1:8192';
  const browser = await chromium.launch();
  const newPage = async () => { const p = await browser.newPage(); p.__errors = []; p.on('pageerror', e => p.__errors.push(e.message)); return p; };

  await check('the help site: every area on the home page; every link and section resolves; robots and sitemap', async () => {
    const p = await newPage();
    await p.goto(base + '/help/');
    const areas = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../help/areas.json'), 'utf8')).areas;
    assert.deepEqual(await p.$$eval('.card h3', hs => hs.map(h => h.textContent)), areas.map(a => a.title));
    assert.match(await p.textContent('.card'), /Getting started[\s\S]*Working with screens[\s\S]*Approvals/);
    assert.match(await p.textContent('main'), /Coming: Chart of Accounts/);
    // Crawl every page reachable from the home page.
    const seen = new Set(), queue = ['/help/'];
    while (queue.length) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      const r = await p.goto(base + u);
      assert.equal(r.status(), 200, u);
      const links = await p.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
      for (const href of links) {
        if (/^https?:/.test(href)) continue;
        const [f, anchor] = href.split('#');
        if (anchor) {
          const target = f ? '/help/' + f : u;
          const q = await newPage(); await q.goto(base + target);
          assert.equal(await q.locator('#' + anchor).count(), 1, u + ' → ' + href);
          await q.close();
        }
        if (f) queue.push('/help/' + f);
      }
    }
    assert.ok(seen.size >= 4, 'pages crawled: ' + [...seen].join(' '));
    const robots = await (await p.goto(base + '/robots.txt')).text();
    assert.match(robots, /Allow: \/help\/\nDisallow: \/\n\nSitemap: https:\/\/erp1-8f4cd\.web\.app\/help\/sitemap\.xml/);
    const sitemap = await (await p.goto(base + '/help/sitemap.xml')).text();
    assert.match(sitemap, /<loc>https:\/\/erp1-8f4cd\.web\.app\/help\/getting-started\.html<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a page: title, sections, the last review date as dd/mm/yyyy; search finds pages, clearing it restores the page', async () => {
    const p = await newPage();
    await p.goto(base + '/help/getting-started.html');
    assert.equal(await p.title(), 'Getting started — ERP Help');
    assert.deepEqual((await p.$$eval('main h2', hs => hs.map(h => h.textContent))).slice(0, 3), ['Signing in', 'The menu', 'Home tasks']);
    assert.match(await p.textContent('main'), /Last reviewed \d{2}\/\d{2}\/\d{4}/);
    assert.equal(await p.getAttribute('nav a.here', 'href'), 'getting-started.html');
    await p.fill('#q', 'corporate id');
    await p.waitForSelector('#results li');
    assert.deepEqual(await p.$$eval('#results a', as => as.map(a => a.textContent)), ['Getting started']);
    await p.fill('#q', 'reject reason');
    await p.waitForFunction(() => /Approvals/.test((document.querySelector('#results') || {}).textContent || ''));
    await p.fill('#q', 'zzzz nothing');
    await p.waitForFunction(() => /Nothing found/.test(document.querySelector('main').textContent));
    await p.fill('#q', '');
    await p.waitForFunction(() => /Signing in/.test(document.querySelector('main').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('"?m=MODULE": a written screen opens its page; one not written yet says so on the home page', async () => {
    const p = await newPage();
    await p.goto(base + '/help/?m=GRN');
    await p.waitForFunction(() => getComputedStyle(document.getElementById('notice')).display === 'block');
    assert.match(await p.textContent('#notice'), /no help page for that screen yet/);
    // A screen with a page (none is written in step 1: the map is given here).
    await p.route('**/help/search.json', async route => {
      const j = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'help/search.json'), 'utf8'));
      j.modules.GRN = 'approvals';
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
    });
    await p.goto(base + '/help/?m=GRN');
    await p.waitForURL(/\/help\/approvals\.html$/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the shell: Help opens the help home; inside a screen, that screen\'s page; back on Home, the home again; a link on the sign-in card', async () => {
    const p = await newPage();
    await p.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await p.addInitScript(stubs);
    await p.goto(base + '/');
    await p.waitForSelector('#tree-container li[data-module-id]', { state: 'attached', timeout: 30000 });
    assert.equal(await p.getAttribute('#help-btn', 'href'), '/help/');
    assert.equal(await p.getAttribute('#help-btn', 'target'), '_blank');
    assert.equal(await p.getAttribute('#login-help-link', 'href'), '/help/getting-started.html');
    await p.evaluate(() => openModule('GRN'));
    await p.waitForSelector('#stub-module');
    assert.equal(await p.getAttribute('#help-btn', 'href'), '/help/?m=GRN');
    assert.equal(await p.$eval('#help-btn', b => b.closest('.hidden') === null), true, 'not inside a part hidden in a screen');
    await p.click('#back-to-tree-btn');
    await p.waitForFunction(() => document.getElementById('help-btn').getAttribute('href') === '/help/');
    // The link works: Hosting serves the help home there.
    const r = await (await browser.newPage()).goto(base + (await p.getAttribute('#help-btn', 'href')));
    assert.equal(r.status(), 200);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
