// Period Closing, step 1a (owner, 2026-10-11; docs/modules/PERIOD_CLOSING.md,
// decisions 122-131): per company, the months of its financial year, each
// Open or Closed; a checklist before a month is closed; close (in order) and
// reopen (with a reason, logged). The lock itself (decision 123: nothing
// dated in a closed month posted, reversed or changed) is step 1b.
//
// Storage: RTDB periodClosing/{companyId}:
//   Settings: { FiscalYearStart: 'Jan' | 'Apr' (decision 122, fixed after the
//               first year-end, 129), RetainedEarningsAccountID (an Equity
//               account, used by the year-end close of step 2),
//               Checklist: { key: 'Block' | 'Warn' | 'Off' } (decision 128),
//               ZeroAccounts: [{ AccountID, Mode }] — accounts that must be
//               zero at the month's end (UX_TIER3.md D),
//               Steps: [{ ID, Text, Mode }] — steps to tick (D, decision 159) }
//   Ticks: { 'yyyy-mm': { stepId: { By, ByName, At } } } — the ticked steps
//          of a month not yet closed (copied into Closed/{month} on closing);
//   ClosedThrough: 'yyyy-mm' — every month up to it is closed;
//   FirstClosed:   'yyyy-mm' — the first month ever closed (the months
//                  before it closed with it, unchecked: no Closed entry);
//   Closed: { 'yyyy-mm': { By, ByName, At, Warnings } };
//   YearsClosed: { ... } — step 2; while empty the financial year can change;
//   Log: { pushId: { Action, Month, ClosedThrough, Reason, By, ByName, At } }.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const stockStore = require('./stockStore');
const movedPaths = require('./movedPaths');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION, generateStockVoucherNumber, transactionRefFor } = require('./glWriting');
const { randomUUID } = require('crypto');
const { withGlobalLock } = require('./lock');
const { todayIn, TIME_ZONE } = require('./recurringSchedule');
const recurring = require('./recurringJournal');
const aging = require('./agingReports');

const onCallOptions = { region: 'us-central1', timeoutSeconds: 120 };
const MODULE_ID = 'PERIODCLOSE';
const LABEL = 'Period Closing';
const PATH = 'periodClosing';
const MODES = ['Block', 'Warn', 'Off'];
const FY_STARTS = { Jan: 1, Apr: 4 };

// The checklist (design → "Close a month"), in the order shown.
const CHECKLIST = [
  { key: 'drafts', label: 'Drafts dated in the period, not posted' },
  { key: 'approvals', label: 'Documents waiting for approval' },
  { key: 'recurring', label: 'Recurring journals due and not posted' },
  { key: 'depreciation', label: 'Depreciation not run for the month' },
  { key: 'payroll', label: 'Payroll for the month not posted' },
  { key: 'pdc', label: 'Post-dated cheques matured and not cleared' },
  { key: 'deliveries', label: 'Deliveries posted, not invoiced' },
  { key: 'receivables', label: 'Customer Aging agrees with the receivables accounts' },
  { key: 'payables', label: 'Vendor Aging agrees with the payables accounts' },
  { key: 'stock', label: 'Stock value agrees with the inventory accounts' },
  { key: 'trialBalance', label: 'The Trial Balance balances' }
];
const DEFAULT_MODE = 'Warn'; // also the new deliveries check's (decision 158)
const MAX_ZERO_ACCOUNTS = 50, MAX_STEPS = 30;

// Where each kind of document is fixed (the screens' module ids).
const STOCK_MODULES = {
  GRN: 'GRN', MaterialIssue: 'MATERIALISSUE', Production: 'PRODUCTION', WarehouseMovement: 'WAREHOUSEMOVEMENT',
  StockAdjustment: 'STOCKADJUSTMENT', PhysicalCount: 'PHYSICALCOUNT', DeliveryNote: 'DELIVERYNOTE',
  PurchaseReturn: 'PURCHASERETURN', SalesReturn: 'SALESRETURN', RetailSale: 'RETAILSALES'
};
const DRAFT_STATUSES = ['Draft', 'Rejected'];
const APPROVAL_STATUSES = ['PendingApproval', 'PendingReversalApproval'];

const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '');
const round2 = n => Math.round(n * 100) / 100;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
// Periods go out as yyyy-mm; the shell shows them as Mar-2026 (docs/modules/DATE_FORMAT.md).
const monthLabel = m => m;
function addMonths(m, n) {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
}
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return m + '-' + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0'); };
const today = () => todayIn(TIME_ZONE);

// The financial year a month falls in, as its first month.
function yearStartOf(month, fyStart) {
  const startNo = FY_STARTS[fyStart] || 1;
  const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
  return (mo >= startNo ? y : y - 1) + '-' + String(startNo).padStart(2, '0');
}
function yearMonths(start) { return Array.from({ length: 12 }, (_, i) => addMonths(start, i)); }
function yearLabel(start) { return start.endsWith('-01') ? start.slice(0, 4) : start.slice(0, 4) + '–' + String(Number(start.slice(0, 4)) + 1).slice(2); }

const isClosed = (state, m) => Boolean(state.ClosedThrough) && m <= state.ClosedThrough;

async function can(user, cap) { return moduleHasCapability(MODULE_ID, cap, user.profile.role); }
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to ' + LABEL + '.');
  if (cap === 'close' && !(await can(user, 'close'))) throw new HttpsError('permission-denied', 'You do not have permission to close periods or change the Period Closing setup.');
  if (cap === 'reopen' && !(await can(user, 'reopen'))) throw new HttpsError('permission-denied', 'You do not have permission to reopen periods.');
}
async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}

