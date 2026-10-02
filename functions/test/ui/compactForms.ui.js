// Compact lists and Add / Edit forms on Item, Vendor and Customer Master
// (owner, 2026-10-02; docs/modules/COMPACT_FORMS.md): a list row is one
// line even on a narrow screen (800 px) (code, company and actions don't wrap); in the
// form, tight fields, gaps and
// sections, and each long help note on one line, full text on hover and
// when clicked. Measured against the same form with the compact style
// switched off. Seeds its own data (it WIPES the emulator database):
//   node functions/test/ui/compactForms.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

const SCREENS = [
  { mod: 'ITEMMASTER', p: 'im', add: '#im-add-btn', notes: 5, note: 'Debited when this item is issued to production' },
  { mod: 'VENDORMASTER', p: 'ven', add: '#ven-add-btn', notes: 1, note: 'The Liability account this vendor' },
  { mod: 'CUSTOMERMASTER', p: 'cus', add: '#cus-add-btn', notes: 1, note: 'The Asset account this customer' }
];

// Tailwind comes from its CDN, which a test machine may not reach. The
// "before" measure needs the real spacing, so when it is missing these are
// the same values as Tailwind's own, for the utilities these forms use.
const TAILWIND_STANDIN = `
  *, ::before, ::after { box-sizing: border-box; } h3, p { margin: 0; }
  .grid { display: grid; } .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
  @media (min-width: 768px) { .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .md\\:col-span-2 { grid-column: span 2 / span 2; } }
  .flex { display: flex; } .block { display: block; } .w-full { width: 100%; } .max-w-2xl { max-width: 42rem; }
  .gap-2 { gap: 0.5rem; } .gap-3 { gap: 0.75rem; } .gap-4 { gap: 1rem; }
  .p-4 { padding: 1rem; } .p-6 { padding: 1.5rem; } .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; } .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .pb-3 { padding-bottom: 0.75rem; } .pt-3 { padding-top: 0.75rem; } .mb-1 { margin-bottom: 0.25rem; } .mt-1 { margin-top: 0.25rem; }
  .space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; } .space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
  .space-y-5 > :not([hidden]) ~ :not([hidden]) { margin-top: 1.25rem; }
  .text-xs { font-size: 0.75rem; line-height: 1rem; } .text-sm { font-size: 0.875rem; line-height: 1.25rem; } .text-lg { font-size: 1.125rem; line-height: 1.75rem; }
  .border { border-width: 1px; border-style: solid; }`;

