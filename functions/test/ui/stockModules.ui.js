// Drives the four real module screens (functions/modules/*.html) in
// headless Chromium against the emulators, through the shell's REAL rpc
// bridge (see buildHarness.js). Run the API emulator test first — it
// seeds the fixture this relies on:
//   node --test functions/test/emulator/*.test.js
//   (cd functions && npm i --no-save playwright && npx playwright install chromium)
//   node functions/test/ui/stockModules.ui.js
// Wipes nothing, but writes to whatever the emulator env vars point at —
// hard-coded to local emulators below.
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: 'erp1-8f4cd', databaseURL: 'https://erp1-8f4cd-default-rtdb.firebaseio.com' }, 'ui');
const rtdb = app.database();

const today = new Date().toISOString().substring(0, 10);
function tokenFor(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/erp1-8f4cd', aud: 'erp1-8f4cd', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600 }) + '.';
}
async function call(uid, fn, data) {
  const r = await fetch('http://127.0.0.1:5001/erp1-8f4cd/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(uid) }, body: JSON.stringify({ data: data ?? null }) });
  const b = await r.json(); if (b.error) throw new Error(fn + ': ' + b.error.message); return b.result;
}
const qty = async (wh) => ((await rtdb.ref('stock/ledger/I1/' + wh).get()).val() || { Quantity: 0 }).Quantity;

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  // Fresh stock: GRN 20 @ 4, plus one posted MI and one posted WM to open in their screens.
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'UI seed receipt', CompanyID: 'C1', VendorID: 'V1', Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 20, UnitCost: 4, Description: 'seed' }] });
  await call('u-admin', 'postGrn', { grnId: g.grnId });
  const m = await call('u-admin', 'saveMaterialIssueDraft', { TransactionDate: today, Description: 'UI seed issue', CompanyID: 'C1', EntryType: 'Issue', Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, Description: 'seed', CostCenterID: 'CC1' }] });
  await call('u-admin', 'postMaterialIssue', { miId: m.miId });
  const w = await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: today, Description: 'UI seed move', CompanyID: 'C1', Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 3, Description: 'seed' }] });
  await call('u-admin', 'postWarehouseMovement', { moveId: w.moveId });
  // WH1 = 20 - 1 - 3 = 16, WH2 = 3

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8123);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__lastDialog = d.message(); d.accept(); });
    await page.goto('http://127.0.0.1:8123/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  const rpcCalls = page => page.evaluate(() => window.__rpcLog.map(c => c.name));

  const PFX = { STOCKADJUSTMENT: 'adj', MATERIALISSUE: 'mi', GRN: 'grn', WAREHOUSEMOVEMENT: 'wm' };

  // 1. Every screen loads cleanly: all its init calls succeed, lists render, New button shown.
  for (const [mod, p] of Object.entries(PFX)) {
    await check(mod + ': loads with every init call succeeding', async () => {
      const page = await open(mod, 'u-admin');
      assert.deepEqual(await rpcFailures(page), []);
      assert.deepEqual(page.__errors, []);
      const calls = await rpcCalls(page);
      for (const fn of ['getActiveItems', 'getActiveUOMs', 'getActiveCompanies', 'getActiveOrgUnits', 'getModulePermissionsForUser']) assert.ok(calls.includes(fn), 'called ' + fn);
      assert.ok(await page.isVisible('#' + p + '-new-btn'), 'New button visible for a drafter');
      if (mod !== 'STOCKADJUSTMENT') assert.ok((await page.locator('#' + p + '-table-body tr').count()) >= 1, 'list shows the seeded entry');
      await page.close();
    });
  }

  await check('Viewer: screens load, but no New button', async () => {
    const page = await open('GRN', 'u-viewer');
    assert.deepEqual(await rpcFailures(page), []);
    assert.equal(await page.isVisible('#grn-new-btn'), false);
    await page.close();
  });

  // 2. Stock Adjustment: create, fill a line, Post through the real UI.
  await check('STOCKADJUSTMENT: new → fill → Post via the screen', async () => {
    const start = await qty('WH1');
    const page = await open('STOCKADJUSTMENT', 'u-admin');
    await page.click('#adj-new-btn');
    await page.selectOption('#adj-form-company', 'C1');
    await page.fill('#adj-form-description', 'UI damaged stock');
    await page.fill('input[data-field="item"][data-row="0"]', 'RM-001');
    await page.waitForTimeout(300);
    await page.selectOption('select[data-field="direction"][data-row="0"]', 'Decrease');
    await page.selectOption('select[data-field="warehouse"][data-row="0"]', 'WH1');
    await page.fill('input[data-field="description"][data-row="0"]', 'Dented');
    await page.locator('input[data-field="description"][data-row="0"]').blur();
    await page.fill('input[data-field="quantity"][data-row="0"]', '2');
    await page.locator('input[data-field="quantity"][data-row="0"]').blur();
    await page.selectOption('select.adj-line-cc[data-row="0"]', 'CC1');
    await page.waitForFunction(() => /\d/.test((document.querySelector('.adj-available-cell') || {}).textContent || ''), null, { timeout: 15000 });
    const avail = await page.locator('.adj-available-cell').first().textContent();
    assert.match(avail, new RegExp('\\b' + start + '\\b'), 'available-stock hint shows ' + start + ' (getStockLedgerEntryPublic), got: ' + avail);
    await page.click('#adj-post-btn');
    await page.click('#adj-confirm-ok');
    await page.waitForSelector('#adj-list-view:not(.hidden)', { timeout: 20000 });
    assert.deepEqual(await rpcFailures(page), []);
    assert.equal(await qty('WH1'), start - 2);
    await page.close();
  });

  // 3. Posted entry: GL impact popup, description edit, reversal — per module.
  for (const [mod, p] of Object.entries(PFX)) {
    await check(mod + ': open posted entry → GL impact, edit description, reverse', async () => {
      const page = await open(mod, 'u-admin');
      await page.locator('#' + p + '-table-body .' + p + '-open').first().click();
      await page.waitForSelector('#' + p + '-entry-view:not(.hidden)');
      await page.waitForTimeout(700);
      if (mod !== 'WAREHOUSEMOVEMENT') {
        await page.click('#' + p + '-gl-impact-btn');
        await page.waitForFunction(pp => /1300/.test(document.getElementById(pp + '-gl-modal-body').textContent), p, { timeout: 15000 });
        await page.click('#' + p + '-gl-modal-close');

        await page.click('#' + p + '-desc-edit-btn');
        await page.fill('#' + p + '-form-description', mod + ' corrected via UI');
        await page.click('#' + p + '-desc-save-btn');
        await page.waitForFunction(() => window.__rpcLog.some(c => c.name === 'updatePostedDescription'), null, { timeout: 15000 });
        const log = await page.evaluate(() => window.__rpcLog.filter(c => c.name === 'updatePostedDescription'));
        assert.equal(log.length, 1); assert.equal(log[0].ok, true);
      }
      const before = [await qty('WH1'), await qty('WH2')];
      await page.click('#' + p + '-reverse-btn');
      await page.click('#' + p + '-confirm-ok');
      if (mod === 'GRN') {
        // This GRN's stock has since been issued/moved/adjusted, so the
        // reversal must be refused — and the screen must say why.
        await page.waitForFunction(() => window.__rpcLog.some(c => c.name === 'reverseGrn'), null, { timeout: 20000 });
        await page.waitForTimeout(500);
        assert.match(page.__lastDialog || '', /insufficient stock for RM-001/);
        assert.deepEqual([await qty('WH1'), await qty('WH2')], before, 'nothing moved');
        await page.close();
        return;
      }
      await page.waitForSelector('#' + p + '-list-view:not(.hidden)', { timeout: 20000 });
      assert.deepEqual(await rpcFailures(page), []);
      assert.match(page.__lastDialog || '', /Reversal posted as/);
      const after = [await qty('WH1'), await qty('WH2')];
      assert.notDeepEqual(after, before, 'stock changed on reversal');
      await page.close();
    });
  }

  // 4. Approval banner + approve through the screen.
  await check('STOCKADJUSTMENT: approver sees banner and approves via the screen', async () => {
    await rtdb.ref('approvalConfigurations/STOCKADJUSTMENT').set({ Enabled: true, ScopeType: 'Global' });
    await rtdb.ref('approvalLevels/STOCKADJUSTMENT/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
    const s = await call('u-admin', 'saveStockAdjustmentDraft', { TransactionDate: today, Description: 'Needs approval', CompanyID: 'C1', Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', AdjustmentDirection: 'Decrease', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, Description: 'x', CostCenterID: 'CC1' }] });
    assert.equal((await call('u-admin', 'postStockAdjustment', { adjId: s.adjId })).status, 'PendingApproval');
    const start = await qty('WH1');

    const page = await open('STOCKADJUSTMENT', 'u-approver');
    await page.fill('#adj-search-input', 'Needs approval');
    await page.locator('#adj-table-body .adj-open').first().click();
    await page.waitForSelector('#adj-my-approval-banner:not(.hidden)', { timeout: 15000 });
    await page.click('#adj-approve-btn');
    if (await page.isVisible('#adj-confirm-ok')) await page.click('#adj-confirm-ok');
    await page.waitForSelector('#adj-list-view:not(.hidden)', { timeout: 20000 });
    assert.deepEqual(await rpcFailures(page), []);
    assert.equal(await qty('WH1'), start - 1);
    await rtdb.ref('approvalConfigurations/STOCKADJUSTMENT').set(null);
    await page.close();
  });

  // 5. GRN PO picker: stock lines selectable, non-stock (category) lines greyed out.
  await check('GRN: PO picker — stock line fills item code, non-stock line is disabled', async () => {
    await rtdb.ref('purchaseOrders/PO-UITEST').set({
      PONumber: 'PO-UI-1', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1',
      Lines: [
        { LineID: 'POL-0', ItemCode: 'RM-001', Description: 'Steel sheets', Quantity: 10, UnitPrice: 6, WarehouseID: 'WH1' },
        { LineID: 'POL-1', ItemCode: '', CategoryID: 'RCAT-X', Description: 'Consulting', Quantity: 1, UnitPrice: 500, WarehouseID: '' }
      ]
    });
    const page = await open('GRN', 'u-admin');
    await page.click('#grn-new-btn');
    await page.selectOption('#grn-form-company', 'C1');
    await page.selectOption('#grn-form-vendor', 'V1');
    await page.waitForSelector('#grn-po-picker-section:not(.hidden) .grn-po-line-checkbox', { timeout: 15000 });
    assert.equal(await page.locator('.grn-po-line-checkbox').count(), 1, 'only the stock line is selectable');
    assert.equal(await page.locator('.grn-po-line-nonstock').count(), 1);
    assert.equal(await page.locator('.grn-po-line-nonstock').isDisabled(), true);
    assert.match(await page.locator('#grn-po-picker-list').textContent(), /non-stock line – not received via GRN/);
    await page.locator('.grn-po-line-checkbox').check();
    assert.equal(await page.inputValue('input[data-field="item"][data-row="0"]'), 'RM-001');
    assert.deepEqual(await rpcFailures(page), []);
    await rtdb.ref('purchaseOrders/PO-UITEST').set(null);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  for (const r of results) console.log(r.join('  '));
  console.log(results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' passed');
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