// The company's Equity accounts that can take a posting.
function equityAccounts(coa, companyId) {
  return Object.entries(coa).filter(([, a]) => a.AccountType === 'Equity' && a.Status === 'Active' && a.IsPostable === true && (!a.CompanyID || a.CompanyID === companyId))
    .map(([id, a]) => ({ ID: id, Code: a.AccountCode || '', Name: a.AccountName || '' })).sort((a, b) => a.Code.localeCompare(b.Code));
}

// The company's accounts that can take a posting (for "must be zero").
function postableAccounts(coa, companyId) {
  return Object.entries(coa).filter(([, a]) => a.IsPostable === true && (!a.CompanyID || a.CompanyID === companyId))
    .map(([id, a]) => ({ ID: id, Code: a.AccountCode || '', Name: a.AccountName || '', Status: a.Status || '' })).sort((a, b) => a.Code.localeCompare(b.Code));
}
const modeOf = m => MODES.includes(m) ? m : DEFAULT_MODE;
const asList = v => Array.isArray(v) ? v : Object.values(v || {});

function settingsOf(state, coa, companyId) {
  const s = state.Settings || {};
  const checklist = {};
  CHECKLIST.forEach(c => { checklist[c.key] = modeOf((s.Checklist || {})[c.key]); });
  const zero = asList(s.ZeroAccounts).filter(z => z && z.AccountID).map(z => ({ AccountID: z.AccountID, Mode: modeOf(z.Mode) }));
  const steps = asList(s.Steps).filter(x => x && x.ID && x.Text).map(x => ({ ID: x.ID, Text: x.Text, Mode: modeOf(x.Mode) }));
  let re = s.RetainedEarningsAccountID || '';
  // The default chart's Retained Earnings, until one is chosen: the first account under 320000 (docs/modules/COA_NUMBERING.md).
  if (!re) re = require('./coaScheme').defaultRetainedEarnings(coa, companyId);
  return { FiscalYearStart: FY_STARTS[s.FiscalYearStart] ? s.FiscalYearStart : 'Jan', RetainedEarningsAccountID: re, Checklist: checklist,
    ZeroAccounts: zero, Steps: steps, Saved: Boolean(state.Settings) };
}

async function loadState(companyId) { return (await rtdb.ref(PATH + '/' + companyId).get()).val() || {}; }

// ---------- The checklist ----------

const docRow = (moduleId, kind, number, date, status, extra) => Object.assign({ ModuleID: moduleId, Kind: kind, Number: number || '(no number yet)', Date: date || '', Status: status || '' }, extra || {});

// Every unfinished document of the company dated from `from` (inclusive,
// '' = the beginning) to the end of `month`, split into drafts and
// documents waiting for approval.
async function unfinishedDocuments(companyId, from, to) {
  const inRange = d => Boolean(d) && (!from || d >= from) && d <= to;
  const [stockSnap, vinvSnap, cinvSnap, pdcSnap, jvSnap, faSnap] = await Promise.all([
    stockStore.queryTx({ CompanyID: companyId }).then(v => ({ val: () => v })), ...['vendorInvoices', 'customerInvoices'].map(p => movedPaths.where(p, { CompanyID: companyId }).then(v => ({ val: () => v }))), movedPaths.where('pdcCheques', { CompanyID: companyId }).then(v => ({ val: () => v })),
    firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get(),
    firestore.collection('faTransactions').where('CompanyID', '==', companyId).get()
  ]);
  const rows = [];
  Object.values(stockSnap.val() || {}).forEach(t => {
    if (t.CompanyID === companyId && inRange(t.TransactionDate)) rows.push(docRow(STOCK_MODULES[t.TransactionType] || 'GRN', t.TransactionType || 'Stock', t.TransactionNumber, t.TransactionDate, t.Status));
  });
  [[vinvSnap, 'VENDORINVOICE', 'Vendor Invoice'], [cinvSnap, 'CUSTOMERINVOICE', 'Customer Invoice']].forEach(([snap, mod, kind]) => {
    Object.values(snap.val() || {}).forEach(i => { if (i.CompanyID === companyId && inRange(i.InvoiceDate)) rows.push(docRow(mod, kind, i.TransactionNumber, i.InvoiceDate, i.Status)); });
  });
  Object.values(pdcSnap.val() || {}).forEach(p => {
    if (p.CompanyID === companyId && inRange(p.TransactionDate)) rows.push(docRow(p.Direction === 'Issued' ? 'PDCISSUED' : 'PDCRECEIVED', 'PDC ' + (p.Direction || ''), p.TransactionNumber, p.TransactionDate, p.Status));
  });
  jvSnap.docs.forEach(d => {
    const e = d.data();
    if (!inRange(e.JVDate)) return;
    const mod = e.VoucherType === 'JV' ? 'JV' : (e.VoucherType === 'RecurringJV' ? 'RECURRINGJV' : 'CBT');
    rows.push(docRow(mod, e.VoucherType || 'JV', e.JVNumber, e.JVDate, e.Status));
  });
  faSnap.docs.forEach(d => {
    const t = d.data();
    if (inRange(t.Date)) rows.push(docRow(t.ModuleID || 'FAACQ', 'Fixed asset ' + (t.Type || ''), t.TransactionNumber || t.Number, t.Date, t.Status));
  });
  const sort = list => list.sort((a, b) => (a.Date + a.Number).localeCompare(b.Date + b.Number));
  return {
    drafts: sort(rows.filter(r => DRAFT_STATUSES.includes(r.Status))),
    approvals: sort(rows.filter(r => APPROVAL_STATUSES.includes(r.Status)))
  };
}

