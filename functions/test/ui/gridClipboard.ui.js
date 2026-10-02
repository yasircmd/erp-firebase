// Copy / Paste of entry grids with column headings (owner, 2026-10-02;
// docs/modules/LINE_GRIDS.md): on every entry screen with a line grid, Copy
// on an empty grid gives the column headings (not "Nothing to copy yet."),
// with lines it gives the headings and the lines, and a paste that starts
// with the headings skips that row. Seeds its own data (it WIPES the
// emulator database, like the suites):
//   node functions/test/ui/gridClipboard.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');
const { SCREENS } = require('../../../tools/legacy-port/gridClipboard');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

const GRIDS = [
  ['JV', 'jv', '1000'], ['CBT', 'cbt', '1000'], ['GRN', 'grn', 'RM-001'], ['MATERIALISSUE', 'mi', 'RM-001'],
  ['WAREHOUSEMOVEMENT', 'wm', 'RM-001'], ['STOCKADJUSTMENT', 'adj', 'RM-001'], ['PHYSICALCOUNT', 'pc', 'RM-001'], ['PRODUCTION', 'prd', 'RM-001']
];
const headingsOf = mod => (Array.isArray(SCREENS[mod]) ? SCREENS[mod] : SCREENS[mod].headings).join('\t');

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8161);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  const setClip = text => page.evaluate(t => navigator.clipboard.writeText(t), text);
  async function openNew(mod, p) {
    page.__dialogs.length = 0;
    await page.goto('http://127.0.0.1:8161/?module=' + mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#' + p + '-new-btn:not(.hidden)', { timeout: 30000 });
    await page.click('#' + p + '-new-btn');
    await page.waitForSelector('#' + p + '-copy-btn', { state: 'visible', timeout: 20000 });
  }

  for (const [mod, p, code] of GRIDS) {
    await check(mod + ': an empty grid copies the headings; a paste with the headings skips them', async () => {
      await openNew(mod, p);
      await setClip('stale');
      await page.click('#' + p + '-copy-btn');
      await page.waitForFunction(() => true);
      assert.equal(await clip(), headingsOf(mod));
      // (Only this message matters: a request cut off by leaving the previous
      // screen can show "Failed to fetch" while the test moves on.)
      assert.ok(!page.__dialogs.some(d => /Nothing to copy/.test(d)), 'no "Nothing to copy yet."');
      await setClip(headingsOf(mod) + '\n' + code + '\tPasted line');
      await page.click('#' + p + '-paste-btn');
      await page.waitForFunction(c => { const i = document.querySelector('#module-container [data-row="0"][data-col="0"]'); return i && i.value === c; }, code, { timeout: 10000 });
      const firstCol = await page.$$eval('#module-container [data-col="0"]', els => els.map(e => e.value).filter(Boolean));
      assert.deepEqual(firstCol, [code], 'one line, not the headings');
      // Copy again: the headings, then the line.
      await page.click('#' + p + '-copy-btn');
      const copied = (await clip()).split('\n');
      assert.equal(copied[0], headingsOf(mod));
      assert.equal(copied.length, 2);
      assert.equal(copied[1].split('\t')[0], code);
    });
  }

  await check('BOM: the same for its components', async () => {
    await openNew('BOM', 'bom');
    await page.click('#bom-copy-btn');
    assert.equal(await clip(), 'Component Item Code\tQuantity\tScrap %');
    await setClip('Component Item Code\tQuantity\tScrap %\nRM-001\t2\t0');
    await page.click('#bom-paste-btn');
    await page.waitForFunction(() => /RM-001/.test(document.getElementById('module-container').innerText), null, { timeout: 10000 });
    assert.ok(!page.__dialogs.some(d => /Component Item Code/.test(d)), 'the headings row is not reported as an unknown item: ' + page.__dialogs.join(' | '));
    await page.click('#bom-copy-btn');
    assert.deepEqual((await clip()).split('\n').map(r => r.split('\t')[0]), ['Component Item Code', 'RM-001']);
  });

  await check('Delivery Note: an empty grid copies its headings', async () => {
    await openNew('DELIVERYNOTE', 'dn');
    await page.click('#dn-copy-btn');
    assert.equal(await clip(), 'Item Code\tItem Name\tWarehouse\tQuantity\tUnit Price\tDescription\tSO No.\tCost Center\tProfit Center');
    assert.ok(!page.__dialogs.some(d => /Nothing to copy/.test(d)));
  });

  await check('no page errors', async () => assert.deepEqual(page.__errors, []));
  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
