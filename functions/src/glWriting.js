const { randomUUID } = require('crypto');
const { rtdb, firestore } = require('./firebaseAdmin');
const { getUserAssignedCompanies } = require('./companies');
const { clubGlLines } = require('./lineClubbing');

// Extracted verbatim from Code.gs.
const FIRESTORE_JOURNAL_ENTRIES_COLLECTION = 'journalEntries';
const COST_CENTER_REQUIRED_TYPES = ['Expense', 'Revenue', 'COGS'];
const STOCK_TRANSACTION_PREFIXES = {
  GRN: 'GRN', MaterialIssue: 'MI', Production: 'PRD', WarehouseMovement: 'WM',
  StockAdjustment: 'ADJ', PhysicalCount: 'PC', VendorInvoice: 'VINV',
  DeliveryNote: 'DN', CustomerInvoice: 'CINV',
  PurchaseReturn: 'DBN', // hand-written module, docs/modules/PURCHASE_RETURN.md
  SalesReturn: 'CRN', // hand-written module, docs/modules/SALES_RETURN.md
  // hand-written module, docs/modules/PDC.md: receipt/issue and clearing
  PDCReceived: 'PDR', PDCReceivedClear: 'PDRC', PDCIssued: 'PDI', PDCIssuedClear: 'PDIC',
  // hand-written module, docs/modules/FIXED_ASSETS.md: capitalization,
  // scheduled and additional depreciation (GL); take-over (number only)
  FACapitalization: 'FAA', FADepreciation: 'FAD', FAAdditionalDepreciation: 'FAU', FATakeOver: 'FAO',
  FARetirement: 'FAR', // phase 2: sale / scrapping
  FAAuCCost: 'FAA', FAAuCSettlement: 'FAS', // Capital Work in Progress: cost in, settlement out
  RecurringJV: 'RJV', // hand-written module, docs/modules/RECURRING_JOURNAL.md: a run and its reversal
  // hand-written module, docs/modules/OPENING_BALANCES.md: GL and open invoices; opening stock
  OpeningBalance: 'OB', OpeningStock: 'OS',
  Payroll: 'PAY', // hand-written module, docs/modules/HR_PAYROLL.md: a run and its reversal
  PayrollPayment: 'PAYP', // its payment (step 4) and that payment's reversal
  PayrollLoan: 'PLN', // a loan's payout and repayments (step 4b)
  PayrollProvision: 'PPR' // an accrual's claim (step 5a)
};

function userCanAccessCompany(profile, companyId) {
  if (!companyId) return true;
  return getUserAssignedCompanies(profile).includes(companyId);
}

function parseAmountServer(value) {
  const num = parseFloat(String(value == null ? '' : value).replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

// Ported from validateAndNormalizeLines_.
function validateAndNormalizeLines(rawLines, coaData, entryCompanyId) {
  const accountList = Object.keys(coaData).map(id => Object.assign({ AccountID: id }, coaData[id]));
  const lines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  (rawLines || []).forEach((line, idx) => {
    const accountCode = String(line.AccountCode || '').trim();
    if (!accountCode) return;

    const account = accountList.find(a => String(a.AccountCode) === accountCode);
    if (!account) throw new Error('Line ' + (idx + 1) + ': account code "' + accountCode + '" not found.');
    if (account.Status !== 'Active') throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' is inactive.');
    if (account.IsPostable !== true) throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' is a header account and cannot be posted to.');
    if (account.CompanyID && account.CompanyID !== (entryCompanyId || '')) {
      throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' is restricted to a specific company — select that company for this entry.');
    }

    const debit = parseAmountServer(line.Debit);
    const credit = parseAmountServer(line.Credit);

    if (debit < 0 || credit < 0) throw new Error('Line ' + (idx + 1) + ': amounts cannot be negative.');
    if (debit > 0 && credit > 0) throw new Error('Line ' + (idx + 1) + ': enter either a debit or a credit, not both.');
    if (debit === 0 && credit === 0) throw new Error('Line ' + (idx + 1) + ': enter a debit or credit amount.');

    const description = String(line.Description || '').trim();
    if (!description) throw new Error('Line ' + (idx + 1) + ': description is required.');

    const costCenterId = String(line.CostCenterID || '').trim();
    if (COST_CENTER_REQUIRED_TYPES.includes(account.AccountType) && !costCenterId) {
      throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' (' + account.AccountType + ') requires a Cost Center.');
    }

    totalDebit += debit;
    totalCredit += credit;

    lines.push({
      LineNo: lines.length + 1, AccountID: account.AccountID, AccountCode: account.AccountCode,
      AccountName: account.AccountName, Description: description,
      Debit: Math.round(debit * 100) / 100, Credit: Math.round(credit * 100) / 100,
      CostCenterID: costCenterId, ProfitCenterID: String(line.ProfitCenterID || '')
    });
  });

  return { lines: lines, totalDebit: Math.round(totalDebit * 100) / 100, totalCredit: Math.round(totalCredit * 100) / 100 };
}

