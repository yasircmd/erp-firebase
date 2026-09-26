// Drives the six Fixed Asset phase 1 screens (docs/modules/FIXED_ASSETS.md)
// in headless Chromium against the emulators, through the shell's real
// rpc bridge: the configuration as set up, a new asset with its class
// defaults, capitalization from an open clearing item, a depreciation
// preview and post, additional depreciation, the register as at today
// with the asset history, GL drill-through to the run, and the Viewer's
// read-only screens. Seeds its own data (wipes the emulator database):
//   node functions/test/ui/fixedAssets.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const H = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (r && r.success === false) throw new Error(r.error); return r; };

async function seed() {
  const f = H.baseFixture();
  const acc = (code, name, type) => ({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true });
  Object.assign(f.coa, {
    'A-FACLR': acc('2300', 'Fixed Asset Clearing', 'Liability'), 'A-VEH': acc('1600', 'Vehicles', 'Asset'),
    'A-VEHAD': acc('1690', 'Acc. Depreciation Vehicles', 'Asset'), 'A-DEP': acc('6200', 'Depreciation Expense', 'Expense')
  });
  f.currencies = { CUR1: { Code: 'AED', Name: 'Dirham', IsDefault: true, Status: 'Active' } };
  await H.reset(f);
  ok(await H.call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLR' }));
  const det = ok(await H.call('u-admin', 'saveFaAccountDetermination', { Code: 'VEH', Name: 'Vehicles', ByCompany: { SHARED: { AssetCostAccountID: 'A-VEH', AccumDepAccountID: 'A-VEHAD', DepExpenseAccountID: 'A-DEP' } } }));
  ok(await H.call('u-admin', 'saveFaClass', { Code: 'VEH', Name: 'Vehicles', Kind: 'Tangible', DefaultMethod: 'SL', DefaultUsefulLifeMonths: 120, AccountDeterminationID: det.determinationId }));
  const jv = ok(await H.call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-01-01', Description: 'Van purchase', CompanyID: 'C1', Lines: [
    { AccountCode: '2300', Debit: 120000, Description: 'Van' }, { AccountCode: '1100', Credit: 120000, Description: 'Bank' }] } }));
  ok(await H.call('u-admin', 'postJournalEntry', { jvId: jv.jvId }));
}

