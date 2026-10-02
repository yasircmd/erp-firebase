// Vendor and Customer Statements of Account (roadmap #3/#4,
// docs/modules/VENDOR_SOA.md, CUSTOMER_SOA.md). One engine for both.
//
// Rows come from two places, because invoice GL lines aren't party-tagged:
//   - the party's Vendor/Customer Invoices (RTDB), each at its Total, and
//     any invoice reversal entry on the opposite side;
//   - every line tagged with the party on a posted GL entry (Firestore
//     journalEntries, PartyKeys): JV, CBT, debit and credit notes, and
//     their reversals, at the amount and side posted.
// Balances are in the party's natural sense: for a vendor what we owe
// (credit − debit), for a customer what they owe us (debit − credit).
// Open items and aging are partyLedger's open items as at the end date.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { PARTY_TYPES, addDays, queryEntries, getOpenItemsForParty } = require('./partyLedger');
const { pendingPdcsForParty } = require('./pdc');

const onCallOptions = { region: 'us-central1' };
const MODULES = { Vendor: 'VENDORSOA', Customer: 'CUSTOMERSOA' };
// Which side increases the balance, in the party's natural sense.
const GROWS = { Vendor: 'Cr', Customer: 'Dr' };
const DOC_TYPES = {
  JV: 'Journal', PurchaseReturn: 'Debit Note', SalesReturn: 'Credit Note', PDCReceived: 'PDC Received', PDCIssued: 'PDC Issued', FARetirement: 'Asset Sale', RecurringJV: 'Recurring Journal', OpeningBalance: 'Opening Balance',
  'Cash Receipt': 'Cash Receipt', 'Bank Receipt': 'Bank Receipt', 'Cash Payment': 'Cash Payment', 'Bank Payment': 'Bank Payment'
};
const AGING = [
  { key: 'notDue', label: 'Not yet due', max: 0 },
  { key: 'd1_30', label: '1–30 days', max: 30 },
  { key: 'd31_60', label: '31–60 days', max: 60 },
  { key: 'd61_90', label: '61–90 days', max: 90 },
  { key: 'd90plus', label: '90+ days', max: Infinity }
];

const round2 = n => Math.round(n * 100) / 100;
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

// Every movement of the party in this company, oldest first.
async function partyMovements(partyType, partyId, companyId) {
  const cfg = PARTY_TYPES[partyType];
  const grows = GROWS[partyType];
  const other = grows === 'Dr' ? 'Cr' : 'Dr';
  const rows = [];

  const invoices = (await rtdb.ref(cfg.invoicePath).get()).val() || {};
  Object.keys(invoices).forEach(id => {
    const inv = invoices[id];
    if (inv[cfg.invoicePartyField] !== partyId || inv.CompanyID !== companyId) return;
    if (inv.Status !== 'Posted' && inv.Status !== 'PendingReversalApproval') return;
    const isReversal = Boolean(inv.ReversalOfInvoiceID);
    rows.push({
      Date: inv.InvoiceDate || '', Order: inv.PostedAt || inv.CreatedAt || '', Number: inv.TransactionNumber || '',
      Type: isReversal ? 'Invoice Reversal' : 'Invoice', Reference: inv.VendorRefNumber || '', Description: inv.Description || '',
      Side: isReversal ? other : grows, Amount: round2(Number(inv.Total) || 0),
      Reversed: Boolean(inv.ReversedByInvoiceID), IsReversal: isReversal, SourceID: id, LinkedJVID: inv.LinkedJVID || ''
    });
  });

  const entries = await queryEntries('PartyKeys', 'array-contains', partyType + ':' + partyId);
  entries.filter(e => e.Status === 'Posted' && e.CompanyID === companyId).forEach(e => {
    (e.Lines || []).forEach(l => {
      if (l.PartyType !== partyType || l.PartyID !== partyId) return;
      const debit = Number(l.Debit) || 0;
      rows.push({
        Date: e.JVDate || '', Order: e.PostedAt || e.CreatedAt || '', Number: e.JVNumber || '',
        // A PDC's bounce or cancellation reverses its post entry.
        Type: (DOC_TYPES[e.VoucherType] || e.VoucherType || 'Journal') + (e.ReversalOfJV ? (e.PdcEvent ? ' ' + e.PdcEvent : ' Reversal') : ''),
        Reference: e.Reference || '', Description: l.Description || e.Description || '',
        Side: debit > 0 ? 'Dr' : 'Cr', Amount: round2(debit > 0 ? debit : Number(l.Credit) || 0),
        Reversed: Boolean(e.ReversedByJV), IsReversal: Boolean(e.ReversalOfJV), SourceID: e._id, LinkedJVID: e._id,
        VoucherType: e.VoucherType || ''
      });
    });
  });

  return rows.sort((a, b) => (a.Date + '|' + a.Order + '|' + a.Number).localeCompare(b.Date + '|' + b.Order + '|' + b.Number));
}

