// Bank account details (owner, 2026-11-06; docs/modules/UX_ROUND3.md item 8,
// Q413): a bank account in the Chart of Accounts keeps its bank's details,
// printed on the company's invoices (Customer Invoice, Proforma, Quotation)
// when "Print on invoices" is ticked, and shown in Cash & Bank and PDC (on
// screen and on their prints) when "Show in Cash & Bank / PDC" is ticked.
// New development, hand-written; the ported account save is untouched.
//
//   Firestore bankDetails/{AccountID} { BankName, Branch, AccountHolder,
//     AccountNumber, IBAN, SWIFT, Currency, Notes, PrintOnInvoices,
//     ShowInEntries, UpdatedAt, UpdatedBy }
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const coaScheme = require('./coaScheme');

const onCallOptions = { region: 'us-central1' };
const DETAILS = () => firestore.collection('bankDetails');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const FIELDS = { BankName: 120, Branch: 120, AccountHolder: 160, AccountNumber: 60, IBAN: 40, SWIFT: 20, Currency: 3, Notes: 300 };

async function bankAccount(accountId) {
  const a = (await rtdb.ref('coa/' + text(accountId, 80)).get()).val();
  if (!a || a.IsPostable !== true || !coaScheme.isBank(a)) throw new HttpsError('invalid-argument', 'Choose a bank account (a postable account under a Bank heading).');
  return a;
}
const clean = (id, d) => Object.assign({ AccountID: id }, d || {});

// The details of one bank account, for its form in the Chart of Accounts.
exports.getBankDetails = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('COA', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to the Chart of Accounts.');
  const id = text(request.data && request.data.accountId, 80);
  await bankAccount(id);
  const s = await DETAILS().doc(id).get();
  return clean(id, s.exists ? s.data() : { PrintOnInvoices: false, ShowInEntries: true });
});

exports.saveBankDetails = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('COA', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change the Chart of Accounts.');
  const d = (request.data && request.data.details) || {};
  const id = text(request.data && request.data.accountId, 80);
  const account = await bankAccount(id);
  if (account.CompanyID && !userCanAccessCompany(user.profile, account.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const out = {};
  Object.entries(FIELDS).forEach(([k, max]) => { out[k] = text(d[k], max); });
  out.IBAN = out.IBAN.replace(/\s+/g, '').toUpperCase();
  out.SWIFT = out.SWIFT.replace(/\s+/g, '').toUpperCase();
  out.Currency = out.Currency.toUpperCase();
  if (out.IBAN && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(out.IBAN)) throw new HttpsError('invalid-argument', 'The IBAN is not valid (two letters, two digits, then the account).');
  if (out.SWIFT && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(out.SWIFT)) throw new HttpsError('invalid-argument', 'The SWIFT / BIC is 8 or 11 letters and digits.');
  out.PrintOnInvoices = d.PrintOnInvoices === true;
  out.ShowInEntries = d.ShowInEntries === true;
  if ((out.PrintOnInvoices || out.ShowInEntries) && !out.BankName && !out.AccountNumber && !out.IBAN) throw new HttpsError('invalid-argument', 'Give at least the bank\'s name, the account number or the IBAN to print or show.');
  await DETAILS().doc(id).set(Object.assign(out, { UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }));
  return { success: true };
});

// For a company's screens (any signed-in user of the company, as the other
// reference reads): the bank accounts its invoices print, and the details
// shown in Cash & Bank / PDC by account. A shared account counts for every company.
exports.getBankDetailsForCompany = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const companyId = text(request.data && request.data.companyId, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const [printing, showing, coa] = await Promise.all([
    DETAILS().where('PrintOnInvoices', '==', true).get(),
    DETAILS().where('ShowInEntries', '==', true).get(),
    rtdb.ref('coa').get().then(s => s.val() || {})
  ]);
  const mine = s => s.docs.filter(d => { const a = coa[d.id]; return a && a.Status !== 'Inactive' && (!a.CompanyID || a.CompanyID === companyId); })
    .map(d => Object.assign(clean(d.id, d.data()), { AccountCode: coa[d.id].AccountCode || '', AccountName: coa[d.id].AccountName || '' }));
  const pick = r => ({ AccountID: r.AccountID, AccountCode: r.AccountCode, AccountName: r.AccountName, BankName: r.BankName || '', Branch: r.Branch || '', AccountHolder: r.AccountHolder || '',
    AccountNumber: r.AccountNumber || '', IBAN: r.IBAN || '', SWIFT: r.SWIFT || '', Currency: r.Currency || '' });
  return {
    print: mine(printing).map(pick).sort((a, b) => a.AccountCode.localeCompare(b.AccountCode)),
    entries: Object.fromEntries(mine(showing).map(r => [r.AccountID, pick(r)]))
  };
});
