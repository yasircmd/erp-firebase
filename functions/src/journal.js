// JV (Journal Entry Processing) and CBT (Cash and Bank Transactions):
// one GL journal engine behind both screens, stored in Firestore
// journalEntries.
//
// Hand-maintained from here on. This file began as the generated code
// for these two modules, moved here unchanged (functions/src/legacy/
// codegs.js is regenerated from Code.gs and can't be edited by hand).
// The functions below still run on the legacy runtime's REST-style
// primitives (firestoreGet_, LockService, ...) and take its per-request
// context as "idToken", exactly as the generated code did. Helpers
// other generated modules share (getCoaData_, the approval and
// permission checks, voucher numbering) still come from codegs.js; the
// generator's keep list (tools/legacy-port/keep.json) makes sure a
// re-run always emits them.
'use strict';
const { onCallWithMessages } = require('./callable');
const {
  run, firestoreGet_, firestoreSet_, firestoreUpdate_, firestoreDelete_, firestoreQuery_,
  firestoreCount_, requireUser_, LockService, Utilities
} = require('./legacy/runtime');
const L = require('./legacy/codegs');
const { moduleHasCapability } = require('./auth');
const listPaging = require('./listPaging');
const coaScheme = require('./coaScheme');
const { firestore } = require('./firebaseAdmin');
const { FieldPath } = require('firebase-admin/firestore');
const { getUserAssignedCompanies } = require('./companies');
const { userCanAccessCompany, validateAndNormalizeLines, parseAmountServer, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance } = require('./approvals');
const { CBT_APPROVAL_KEYS } = require('./approvalRegistry');
const { moduleIdForEntry } = require('./masterData');
const {
  attachPartyFields, resolvePartyLines, assertEntryReversible, listPartyAccounts, listOpenItems
} = require('./partyLedger');
// Fixed Assets (docs/modules/FIXED_ASSETS.md, decision 16): asset cost,
// accumulated depreciation and AuC accounts are the asset module's alone;
// and an entry whose clearing amount was capitalized can't be reversed.
const { assertNoFaControlledAccounts, assertEntryNotCapitalized } = require('./fixedAssetsCommon');
const { assertOpen: assertPeriodOpen } = require('./periodLock');

// Same adapters codegs.js uses for these helpers.
const moduleHasCapability_ = (idToken, ...a) => moduleHasCapability(...a);
const userCanAccessCompany_ = (...a) => userCanAccessCompany(...a);
const getUserAssignedCompanies_ = (...a) => getUserAssignedCompanies(...a);
const validateAndNormalizeLines_ = (...a) => validateAndNormalizeLines(...a);
const parseAmountServer_ = (...a) => parseAmountServer(...a);
const resolveApprovalScopeKeyForDocument_ = (idToken, ...a) => resolveApprovalScopeKeyForDocument(...a);
const beginApprovalInstance_ = (idToken, ...a) => beginApprovalInstance(...a);
const moduleIdForEntry_ = (...a) => moduleIdForEntry(...a);
// Voucher numbers come from the Numbering module (docs/modules/NUMBERING.md).
const generateVoucherNumber_ = (idToken, ...a) => require('./numbering').voucherNumber(...a);
const {
  getCoaData_, decideApprovalForDocument_, requireDraftAccess_, requirePostAccess_,
  generateGlTransactionRef_, voucherPrefixForEntry_
} = L;

// Verbatim copy of codegs.js's constant (reverseJournalEntry's guard).
const STOCK_VOUCHER_TYPE_TO_MODULE = {
  GRN: 'GRN',
  MaterialIssue: 'MATERIALISSUE',
  Production: 'PRODUCTION',
  WarehouseMovement: 'WAREHOUSEMOVEMENT',
  StockAdjustment: 'STOCKADJUSTMENT',
  PhysicalCount: 'PHYSICALCOUNT',
  VendorInvoice: 'VENDORINVOICE',
  DeliveryNote: 'DELIVERYNOTE',
  CustomerInvoice: 'CUSTOMERINVOICE',
  PurchaseReturn: 'PURCHASERETURN', // new development, not in Code.gs
  SalesReturn: 'SALESRETURN', // new development, not in Code.gs
  // new development, not in Code.gs: docs/modules/PDC.md
  PDCReceived: 'PDCRECEIVED', PDCReceivedClear: 'PDCRECEIVED', PDCIssued: 'PDCISSUED', PDCIssuedClear: 'PDCISSUED',
  // new development, not in Code.gs: docs/modules/FIXED_ASSETS.md
  FACapitalization: 'FAACQ', FADepreciation: 'FADEPRUN', FAAdditionalDepreciation: 'FAADDDEP',
  FARetirement: 'FARETIRE', FAAuCCost: 'FAAUC', FAAuCSettlement: 'FAAUC',
  // new development, not in Code.gs: docs/modules/RECURRING_JOURNAL.md
  RecurringJV: 'RECURRINGJV',
  // new development, not in Code.gs: docs/modules/OPENING_BALANCES.md
  OpeningBalance: 'OPENINGBALANCES', OpeningStock: 'OPENINGBALANCES',
  // new development, not in Code.gs: docs/modules/HR_PAYROLL.md (step 6:
  // the GL report opens a payroll journal's run, settlement, loan or batch)
  Payroll: 'PAYROLL', PayrollPayment: 'PAYROLL', PayrollProvision: 'PAYROLL', PayrollLoan: 'PAYROLLLOAN', FinalSettlement: 'PAYROLLFS',
  // new development, not in Code.gs: docs/modules/RETAIL_SALES.md
  RetailSale: 'RETAILSALES', RetailReturn: 'RETAILSALES',
  // new development, not in Code.gs: docs/modules/PERIOD_CLOSING.md (step 2)
  YearEndClose: 'PERIODCLOSE'
};

