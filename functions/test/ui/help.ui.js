// Help (docs/modules/HELP.md, decisions 148-151) in headless Chromium, no
// emulators: the public site as Hosting serves it (public/ over plain HTTP)
// — the home page with every area, each page's links and sections resolving,
// search, "?m=MODULE" opening that screen's page or saying it is not written
// yet, robots.txt and the sitemap — and the shell's Help button (the real
// public/index.html with the Firebase SDK stubbed, as home.ui.js): the help
// home on Home, the open screen's page inside a screen, back to the home;
// on a phone the page before the list of pages; back to the ERP.
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
    // Every area is written (help/areas.json): nothing listed as coming.
    assert.ok(areas.every(a => a.written), 'every area written');
    assert.doesNotMatch(await p.textContent('main'), /Coming:/);
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
    assert.deepEqual(await p.$$eval('#results a', as => as.map(a => a.textContent)), ['Getting started', "What's new"]);
    await p.fill('#q', 'reject reason');
    await p.waitForFunction(() => /Approvals/.test((document.querySelector('#results') || {}).textContent || ''));
    await p.fill('#q', 'zzzz nothing');
    await p.waitForFunction(() => /Nothing found/.test(document.querySelector('main').textContent));
    await p.fill('#q', '');
    await p.waitForFunction(() => /Signing in/.test(document.querySelector('main').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('"?m=MODULE": a written screen opens its page; one without a page says so on the home page', async () => {
    const p = await newPage();
    // The Developer module has no Help (owner, 2026-10-19).
    await p.goto(base + '/help/?m=DEVELOPER');
    await p.waitForFunction(() => getComputedStyle(document.getElementById('notice')).display === 'block');
    assert.match(await p.textContent('#notice'), /no help page for that screen yet/);
    // Screens with a page: one page per screen, or one page for two.
    await p.goto(base + '/help/?m=JV');
    await p.waitForURL(/\/help\/journal-entries\.html$/);
    await p.goto(base + '/help/?m=GRN');
    await p.waitForURL(/\/help\/goods-receipt-note\.html$/);
    await p.goto(base + '/help/?m=PDCISSUED');
    await p.waitForURL(/\/help\/post-dated-cheques\.html$/);
    assert.match(await p.textContent('main .lead + .lead, main p.lead:nth-of-type(2)'), /Screens: PDC Received, PDC Issued/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('light / dark: follows the device until switched; the switch is saved with the ERP\'s theme (erp-theme) and kept on reload (owner, 2026-10-14)', async () => {
    const p = await newPage();
    const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const DARK = 'rgb(15, 23, 42)', LIGHT = 'rgb(248, 250, 252)';
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.goto(base + '/help/index.html');
    await p.evaluate(() => localStorage.removeItem('erp-theme'));
    await p.reload();
    assert.equal(await bg(), DARK, 'a dark device, nothing saved: dark');
    assert.equal((await p.textContent('#theme')).trim(), 'Light mode');
    await p.click('#theme');
    assert.equal(await bg(), LIGHT);
    assert.equal(await p.evaluate(() => localStorage.getItem('erp-theme')), 'light');
    assert.equal((await p.textContent('#theme')).trim(), 'Dark mode');
    await p.goto(base + '/help/journal-entries.html');
    assert.equal(await bg(), LIGHT, 'kept on another page');
    // The ERP's own choice applies too: dark saved, on a light device.
    await p.emulateMedia({ colorScheme: 'light' });
    await p.evaluate(() => localStorage.setItem('erp-theme', 'dark'));
    await p.reload();
    assert.equal(await bg(), DARK);
    await p.emulateMedia({ media: 'print' });
    assert.equal(await p.isVisible('#theme'), false, 'not printed (the header is hidden)');
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
    // Not on a print (owner, 2026-10-14): hidden for print media, shown again after.
    await p.emulateMedia({ media: 'print' });
    assert.equal(await p.$eval('#help-btn', b => getComputedStyle(b).display), 'none', 'Help is not printed');
    await p.emulateMedia({ media: 'screen' });
    assert.notEqual(await p.$eval('#help-btn', b => getComputedStyle(b).display), 'none');
    await p.click('#back-to-tree-btn');
    await p.waitForFunction(() => document.getElementById('help-btn').getAttribute('href') === '/help/');
    // The link works: Hosting serves the help home there.
    const r = await (await browser.newPage()).goto(base + (await p.getAttribute('#help-btn', 'href')));
    assert.equal(r.status(), 200);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a phone: the page first, all the pages after it, "All pages" jumps there; a computer: the list beside the page (owner, 2026-10-30)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(base + '/help/getting-started.html');
    const box = sel => p.locator(sel).boundingBox();
    const [main, nav] = [await box('main'), await box('nav')];
    assert.ok(main.y < 200 && nav.y > main.y + main.height - 1, 'main at ' + main.y + ', the list at ' + nav.y);
    assert.ok(await p.isVisible('header .jump'));
    await p.click('header .jump');
    await p.waitForFunction(() => location.hash === '#topics');
    assert.ok((await box('nav')).y < 100, 'scrolled to the list');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing wider than the phone');
    await ctx.close();
    const d = await newPage();
    await d.setViewportSize({ width: 1280, height: 900 });
    await d.goto(base + '/help/getting-started.html');
    const [dm, dn] = [await d.locator('main').boundingBox(), await d.locator('nav').boundingBox()];
    assert.ok(dn.x < dm.x && Math.abs(dn.y - dm.y) < 5, 'side by side');
    assert.ok(await d.isHidden('header .jump') && await d.isHidden('nav .toc'));
    await d.close();
  });

  await check('back to the ERP: the tab the ERP opened closes; a page it can\'t close opens the ERP (owner, 2026-10-30)', async () => {
    const ctx = await browser.newContext();
    const erp = await ctx.newPage();
    await erp.setContent('<a id="h" href="' + base + '/help/getting-started.html" target="_blank" rel="noopener">Help</a>');
    const [help] = await Promise.all([ctx.waitForEvent('page'), erp.click('#h')]);
    await help.waitForLoadState();
    await Promise.all([help.waitForEvent('close', { timeout: 5000 }), help.click('#back')]);
    assert.equal(help.isClosed(), true);
    // Help reached another way (a search engine), then another page: it can't close itself, so the ERP opens in it.
    const help2 = await ctx.newPage();
    await help2.goto(base + '/help/getting-started.html');
    await help2.click('a[href="approvals.html"]');
    await help2.waitForURL(/approvals\.html/);
    await help2.click('#back');
    await help2.waitForURL(base + '/', { timeout: 5000 });
    await ctx.close();
  });

  await browser.close(); server.close();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
