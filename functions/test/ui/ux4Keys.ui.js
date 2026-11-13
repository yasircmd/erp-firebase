// UX batch 4, items 11 and 12 (owner, 2026-11-13; docs/modules/UX4.md, Q506):
// on a screen, Enter presses its New button (not from a field, not over a form
// being filled in); Esc goes back: to the screen it was opened from (a
// drill-down's chain), else Home, asking "Leave without saving?" when the
// screen has unsaved changes; Esc with a pop-up open stays on the screen.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/ux4Keys.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/ux4Keys.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8231);
  const browser = await chromium.launch();
  let answer = false;
  async function open(module) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
    await page.goto('http://127.0.0.1:8231/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }

  await check('Enter on a list opens a new entry; Esc with a form filled in asks first, stays on No, goes Home on Yes', async () => {
    const p = await open('JV');
    await p.waitForSelector('#jv-new-btn:not(.hidden)', T);
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('Enter');
    await p.waitForSelector('#jv-list-view.hidden', { state: 'attached', timeout: 30000 });
    const desc = p.locator('#module-container textarea, #module-container input[id*="desc"]').first();
    await desc.fill('A note being typed');
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    answer = false;
    await p.keyboard.press('Escape');
    for (let i = 0; i < 50 && !p.__dialogs.length; i++) await p.waitForTimeout(100);
    assert.match(p.__dialogs[0] || '', /Leave without saving\?/);
    assert.equal(await p.evaluate(() => window.__wentHome || 0), 0, 'No: stays');
    await p.waitForFunction(() => { const d = document.getElementById('app-dialog'); return !d || d.classList.contains('hidden'); }, null, T);
    answer = true;
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__wentHome === 1, null, T);
    assert.equal(p.__dialogs.length, 2);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a screen with no check of its own (Purchase Order): a form field changed is unsaved, asked on Esc', async () => {
    const p = await open('PURCHASEORDER');
    await p.waitForSelector('#po-new-btn:not(.hidden)', T);
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('Enter');
    await p.waitForSelector('#po-form-date', { state: 'visible', timeout: 30000 });
    assert.equal(await p.evaluate(() => window.screenKeys.unsaved()), false, 'nothing typed yet');
    await p.fill('#po-form-date', '2026-11-20');
    assert.equal(await p.evaluate(() => window.screenKeys.unsaved()), true);
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    answer = true;
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__wentHome === 1, null, T);
    assert.match(p.__dialogs[0] || '', /Leave without saving\?/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Esc on a list with nothing typed goes Home at once; a filter typed is not unsaved', async () => {
    const p = await open('JV');
    await p.waitForSelector('#jv-new-btn:not(.hidden)', T);
    await p.fill('#jv-search-input', 'nothing');
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__wentHome === 1, null, T);
    assert.deepEqual(p.__dialogs, []);
    await p.close();
  });

  await check('Esc on a screen opened from a report goes back to the report, not Home', async () => {
    const p = await open('JV');
    await p.evaluate(() => { window.__moduleReady = false; openModule('JV', null, [{ moduleId: 'TRIALBALANCE', label: 'Trial Balance', params: {} }]); });
    await p.waitForFunction(() => window.__moduleReady === true, null, T);
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__openedModule === 'TRIALBALANCE' && window.__moduleReady === true, null, T);
    assert.equal(await p.evaluate(() => window.__wentHome || 0), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Esc with a screen\'s pop-up open stays on the screen', async () => {
    const p = await open('ROLES');
    await p.waitForSelector('#role-add-btn', T);
    await p.click('#role-add-btn');
    await p.waitForSelector('#role-modal:not(.hidden)', T);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => window.__wentHome || 0), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : results.length + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
