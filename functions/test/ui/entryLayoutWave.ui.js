// Entry layout on the other entry screens, waves 1 (purchase, cash) and 2
// (stock, requisitions) (owner, 2026-11-03: "change the
// entries module in a more optimized way"; docs/modules/ENTRY_LAYOUT.md):
// per screen, the key fields in one row on a wide window; the actions in the
// sticky title bar; every id once; the header at most 75 % of what it was;
// scrolled down, the title bar, actions and key fields stay in view; a phone
// width sticks nothing. One list per wave; run all, or one wave:
//   node functions/test/ui/entryLayoutWave.ui.js [wave]
// Seeds its own data (it WIPES the emulator database, like the suites).
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

// before: the header (the entry's first visible part to `to`) at 1400 px before the change.
const WAVES = {
  1: [
    { mod: 'PURCHASEORDER', p: 'po', view: 'po-edit-view', to: '#po-direct-type', before: 382,
      keys: ['po-form-company', 'po-form-vendor', 'po-form-date', 'po-form-costcenter'], actions: ['po-save-btn', 'po-submit-btn'] },
    { mod: 'GRN', p: 'grn', view: 'grn-entry-view', to: '#grn-grid-body', before: 796,
      keys: ['grn-form-company', 'grn-form-vendor', 'grn-form-date', 'grn-form-reference'], actions: ['grn-save-draft-btn', 'grn-post-btn'] },
    { mod: 'PURCHASERETURN', p: 'prt', view: 'prt-entry-view', to: '#prt-grid-body', before: 467,
      keys: ['prt-form-company', 'prt-form-vendor', 'prt-form-invoice', 'prt-form-date'], actions: ['prt-save-draft-btn', 'prt-post-btn'] },
    { mod: 'CBT', p: 'cbt', view: 'cbt-entry-view', to: '#cbt-grid-body', before: 715,
      keys: ['cbt-form-company', 'cbt-form-ledger', 'cbt-form-date', 'cbt-form-reference'], actions: ['cbt-save-draft-btn', 'cbt-post-btn'] },
    { mod: 'PDCRECEIVED', p: 'pdc', view: 'pdc-entry-view', to: '#pdc-cheques-body', before: 314,
      keys: ['pdc-form-company', 'pdc-form-party', 'pdc-form-date', 'pdc-form-reference'], actions: ['pdc-save-draft-btn', 'pdc-post-btn'] },
    { mod: 'PDCISSUED', p: 'pdc', view: 'pdc-entry-view', to: '#pdc-cheques-body', before: 314,
      keys: ['pdc-form-company', 'pdc-form-party', 'pdc-form-date', 'pdc-form-reference'], actions: ['pdc-save-draft-btn', 'pdc-post-btn'] }
  ],
  2: [
    { mod: 'STOCKADJUSTMENT', p: 'adj', view: 'adj-entry-view', to: '#adj-grid-body', before: 618,
      keys: ['adj-form-company', 'adj-form-date', 'adj-form-reference'], actions: ['adj-save-draft-btn', 'adj-post-btn'] },
    { mod: 'MATERIALISSUE', p: 'mi', view: 'mi-entry-view', to: '#mi-grid-body', before: 692,
      keys: ['mi-form-company', 'mi-form-date', 'mi-form-reference'], actions: ['mi-save-draft-btn', 'mi-post-btn'] },
    { mod: 'WAREHOUSEMOVEMENT', p: 'wm', view: 'wm-entry-view', to: '#wm-grid-body', before: 602,
      keys: ['wm-form-company', 'wm-form-date', 'wm-form-reference'], actions: ['wm-save-draft-btn', 'wm-post-btn'] },
    { mod: 'PHYSICALCOUNT', p: 'pc', view: 'pc-entry-view', to: '#pc-grid-body', before: 618,
      keys: ['pc-form-company', 'pc-form-date', 'pc-form-reference'], actions: ['pc-save-draft-btn', 'pc-post-btn'] },
    { mod: 'PRODUCTION', p: 'prd', view: 'prd-entry-view', to: '#prd-grid-body', before: 655,
      keys: ['prd-form-company', 'prd-form-joborder', 'prd-form-date', 'prd-form-reference'], actions: ['prd-save-draft-btn', 'prd-post-btn'] },
    { mod: 'PURCHASEREQUISITION', p: 'pr', view: 'pr-entry-view', to: '#pr-grid-body', before: 546,
      keys: ['pr-form-company', 'pr-form-date', 'pr-form-neededby', 'pr-form-priority'], actions: ['pr-save-draft-btn', 'pr-submit-btn'] },
    { mod: 'INVENTORYPURCHASEREQUISITION', p: 'ipr', view: 'ipr-entry-view', to: '#ipr-grid-body', before: 546,
      keys: ['ipr-form-company', 'ipr-form-date', 'ipr-form-neededby', 'ipr-form-priority'], actions: ['ipr-save-draft-btn', 'ipr-submit-btn'] }
  ]
};
const only = process.argv[2];
const SCREENS = Object.keys(WAVES).filter(w => !only || w === only).flatMap(w => WAVES[w]);

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8208);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(s, width) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8208/?module=' + s.mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.click('#' + s.p + '-new-btn');
    await page.waitForSelector('#' + s.view + ':not(.hidden)', T);
    await page.waitForTimeout(500); // the company's lists in
    return page;
  }

  for (const s of SCREENS) {
    await check(s.mod + ': key fields in one row; the actions in the title bar; every id once; the header at most 75% of before', async () => {
      const page = await open(s, 1400);
      const tops = await page.evaluate(ids => ids.map(id => { const el = document.getElementById(id); return Math.round((el.closest('.entry-fields > *') || el).getBoundingClientRect().top); }), s.keys);
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, 'one row: ' + tops.join(','));
      for (const id of s.keys) assert.ok(await page.evaluate(id => Boolean(document.getElementById(id).closest('.entry-sticky')), id), id + ' in the sticky part');
      for (const id of s.actions) assert.ok(await page.evaluate(id => Boolean(document.getElementById(id).closest('.entry-sticky .entry-bar')), id), id + ' in the sticky bar');
      const dupes = await page.evaluate(() => { const seen = {}; document.querySelectorAll('#module-container [id]').forEach(e => { seen[e.id] = (seen[e.id] || 0) + 1; }); return Object.keys(seen).filter(k => seen[k] > 1); });
      assert.deepEqual(dupes, []);
      const header = await page.evaluate(s => { const v = document.getElementById(s.view); const first = Array.from(v.querySelectorAll('*')).find(e => e.getBoundingClientRect().height > 0);
        const el = document.querySelector(s.to); return Math.round((el.closest('table') || el).getBoundingClientRect().top - first.getBoundingClientRect().top); }, s);
      assert.ok(header <= s.before * 0.75, 'header ' + header + ' px, was ' + s.before);
      assert.deepEqual(page.__errors, []);
      await page.close();
    });

    await check(s.mod + ': scrolled down, the title bar, actions and key fields stay in view; on a phone nothing sticks', async () => {
      const page = await open(s, 1400);
      // A long entry: a spacer where the lines are (in the sticky part's own box), then scroll to the end.
      await page.evaluate(v => { const d = document.createElement('div'); d.style.height = '2500px'; document.querySelector('#' + v + ' .entry-sticky').parentElement.appendChild(d); }, s.view);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => window.scrollY) > 300, 'the page did scroll');
      const r = await page.evaluate(ids => ids.map(id => { const el = document.getElementById(id); const b = (el.closest('.entry-fields > *') || el).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; }), s.keys.concat(s.actions));
      r.forEach(([top, bottom]) => assert.ok(top >= 0 && bottom <= 320, 'in view at the top: ' + JSON.stringify(r)));
      await page.close();
      const phone = await open(s, 600);
      assert.equal(await phone.evaluate(v => getComputedStyle(document.querySelector('#' + v + ' .entry-sticky')).position, s.view), 'static');
      await phone.close();
    });
  }

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
