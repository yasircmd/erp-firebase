// Vendor and Customer Account Statements (docs/modules/VENDOR_SOA.md,
// CUSTOMER_SOA.md). One read-only report for both: every posted document
// for one party in one company, in date order with a running balance.
//
// Sources:
//   - the party's Vendor/Customer Invoices (RTDB), each invoice and each
//     invoice reversal as its own row
//   - every party-tagged line on a posted journal entry naming the party
//     (partyLedger.js): CBT payments/receipts, JVs, debit/credit notes,
//     and the reversals of any of these
// Invoice GL entries carry no party tag, so invoices come from their own
// records; nothing is counted twice.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { getUserAssignedCompanies } = require('./companies');
const { PARTY_TYPES } = require('./partyLedger');

const onCallOptions = { region: 'us-central1' };
const r2 = n => Math.round(n * 100) / 100;
const MODULE_FOR = { Vendor: 'VENDORSOA', Customer: 'CUSTOMERSOA' };
const DOC_TYPE = {
  JV: 'Journal Entry', PurchaseReturn: 'Debit Note', SalesReturn: 'Credit Note',
  'Cash Payment': 'Cash Payment', 'Bank Payment': 'Bank Payment', 'Cash Receipt': 'Cash Receipt', 'Bank Receipt': 'Bank Receipt'
};

async function requireStatementAccess(request, partyType) {
  const user = await requireUser(request);
  const moduleId = MODULE_FOR[partyType];
  if (!moduleId) throw new HttpsError('invalid-argument', 'Party type must be Vendor or Customer.');
  if (!(await moduleHasCapability(moduleId, 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to the ' + partyType + ' Account Statement.');
  }
  return user;
}

// Every vendor or customer in the user's companies, active or not — a
// statement for a closed account is still needed.
exports.getStatementParties = onCallWithMessages(onCallOptions, async (request) => {
  const partyType = String(request.data && request.data.partyType || '').trim();
  const user = await requireStatementAccess(request, partyType);
  const cfg = PARTY_TYPES[partyType];
  const data = (await rtdb.ref(cfg.path).get()).val() || {};
  return Object.keys(data)
    .filter(id => userCanAccessCompany(user.profile, data[id].CompanyID))
    .map(id => ({ PartyID: id, Code: data[id][cfg.codeField] || '', Name: data[id][cfg.nameField] || '', Status: data[id].Status || '', CompanyID: data[id].CompanyID || '' }))
    .sort((a, b) => a.Name.localeCompare(b.Name));
});

exports.getPartyStatement = onCallWithMessages(onCallOptions, async (request) => {
  const d = request.data || {};
  const partyType = String(d.partyType || '').trim();
  const user = await requireStatementAccess(request, partyType);
  const cfg = PARTY_TYPES[partyType];
  const partyId = String(d.partyId || '').trim();
  const companyId = String(d.companyId || '').trim();
  const fromDate = String(d.fromDate || '').trim();
  const toDate = String(d.toDate || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!getUserAssignedCompanies(user.profile).includes(companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const party = (await rtdb.ref(cfg.path + '/' + partyId).get()).val();
  if (!partyId || !party) throw new HttpsError('invalid-argument', 'Select a ' + partyType + '.');
  if (fromDate && toDate && fromDate > toDate) throw new HttpsError('invalid-argument', 'From date is after To date.');

  const rows = [];
  // Invoices: a bill credits a vendor, an invoice debits a customer; a
  // reversal entry goes the other way.
  const invoices = (await rtdb.ref(cfg.invoicePath).get()).val() || {};
  const invoiceSideDr = cfg.invoiceSide === 'Dr';
  Object.keys(invoices).forEach(id => {
    const inv = invoices[id];
    if (inv[cfg.invoicePartyField] !== partyId || inv.CompanyID !== companyId) return;
    if (inv.Status !== 'Posted' && inv.Status !== 'PendingReversalApproval') return;
    const amount = r2(Number(inv.Total) || 0);
    const dr = Boolean(inv.ReversalOfInvoiceID) !== invoiceSideDr;
    rows.push({
      Date: inv.InvoiceDate || '', Type: (inv.ReversalOfInvoiceID ? 'Invoice Reversal' : (partyType === 'Vendor' ? 'Vendor Invoice' : 'Customer Invoice')),
      Number: inv.TransactionNumber || '', Reference: inv.VendorRefNumber || '', Description: inv.Description || '',
      Debit: dr ? amount : 0, Credit: dr ? 0 : amount, SourceModule: partyType === 'Vendor' ? 'VENDORINVOICE' : 'CUSTOMERINVOICE', SourceID: id,
      _sort: inv.PostedAt || inv.CreatedAt || ''
    });
  });

  // Party-tagged journal lines.
  const key = partyType + ':' + partyId;
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('PartyKeys', 'array-contains', key).get();
  snap.docs.forEach(doc => {
    const e = doc.data();
    if (e.Status !== 'Posted' || e.CompanyID !== companyId) return;
    (e.Lines || []).forEach(l => {
      if (l.PartyType !== partyType || l.PartyID !== partyId) return;
      const base = DOC_TYPE[e.VoucherType] || e.VoucherType || 'Journal Entry';
      rows.push({
        Date: e.JVDate || '', Type: e.ReversalOfJV ? 'Reversal — ' + base : base,
        Number: e.JVNumber || '', Reference: e.Reference || '', Description: l.Description || e.Description || '',
        Debit: r2(Number(l.Debit) || 0), Credit: r2(Number(l.Credit) || 0),
        SourceModule: e.VoucherType === 'JV' ? 'JV' : (DOC_TYPE[e.VoucherType] && e.VoucherType.indexOf(' ') > 0 ? 'CBT' : ''), SourceID: doc.id,
        _sort: e.PostedAt || e.CreatedAt || ''
      });
    });
  });

  rows.sort((a, b) => (a.Date + a._sort + a.Number).localeCompare(b.Date + b._sort + b.Number));
  // Payable for a vendor (credit balance), receivable for a customer.
  const sign = partyType === 'Vendor' ? (r => r.Credit - r.Debit) : (r => r.Debit - r.Credit);
  let opening = 0;
  const shown = [];
  let totalDebit = 0, totalCredit = 0;
  rows.forEach(r => {
    if (fromDate && r.Date < fromDate) { opening = r2(opening + sign(r)); return; }
    if (toDate && r.Date > toDate) return;
    shown.push(r);
  });
  let balance = opening;
  shown.forEach(r => {
    balance = r2(balance + sign(r));
    totalDebit = r2(totalDebit + r.Debit);
    totalCredit = r2(totalCredit + r.Credit);
    r.Balance = balance;
    delete r._sort;
  });

  return {
    PartyType: partyType, PartyID: partyId, PartyCode: party[cfg.codeField] || '', PartyName: party[cfg.nameField] || '',
    CompanyID: companyId, FromDate: fromDate, ToDate: toDate,
    Opening: opening, Rows: shown, TotalDebit: totalDebit, TotalCredit: totalCredit, Closing: balance
  };
});