async function recurringDue(companyId, from, to) {
  const all = (await rtdb.ref('recurringJournals').get()).val() || {};
  const out = [];
  Object.values(all).forEach(t => {
    if (t.CompanyID !== companyId) return;
    let dates;
    try { dates = recurring.dueDatesBetween(t, from, to); } catch (err) { return; } // a broken schedule shows in its own module
    dates.forEach(date => out.push(docRow('RECURRINGJV', 'Recurring journal', t.TemplateNumber, date, 'Due', { Text: t.Description || '' })));
  });
  return out.sort((a, b) => (a.Date + a.Number).localeCompare(b.Date + b.Number));
}

// Assets in use by the month's end while the last depreciation run is
// before the month.
async function depreciationMissing(companyId, month) {
  const end = lastDay(month);
  const [assetsSnap, stateSnap] = await Promise.all([
    firestore.collection('faAssets').where('CompanyID', '==', companyId).get(), firestore.collection('faRunState').doc(companyId).get()
  ]);
  const inUse = assetsSnap.docs.map(d => d.data()).filter(a => a.CapitalizationDate && a.CapitalizationDate <= end && a.Status === 'Active');
  const last = (stateSnap.exists && stateSnap.data().LastPostedPeriod) || '';
  if (!inUse.length || (last && last >= month)) return [];
  return [docRow('FADEPRUN', 'Depreciation run', monthLabel(month), end, 'Not run', { Text: inUse.length + ' asset(s) in use; last run ' + (last ? monthLabel(last) : 'none') })];
}

// Active employees of the company who had joined by the month's end, and
// no posted payroll run for the month.
async function payrollMissing(companyId, month) {
  const end = lastDay(month);
  const [empSnap, runSnap] = await Promise.all([
    firestore.collection('employees').where('CompanyID', '==', companyId).get(),
    firestore.collection('payrollRuns').where('CompanyID', '==', companyId).get()
  ]);
  const staff = empSnap.docs.map(d => d.data()).filter(e => (e.Status || 'Active') === 'Active' && (!e.JoinDate || e.JoinDate <= end));
  if (!staff.length) return [];
  const run = runSnap.docs.map(d => d.data()).find(r => r.Month === month);
  if (run && run.Status === 'Posted') return [];
  return [docRow('PAYROLL', 'Payroll run', monthLabel(month), end, run ? run.Status : 'Not started', { Text: staff.length + ' active employee(s)' })];
}

async function pdcsMatured(companyId, month) {
  const end = lastDay(month);
  const all = await movedPaths.where('pdcCheques', { CompanyID: companyId, Status: 'Pending' }); // (jobStore.js)
  return Object.values(all).filter(p => p.CompanyID === companyId && p.Status === 'Pending' && p.ChequeDate && p.ChequeDate <= end)
    .map(p => docRow(p.Direction === 'Issued' ? 'PDCISSUED' : 'PDCRECEIVED', 'PDC ' + (p.Direction || ''), p.TransactionNumber, p.ChequeDate, 'Pending',
      { Text: (p.ChequeNumber ? 'cheque ' + p.ChequeNumber + ', ' : '') + (p.PartyName || '') + ', ' + round2(Number(p.Amount) || 0).toFixed(2) }))
    .sort((a, b) => (a.Date + a.Number).localeCompare(b.Date + b.Number));
}

// The aging report's own check against its control accounts.
async function partyControl(partyType, companyId, month) {
  const r = await aging.partyAging(partyType, companyId, lastDay(month), 'due', null);
  const c = r.Control;
  const mod = partyType === 'Customer' ? 'CUSTOMERAGING' : 'VENDORAGING';
  if (c.status === 'ok') {
    if (Math.abs(c.Difference) < 0.005) return { findings: [], note: 'Agrees: ' + c.Balance.toFixed(2) + ' (' + c.Accounts.join(', ') + ').' };
    return { findings: [docRow(mod, partyType + ' Aging', c.Accounts.join(', '), lastDay(month), 'Difference', { Text: 'Aging ' + r.Totals.Net.toFixed(2) + ', GL ' + c.Balance.toFixed(2) + ', difference ' + c.Difference.toFixed(2) })] };
  }
  if (c.status === 'shared') return { findings: [], note: 'Not compared: a control account is shared by customers and vendors.' };
  return { findings: [], note: 'Not compared: no ' + partyType.toLowerCase() + ' has a control account.' };
}

