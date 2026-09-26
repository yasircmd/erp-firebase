#!/usr/bin/env node
// Writes screens/PDCISSUED.html from PDCRECEIVED.html: the two PDC
// screens are one template with a different CONFIG block
// (docs/modules/PDC.md). Edit PDCRECEIVED.html, then run:
//   node tools/build-pdc-screens.js          (write)
//   node tools/build-pdc-screens.js --check  (exit 1 if out of date)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../screens');
const received = fs.readFileSync(path.join(dir, 'PDCRECEIVED.html'), 'utf8');
const ISSUED_CONFIG = `  const CONFIG = {
    moduleId: 'PDCISSUED', direction: 'Issued', kicker: 'Accounts Payable', heading: 'PDC Issued',
    partyType: 'Vendor', partyLabel: 'Vendor', dateLabel: 'Issue Date', invoiceModule: 'VENDORINVOICE',
    postNote: 'The vendor is debited and the PDC Issued Clearing Account credited until the cheque clears from the bank.'
  };`;
const re = /(\/\/ CONFIG-START\n)[\s\S]*?(\n\s*\/\/ CONFIG-END)/;
if (!re.test(received)) throw new Error('PDCRECEIVED.html has no CONFIG-START/CONFIG-END block.');
const issued = received.replace(re, (m, a, b) => a + ISSUED_CONFIG + b);

const out = path.join(dir, 'PDCISSUED.html');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== issued) { console.error('PDCISSUED.html is out of date — run node tools/build-pdc-screens.js'); process.exit(1); }
  console.log('PDCISSUED.html is up to date');
} else {
  fs.writeFileSync(out, issued);
  console.log('wrote ' + path.relative(process.cwd(), out));
}
