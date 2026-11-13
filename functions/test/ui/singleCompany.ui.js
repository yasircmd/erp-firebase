// Single-company default (public/index.html, SINGLE-COMPANY DEFAULT):
// a user assigned exactly one company finds it already selected in every
// company dropdown, on every screen that has one. Loads each such screen
// in headless Chromium against the emulators and checks:
//  - every company select is set to the user's company, except blank
//    options that are a real choice ("Shared across all companies",
//    "None"), which stay blank;
//  - on entry screens, New opens a form with the company already set,
//    and Back leaves straight away (the fill doesn't count as an unsaved
//    change);
//  - a user with two companies gets nothing filled in, and both offered;
//  - one with two who chose one at the top (the company filter, decision
//    273) gets the chosen one filled in, and the other hidden;
//  - UX4 (item 15): one who chose the second company, on every screen with
//    a company choice (each screen that asks getActiveCompanies), never has
//    the first offered or selected, in any dropdown whatever its id, a
//    report's dropdown with no blank option included.
//   node functions/test/ui/singleCompany.ui.js [MODULE ...]
// Run an emulator suite that uses _helpers.js's all-modules permissions
// first (e.g. vendorMaster), so the fixture data exists.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');

const ALL = ['BALANCESHEET', 'CASHFLOW', 'CBT', 'COA', 'CUSTOMERINVOICE', 'CUSTOMERMASTER', 'CUSTOMERSOA', 'DELIVERYNOTE',
  'FAACQ', 'FAADDDEP', 'FAASSET', 'FAAUC', 'FACONFIG', 'FADEPRUN', 'FAREGISTER', 'FARETIRE', 'GLREPORT', 'GRN', 'INVENTORYPURCHASEREQUISITION', 'INVENTORYVALUATION', 'ITEMMASTER', 'JOBORDERREQUEST', 'JV',
  'MATERIALISSUE', 'MATERIALVARIANCE', 'ORGUNITS', 'PDCISSUED', 'PDCRECEIVED', 'PHYSICALCOUNT', 'PRICELISTING',
  'PROCUREMENTSETUP', 'PRODCONSUMPTION', 'PRODUCTION', 'PROFITLOSS', 'PURCHASEORDER', 'PURCHASEREQUISITION',
  'PURCHASERETURN', 'RECURRINGJV', 'SALESINVOICESETUP', 'SALESORDER', 'SALESRETURN', 'STOCKADJUSTMENT', 'STOCKAVAILABILITY',
  'STOCKLEDGER', 'STOCKVALUATION', 'TRIALBALANCE', 'VENDORINVOICE', 'VENDORMASTER', 'VENDORSOA', 'WAREHOUSEMOVEMENT'];
// --chosen2 MODULE...: only the UX4 check, for those screens (the whole sweep
// is run in parts, with the emulators restarted between them: each function
// called keeps its own emulator worker).
const CHOSEN2_ONLY = process.argv.includes('--chosen2');
const ARGS = process.argv.slice(2).filter(a => a !== '--chosen2');
const MODULES = CHOSEN2_ONLY ? [] : ARGS.length ? ARGS : ALL;
const MULTI_MODULES = ['GRN', 'JV', 'TRIALBALANCE', 'PURCHASEREQUISITION'].filter(m => MODULES.includes(m));
const SHARED = /shared|none/i;