// The stock value per inventory account (the items' InventoryAccountID)
// against those accounts' GL balances at the month's end.
async function stockControl(companyId, month) {
  const end = lastDay(month);
  const [inv, itemSnap, coaSnap, jvSnap] = await Promise.all([
    aging.inventoryAging(companyId, end, '', '', false), rtdb.ref('items').get(), rtdb.ref('coa').get(),
    firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get()
  ]);
  const items = itemSnap.val() || {}, coa = coaSnap.val() || {};
  const stock = {};
  inv.Rows.forEach(r => { const acc = (items[r.ItemID] || {}).InventoryAccountID || ''; stock[acc] = round2((stock[acc] || 0) + r.Value); });
  Object.values(items).forEach(i => { if (i.InventoryAccountID && (!i.CompanyID || i.CompanyID === companyId) && !(i.InventoryAccountID in stock)) stock[i.InventoryAccountID] = 0; });
  const accounts = Object.keys(stock).filter(Boolean);
  if (!accounts.length) return { findings: [], note: 'No stock items.' };
  const gl = {};
  jvSnap.docs.forEach(d => {
    const e = d.data();
    if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= end)) return;
    (e.Lines || []).forEach(l => { if (l.AccountID in stock) gl[l.AccountID] = round2((gl[l.AccountID] || 0) + (Number(l.Debit) || 0) - (Number(l.Credit) || 0)); });
  });
  const findings = [];
  accounts.sort((a, b) => String((coa[a] || {}).AccountCode).localeCompare(String((coa[b] || {}).AccountCode))).forEach(a => {
    const diff = round2(stock[a] - (gl[a] || 0));
    if (Math.abs(diff) >= 0.005) findings.push(docRow('INVENTORYAGING', 'Inventory account', (coa[a] || {}).AccountCode || a, end, 'Difference',
      { Text: 'Stock ' + stock[a].toFixed(2) + ', GL ' + (gl[a] || 0).toFixed(2) + ', difference ' + diff.toFixed(2) }));
  });
  if (stock['']) findings.push(docRow('ITEMMASTER', 'Items', 'no inventory account', end, 'Difference', { Text: 'Stock ' + stock[''].toFixed(2) + ' on items with no inventory account' }));
  return { findings, note: findings.length ? '' : 'Agrees (' + accounts.map(a => (coa[a] || {}).AccountCode || a).join(', ') + ').' };
}

// Posted deliveries up to the month's end that no posted invoice includes
// (the Delivery Note list's "not invoiced"), not reversed.
async function deliveriesNotInvoiced(companyId, month) {
  const end = lastDay(month);
  // The company's posted Delivery Notes (stockStore.js), not every stock transaction.
  const [stockSnap, custSnap] = await Promise.all([stockStore.queryTx({ TransactionType: 'DeliveryNote', CompanyID: companyId, Status: 'Posted' }).then(v => ({ val: () => v })), rtdb.ref('customers').get()]);
  const customers = custSnap.val() || {};
  return Object.values(stockSnap.val() || {})
    .filter(t => t.TransactionType === 'DeliveryNote' && t.CompanyID === companyId && t.Status === 'Posted' && t.TransactionDate && t.TransactionDate <= end &&
      !t.MatchedToInvoiceID && !t.ReversedByDeliveryNoteID && !t.ReversalOfDeliveryNoteID)
    .map(t => docRow('DELIVERYNOTE', 'Delivery Note', t.TransactionNumber, t.TransactionDate, 'Not invoiced', { Text: (customers[t.CustomerID] || {}).CustomerName || t.CustomerID || '' }))
    .sort((a, b) => (a.Date + a.Number).localeCompare(b.Date + b.Number));
}

// Each "must be zero" account's GL balance at the month's end.
async function accountBalances(companyId, month, accountIds) {
  const end = lastDay(month);
  const want = new Set(accountIds), bal = {};
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get();
  snap.docs.forEach(d => {
    const e = d.data();
    if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= end)) return;
    (e.Lines || []).forEach(l => { if (want.has(l.AccountID)) bal[l.AccountID] = round2((bal[l.AccountID] || 0) + (Number(l.Debit) || 0) - (Number(l.Credit) || 0)); });
  });
  return bal;
}

async function trialBalance(companyId, month) {
  const end = lastDay(month);
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get();
  let dr = 0, cr = 0;
  const off = [];
  snap.docs.forEach(d => {
    const e = d.data();
    if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= end)) return;
    let edr = 0, ecr = 0;
    (e.Lines || []).forEach(l => { edr += Number(l.Debit) || 0; ecr += Number(l.Credit) || 0; });
    dr += edr; cr += ecr;
    if (Math.abs(round2(edr - ecr)) >= 0.005) off.push(docRow(e.VoucherType === 'JV' ? 'JV' : 'GLREPORT', e.VoucherType || 'JV', e.JVNumber, e.JVDate, 'Unbalanced', { Text: 'Debits ' + round2(edr).toFixed(2) + ', credits ' + round2(ecr).toFixed(2) }));
  });
  dr = round2(dr); cr = round2(cr);
  if (Math.abs(round2(dr - cr)) < 0.005) return { findings: [], note: 'Balances: ' + dr.toFixed(2) + ' each side.' };
  const findings = off.length ? off : [docRow('TRIALBALANCE', 'Trial Balance', monthLabel(month), end, 'Difference', { Text: 'Debits ' + dr.toFixed(2) + ', credits ' + cr.toFixed(2) })];
  return { findings };
}

