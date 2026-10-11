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
//               Checklist: { key: 'Block' | 'Warn' | 'Off' } (decision 128) }
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
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
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
  { key: 'receivables', label: 'Customer Aging agrees with the receivables accounts' },
  { key: 'payables', label: 'Vendor Aging agrees with the payables accounts' },
  { key: 'stock', label: 'Stock value agrees with the inventory accounts' },
  { key: 'trialBalance', label: 'The Trial Balance balances' }
];
const DEFAULT_MODE = 'Warn';

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

function settingsOf(state, coa, companyId) {
  const s = state.Settings || {};
  const checklist = {};
  CHECKLIST.forEach(c => { checklist[c.key] = MODES.includes((s.Checklist || {})[c.key]) ? s.Checklist[c.key] : DEFAULT_MODE; });
  let re = s.RetainedEarningsAccountID || '';
  if (!re) { // the default chart's Retained Earnings, until one is chosen
    const hit = equityAccounts(coa, companyId).find(a => a.Code === '310000');
    re = hit ? hit.ID : '';
  }
  return { FiscalYearStart: FY_STARTS[s.FiscalYearStart] ? s.FiscalYearStart : 'Jan', RetainedEarningsAccountID: re, Checklist: checklist, Saved: Boolean(state.Settings) };
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
    rtdb.ref('stock/transactions').get(), rtdb.ref('vendorInvoices').get(), rtdb.ref('customerInvoices').get(), rtdb.ref('pdcCheques').get(),
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
  const all = (await rtdb.ref('pdcCheques').get()).val() || {};
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
  const [docs, rec, dep, pay, pdc, ar, ap, stock, tb] = await Promise.all([
    need('drafts') || need('approvals') ? unfinishedDocuments(companyId, from, to) : { drafts: [], approvals: [] },
    need('recurring') ? recurringDue(companyId, from, to) : [],
    need('depreciation') ? depreciationMissing(companyId, month) : [],
    need('payroll') ? payrollMissing(companyId, month) : [],
    need('pdc') ? pdcsMatured(companyId, month) : [],
    need('receivables') ? partyControl('Customer', companyId, month) : null,
    need('payables') ? partyControl('Vendor', companyId, month) : null,
    need('stock') ? stockControl(companyId, month) : null,
    need('trialBalance') ? trialBalance(companyId, month) : null
  ]);
  const found = {
    drafts: { findings: docs.drafts }, approvals: { findings: docs.approvals }, recurring: { findings: rec }, depreciation: { findings: dep },
    payroll: { findings: pay }, pdc: { findings: pdc }, receivables: ar, payables: ap, stock, trialBalance: tb
  };
  const items = CHECKLIST.map(c => {
    const f = mode(c.key) === 'Off' ? null : found[c.key];
    const findings = f ? f.findings : [];
    return { Key: c.key, Label: c.label, Mode: mode(c.key), Findings: findings.slice(0, 200), Count: findings.length, Note: (f && f.note) || '',
      Result: mode(c.key) === 'Off' ? 'Off' : (findings.length ? (mode(c.key) === 'Block' ? 'Blocks' : 'Warning') : 'OK') };
  });
  return { Month: month, From: from, To: to, Items: items, Blocking: items.filter(i => i.Result === 'Blocks').length, Warnings: items.filter(i => i.Result === 'Warning').length };
}

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
    Year: { Start: start, Label: yearLabel(start), Prev: addMonths(start, -12), Next: addMonths(start, 12) },
    Months: months, ClosedThrough: state.ClosedThrough || '', FirstClosed: state.FirstClosed || '', NextToClose: next,
    Checklist: CHECKLIST.map(c => ({ key: c.key, label: c.label })), EquityAccounts: equityAccounts(coa, companyId), Log: log, Rights: rights
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
    const updates = { Settings: { FiscalYearStart: fy, RetainedEarningsAccountID: re, Checklist: checklist, UpdatedAt: at, UpdatedBy: user.uid } };
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
    updates['Closed/' + month] = { By: user.uid, ByName: actorName(user), At: at, Warnings: list.Items.filter(i => i.Result === 'Warning').map(i => i.Key) };
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Close', Month: month, ClosedThrough: month, Reason: list.Warnings ? 'Closed with ' + list.Warnings + ' warning(s)' : '', By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true, closedThrough: month, warnings: list.Warnings };
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
    const through = addMonths(month, -1);
    const at = new Date().toISOString();
    const updates = { ClosedThrough: through };
    Object.keys(state.Closed || {}).forEach(m => { if (m > through) updates['Closed/' + m] = null; });
    updates['Log/' + rtdb.ref().push().key] = { Action: 'Reopen', Month: month, ClosedThrough: through, Reason: reason, By: user.uid, ByName: actorName(user), At: at };
    await rtdb.ref(PATH + '/' + companyId).update(updates);
    return { success: true, closedThrough: through };
  });
});

module.exports.CHECKLIST = CHECKLIST;
module.exports.yearStartOf = yearStartOf;
module.exports.addMonths = addMonths;
