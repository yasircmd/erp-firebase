// In-app dialogs (public/index.html, APP DIALOGS; owner, 2026-09-29): no
// browser popups. A generated screen's confirmation, a hand screen's text
// question (Cancel PO: Cancel on it keeps the PO), and the dialog itself:
// alert() routed in-app, one at a time, keys, the copy box.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/appDialogs.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = '2026-09-10';

(async () => {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftPurchaseOrder', { poData: { PODate: D, CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 2, UOM: 'box', UnitPrice: 8 }] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await call('u-admin', 'submitPurchaseOrder', { poId: s.poId })).status, 'Approved');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8148);
  const browser = await chromium.launch();
  // Answers come from the test (page.__answer), in the order dialogs appear.
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = []; page.__answers = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => {
      page.__dialogs.push(d.type() + ': ' + d.message());
      const a = page.__answers.shift();
      if (a === undefined) return; // left open for the test to drive
      return a === false ? d.dismiss() : d.accept(a === true ? undefined : a);
    });
    await page.goto('http://127.0.0.1:8148/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    return page;
  }
  const shown = page => page.isVisible('#app-dialog');

  await check('a generated screen confirms in the app: Esc keeps the unit, Enter deactivates it', async () => {
    const page = await open('UOM');
    await page.locator('#uom-table-body tr', { hasText: 'PCS' }).locator('.uom-toggle').click();
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.equal(await page.textContent('#app-dialog-message'), 'Deactivate PCS?');
    assert.equal(await page.textContent('#app-dialog-title'), 'Please confirm');
    assert.equal(await page.textContent('#app-dialog-ok'), 'Confirm');
    assert.match(await page.getAttribute('#app-dialog-ok', 'class'), /bg-red-600/, 'deactivating: a red button');
    assert.ok(await page.isVisible('#app-dialog-cancel'));
    await page.keyboard.press('Escape');
    assert.equal(await shown(page), false);
    await page.waitForTimeout(800);
    assert.equal(await val('uoms/UOM-PCS/Status'), 'Active', 'Esc is Cancel');
    assert.equal(await page.evaluate(() => window.__rpcLog.some(x => /activateUOM$/.test(x.name))), false);

    await page.locator('#uom-table-body tr', { hasText: 'PCS' }).locator('.uom-toggle').click();
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'app-dialog-ok', 'OK has the focus');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__rpcLog.some(x => x.name === 'deactivateUOM' && x.ok), null, { timeout: 20000 });
    assert.equal(await val('uoms/UOM-PCS/Status'), 'Inactive');
    assert.deepEqual(page.__dialogs, ['confirm: Deactivate PCS?', 'confirm: Deactivate PCS?']);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Cancel PO asks for the reason in the app; Cancel on it keeps the PO, OK cancels it with the reason', async () => {
    const page = await open('PURCHASEORDER');
    await page.evaluate(id => openModule('PURCHASEORDER', { OpenEntryId: id }), s.poId);
    await page.waitForSelector('#po-cancel-btn:not(.hidden)', { timeout: 30000 });
    page.__answers.push(false);
    await page.click('#po-cancel-btn');
    await page.waitForTimeout(1500);
    assert.deepEqual(page.__dialogs, ['prompt: Reason for cancelling this Purchase Order (optional):']);
    assert.equal(await val('purchaseOrders/' + s.poId + '/Status'), 'Approved', 'Cancel on the question keeps the PO');
    assert.equal(await page.evaluate(() => window.__rpcLog.some(x => x.name === 'cancelPurchaseOrder')), false);

    page.__answers.push('Vendor out of stock');
    await page.click('#po-cancel-btn');
    await page.waitForFunction(() => window.__rpcLog.some(x => x.name === 'cancelPurchaseOrder'), null, { timeout: 20000 });
    const sent = await page.evaluate(() => window.__rpcLog.find(x => x.name === 'cancelPurchaseOrder'));
    assert.equal(sent.ok, true, sent.error);
    assert.equal(sent.arg.reason, 'Vendor out of stock');
    assert.equal(await val('purchaseOrders/' + s.poId + '/Status'), 'Cancelled');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the dialog: alert() in the app, one at a time; keys stay out of the screen; a copy box', async () => {
    const page = await open('UOM');
    await page.evaluate(() => {
      window.__screenKeys = 0;
      document.addEventListener('keydown', () => { window.__screenKeys++; });
      alert('Unable to save: the code is required.');
      alert('Saved.');
    });
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.equal(await page.textContent('#app-dialog-title'), 'Attention');
    assert.equal(await page.textContent('#app-dialog-message'), 'Unable to save: the code is required.');
    assert.ok(await page.isHidden('#app-dialog-cancel'), 'an alert has OK only');
    assert.equal(await page.evaluate(() => window.__appDialogLog.length), 1, 'the second waits its turn');
    await page.keyboard.press('a');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => window.__screenKeys), 0, 'the screen underneath sees no keys');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'app-dialog-ok', 'Tab stays in the dialog');
    await page.click('#app-dialog-ok');
    assert.equal(await page.textContent('#app-dialog-message'), 'Saved.');
    assert.equal(await page.textContent('#app-dialog-title'), 'Notice');
    await page.click('#app-dialog-ok');
    assert.equal(await shown(page), false);

    // The copy fallback: a multi-line text shows in a box, selected.
    await page.evaluate(() => { window.__copied = appPrompt('Copy this text:', 'a\tb\n1\t2'); });
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.ok(await page.isVisible('#app-dialog-textarea'));
    assert.ok(await page.isHidden('#app-dialog-input'));
    assert.equal(await page.inputValue('#app-dialog-textarea'), 'a\tb\n1\t2');
    assert.equal(await page.evaluate(() => { const t = document.activeElement; return t.id + ':' + (t.selectionEnd - t.selectionStart); }), 'app-dialog-textarea:7');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__copied), null);
    page.__answers.push(true, false);
    assert.deepEqual(await page.evaluate(async () => [await appConfirm('Go?'), await appConfirm('Go again?')]), [true, false]);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
