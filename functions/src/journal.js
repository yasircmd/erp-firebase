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
const { getUserAssignedCompanies } = require('./companies');
const { userCanAccessCompany, validateAndNormalizeLines, parseAmountServer, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance } = require('./approvals');
const { moduleIdForEntry } = require('./masterData');
const {
  attachPartyFields, resolvePartyLines, assertEntryReversible, listPartyAccounts, listOpenItems
} = require('./partyLedger');

// Same adapters codegs.js uses for these helpers.
const moduleHasCapability_ = (idToken, ...a) => moduleHasCapability(...a);
const userCanAccessCompany_ = (...a) => userCanAccessCompany(...a);
const getUserAssignedCompanies_ = (...a) => getUserAssignedCompanies(...a);
const validateAndNormalizeLines_ = (...a) => validateAndNormalizeLines(...a);
const parseAmountServer_ = (...a) => parseAmountServer(...a);
const resolveApprovalScopeKeyForDocument_ = (idToken, ...a) => resolveApprovalScopeKeyForDocument(...a);
const beginApprovalInstance_ = (idToken, ...a) => beginApprovalInstance(...a);
const moduleIdForEntry_ = (...a) => moduleIdForEntry(...a);
const {
  getCoaData_, decideApprovalForDocument_, requireDraftAccess_, requirePostAccess_,
  generateVoucherNumber_, generateGlTransactionRef_, voucherPrefixForEntry_
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
  // Not in Code.gs: the debit/credit notes' GL entries are reversed from
  // their own modules too.
  PurchaseReturn: 'PURCHASERETURN',
  SalesReturn: 'SALESRETURN'
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
// "Cash" vs "Bank" is determined by the selected account's code prefix,
// which follows directly from the COA numbering scheme: leaf accounts
// under the 100000 (Cash/Petty Cash) header start with "10"; leaf
// accounts under 110000 (Bank Accounts) start with "11".
const CBT_VOUCHER_CONFIG = {
  'Cash Receipt': { ledgerPrefix: '10', ledgerIsDebit: true, voucherPrefix: 'CR' },
  'Bank Receipt': { ledgerPrefix: '11', ledgerIsDebit: true, voucherPrefix: 'BR' },
  'Cash Payment': { ledgerPrefix: '10', ledgerIsDebit: false, voucherPrefix: 'CP' },
  'Bank Payment': { ledgerPrefix: '11', ledgerIsDebit: false, voucherPrefix: 'BP' }
};

async function getJournalEntries(idToken, limit) {
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
  const cap = (limit === 'all' || limit === 0) ? 1000 : (Number(limit) || 100);

  const rows = await firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], cap);
  const total = await firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  const entries = rows.map(e => Object.assign({ JVID: e._id }, e));
  return { entries: entries, total: total };
}

async function getCbtEntries(idToken, limit) {
  const user = await requireUser_(idToken);

  if (!(await moduleHasCapability_(idToken, 'CBT', 'access', user.profile.role))) {
    throw new Error('You do not have access to Cash and Bank Transactions.');
  }

  const assignedCompanies = getUserAssignedCompanies_(user.profile);
  if (!assignedCompanies.length) return { entries: [], total: 0 };

  const cbtTypes = Object.keys(CBT_VOUCHER_CONFIG);
  const where = [['VoucherType', 'IN', cbtTypes], ['CompanyID', 'IN', assignedCompanies]];
  const cap = (limit === 'all' || limit === 0) ? 1000 : (Number(limit) || 100);

  const rows = await firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], cap);
  const total = await firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  const entries = rows.map(e => Object.assign({ JVID: e._id }, e));
  return { entries: entries, total: total };
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
  // Party tags and allocations (docs/modules/PARTY_PAYMENTS.md): checked
  // here for early feedback, and again at post under the lock.
  const party = await resolvePartyLines(attachPartyFields(rawLines, normalized.lines), dimensionFields.CompanyID);
  normalized.lines = party.lines;
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

