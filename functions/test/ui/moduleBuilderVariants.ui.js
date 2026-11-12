// Module Builder, phase 4 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q481-Q488): a variant runs on its original's own screen. The Room Invoice
// (a variant of Customer Invoice): its title, a relabelled and a hidden field,
// its extra fields' panel, its own documents only in its list, a document's
// extra fields shown when opened and saved again from the screen, its title and
// extra fields on the print; the Customer Invoice screen lists both, the Room
// Invoice marked. The builder makes a variant.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/moduleBuilderVariants.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 400)]); }); }
const D = new Date().toISOString().slice(0, 10);

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Example Guest LLC', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Rooms', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.permissions.X_RINV = { access: ['Admin'], draft: ['Admin'], post: ['Admin'], taxcode: ['Admin'] };
  await reset(f);
  await call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: { id: 'X_RINV', label: 'Room Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'RINV' },
    labels: { customer: 'Guest' }, hidden: ['division'], defaults: { description: 'Room charges' }, fields: [{ key: 'room', label: 'Room', type: 'text', required: true }, { key: 'nights', label: 'Nights', type: 'number' }] } });
  await call('u-admin', 'publishModuleDefinition', { id: 'X_RINV' });
  const inv = d => Object.assign({ InvoiceDate: D, Description: 'Stay', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', SourceDeliveryNotes: [],
    DirectLines: [{ AccountCode: '4000', Amount: 300, Description: 'Two nights', SalesTypeID: 'ST1' }] }, d || {});
  const room = await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: inv(), __variant: 'X_RINV', __variantFields: { room: '101', nights: 2 } });
  const plain = await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: inv({ Description: 'Plain' }) });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  async function open(moduleId) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? '' : undefined); });
    await page.goto('http://127.0.0.1:8172/?module=' + moduleId + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }

  await check('the Room Invoice on the invoice screen: its title, labels, hidden field, extra fields, its documents only; saved from the screen; printed', async () => {
    const p = await open('X_RINV');
    await p.waitForFunction(() => /Room Invoice/.test(document.getElementById('app-title').textContent));
    await p.waitForSelector('#cinv-table-body tr[data-doc-id]');
    const ids = await p.$$eval('#cinv-table-body tr[data-doc-id]', r => r.map(x => x.dataset.docId));
    assert.deepEqual(ids, [room.invoiceId], 'only its own documents');
    await p.click('#cinv-table-body tr[data-doc-id="' + room.invoiceId + '"]');
    await p.waitForSelector('#variant-fields [data-vkey="room"]');
    assert.equal(await p.inputValue('#variant-fields [data-vkey="room"]'), '101');
    assert.match(await p.$eval('#cinv-form-customer', e => e.closest('div').querySelector('label').textContent), /Guest/);
    assert.ok(await p.$eval('#cinv-form-division', e => e.closest('div').classList.contains('hidden')), 'Division hidden');
    await p.fill('#variant-fields [data-vkey="room"]', '204');
    await p.click('#cinv-save-draft-btn');
    for (let i = 0; i < 60; i++) { const d = await rtdb.ref('customerInvoices/' + room.invoiceId + '/VariantFields/room').get().catch(() => null); if (d && d.val() === '204') break; await p.waitForTimeout(200); }
    const saved = (await call('u-admin', 'getCustomerInvoiceEntries', { limit: 'all', __variant: 'X_RINV' })).entries.find(e => e.CustomerInvoiceID === room.invoiceId);
    assert.deepEqual([saved.Variant, saved.VariantFields.room], ['X_RINV', '204'], JSON.stringify(p.__dialogs));
    // The print: its title and its extra fields under the heading.
    await p.evaluate(() => { const d = document.getElementById('cinv-print-document'); d.innerHTML = '<h2>TAX INVOICE</h2><p>body</p>'; window.dispatchEvent(new Event('beforeprint')); });
    const printed = await p.textContent('#cinv-print-document');
    assert.match(printed, /TAX INVOICE\s*Room Invoice\s*Room\s*204\s*Nights\s*2/i);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the Customer Invoice screen lists both, the Room Invoice marked; no variant panel there', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.waitForSelector('#cinv-table-body tr[data-doc-id="' + plain.invoiceId + '"]');
    assert.match(await p.textContent('#cinv-table-body tr[data-doc-id="' + room.invoiceId + '"]'), /Room Invoice/);
    assert.doesNotMatch(await p.textContent('#cinv-table-body tr[data-doc-id="' + plain.invoiceId + '"]'), /Room Invoice/);
    await p.click('#cinv-table-body tr[data-doc-id="' + plain.invoiceId + '"]');
    await p.waitForTimeout(500);
    assert.equal(await p.$('#variant-fields'), null);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the builder makes a variant: its original, a label, a hidden field, an extra field', async () => {
    const p = await open('BUILDER');
    await p.click('#bd-new');
    await p.fill('#bd-id', 'x_util');
    await p.fill('#bd-label', 'Utility Bill');
    await p.selectOption('#bd-kind', 'variant');
    await p.waitForSelector('#bd-var:not(.hidden)');
    await p.selectOption('#bd-var-base', 'VENDORINVOICE');
    await p.waitForSelector('#bd-var-fields tr[data-vk="vendor"]');
    await p.fill('#bd-prefix', 'UTIL');
    await p.fill('#bd-var-fields tr[data-vk="vendor"] .bd-vlabel', 'Utility company');
    await p.check('#bd-var-fields tr[data-vk="project"] .bd-vhide');
    assert.ok(await p.isDisabled('#bd-var-fields tr[data-vk="vendor"] .bd-vhide'), 'a required field can\'t be hidden');
    await p.click('#bd-add-field');
    await p.fill('#bd-fields tr[data-i="0"] .bd-key', 'meter');
    await p.fill('#bd-fields tr[data-i="0"] .bd-flabel', 'Meter');
    await p.click('#bd-save');
    await p.waitForFunction(() => /Not published yet/.test(document.getElementById('bd-version').textContent));
    const d = (await call('u-admin', 'getModuleDefinition', { id: 'X_UTIL' })).draft;
    assert.deepEqual([d.kind, d.base, d.numbering.prefix, d.labels, d.hidden, d.fields.map(x => x.key)], ['variant', 'VENDORINVOICE', 'UTIL', { vendor: 'Utility company' }, ['project'], ['meter']]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : results.length + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
