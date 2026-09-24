// Clicks a real dynamic deactivate/reactivate button (google.script.run
// ...[call](token, id) in the original, now [call]({ __positional: [id] }))
// on screens that use that pattern, and checks the server call succeeded
// and the record's status flipped.
//   node functions/test/ui/dynamicToggle.ui.js     (after an emulator suite seeded data)
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: 'erp1-8f4cd', databaseURL: 'https://erp1-8f4cd-default-rtdb.firebaseio.com' }, 'toggle');
const CASES = [
  { module: 'UOM', button: '.uom-toggle', fn: /^(de|re)activateUOM$/ },
  // BOM confirms through its own modal rather than window.confirm.
  { module: 'BOM', button: '.bom-toggle', confirm: '#bom-confirm-ok', fn: /^(de|re)activateBom$/,
    // Seeded here so this case doesn't depend on which emulator suite ran last.
    seed: { 'boms/BOM-UITEST': { ParentItemID: 'FG-UI', ParentItemCode: 'FG-UI', ParentItemName: 'UI test parent', BOMVersion: '1.0',
      Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', ComponentItemCode: 'RM-001', Quantity: 1 }] } } }
];
(async () => {
  require('./buildHarness');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8126);
  const browser = await chromium.launch(); let ok = 0;
  for (const c of CASES) {
    if (c.seed) await app.database().ref().update(c.seed);
    const page = await browser.newPage();
    page.on('dialog', d => d.accept());
    await page.goto('http://127.0.0.1:8126/?module=' + c.module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.locator(c.button).first().click();
    if (c.confirm) await page.locator(c.confirm).click();
    await page.waitForFunction(re => window.__rpcLog.some(x => new RegExp(re).test(x.name)), c.fn.source, { timeout: 20000 });
    const call = await page.evaluate(re => window.__rpcLog.find(x => new RegExp(re).test(x.name)), c.fn.source);
    const good = call.ok && call.arg && Array.isArray(call.arg.__positional);
    console.log((good ? 'PASS' : 'FAIL') + '  ' + c.module + '  ' + JSON.stringify(call));
    if (good) ok++;
    await page.close();
  }
  await browser.close(); server.close(); await app.delete();
  console.log(ok + '/' + CASES.length + ' passed'); process.exitCode = ok === CASES.length ? 0 : 1;
})();