async function saveJournalDraft(idToken, jvData) {
  try {
    return await saveJournalRecord_(
      idToken, 'JV',
      String(jvData.JVID || '').trim(),
      String(jvData.JVDate || '').trim(),
      String(jvData.Description || '').trim(),
      String(jvData.Reference || '').trim(),
      jvData.Lines,
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

    const coaData = await getCoaData_(idToken);
    const normalized = validateAndNormalizeLines_(existing.Lines, coaData, existing.CompanyID);

    if (normalized.lines.length < 2) throw new Error('A journal entry needs at least two lines.');
    if (normalized.totalDebit === 0) throw new Error('Entry has no amounts.');
    if (Math.abs(normalized.totalDebit - normalized.totalCredit) > 0.005) {
      throw new Error('Entry is not balanced: total debit ' + normalized.totalDebit.toFixed(2) + ' vs total credit ' + normalized.totalCredit.toFixed(2) + '.');
    }
    // The authoritative allocation check: under the lock, against what is
    // outstanding right now, not the draft's snapshot.
    const party = await resolvePartyLines(attachPartyFields(existing.Lines, normalized.lines), existing.CompanyID);
    normalized.lines = party.lines;

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
    const scopeKey = await resolveApprovalScopeKeyForDocument_(idToken, moduleId, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance_(idToken, moduleId, jvId, jvNumber, scopeKey, normalized.totalDebit, user.uid);

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
    await requirePostAccess_(idToken, user, moduleIdForEntry_(existing));
    if (existing.Status !== 'Posted') throw new Error('Only posted entries can be reversed.');
    if (existing.ReversedByJV) throw new Error('This entry has already been reversed.');
    // [PORT FIX jv-reverse-only-journal-and-cbt] a stock/invoice entry must be reversed by its own module, which
    // also undoes the stock and the source document.
    if (existing.VoucherType && STOCK_VOUCHER_TYPE_TO_MODULE[existing.VoucherType]) {
      throw new Error('This entry was posted by ' + existing.VoucherType + ' — reverse it from that module, not here.');
    }
    // Reversing releases this entry's allocations (it stops being live);
    // refused while something else has settled one of its New Refs.
    await assertEntryReversible(jvId, existing);

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    // The reversal keeps the party tags (for statements) but allocates
    // nothing itself.
    const reversedLines = (existing.Lines || []).map(line => {
      const l = Object.assign({}, line, { Debit: line.Credit, Credit: line.Debit });
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
function buildLinesFromVoucher_(voucherType, selectedAccountCode, oppositeLines, headerDescription, headerDimensions) {
  const config = CBT_VOUCHER_CONFIG[voucherType];
  if (!config) throw new Error('Unknown transaction type: ' + voucherType);

  const rawLines = [];

  (oppositeLines || []).forEach((line, idx) => {
    const code = String(line.AccountCode || '').trim();
    if (!code) return;
    if (code === selectedAccountCode) {
      throw new Error('Line ' + (idx + 1) + ': cannot use the same account selected as the ' + (config.ledgerPrefix === '10' ? 'cash' : 'bank') + ' ledger.');
    }
    const amount = parseAmountServer_(line.Amount);
    if (amount <= 0) throw new Error('Line ' + (idx + 1) + ': enter an amount greater than zero.');

    rawLines.push({
      AccountCode: code,
      Description: String(line.Description || '').trim(),
      Debit: config.ledgerIsDebit ? 0 : amount,
      Credit: config.ledgerIsDebit ? amount : 0,
      CostCenterID: String(line.CostCenterID || ''),
      ProfitCenterID: String(line.ProfitCenterID || ''),
      // Party tag and allocations, checked by resolvePartyLines.
      PartyType: line.PartyType, PartyID: line.PartyID, Allocations: line.Allocations
    });
  });

  if (!rawLines.length) throw new Error('Enter at least one line.');

  const total = rawLines.reduce((sum, l) => sum + l.Debit + l.Credit, 0);
  const dim = headerDimensions || {};

  rawLines.unshift({
    AccountCode: selectedAccountCode,
    Description: String(headerDescription || '').trim(),
    Debit: config.ledgerIsDebit ? total : 0,
    Credit: config.ledgerIsDebit ? 0 : total,
    CostCenterID: String(dim.CostCenterID || ''),
    ProfitCenterID: String(dim.ProfitCenterID || '')
  });

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
    if (!selectedAccountCode) throw new Error('Select a cash or bank ledger.');

    const companyId = String(cbtData.CompanyID || '').trim();

    const coaData = await getCoaData_(idToken);
    const selectedAccount = Object.keys(coaData)
      .map(id => Object.assign({ AccountID: id }, coaData[id]))
      .find(a => String(a.AccountCode) === selectedAccountCode);

    if (!selectedAccount) throw new Error('Selected ledger account not found.');
    if (selectedAccount.Status !== 'Active') throw new Error('Selected ledger account is inactive.');
    if (selectedAccount.IsPostable !== true) throw new Error('Selected ledger account is a header account and cannot be posted to.');
    if (String(selectedAccount.AccountCode).substring(0, 2) !== config.ledgerPrefix) {
      throw new Error('Selected account is not a valid ' + (config.ledgerPrefix === '10' ? 'Cash' : 'Bank') + ' ledger account.');
    }
    if (selectedAccount.CompanyID && selectedAccount.CompanyID !== companyId) {
      throw new Error('Selected ledger account is restricted to a specific company — select that company for this entry.');
    }

    const rawLines = buildLinesFromVoucher_(
      voucherType, selectedAccountCode, cbtData.OppositeLines,
      cbtData.Description,
      { CostCenterID: cbtData.CostCenterID, ProfitCenterID: cbtData.ProfitCenterID }
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
      { VoucherType: voucherType, SelectedAccountCode: selectedAccountCode }
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

// One party's open items in this company, outstanding > 0.
async function getPartyOpenItems(idToken, partyType, partyId, companyId) {
  const user = await requireUser_(idToken);
  await requireJournalAccess_(user);
  const id = String(companyId || '').trim();
  if (!id) throw new Error('Select a Company first.');
  if (!userCanAccessCompany_(user.profile, id)) throw new Error('You do not have access to that company.');
  return listOpenItems(String(partyType || '').trim(), String(partyId || '').trim(), id);
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

exports.getJournalEntries = callable(getJournalEntries, ['limit']);
exports.getCbtEntries = callable(getCbtEntries, ['limit']);
exports.saveJournalDraft = callable(saveJournalDraft, ['jvData']);
exports.saveCbtDraft = callable(saveCbtDraft, ['cbtData']);
exports.deleteJournalDraft = callable(deleteJournalDraft, ['jvId']);
exports.postJournalEntry = callable(postJournalEntry, ['jvId']);
exports.decideJournalEntryApproval = callable(decideJournalEntryApproval, ['jvId', 'levelNumber', 'decision', 'reason']);
exports.reverseJournalEntry = callable(reverseJournalEntry, ['jvId', 'reversalDate']);
exports.getPartyAccounts = callable(getPartyAccounts, ['companyId']);
exports.getPartyOpenItems = callable(getPartyOpenItems, ['partyType', 'partyId', 'companyId']);