// ============================================================
// CASH AND BANK TRANSACTIONS (CBT)
// ============================================================
// A friendlier voucher-style front end over the SAME GL journal store as
// JV — not a separate ledger. Every voucher still becomes a normal
// balanced double-entry record; this layer just removes the need to
// think in Dr/Cr for the common cash/bank case by inferring it from the
// voucher type:
//   Cash/Bank Receipt -> the selected ledger account is DEBITED,
//                         every opposite line is CREDITED
//   Cash/Bank Payment  -> the selected ledger account is CREDITED,
//                         every opposite line is DEBITED
// "Cash" vs "Bank" is the selected account's Cash / Bank mark, taken from
// its group in the Chart of Accounts (owner, 2026-10-16;
// docs/modules/COA_NUMBERING.md, decision 210), not its code.
const CBT_VOUCHER_CONFIG = {
  'Cash Receipt': { ledger: 'Cash', ledgerIsDebit: true, voucherPrefix: 'CR' },
  'Bank Receipt': { ledger: 'Bank', ledgerIsDebit: true, voucherPrefix: 'BR' },
  'Cash Payment': { ledger: 'Cash', ledgerIsDebit: false, voucherPrefix: 'CP' },
  'Bank Payment': { ledger: 'Bank', ledgerIsDebit: false, voucherPrefix: 'BP' },
  // Between the company's own cash and bank accounts (owner, 2026-09-29;
  // docs/modules/APPROVAL_ROUTING.md, Fund Transfer): the ledger account is
  // the From side (credited), and the single line is the To side (debited),
  // itself a cash or bank account. Either may be cash or bank.
  'Fund Transfer': { ledgers: ['Cash', 'Bank'], ledgerIsDebit: false, voucherPrefix: 'FT', transfer: true }
};
const ledgersOf = config => config.ledgers || [config.ledger];
const ledgerKindOf = config => config.transfer ? 'From' : config.ledger.toLowerCase();

async function getJournalEntries(idToken, limit, page) {
  const user = await requireUser_(idToken);

  if (!(await moduleHasCapability_(idToken, 'JV', 'access', user.profile.role))) {
    throw new Error('You do not have access to Journal Entry Processing.');
  }

  // Same access model as before (and the same one applyCompanyAccessRestriction_
  // uses elsewhere) — no role-based bypass, an Admin's own visibility is
  // still bounded by their own AssignedCompanies, exactly as the RTDB
  // version already behaved. Firestore's IN operator caps at 30 values,
  // more than any real user's assigned-company list should ever reach.
  const assignedCompanies = getUserAssignedCompanies_(user.profile);
  if (!assignedCompanies.length) return { entries: [], total: 0 };

  const where = [['VoucherType', 'EQUAL', 'JV'], ['CompanyID', 'IN', assignedCompanies]];
  if (page) return journalListPage_(where, assignedCompanies, page, JV_LIST_SPEC, ['JV']);
  const cap = (limit === 'all' || limit === 0) ? 1000 : (Number(limit) || 100);

  const rows = await firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], cap);
  const total = await firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  const entries = rows.map(e => Object.assign({ JVID: e._id }, e));
  return { entries: entries, total: total };
}

async function getCbtEntries(idToken, limit, page) {
  const user = await requireUser_(idToken);

  if (!(await moduleHasCapability_(idToken, 'CBT', 'access', user.profile.role))) {
    throw new Error('You do not have access to Cash and Bank Transactions.');
  }

  const assignedCompanies = getUserAssignedCompanies_(user.profile);
  if (!assignedCompanies.length) return { entries: [], total: 0 };

  const cbtTypes = Object.keys(CBT_VOUCHER_CONFIG);
  const where = [['VoucherType', 'IN', cbtTypes], ['CompanyID', 'IN', assignedCompanies]];
  if (page) return journalListPage_(where, assignedCompanies, page, CBT_LIST_SPEC, cbtTypes);
  const cap = (limit === 'all' || limit === 0) ? 1000 : (Number(limit) || 100);

  const rows = await firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], cap);
  const total = await firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  const entries = rows.map(e => Object.assign({ JVID: e._id }, e));
  return { entries: entries, total: total };
}

// Gmail-style paging (owner, 2026-10-02; docs/modules/LIST_PAGING.md).
// What each list's search box matches is unchanged from the screens'.
const JV_LIST_SPEC = { idField: 'JVID', dateField: 'JVDate', equals: ['CompanyID', 'Status'], text: e => `${e.JVNumber} ${e.Description}` };
const CBT_LIST_SPEC = { idField: 'JVID', dateField: 'JVDate', equals: ['CompanyID', 'Status', 'VoucherType'], text: e => `${e.JVNumber} ${e.Description}` };
const asListEntry = e => Object.assign({ JVID: e._id }, e);

