#!/usr/bin/env node
// Writes screens/VENDORAGING.html from CUSTOMERAGING.html: the two aging
// screens are one template with a different CONFIG block
// (docs/modules/AGING_REPORTS.md). Edit CUSTOMERAGING.html, then run:
//   node tools/build-aging-screens.js          (write)
//   node tools/build-aging-screens.js --check  (exit 1 if out of date)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../screens');
const customer = fs.readFileSync(path.join(dir, 'CUSTOMERAGING.html'), 'utf8');
const VENDOR_CONFIG = `  const CONFIG = {
    moduleId: 'VENDORAGING', partyType: 'Vendor', kicker: 'Accounts Payable', heading: 'Vendor Aging',
    partyLabel: 'Vendor', soaModule: 'VENDORSOA'
  };`;
const re = /(\/\/ CONFIG-START\n)[\s\S]*?(\n\s*\/\/ CONFIG-END)/;
if (!re.test(customer)) throw new Error('CUSTOMERAGING.html has no CONFIG-START/CONFIG-END block.');
const vendor = customer.replace(re, (m, a, b) => a + VENDOR_CONFIG + b)
  .replace('<div id="ag-kicker" class="text-xs font-semibold text-blue-400 uppercase mb-1">Accounts Receivable</div>', '<div id="ag-kicker" class="text-xs font-semibold text-blue-400 uppercase mb-1">Accounts Payable</div>')
  .replace('<span id="ag-heading">Customer Aging</span>', '<span id="ag-heading">Vendor Aging</span>');

const out = path.join(dir, 'VENDORAGING.html');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== vendor) { console.error('VENDORAGING.html is out of date — run node tools/build-aging-screens.js'); process.exit(1); }
  console.log('VENDORAGING.html is up to date');
} else {
  fs.writeFileSync(out, vendor);
  console.log('wrote ' + path.relative(process.cwd(), out));
}
