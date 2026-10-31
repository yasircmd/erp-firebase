// The cash flow forecast, budget step B4 (owner, 2026-10-31; docs/modules/
// BUDGET.md, Q341, Q345, Q353-Q356). New development, hand-written.
//
// A company's cash from today: its cash and bank balances now, then 13
// weeks and the months to the financial year's end, each period's money
// in and out and the balance after. What fills the periods is the
// company's Budget Setup (Q345, Q355):
//   OpenItems           what the ERP already holds: customers' and vendors'
//                       open invoices on their due dates (Q354), post-dated
//                       cheques on their dates, open Purchase Orders (the
//                       quantity not yet received, due on their terms),
//                       payroll (the last posted run's net pay at each
//                       month's end, Q356) and recurring entries' cash lines;
//   Budget              the year's Current budget as cash (budgetCalc.budgetCash);
//   OpenItemsAndBudget  open items for the 13 weeks, the budget after.
// Invoices already overdue are shown apart and not counted (Q353).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { pdcCheques } = require('./jobStore');
const { purchaseOrders } = require('./purchaseStore');
const B = require('./budget');
const C = require('./budgetCalc');
const S = require('./recurringSchedule');

const onCallOptions = { region: 'us-central1' };
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);

// The items a company's open documents give: [{ Row, Direction, Date, Amount, Number, Party }].
async function openItems(companyId, today, yearEnd, coa, isCash) {
  const aging = require('./agingReports');
  const items = [];
  const [customers, vendors] = await Promise.all([aging.partyAging('Customer', companyId, today, 'due'), aging.partyAging('Vendor', companyId, today, 'due')]);
  [[customers.Rows, 'Customers', 'in'], [vendors.Rows, 'Vendors', 'out']].forEach(([rows, label, dir]) => (rows || []).forEach(r =>
    C.netPartyItems(r.Items, r.PendingPdc).forEach(i => items.push({ Row: label, Direction: dir, Date: i.DueDate, Amount: i.BaseOutstanding, Number: i.Number || '', Party: r.Name }))));
  // Cheques already in hand or issued, on their dates.
  Object.values(await pdcCheques.query({ CompanyID: companyId, Status: 'Pending' })).forEach(p => items.push({
    Row: p.Direction === 'Issued' ? 'Cheques issued' : 'Cheques received', Direction: p.Direction === 'Issued' ? 'out' : 'in',
    Date: p.ChequeDate || '', Amount: C.round2(Number(p.Amount) || 0), Number: p.TransactionNumber || p.ChequeNumber || '', Party: p.PartyName || '' }));
  // Open Purchase Orders: what is not yet received, due on the vendor's terms from its date (or today).
  const vendorsById = (await rtdb.ref('vendors').get()).val() || {};
  for (const po of Object.values(await purchaseOrders.query({ CompanyID: companyId, Status: 'Approved' }))) {
    const open = (po.Lines || []).reduce((s, l) => s + Math.max(0, (Number(l.Quantity) || 0) - (Number(l.ReceivedQuantity) || 0)) * (Number(l.UnitPrice) || 0), 0);
    if (!(open > 0)) continue;
    const v = vendorsById[po.VendorID] || {};
    const base = await require('./exchangeRates').baseCurrency();
    const rate = !po.Currency || !base.Code || po.Currency === base.Code ? 1 : (await require('./exchangeRates').rateOn(po.Currency, today, base)).Rate;
    const from = String(po.PODate || '') > today ? po.PODate : today;
    items.push({ Row: 'Open Purchase Orders', Direction: 'out', Date: C.addDays(from, Number(v.PaymentTermsDays) || 0), Amount: C.round2(open * rate), Number: po.PONumber || '', Party: v.VendorName || '' });
  }
  // Payroll: the last posted run's net pay at each month's end (Q356).
  const runs = (await firestore.collection('payrollRuns').where('CompanyID', '==', companyId).get()).docs.map(d => d.data())
    .filter(r => r.Status === 'Posted').sort((a, b) => String(a.Month).localeCompare(String(b.Month)));
  const last = runs[runs.length - 1];
  if (last && Number(last.Net) > 0) {
    for (let m = today.slice(0, 7); m <= yearEnd.slice(0, 7); m = C.addMonths(m, 1)) {
      items.push({ Row: 'Payroll', Direction: 'out', Date: C.lastDay(m), Amount: C.round2(Number(last.Net)), Number: 'As ' + last.Month, Party: '' });
    }
  }
  // Recurring entries with fixed amounts (a spread total's runs vary: left out): their cash and bank lines on each date due.
  const templates = (await rtdb.ref('recurringJournals').get()).val() || {};
  const R = require('./recurringJournal');
  Object.values(templates).filter(t => t.CompanyID === companyId && t.Status === 'Active' && (t.AmountMode || 'Fixed') === 'Fixed').forEach(t => {
    const cash = C.round2((t.Lines || []).filter(l => isCash(l.AccountID)).reduce((s, l) => s + (Number(l.Debit) || 0) - (Number(l.Credit) || 0), 0));
    if (!cash) return;
    let dates = [];
    try { dates = R.dueDatesBetween(t, today, yearEnd); } catch (err) { dates = []; }
    dates.forEach(d => items.push({ Row: 'Recurring entries', Direction: cash > 0 ? 'in' : 'out', Date: d, Amount: Math.abs(cash), Number: t.TemplateNumber || '', Party: t.Description || '' }));
  });
  return items;
}

exports.getCashForecast = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('BUDGET', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Budget.');
  const companyId = text(request.data && request.data.companyId, 80);
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const today = S.todayIn(S.TIME_ZONE);
  const setup = await B.setupOf(companyId);
  const mode = setup.CashForecast;
  const yearStart = require('./periodClosing').yearStartOf(today.slice(0, 7), await B.fiscalStartOf(companyId));
  const months = C.monthsOf(yearStart), yearEnd = C.lastDay(months[11]);
  const buckets = C.cashBuckets(today, yearEnd);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const isCash = id => Boolean(coa[id] && ['Cash', 'Bank'].includes(coa[id].CashBank));
  const accounts = {};
  Object.keys(coa).forEach(id => { accounts[id] = { AccountType: coa[id].AccountType }; });

  // Cash and bank today, from the posted entries.
  let opening = 0;
  (await B.postedEntries(companyId, today)).forEach(e => (e.Lines || []).forEach(l => { if (isCash(l.AccountID)) opening += (Number(l.Debit) || 0) - (Number(l.Credit) || 0); }));
  const items = mode === 'Budget' ? [] : await openItems(companyId, today, yearEnd, coa, isCash);
  const budget = mode === 'OpenItems' ? null : (await B.budgetsOf(companyId)).find(b => b.YearStart === yearStart && b.Status === 'Approved' && b.Current) || null;
  const flows = budget ? C.budgetCash(budget, accounts, buckets, isCash) : null;
  const f = C.cashForecast(buckets, items, flows, mode, opening, today);
  return { companyId, today, mode, yearLabel: C.yearLabel(yearStart), budget: budget ? budget.Number : '', needsBudget: mode !== 'OpenItems' && !budget,
    opening: C.round2(opening), buckets, rows: f.rows, net: f.net, closing: f.closing, overdue: f.overdue, detail: f.detail };
});