// GL balance of the party's own control account in this company up to
// the end date, in the party's natural sense — unless another party usable
// in this company shares the account (then it can't be split by party).
async function controlAccountBalance(partyType, partyId, party, companyId, toDate) {
  const accountId = party[PARTY_TYPES[partyType].accountField];
  if (!accountId) return { status: 'none' };
  const [vendors, customers] = await Promise.all([rtdb.ref('vendors').get(), rtdb.ref('customers').get()]);
  const all = { Vendor: vendors.val() || {}, Customer: customers.val() || {} };
  // Only parties usable in this company can post to this company's GL.
  const shared = Object.keys(PARTY_TYPES).some(pt => Object.keys(all[pt]).some(id => {
    const p = all[pt][id];
    return !(pt === partyType && id === partyId) && p[PARTY_TYPES[pt].accountField] === accountId && (!p.CompanyID || p.CompanyID === companyId);
  }));
  const account = ((await rtdb.ref('coa/' + accountId).get()).val()) || {};
  if (shared) return { status: 'shared', AccountCode: account.AccountCode || '' };

  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get();
  let dr = 0, cr = 0;
  snap.docs.forEach(d => {
    const e = d.data();
    if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= toDate)) return;
    (e.Lines || []).forEach(l => {
      if (l.AccountID !== accountId) return;
      dr += Number(l.Debit) || 0; cr += Number(l.Credit) || 0;
    });
  });
  const balance = round2(GROWS[partyType] === 'Dr' ? dr - cr : cr - dr);
  return { status: 'ok', AccountCode: account.AccountCode || '', AccountName: account.AccountName || '', Balance: balance };
}

