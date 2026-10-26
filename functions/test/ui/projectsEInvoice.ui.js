// Projects and dimension rules, and the e-invoice on the invoice, on screen
// (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, E_INVOICING.md):
// a heading's rule set in the Chart of Accounts with the "Now" hint; a
// project in Organizational Units with its customer and dates; the JV's
// Project column once there is a project, the line marked when its account
// needs one; the Project Report; a posted invoice's e-invoice status with
// what is missing, its XML and Check again.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/projectsEInvoice.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val, rtdb } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };
const T = { timeout: 30000 };
const D = '2026-09-10';

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'G-SITE': { AccountCode: '630000', AccountName: 'Site expenses', AccountType: 'Expense', Status: 'Active', IsPostable: false },
    'A-SITE': { AccountCode: '630001', AccountName: 'Site labour', AccountType: 'Expense', Status: 'Active', IsPostable: true, ParentAccountID: 'G-SITE' }
  });
  Object.assign(f.companies.C1, { TaxNumbers: [{ Type: 'TRN', Number: '100000000000003' }], AddressLine1: '1 Sample Street', City: 'Dubai', Country: 'UAE', OutputTaxAccountID: 'A-VATOUT' });
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Tower Client', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0, TaxRegistrationNumber: '100000000000010', AddressLine1: '' } };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Contract', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  await reset(f);
  ok(await call('u-admin', 'saveEInvoiceSettings', { companyId: 'C1', enabled: true, startDate: '2026-09-01', aspName: '' }));
  const inv = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Stage 1', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 500, Description: 'Stage 1', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 5 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv.invoiceId }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8103);
  const browser = await chromium.launch();
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8103/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  const option = (page, sel, value) => page.waitForFunction(([s, v]) => [...document.querySelectorAll(s + ' option')].some(o => o.value === v), [sel, value], T);

  await check('Chart of Accounts: a heading\'s rule (project required) with the hint showing what applies', async () => {
    const p = await open('COA');
    await p.waitForSelector('#coa-table-body tr', T);
    await p.locator('#coa-table-body tr', { hasText: 'Site labour' }).first().locator('.coa-edit').click();
    await p.waitForSelector('#coa-modal:not(.hidden)', T);
    assert.match(await p.textContent('#coa-dim-CostCenter-hint'), /Now: required \(the default\)/);
    await p.click('#coa-modal-cancel');
    await p.locator('#coa-table-body tr', { hasText: 'Site expenses' }).first().locator('.coa-edit').click();
    await p.waitForSelector('#coa-modal:not(.hidden)', T);
    await p.selectOption('#coa-dim-Project', 'Required');
    await p.selectOption('#coa-dim-CostCenter', 'Optional');
    await p.click('#coa-save-btn');
    await p.waitForSelector('#coa-modal', { state: 'hidden', ...T });
    assert.deepEqual((await val('coa/G-SITE')).DimensionRules, { CostCenter: 'Optional', ProfitCenter: '', Project: 'Required' });
    // The list reloads after a save (its time varies): reopen until the account shows the heading's new rule.
    let hint = '';
    for (let i = 0; i < 20 && !/Now: required \(from 630000\)/.test(hint); i++) {
      if (i) { await p.click('#coa-modal-cancel'); await p.waitForTimeout(500); }
      await p.waitForLoadState('networkidle');
      await p.locator('#coa-table-body tr', { hasText: 'Site labour' }).first().locator('.coa-edit').click();
      await p.waitForSelector('#coa-modal:not(.hidden)', T);
      hint = await p.textContent('#coa-dim-Project-hint');
    }
    assert.match(hint, /Now: required \(from 630000\)/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Organizational Units: a project with its customer and dates; Closed offered for a project only', async () => {
    const p = await open('ORGUNITS');
    await p.click('#ou-add-btn');
    await p.selectOption('#ou-form-type', 'CostCenter');
    assert.equal(await p.isHidden('#ou-project-fields'), true);
    await p.selectOption('#ou-form-type', 'Project');
    await p.waitForSelector('#ou-project-fields:not(.hidden)', T);
    await option(p, '#ou-form-customer', 'CU1');
    await p.fill('#ou-form-code', 'PRJ-1'); await p.fill('#ou-form-name', 'Tower A');
    await p.selectOption('#ou-form-customer', 'CU1');
    await p.fill('#ou-form-start', '2026-09-01'); await p.fill('#ou-form-end', '2026-12-31');
    await p.click('#ou-save-btn');
    await p.waitForSelector('#ou-modal', { state: 'hidden', ...T });
    const u = Object.values(await val('orgUnits')).find(x => x.Code === 'PRJ-1');
    assert.deepEqual([u.Type, u.CustomerID, u.StartDate, u.EndDate], ['Project', 'CU1', '2026-09-01', '2026-12-31']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('JV: the Project column once there is a project; a site labour line marked until it has one; posted with it', async () => {
    const p = await open('JV');
    await p.click('#jv-new-btn');
    await p.selectOption('#jv-form-company', 'C1');
    await p.fill('#jv-form-date', D);
    await p.fill('#jv-form-description', 'Site costs');
    await p.waitForSelector('#jv-project-head:not(.hidden)', T);
    const cell = (r, c) => p.locator('#jv-grid-body input[data-row="' + r + '"][data-col="' + c + '"]');
    await cell(0, 0).fill('630001'); await cell(0, 0).blur();
    await cell(0, 1).fill('Labour'); await cell(0, 1).blur();
    await cell(0, 2).fill('100'); await cell(0, 2).blur();
    await cell(1, 0).fill('1100'); await cell(1, 0).blur();
    await cell(1, 1).fill('Bank'); await cell(1, 1).blur();
    await cell(1, 3).fill('100'); await cell(1, 3).blur();
    await p.waitForFunction(() => /red/.test(document.querySelector('.jv-line-project[data-row="0"]').className), null, T);
    await p.click('#jv-save-draft-btn');
    await p.waitForFunction(() => /marked in red/.test(document.getElementById('jv-form-error').textContent), null, T);
    const pid = Object.entries(await val('orgUnits')).find(([, x]) => x.Code === 'PRJ-1')[0];
    await p.selectOption('.jv-line-project[data-row="0"]', pid);
    await p.click('#jv-post-btn');
    await p.click('#jv-confirm-ok');
    await p.waitForSelector('#jv-list-view:not(.hidden)', T);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Project Report: the project\'s income, costs and result; its accounts on a tap', async () => {
    const p = await open('PROJECTREPORT');
    await option(p, '#pr-company', 'C1');
    await p.selectOption('#pr-company', 'C1');
    await p.fill('#pr-from-date', '2026-09-01'); await p.fill('#pr-to-date', '2026-09-30');
    await p.click('#pr-run-btn');
    await p.waitForSelector('#pr-results:not(.hidden) .pr-row', T);
    const row = p.locator('.pr-row', { hasText: 'PRJ-1' });
    assert.match(await row.textContent(), /Tower A[\s\S]*Tower Client[\s\S]*100\.00[\s\S]*-100\.00/);
    await row.click();
    await p.waitForSelector('.pr-account', T);
    assert.match(await p.textContent('.pr-account'), /630001 Site labour/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Invoice: the posted invoice\'s e-invoice, Not ready with what is missing; fixed, Check again makes it ready', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.waitForSelector('#cinv-table-body tr', T);
    await p.evaluate(() => document.querySelector('#cinv-table-body tr').click());
    await p.waitForSelector('#cinv-einv:not(.hidden)', T);
    assert.equal((await p.textContent('#cinv-einv-status')).trim(), 'Not ready');
    assert.match(await p.textContent('#cinv-einv-issues'), /customer's address is missing/);
    assert.equal(await p.isVisible('#cinv-einv-xml'), true);
    await rtdb.ref('customers/CU1/AddressLine1').set('2 Test Road');
    await p.click('#cinv-einv-again');
    await p.waitForFunction(() => document.getElementById('cinv-einv-status').textContent.trim() === 'Ready to send', null, T);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