// The checklist for closing `month`: it covers the period from the month
// after the last closed one (or the beginning) to the month's end.
async function runChecklist(companyId, month, state, settings) {
  const from = state.ClosedThrough && state.ClosedThrough < month ? addMonths(state.ClosedThrough, 1) + '-01' : '';
  const to = lastDay(month);
  const mode = k => settings.Checklist[k];
  const need = k => mode(k) !== 'Off';
  const zeroOn = settings.ZeroAccounts.filter(z => z.Mode !== 'Off');
  const [docs, rec, dep, pay, pdc, dns, ar, ap, stock, tb, balances, coa] = await Promise.all([
    need('drafts') || need('approvals') ? unfinishedDocuments(companyId, from, to) : { drafts: [], approvals: [] },
    need('recurring') ? recurringDue(companyId, from, to) : [],
    need('depreciation') ? depreciationMissing(companyId, month) : [],
    need('payroll') ? payrollMissing(companyId, month) : [],
    need('pdc') ? pdcsMatured(companyId, month) : [],
    need('deliveries') ? deliveriesNotInvoiced(companyId, month) : [],
    need('receivables') ? partyControl('Customer', companyId, month) : null,
    need('payables') ? partyControl('Vendor', companyId, month) : null,
    need('stock') ? stockControl(companyId, month) : null,
    need('trialBalance') ? trialBalance(companyId, month) : null,
    zeroOn.length ? accountBalances(companyId, month, zeroOn.map(z => z.AccountID)) : {},
    zeroOn.length ? rtdb.ref('coa').get().then(x => x.val() || {}) : {}
  ]);
  const found = {
    drafts: { findings: docs.drafts }, approvals: { findings: docs.approvals }, recurring: { findings: rec }, depreciation: { findings: dep },
    payroll: { findings: pay }, pdc: { findings: pdc }, deliveries: { findings: dns }, receivables: ar, payables: ap, stock, trialBalance: tb
  };
  const item = (key, label, m, f, extra) => {
    const findings = m === 'Off' ? [] : ((f && f.findings) || []);
    return Object.assign({ Key: key, Label: label, Mode: m, Findings: findings.slice(0, 200), Count: findings.length, Note: (m !== 'Off' && f && f.note) || '',
      Result: m === 'Off' ? 'Off' : (findings.length ? (m === 'Block' ? 'Blocks' : 'Warning') : 'OK') }, extra || {});
  };
  const items = CHECKLIST.map(c => item(c.key, c.label, mode(c.key), found[c.key], { Kind: 'check' }));
  // The accounts that must be zero at the month's end.
  settings.ZeroAccounts.forEach(z => {
    const a = coa[z.AccountID] || {}, name = (a.AccountCode || z.AccountID) + (a.AccountName ? ' ' + a.AccountName : '');
    const b = round2(balances[z.AccountID] || 0);
    const f = Math.abs(b) < 0.005 ? { findings: [], note: 'Zero.' }
      : { findings: [docRow('GLREPORT', 'Account', name, to, 'Not zero', { Text: 'Balance ' + Math.abs(b).toFixed(2) + (b > 0 ? ' Dr' : ' Cr') })] };
    items.push(item('zero:' + z.AccountID, 'Account ' + name + ' is zero', z.Mode, f, { Kind: 'zero', AccountID: z.AccountID }));
  });
  // The steps to tick (decision 159): a step not ticked is a finding.
  const ticks = (state.Ticks || {})[month] || {};
  settings.Steps.forEach(st => {
    const t = ticks[st.ID] || null;
    const f = t ? { findings: [], note: 'Ticked by ' + (t.ByName || t.By) + '.' } : { findings: [docRow('PERIODCLOSE', 'Step', st.Text, to, 'Not ticked')] };
    items.push(item('step:' + st.ID, st.Text, st.Mode, f, { Kind: 'step', StepID: st.ID, Ticked: t }));
  });
  return { Month: month, From: from, To: to, Items: items, Blocking: items.filter(i => i.Result === 'Blocks').length, Warnings: items.filter(i => i.Result === 'Warning').length };
}

// ---------- The year-end close (step 2; decisions 125, 129, 140-143) ----------

const PL_TYPES = ['Revenue', 'COGS', 'Expense'];
const YEC_TYPE = 'YearEndClose';

function yearStatus(state, start) {
  const y = (state.YearsClosed || {})[start];
  const allMonthsClosed = isClosed(state, addMonths(start, 11));
  const closedYears = Object.keys(state.YearsClosed || {}).sort();
  const later = closedYears.find(k => k > start);
  const prev = addMonths(start, -12);
  const prevOpen = closedYears.length && !closedYears.includes(prev) && closedYears.some(k => k < start);
  return {
    Closed: Boolean(y), ClosedBy: y ? y.ByName : '', ClosedAt: y ? y.At : '', JVNumber: y ? y.JVNumber : '', JVID: y ? y.JVID : '',
    CanClose: !y && allMonthsClosed && !later && !prevOpen,
    CloseNote: y ? '' : !allMonthsClosed ? 'Close all its months first.' : later ? 'A later year is already closed.' : prevOpen ? 'Close ' + yearLabel(prev) + ' first.' : '',
    CanReopen: Boolean(y) && !later
  };
}

// The closing entry's lines: for each income / cost of sales / expense account,
// cost center and profit center, the opposite of its balance at the year end;
// the total to Retained Earnings by cost center and profit center.
function closingLines(entries, coa, reId, yearEnd) {
  const bal = {};
  entries.forEach(e => {
    if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= yearEnd)) return;
    (e.Lines || []).forEach(l => {
      const a = coa[l.AccountID];
      if (!a || !PL_TYPES.includes(a.AccountType)) return;
      const k = [l.AccountID, l.CostCenterID || '', l.ProfitCenterID || ''].join('|');
      bal[k] = (bal[k] || 0) + (Number(l.Debit) || 0) - (Number(l.Credit) || 0);
    });
  });
  const lines = [], toRe = {};
  Object.keys(bal).sort().forEach(k => {
    const net = Math.round(bal[k] * 100) / 100;
    if (Math.abs(net) < 0.005) return;
    const [acc, cc, pc] = k.split('|');
    const a = coa[acc];
    lines.push({ AccountID: acc, AccountCode: a.AccountCode, AccountName: a.AccountName, Description: 'Year-end closing — ' + a.AccountName,
      Debit: net < 0 ? -net : 0, Credit: net > 0 ? net : 0, CostCenterID: cc, ProfitCenterID: pc });
    const rk = cc + '|' + pc;
    toRe[rk] = (toRe[rk] || 0) + net;
  });
  const re = coa[reId];
  Object.keys(toRe).sort().forEach(rk => {
    const net = Math.round(toRe[rk] * 100) / 100;
    if (Math.abs(net) < 0.005) return;
    const [cc, pc] = rk.split('|');
    lines.push({ AccountID: reId, AccountCode: re.AccountCode, AccountName: re.AccountName, Description: 'Year-end closing — profit / loss to ' + re.AccountName,
      Debit: net > 0 ? net : 0, Credit: net < 0 ? -net : 0, CostCenterID: cc, ProfitCenterID: pc });
  });
  return lines.map((l, i) => Object.assign({ LineNo: i + 1 }, l));
}