async function buildStatement(partyType, partyId, companyId, fromDate, toDate) {
  const cfg = PARTY_TYPES[partyType];
  const party = (await rtdb.ref(cfg.path + '/' + partyId).get()).val();
  if (!party) throw new Error(partyType + ' not found.');
  if (party.CompanyID && party.CompanyID !== companyId) throw new Error('That ' + partyType.toLowerCase() + ' belongs to a different company.');
  const company = ((await rtdb.ref('companies/' + companyId).get()).val()) || {};

  const grows = GROWS[partyType];
  const signed = r => (r.Side === grows ? r.Amount : -r.Amount);
  const all = await partyMovements(partyType, partyId, companyId);
  let opening = 0;
  const rows = [];
  let running;
  all.forEach(r => {
    if (r.Date < fromDate) { opening = round2(opening + signed(r)); return; }
    if (r.Date > toDate) return;
    if (running === undefined) running = opening;
    running = round2(running + signed(r));
    rows.push(Object.assign({}, r, { Debit: r.Side === 'Dr' ? r.Amount : 0, Credit: r.Side === 'Cr' ? r.Amount : 0, Balance: running }));
  });
  const closing = rows.length ? rows[rows.length - 1].Balance : opening;
  const totals = rows.reduce((t, r) => ({ Debit: round2(t.Debit + r.Debit), Credit: round2(t.Credit + r.Credit) }), { Debit: 0, Credit: 0 });

  // Open items as at the end date, signed in the party's natural sense
  // (an advance or open credit reduces the balance).
  const items = await getOpenItemsForParty(partyType, partyId, party, toDate);
  const open = [...items.values()]
    .filter(i => i.Outstanding > 0.005 && (!i.CompanyID || i.CompanyID === companyId))
    .map(i => {
      const dueDate = i.ItemType === 'NewRef' ? (i.DueDate || i.Date) : (i.DueDate || addDays(i.Date, party.PaymentTermsDays));
      const overdue = Math.max(0, daysBetween(dueDate, toDate));
      const sign = i.Side === grows ? 1 : -1;
      return {
        RefID: i.RefID, Number: i.Number, Type: i.DocumentType ? 'Opening ' + i.DocumentType.toLowerCase() : (i.ItemType === 'NewRef' ? 'Open ' + (sign > 0 ? 'balance' : 'credit') : 'Invoice'),
        Date: i.Date, DueDate: dueDate, DaysOverdue: overdue, Description: i.Description,
        Amount: round2(sign * i.Amount), Outstanding: round2(sign * i.Outstanding)
      };
    })
    .sort((a, b) => (a.DueDate + a.Number).localeCompare(b.DueDate + b.Number));
  const aging = AGING.map(b => ({ key: b.key, label: b.label, amount: 0 }));
  open.forEach(i => {
    const idx = AGING.findIndex(b => i.DaysOverdue <= b.max);
    aging[idx].amount = round2(aging[idx].amount + i.Outstanding);
  });
  const openTotal = round2(open.reduce((s, i) => s + i.Outstanding, 0));

  const gl = await controlAccountBalance(partyType, partyId, party, companyId, toDate);
  if (gl.status === 'ok') gl.Difference = round2(closing - gl.Balance);

  // Post-dated cheques still to clear as at the end date (docs/modules/PDC.md).
  const pendingPdcs = (await pendingPdcsForParty(partyType, partyId, companyId, toDate))
    .map(p => Object.assign(p, { DaysToMaturity: daysBetween(toDate, p.ChequeDate) }));
  const pendingPdcTotal = round2(pendingPdcs.reduce((sum, p) => sum + p.Amount, 0));

  return {
    PartyType: partyType, PartyID: partyId, PartyCode: party[cfg.codeField] || '', PartyName: party[cfg.nameField] || '',
    PartyAddress: [party.AddressLine1, party.AddressLine2, party.Country].filter(Boolean).join(', '),
    PaymentTermsDays: Number(party.PaymentTermsDays) || 0,
    CompanyID: companyId, CompanyName: company.LegalName || '', FromDate: fromDate, ToDate: toDate,
    BalanceLabel: partyType === 'Vendor' ? 'Payable to vendor' : 'Receivable from customer',
    Opening: opening, Rows: rows, Totals: totals, Closing: closing,
    OpenItems: open, OpenTotal: openTotal, Aging: aging, Reconciliation: gl,
    PendingPdcs: pendingPdcs, PendingPdcTotal: pendingPdcTotal
  };
}

exports.getPartyStatement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const partyType = String(d.partyType || '').trim();
  const moduleId = MODULES[partyType];
  if (!moduleId) throw new HttpsError('invalid-argument', 'Party type must be Vendor or Customer.');
  if (!(await moduleHasCapability(moduleId, 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to the ' + partyType + ' Statement of Account.');
  }
  const companyId = String(d.companyId || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const partyId = String(d.partyId || '').trim();
  if (!partyId) throw new HttpsError('invalid-argument', 'Select a ' + partyType + '.');
  const fromDate = String(d.fromDate || '').trim();
  const toDate = String(d.toDate || '').trim();
  if (!isDate(fromDate) || !isDate(toDate)) throw new HttpsError('invalid-argument', 'Select a date range.');
  if (fromDate > toDate) throw new HttpsError('invalid-argument', 'The start date is after the end date.');
  return buildStatement(partyType, partyId, companyId, fromDate, toDate);
});