(async () => {
  // A long company name and an item code like the owner's (CONS-000001),
  // which wrapped onto two lines.
  const f = baseFixture();
  f.companies.C1.LegalName = 'NEXUS PRODUCTION LLC';
  f.items.I1.ItemCode = 'CONS-000001'; f.items.I1.ItemName = 'Eva Primer'; f.items.I1.Category = 'Consumable';
  Object.assign(f.vendors.V1, { Category: 'RawMaterialSupplier', Classification: 'Local', PaymentTermsDays: 30, ContactPerson: 'Rashid Khan', Phone: '+971 50 111 1111' });
  f.coa['A-AR'].Status = 'Active';
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Beta Trading', Category: 'Retailer', Classification: 'Local', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 45, ContactPerson: 'Sara Ahmed', Phone: '+971 50 000 0000' } };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8157);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());

  for (const s of SCREENS) {
    await page.goto('http://127.0.0.1:8157/?module=' + s.mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    if (await page.evaluate(() => getComputedStyle(document.querySelector('#module-container .grid')).display !== 'grid')) {
      await page.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.prepend(st); }, TAILWIND_STANDIN);
    }
    await page.waitForSelector(s.add + ':not(.hidden)', { timeout: 30000 });

    await check(s.mod + ': a list row is one line on a narrow screen (code, company, contact, actions)', async () => {
      await page.setViewportSize({ width: 800, height: 900 });
      await page.waitForSelector('#' + s.p + '-table-body tr td:nth-child(3)', { timeout: 20000 });
      const m = await page.evaluate(p => {
        // Lines of text (and icons) in a cell: their boxes, grouped by top,
        // apart from the few pixels a button's own box sits above its text.
        const lines = el => {
          const tops = [];
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (!n.data.trim()) continue;
            const r = document.createRange(); r.selectNodeContents(n);
            [...r.getClientRects()].forEach(x => tops.push(x.top));
          }
          el.querySelectorAll('i').forEach(i => tops.push(i.getBoundingClientRect().top));
          return tops.sort((a, b) => a - b).reduce((n, t, k, all) => n + (k === 0 || t - all[k - 1] > 8 ? 1 : 0), 0);
        };
        const tr = document.querySelector('#' + p + '-table-body tr');
        const cells = [...tr.cells];
        const heads = [...tr.closest('table').tHead.rows[0].cells];
        return {
          wrapped: cells.map((td, i) => i !== 1 && lines(td) > 1 ? heads[i].textContent : null).filter(Boolean),
          headsWrapped: heads.filter(th => lines(th) > 1).map(th => th.textContent),
          height: tr.getBoundingClientRect().height
        };
      }, s.p);
      assert.deepEqual(m.wrapped, [], 'cells on more than one line');
      assert.deepEqual(m.headsWrapped, [], 'headers on more than one line');
      assert.ok(m.height < 36, 'row height ' + m.height);
      await page.setViewportSize({ width: 1400, height: 900 });
    });

    await page.click(s.add);
    await page.waitForSelector('#' + s.p + '-modal:not(.hidden)');

    await check(s.mod + ': fields, labels and gaps are compact', async () => {
      const m = await page.evaluate(p => {
        const f = document.getElementById(p + '-form');
        const cs = el => getComputedStyle(el);
        const input = f.querySelector('select, input[type="text"]');
        const label = f.querySelector('label.block');
        const second = f.children[2];
        return { pad: cs(input).paddingTop, padX: cs(input).paddingLeft, label: parseFloat(cs(label).marginBottom), gap: cs(f.querySelector('.gap-4')).rowGap, between: parseFloat(cs(second).marginTop) };
      }, s.p);
      assert.equal(m.pad, '4px', 'field padding');
      assert.equal(m.padX, '8px', 'field side padding');
      assert.ok(m.label < 2, 'label gap ' + m.label);
      assert.equal(m.gap, '6.4px', 'grid row gap');
      assert.ok(m.between <= 8, 'space between rows ' + m.between);
    });

    await check(s.mod + ': help notes are one line, the full text on hover and when clicked', async () => {
      const notes = await page.$$eval('#' + s.p + '-form p.form-note', ps => ps.map(p => ({ title: p.title, text: p.textContent, ws: getComputedStyle(p).whiteSpace })));
      assert.equal(notes.length, s.notes);
      notes.forEach(n => { assert.equal(n.title, n.text); assert.equal(n.ws, 'nowrap'); });
      const long = await page.$('#' + s.p + '-form p.form-note[title^="' + s.note + '"]');
      assert.ok(long, 'the long note is there');
      const h1 = (await long.boundingBox()).height;
      await long.click();
      const h2 = (await long.boundingBox()).height;
      assert.ok(h2 > h1 * 1.5, 'clicked note opens: ' + h1 + ' → ' + h2);
      await page.click('#' + s.p + '-modal h3');
      assert.equal((await long.boundingBox()).height, h1, 'and closes again');
    });

    await check(s.mod + ': the form is clearly shorter than without the compact style', async () => {
      const h = await page.evaluate(p => {
        const f = document.getElementById(p + '-form');
        const st = [...document.querySelectorAll('#module-container style')].find(x => x.textContent.includes('COMPACT FORM'));
        const compact = f.scrollHeight;
        st.disabled = true; const before = f.scrollHeight; st.disabled = false;
        return { compact, before };
      }, s.p);
      assert.ok(h.compact <= h.before * 0.8, 'compact ' + h.compact + 'px vs ' + h.before + 'px');
    });
    await page.click('#' + s.p + '-modal-cancel');
  }

  await check('no page errors', async () => assert.deepEqual(page.__errors, []));
  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