// The system's own entry: written here, not through glWriting (it closes
// inactive accounts and lines with no cost center too, and it is the one
// posting allowed into a closed month).
async function writeClosingEntry(user, companyId, date, lines, description, extra) {
  const r2 = n => Math.round(n * 100) / 100;
  const td = r2(lines.reduce((s, l) => s + l.Debit, 0)), tc = r2(lines.reduce((s, l) => s + l.Credit, 0));
  if (Math.abs(td - tc) >= 0.005) throw new HttpsError('internal', 'The closing entry does not balance.');
  const jvNumber = await generateStockVoucherNumber('YEC', Number(date.slice(0, 4)), companyId);
  const transactionRef = await transactionRefFor(YEC_TYPE);
  const jvId = 'YEC-' + randomUUID().split('-')[0].toUpperCase();
  const now = new Date().toISOString(), actor = user.profile.username || user.uid;
  const record = Object.assign({
    JVNumber: jvNumber, TransactionRef: transactionRef, JVDate: date, Description: description, Reference: '',
    Status: 'Posted', Lines: lines, TotalDebit: td, TotalCredit: tc,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor, PostedAt: now, PostedBy: actor, ReversedByJV: '',
    VoucherType: YEC_TYPE, SelectedAccountCode: '', CurrencyCode: '', CompanyID: companyId,
    DivisionID: '', BranchID: '', CostCenterID: '', ProfitCenterID: '', SourceTransactionID: ''
  }, extra || {});
  await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(jvId).set(record);
  return { jvId, jvNumber };
}

// The company's financial year containing a date (default today), for the
// reports' default period (P&L, Trial Balance): any signed-in user with the
// company; "All" companies → the calendar year.
exports.getFinancialYearStart = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : today();
  const co = text(d.companyId, 80);
  let fy = 'Jan';
  if (co) {
    if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const s = ((await rtdb.ref(PATH + '/' + co + '/Settings/FiscalYearStart').get()).val()) || 'Jan';
    fy = FY_STARTS[s] ? s : 'Jan';
  }
  const start = yearStartOf(date.slice(0, 7), fy);
  return { FiscalYearStart: fy, Start: start + '-01', End: lastDay(addMonths(start, 11)) };
});

exports.closeFinancialYear = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'close');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  return withGlobalLock(user.uid, async () => {
    const state = await loadState(companyId);
    const settings = settingsOf(state, coa, companyId);
    const start = text(d.year, 7);
    if (!isMonth(start) || yearStartOf(start, settings.FiscalYearStart) !== start) throw new HttpsError('invalid-argument', 'Choose the financial year.');
    const st = yearStatus(state, start);
    if (st.Closed) throw new HttpsError('failed-precondition', 'The financial year ' + yearLabel(start) + ' is already closed.');
    if (!st.CanClose) throw new HttpsError('failed-precondition', 'The financial year ' + yearLabel(start) + ' can\'t be closed yet: ' + st.CloseNote);
    const reId = settings.RetainedEarningsAccountID;
    if (!reId || !equityAccounts(coa, companyId).some(a => a.ID === reId)) throw new HttpsError('failed-precondition', 'Choose the Retained Earnings account in Setup first.');
    const end = lastDay(addMonths(start, 11));
    const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get();
    const lines = closingLines(snap.docs.map(x => x.data()), coa, reId, end);
    let gl = { jvId: '', jvNumber: '' };
    if (lines.length) gl = await writeClosingEntry(user, companyId, end, lines, 'Year-end closing ' + yearLabel(start), { FinancialYearStart: start });
    const at = new Date().toISOString();
    const updates = {};
    updates['YearsClosed/' + start] = { End: end, JVID: gl.jvId, JVNumber: gl.jvNumber, By: user.uid, ByName: actorName(user), At: at };
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Close year', Month: start, ClosedThrough: state.ClosedThrough || '', Reason: gl.jvNumber ? 'Closing entry ' + gl.jvNumber : 'Nothing to close', By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true, jvNumber: gl.jvNumber, lines: lines.length };
  });
});