async function seedMultiCompanyUser() {
  await fetch('http://127.0.0.1:9000/users/u-multi.json?ns=erp1-8f4cd-default-rtdb', {
    method: 'PUT', headers: { Authorization: 'Bearer owner' },
    body: JSON.stringify({ status: 'Active', role: 'Admin', username: 'multi', fullName: 'Two Companies', AssignedCompanies: ['C1', 'C2'] })
  });
  for (const [path, body] of [
    ['users/u-chose', { status: 'Active', role: 'Admin', username: 'chose', fullName: 'Chose One', AssignedCompanies: ['C1', 'C2'] }],
    ['userPreferences/u-chose', { Companies: ['C1'] }],
    ['users/u-chose2', { status: 'Active', role: 'Admin', username: 'chose2', fullName: 'Chose Two', AssignedCompanies: ['C1', 'C2'] }],
    ['userPreferences/u-chose2', { Companies: ['C2'] }]]) {
    await fetch('http://127.0.0.1:9000/' + path + '.json?ns=erp1-8f4cd-default-rtdb', { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
  }
}

// Every company select on the page: id, value, the blank option's label,
// and whether the user's companies are among its options.
const companySelects = page => page.$$eval('#module-container select[id*="company"]', ss => ss.map(s => {
  const blank = Array.from(s.options).find(o => o.value === '');
  const c2 = Array.from(s.options).find(o => o.value === 'C2');
  return { id: s.id, value: s.value, blank: blank ? blank.textContent : null, hasC1: Array.from(s.options).some(o => o.value === 'C1'), c2: c2 ? (c2.hidden ? 'hidden' : 'shown') : 'none' };
}));

(async () => {
  await seedMultiCompanyUser();
  require('./buildHarness');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'));
  // The vendor scripts a screen loads (Chart.js on the MIS screens) as themselves.
  const server = http.createServer((q, r) => {
    const vendor = /^\/vendor\/([\w.-]+\.js)/.exec(q.url);
    if (vendor) { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(fs.readFileSync(path.join(__dirname, '../../../public/vendor', vendor[1]))); return; }
    r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness);
  }).listen(8126);
  const browser = await chromium.launch();
  const results = [];
  results.push = (...rows) => { rows.forEach(r => console.log(r.join('  '))); return Array.prototype.push.apply(results, rows); }; // as it goes (a long run)

  async function open(mod, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.dismiss(); });
    await page.goto('http://127.0.0.1:8126/?module=' + mod + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true || /^LOAD FAILED/.test(document.getElementById('module-container').textContent), null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    return page;
  }
  const failedCalls = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));

  for (const mod of MODULES) {
    const problems = [];
    let filled = 0, entry = '';
    try {
      const page = await open(mod, 'u-admin');
      for (const s of await companySelects(page)) {
        if (!s.hasC1) continue;
        const want = s.blank !== null && SHARED.test(s.blank) ? '' : 'C1';
        if (s.value !== want) problems.push(s.id + ' is "' + s.value + '", expected "' + want + '"');
        else if (want) filled++;
      }
      // Entry screens: New, then Back without touching anything.
      const prefix = await page.evaluate(() => {
        const btn = document.querySelector('#module-container [id$="-new-btn"]');
        return btn && btn.checkVisibility() ? btn.id.replace(/-new-btn$/, '') : '';
      });
      if (prefix && await page.$('#' + prefix + '-form-company')) {
        await page.click('#' + prefix + '-new-btn');
        await page.waitForTimeout(600);
        const v = await page.inputValue('#' + prefix + '-form-company');
        if (v !== 'C1') problems.push('New ' + prefix + ': form company is "' + v + '"');
        const backId = await page.evaluate(p => {
          const b = ['-back-btn', '-cancel-btn', '-cancel-direct-btn'].map(s => document.getElementById(p + s)).find(x => x && x.checkVisibility());
          return b ? b.id : '';
        }, prefix);
        if (backId) {
          await page.click('#' + backId);
          await page.waitForTimeout(600);
          if (!await page.isVisible('#' + prefix + '-list-view')) problems.push('Back from an untouched new ' + prefix + ' did not return to the list (treated as unsaved?)');
          entry = 'new+back';
        } else entry = 'new';
      }
      problems.push(...await failedCalls(page), ...page.__errors);
      await page.close();
    } catch (e) {
      problems.push(e.message.split('\n')[0]);
    }
    results.push([problems.length ? 'FAIL' : 'PASS', mod, 'u-admin', filled + ' filled', entry, problems.join(' | ')]);
  }

  for (const mod of MULTI_MODULES) {
    const problems = [];
    try {
      const page = await open(mod, 'u-multi');
      for (const s of await companySelects(page)) {
        if (s.hasC1 && s.value !== '') problems.push(s.id + ' filled with "' + s.value + '" for a two-company user');
        if (s.c2 === 'hidden') problems.push(s.id + ' hides C2 from a user who chose both');
      }
      const prefix = await page.evaluate(() => {
        const btn = document.querySelector('#module-container [id$="-new-btn"]');
        return btn && btn.checkVisibility() ? btn.id.replace(/-new-btn$/, '') : '';
      });
      if (prefix && await page.$('#' + prefix + '-form-company')) {
        await page.click('#' + prefix + '-new-btn');
        await page.waitForTimeout(600);
        const v = await page.inputValue('#' + prefix + '-form-company');
        if (v !== '') problems.push('New ' + prefix + ': form company is "' + v + '" for a two-company user');
      }
      problems.push(...await failedCalls(page), ...page.__errors);
      await page.close();
    } catch (e) {
      problems.push(e.message.split('\n')[0]);
    }
    results.push([problems.length ? 'FAIL' : 'PASS', mod, 'u-multi', '', '', problems.join(' | ')]);
  }

  // Two companies, C1 chosen at the top: as one.
  for (const mod of MULTI_MODULES) {
    const problems = [];
    let hidden = 0;
    try {
      const page = await open(mod, 'u-chose');
      for (const s of await companySelects(page)) {
        if (!s.hasC1) continue;
        const want = s.blank !== null && SHARED.test(s.blank) ? '' : 'C1';
        if (s.value !== want) problems.push(s.id + ' is "' + s.value + '", expected "' + want + '"');
        if (s.c2 === 'shown') problems.push(s.id + ' offers C2, not chosen');
        if (s.c2 === 'hidden') hidden++;
      }
      if (!hidden) problems.push('no company dropdown with C2 to check');
      problems.push(...await failedCalls(page), ...page.__errors);
      await page.close();
    } catch (e) {
      problems.push(e.message.split('\n')[0]);
    }
    results.push([problems.length ? 'FAIL' : 'PASS', mod, 'u-chose', hidden + ' hide C2', '', problems.join(' | ')]);
  }

  // UX4 item 15: C2 chosen (C1, the first, filtered out), every screen with a
  // company choice. With module names given, only those.
  const WITH_CHOICE = ARGS.length ? ARGS : fs.readdirSync(path.join(__dirname, '../../../screens'))
    .filter(f => /\.html$/.test(f) && /getActiveCompanies/.test(fs.readFileSync(path.join(__dirname, '../../../screens', f), 'utf8'))).map(f => f.replace(/\.html$/, ''));
  for (const mod of WITH_CHOICE) {
    const problems = [];
    let checked = 0;
    try {
      const page = await open(mod, 'u-chose2');
      const sels = await page.$$eval('#module-container select', ss => ss.map(s => {
        const o = v => Array.from(s.options).find(x => x.value === v);
        return { id: s.id || s.name || s.className, value: s.value, c1: o('C1') ? (o('C1').hidden ? 'hidden' : 'shown') : 'none', c2: Boolean(o('C2')) };
      }).filter(s => s.c1 !== 'none' || s.c2));
      for (const s of sels) {
        checked++;
        if (s.value === 'C1') problems.push(s.id + ' is set to C1, not chosen');
        if (s.c1 === 'shown') problems.push(s.id + ' offers C1, not chosen');
      }
      problems.push(...await failedCalls(page), ...page.__errors);
      await page.close();
    } catch (e) {
      problems.push(e.message.split('\n')[0]);
    }
    results.push([problems.length ? 'FAIL' : 'PASS', mod, 'u-chose2', checked + ' company dropdowns', '', problems.join(' | ')]);
  }

  await browser.close(); server.close();
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
