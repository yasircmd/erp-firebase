// Drives the four real module screens (screens/*.html) in
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
const { onAppDialog } = require('./_appDialogs');
const admin = require('firebase-admin');
// The moved transaction documents are in Firestore (src/movedPaths.js),
// read here by their RTDB paths. Loaded before this file's own app:
// firebaseAdmin.js makes the default app only when none exists yet.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
const movedPaths = require('../../src/movedPaths');
const app = admin.initializeApp({ projectId: 'erp1-8f4cd', databaseURL: 'https://erp1-8f4cd-default-rtdb.firebaseio.com' }, 'ui');
const rtdb = app.database();
const val = async p => (movedPaths.isMoved(p) ? movedPaths.request(p, 'get') : (await rtdb.ref(p).get()).val());

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
const qty = async (wh) => ((await val('stock/ledger/I1/' + wh)) || { Quantity: 0 }).Quantity;

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
    await onAppDialog(page, d => { page.__lastDialog = d.message(); d.accept(); });
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

  // 5. GRN PO picker: stock lines fill the stock grid; non-stock (category)
  // lines are selectable too since 2026-09-28 and fill the Non-stock grid,
  // category and price locked (docs/modules/GRN_NON_STOCK.md).
  await rtdb.ref('requisitionCategories/RCAT-X').set({ Name: 'Consulting', Type: 'DirectExpense', GLAccountID: 'A-CONS', Status: 'Active', CompanyID: 'C1' });
  await check('GRN: PO picker — stock line fills item code, non-stock line fills the non-stock grid', async () => {
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
    assert.equal(await page.locator('.grn-po-line-checkbox').count(), 2, 'both lines selectable');
    assert.match(await page.locator('#grn-po-picker-list').textContent(), /Non-stock\s+Consulting/);
    await page.locator('.grn-po-line-checkbox[data-key="PO-UITEST|POL-0"]').check();
    assert.equal(await page.inputValue('input[data-field="item"][data-row="0"]'), 'RM-001');
    await page.locator('.grn-po-line-checkbox[data-key="PO-UITEST|POL-1"]').check();
    const ns = page.locator('#grn-ns-body select[data-ns-field="CategoryID"]');
    assert.equal(await ns.count(), 1);
    assert.equal(await ns.inputValue(), 'RCAT-X');
    assert.equal(await ns.isDisabled(), true, 'category locked to the PO');
    assert.equal(await page.inputValue('#grn-ns-body input[data-ns-field="UnitCost"]'), '500');
    assert.equal(await page.isDisabled('#grn-ns-body input[data-ns-field="UnitCost"]'), true, 'price locked to the PO');
    assert.equal(await page.textContent('#grn-grand-total'), '560.00');
    await page.locator('.grn-po-line-checkbox[data-key="PO-UITEST|POL-1"]').uncheck();
    assert.equal(await ns.count(), 0, 'unticking removes it');
    assert.deepEqual(await rpcFailures(page), []);
    await rtdb.ref('purchaseOrders/PO-UITEST').set(null);
    await page.close();
  });

  // 6. A GRN waiting for approval or posted shows only the PO lines it took,
  // locked; a rejected one is editable again with every line (owner, 2026-09-28).
  await check('GRN: PO picker — pending/posted show only this GRN\'s lines, locked; rejected shows all', async () => {
    await rtdb.ref('purchaseOrders/PO-UITEST2').set({
      PONumber: 'PO-UI-2', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1',
      Lines: [
        { LineID: 'POL-A', ItemCode: 'RM-001', Description: 'Line A', Quantity: 10, UnitPrice: 6, WarehouseID: 'WH1' },
        { LineID: 'POL-B', ItemCode: 'RM-001', Description: 'Line B', Quantity: 5, UnitPrice: 6, WarehouseID: 'WH1' }
      ]
    });
    await rtdb.ref('approvalConfigurations/GRN').set({ Enabled: true, ScopeType: 'Global' });
    await rtdb.ref('approvalLevels/GRN/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
    const line = { ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 4, UnitCost: 6, Description: 'A', SourcePOID: 'PO-UITEST2', SourcePOLineID: 'POL-A' };
    const pending = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Picker pending', CompanyID: 'C1', VendorID: 'V1', Lines: [line] });
    assert.equal((await call('u-admin', 'postGrn', { grnId: pending.grnId })).status, 'PendingApproval');
    const rejected = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Picker rejected', CompanyID: 'C1', VendorID: 'V1', Lines: [line] });
    await call('u-admin', 'postGrn', { grnId: rejected.grnId });
    await call('u-approver', 'decideGrnApproval', { grnId: rejected.grnId, levelNumber: 1, decision: 'Rejected', reason: 'wrong qty' });
    await rtdb.ref('approvalConfigurations/GRN').set(null);
    const posted = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Picker posted', CompanyID: 'C1', VendorID: 'V1', Lines: [line] });
    assert.equal((await call('u-admin', 'postGrn', { grnId: posted.grnId })).status, 'Posted');

    const page = await open('GRN', 'u-admin');
    const openGrn = async description => {
      if (await page.isVisible('#grn-back-btn')) await page.click('#grn-back-btn');
      await page.waitForSelector('#grn-list-view:not(.hidden)', { timeout: 15000 });
      await page.fill('#grn-search-input', description);
      await page.locator('#grn-table-body .grn-open').first().click();
      await page.waitForSelector('#grn-entry-view:not(.hidden)', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      return page.evaluate(() => ({
        shown: !document.getElementById('grn-po-picker-section').classList.contains('hidden'),
        boxes: [...document.querySelectorAll('.grn-po-line-checkbox')].map(b => [b.dataset.key.split('|')[1], b.checked, b.disabled])
      }));
    };
    for (const d of ['Picker pending', 'Picker posted']) {
      assert.deepEqual(await openGrn(d), { shown: true, boxes: [['POL-A', true, true]] }, d);
    }
    assert.deepEqual(await openGrn('Picker rejected'), { shown: true, boxes: [['POL-A', true, false], ['POL-B', false, false]] });
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await rtdb.ref('purchaseOrders/PO-UITEST2').set(null);
    await page.close();
  });

  // 7. A direct non-stock line entered and posted from the screen, then
  // shown read-only.
  await check('GRN: direct non-stock line — add, post, then read-only', async () => {
    const page = await open('GRN', 'u-admin');
    await page.click('#grn-new-btn');
    await page.selectOption('#grn-form-company', 'C1');
    await page.selectOption('#grn-form-vendor', 'V1');
    await page.fill('#grn-form-description', 'UI non-stock receipt');
    await page.selectOption('#grn-form-costcenter', 'CC1');
    await page.click('#grn-add-nonstock-btn');
    await page.selectOption('#grn-ns-body select[data-ns-field="CategoryID"]', 'RCAT-X');
    await page.fill('#grn-ns-body input[data-ns-field="Quantity"]', '2');
    await page.fill('#grn-ns-body input[data-ns-field="UnitCost"]', '75');
    assert.equal(await page.textContent('#grn-ns-total'), '150.00');
    assert.equal(await page.inputValue('#grn-ns-body select[data-ns-field="CostCenterID"]'), 'CC1', 'header cost center fills the line');
    await page.click('#grn-post-btn');
    await page.click('#grn-confirm-ok');
    await page.waitForSelector('#grn-list-view:not(.hidden)', { timeout: 20000 });
    assert.deepEqual(await rpcFailures(page), []);
    const all = (await val('stock/transactions'));
    const grn = Object.values(all).find(t => t.Description === 'UI non-stock receipt');
    assert.equal(grn.Status, 'Posted');
    assert.deepEqual(grn.NonStockLines.map(l => [l.CategoryID, l.Quantity, l.UnitCost, l.AccountCode, l.CostCenterID]), [['RCAT-X', 2, 75, '5100', 'CC1']]);

    await page.fill('#grn-search-input', 'UI non-stock receipt');
    await page.locator('#grn-table-body .grn-open').first().click();
    await page.waitForSelector('#grn-entry-view:not(.hidden)', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    assert.equal(await page.isVisible('#grn-add-nonstock-btn'), false);
    assert.equal(await page.isDisabled('#grn-ns-body input[data-ns-field="Quantity"]'), true);
    assert.equal(await page.textContent('#grn-grand-total'), '150.00');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  for (const r of results) console.log(r.join('  '));
  console.log(results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' passed');
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
