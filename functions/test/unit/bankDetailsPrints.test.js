// The company's bank details on its invoice prints, and a bank account's on
// Cash & Bank and PDC (owner, 2026-11-06; docs/modules/UX_ROUND3.md item 8):
// each screen asks the shell's BANK DETAILS block (public/index.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const screen = m => fs.readFileSync(path.join(__dirname, '../../../screens', m + '.html'), 'utf8');

test('the invoice prints add the company\'s bank details; Cash & Bank and PDC show and print the account\'s', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
  assert.match(shell, /---------- BANK DETAILS ----------[\s\S]*window\.bankDetails = [\s\S]*getBankDetailsForCompany[\s\S]*---------- END BANK DETAILS ----------/);
  for (const m of ['CUSTOMERINVOICE', 'SALESORDER', 'QUOTATION']) assert.match(screen(m), /bankDetails\.printBlock\(/, m + ' prints them');
  assert.match(screen('CBT'), /bankDetails\.entryLine\(co, code\)/);
  assert.match(screen('CBT'), /Bank: ' \+ escapeHtml\(cbtBankLine\)/);
  for (const m of ['PDCRECEIVED', 'PDCISSUED']) {
    assert.match(screen(m), /bankDetails\.hint\(/, m);
    assert.match(screen(m), /\(RECEIVED \? 'Deposited to' : 'Drawn on'\)/, m + ' prints them');
  }
  assert.match(screen('COA'), /saveBankDetails\(\{ accountId: bankAccountId, details \}\)/);
});