// Ported from ensureCompanyRefCodesSeeded_ + getCompanyRefCode_.
async function getCompanyRefCode(companyId) {
  const snap = await rtdb.ref('companies').get();
  const companies = snap.val() || {};

  const used = new Set(Object.values(companies).map(c => c.CompanyRefCode).filter(Boolean));
  const missingIds = Object.keys(companies)
    .filter(id => !companies[id].CompanyRefCode)
    .sort((a, b) => String(companies[a].CreatedAt || '').localeCompare(String(companies[b].CreatedAt || '')));

  const updates = {};
  let next = 1;
  missingIds.forEach(id => {
    while (used.has(String(next).padStart(2, '0'))) next++;
    const code = String(next).padStart(2, '0');
    used.add(code);
    companies[id].CompanyRefCode = code;
    updates[id + '/CompanyRefCode'] = code;
    next++;
  });
  if (Object.keys(updates).length) {
    await rtdb.ref('companies').update(updates);
  }

  const company = companies[companyId];
  if (!company) throw new Error('Company not found for voucher numbering.');
  return company.CompanyRefCode;
}

// Ported from generateStockVoucherNumber_/generateStockTransactionRef_.
// MUST be called while the caller already holds the global lock (see
// lock.js) — no internal locking here, same contract the original had
// with LockService.getScriptLock(), just backed by a different
// mechanism now.
async function generateStockVoucherNumber(prefix, year, companyId) {
  const companyRefCode = await getCompanyRefCode(companyId);
  const yy = String(year).slice(-2);
  const counterPath = 'stock/counters/voucher/' + prefix + '/' + year + '/' + companyRefCode;
  const snap = await rtdb.ref(counterPath).get();
  const current = snap.val() || 0;
  const next = current + 1;
  await rtdb.ref(counterPath).set(next);
  return prefix + '-' + yy + '-' + companyRefCode + '-' + String(next).padStart(6, '0');
}

async function generateStockTransactionRef() {
  const counterPath = 'stock/counters/transactionRef';
  const snap = await rtdb.ref(counterPath).get();
  const current = snap.val() || 0;
  const next = current + 1;
  await rtdb.ref(counterPath).set(next);
  return 'STK-' + String(next).padStart(8, '0');
}

// validateAndNormalizeLines rebuilds each line from a fixed field list, so
// a vendor/customer tag on a stock-module GL line (Purchase Return's
// payables line) would be dropped. Normalization skips blank-account
// lines and otherwise keeps order, so the non-blank raw lines line up
// one-to-one — same pairing as partyLedger.attachPartyFields. Lines with
// no party fields (every other caller) come back unchanged.
function carryPartyFields(rawLines, normalizedLines) {
  const raw = (rawLines || []).filter(l => String(l.AccountCode || '').trim());
  return normalizedLines.map((l, i) => {
    const r = raw[i] || {};
    if (!r.PartyType) return l;
    return Object.assign({}, l, {
      PartyType: r.PartyType, PartyID: r.PartyID || '', PartyName: r.PartyName || '', Allocations: r.Allocations || []
    });
  });
}

