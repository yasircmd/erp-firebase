// Stop salary (docs/modules/SALARY_HOLD.md) in headless Chromium against the
// emulators: Payroll Setup's Salary held account; Payroll → Salary holds:
// the holds with what is held now, a hold placed from the form, one released
// (its month and note asked in the app's own dialogs). Run the salaryHold
// emulator suite first: it leaves Ali released, Dan held for three months
// and the runs to 2026-09 posted.
//   node --test functions/test/emulator/salaryHold.emulator.test.js
//   node functions/test/ui/salaryHold.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8131);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.__dialogs = [];
    page.__answers = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? page.__answers.shift() : undefined); });
    await page.goto('http://127.0.0.1:8131/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };
  const rows = page => page.evaluate(() => [...document.querySelectorAll('#pr-holds-body tr')].map(tr => [...tr.querySelectorAll('td')].slice(0, 6).map(td => td.innerText.trim().split('\n')[0])));

  await check('Payroll Setup: the company\'s Salary held account', async () => {
    const page = await open('PAYROLLSETUP', 'u-admin');
    await page.click('.ps-tab[data-tab="payroll"]');
    await page.waitForSelector('#ps-pc-body tr[data-co="C1"] .ps-pc-held', { state: 'attached', timeout: 30000 });
    assert.equal(await page.inputValue('#ps-pc-body tr[data-co="C1"] .ps-pc-held'), 'A-HELD');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Payroll → Salary holds: what is held now; a hold placed; one released, its amount going to the run named', async () => {
    const page = await open('PAYROLL', 'u-admin');
    await page.click('.pr-tab[data-tab="holds"]');
    await page.waitForSelector('#pr-holds-body tr[data-id]', { timeout: 30000 });
    await settle(page);
    let r = await rows(page);
    const dan = r.find(x => /Dan Ito/.test(x[0])), ali = r.find(x => /Ali Hassan/.test(x[0]));
    assert.deepEqual([dan[1], dan[2], dan[4], dan[5]], ['Jul-2026', 'until released', 'Held', '3,000.00']);
    assert.deepEqual([ali[2], ali[4], ali[5]], ['released from Sep-2026', 'Released', '0.00']);
    assert.equal(await page.inputValue('#pr-hold-from'), '2026-10', 'the first month without a posted run');

    // Hold Ben from the form.
    const ben = await page.evaluate(() => [...document.querySelectorAll('#pr-hold-emp option')].find(o => /Ben Okafor/.test(o.textContent)).value);
    await page.selectOption('#pr-hold-emp', ben);
    await page.fill('#pr-hold-reason', 'Passport not returned');
    await page.click('#pr-hold-save');
    await page.waitForFunction(() => [...document.querySelectorAll('#pr-holds-body tr')].some(tr => /Ben Okafor/.test(tr.textContent)), null, { timeout: 30000 });
    r = await rows(page);
    assert.deepEqual(r.find(x => /Ben Okafor/.test(x[0])).slice(1, 6), ['Oct-2026', 'until released', 'Passport not returned', 'Held', '0.00']);

    // Release Dan: the month and the note in the app's dialogs.
    page.__answers.push('2026-10', 'Documents returned');
    await page.locator('#pr-holds-body tr', { hasText: 'Dan Ito' }).locator('.pr-hold-release').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#pr-holds-body tr')].some(tr => /Dan Ito/.test(tr.textContent) && /Released/.test(tr.textContent)), null, { timeout: 30000 });
    assert.ok(page.__dialogs.some(m => /3,000\.00 held is added to the (2026-10|Oct-2026) payroll run/.test(m)), JSON.stringify(page.__dialogs));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('a Viewer: no Payroll access, no holds', async () => {
    const page = await open('PAYROLL', 'u-viewer');
    assert.equal(await page.locator('#pr-holds-body tr[data-id]').count(), 0);
    await page.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