exports.reopenFinancialYear = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'reopen');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const start = text(d.year, 7);
  const reason = text(d.reason, 500);
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for reopening.');
  return withGlobalLock(user.uid, async () => {
    const state = await loadState(companyId);
    const y = (state.YearsClosed || {})[start];
    if (!y) throw new HttpsError('failed-precondition', 'That financial year is not closed.');
    if (!yearStatus(state, start).CanReopen) throw new HttpsError('failed-precondition', 'Reopen the later financial year first.');
    let reversal = '';
    if (y.JVID) {
      const ref = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(y.JVID);
      const e = (await ref.get()).data();
      if (e && !e.ReversedByJV) {
        const lines = (e.Lines || []).map(l => Object.assign({}, l, { Debit: l.Credit, Credit: l.Debit, Description: 'Reversal — ' + l.Description }));
        const gl = await writeClosingEntry(user, companyId, e.JVDate, lines, 'Reversal of ' + e.JVNumber + ' — ' + reason, { ReversalOfJV: y.JVID, Reference: e.JVNumber, FinancialYearStart: start });
        await ref.update({ ReversedByJV: gl.jvId, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
        reversal = gl.jvNumber;
      }
    }
    const at = new Date().toISOString();
    const updates = {};
    updates['YearsClosed/' + start] = null;
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Reopen year', Month: start, ClosedThrough: state.ClosedThrough || '', Reason: reason + (reversal ? ' (reversed by ' + reversal + ')' : ''), By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true, reversalNumber: reversal };
  });
});

// ---------- Callables ----------

function view(state, settings, companyId, year, rights, coa) {
  const start = isMonth(year) ? yearStartOf(year, settings.FiscalYearStart) : yearStartOf(today().slice(0, 7), settings.FiscalYearStart);
  const now = today().slice(0, 7);
  const next = state.ClosedThrough ? addMonths(state.ClosedThrough, 1) : '';
  const months = yearMonths(start).map(m => {
    const c = (state.Closed || {})[m];
    const closed = isClosed(state, m);
    return {
      Month: m, Label: monthLabel(m), Status: closed ? 'Closed' : 'Open', By: closed && c ? c.ByName || c.By : '', At: closed && c ? c.At : '',
      WithFirst: closed && !c, // closed with the first close, before it
      Ended: m < now, CanClose: !closed && m < now && (!next || m === next), CanReopen: closed
    };
  });
  const log = Object.values(state.Log || {}).sort((a, b) => String(b.At).localeCompare(String(a.At))).slice(0, 100);
  return {
    CompanyID: companyId, Settings: settings, FiscalYearLocked: Boolean(state.YearsClosed && Object.keys(state.YearsClosed).length),
    Year: Object.assign({ Start: start, Label: yearLabel(start), Prev: addMonths(start, -12), Next: addMonths(start, 12), End: lastDay(addMonths(start, 11)) }, yearStatus(state, start)),
    Months: months, ClosedThrough: state.ClosedThrough || '', FirstClosed: state.FirstClosed || '', NextToClose: next,
    Checklist: CHECKLIST.map(c => ({ key: c.key, label: c.label })), EquityAccounts: equityAccounts(coa, companyId), Accounts: postableAccounts(coa, companyId), Log: log, Rights: rights
  };
}

exports.getPeriodClosing = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const [state, coa, close, reopen] = await Promise.all([loadState(companyId), rtdb.ref('coa').get().then(s => s.val() || {}), can(user, 'close'), can(user, 'reopen')]);
  return view(state, settingsOf(state, coa, companyId), companyId, text(d.year, 7), { close, reopen }, coa);
});

exports.savePeriodClosingSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'close');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const s = d.settings || {};
  const fy = text(s.FiscalYearStart, 3);
  if (!FY_STARTS[fy]) throw new HttpsError('invalid-argument', 'The financial year starts in January or April.');
  const checklist = {};
  CHECKLIST.forEach(c => {
    const m = (s.Checklist || {})[c.key] || DEFAULT_MODE;
    if (!MODES.includes(m)) throw new HttpsError('invalid-argument', c.label + ': choose Block, Warn or Off.');
    checklist[c.key] = m;
  });
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const accounts = new Set(postableAccounts(coa, companyId).map(a => a.ID));
  const zeroIn = asList(s.ZeroAccounts);
  if (zeroIn.length > MAX_ZERO_ACCOUNTS) throw new HttpsError('invalid-argument', 'At most ' + MAX_ZERO_ACCOUNTS + ' accounts that must be zero.');
  const zero = [], seen = new Set();
  zeroIn.forEach(z => {
    const id = text(z && z.AccountID, 80);
    if (!id) return; // an empty row
    if (!accounts.has(id)) throw new HttpsError('invalid-argument', 'Accounts that must be zero: choose postable accounts of this company.');
    if (seen.has(id)) throw new HttpsError('invalid-argument', 'Accounts that must be zero: ' + (coa[id].AccountCode || id) + ' is listed twice.');
    if (!MODES.includes(z.Mode || DEFAULT_MODE)) throw new HttpsError('invalid-argument', 'Account ' + (coa[id].AccountCode || id) + ': choose Block, Warn or Off.');
    seen.add(id); zero.push({ AccountID: id, Mode: z.Mode || DEFAULT_MODE });
  });
  const stepsIn = asList(s.Steps).filter(x => x && text(x.Text));
  if (stepsIn.length > MAX_STEPS) throw new HttpsError('invalid-argument', 'At most ' + MAX_STEPS + ' steps to tick.');
  const steps = stepsIn.map(x => {
    const t = text(x.Text, 150);
    if (!MODES.includes(x.Mode || DEFAULT_MODE)) throw new HttpsError('invalid-argument', 'Step "' + t + '": choose Block, Warn or Off.');
    const id = /^S[0-9a-f]{8}$/.test(x.ID || '') ? x.ID : 'S' + randomUUID().slice(0, 8);
    return { ID: id, Text: t, Mode: x.Mode || DEFAULT_MODE };
  });
  const re = text(s.RetainedEarningsAccountID, 80);
  if (!re) throw new HttpsError('invalid-argument', 'Choose the Retained Earnings account.');
  if (!equityAccounts(coa, companyId).some(a => a.ID === re)) throw new HttpsError('invalid-argument', 'The Retained Earnings account must be an active, postable Equity account of this company.');
  return withGlobalLock(user.uid, async () => {
    const state = await loadState(companyId);
    const before = settingsOf(state, coa, companyId);
    if (fy !== before.FiscalYearStart && state.YearsClosed && Object.keys(state.YearsClosed).length) {
      throw new HttpsError('failed-precondition', 'The financial year can\'t change after the company\'s first year-end close.');
    }
    const at = new Date().toISOString();
    const updates = { Settings: { FiscalYearStart: fy, RetainedEarningsAccountID: re, Checklist: checklist, ZeroAccounts: zero, Steps: steps, UpdatedAt: at, UpdatedBy: user.uid } };
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Setup', Month: '', ClosedThrough: state.ClosedThrough || '', Reason: fy !== before.FiscalYearStart ? 'Financial year starts in ' + fy : '', By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true };
  });
});

