// Documents sent outside the organization print without the ERP's title bar
// (the module name, back button and menu at the top); internal prints keep
// it (owner, 2026-10-11). The PDC screens share one template: only the
// received cheque's receipt is external, so it hides the bar through a body
// class set while printing it.
//   node --test functions/test/unit/externalPrints.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../../../screens');
const read = m => fs.readFileSync(path.join(dir, m + '.html'), 'utf8');
const printCss = html => (html.match(/@media print\s*\{[\s\S]*?\n\s*\}/g) || []).join('\n');
const HIDES = /(^|\n)\s*#app-container > div:first-child \{ display: none !important; \}/;

const EXTERNAL = ['CUSTOMERINVOICE', 'DELIVERYNOTE', 'PURCHASEORDER', 'PURCHASERETURN', 'SALESRETURN', 'RETAILSALES', 'CUSTOMERSOA', 'VENDORSOA'];

test('external documents hide the title bar when printed', () => {
  for (const m of EXTERNAL) assert.match(printCss(read(m)), HIDES, m);
});

test('the PDC receipt hides it only for a received cheque', () => {
  for (const m of ['PDCRECEIVED', 'PDCISSUED']) {
    const html = read(m);
    assert.doesNotMatch(printCss(html), HIDES, m + ': never unconditionally');
    assert.match(printCss(html), /body\.pdc-print-external #app-container > div:first-child \{ display: none !important; \}/, m);
    assert.match(html, /document\.body\.classList\.toggle\('pdc-print-external', RECEIVED\);/, m);
  }
});

test('internal prints keep it', () => {
  const printing = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5))
    .filter(m => /window\.print\(\)/.test(read(m)));
  const internal = printing.filter(m => !EXTERNAL.includes(m) && !/^PDC/.test(m));
  assert.ok(internal.includes('GRN') && internal.includes('PAYROLL') && internal.includes('JV'), 'the list is found');
  for (const m of internal) assert.doesNotMatch(read(m), /#app-container > div:first-child/, m);
});
