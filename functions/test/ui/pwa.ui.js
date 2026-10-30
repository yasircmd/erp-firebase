// The installable app's service worker (docs/modules/PWA.md, Q332):
// public/ served as Hosting does (each page carrying a deploy number); the
// worker registered; offline, the ERP and the portal open from the copy kept
// on the device, a page never seen shows "You're offline"; back online, a new
// deploy shows at once (the pages come from the network first).
// No emulators needed:
//   node functions/test/ui/pwa.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const PUB = path.join(__dirname, '../../../public');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let deploy = 1;

(async () => {
  if (!fs.existsSync(path.join(PUB, 'css/erp.css'))) throw new Error('run tools/build-styles.sh first');
  // As Hosting: a file of public/ (no-cache), "/" its index.html; a page gets the deploy number.
  const handler = (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(PUB, p);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    let body = fs.readFileSync(f);
    if (p.endsWith('.html')) body = Buffer.from(body.toString('utf8').replace('<head>', '<head><meta name="deploy" content="' + deploy + '">'));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  // Offline is the server gone (Playwright's offline switch doesn't reach the worker's own requests).
  let server = http.createServer(handler).listen(8178, '127.0.0.1');
  const goOffline = () => new Promise(r => { server.closeAllConnections(); server.close(r); });
  const goOnline = () => new Promise(r => { server = http.createServer(handler).listen(8178, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:8178';
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // The CDNs and Google's SDK are out of reach here; the pages' own scripts may fail without them, which is not this check.
  await ctx.route(/^https:\/\//, route => route.abort());
  const p = await ctx.newPage();
  const deployOf = () => p.evaluate(() => (document.querySelector('meta[name="deploy"]') || {}).content || '');

  await check('the worker registers and keeps the shell; offline the ERP and the portal open from it', async () => {
    await p.goto(base + '/');
    await p.evaluate(() => navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready));
    await p.reload();
    await p.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
    await p.goto(base + '/ess.html'); // seen once online: kept
    await goOffline();
    await p.goto(base + '/');
    assert.equal(await deployOf(), '1', 'the ERP from the kept copy');
    assert.ok(await p.$('link[rel="manifest"]'), 'the shell, not an error page');
    await p.goto(base + '/ess.html');
    assert.match(await p.title(), /Employee Portal/);
    await p.goto(base + '/help/never-opened.html');
    assert.match(await p.textContent('body'), /You're offline/);
  });

  await check('online again: a new deploy shows at once', async () => {
    await goOnline();
    deploy = 2;
    const q = await ctx.newPage(); // a page of its own, whatever the check before left
    await q.goto(base + '/');
    assert.ok(await q.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'through the worker');
    assert.equal(await q.evaluate(() => (document.querySelector('meta[name="deploy"]') || {}).content || ''), '2');
    assert.equal(await q.evaluate(() => fetch('/css/erp.css').then(r => r.headers.get('content-type'))), 'text/css', 'the styles served');
  });

  await browser.close(); server.closeAllConnections(); server.close();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
