// Opening Balances (owner, 2026-10-02; docs/modules/OPENING_BALANCES.md).
// A company's position on its go-live date, pasted from Excel like Master
// Data Import (copy headers, paste, check, post; all or nothing):
//   - GL:            the trial balance, without the control accounts
//   - Stock:         quantity and unit cost per item and warehouse (and batch)
//   - Open Invoices: each vendor's and customer's unpaid documents and
//                    advances, one row per document
// Every posting is dated on the company's opening date (the day before
// go-live) and posts against one Opening Balance Clearing account (Equity).
// Inventory, Trade Payables and Trade Receivables are never keyed in the GL
// tab: they come from the Stock and Open Invoices tabs, so the sub-ledgers
// and the GL agree by construction, and once everything is in, Clearing
// must be zero.
//
// A paste posts as one batch: GL one entry, Stock one stock transaction
// (and its entry), Open Invoices one entry per party, each document a line
// with a New Ref carrying its own number, date and due date (partyLedger
// shows those instead of the entry's). A batch is corrected by reversing it
// (any time, Admin; owner decision 3) and posting it again. No approval
// (decision 6); base currency only (decision 7).
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const {
  userCanAccessCompany, buildStockGlEntry, generateStockVoucherNumber, transactionRefFor,
  COST_CENTER_REQUIRED_TYPES, FIRESTORE_JOURNAL_ENTRIES_COLLECTION
} = require('./glWriting');
const { computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { PARTY_TYPES, addDays, assertEntryReversible } = require('./partyLedger');
const { allocateAvailableStockToShortfalls } = require('./reservations');
const { withGlobalLock } = require('./lock');
const { parseSheet } = require('./masterImport');

const onCallOptions = { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' };
const MAX_ROWS = 2000;
const SETTINGS = 'openingBalances/settings';
const BATCHES = 'openingBalances/batches';
const GL_TYPE = 'OpeningBalance'; // GL and Open Invoices entries
const STOCK_TYPE = 'OpeningStock'; // the stock transaction and its entry
const round2 = n => Math.round(n * 100) / 100;
const fmt = n => round2(n).toFixed(2);
const norm = v => String(v == null ? '' : v).trim().toUpperCase();
const squash = v => norm(v).replace(/[\s_\-/&]+/g, '');

// ---------- the three kinds and their columns ----------

const C = (h, key, type, extra) => Object.assign({ h, key, type: type || 'text' }, extra || {});
const KINDS = {
  GL: {
    label: 'GL', title: 'GL opening balances',
    note: 'The trial balance on the opening date, one row per account. Inventory, Trade Payables and Trade Receivables are not entered here: they come from the Stock and Open Invoices tabs. The difference between debits and credits goes to the Opening Balance Clearing account.',
    columns: [
      C('Account', 'account', 'text', { req: true, note: 'Account code or exact name.' }),
      C('Debit', 'debit', 'number'),
      C('Credit', 'credit', 'number'),
      C('Description', 'description', 'text', { note: 'Optional; "Opening balance" if blank.' }),
      C('Cost Center', 'costCenter', 'text', { note: 'Code or name. Required for Expense, Revenue and COGS accounts.' }),
      C('Profit Center', 'profitCenter', 'text', { note: 'Code or name. Optional.' })
    ],
    sample: [['1100001', '25000.00', '', 'Bank balance', '', '']]
  },
  STOCK: {
    label: 'Stock', title: 'Opening stock',
    note: 'Stock on hand on the opening date: one row per item and warehouse (or rack), and per batch for batch-tracked items. Quantity in the item\'s base unit; unit cost in base currency. Debits each item\'s Inventory account.',
    columns: [
      C('Item', 'item', 'text', { req: true, note: 'Item code or exact name.' }),
      C('Warehouse', 'warehouse', 'text', { req: true, note: 'Warehouse or rack, code or exact name.' }),
      C('Quantity', 'quantity', 'number', { req: true, note: 'In the item\'s base unit.' }),
      C('Unit Cost', 'unitCost', 'number', { req: true }),
      C('Batch No', 'batch', 'text', { note: 'Required for batch-tracked items.' }),
      C('Expiry Date', 'expiry', 'date', { note: 'dd/mm/yyyy. Optional.' })
    ],
    sample: [['RM-000001', 'WH-01', '120', '15.50', '', '']]
  },
  INVOICES: {
    label: 'Open Invoices', title: 'Open invoices and advances',
    note: 'Each vendor\'s and customer\'s unpaid documents on the opening date, one row per document, with the amount still outstanding. An Advance is money paid to a vendor or received from a customer and not yet settled. Payments are later allocated against these exactly as against any invoice.',
    columns: [
      C('Party Type', 'partyType', 'enum', { req: true, values: [{ value: 'Vendor', label: 'Vendor' }, { value: 'Customer', label: 'Customer' }] }),
      C('Party', 'party', 'text', { req: true, note: 'Vendor or customer code, or exact name.' }),
      C('Document Type', 'docType', 'enum', { req: true, values: [{ value: 'Invoice', label: 'Invoice' }, { value: 'Advance', label: 'Advance' }] }),
      C('Document No', 'docNo', 'text', { req: true, note: 'The original invoice (or receipt) number.' }),
      C('Document Date', 'docDate', 'date', { req: true, note: 'dd/mm/yyyy; on or before the opening date.' }),
      C('Due Date', 'dueDate', 'date', { note: 'dd/mm/yyyy. Blank: document date + the party\'s payment terms.' }),
      C('Amount', 'amount', 'number', { req: true, note: 'Outstanding amount, base currency.' }),
      C('Description', 'description', 'text')
    ],
    sample: [['Vendor', 'V-L-000001', 'Invoice', 'INV-7781', '15/11/2025', '', '4500.00', '']]
  }
};

function numberValue(v) {
  const s = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (s === '') return '';
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
// dd/mm/yyyy (also d/m/yyyy, dd-mm-yyyy, dd.mm.yyyy) or yyyy-mm-dd.
function dateValue(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; } else {
    x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!x) return null;
    d = +x[1]; m = +x[2]; y = +x[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// ---------- reference data ----------

async function loadData() {
  const paths = ['coa', 'items', 'orgUnits', 'vendors', 'customers'];
  const snaps = await Promise.all(paths.map(p => rtdb.ref(p).get()));
  const d = {};
  paths.forEach((p, i) => { d[p] = snaps[i].val() || {}; });
  return d;
}

// One record by code or exact name among those usable in this company
// (the company's own first, then those for all companies).
function findRef(records, raw, codeField, nameField, companyId, filter) {
  const want = norm(raw);
  const list = Object.keys(records).map(id => Object.assign({ _id: id }, records[id]))
    .filter(r => (!r.CompanyID || r.CompanyID === companyId) && (!filter || filter(r)));
  const byCode = list.filter(r => norm(r[codeField]) === want);
  const byName = list.filter(r => norm(r[nameField]) === want);
  const hits = byCode.length ? byCode : byName;
  if (hits.length > 1) {
    const own = hits.filter(r => r.CompanyID === companyId);
    if (own.length === 1) return { hit: own[0] };
    return { ambiguous: true };
  }
  return { hit: hits[0] };
}

// AccountIDs that the GL tab may not post: the control accounts (each
// vendor's payables, each customer's receivables, each item's inventory).
function controlAccounts(d) {
  const out = new Map();
  Object.values(d.vendors).forEach(v => { if (v && v.TradePayablesAccountID) out.set(v.TradePayablesAccountID, 'a vendor\'s Trade Payables account — it comes from the Open Invoices tab'); });
  Object.values(d.customers).forEach(c => { if (c && c.TradeReceivablesAccountID) out.set(c.TradeReceivablesAccountID, 'a customer\'s Trade Receivables account — it comes from the Open Invoices tab'); });
  Object.values(d.items).forEach(i => { if (i && i.InventoryAccountID) out.set(i.InventoryAccountID, 'an item\'s Inventory account — it comes from the Stock tab'); });
  return out;
}

async function getSettings(companyId) {
  return (await rtdb.ref(SETTINGS + '/' + companyId).get()).val() || null;
}

// ---------- check ----------

async function checkPaste(user, kindKey, companyId, text) {
  const k = KINDS[kindKey];
  if (!k) throw new HttpsError('invalid-argument', 'Choose GL, Stock or Open Invoices.');
  const issues = [];
  const add = (row, column, message) => issues.push({ row, column: column || '', message });
  if (!companyId) add(0, 'Company', 'Select a company.');
  else if (!userCanAccessCompany(user.profile, companyId)) add(0, 'Company', 'You do not have access to that company.');
  const settings = companyId ? await getSettings(companyId) : null;
  if (companyId && (!settings || !settings.OpeningDate || !settings.ClearingAccountID)) {
    add(0, 'Setup', 'Set this company\'s opening date and clearing account first (Setup, above).');
  }
  const table = parseSheet(text);
  if (!table.length) return { issues: [{ row: 0, column: '', message: 'Paste the header row and at least one row.' }], rows: [], resolved: [] };
  if (table.length - 1 > MAX_ROWS) add(0, '', 'At most ' + MAX_ROWS + ' rows in one paste.');

  const colAt = {};
  table[0].forEach((h, i) => {
    const col = k.columns.find(c => squash(c.h) === squash(String(h).replace(/\*$/, '')));
    if (!col) add(0, h, 'Unknown column "' + h + '". Copy the headers again from this screen.');
    else if (col.key in colAt) add(0, h, 'Column "' + h + '" appears twice.');
    else colAt[col.key] = i;
  });
  k.columns.filter(c => c.req && !(c.key in colAt)).forEach(c => add(0, c.h, 'Required column "' + c.h + '" is missing.'));
  const body = table.slice(1);
  if (!body.length) add(0, '', 'There are no rows under the headers.');

  const d = await loadData();
  const openingDate = settings ? settings.OpeningDate : '';
  const resolved = [];
  const seen = new Map();
  const existingDocs = kindKey === 'INVOICES' && companyId ? await liveOpeningDocuments(companyId) : new Set();

  body.forEach((cells, idx) => {
    const rowNo = idx + 1;
    const r = {};
    const colOf = key => k.columns.find(c => c.key === key);
    const issue = (key, msg) => add(rowNo, colOf(key).h, msg);
    for (const col of k.columns) {
      const raw = col.key in colAt ? String(cells[colAt[col.key]] == null ? '' : cells[colAt[col.key]]).trim() : '';
      if (col.req && !raw) { issue(col.key, col.h + ' is required.'); r[col.key] = ''; continue; }
      if (col.type === 'number') {
        const v = numberValue(raw); if (v === null) issue(col.key, '"' + raw + '" is not a number.'); r[col.key] = v === null ? '' : v;
      } else if (col.type === 'date') {
        const v = dateValue(raw); if (v === null) issue(col.key, '"' + raw + '" is not a date (dd/mm/yyyy).'); r[col.key] = v || '';
      } else if (col.type === 'enum') {
        const hit = raw ? col.values.find(x => squash(x.value) === squash(raw) || squash(x.label) === squash(raw)) : null;
        if (raw && !hit) issue(col.key, '"' + raw + '" is not one of: ' + col.values.map(x => x.label).join(', ') + '.');
        r[col.key] = hit ? hit.value : '';
      } else {
        r[col.key] = raw;
      }
    }
    if (!companyId) return;
    if (kindKey === 'GL') checkGlRow(r, d, companyId, settings, issue, seen, rowNo);
    if (kindKey === 'STOCK') checkStockRow(r, d, companyId, issue, seen, rowNo);
    if (kindKey === 'INVOICES') checkInvoiceRow(r, d, companyId, openingDate, issue, seen, rowNo, existingDocs);
    resolved.push(Object.assign({ row: rowNo }, r));
  });
  return { issues, resolved, settings, data: d };
}

function checkGlRow(r, d, companyId, settings, issue, seen, rowNo) {
  if (r.account) {
    const f = findRef(d.coa, r.account, 'AccountCode', 'AccountName', companyId);
    const a = f.hit;
    if (f.ambiguous) issue('account', 'More than one account is called "' + r.account + '": use its code.');
    else if (!a) issue('account', 'No account "' + r.account + '" for this company.');
    else if (a.IsPostable !== true) issue('account', a.AccountCode + ' is a header account and cannot be posted to.');
    else if (a.Status !== 'Active') issue('account', a.AccountCode + ' is inactive.');
    else if (settings && a._id === settings.ClearingAccountID) issue('account', a.AccountCode + ' is the Opening Balance Clearing account: the difference goes there by itself.');
    else if (controlAccounts(d).has(a._id)) issue('account', a.AccountCode + ' is ' + controlAccounts(d).get(a._id) + '.');
    else {
      r.accountId = a._id; r.accountCode = String(a.AccountCode); r.accountType = a.AccountType;
      if (seen.has(a._id)) issue('account', a.AccountCode + ' is already on row ' + seen.get(a._id) + ': one row per account.');
      else seen.set(a._id, rowNo);
    }
  }
  const debit = Number(r.debit) || 0, credit = Number(r.credit) || 0;
  if (debit < 0 || credit < 0) issue('debit', 'Amounts cannot be negative.');
  else if (debit > 0 && credit > 0) issue('debit', 'Enter a debit or a credit, not both.');
  else if (!(debit > 0) && !(credit > 0)) issue('debit', 'Enter a debit or a credit.');
  r.debit = round2(Math.max(debit, 0)); r.credit = round2(Math.max(credit, 0));
  r.description = r.description || 'Opening balance';
  const center = (key, type, label) => {
    if (!r[key]) return '';
    const f = findRef(d.orgUnits, r[key], 'Code', 'Name', companyId, u => u.Type === type);
    if (f.ambiguous) { issue(key, 'More than one ' + label + ' is called "' + r[key] + '": use its code.'); return ''; }
    if (!f.hit) { issue(key, 'No ' + label + ' "' + r[key] + '" for this company.'); return ''; }
    return f.hit._id;
  };
  r.costCenterId = center('costCenter', 'CostCenter', 'cost center');
  r.profitCenterId = center('profitCenter', 'ProfitCenter', 'profit center');
  if (r.accountId && COST_CENTER_REQUIRED_TYPES.includes(r.accountType) && !r.costCenterId && !r.costCenter) {
    issue('costCenter', r.accountCode + ' (' + r.accountType + ') needs a Cost Center.');
  }
}

function checkStockRow(r, d, companyId, issue, seen, rowNo) {
  let item = null;
  if (r.item) {
    const f = findRef(d.items, r.item, 'ItemCode', 'ItemName', companyId);
    if (f.ambiguous) issue('item', 'More than one item is called "' + r.item + '": use its code.');
    else if (!f.hit) issue('item', 'No item "' + r.item + '" for this company.');
    else {
      item = f.hit;
      const inv = d.coa[item.InventoryAccountID];
      if (!inv || inv.IsPostable !== true) issue('item', item.ItemCode + ' has no valid Inventory account (Item Master).');
      r.itemId = item._id; r.itemCode = item.ItemCode; r.itemName = item.ItemName || '';
    }
  }
  if (r.warehouse) {
    const f = findRef(d.orgUnits, r.warehouse, 'Code', 'Name', companyId, u => u.Type === 'Warehouse' || u.Type === 'Rack');
    if (f.ambiguous) issue('warehouse', 'More than one warehouse is called "' + r.warehouse + '": use its code.');
    else if (!f.hit) issue('warehouse', 'No warehouse or rack "' + r.warehouse + '" for this company.');
    else r.warehouseId = f.hit._id;
  }
  if (r.quantity !== '' && !(Number(r.quantity) > 0)) issue('quantity', 'Quantity must be greater than zero.');
  if (r.unitCost !== '' && !(Number(r.unitCost) > 0)) issue('unitCost', 'Unit cost must be greater than zero.');
  if (item && item.BatchTracked && !r.batch) issue('batch', item.ItemCode + ' is batch-tracked: enter its batch number (a row per batch).');
  if (r.itemId && r.warehouseId) {
    const key = r.itemId + '|' + r.warehouseId + '|' + norm(r.batch);
    if (seen.has(key)) issue('item', 'Same item, warehouse and batch as row ' + seen.get(key) + '.');
    else seen.set(key, rowNo);
  }
}

function checkInvoiceRow(r, d, companyId, openingDate, issue, seen, rowNo, existingDocs) {
  const cfg = PARTY_TYPES[r.partyType];
  if (cfg && r.party) {
    const f = findRef(r.partyType === 'Vendor' ? d.vendors : d.customers, r.party, cfg.codeField, cfg.nameField, companyId);
    if (f.ambiguous) issue('party', 'More than one ' + r.partyType.toLowerCase() + ' is called "' + r.party + '": use its code.');
    else if (!f.hit) issue('party', 'No ' + r.partyType.toLowerCase() + ' "' + r.party + '" for this company.');
    else {
      const p = f.hit;
      const acc = d.coa[p[cfg.accountField]];
      if (!acc || acc.IsPostable !== true) issue('party', (p[cfg.nameField] || p[cfg.codeField]) + ' has no valid ' + cfg.accountLabel + ' account (' + r.partyType + ' Master).');
      else {
        r.partyId = p._id; r.partyName = p[cfg.nameField] || p[cfg.codeField] || '';
        r.accountCode = String(acc.AccountCode); r.paymentTerms = Number(p.PaymentTermsDays) || 0;
      }
    }
  }
  if (r.amount !== '' && !(Number(r.amount) > 0)) issue('amount', 'Amount must be greater than zero.');
  if (r.docDate && openingDate && r.docDate > openingDate) issue('docDate', 'The document date is after the opening date (' + openingDate + ').');
  if (r.dueDate && r.docDate && r.dueDate < r.docDate) issue('dueDate', 'The due date is before the document date.');
  if (r.partyId && r.docNo) {
    const key = r.partyType + ':' + r.partyId + '|' + norm(r.docNo);
    if (seen.has(key)) issue('docNo', 'Document ' + r.docNo + ' of ' + r.partyName + ' is already on row ' + seen.get(key) + '.');
    else if (existingDocs.has(key)) issue('docNo', 'Document ' + r.docNo + ' of ' + r.partyName + ' is already in an opening batch.');
    else seen.set(key, rowNo);
  }
  if (r.docDate && !r.dueDate) r.dueDate = addDays(r.docDate, r.paymentTerms || 0);
}

// Documents already in a live opening batch of this company.
async function liveOpeningDocuments(companyId) {
  const out = new Set();
  (await openingEntries(companyId)).filter(e => e.Status === 'Posted' && !e.ReversedByJV && !e.ReversalOfJV).forEach(e => {
    (e.Lines || []).forEach(l => (l.Allocations || []).forEach(a => {
      if (a.DocumentNo) out.add(l.PartyType + ':' + l.PartyID + '|' + norm(a.DocumentNo));
    }));
  });
  return out;
}

async function openingEntries(companyId) {
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('OpeningCompanyID', '==', companyId).get();
  return snap.docs.map(doc => Object.assign({ _id: doc.id }, doc.data()));
}

// ---------- post ----------

function clearingLine(account, net, description) {
  // net > 0: the batch's other lines are net debit, so Clearing is credited.
  return { AccountCode: String(account.AccountCode), Debit: net < 0 ? round2(-net) : 0, Credit: net > 0 ? round2(net) : 0, Description: description };
}

async function postGl(user, companyId, settings, rows, d, batchId) {
  const lines = rows.map(r => ({
    AccountCode: r.accountCode, Debit: r.debit, Credit: r.credit, Description: r.description,
    CostCenterID: r.costCenterId || '', ProfitCenterID: r.profitCenterId || ''
  }));
  const net = round2(rows.reduce((s, r) => s + r.debit - r.credit, 0));
  if (Math.abs(net) >= 0.005) lines.push(clearingLine(d.coa[settings.ClearingAccountID], net, 'Opening balances — difference to clearing'));
  const built = await buildStockGlEntry(user, GL_TYPE, settings.OpeningDate, 'Opening balances — GL', '', lines,
    { CompanyID: companyId }, { OpeningBatchID: batchId, OpeningCompanyID: companyId, OpeningKind: 'GL' });
  await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId).set(built.record);
  return { jvIds: [built.jvId], jvNumbers: [built.jvNumber], total: built.record.TotalDebit };
}

async function postStock(user, companyId, settings, rows, d, batchId) {
  const actor = user.profile.username || user.uid;
  const now = new Date().toISOString();
  const lines = rows.map((r, i) => ({
    LineNo: i + 1, ItemID: r.itemId, ItemCode: r.itemCode, ItemName: r.itemName, WarehouseID: r.warehouseId,
    Quantity: Math.round(Number(r.quantity) * 1e6) / 1e6, EnteredQuantity: Number(r.quantity), UnitCost: Math.round(Number(r.unitCost) * 10000) / 10000,
    BatchNumber: r.batch || '', ExpiryDate: r.expiry || '', Description: 'Opening stock', Direction: 'In'
  }));
  const movement = await computeStockMovement(d.items, d.coa, lines);
  const total = round2(lines.reduce((s, l) => s + l.TotalValue, 0));
  const txId = 'OPST-' + randomUUID().split('-')[0].toUpperCase();
  const attemptId = randomUUID();
  await rtdb.ref('stock/transactions/' + txId).set({
    TransactionType: STOCK_TYPE, Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
    TransactionDate: settings.OpeningDate, Description: 'Opening stock', Reference: '', CompanyID: companyId,
    DivisionID: '', BranchID: '', CostCenterID: '', ProfitCenterID: '', Lines: lines, OpeningBatchID: batchId,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
  });
  let built;
  try {
    built = await buildStockGlEntry(user, STOCK_TYPE, settings.OpeningDate, 'Opening stock', '',
      movement.inventoryGlLines.concat([clearingLine(d.coa[settings.ClearingAccountID], total, 'Opening stock')]),
      { CompanyID: companyId },
      { CommitAttemptID: attemptId, SourceTransactionID: txId, OpeningBatchID: batchId, OpeningCompanyID: companyId, OpeningKind: 'STOCK' });
    await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId).set(built.record);
  } catch (err) {
    await rtdb.ref('stock/transactions/' + txId).set(null);
    throw err;
  }
  // A GL entry exists from here on.
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  await rtdb.ref('stock/transactions/' + txId).update({
    Status: 'Posted', TransactionNumber: built.jvNumber, TransactionRef: built.transactionRef, LinkedJVID: built.jvId,
    CommitAttemptID: '', CommitAttemptStartedAt: '', PostedAt: now, PostedBy: actor
  });
  for (const l of lines) {
    await allocateAvailableStockToShortfalls(actor, l.ItemID, l.ItemCode, l.WarehouseID, companyId, l.Quantity, built.jvNumber);
  }
  return { jvIds: [built.jvId], jvNumbers: [built.jvNumber], stockTransactionId: txId, total };
}

// One entry per party; each document a line with a New Ref.
async function postInvoices(user, companyId, settings, rows, d, batchId) {
  const byParty = new Map();
  rows.forEach(r => {
    const key = r.partyType + ':' + r.partyId;
    if (!byParty.has(key)) byParty.set(key, []);
    byParty.get(key).push(r);
  });
  const clearing = d.coa[settings.ClearingAccountID];
  const built = [];
  for (const [key, list] of byParty) {
    const first = list[0];
    // A vendor's invoice is a credit on Payables, its advance a debit; a
    // customer's the other way round.
    const grows = PARTY_TYPES[first.partyType].invoiceSide;
    const lines = list.map(r => {
      const side = r.docType === 'Invoice' ? grows : (grows === 'Dr' ? 'Cr' : 'Dr');
      const amount = round2(Number(r.amount));
      return {
        AccountCode: r.accountCode, Debit: side === 'Dr' ? amount : 0, Credit: side === 'Cr' ? amount : 0,
        Description: r.description || ('Opening ' + r.docType.toLowerCase() + ' ' + r.docNo),
        PartyType: r.partyType, PartyID: r.partyId, PartyName: r.partyName,
        Allocations: [{ RefType: 'New', RefID: '', Amount: amount, DocumentType: r.docType, DocumentNo: r.docNo, DocumentDate: r.docDate, DueDate: r.dueDate }]
      };
    });
    const net = round2(lines.reduce((s, l) => s + l.Debit - l.Credit, 0));
    if (Math.abs(net) >= 0.005) lines.push(clearingLine(clearing, net, 'Opening balances — ' + first.partyName));
    built.push(await buildStockGlEntry(user, GL_TYPE, settings.OpeningDate, 'Opening balances — ' + first.partyType + ' ' + first.partyName, '', lines,
      { CompanyID: companyId },
      { OpeningBatchID: batchId, OpeningCompanyID: companyId, OpeningKind: 'INVOICES', PartyKeys: [key], AllocatedRefs: [], AllocatedRefTypes: [] }));
  }
  // All the entries in one atomic write when they fit; larger pastes go in
  // chunks, and a failed chunk removes the ones already written.
  const written = [];
  try {
    for (let i = 0; i < built.length; i += 450) {
      const batch = firestore.batch();
      built.slice(i, i + 450).forEach(b => batch.set(firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(b.jvId), b.record));
      await batch.commit();
      written.push(...built.slice(i, i + 450));
    }
  } catch (err) {
    for (const b of written) await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(b.jvId).delete();
    throw err;
  }
  return {
    jvIds: built.map(b => b.jvId), jvNumbers: built.map(b => b.jvNumber),
    total: round2(rows.reduce((s, r) => s + Number(r.amount), 0)), parties: built.length
  };
}

// ---------- reverse ----------

// The mirror image of an opening entry, dated as the original. Party tags
// stay (for statements); the reversal allocates nothing (as JV reversal).
async function reverseEntry(user, jvId, entry, extra) {
  // Dated as the original: refused while its month is closed (docs/modules/PERIOD_CLOSING.md, step 1b).
  await require('./periodLock').assertOpen(entry.CompanyID, entry.JVDate, 'Opening balances');
  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const year = (new Date(entry.JVDate)).getFullYear() || new Date().getFullYear();
  const prefix = entry.VoucherType === STOCK_TYPE ? 'OS' : 'OB';
  const jvNumber = await generateStockVoucherNumber(prefix, year, entry.CompanyID);
  const transactionRef = await transactionRefFor(entry.VoucherType); // GL: TXN-, stock: STK- (docs/modules/GL_REFERENCES.md)
  const newId = 'STKJV-' + randomUUID().split('-')[0].toUpperCase();
  const lines = (entry.Lines || []).map(line => {
    const l = Object.assign({}, line, { Debit: line.Credit, Credit: line.Debit }, require('./fx').mirrorFc(line)); // foreign amounts swap too
    delete l.Allocations;
    return l;
  });
  const record = Object.assign({
    JVNumber: jvNumber, TransactionRef: transactionRef, JVDate: entry.JVDate,
    Description: 'Reversal of ' + entry.JVNumber + ' — ' + entry.Description, Reference: entry.JVNumber,
    Status: 'Posted', Lines: lines, TotalDebit: entry.TotalCredit, TotalCredit: entry.TotalDebit,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor, PostedAt: now, PostedBy: actor,
    ReversedByJV: '', ReversalOfJV: jvId, VoucherType: entry.VoucherType, SelectedAccountCode: '',
    CurrencyCode: entry.CurrencyCode || '', CompanyID: entry.CompanyID, DivisionID: '', BranchID: '', CostCenterID: '', ProfitCenterID: '',
    PartyKeys: entry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [],
    OpeningBatchID: entry.OpeningBatchID, OpeningCompanyID: entry.OpeningCompanyID, OpeningKind: entry.OpeningKind
  }, extra || {});
  return { newId, jvNumber, record };
}

async function reverseBatch(user, batchId) {
  const batch = (await rtdb.ref(BATCHES + '/' + batchId).get()).val();
  if (!batch) throw new HttpsError('not-found', 'Opening batch not found.');
  if (!userCanAccessCompany(user.profile, batch.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (batch.Status !== 'Posted') throw new HttpsError('failed-precondition', 'This batch has already been reversed.');
  const col = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION);
  const entries = [];
  for (const id of batch.JVIDs || []) {
    const snap = await col.doc(id).get();
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Entry ' + id + ' of this batch no longer exists (cleared by Data Reset?).');
    entries.push({ id, entry: snap.data() });
  }
  // An open document someone has already paid can't be taken back.
  for (const { id, entry } of entries) await assertEntryReversible(id, entry);

  const actor = user.profile.username || user.uid;
  const now = new Date().toISOString();
  const reversals = [];
  let stockReversalId = '';
  if (batch.Kind === 'STOCK') {
    const tx = (await rtdb.ref('stock/transactions/' + batch.StockTransactionID).get()).val();
    if (!tx) throw new HttpsError('failed-precondition', 'The stock transaction of this batch no longer exists.');
    const d = await loadData();
    // Out at the batch's own cost (stockMovement AtCost), so the cost is as
    // if it had never been posted and Clearing goes back exactly.
    const outLines = tx.Lines.map(l => Object.assign({}, l, { Direction: 'Out', AtCost: true, Description: 'Reversal of opening stock' }));
    let movement;
    try {
      movement = await computeStockMovement(d.items, d.coa, outLines);
    } catch (e) {
      throw new HttpsError('failed-precondition', 'The opening stock cannot be taken back: ' + e.message.replace(/^Line \d+: /, '') + ' Reverse what used it first.');
    }
    const total = round2(outLines.reduce((s, l) => s + l.TotalValue, 0));
    const settings = await getSettings(batch.CompanyID);
    stockReversalId = 'OPST-' + randomUUID().split('-')[0].toUpperCase();
    const built = await buildStockGlEntry(user, STOCK_TYPE, tx.TransactionDate, 'Reversal of ' + tx.TransactionNumber + ' — Opening stock', tx.TransactionNumber,
      movement.inventoryGlLines.concat([clearingLine(d.coa[settings.ClearingAccountID], -total, 'Reversal of opening stock')]),
      { CompanyID: batch.CompanyID },
      { SourceTransactionID: stockReversalId, ReversalOfJV: entries[0].id, OpeningBatchID: batchId, OpeningCompanyID: batch.CompanyID, OpeningKind: 'STOCK' });
    await rtdb.ref('stock/transactions/' + stockReversalId).set({
      TransactionType: STOCK_TYPE, Status: 'Posted', TransactionDate: tx.TransactionDate, CompanyID: batch.CompanyID,
      Description: 'Reversal of ' + tx.TransactionNumber + ' — Opening stock', Reference: tx.TransactionNumber,
      DivisionID: '', BranchID: '', CostCenterID: '', ProfitCenterID: '', Lines: outLines,
      TransactionNumber: built.jvNumber, TransactionRef: built.transactionRef, LinkedJVID: built.jvId,
      ReversalOfTransaction: batch.StockTransactionID, OpeningBatchID: batchId,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor, PostedAt: now, PostedBy: actor
    });
    await col.doc(built.jvId).set(built.record);
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await rtdb.ref('stock/transactions/' + batch.StockTransactionID).update({ ReversedByTransaction: stockReversalId, UpdatedAt: now, UpdatedBy: actor });
    await col.doc(entries[0].id).update({ ReversedByJV: built.jvId });
    reversals.push({ newId: built.jvId, jvNumber: built.jvNumber });
  } else {
    for (const { id, entry } of entries) reversals.push(Object.assign(await reverseEntry(user, id, entry), { of: id }));
    const fb = firestore.batch();
    reversals.forEach(r => { fb.set(col.doc(r.newId), r.record); fb.update(col.doc(r.of), { ReversedByJV: r.newId }); });
    await fb.commit();
  }
  await rtdb.ref(BATCHES + '/' + batchId).update({
    Status: 'Reversed', ReversedAt: now, ReversedBy: actor, ReversalJVIDs: reversals.map(r => r.newId),
    ReversalJVNumbers: reversals.map(r => r.jvNumber), StockReversalID: stockReversalId
  });
  return { success: true, reversalNumbers: reversals.map(r => r.jvNumber) };
}

// ---------- status ----------

async function status(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const settings = await getSettings(companyId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const batches = Object.entries((await rtdb.ref(BATCHES).get()).val() || {})
    .filter(([, b]) => b.CompanyID === companyId)
    .map(([id, b]) => Object.assign({ BatchID: id }, b))
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
  const clearingId = settings && settings.ClearingAccountID;
  const byKind = { GL: 0, STOCK: 0, INVOICES: 0 };
  let clearing = 0;
  if (clearingId) {
    (await openingEntries(companyId)).filter(e => e.Status === 'Posted').forEach(e => (e.Lines || []).forEach(l => {
      if (l.AccountID !== clearingId) return;
      const net = (Number(l.Debit) || 0) - (Number(l.Credit) || 0);
      clearing += net;
      if (e.OpeningKind in byKind) byKind[e.OpeningKind] += net;
    }));
  }
  const account = clearingId ? coa[clearingId] : null;
  return {
    settings: settings ? {
      OpeningDate: settings.OpeningDate || '', ClearingAccountID: clearingId || '',
      ClearingAccountLabel: account ? account.AccountCode + ' — ' + account.AccountName : ''
    } : null,
    clearing: { balance: round2(clearing), GL: round2(byKind.GL), STOCK: round2(byKind.STOCK), INVOICES: round2(byKind.INVOICES) },
    liveBatches: batches.filter(b => b.Status === 'Posted').length,
    batches
  };
}

// Equity accounts usable as the clearing account in this company.
function clearingCandidates(coa, companyId) {
  return Object.keys(coa).map(id => Object.assign({ AccountID: id }, coa[id]))
    .filter(a => a.AccountType === 'Equity' && a.IsPostable === true && a.Status === 'Active' && (!a.CompanyID || a.CompanyID === companyId))
    .map(a => ({ AccountID: a.AccountID, Label: a.AccountCode + ' — ' + a.AccountName }))
    .sort((a, b) => a.Label.localeCompare(b.Label, undefined, { numeric: true }));
}

// ---------- callables ----------

async function requireAccess(user) {
  if (!(await moduleHasCapability('OPENINGBALANCES', 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to Opening Balances.');
  }
}

exports.getOpeningBalanceSetup = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const companyId = String((request.data || {}).companyId || '').trim();
  const out = await status(user, companyId);
  out.clearingAccounts = clearingCandidates((await rtdb.ref('coa').get()).val() || {}, companyId);
  out.kinds = Object.keys(KINDS).map(key => ({
    key, label: KINDS[key].label, title: KINDS[key].title, note: KINDS[key].note, sample: KINDS[key].sample,
    columns: KINDS[key].columns.map(c => ({ header: c.h, required: Boolean(c.req), note: c.note || '', values: c.values ? c.values.map(v => v.label) : [] }))
  }));
  return out;
});

// The opening date and clearing account; fixed while a batch is live.
exports.saveOpeningBalanceSettings = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  const openingDate = dateValue(d.openingDate);
  const clearingId = String(d.clearingAccountId || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!openingDate) throw new HttpsError('invalid-argument', 'Enter the opening date (the day before go-live).');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  if (!clearingCandidates(coa, companyId).some(a => a.AccountID === clearingId)) {
    throw new HttpsError('invalid-argument', 'Choose an active, postable Equity account as the Opening Balance Clearing account.');
  }
  return withGlobalLock(user.uid, async () => {
    const current = await getSettings(companyId);
    const s = await status(user, companyId);
    if (current && s.liveBatches && (current.OpeningDate !== openingDate || current.ClearingAccountID !== clearingId)) {
      throw new HttpsError('failed-precondition', 'Opening batches are posted for this company: reverse them before changing the opening date or the clearing account.');
    }
    await rtdb.ref(SETTINGS + '/' + companyId).set({
      OpeningDate: openingDate, ClearingAccountID: clearingId,
      UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    });
    return { success: true };
  });
});

// Checks a paste (nothing is written).
exports.checkOpeningBalances = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const d = request.data || {};
  const c = await checkPaste(user, String(d.kind || ''), String(d.companyId || '').trim(), d.text);
  return { issues: c.issues, rows: c.resolved.length, summary: summarize(String(d.kind || ''), c.resolved) };
});

