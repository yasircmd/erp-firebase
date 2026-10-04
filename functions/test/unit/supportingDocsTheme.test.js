// Light mode for the supporting documents (owner, 2026-10-03: the section
// stayed dark in light mode). The shell's light theme recolours a fixed set
// of slate classes (public/index.html, [data-theme="light"] rules); a slate
// background, border, divider or text class outside that set stays dark.
// Checks the SUPPORTING DOCUMENTS block, Document Storage, Company Documents,
// HR Setup and Employees.
//   node --test functions/test/unit/supportingDocsTheme.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const shell = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
const block = shell.slice(shell.indexOf('// ---------- SUPPORTING DOCUMENTS ----------'), shell.indexOf('// ---------- END SUPPORTING DOCUMENTS ----------'));
const screen = fs.readFileSync(path.join(REPO, 'screens/DOCUMENTSTORAGE.html'), 'utf8');
const companyDocs = fs.readFileSync(path.join(REPO, 'screens/COMPANYDOCS.html'), 'utf8');
const hrScreens = ['HRSETUP', 'EMPLOYEES', 'EMPCHANGE', 'LEAVE', 'LEAVEREPORTS', 'PAYROLL', 'PAYROLLSETUP'].map(n => ['the ' + n + ' screen', fs.readFileSync(path.join(REPO, 'screens/' + n + '.html'), 'utf8')]);

// Every class the light theme recolours, e.g. "bg-slate-800/60", "hover:bg-slate-700".
const mapped = new Set();
for (const m of shell.matchAll(/\[data-theme="light"\]([^{]*)\{/g)) {
  for (const c of m[1].matchAll(/\.((?:hover\\?:)?(?:bg|text|border|divide)-slate-\d+(?:\\\/\d+)?)/g)) mapped.add(c[1].replace(/\\/g, ''));
}
const used = src => [...new Set((src.match(/(?<![\w-])(?:hover:)?(?:bg|text|border|divide)-slate-\d+(?:\/\d+)?(?![\w/-])/g) || []))];

test('the light theme recolours the classes it is checked against', () => {
  for (const c of ['bg-slate-800', 'bg-slate-800/60', 'divide-slate-700', 'text-slate-400', 'border-slate-700']) assert.ok(mapped.has(c), c);
});

for (const [name, src] of [['the Supporting documents section', block], ['the Document Storage screen', screen], ['the Company Documents screen', companyDocs]].concat(hrScreens)) {
  test(name + ' uses only slate classes that light mode recolours', () => {
    assert.ok(src.length > 1000, 'found it');
    assert.deepEqual(used(src).filter(c => !mapped.has(c)), []);
  });
}
