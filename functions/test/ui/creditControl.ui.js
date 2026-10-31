// Credit Control (docs/modules/CREDIT_CONTROL.md, step C1) in the browser,
// on the emulators: the customers with what they owe, deliveries not yet
// invoiced and open orders; a limit set and the customer over it; a hold
// put on with its reason and lifted; a customer's documents; the filter and
// Copy; Setup (the receivable only drops the order columns); a Viewer reads
// only. Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/creditControl.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /creditControl.ui/.test(l))]); }); }
const ok = r => { if (r.success === false) throw new Error(r.error); return r; };
const S = require('../../src/recurringSchedule');
const today = S.todayIn(S.TIME_ZONE);
const daysAgo = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

async function seed() {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Alpha Traders', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Beta Stores', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' }
  };
  f.salesOrders = { SO1: { CompanyID: 'C1', CustomerID: 'CU1', Status: 'Reserved', SONumber: 'SO-1', SODate: daysAgo(5), CurrencyID: '',
    Lines: [{ LineID: 'L1', ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 10, DeliveredQuantity: 4, UnitPrice: 50 }] } };
  f.stock = { transactions: { DN1: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'DN-1', TransactionDate: daysAgo(3),
    Lines: [{ ItemCode: 'RM-001', Quantity: 4, UnitPrice: 50, SourceSOID: 'SO1', SourceSOLineID: 'L1' }] } } };
  await reset(f);
  // Alpha owes 1,000 since 40 days ago (a refund paid to it, not yet settled).
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: daysAgo(40), Description: 'Refund', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '1200', Amount: 1000, Description: 'Refund', PartyType: 'Customer', PartyID: 'CU1', Allocations: [] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}

(async () => {
  await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8196);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const T = { timeout: 30000 };
  async function open(uid, answers) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' && answers ? answers.shift() : undefined); });
    await page.goto('http://127.0.0.1:8196/?module=CREDITCONTROL&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => document.querySelectorAll('#cc-body tr[data-id]').length === 2, null, T);
    return page;
  }
  const row = (p, id) => p.locator('#cc-body tr[data-id="' + id + '"]');
  const cells = async (p, id) => (await row(p, id).locator('td').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  const lastDialog = p => p.__dialogs[p.__dialogs.length - 1] || '';

  await check('the customers: what Alpha owes, delivered not invoiced, open orders, exposure, overdue; a limit set puts it over, first in the list', async () => {
    const p = await open('u-admin');
    let c = await cells(p, 'CU1');
    assert.deepEqual(c.slice(2, 8), ['1,000.00', '200.00', '300.00', '1,500.00', '', '1,000.00 40 days']);
    assert.match(c[8], /Overdue/);
    await row(p, 'CU1').locator('.cc-limit').fill('1200');
    await row(p, 'CU1').locator('.cc-save-limit').click();
    await p.waitForFunction(() => { const r = document.querySelector('#cc-body tr[data-id="CU1"]'); return Boolean(r) && /Over the limit/.test(r.innerText); }, null, T);
    c = await cells(p, 'CU1');
    assert.equal(c[6], '-300.00');
    assert.equal(await p.locator('#cc-body tr[data-id]').first().getAttribute('data-id'), 'CU1');
    // Its documents.
    await row(p, 'CU1').locator('.cc-open').click();
    const d = (await p.locator('#cc-detail').innerText()).replace(/\s+/g, ' ');
    assert.match(d, /DN-1/); assert.match(d, /SO-1/); assert.match(d, /40 days over/);
    // The filter: Beta, in good standing, drops out.
    await p.check('#cc-attention');
    assert.equal(await p.locator('#cc-body tr[data-id]').count(), 1);
    await p.click('#cc-copy');
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    assert.match(clip.split('\n')[1], /^C001\tAlpha Traders\t1200\t1000\t0\t200\t300\t1500\t-300\t1000\t40\t\tOver the limit, Overdue$/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a hold: put on with its reason, shown and first; lifted', async () => {
    const p = await open('u-admin', ['Cheque returned', '']);
    await row(p, 'CU2').locator('.cc-hold').click();
    await p.waitForFunction(() => { const r = document.querySelector('#cc-body tr[data-id="CU2"]'); return Boolean(r) && /On hold/.test(r.innerText); }, null, T);
    assert.match((await cells(p, 'CU2'))[0], /Cheque returned \(admin\)/);
    assert.equal(await p.locator('#cc-body tr[data-id]').first().getAttribute('data-id'), 'CU2');
    await row(p, 'CU2').locator('.cc-hold').click();
    await p.waitForFunction(() => { const r = document.querySelector('#cc-body tr[data-id="CU2"]'); return Boolean(r) && /Good/.test(r.innerText); }, null, T);
    assert.equal((await firestore.collection('creditLimits').doc('C1__CU2').get()).data().Hold, false);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Setup: the receivable only drops the order columns and the exposure; a Viewer reads only', async () => {
    const p = await open('u-admin');
    await p.click('.cc-tab[data-tab="setup"]');
    await p.selectOption('#cc-setup-exposure', 'Receivable');
    await p.fill('#cc-setup-grace', '45');
    await p.click('#cc-setup-save');
    for (let i = 0; i < 50 && !/Saved/.test(lastDialog(p)); i++) await p.waitForTimeout(100);
    await p.click('.cc-tab[data-tab="customers"]');
    await p.waitForFunction(() => document.querySelector('#cc-body tr[data-id="CU1"]') && document.querySelector('#cc-body tr[data-id="CU1"]').querySelectorAll('td').length === 8, null, T);
    const c = await cells(p, 'CU1');
    assert.deepEqual([c[3], c[4], c[5]], ['1,000.00', '200.00', '']); // exposure, available, not overdue within 45 days
    assert.deepEqual((await firestore.collection('creditSetup').doc('C1').get()).data().GraceDays, 45);
    await p.close();
    const v = await open('u-viewer');
    assert.equal(await v.locator('.cc-limit, .cc-save-limit, .cc-hold').count(), 0);
    await v.click('.cc-tab[data-tab="setup"]');
    assert.equal(await v.locator('#cc-setup-check').isDisabled(), true);
    assert.equal(await v.locator('#cc-setup-save').isHidden(), true);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
