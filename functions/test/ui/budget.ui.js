// Budget (docs/modules/BUDGET.md, step B1) in the browser, on the
// emulators: a budget made on the grid (a line added, a year total spread,
// rows pasted from Excel, the profit at the foot), submitted and, with no
// approval set, approved; Budget vs Actual (the year to date against the
// posted entries, better or worse coloured, a line not budgeted, an actual
// opening the GL Report); a revision waiting on its approver, opened as
// Home opens it and approved there; a forecast with its actuals locked,
// finalised and shown beside the budget; Budget Setup; a Viewer reads only.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/budget.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, rtdb, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /budget.ui/.test(l))]); }); }
const ok = r => { if (r.success === false) throw new Error(r.error); return r; };
const post = (date, lines) => firestore.collection('journalEntries').add({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: 'JV', JVNumber: 'JV-' + date,
  Lines: lines.map(([AccountID, Debit, Credit, CostCenterID]) => ({ AccountID, Debit, Credit, CostCenterID: CostCenterID || '' })) });
const YEAR = new Date().toISOString().slice(0, 4);

async function seed() {
  const f = baseFixture();
  f.coa['A-RENT'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.requisitionCategories = { RC1: { Name: 'Premises', Type: 'DirectExpense', GLAccountID: 'A-RENT', Status: 'Active', CompanyID: 'C1' } };
  await reset(f);
  await post(YEAR + '-01-10', [['A-BANK', 5000, 0], ['A-REV', 0, 5000]]);
  await post(YEAR + '-01-20', [['A-RENT', 900, 0, 'CC1'], ['A-RENT', 70, 0, 'CC2'], ['A-BANK', 0, 970]]);
  const inTwoDays = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await firestore.collection('pdcCheques').add({ CompanyID: 'C1', Status: 'Pending', Direction: 'Issued', ChequeDate: inTwoDays, Amount: 250, TransactionNumber: 'PDCI-7' });
}

(async () => {
  await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8175);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const T = { timeout: 30000 };
  async function open(uid, answers) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' && answers ? answers.shift() : undefined); });
    await page.goto('http://127.0.0.1:8175/?module=BUDGET&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => document.querySelectorAll('#bud-new-year option').length === 3, null, T);
    return page;
  }
  const lastDialog = p => p.__dialogs[p.__dialogs.length - 1] || '';

  await check('a budget on the grid: a line, a year total spread, Excel rows pasted, the profit; submitted, approved with no approval set', async () => {
    const p = await open('u-admin');
    await p.selectOption('#bud-new-year', YEAR + '-01');
    await p.click('#bud-new');
    await p.waitForSelector('#bud-entry-view:not(.hidden)', T);
    assert.equal(await p.textContent('#bud-entry-title'), 'Budget FY ' + YEAR + ' Original');
    await p.selectOption('#bud-add-account', 'A-RENT'); await p.selectOption('#bud-add-cc', 'CC1');
    await p.click('#bud-add');
    await p.fill('#bud-grid-body tr:has-text("Rent") >> nth=0 >> .bud-year', '12000');
    await p.press('#bud-grid-body tr:has-text("Rent") >> nth=0 >> .bud-year', 'Tab');
    await p.waitForFunction(() => document.querySelector('#bud-grid-body .bud-amt') && document.querySelector('#bud-grid-body .bud-amt').value === '1000');
    await p.click('#bud-paste');
    await p.fill('#bud-paste-text', ['4000\t\t\t' + Array(12).fill(1000).join('\t'), '6100\tCC2\t\t1200', '9999\t\t\t5'].join('\n'));
    await p.click('#bud-paste-add');
    await p.waitForFunction(() => document.querySelectorAll('#bud-grid-body tr[data-i]').length === 3, null, T);
    assert.match(p.__dialogs.find(m => /pasted/.test(m)) || '', /2 lines pasted\. Not pasted:\nRow 3: account "9999" not found\./);
    // The foot: revenue 12,000, costs 12,000 + 1,200, the profit -1,200.
    const foot = (await p.innerText('#bud-grid-foot')).replace(/\s+/g, ' ');
    assert.match(foot, /Revenue .*12,000\.00/); assert.match(foot, /Profit .*-1,200\.00/);
    await p.click('#bud-submit');
    await p.waitForFunction(() => /Current/.test(document.getElementById('bud-entry-sub').textContent), null, T);
    assert.ok(p.__dialogs.includes('Approved: it is now the Current budget.'), p.__dialogs.join(' | '));
    assert.ok(await p.isHidden('#bud-save'), 'approved: not editable');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Budget vs Actual: January to date against the posted entries, coloured, a line not budgeted; an actual opens the GL Report', async () => {
    const p = await open('u-viewer');
    assert.ok(await p.isHidden('#bud-new'), 'a Viewer prepares nothing');
    await p.click('.bud-tab[data-tab="report"]');
    await p.waitForFunction(() => document.querySelectorAll('#bud-rep-budget option').length === 1 && document.getElementById('bud-rep-budget').value, null, T);
    await p.selectOption('#bud-rep-through', YEAR + '-01');
    await p.click('#bud-rep-run');
    await p.waitForSelector('#bud-rep-out table', T);
    const cells = async text => (await p.locator('#bud-rep-out tr', { hasText: text }).first().locator('td').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    const sales = await cells('4000 Sales');
    assert.deepEqual(sales.slice(1, 10), ['The company', '', '1,000.00', '5,000.00', '1,000.00', '5,000.00', '4,000.00', '400%', '12,000.00']);
    assert.ok(await p.locator('#bud-rep-out tr', { hasText: '4000 Sales' }).first().locator('td.text-emerald-400').count(), 'more revenue: green');
    const rentCc1 = await cells('CC1 Workshop');
    assert.deepEqual([rentCc1[5], rentCc1[6], rentCc1[7]], ['1,000.00', '900.00', '-100.00']);
    assert.match((await cells('CC2 Office')).join(' '), /1,200\.00/, 'CC2 budgeted by the paste');
    // The profit: 5,000 - 970 against 1,000 - 1,100 for January; the year 12,000 - 13,200.
    assert.match((await p.innerText('#bud-rep-out')).replace(/\s+/g, ' '), /Profit -100\.00 4,030\.00 -100\.00 4,030\.00 4,130\.00 -1,200\.00/);
    await p.selectOption('#bud-rep-level', '0');
    await p.waitForFunction(() => /Heading/.test(document.querySelector('#bud-rep-out thead').textContent));
    await p.selectOption('#bud-rep-level', 'line');
    await p.waitForSelector('#bud-rep-out .bud-drill', T);
    await p.evaluate(() => { window.openModule = (m, params) => { window.__drill = [m, params]; }; });
    await p.locator('#bud-rep-out tr', { hasText: 'CC1 Workshop' }).first().locator('.bud-drill[data-p="ytd"]').click();
    assert.deepEqual(await p.evaluate(() => window.__drill), ['GLREPORT', { AccountCode: '6100', FromDate: YEAR + '-01-01', ToDate: YEAR + '-01-31', CompanyID: 'C1', CostCenterID: 'CC1', ProjectID: '' }]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a revision waits on its approver, who opens it as Home does and approves it; the Original stays approved', async () => {
    await rtdb.ref('approvalConfigurations/BUDGET').set({ Enabled: true, ScopeType: 'Global' });
    await rtdb.ref('approvalLevels/BUDGET/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
    const r = ok(await call('u-admin', 'createBudget', { companyId: 'C1', yearStart: YEAR + '-01' }));
    const rev = await call('u-admin', 'getBudget', { budgetId: r.budgetId });
    ok(await call('u-admin', 'saveBudgetDraft', { budgetId: r.budgetId, lines: rev.Lines }));
    assert.equal(ok(await call('u-admin', 'submitBudget', { budgetId: r.budgetId })).status, 'PendingApproval');
    const p = await open('u-approver');
    await p.evaluate(id => openModule('BUDGET', { OpenEntryId: id }), r.budgetId);
    await p.waitForFunction(t => document.getElementById('bud-entry-title') && document.getElementById('bud-entry-title').textContent === t, 'Budget FY ' + YEAR + ' Revision 1', T);
    await p.waitForSelector('#bud-approve:not(.hidden)', T);
    await p.click('#bud-approve');
    await p.waitForFunction(() => /Current/.test(document.getElementById('bud-entry-sub').textContent), null, T);
    await p.click('#bud-back');
    const list = (await p.innerText('#bud-list-body')).replace(/\s+/g, ' ');
    assert.match(list, /Revision 1 Approved Current/);
    assert.match(list, /Original Approved \d/, 'the Original kept, not Current');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a forecast: actuals to January locked, a year total spread over the months ahead, finalised; its year beside the budget', async () => {
    const p = await open('u-admin');
    await p.click('.bud-tab[data-tab="forecasts"]');
    await p.selectOption('#bud-fc-year', YEAR + '-01');
    await p.selectOption('#bud-fc-through', YEAR + '-01');
    await p.click('#bud-fc-new');
    await p.waitForFunction(t => document.getElementById('bud-entry-title').textContent === t, 'Forecast 1 FY ' + YEAR + ' (actuals to Jan-' + YEAR + ')', T);
    const sales = '#bud-grid-body tr:has-text("4000 Sales")';
    assert.equal(await p.locator(sales + ' .bud-amt').count(), 11, 'January is the actual, not typed');
    assert.match(await p.locator(sales + ' td').nth(3).innerText(), /5,000\.00/);
    assert.ok(await p.isHidden('#bud-seed') && await p.isHidden('#bud-submit') && await p.isVisible('#bud-finalise'));
    await p.fill(sales + ' .bud-year', '16000');
    await p.press(sales + ' .bud-year', 'Tab');
    await p.waitForFunction(() => document.querySelector('#bud-grid-body .bud-amt') && document.querySelector('#bud-grid-body tr .bud-amt[data-m="1"]').value === '1000');
    await p.click('#bud-finalise');
    await p.waitForFunction(() => /^Final/.test(document.getElementById('bud-entry-sub').textContent), null, T);
    assert.ok(await p.isHidden('#bud-save'), 'final: kept as it is');
    await p.click('#bud-back');
    assert.match((await p.innerText('#bud-fc-body')).replace(/\s+/g, ' '), /Forecast 1 FY \d{4} .*Final 16,000\.00/);
    await p.click('.bud-tab[data-tab="report"]');
    await p.waitForFunction(() => document.querySelectorAll('#bud-rep-forecast option').length === 2, null, T);
    await p.selectOption('#bud-rep-through', YEAR + '-01');
    await p.click('#bud-rep-run');
    await p.waitForSelector('#bud-rep-out table', T);
    const row = (await p.locator('#bud-rep-out tr', { hasText: '4000 Sales' }).first().locator('td').allInnerTexts()).map(x => x.trim());
    assert.deepEqual(row.slice(-3), ['12,000.00', '16,000.00', '4,000.00'], 'year budget, year forecast, forecast less budget');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the spending check on a Purchase Order: over budget, the warning answered, submitted; the overrun kept on it (B3)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const d = ok(await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: today, CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
      Lines: [{ CategoryID: 'RC1', Description: 'Extra space', Quantity: 1, UOM: 'month', UnitPrice: 50000 }] } }));
    const p = await open('u-admin');
    await p.evaluate(id => openModule('PURCHASEORDER', { OpenEntryId: id }), d.poId);
    await p.waitForSelector('#po-submit-btn:not(.hidden)', T);
    await p.click('#po-submit-btn');
    for (let i = 0; i < 100 && !p.__dialogs.some(m => /Over budget/.test(m)); i++) await p.waitForTimeout(100);
    assert.match(p.__dialogs.find(m => /Over budget/.test(m)) || p.__dialogs.join(' | '), /^Over budget \(warning\) .*6100 Rent \/ CC1: budget .*this document 50,000\.00, over by .*Continue anyway\?/);
    let po = null;
    for (let i = 0; i < 100; i++) { po = await val('purchaseOrders/' + d.poId); if (po.Status !== 'Draft') break; await p.waitForTimeout(100); }
    assert.equal(po.Status, 'Approved', 'submitted once the warning was answered');
    assert.deepEqual([po.BudgetCheck.Mode, po.BudgetCheck.Accepted, po.BudgetCheck.Findings[0].AccountCode], ['Warn', true, '6100']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the cash forecast: the bank today, a cheque issued in week 1 and what makes it; the balance carried (B4)', async () => {
    const p = await open('u-viewer');
    await p.click('.bud-tab[data-tab="cash"]');
    await p.click('#bud-cash-run');
    await p.waitForSelector('#bud-cash-out table', T);
    const text = (await p.innerText('#bud-cash-out')).replace(/\s+/g, ' ');
    assert.match(text, /Cash and bank today: 4,030\.00/i);
    assert.match(text, /Cheques issued 250\.00/);
    // The 50,000 PO of the check before is open (approved, nothing received), due today on its terms.
    assert.match(text, /Open Purchase Orders 50,000\.00/);
    assert.match(text, /Balance at the end -46,220\.00/, 'after week 1: 4,030 less the cheque and the order');
    await p.click('#bud-cash-out .bud-cash-cell');
    await p.waitForSelector('#bud-cash-detail:not(.hidden)', T);
    assert.match(await p.innerText('#bud-cash-detail-body'), /Cheques issued PDCI-7[\s\S]*250\.00/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Budget Setup: saved by who may set up, read-only to a Viewer', async () => {
    const v = await open('u-viewer');
    await v.click('.bud-tab[data-tab="setup"]');
    assert.equal(await v.isDisabled('#bud-setup-save'), true);
    await v.close();
    const p = await open('u-admin');
    await p.click('.bud-tab[data-tab="setup"]');
    await p.selectOption('#bud-setup-bs', 'Closing');
    await p.click('#bud-setup-save');
    for (let i = 0; i < 50 && !/Saved/.test(lastDialog(p)); i++) await p.waitForTimeout(100);
    assert.equal((await firestore.collection('budgetSetup').doc('C1').get()).data().BalanceSheet, 'Closing');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