// The plain list reads only the page it returns. A search or filter has to
// read every entry of the user's companies (Firestore has no "contains"
// search) and match them here; the company and voucher type filters
// narrow that read.
async function journalListPage_(where, assignedCompanies, page, spec, voucherTypes) {
  const req = listPaging.normalize(page, spec);
  const none = { entries: [], total: 0, next: '', filtered: true };
  if (req.id) {
    const e = await firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, req.id);
    if (!e || !voucherTypes.includes(e.VoucherType) || !assignedCompanies.includes(e.CompanyID)) return none;
    return listPaging.pageOf([asListEntry(e)], page, spec);
  }
  // The single-company default fills in the user's only company: that
  // narrows nothing, so the plain list (one page read) still applies.
  if (req.equals.CompanyID && assignedCompanies.length === 1 && assignedCompanies[0] === req.equals.CompanyID) delete req.equals.CompanyID;
  if (listPaging.isFiltered(req)) {
    const narrowed = where.slice();
    if (req.equals.CompanyID) {
      if (!assignedCompanies.includes(req.equals.CompanyID)) return none;
      narrowed[1] = ['CompanyID', 'EQUAL', req.equals.CompanyID];
    }
    if (req.equals.VoucherType) {
      if (!voucherTypes.includes(req.equals.VoucherType)) return none;
      narrowed[0] = ['VoucherType', 'EQUAL', req.equals.VoucherType];
    }
    const rows = await firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, narrowed, [['CreatedAt', 'DESCENDING']], 0);
    return listPaging.pageOf(rows.map(asListEntry), page, spec);
  }
  // Unfiltered: only the next page is read, ordered as listPaging orders
  // (CreatedAt, then the document id, both descending: the composite
  // index the list already uses), starting after the marker.
  const cursor = req.after ? listPaging.parseCursor(req.after) : null;
  let q = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION);
  where.forEach(([field, op, value]) => { q = q.where(field, op === 'IN' ? 'in' : '==', value); });
  q = q.orderBy('CreatedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) q = q.startAfter(cursor[0], cursor[1]);
  let snap;
  try {
    snap = await q.limit(req.size + 1).get();
  } catch (err) {
    // A missing composite index (FAILED_PRECONDITION) must not break the
    // list: read it the way a search does instead, and say so in the logs.
    if (err && err.code !== 9) throw err;
    console.warn('journalListPage_: falling back to a full read (' + err.message + ')');
    const all = await firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], 0);
    return listPaging.pageOf(all.map(asListEntry), page, spec);
  }
  const rows = snap.docs.map(d => asListEntry(Object.assign({}, d.data(), { _id: d.id })));
  const entries = rows.slice(0, req.size);
  const total = await firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  return { entries, total, next: rows.length > req.size ? listPaging.cursorOf(entries[entries.length - 1], spec) : '', filtered: false };
}

// Shared core used by both saveJournalDraft() (plain manual JV) and
// saveCbtDraft() (Cash/Bank voucher entry) — both ultimately produce the
// same kind of GL record; only how the lines get built differs, and
// which module's "draft" permission applies.
//
// dimensions carries the header-level tags added for company/org
// structure: CurrencyCode (snapshotted from the current default currency,
// never a free pick — no conversion logic exists), CompanyID, DivisionID,
// BranchID, CostCenterID, ProfitCenterID. All optional except Currency,
// which auto-fills; none of these are validated against each other
// (e.g. a Branch isn't checked to belong to the selected Company) — that
// cross-validation doesn't exist yet.
async function saveJournalRecord_(
  idToken,
  moduleId,
  jvId,
  jvDate,
  description,
  reference,
  rawLines,
  dimensions,
  extraFields
) {
  const user = await requireUser_(idToken);
  await requireDraftAccess_(idToken, user, moduleId);

  if (!jvDate) throw new Error('Entry date is required.');
  if (!description) throw new Error('Description is required.');

  const dim = dimensions || {};
  const dimensionFields = {
    CurrencyCode: String(dim.CurrencyCode || ''),
    CompanyID: String(dim.CompanyID || ''),
    DivisionID: String(dim.DivisionID || ''),
    BranchID: String(dim.BranchID || ''),
    CostCenterID: String(dim.CostCenterID || ''),
    ProfitCenterID: String(dim.ProfitCenterID || '')
  };

  // Company is mandatory — without it there's no way to know which
  // company's books this entry belongs to, and the account picker on the
  // client won't even list accounts until one is chosen. Enforced here too
  // so a direct/malformed call can't bypass that client-side gate.
  if (!dimensionFields.CompanyID) throw new Error('Select a Company for this entry.');
  if (!userCanAccessCompany_(user.profile, dimensionFields.CompanyID)) {
    throw new Error('You do not have access to that company.');
  }

  const coaData = await getCoaData_(idToken);
  const normalized = validateAndNormalizeLines_(rawLines, coaData, dimensionFields.CompanyID);
  await assertNoFaControlledAccounts(normalized.lines);
  // Party tags and allocations (docs/modules/PARTY_PAYMENTS.md): checked
  // here for early feedback, and again at post under the lock.
  const party = await resolvePartyLines(attachPartyFields(rawLines, normalized.lines), dimensionFields.CompanyID);
  normalized.lines = party.lines;
  normalized.totalDebit = party.totalDebit; normalized.totalCredit = party.totalCredit; // with any exchange difference (MULTI_CURRENCY.md)
  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;

  if (jvId) {
    const existing = await firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    // Rejected is editable too now, same as Draft — a resubmission
    // reuses this exact save path, same symmetry already established
    // for Purchase Requisition and Inventory Purchase Requisition.
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected entries can be edited. Posted entries must be reversed instead.');

    const record = Object.assign({}, existing, dimensionFields, extraFields || {}, party.fields, {
      JVDate: jvDate, Description: description, Reference: reference,
      Lines: normalized.lines, TotalDebit: normalized.totalDebit, TotalCredit: normalized.totalCredit,
      UpdatedAt: now, UpdatedBy: actor
    });
    delete record._id; // never write Firestore's own bookkeeping field back as data
    await firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, record);
    return { success: true, jvId: jvId };
  }

  const newId = 'JVD-' + Utilities.getUuid().split('-')[0].toUpperCase();
  // VoucherType always gets a real value now — 'JV' for a plain manual
  // entry, never left blank/absent the way RTDB's version allowed.
  // Firestore's query model has no clean "field is absent" filter, so
  // getJournalEntries above needs every JV record to explicitly say
  // so, not imply it by omission.
  const record = Object.assign({
    JVNumber: '', TransactionRef: '', JVDate: jvDate, Description: description, Reference: reference,
    Status: 'Draft', Lines: normalized.lines,
    TotalDebit: normalized.totalDebit, TotalCredit: normalized.totalCredit,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    PostedAt: '', PostedBy: '', ReversedByJV: '', ReversalOfJV: '', VoucherType: 'JV'
  }, dimensionFields, extraFields || {}, party.fields);
  await firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, newId, record);
  return { success: true, jvId: newId };
}

