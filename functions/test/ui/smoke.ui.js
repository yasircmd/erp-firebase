// Loads every ported module screen (tools/legacy-port/modules.json plus
// the four hand-ported stock modules) in headless Chromium against the
// emulators, through the shell's real rpc bridge, as an Admin and as a
// Viewer. Fails on any failed server call during load, any uncaught
// page error, or a screen that never finishes initModule().
//   node functions/test/ui/smoke.ui.js [MODULE ...]
// Run an emulator suite first so the fixture data exists.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const listed = require('../../../tools/legacy-port/modules.json').modules;
const MODULES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['STOCKADJUSTMENT', 'MATERIALISSUE', 'GRN', 'WAREHOUSEMOVEMENT', 'PURCHASERETURN', 'SALESRETURN', ...listed];

// Failures that are the ORIGINAL behavior for that role (documented in
// docs/MIGRATION.md's quirks list), not port bugs: module+uid -> regex of allowed problems.
const EXPECTED = {
  'USERMGMT|u-viewer': /You do not have permission to manage users\./,
  // Data Reset hard-checks the literal role 'ADMIN' (requireAdminRole_).
  'DATARESET|u-admin': /Only Admin users can access Data Reset\./,
  'DATARESET|u-viewer': /Only Admin users can access Data Reset\./
};
// Data Reset is also loaded as a real 'ADMIN' user, seeded below.
const usersFor = (mod) => mod === 'DATARESET' ? ['u-admin', 'u-viewer', 'u-root'] : ['u-admin', 'u-viewer'];

async function seedDataResetAdmin() {
  const rtdb = (p, body) => fetch('http://127.0.0.1:9000/' + p + '.json?ns=erp1-8f4cd-default-rtdb', {
    method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(body)
  });
  await rtdb('users/u-root', { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] });
  await rtdb('permissions/DATARESET', { access: ['ADMIN', 'Admin', 'Viewer'], write: ['ADMIN'] });
}

(async () => {
  if (MODULES.includes('DATARESET')) await seedDataResetAdmin();
  require('./buildHarness');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8125);
  const browser = await chromium.launch();
  const results = [];
  for (const mod of MODULES) {
    for (const uid of usersFor(mod)) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
      try {
        await page.goto('http://127.0.0.1:8125/?module=' + mod + '&uid=' + uid);
        await page.waitForFunction(() => window.__moduleReady === true || /^LOAD FAILED/.test(document.getElementById('module-container').textContent), null, { timeout: 30000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
        const failed = await page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
        const loadFailed = await page.evaluate(() => /^LOAD FAILED/.test(document.getElementById('module-container').textContent) ? document.getElementById('module-container').textContent.slice(0, 200) : '');
        const calls = await page.evaluate(() => window.__rpcLog.length);
        const allowed = EXPECTED[mod + '|' + uid];
        const problems = [...failed, ...errors, ...(loadFailed ? [loadFailed] : [])].filter(p => !(allowed && allowed.test(p)));
        results.push([problems.length ? 'FAIL' : 'PASS', mod, uid, calls + ' calls', problems.join(' | ')]);
      } catch (e) {
        results.push(['FAIL', mod, uid, '', e.message.split('\n')[0]]);
      }
      await page.close();
    }
  }
  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
