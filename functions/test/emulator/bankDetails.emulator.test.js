// Bank account details (owner, 2026-11-06; docs/modules/UX_ROUND3.md item 8,
// Q413): kept on a bank account in the Chart of Accounts; printed on the
// company's invoices when "Print on invoices" is ticked, shown in Cash & Bank
// and PDC when "Show in Cash & Bank / PDC" is; a company sees its own and the
// shared accounts', not another company's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.then(x => ({ ok: true, x }), e => ({ ok: false, error: e.message })); assert.equal(r.ok, false, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const ENBD = { BankName: 'Example Bank', Branch: 'Main Street', AccountHolder: 'Test Co One LLC', AccountNumber: '1012345678', IBAN: 'ae07 0331 2345 6789 0123 456', SWIFT: 'exmpaead', Currency: 'aed' };

test('saved on a bank account by the Chart of Accounts\' write right; checked; read back', async () => {
  const f = baseFixture();
  f.coa['A-BANK2'] = { AccountCode: '1110', AccountName: 'Bank Two', AccountType: 'Asset', CashBank: 'Bank', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  await reset(f);
  assert.deepEqual(await call('u-admin', 'getBankDetails', { accountId: 'A-BANK' }), { AccountID: 'A-BANK', PrintOnInvoices: false, ShowInEntries: true }, 'nothing yet: shown, not printed');
  assert.match(await err(call('u-admin', 'saveBankDetails', { accountId: 'A-CASH', details: ENBD })), /Choose a bank account/);
  assert.match(await err(call('u-admin', 'saveBankDetails', { accountId: 'A-BANK', details: Object.assign({}, ENBD, { IBAN: 'XX12' }) })), /IBAN is not valid/);
  assert.match(await err(call('u-admin', 'saveBankDetails', { accountId: 'A-BANK', details: Object.assign({}, ENBD, { SWIFT: 'AB' }) })), /SWIFT \/ BIC is 8 or 11/);
  assert.match(await err(call('u-admin', 'saveBankDetails', { accountId: 'A-BANK', details: { PrintOnInvoices: true } })), /at least the bank's name/);
  assert.match(await err(call('u-viewer', 'saveBankDetails', { accountId: 'A-BANK', details: ENBD })), /permission to change the Chart of Accounts/);
  ok(await call('u-admin', 'saveBankDetails', { accountId: 'A-BANK', details: Object.assign({ PrintOnInvoices: true, ShowInEntries: true }, ENBD) }));
  const d = await call('u-viewer', 'getBankDetails', { accountId: 'A-BANK' });
  assert.deepEqual([d.IBAN, d.SWIFT, d.Currency, d.PrintOnInvoices, d.UpdatedBy], ['AE070331234567890123456', 'EXMPAEAD', 'AED', true, 'admin'], 'tidied: no spaces, upper case');
});

test('for a company: the accounts it prints and the details it shows; its own and shared, not another company\'s', async () => {
  const f = baseFixture();
  f.coa['A-BANK2'] = { AccountCode: '1110', AccountName: 'Bank Two', AccountType: 'Asset', CashBank: 'Bank', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  f.coa['A-BANK3'] = { AccountCode: '1120', AccountName: 'Bank Three', AccountType: 'Asset', CashBank: 'Bank', Status: 'Active', IsPostable: true, CompanyID: 'C1' };
  f.users['u-admin'].AssignedCompanies = ['C1', 'C2'];
  await reset(f);
  ok(await call('u-admin', 'saveBankDetails', { accountId: 'A-BANK', details: Object.assign({ PrintOnInvoices: true, ShowInEntries: true }, ENBD) }));
  ok(await call('u-admin', 'saveBankDetails', { accountId: 'A-BANK2', details: { BankName: 'Second Bank', AccountNumber: '222', PrintOnInvoices: true, ShowInEntries: true } }));
  ok(await call('u-admin', 'saveBankDetails', { accountId: 'A-BANK3', details: { BankName: 'Third Bank', AccountNumber: '333', PrintOnInvoices: false, ShowInEntries: false } }));
  const c1 = await call('u-viewer', 'getBankDetailsForCompany', { companyId: 'C1' });
  assert.deepEqual(c1.print.map(x => [x.AccountCode, x.BankName, x.IBAN]), [['1100', 'Example Bank', 'AE070331234567890123456']], 'the shared bank; C2\'s not; Bank Three not set to print');
  assert.deepEqual(Object.keys(c1.entries), ['A-BANK'], 'Bank Three not set to show');
  const c2 = await call('u-admin', 'getBankDetailsForCompany', { companyId: 'C2' });
  assert.deepEqual(c2.print.map(x => x.AccountCode), ['1100', '1110']);
  assert.match(await err(call('u-viewer', 'getBankDetailsForCompany', { companyId: 'C2' })), /access to that company/);
});