(async () => {
  await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8131);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'UI test reason' : undefined));
    await page.goto('http://127.0.0.1:8131/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); };
  const clean = async page => {
    const failed = await page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
    assert.deepEqual(failed.concat(page.__errors), []);
  };

  await check('configuration: settings, class and account determination shown; Viewer read-only', async () => {
    const page = await open('FACONFIG', 'u-admin');
    assert.match(await page.textContent('#fac-set-body'), /Test Co One.*2300 — Fixed Asset Clearing/s);
    await page.click('.fac-tab[data-tab="classes"]');
    assert.match(await page.textContent('#fac-cls-body'), /VEH.*Vehicles.*Tangible.*Straight Line.*10y/s);
    await page.click('#fac-cls-body tr[data-id]');
    assert.equal(await page.inputValue('#fac-cls-years'), '10');
    await page.click('.fac-tab[data-tab="dets"]');
    await page.click('#fac-det-body tr[data-id]');
    assert.equal(await page.inputValue('#fac-det-f-AssetCostAccountID'), 'A-VEH');
    assert.ok(await page.isVisible('#fac-det-save'));
    await clean(page); await page.close();
    const viewer = await open('FACONFIG', 'u-viewer');
    assert.ok(!(await viewer.isVisible('#fac-set-save')), 'no save for the Viewer');
    assert.ok(await viewer.isVisible('#fac-readonly-note'));
    await clean(viewer); await viewer.close();
  });

  await check('asset master: new asset takes the class defaults, gets its number, history', async () => {
    const page = await open('FAASSET', 'u-admin');
    await page.click('#faa-new-btn');
    await page.selectOption('#faa-form-company', 'C1');
    await settle(page);
    await page.selectOption('#faa-form-class', { label: 'VEH — Vehicles' });
    assert.equal(await page.inputValue('#faa-form-years'), '10');
    assert.ok(await page.isDisabled('[data-reserved] >> nth=0'), 'department reserved');
    await page.fill('#faa-form-description', 'Delivery van');
    await page.selectOption('#faa-form-costcenter', 'CC1');
    await page.fill('#faa-form-depstart', '2026-01-01');
    await page.click('#faa-save-btn');
    await page.waitForFunction(() => /FA-01-000001/.test(document.getElementById('faa-title').textContent), null, { timeout: 15000 });
    await page.click('.faa-tab[data-tab="history"]');
    assert.match(await page.textContent('#faa-history-body'), /Created/);
    await clean(page); await page.close();
  });

  await check('capitalization: open clearing item to the asset, post', async () => {
    const page = await open('FAACQ', 'u-admin');
    // The company's items load twice (the shell's one-company default, then
    // the pick below). Hold the first answer back until after an amount is
    // entered: a late, stale answer must not redraw the list and wipe it.
    let first = true;
    await page.route('**/getFaClearingItems', async route => {
      if (first) { first = false; await new Promise(r => setTimeout(r, 3000)); }
      await route.continue();
    });
    await page.click('#fap-new-btn');
    await page.selectOption('#fap-form-company', 'C1');
    await page.waitForSelector('#fap-items-body .fap-all', { timeout: 15000 });
    assert.match(await page.textContent('#fap-items-body'), /Journal.*Van.*120,000\.00/s);
    await page.fill('#fap-form-date', '2026-01-01');
    await page.click('#fap-items-body .fap-all');
    await page.waitForTimeout(3500);
    assert.equal(await page.inputValue('#fap-items-body .fap-use'), '120000', 'the amount survives the late load');
    await page.selectOption('#fap-target-asset', { label: 'FA-01-000001 — Delivery van' });
    await page.click('#fap-add-btn');
    assert.equal(await page.textContent('#fap-lines-total'), '120,000.00');
    await page.click('#fap-post-btn');
    await page.waitForFunction(() => document.getElementById('fap-status-badge').textContent === 'Posted', null, { timeout: 20000 });
    assert.match(await page.textContent('#fap-title'), /FAA-26-01-\d{6}/);
    assert.ok(await page.isVisible('#fap-gl-btn'));
    assert.ok(await page.isVisible('#fap-reverse-btn'));
    await clean(page); await page.close();
  });

  let runJv;
  await check('depreciation run: preview, post, runs list with reverse on the latest', async () => {
    const page = await open('FADEPRUN', 'u-admin');
    await page.selectOption('#fdr-company', 'C1');
    await settle(page);
    await page.fill('#fdr-period', '2026-01');
    await page.click('#fdr-preview-btn');
    await page.waitForSelector('#fdr-preview:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#fdr-preview-body'), /FA-01-000001.*120,000\.00.*1,000\.00.*119,000\.00/s);
    await page.click('#fdr-post-btn');
    await page.waitForFunction(() => /Posted FAD-26-01/.test(document.getElementById('fdr-ok').textContent), null, { timeout: 20000 });
    await page.waitForFunction(() => /FAD-26-01/.test(document.getElementById('fdr-runs-body').textContent), null, { timeout: 15000 });
    assert.match(await page.textContent('#fdr-runs-body'), /2026-01.*Posted.*1,000\.00.*FAD-26-01/s);
    assert.ok(await page.isVisible('.fdr-reverse'));
    assert.match(await page.textContent('#fdr-state'), /Last posted period: 2026-01 · next: 2026-02/);
    runJv = (await H.call('u-admin', 'getFaRuns', { companyId: 'C1' })).runs[0].JVID;
    await clean(page); await page.close();
  });

  await check('additional depreciation: post with a reason', async () => {
    const page = await open('FAADDDEP', 'u-admin');
    await page.click('#fad-new-btn');
    await page.selectOption('#fad-form-company', 'C1');
    await settle(page);
    await page.fill('#fad-form-date', '2026-02-10');
    await page.fill('#fad-form-reason', 'Accident damage');
    await page.selectOption('#fad-lines-body select.fad-asset', { label: 'FA-01-000001 — Delivery van' });
    assert.match(await page.textContent('#fad-lines-body'), /119,000\.00/);
    await page.fill('#fad-lines-body input.fad-amount', '500');
    await page.click('#fad-post-btn');
    await page.waitForFunction(() => document.getElementById('fad-status-badge').textContent === 'Posted', null, { timeout: 20000 });
    assert.match(await page.textContent('#fad-title'), /FAU-26-01-\d{6}/);
    await clean(page); await page.close();
  });

  await check('register as at today, totals by class, asset history', async () => {
    const page = await open('FAREGISTER', 'u-admin');
    await page.selectOption('#far-company', 'C1');
    await page.waitForSelector('#far-body tr[data-id]', { timeout: 15000 });
    assert.match(await page.textContent('#far-body'), /FA-01-000001.*Delivery van.*120,000\.00.*1,500\.00.*118,500\.00/s);
    assert.match(await page.textContent('#far-by-class'), /VEH — Vehicles.*NBV.*118,500\.00/s);
    await page.fill('#far-asof', '2026-01-31');
    await page.click('#far-show');
    await settle(page);
    assert.match(await page.textContent('#far-body'), /119,000\.00/, 'as at January: before the additional depreciation');
    await page.click('#far-body tr[data-id]');
    await page.waitForSelector('#far-modal:not(.hidden)');
    assert.match(await page.textContent('#far-modal-body'), /Capitalization.*Depreciation 2026-01.*Additional Depreciation/s);
    await clean(page); await page.close();
  });

  await check('GL drill-through opens the run; Viewer sees no post or reverse', async () => {
    const page = await open('FAREGISTER', 'u-admin');
    await page.evaluate(jv => openModule('FADEPRUN', { OpenEntryId: jv }), runJv);
    await page.waitForFunction(() => /Run 2026-01 \(Posted\)/.test((document.getElementById('fdr-total') || {}).textContent || ''), null, { timeout: 20000 });
    await page.close();
    const viewer = await open('FADEPRUN', 'u-viewer');
    await viewer.selectOption('#fdr-company', 'C1');
    await settle(viewer);
    assert.ok(!(await viewer.isVisible('.fdr-reverse')), 'no reverse for the Viewer');
    await clean(viewer); await viewer.close();
    const asset = await open('FAASSET', 'u-viewer');
    assert.ok(!(await asset.isVisible('#faa-new-btn')));
    await clean(asset); await asset.close();
  });

  await browser.close(); server.close(); await H.app.delete();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