function summarize(kind, rows) {
  if (kind === 'GL') {
    const dr = round2(rows.reduce((s, r) => s + (Number(r.debit) || 0), 0)), cr = round2(rows.reduce((s, r) => s + (Number(r.credit) || 0), 0));
    return 'Debits ' + fmt(dr) + ', credits ' + fmt(cr) + (Math.abs(dr - cr) >= 0.005 ? '; ' + fmt(Math.abs(dr - cr)) + ' to clearing (' + (dr > cr ? 'credit' : 'debit') + ')' : '; balanced') + '.';
  }
  if (kind === 'STOCK') return 'Stock value ' + fmt(rows.reduce((s, r) => s + round2((Number(r.quantity) || 0) * (Number(r.unitCost) || 0)), 0)) + '.';
  if (kind === 'INVOICES') {
    const parties = new Set(rows.map(r => r.partyType + ':' + r.partyId)).size;
    return rows.length + ' documents of ' + parties + ' parties, ' + fmt(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)) + ' in total.';
  }
  return '';
}

// Checks again under the lock, then posts the batch.
exports.postOpeningBalances = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const d = request.data || {};
  const kind = String(d.kind || '');
  const companyId = String(d.companyId || '').trim();
  return withGlobalLock(user.uid, async () => {
    const c = await checkPaste(user, kind, companyId, d.text);
    if (c.issues.length) return { success: false, issues: c.issues };
    const batchId = 'OPB-' + randomUUID().split('-')[0].toUpperCase();
    const fn = { GL: postGl, STOCK: postStock, INVOICES: postInvoices }[kind];
    const r = await fn(user, companyId, c.settings, c.resolved, c.data, batchId);
    await rtdb.ref(BATCHES + '/' + batchId).set({
      CompanyID: companyId, Kind: kind, OpeningDate: c.settings.OpeningDate, Rows: c.resolved.length, Total: r.total,
      JVIDs: r.jvIds, JVNumbers: r.jvNumbers, StockTransactionID: r.stockTransactionId || '', Status: 'Posted',
      CreatedAt: new Date().toISOString(), CreatedBy: user.profile.username || user.uid
    });
    return { success: true, batchId, rows: c.resolved.length, numbers: r.jvNumbers, total: r.total };
  });
});

exports.reverseOpeningBalanceBatch = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const batchId = String((request.data || {}).batchId || '').trim();
  return withGlobalLock(user.uid, () => reverseBatch(user, batchId));
});

// The batch behind an opening journal or its reversal (docs/modules/
// GL_REFERENCES.md): the GL report opens it here.
exports.findOpeningBatch = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const jvId = String((request.data || {}).jvId || '').trim();
  const hit = Object.entries((await rtdb.ref(BATCHES).get()).val() || {})
    .find(([, b]) => (b.JVIDs || []).includes(jvId) || (b.ReversalJVIDs || []).includes(jvId));
  if (!hit) throw new HttpsError('not-found', 'That journal was not posted by an opening balance batch.');
  if (!userCanAccessCompany(user.profile, hit[1].CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return { CompanyID: hit[1].CompanyID, BatchID: hit[0] };
});

module.exports.KINDS = KINDS;