exports.getPeriodClosingChecklist = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const [state, coa] = await Promise.all([loadState(companyId), rtdb.ref('coa').get().then(s => s.val() || {})]);
  return runChecklist(companyId, month, state, settingsOf(state, coa, companyId));
});

exports.closePeriod = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'close');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  if (month >= today().slice(0, 7)) throw new HttpsError('failed-precondition', monthLabel(month) + ' has not ended yet.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  return withGlobalLock(user.uid, async () => {
    const state = await loadState(companyId);
    if (isClosed(state, month)) throw new HttpsError('failed-precondition', monthLabel(month) + ' is already closed.');
    if (state.ClosedThrough && month !== addMonths(state.ClosedThrough, 1)) {
      throw new HttpsError('failed-precondition', 'Months close in order: close ' + monthLabel(addMonths(state.ClosedThrough, 1)) + ' first.');
    }
    const settings = settingsOf(state, coa, companyId);
    const list = await runChecklist(companyId, month, state, settings);
    if (list.Blocking) {
      const names = list.Items.filter(i => i.Result === 'Blocks').map(i => i.Label + ' (' + i.Count + ')');
      throw new HttpsError('failed-precondition', monthLabel(month) + ' can\'t be closed: ' + names.join('; ') + '.');
    }
    const at = new Date().toISOString();
    const updates = { ClosedThrough: month };
    if (!state.ClosedThrough) updates.FirstClosed = month;
    updates['Closed/' + month] = { By: user.uid, ByName: actorName(user), At: at, Warnings: list.Items.filter(i => i.Result === 'Warning').map(i => i.Key),
      Steps: list.Items.filter(i => i.Kind === 'step').map(i => ({ Text: i.Label, Ticked: i.Ticked || null })) };
    updates['Ticks/' + month] = null;
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Close', Month: month, ClosedThrough: month, Reason: list.Warnings ? 'Closed with ' + list.Warnings + ' warning(s)' : '', By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true, closedThrough: month, warnings: list.Warnings };
  });
});

// Tick (or untick) a step for a month not yet closed: anyone who may close
// months (decision 159); logged with who and when.
exports.tickPeriodClosingStep = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'close');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  return withGlobalLock(user.uid, async () => {
    const state = await loadState(companyId);
    if (isClosed(state, month)) throw new HttpsError('failed-precondition', monthLabel(month) + ' is closed: its steps can\'t change.');
    const step = settingsOf(state, coa, companyId).Steps.find(x => x.ID === text(d.stepId, 20));
    if (!step) throw new HttpsError('not-found', 'That step is no longer on the checklist.');
    const at = new Date().toISOString(), ticked = d.ticked !== false;
    const updates = {};
    updates['Ticks/' + month + '/' + step.ID] = ticked ? { By: user.uid, ByName: actorName(user), At: at } : null;
    updates['Log/' + rtdb.ref().push().key] = { Action: ticked ? 'Tick' : 'Untick', Month: month, ClosedThrough: state.ClosedThrough || '', Reason: step.Text, By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true };
  });
});

// Reopening a month reopens the later ones too; the months before it stay
// closed (also those closed with the first close).
exports.reopenPeriod = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'reopen');
  const d = request.data || {};
  const companyId = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const reason = text(d.reason, 500);
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for reopening.');
  return withGlobalLock(user.uid, async () => {
    const state = await loadState(companyId);
    if (!isClosed(state, month)) throw new HttpsError('failed-precondition', monthLabel(month) + ' is not closed.');
    // Decision 143: a closed year's months stay closed until the year is reopened
    // (reopening a month reopens the later ones too, so any closed year ending at or after it counts).
    const blocking = Object.keys(state.YearsClosed || {}).sort().find(y => addMonths(y, 11) >= month);
    if (blocking) throw new HttpsError('failed-precondition', 'The financial year ' + yearLabel(blocking) + ' is closed: reopen the year first, then the month.');
    const through = addMonths(month, -1);
    const at = new Date().toISOString();
    const updates = { ClosedThrough: through };
    Object.keys(state.Closed || {}).forEach(m => { if (m > through) updates['Closed/' + m] = null; });
    Object.keys(state.Ticks || {}).forEach(m => { if (m > through) updates['Ticks/' + m] = null; }); // ticked again before closing again
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Reopen', Month: month, ClosedThrough: through, Reason: reason, By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true, closedThrough: through };
  });
});

module.exports.CHECKLIST = CHECKLIST;
module.exports.yearStartOf = yearStartOf;
module.exports.addMonths = addMonths;
