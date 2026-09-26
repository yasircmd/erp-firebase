#!/usr/bin/env node
// Writes screens/CUSTOMERSOA.html from VENDORSOA.html: the two
// Statement of Account screens are one template with a different CONFIG
// block (docs/modules/CUSTOMER_SOA.md). Edit VENDORSOA.html, then run:
//   node tools/build-soa-screens.js          (write)
//   node tools/build-soa-screens.js --check  (exit 1 if out of date)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../screens');
const vendor = fs.readFileSync(path.join(dir, 'VENDORSOA.html'), 'utf8');
const CUSTOMER_CONFIG = `  const CONFIG = {
    moduleId: 'CUSTOMERSOA', partyType: 'Customer', kicker: 'Accounts Receivable', heading: 'Customer Statement of Account',
    partyLabel: 'Customer', listFn: 'getActiveCustomers', idField: 'CustomerID', codeField: 'CustomerCode', nameField: 'CustomerName',
    invoiceModule: 'CUSTOMERINVOICE'
  };`;
const re = /(\/\/ CONFIG-START\n)[\s\S]*?(\n\s*\/\/ CONFIG-END)/;
if (!re.test(vendor)) throw new Error('VENDORSOA.html has no CONFIG-START/CONFIG-END block.');
const customer = vendor
  .replace(re, (m, a, b) => a + CUSTOMER_CONFIG + b)
  .replace('>Accounts Payable<', '>Accounts Receivable<')
  .replace('>Vendor Statement of Account<', '>Customer Statement of Account<')
  .replace('mb-1">Vendor</label>', 'mb-1">Customer</label>');

const out = path.join(dir, 'CUSTOMERSOA.html');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== customer) { console.error('CUSTOMERSOA.html is out of date — run node tools/build-soa-screens.js'); process.exit(1); }
  console.log('CUSTOMERSOA.html is up to date');
} else {
  fs.writeFileSync(out, customer);
  console.log('wrote ' + path.relative(process.cwd(), out));
}
