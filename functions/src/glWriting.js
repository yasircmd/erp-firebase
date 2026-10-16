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
  PayrollProvision: 'PPR', // an accrual's claim (step 5a)
  FinalSettlement: 'FS', // an employee's final settlement (step 5b)
  RetailSale: 'RS', // hand-written module, docs/modules/RETAIL_SALES.md: a sale and its reversal
  RetailReturn: 'RR', // its partial returns (decisions 76-79) and their reversal
  YearEndClose: 'YEC' // hand-written module, docs/modules/PERIOD_CLOSING.md: the year-end closing entry and its reversal
};

function userCanAccessCompany(profile, companyId) {
  if (!companyId) return true;
  return getUserAssignedCompanies(profile).includes(companyId);
}

function parseAmountServer(value) {
  const num = parseFloat(String(value == null ? '' : value).replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

const fcFieldsOf = line => ({ FcCurrency: String(line.FcCurrency).trim().toUpperCase(), FcDebit: Math.round((Number(line.FcDebit) || 0) * 100) / 100,
  FcCredit: Math.round((Number(line.FcCredit) || 0) * 100) / 100, FcRate: Number(line.FcRate) || 0 });

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

    // The account's rules for cost center, profit center and project
    // (docs/modules/PROJECTS_DIMENSIONS.md): a required one missing is
    // refused, a not-used one dropped. With no rules, as before.
    const dims = require('./dimensionRules').applyRules(line, account, coaData, 'Line ' + (idx + 1) + ': ');

    totalDebit += debit;
    totalCredit += credit;

    const out = {
      LineNo: lines.length + 1, AccountID: account.AccountID, AccountCode: account.AccountCode,
      AccountName: account.AccountName, Description: description,
      Debit: Math.round(debit * 100) / 100, Credit: Math.round(credit * 100) / 100,
      CostCenterID: dims.CostCenterID, ProfitCenterID: dims.ProfitCenterID
    };
    if (dims.ProjectID) out.ProjectID = dims.ProjectID;
    // A line in a foreign currency keeps its own amount and rate beside the
    // base amount the books use (docs/modules/MULTI_CURRENCY.md); an
    // exchange difference line is marked as such.
    if (line.FcCurrency) Object.assign(out, fcFieldsOf(line));
    if (line.FxAdjustment) out.FxAdjustment = true;
    lines.push(out);
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
// The number's format is the Numbering module's (docs/modules/NUMBERING.md);
// its default is the shape above (PREFIX-YY-CO-000001), carrying on from
// stock/counters/voucher.
async function generateStockVoucherNumber(prefix, year, companyId) {
  return require('./numbering').voucherNumber(prefix, year, companyId);
}

// Payroll's journals (docs/modules/HR_PAYROLL.md, decision 48) take their
// own lifetime audit sequence, PRL-, so they're easy to tell apart from
// stock (STK-) and finance (TXN-) entries.
const PAYROLL_VOUCHER_TYPES = ['Payroll', 'PayrollPayment', 'PayrollLoan', 'PayrollProvision', 'FinalSettlement'];
async function generatePayrollTransactionRef() {
  const res = await rtdb.ref('payroll/counters/transactionRef').transaction(cur => (Number(cur) || 0) + 1);
  return 'PRL-' + String(res.snapshot.val()).padStart(8, '0');
}

// Finance documents written through this path (docs/modules/GL_REFERENCES.md,
// decisions 49-50) take the finance sequence, TXN- (the same lifetime
// counter as Journal Vouchers and Cash & Bank); stock documents keep STK-.
const FINANCE_VOUCHER_TYPES = [
  'FACapitalization', 'FADepreciation', 'FAAdditionalDepreciation', 'FARetirement', 'FAAuCCost', 'FAAuCSettlement',
  'PDCReceived', 'PDCReceivedClear', 'PDCIssued', 'PDCIssuedClear', 'RecurringJV', 'OpeningBalance',
  'VendorInvoice', 'CustomerInvoice', 'RetailSale', 'RetailReturn', 'YearEndClose'];
async function generateFinanceTransactionRef() {
  const res = await rtdb.ref('gl/transactionRefCounter').transaction(cur => (Number(cur) || 0) + 1);
  return 'TXN-' + String(res.snapshot.val()).padStart(8, '0');
}
const transactionRefFor = type => (PAYROLL_VOUCHER_TYPES.includes(type) ? generatePayrollTransactionRef()
  : FINANCE_VOUCHER_TYPES.includes(type) ? generateFinanceTransactionRef() : generateStockTransactionRef());

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
    }, r.FxAdjustment ? { FxAdjustment: true } : {});
  });
}

// Ported from writeStockGlEntry_. Caller MUST already hold the global
// lock (see lock.js) — same contract as the original.
async function writeStockGlEntry(user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields) {
  const built = await buildStockGlEntry(user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields);
  await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId).set(built.record);
  return { jvId: built.jvId, jvNumber: built.jvNumber, transactionRef: built.transactionRef, jvDate: built.record.JVDate, adjustedFrom: built.record.AdjustedFromDate || '' };
}

// writeStockGlEntry's validation, numbering and record, without the
// write: for callers that commit the entry together with their own
// Firestore documents in one batch (Fixed Assets). Takes the voucher
// number, so the same lock contract applies.
async function buildStockGlEntry(user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields) {
  const dim = dimensions || {};
  if (!dim.CompanyID) throw new Error('Select a Company for this transaction.');
  if (!userCanAccessCompany(user.profile, dim.CompanyID)) throw new Error('You do not have access to that company.');
  // Nothing is written into a closed month (docs/modules/PERIOD_CLOSING.md, step 1b),
  // except a payroll or depreciation reversal / redo the user agreed to post in
  // the first open month instead (step 1c, decisions 131, 136-139).
  const periodLock = require('./periodLock');
  extraFields = Object.assign({}, extraFields || {});
  const redo = extraFields.AdjustableRedo === true;
  delete extraFields.AdjustableRedo;
  if (periodLock.ADJUSTABLE_TYPES.has(stockTransactionType) && (redo || extraFields.ReversalOfJV)) {
    const posted = await periodLock.adjustableDate(dim.CompanyID, transactionDate, redo || periodLock.consentGiven());
    if (posted !== transactionDate) { extraFields.AdjustedFromDate = transactionDate; transactionDate = posted; }
  } else {
    await periodLock.assertOpen(dim.CompanyID, transactionDate);
  }

  const coaSnap = await rtdb.ref('coa').get();
  const coaData = coaSnap.val() || {};
  // One GL line per identical account / side / cost center / profit center /
  // description (owner, 2026-10-02; docs/modules/LINE_CLUBBING.md).
  const glLines = clubGlLines(rawGlLines);
  const normalized = validateAndNormalizeLines(glLines, coaData, dim.CompanyID);
  normalized.lines = carryPartyFields(glLines, normalized.lines);
  // A closed project takes no new postings; a reversal still posts (PROJECTS_DIMENSIONS.md).
  if (!extraFields.ReversalOfJV) await require('./projects').assertProjects(normalized.lines, dim.CompanyID);
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
  const transactionRef = await transactionRefFor(stockTransactionType);
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
  await require('./periodLock').assertOpen(companyId, transactionDate); // a stock movement with no GL entry: the period lock here
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
  getCompanyRefCode, generateStockVoucherNumber, generateStockTransactionRef, transactionRefFor, assignStockVoucherNumbering, writeStockGlEntry, buildStockGlEntry
};
