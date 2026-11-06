// CRM step C4 (owner, 2026-11-06; docs/modules/CRM.md, Q402, Q407-Q410):
// CRM → Reports for a manager (base-currency totals, the missing-rate
// notice, the owner filter, Copy to Excel) and for a user (their own, no
// owner filter); CRM Leads in Master Import (a match warned and left out,
// Import matches too checking again and importing every row).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/crmReports.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const f = baseFixture();
  f.users['u-rep1'] = { status: 'Active', role: 'Sales', username: 'rep1', fullName: 'Rep One', AssignedCompanies: ['C1'] };
  f.roles.Sales = { Name: 'Sales', Status: 'Active' };
  f.permissions.CRM.access.push('Sales'); f.permissions.CRM.write.push('Sales');
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Phone: '+971 50 111 2222', TradeReceivablesAccountID: 'A-AR' } };
  f.currencies = { AED: { Code: 'AED', Name: 'UAE Dirham', Status: 'Active', IsDefault: true }, USD: { Code: 'USD', Name: 'US Dollar', Status: 'Active' }, EUR: { Code: 'EUR', Name: 'Euro', Status: 'Active' } };
  f.exchangeRates = { USD: { r1: { EffectiveDate: '2026-01-01', Rate: 3.6725, At: '2026-01-01T00:00:00Z' } } };
  await reset(f);
  const o = (id, x) => firestore.collection('crmOpportunities').doc(id).set(Object.assign({ CompanyID: 'C1', CustomerID: 'CU1', LeadID: '', Title: id, Stage: 'New', Probability: 10, Status: 'Open', OwnerKey: 'U:u-admin', ExpectedValue: 1000, Currency: 'AED', ExpectedClose: '' }, x));
  await Promise.all([
    o('Racks', {}), o('Shelving', { OwnerKey: 'U:u-rep1', Stage: 'Proposal', Probability: 50, ExpectedValue: 100, Currency: 'USD' }), o('Euro deal', { ExpectedValue: 50, Currency: 'EUR' }),
    o('Won deal', { Status: 'Won', Stage: 'Won', Probability: 100, ExpectedValue: 400, ClosedAt: today + 'T08:00:00Z' })
  ]);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8212);
  const browser = await chromium.launch();
  const dialogs = [];
  async function open(module, uid, ready) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied.push(t); return Promise.resolve(); } } }); });
    await page.goto('http://127.0.0.1:8212/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    if (ready) await page.waitForSelector(ready, Object.assign({ state: 'attached' }, T));
    return page;
  }
  const section = (page, key) => page.$$eval('[data-report="' + key + '"] tbody tr', t => t.map(r => [...r.children].map(c => c.textContent.trim())));

  const page = await open('CRM', 'u-admin', '#crm-leads-body tr');
  await check('Reports (a manager): the pipeline in AED at the rate, EUR noted and left out; every owner', async () => {
    await page.click('.crm-tab[data-tab="reports"]');
    await page.waitForSelector('[data-report="stage"]', T);
    assert.deepEqual(await section(page, 'stage'), [
      ['New', '10 %', '2', '1,000.00', '100.00'], ['Qualified', '25 %', '0', '0.00', '0.00'], ['Proposal', '50 %', '1', '367.25', '183.63'],
      ['Negotiation', '75 %', '0', '0.00', '0.00'], ['Total', '', '3', '1,367.25', '283.63']]);
    assert.match(await page.textContent('#crm-rep-missing'), /No exchange rate for EUR/);
    assert.ok(await page.isVisible('#crm-rep-owner'));
    const wl = await section(page, 'wowner');
    assert.deepEqual(wl[wl.length - 1], ['Total', '1', '400.00', '0', '0.00', '100 %']);
  });

  await check('Reports: the owner filter shows one owner; Copy to Excel copies the table with its headings', async () => {
    await page.selectOption('#crm-rep-owner', 'U:u-rep1');
    await page.click('#crm-rep-run');
    await page.waitForFunction(() => document.querySelectorAll('[data-report="powner"] tbody tr').length === 2, null, T);
    assert.deepEqual((await section(page, 'powner'))[0], ['Rep One', '1', '367.25', '183.63']);
    await page.click('.crm-rep-copy[data-key="plines"]');
    await page.waitForFunction(() => window.__copied.length > 0, null, T);
    const copied = await page.evaluate(() => window.__copied[0]);
    assert.match(copied.split('\n')[0], /^Opportunity\tLead or customer\tStage\tOwner\tExpected close\tValue\tCurrency\tValue \(AED\)\tWeighted \(AED\)$/);
    assert.match(copied.split('\n')[1], /^Shelving\tRetail Co \(C001\)\tProposal\tRep One\t\t100\.00\tUSD\t367\.25\t183\.63$/);
    assert.deepEqual(page.__errors, []);
  });

  await check('Reports (a user): their own only, no owner filter', async () => {
    const p = await open('CRM', 'u-rep1', '#crm-leads-body tr');
    await p.click('.crm-tab[data-tab="reports"]');
    await p.waitForSelector('[data-report="stage"]', T);
    assert.ok(await p.isHidden('#crm-rep-owner-wrap'));
    assert.deepEqual((await section(p, 'stage')).pop(), ['Total', '', '1', '367.25', '183.63']);
    assert.ok(await p.isHidden('#crm-rep-missing'), 'no EUR among theirs');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Master Import → CRM Leads: a match warned and left out; Import matches too checks again; then every row imported', async () => {
    const m = await open('MASTERIMPORT', 'u-admin', '#mimp-master option[value="LEAD"]');
    await m.selectOption('#mimp-master', 'LEAD');
    await m.fill('#mimp-paste', 'Company\tOrganisation\tPhone\n01\tNew Co\t056 123 4567\n01\tPhone Twin\t00971501112222');
    await m.click('#mimp-check');
    await m.waitForFunction(() => /checked/.test(document.getElementById('mimp-status').textContent), null, T);
    assert.equal(await m.textContent('#mimp-status'), '2 rows checked, no issues, 1 match left out. Ready to import.');
    assert.equal(await m.textContent('#mimp-warnings'), 'Row 2: Matches customer Retail Co (C001) (phone). Left out.');
    await m.check('#mimp-import-matches');
    await m.waitForFunction(() => /Imported anyway/.test(document.getElementById('mimp-warnings').textContent), null, T);
    assert.equal(await m.textContent('#mimp-status'), '2 rows checked, no issues. Ready to import.');
    await m.click('#mimp-import');
    await m.waitForFunction(() => /imported into/.test(document.getElementById('mimp-status').textContent), null, T);
    assert.equal(await m.textContent('#mimp-status'), '2 rows imported into CRM Leads.');
    assert.ok(dialogs.includes('Import 2 rows into CRM Leads?'), dialogs.join(' | '));
    assert.ok(await m.isHidden('#mimp-warnings-wrap'));
    const orgs = (await firestore.collection('crmLeads').where('CompanyID', '==', 'C1').get()).docs.map(d => d.data().Organisation).sort();
    assert.deepEqual(orgs, ['New Co', 'Phone Twin']);
    assert.deepEqual(m.__errors, []);
    await m.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