// A JV line of a foreign party (docs/modules/MULTI_CURRENCY.md): the screen
// sends its own amount (FcAmount) beside the base Debit / Credit; the rate
// is what the base works out to. Without one, no foreign fields.
function fcFromAmounts_(lines) {
  return (lines || []).map(line => {
    const l = Object.assign({}, line);
    const fcAmount = parseAmountServer_(l.FcAmount);
    delete l.FcAmount;
    if (!l.FcCurrency || !(fcAmount > 0)) { ['FcCurrency', 'FcDebit', 'FcCredit', 'FcRate'].forEach(k => delete l[k]); return l; }
    const debit = parseAmountServer_(l.Debit), credit = parseAmountServer_(l.Credit), amount = debit || credit;
    return Object.assign(l, { FcCurrency: String(l.FcCurrency).trim().toUpperCase(), FcDebit: debit ? fcAmount : 0, FcCredit: debit ? 0 : (credit ? fcAmount : 0),
      FcRate: amount ? Math.round(amount / fcAmount * 1e6) / 1e6 : 0 });
  });
}

async function saveJournalDraft(idToken, jvData) {
  try {
    return await saveJournalRecord_(
      idToken, 'JV',
      String(jvData.JVID || '').trim(),
      String(jvData.JVDate || '').trim(),
      String(jvData.Description || '').trim(),
      String(jvData.Reference || '').trim(),
      fcFromAmounts_(jvData.Lines),
      {
        CurrencyCode: jvData.CurrencyCode, CompanyID: jvData.CompanyID,
        DivisionID: jvData.DivisionID, BranchID: jvData.BranchID,
        CostCenterID: jvData.CostCenterID, ProfitCenterID: jvData.ProfitCenterID
      },
      { VoucherType: 'JV' }
    );
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function deleteJournalDraft(idToken, jvId) {
  try {
    const user = await requireUser_(idToken);
    const existing = await firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    await requireDraftAccess_(idToken, user, moduleIdForEntry_(existing));
    if (existing.Status !== 'Draft') throw new Error('Only draft entries can be deleted. Posted entries must be reversed instead.');

    await firestoreDelete_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// The ONLY function that ever writes a "Posted" record — this is the
// AccountingEngine boundary for GL. Re-validates lines against live COA
// data (not the possibly-stale draft) before committing, including the
// company-restriction check (an account could have gained a company
// restriction, or the restriction could have changed, since the draft
// was saved).
async function postJournalEntry(idToken, jvId) {
  const user = await requireUser_(idToken);
  const lock = LockService.getScriptLock();
  await lock.waitLock(10000);

  try {
    const existing = await firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const moduleId = moduleIdForEntry_(existing);
    await requirePostAccess_(idToken, user, moduleId);
    // Draft (first posting attempt) or Rejected (resubmitting after a
    // revision) — both go through identical logic below, same as the
    // Draft/Rejected symmetry already established for Purchase
    // Requisition and Inventory Purchase Requisition.
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected entries can be posted.');
    await assertPeriodOpen(existing.CompanyID, existing.JVDate); // docs/modules/PERIOD_CLOSING.md, step 1b

    const coaData = await getCoaData_(idToken);
    const normalized = validateAndNormalizeLines_(existing.Lines, coaData, existing.CompanyID);
    await assertNoFaControlledAccounts(normalized.lines);

    if (normalized.lines.length < 2) throw new Error('A journal entry needs at least two lines.');
    if (normalized.totalDebit === 0) throw new Error('Entry has no amounts.');
    if (Math.abs(normalized.totalDebit - normalized.totalCredit) > 0.005) {
      throw new Error('Entry is not balanced: total debit ' + normalized.totalDebit.toFixed(2) + ' vs total credit ' + normalized.totalCredit.toFixed(2) + '.');
    }
    // The authoritative allocation check: under the lock, against what is
    // outstanding right now, not the draft's snapshot.
    const party = await resolvePartyLines(attachPartyFields(existing.Lines, normalized.lines), existing.CompanyID);
    normalized.lines = party.lines;
    normalized.totalDebit = party.totalDebit; normalized.totalCredit = party.totalCredit;

    const year = (new Date(existing.JVDate)).getFullYear() || new Date().getFullYear();
    const prefix = voucherPrefixForEntry_(existing);
    // Voucher numbering deliberately stays in RTDB even though the
    // document itself now lives in Firestore — it's just a small,
    // atomically-incrementing counter, shared identically by every
    // module regardless of which database its own records live in.
    // Moving it would add complexity for no real benefit: the only
    // failure mode if this succeeds and the Firestore write below
    // doesn't is a skipped voucher number, which accounting already
    // tolerates (numbers just need to be unique, not gapless) — a
    // fundamentally different, much lower-stakes risk than the
    // physical-stock-vs-GL mismatch Phase 3 is built to guard against.
    const jvNumber = await generateVoucherNumber_(idToken, prefix, year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval gate — keyed by whichever module this entry actually
    // belongs to (JV or CBT; moduleIdForEntry_ already resolves this,
    // and postJournalEntry/saveJournalRecord_ are shared infrastructure
    // for both, so this one change covers both at once). Scope
    // resolution uses the entry's own HEADER Cost
    // Center/Division/Branch — the "line default" a user may or may
    // not have set, individual lines can still override it — same
    // reasoning as Purchase Order's own CostCenterID: one entry, one
    // unambiguous scope value, even though its own lines can vary. If
    // Admin configures a CostCenter-scoped gate and the header field
    // is left blank, no gate applies — the same "can't resolve scope
    // means no gate" behavior already established for every other
    // retrofit, not special-cased here.
    // A CBT voucher uses its own voucher type's Approval Configuration entry
    // (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md).
    const configKey = moduleId === 'CBT' ? CBT_APPROVAL_KEYS[existing.VoucherType] : undefined;
    const scopeKey = await resolveApprovalScopeKeyForDocument_(idToken, configKey || moduleId, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance_(idToken, moduleId, jvId, jvNumber, scopeKey, normalized.totalDebit, user.uid, configKey);

    const record = Object.assign({}, existing, party.fields, {
      JVNumber: jvNumber, Lines: normalized.lines,
      TotalDebit: normalized.totalDebit, TotalCredit: normalized.totalCredit,
      RejectionReason: '', SubmittedAt: now, SubmittedBy: actor
    });
    delete record._id;
    let transactionRef = '';
    if (approval.required) {
      record.Status = 'PendingApproval';
      record.ApprovalInstanceID = approval.instanceId;
      record.TransactionRef = '';
    } else {
      // TransactionRef is deliberately only ever assigned at the
      // moment an entry actually becomes Posted — not here if a gate
      // applies (see decideJournalEntryApproval, which assigns it on
      // final approval instead). It represents a committed GL
      // posting, which a still-PendingApproval entry isn't yet.
      transactionRef = await generateGlTransactionRef_(idToken);
      record.Status = 'Posted';
      record.TransactionRef = transactionRef;
      record.PostedAt = now;
      record.PostedBy = actor;
    }

    await firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, record);
    return { success: true, jvNumber: jvNumber, transactionRef: transactionRef, status: record.Status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await lock.releaseLock();
  }
}

// Takes the global lock (the generated original didn't): an Approve
// re-checks the entry's allocations against what is outstanding now, and
// the final one makes them count, so it must not interleave with another
// post. If they no longer fit, the approval is refused with the reason;
// the approver can Reject the entry back for editing.
async function decideJournalEntryApproval(idToken, jvId, levelNumber, decision, reason) {
  const lock = LockService.getScriptLock();
  await lock.waitLock(10000);
  try {
    const user = await requireUser_(idToken);
    const existing = await firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (existing) {
      await requirePostAccess_(idToken, user, moduleIdForEntry_(existing));
      if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
      if (decision === 'Approved' && existing.Status === 'PendingApproval') {
        await assertPeriodOpen(existing.CompanyID, existing.JVDate); // its month closed meanwhile: the approver rejects it
        await assertNoFaControlledAccounts(existing.Lines);
        await resolvePartyLines(existing.Lines, existing.CompanyID);
      }
    }
    const result = await decideApprovalForDocument_(idToken, FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, levelNumber, decision, reason, 'Posted', 'firestore');
    if (result.status === 'Approved') {
      // Only NOW, once every required level has actually approved,
      // does this become a real, committed GL posting.
      const transactionRef = await generateGlTransactionRef_(idToken);
      const now = new Date().toISOString();
      await firestoreUpdate_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, {
        TransactionRef: transactionRef, PostedAt: now, PostedBy: user.profile.username || user.uid
      });
    }
    return Object.assign({ success: true }, result);
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await lock.releaseLock();
  }
}

async function reverseJournalEntry(idToken, jvId, reversalDate) {
  const user = await requireUser_(idToken);
  const lock = LockService.getScriptLock();
  await lock.waitLock(10000);

  try {
    const existing = await firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // [PORT FIX jv-reverse-only-journal-and-cbt] a stock/invoice entry must be reversed by its own module, which
    // also undoes the stock and the source document. Checked before the post right: that module (e.g. Opening
    // Balances, which has none) is not where the reversal happens (docs/modules/GL_REFERENCES.md).
    if (existing.VoucherType && STOCK_VOUCHER_TYPE_TO_MODULE[existing.VoucherType]) {
      throw new Error('This entry was posted by ' + existing.VoucherType + ' — reverse it from that module, not here.');
    }
    await requirePostAccess_(idToken, user, moduleIdForEntry_(existing));
    if (existing.Status !== 'Posted') throw new Error('Only posted entries can be reversed.');
    if (existing.ReversedByJV) throw new Error('This entry has already been reversed.');
    // Reversing releases this entry's allocations (it stops being live);
    // refused while something else has settled one of its New Refs.
    await assertEntryReversible(jvId, existing);
    await assertEntryNotCapitalized(jvId);

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    await assertPeriodOpen(existing.CompanyID, date); // the reversal's own date (decision 130)
    // The reversal keeps the party tags (for statements) but allocates
    // nothing itself.
    const reversedLines = (existing.Lines || []).map(line => {
      const l = Object.assign({}, line, { Debit: line.Credit, Credit: line.Debit }, require('./fx').mirrorFc(line)); // foreign amounts swap too
      delete l.Allocations;
      return l;
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const year = (new Date(date)).getFullYear() || new Date().getFullYear();
    const prefix = voucherPrefixForEntry_(existing);
    const jvNumber = await generateVoucherNumber_(idToken, prefix, year, existing.CompanyID);
    const transactionRef = await generateGlTransactionRef_(idToken);
    const newId = 'JVD-' + Utilities.getUuid().split('-')[0].toUpperCase();

    const reversalRecord = {
      JVNumber: jvNumber, TransactionRef: transactionRef, JVDate: date,
      Description: 'Reversal of ' + existing.JVNumber + ' — ' + existing.Description,
      Reference: existing.JVNumber,
      Status: 'Posted', Lines: reversedLines,
      TotalDebit: existing.TotalCredit, TotalCredit: existing.TotalDebit,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      PostedAt: now, PostedBy: actor, ReversedByJV: '', ReversalOfJV: jvId,
      VoucherType: existing.VoucherType || 'JV', SelectedAccountCode: existing.SelectedAccountCode || '',
      CurrencyCode: existing.CurrencyCode || '', CompanyID: existing.CompanyID || '',
      DivisionID: existing.DivisionID || '', BranchID: existing.BranchID || '',
      CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '',
      PartyKeys: existing.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: []
    };

    await firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, newId, reversalRecord);
    await firestoreUpdate_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, { ReversedByJV: newId });

    return { success: true, jvId: newId, jvNumber: jvNumber, transactionRef: transactionRef };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await lock.releaseLock();
  }
}

// headerDescription is used for the ledger (Cash/Bank) line's own
// Description, since that line has no user-facing description field of
// its own — mirroring the header keeps it meaningful now that every line
// requires a description. headerDimensions supplies the ledger line's
// Cost/Profit Center default (it isn't part of the editable opposite-lines
// grid, so it always inherits from the header, never overridden per line).
//
// ledgerFx { code, rate }: the ledger is a cash or bank account in a foreign
// currency (docs/modules/MULTI_CURRENCY.md, decision 217). The amounts are
// then in it, each line in base at the voucher's rate, keeping its own.
function buildLinesFromVoucher_(voucherType, selectedAccountCode, oppositeLines, headerDescription, headerDimensions, coaData, ledgerFx) {
  const config = CBT_VOUCHER_CONFIG[voucherType];
  if (!config) throw new Error('Unknown transaction type: ' + voucherType);

  const rawLines = [];

  (oppositeLines || []).forEach((line, idx) => {
    const code = String(line.AccountCode || '').trim();
    if (!code) return;
    if (code === selectedAccountCode) {
      throw new Error('Line ' + (idx + 1) + ': cannot use the same account selected as the ' + ledgerKindOf(config) + ' ledger.');
    }
    if (config.transfer && !coaScheme.isCashOrBank(Object.values(coaData || {}).find(a => String(a.AccountCode) === code))) {
      throw new Error('A Fund Transfer goes to another cash or bank account; ' + code + ' is neither.');
    }
    const typed = parseAmountServer_(line.Amount);
    if (typed <= 0) throw new Error('Line ' + (idx + 1) + ': enter an amount greater than zero.');
    const amount = ledgerFx ? Math.round(typed * ledgerFx.rate * 100) / 100 : typed;

    rawLines.push({
      AccountCode: code,
      Description: String(line.Description || '').trim(),
      Debit: config.ledgerIsDebit ? 0 : amount,
      Credit: config.ledgerIsDebit ? amount : 0,
      CostCenterID: String(line.CostCenterID || ''),
      ProfitCenterID: String(line.ProfitCenterID || ''),
      // Party tag and allocations, checked by resolvePartyLines. A transfer
      // between the company's own accounts owes nobody.
      PartyType: config.transfer ? undefined : line.PartyType, PartyID: config.transfer ? undefined : line.PartyID,
      Allocations: config.transfer ? undefined : line.Allocations
    });
    // A foreign party's line (docs/modules/MULTI_CURRENCY.md): its own amount
    // too; the rate is what the bank amount works out to.
    const l = rawLines[rawLines.length - 1];
    const fcOn = (cur, fcAmount, rate) => Object.assign(l, { FcCurrency: cur, FcDebit: l.Debit ? fcAmount : 0, FcCredit: l.Credit ? fcAmount : 0, FcRate: rate });
    const fcAmount = parseAmountServer_(line.FcAmount);
    if (config.transfer) {
      // A transfer: the To account's own currency, if it has one.
      const to = Object.values(coaData || {}).find(a => String(a.AccountCode) === code) || {};
      const toCur = String(to.Currency || '');
      if (ledgerFx && toCur && toCur !== ledgerFx.code) throw new Error('A transfer between a ' + ledgerFx.code + ' and a ' + toCur + ' account is not available yet: transfer through a base-currency account.');
      if (ledgerFx && toCur) fcOn(toCur, typed, ledgerFx.rate);
      if (!ledgerFx && toCur) {
        if (!(fcAmount > 0)) throw new Error('Account ' + code + ' is in ' + toCur + ': enter the ' + toCur + ' amount it receives.');
        fcOn(toCur, fcAmount, Math.round(amount / fcAmount * 1e6) / 1e6);
      }
    } else if (ledgerFx) {
      fcOn(ledgerFx.code, typed, ledgerFx.rate);
    } else if (line.FcCurrency && fcAmount > 0) {
      fcOn(String(line.FcCurrency).trim().toUpperCase(), fcAmount, Math.round(amount / fcAmount * 1e6) / 1e6);
    }
  });

  if (!rawLines.length) throw new Error(config.transfer ? 'Select the account to transfer to, and the amount.' : 'Enter at least one line.');
  if (config.transfer && rawLines.length > 1) throw new Error('A Fund Transfer has one To account.');

  const total = rawLines.reduce((sum, l) => sum + l.Debit + l.Credit, 0);
  const dim = headerDimensions || {};

  const ledger = {
    AccountCode: selectedAccountCode,
    Description: String(headerDescription || '').trim(),
    Debit: config.ledgerIsDebit ? total : 0,
    Credit: config.ledgerIsDebit ? 0 : total,
    CostCenterID: String(dim.CostCenterID || ''),
    ProfitCenterID: String(dim.ProfitCenterID || '')
  };
  if (ledgerFx) {
    const fcTotal = Math.round((oppositeLines || []).filter(x => String(x.AccountCode || '').trim()).reduce((t, x) => t + parseAmountServer_(x.Amount), 0) * 100) / 100;
    Object.assign(ledger, { FcCurrency: ledgerFx.code, FcDebit: config.ledgerIsDebit ? fcTotal : 0, FcCredit: config.ledgerIsDebit ? 0 : fcTotal, FcRate: ledgerFx.rate });
  }
  rawLines.unshift(ledger);

  return rawLines;
}

async function saveCbtDraft(idToken, cbtData) {
  try {
    const user = await requireUser_(idToken);
    await requireDraftAccess_(idToken, user, 'CBT');

    const voucherType = String(cbtData.VoucherType || '').trim();
    const config = CBT_VOUCHER_CONFIG[voucherType];
    if (!config) throw new Error('Select a transaction type.');

    const selectedAccountCode = String(cbtData.SelectedAccountCode || '').trim();
    if (!selectedAccountCode) throw new Error(config.transfer ? 'Select the account to transfer from.' : 'Select a cash or bank ledger.');

    const companyId = String(cbtData.CompanyID || '').trim();

    const coaData = await getCoaData_(idToken);
    const selectedAccount = Object.keys(coaData)
      .map(id => Object.assign({ AccountID: id }, coaData[id]))
      .find(a => String(a.AccountCode) === selectedAccountCode);

    if (!selectedAccount) throw new Error('Selected ledger account not found.');
    if (selectedAccount.Status !== 'Active') throw new Error('Selected ledger account is inactive.');
    if (selectedAccount.IsPostable !== true) throw new Error('Selected ledger account is a header account and cannot be posted to.');
    if (!ledgersOf(config).includes(coaScheme.kindOf(selectedAccount))) {
      throw new Error(config.transfer ? 'Transfer from a cash or bank account.'
        : 'Selected account is not a valid ' + config.ledger + ' ledger account (its group in the Chart of Accounts is not marked ' + config.ledger + ').');
    }
    if (selectedAccount.CompanyID && selectedAccount.CompanyID !== companyId) {
      throw new Error('Selected ledger account is restricted to a specific company — select that company for this entry.');
    }
    // The To account must also be this company's (same company only).
    if (config.transfer) {
      (cbtData.OppositeLines || []).forEach(l => {
        const code = String(l.AccountCode || '').trim();
        const to = code && Object.values(coaData).find(a => String(a.AccountCode) === code);
        if (to && to.CompanyID && to.CompanyID !== companyId) throw new Error('Account ' + code + ' belongs to another company: a Fund Transfer stays within one company.');
      });
    }

    // A cash or bank account in a foreign currency (decision 217): the
    // voucher is in it, at the rate of its date (or another, with a reason).
    let ledgerFx = null, rateFields = { LedgerCurrency: '', ExchangeRate: 1, RateEffectiveDate: '', ExchangeRateReason: '' };
    const ledgerCurrency = String(selectedAccount.Currency || '');
    if (ledgerCurrency) {
      const date = String(cbtData.JVDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Entry date is required.');
      rateFields = Object.assign({ LedgerCurrency: ledgerCurrency }, await require('./fx').documentRate(ledgerCurrency, date, cbtData));
      ledgerFx = { code: ledgerCurrency, rate: rateFields.ExchangeRate };
    }
    const rawLines = buildLinesFromVoucher_(
      voucherType, selectedAccountCode, cbtData.OppositeLines,
      cbtData.Description,
      { CostCenterID: cbtData.CostCenterID, ProfitCenterID: cbtData.ProfitCenterID }, coaData, ledgerFx
    );

    return await saveJournalRecord_(
      idToken, 'CBT',
      String(cbtData.JVID || '').trim(),
      String(cbtData.JVDate || '').trim(),
      String(cbtData.Description || '').trim(),
      String(cbtData.Reference || '').trim(),
      rawLines,
      {
        CurrencyCode: cbtData.CurrencyCode, CompanyID: cbtData.CompanyID,
        DivisionID: cbtData.DivisionID, BranchID: cbtData.BranchID,
        CostCenterID: cbtData.CostCenterID, ProfitCenterID: cbtData.ProfitCenterID
      },
      Object.assign({ VoucherType: voucherType, SelectedAccountCode: selectedAccountCode }, rateFields)
    );
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Party pickers for the JV and CBT screens (docs/modules/PARTY_PAYMENTS.md).
async function requireJournalAccess_(user) {
  const role = user.profile.role;
  if (!(await moduleHasCapability('JV', 'access', role)) && !(await moduleHasCapability('CBT', 'access', role))) {
    throw new Error('You do not have access to Journal Entry Processing or Cash and Bank Transactions.');
  }
}

// Every vendor and customer usable in this company, with the control
// account a line must use to name it.
async function getPartyAccounts(idToken, companyId) {
  const user = await requireUser_(idToken);
  await requireJournalAccess_(user);
  const id = String(companyId || '').trim();
  if (!id) return [];
  if (!userCanAccessCompany_(user.profile, id)) throw new Error('You do not have access to that company.');
  return listPartyAccounts(id);
}

// One party's open items in this company, outstanding > 0. excludeJvId:
// as if that entry's own allocations were not there (Re-match shows what
// it may settle again; docs/modules/UX_TIER3.md G).
async function getPartyOpenItems(idToken, partyType, partyId, companyId, excludeJvId) {
  const user = await requireUser_(idToken);
  await requireJournalAccess_(user);
  const id = String(companyId || '').trim();
  if (!id) throw new Error('Select a Company first.');
  if (!userCanAccessCompany_(user.profile, id)) throw new Error('You do not have access to that company.');
  return listOpenItems(String(partyType || '').trim(), String(partyId || '').trim(), id, String(excludeJvId || '').trim());
}

// ---- callables ----
// Same shape as the generated ones in legacy/callables.js: request.data
// keys are the function's own parameter names, and { __positional: [...] }
// is accepted too.
const opts = { region: 'us-central1' };
function callable(fn, names) {
  return onCallWithMessages(opts, (request) => {
    const d = request.data || {};
    const a = Array.isArray(d.__positional) ? d.__positional : names.map(k => d[k]);
    return run(request, (ctx) => fn(ctx, ...a));
  });
}

exports.getJournalEntries = callable(getJournalEntries, ['limit', 'page']);
exports.getCbtEntries = callable(getCbtEntries, ['limit', 'page']);
exports.saveJournalDraft = callable(saveJournalDraft, ['jvData']);
exports.saveCbtDraft = callable(saveCbtDraft, ['cbtData']);
exports.deleteJournalDraft = callable(deleteJournalDraft, ['jvId']);
exports.postJournalEntry = callable(postJournalEntry, ['jvId']);
exports.decideJournalEntryApproval = callable(decideJournalEntryApproval, ['jvId', 'levelNumber', 'decision', 'reason']);
exports.reverseJournalEntry = callable(reverseJournalEntry, ['jvId', 'reversalDate']);
exports.getPartyAccounts = callable(getPartyAccounts, ['companyId']);
exports.getPartyOpenItems = callable(getPartyOpenItems, ['partyType', 'partyId', 'companyId', 'excludeJvId']);