// Ported from writeStockGlEntry_. Caller MUST already hold the global
// lock (see lock.js) — same contract as the original.
async function writeStockGlEntry(user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields) {
  const built = await buildStockGlEntry(user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields);
  await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId).set(built.record);
  return { jvId: built.jvId, jvNumber: built.jvNumber, transactionRef: built.transactionRef };
}

// writeStockGlEntry's validation, numbering and record, without the
// write: for callers that commit the entry together with their own
// Firestore documents in one batch (Fixed Assets). Takes the voucher
// number, so the same lock contract applies.
async function buildStockGlEntry(user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields) {
  const dim = dimensions || {};
  if (!dim.CompanyID) throw new Error('Select a Company for this transaction.');
  if (!userCanAccessCompany(user.profile, dim.CompanyID)) throw new Error('You do not have access to that company.');

  const coaSnap = await rtdb.ref('coa').get();
  const coaData = coaSnap.val() || {};
  // One GL line per identical account / side / cost center / profit center /
  // description (owner, 2026-10-02; docs/modules/LINE_CLUBBING.md).
  const glLines = clubGlLines(rawGlLines);
  const normalized = validateAndNormalizeLines(glLines, coaData, dim.CompanyID);
  normalized.lines = carryPartyFields(glLines, normalized.lines);
  const totalDebit = normalized.totalDebit;
  const totalCredit = normalized.totalCredit;
  if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
    throw new Error('Transaction does not balance: Debit ' + totalDebit.toFixed(2) + ' vs Credit ' + totalCredit.toFixed(2) + '.');
  }

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const year = (new Date(transactionDate)).getFullYear() || new Date().getFullYear();
  const prefix = STOCK_TRANSACTION_PREFIXES[stockTransactionType];
  if (!prefix) throw new Error('Unknown stock transaction type: ' + stockTransactionType);

  const jvNumber = await generateStockVoucherNumber(prefix, year, dim.CompanyID);
  const transactionRef = await generateStockTransactionRef();
  const newId = 'STKJV-' + randomUUID().split('-')[0].toUpperCase();

  const record = Object.assign({
    JVNumber: jvNumber, TransactionRef: transactionRef, JVDate: transactionDate,
    Description: description, Reference: reference || '',
    Status: 'Posted', Lines: normalized.lines,
    TotalDebit: Math.round(totalDebit * 100) / 100, TotalCredit: Math.round(totalCredit * 100) / 100,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    PostedAt: now, PostedBy: actor, ReversedByJV: '',
    VoucherType: stockTransactionType, SelectedAccountCode: '',
    CurrencyCode: dim.CurrencyCode || '', CompanyID: dim.CompanyID,
    DivisionID: dim.DivisionID || '', BranchID: dim.BranchID || '',
    CostCenterID: dim.CostCenterID || '', ProfitCenterID: dim.ProfitCenterID || ''
  }, extraFields || {});

  return { jvId: newId, jvNumber: jvNumber, transactionRef: transactionRef, record: record };
}

// Ported from assignStockVoucherNumbering_ — a thin wrapper over the
// two functions above, used directly by modules with no GL entry of
// their own (Warehouse Movement) where writeStockGlEntry's own
// numbering logic never runs.
async function assignStockVoucherNumbering(stockTransactionType, transactionDate, companyId) {
  const year = (new Date(transactionDate)).getFullYear() || new Date().getFullYear();
  const prefix = STOCK_TRANSACTION_PREFIXES[stockTransactionType];
  if (!prefix) throw new Error('Unknown stock transaction type: ' + stockTransactionType);
  const voucherNumber = await generateStockVoucherNumber(prefix, year, companyId);
  const transactionRef = await generateStockTransactionRef();
  return { voucherNumber: voucherNumber, transactionRef: transactionRef };
}

module.exports = {
  FIRESTORE_JOURNAL_ENTRIES_COLLECTION, STOCK_TRANSACTION_PREFIXES, COST_CENTER_REQUIRED_TYPES,
  userCanAccessCompany, parseAmountServer, validateAndNormalizeLines,
  getCompanyRefCode, generateStockVoucherNumber, generateStockTransactionRef, assignStockVoucherNumbering, writeStockGlEntry, buildStockGlEntry
};
