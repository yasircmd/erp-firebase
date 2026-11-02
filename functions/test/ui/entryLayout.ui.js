// Entry layout (owner, 2026-11-02; docs/modules/ENTRY_LAYOUT.md, Q383-Q386),
// the pilot screens Vendor Invoice, Sales Order and JV: the title bar with
// its actions and the key fields stay at the top while many lines scroll;
// the key fields sit in one row on a wide window; a narrow (phone) window
// sticks nothing; every id once; the header is at most 60% of what it was.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/entryLayout.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

// The header before the change, at 1400 px: from the entry's first visible part
// (not the print-only header) to the lines table.
const SCREENS = [
  { mod: 'VENDORINVOICE', p: 'vinv', keys: ['vinv-form-company', 'vinv-form-vendor', 'vinv-form-date', 'vinv-form-vendorref'], actions: ['vinv-save-draft-btn', 'vinv-post-btn'], before: 533 },
  { mod: 'SALESORDER', p: 'so', keys: ['so-form-company', 'so-form-customer', 'so-form-date', 'so-form-deliverydate'], actions: ['so-save-draft-btn', 'so-confirm-btn'], before: 469 },
  { mod: 'JV', p: 'jv', keys: ['jv-form-company', 'jv-form-date', 'jv-form-reference', 'jv-form-description'], actions: ['jv-save-draft-btn', 'jv-post-btn'], before: 366 }
];

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8204);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(s, width) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8204/?module=' + s.mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.click('#' + s.p + '-new-btn');
    await page.waitForSelector('#' + s.p + '-entry-view:not(.hidden)', T);
    return page;
  }

  for (const s of SCREENS) {
    await check(s.mod + ': key fields in one row; the actions in the title bar; every id once; the header at most 60% of before', async () => {
      const page = await open(s, 1400);
      const tops = await page.evaluate(ids => ids.map(id => Math.round(document.getElementById(id).getBoundingClientRect().top)), s.keys);
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, 'one row: ' + tops.join(','));
      for (const id of s.actions) assert.ok(await page.evaluate(id => Boolean(document.getElementById(id).closest('.entry-sticky .entry-bar')), id), id + ' in the sticky bar');
      const dupes = await page.evaluate(() => { const seen = {}; document.querySelectorAll('#module-container [id]').forEach(e => { seen[e.id] = (seen[e.id] || 0) + 1; }); return Object.keys(seen).filter(k => seen[k] > 1); });
      assert.deepEqual(dupes, []);
      const header = await page.evaluate(p => Math.round(document.getElementById(p + '-grid-body').closest('table').getBoundingClientRect().top - document.querySelector('#' + p + '-entry-view > :not(.print-only)').getBoundingClientRect().top), s.p);
      assert.ok(header <= s.before * 0.6 + 1, 'header ' + header + ' px, was ' + s.before);
      assert.deepEqual(page.__errors, []);
      await page.close();
    });

    await check(s.mod + ': with many lines scrolled, the title bar, actions and key fields stay in view; on a phone nothing sticks', async () => {
      const page = await open(s, 1400);
      for (let i = 0; i < 25; i++) await page.click('#' + s.p + '-add-line-btn');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => window.scrollY) > 300, 'the page did scroll');
      const r = await page.evaluate(ids => ids.map(id => document.getElementById(id).getBoundingClientRect()).map(b => [Math.round(b.top), Math.round(b.bottom)]), s.keys.concat(s.actions));
      r.forEach(([top, bottom]) => assert.ok(top >= 0 && bottom <= 300, 'in view at the top: ' + JSON.stringify(r)));
      await page.close();
      const phone = await open(s, 600);
      assert.equal(await phone.evaluate(p => getComputedStyle(document.querySelector('#' + p + '-entry-view .entry-sticky')).position, s.p), 'static');
      await phone.close();
    });
  }

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
