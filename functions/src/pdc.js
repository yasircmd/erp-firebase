// PDC Received and PDC Issued — post-dated cheques (roadmap #5,
// docs/modules/PDC.md). New development, hand-written on the returns'
// model. One engine for both directions:
//
//   Received (from a customer)            Issued (to a vendor)
//   post:  Dr PDC Received Clearing       Dr Vendor payables (tagged)
//          Cr Customer receivables (tagged)   Cr PDC Issued Clearing
//   clear: Dr Bank (chosen at clearing)   Dr PDC Issued Clearing
//          Cr PDC Received Clearing           Cr Bank (the cheque's own)
//
// Bounce and Cancel reverse the post entry (the party owes / is owed
// again, and its invoice allocations are released because the entry is
// no longer live). Undo clearing reverses the clear entry and puts the
// cheque back to Pending. The clearing accounts are fixed per company
// (Company Master). Every GL entry is a normal journalEntries record
// with its own VoucherType, so the JV screen won't reverse it and GL
// Report drill-through opens this screen.
//
// Storage: RTDB pdcCheques/{id}. Status: Draft → PendingApproval /
// Rejected → Committing → Pending → Cleared, or Bounced / Cancelled.
// JVIDs lists every GL entry the cheque has posted (drill-through).
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, parseAmountServer, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { PARTY_TYPES, resolvePartyLines, assertEntryReversible, listOpenItems } = require('./partyLedger');

const onCallOptions = { region: 'us-central1' };
const PATH = 'pdcCheques';

const DIRECTIONS = {
  Received: {
    moduleId: 'PDCRECEIVED', label: 'PDC Received', partyType: 'Customer', partyField: 'CustomerID',
    clearingField: 'PdcReceivedClearingAccountID', clearingLabel: 'PDC Received Clearing Account',
    postType: 'PDCReceived', clearType: 'PDCReceivedClear'
  },
  Issued: {
    moduleId: 'PDCISSUED', label: 'PDC Issued', partyType: 'Vendor', partyField: 'VendorID',
    clearingField: 'PdcIssuedClearingAccountID', clearingLabel: 'PDC Issued Clearing Account',
    postType: 'PDCIssued', clearType: 'PDCIssuedClear'
  }
};
// Cheques that still hold their number: a duplicate of any of these is
// refused. Bounced and Cancelled ones free it (a replacement may reuse it).
const HOLDS_NUMBER = ['Draft', 'Rejected', 'PendingApproval', 'Committing', 'Pending', 'Cleared'];

const round2 = n => Math.round(n * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const todayUtc = () => new Date().toISOString().substring(0, 10);
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function directionOf(d) {
  const cfg = DIRECTIONS[String(d || '').trim()];
  if (!cfg) throw new HttpsError('invalid-argument', 'Direction must be Received or Issued.');
  return cfg;
}

async function requireCap(cfg, cap, role) {
  if (await moduleHasCapability(cfg.moduleId, cap, role)) return;
  if (cap === 'access') throw new HttpsError('permission-denied', 'You do not have access to ' + cfg.label + '.');
  if (cap === 'draft') throw new Error('You do not have permission to create or edit entries in ' + cfg.moduleId + '.');
  throw new Error('You do not have permission to post, clear or reverse entries in ' + cfg.moduleId + '.');
}

async function loadPdc(pdcId) {
  const rec = (await rtdb.ref(PATH + '/' + pdcId).get()).val();
  if (!rec || !DIRECTIONS[rec.Direction]) throw new HttpsError('not-found', 'PDC not found.');
  return rec;
}

function requireCompany(user, companyId) {
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}

// Cash and bank accounts by their group's Cash / Bank mark, as in CBT (docs/modules/COA_NUMBERING.md).
const { isCashOrBank, isBank } = require('./coaScheme');

function assertBankAccount(account, companyId, what) {
  if (!account) throw new Error(what + ' was not found.');
  if (account.Status !== 'Active' || account.IsPostable !== true) throw new Error(what + ' must be an active, postable account.');
  if (!isBank(account)) throw new Error(what + ' must be a bank account (under a group marked Bank in the Chart of Accounts).');
  if (account.CompanyID && account.CompanyID !== companyId) throw new Error(what + ' belongs to a different company.');
}

// The company's clearing account for this direction, checked for use.
async function resolveClearingAccount(cfg, companyId, coa) {
  const company = ((await rtdb.ref('companies/' + companyId).get()).val()) || {};
  const id = company[cfg.clearingField];
  if (!id) throw new Error('This company has no ' + cfg.clearingLabel + ' configured. Set one in Company Master Data first.');
  const account = coa[id];
  if (!account || account.Status !== 'Active' || account.IsPostable !== true) {
    throw new Error('This company\'s ' + cfg.clearingLabel + ' is no longer valid — check it in Company Master Data.');
  }
  if (isCashOrBank(account)) throw new Error('The ' + cfg.clearingLabel + ' must not be a cash or bank account — check it in Company Master Data.');
  const [vendors, customers] = await Promise.all([rtdb.ref('vendors').get(), rtdb.ref('customers').get()]);
  const control = [...Object.values(vendors.val() || {}).map(v => v.TradePayablesAccountID),
    ...Object.values(customers.val() || {}).map(c => c.TradeReceivablesAccountID)];
  if (control.includes(id)) throw new Error('The ' + cfg.clearingLabel + ' must not be a vendor or customer account — check it in Company Master Data.');
  return account;
}

// The party's line of the post entry, with its allocations validated by
// partyLedger (own control account, open items of this party, opposite
// side, within outstanding right now). Authoritative only under the lock.
async function resolvePartyLine(cfg, doc, coa) {
  const pcfg = PARTY_TYPES[cfg.partyType];
  const party = (await rtdb.ref(pcfg.path + '/' + doc.PartyID).get()).val();
  if (!party) throw new Error(cfg.partyType + ' not found.');
  const account = coa[party[pcfg.accountField]];
  if (!account) throw new Error('This ' + cfg.partyType.toLowerCase() + ' has no ' + pcfg.accountLabel + ' account configured. Set one in ' + cfg.partyType + ' Master Data.');
  const amount = round2(doc.Amount);
  const received = cfg.partyType === 'Customer';
  // The screen sends what the cheque settles (Against); the rest of the
  // cheque is kept as an advance (one New Ref).
  const against = (doc.Allocations || []).filter(a => a.RefType !== 'New');
  const againstTotal = round2(against.reduce((sum, a) => sum + (Number(a.Amount) || 0), 0));
  if (againstTotal > amount + 0.005) {
    throw new Error('The allocations (' + againstTotal.toFixed(2) + ') are more than the cheque amount (' + amount.toFixed(2) + ').');
  }
  const allocations = against.concat(amount - againstTotal > 0.005 ? [{ RefType: 'New', RefID: '', Amount: round2(amount - againstTotal) }] : []);
  const line = {
    LineNo: 1, AccountID: party[pcfg.accountField], AccountCode: account.AccountCode, AccountName: account.AccountName,
    Debit: received ? 0 : amount, Credit: received ? amount : 0,
    CostCenterID: doc.CostCenterID || '', ProfitCenterID: doc.ProfitCenterID || '',
    PartyType: cfg.partyType, PartyID: doc.PartyID, Allocations: allocations
  };
  let resolved;
  try {
    resolved = await resolvePartyLines([line], doc.CompanyID);
  } catch (err) {
    throw new Error(String(err.message || err).replace(/^Line 1: /, ''));
  }
  return { party, line: resolved.lines[0], fields: resolved.fields };
}

// Refuses a second live record of the same cheque.
async function assertNotDuplicate(doc, excludeId) {
  const all = (await rtdb.ref(PATH).get()).val() || {};
  const dup = Object.keys(all).find(id => {
    const p = all[id];
    if (id === excludeId || p.Direction !== doc.Direction || !HOLDS_NUMBER.includes(p.Status)) return false;
    if (norm(p.ChequeNumber) !== norm(doc.ChequeNumber)) return false;
    return doc.Direction === 'Issued'
      ? p.BankAccountID === doc.BankAccountID
      : p.PartyID === doc.PartyID && norm(p.DraweeBank) === norm(doc.DraweeBank);
  });
  if (dup) {
    const p = all[dup];
    throw new Error('Cheque ' + doc.ChequeNumber + ' is already recorded (' + (p.TransactionNumber || 'draft ' + dup) + ', ' + p.Status + ').');
  }
}

// Builds and checks the stored fields from what the screen sent.
async function buildDoc(cfg, data, user) {
  const companyId = String(data.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company.');
  requireCompany(user, companyId);
  const partyId = String(data.PartyID || '').trim();
  if (!partyId) throw new HttpsError('invalid-argument', 'Select a ' + cfg.partyType + '.');
  const transactionDate = String(data.TransactionDate || '').trim();
  if (!isDate(transactionDate)) throw new HttpsError('invalid-argument', (cfg.partyType === 'Customer' ? 'Receipt' : 'Issue') + ' date is required.');
  const chequeDate = String(data.ChequeDate || '').trim();
  if (!isDate(chequeDate)) throw new HttpsError('invalid-argument', 'Cheque date is required.');
  const chequeNumber = String(data.ChequeNumber || '').trim();
  if (!chequeNumber) throw new HttpsError('invalid-argument', 'Cheque number is required.');
  const amount = round2(parseAmountServer(data.Amount));
  if (!(amount > 0)) throw new HttpsError('invalid-argument', 'Amount must be greater than zero.');
  const description = String(data.Description || '').trim();
  if (!description) throw new HttpsError('invalid-argument', 'Description is required.');

  const doc = {
    Direction: data.Direction, CompanyID: companyId,
    DivisionID: String(data.DivisionID || '').trim(), BranchID: String(data.BranchID || '').trim(),
    CostCenterID: String(data.CostCenterID || '').trim(), ProfitCenterID: String(data.ProfitCenterID || '').trim(),
    PartyType: cfg.partyType, PartyID: partyId,
    TransactionDate: transactionDate, ChequeDate: chequeDate, ChequeNumber: chequeNumber, Amount: amount,
    Reference: String(data.Reference || '').trim(), Description: description,
    Allocations: (data.Allocations || []).map(a => ({
      RefType: String(a.RefType || '').trim(), RefID: String(a.RefID || '').trim(), Amount: round2(parseAmountServer(a.Amount))
    })).filter(a => a.Amount > 0),
    DraweeBank: '', BankAccountID: '', BankAccountCode: '',
    ReplacesPdcID: String(data.ReplacesPdcID || '').trim(), ReplacesPdcNumber: ''
  };

  const coa = (await rtdb.ref('coa').get()).val() || {};
  if (cfg.partyType === 'Customer') {
    doc.DraweeBank = String(data.DraweeBank || '').trim();
    if (!doc.DraweeBank) throw new HttpsError('invalid-argument', 'Enter the bank the cheque is drawn on.');
  } else {
    doc.BankAccountID = String(data.BankAccountID || '').trim();
    if (!doc.BankAccountID) throw new HttpsError('invalid-argument', 'Select the bank account the cheque is drawn on.');
    assertBankAccount(coa[doc.BankAccountID], companyId, 'The bank account');
    doc.BankAccountCode = String(coa[doc.BankAccountID].AccountCode);
  }
  if (doc.ReplacesPdcID) {
    const old = (await rtdb.ref(PATH + '/' + doc.ReplacesPdcID).get()).val();
    if (!old || old.Direction !== doc.Direction || old.PartyID !== partyId || old.Status !== 'Bounced') {
      throw new Error('A replacement must name a bounced ' + cfg.label + ' of the same ' + cfg.partyType.toLowerCase() + '.');
    }
    doc.ReplacesPdcNumber = old.TransactionNumber || '';
  }

  const resolved = await resolvePartyLine(cfg, doc, coa);
  doc.PartyName = resolved.line.PartyName;
  doc.Allocations = resolved.line.Allocations;
  return doc;
}

const actorOf = user => user.profile.username || user.uid;

// ---------- callables ----------

// What the entry screen needs for one company: the parties of this
// direction, the bank accounts, and whether the clearing account is set.
exports.getPdcSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const cfg = directionOf(d.direction);
  await requireCap(cfg, 'access', user.profile.role);
  const companyId = String(d.companyId || '').trim();
  if (!companyId) return { parties: [], bankAccounts: [], clearingConfigured: false };
  requireCompany(user, companyId);
  const pcfg = PARTY_TYPES[cfg.partyType];
  const [partiesSnap, coaSnap, companySnap] = await Promise.all([
    rtdb.ref(pcfg.path).get(), rtdb.ref('coa').get(), rtdb.ref('companies/' + companyId).get()
  ]);
  const parties = partiesSnap.val() || {};
  const coa = coaSnap.val() || {};
  const company = companySnap.val() || {};
  return {
    parties: Object.keys(parties)
      .filter(id => parties[id].Status === 'Active' && (!parties[id].CompanyID || parties[id].CompanyID === companyId))
      .map(id => ({ PartyID: id, Code: parties[id][pcfg.codeField] || '', Name: parties[id][pcfg.nameField] || '' }))
      .sort((a, b) => a.Name.localeCompare(b.Name)),
    bankAccounts: Object.keys(coa)
      .filter(id => {
        const a = coa[id];
        return a.Status === 'Active' && a.IsPostable === true && isBank(a) && (!a.CompanyID || a.CompanyID === companyId);
      })
      .map(id => ({ AccountID: id, AccountCode: String(coa[id].AccountCode), AccountName: coa[id].AccountName || '' }))
      .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true })),
    clearingConfigured: Boolean(company[cfg.clearingField])
  };
});

// The party's open items this cheque can settle (opposite side only).
exports.getPdcOpenItems = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const cfg = directionOf(d.direction);
  await requireCap(cfg, 'access', user.profile.role);
  const companyId = String(d.companyId || '').trim();
  const partyId = String(d.partyId || '').trim();
  if (!companyId || !partyId) return [];
  requireCompany(user, companyId);
  const settles = cfg.partyType === 'Customer' ? 'Dr' : 'Cr';
  return (await listOpenItems(cfg.partyType, partyId, companyId)).filter(i => i.Side === settles);
});

exports.savePdcDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const cfg = directionOf(data.Direction);
  await requireCap(cfg, 'draft', user.profile.role);
  const pdcId = String(data.PdcID || '').trim();
  if (pdcId) {
    const existing = await loadPdc(pdcId);
    requireCompany(user, existing.CompanyID);
    if (existing.Direction !== data.Direction) throw new HttpsError('failed-precondition', 'That PDC belongs to the other screen.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected PDCs can be edited.');
  }
  const doc = await buildDoc(cfg, data, user);
  await assertNotDuplicate(doc, pdcId);

  const now = new Date().toISOString();
  const fields = Object.assign(doc, { Status: 'Draft', UpdatedAt: now, UpdatedBy: actorOf(user) });
  if (pdcId) {
    await rtdb.ref(PATH + '/' + pdcId).update(fields);
    return { success: true, pdcId: pdcId };
  }
  const newId = 'PDC-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref(PATH + '/' + newId).set(Object.assign({}, fields, { JVIDs: [], History: [], CreatedAt: now, CreatedBy: actorOf(user) }));
  return { success: true, pdcId: newId };
});

exports.deletePdcDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const pdcId = String(request.data && request.data.pdcId || '').trim();
  const existing = await loadPdc(pdcId);
  requireCompany(user, existing.CompanyID);
  await requireCap(DIRECTIONS[existing.Direction], 'draft', user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft PDCs can be deleted.');
  await rtdb.ref(PATH + '/' + pdcId).set(null);
  return { success: true };
});

exports.postPdc = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const pdcId = String(request.data && request.data.pdcId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existing = await loadPdc(pdcId);
    const cfg = DIRECTIONS[existing.Direction];
    requireCompany(user, existing.CompanyID);
    await requireCap(cfg, 'post', user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected PDCs can be posted.');

    // Re-validated now, so a stale draft is refused before an approval
    // instance is started for it.
    const coa = (await rtdb.ref('coa').get()).val() || {};
    await resolveClearingAccount(cfg, existing.CompanyID, coa);
    await resolvePartyLine(cfg, existing, coa);
    await assertNotDuplicate(existing, pdcId);

    const now = new Date().toISOString();
    const scopeKey = await resolveApprovalScopeKeyForDocument(cfg.moduleId, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance(cfg.moduleId, pdcId, '', scopeKey, existing.Amount, user.uid);
    if (approval.required) {
      await rtdb.ref(PATH + '/' + pdcId).update({
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '',
        SubmittedAt: now, SubmittedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user)
      });
      return { success: true, status: 'PendingApproval' };
    }
    const result = await commitPdcPosting(user, existing, pdcId);
    return { success: true, pdcId: pdcId, pdcNumber: result.pdcNumber, status: 'Pending' };
  });
});

// Caller holds the global lock. Everything is re-checked from live data.
async function commitPdcPosting(user, existing, pdcId) {
  const cfg = DIRECTIONS[existing.Direction];
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const clearing = await resolveClearingAccount(cfg, existing.CompanyID, coa);
  const { line, fields } = await resolvePartyLine(cfg, existing, coa);
  await assertNotDuplicate(existing, pdcId);

  const amount = round2(existing.Amount);
  const received = existing.Direction === 'Received';
  const label = cfg.label + ' ' + existing.ChequeNumber + ' — ' + existing.Description;
  const dims = { CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' };
  const clearingLine = Object.assign({ AccountCode: clearing.AccountCode, Debit: received ? amount : 0, Credit: received ? 0 : amount, Description: label }, dims);
  const partyLine = Object.assign({
    AccountCode: line.AccountCode, Debit: line.Debit, Credit: line.Credit, Description: label,
    PartyType: line.PartyType, PartyID: line.PartyID, PartyName: line.PartyName, Allocations: line.Allocations
  }, dims);
  const glLines = received ? [clearingLine, partyLine] : [partyLine, clearingLine];

  const actor = actorOf(user);
  const attemptId = await beginCommitAttempt(pdcId, actor, PATH);
  let glResult;
  try {
    glResult = await writeStockGlEntry(user, cfg.postType, existing.TransactionDate, label, existing.Reference || existing.ChequeNumber,
      glLines, dimsOf(existing),
      Object.assign({ CommitAttemptID: attemptId, SourceTransactionID: pdcId, ReversalOfJV: '' }, fields));
  } catch (err) {
    await abandonCommitAttempt(pdcId, existing.Status, actor, PATH);
    throw err;
  }
  await finalizeCommitAttempt(pdcId, glResult, {
    Status: 'Pending', Allocations: line.Allocations, PartyName: line.PartyName,
    JVIDs: [glResult.jvId], History: historyWith(existing, 'Posted', existing.TransactionDate, glResult, actor)
  }, actor, PATH);
  return { pdcNumber: glResult.jvNumber };
}

function dimsOf(p) {
  return { CompanyID: p.CompanyID, DivisionID: p.DivisionID, BranchID: p.BranchID, CostCenterID: p.CostCenterID, ProfitCenterID: p.ProfitCenterID };
}

function historyWith(p, event, date, glResult, actor, reason) {
  return (p.History || []).concat([{
    Event: event, Date: date, JVID: glResult ? glResult.jvId : '', JVNumber: glResult ? glResult.jvNumber : '',
    Reason: reason || '', At: new Date().toISOString(), By: actor
  }]);
}

exports.decidePdcApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const pdcId = String(data.pdcId || '').trim();
  const levelNumber = data.levelNumber;
  const decision = data.decision;
  const reason = data.reason;

  return withGlobalLock(user.uid, async () => {
    const existing = await loadPdc(pdcId);
    await requireCap(DIRECTIONS[existing.Direction], 'post', user.profile.role);
    requireCompany(user, existing.CompanyID);
    if (existing.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This PDC is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this PDC.');

    const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, levelNumber, decision, reason);
    const now = new Date().toISOString();
    if (result.status === 'Approved') {
      try {
        const commit = await commitPdcPosting(user, existing, pdcId);
        return { success: true, status: 'Approved', pdcNumber: commit.pdcNumber, selfApproved: result.selfApproved };
      } catch (err) {
        // As the returns: undo the decision and hand the PDC back for
        // editing rather than leave it stuck.
        const instance = (await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).get()).val();
        if (instance) {
          await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).update({
            Decisions: (instance.Decisions || []).filter(x => x.LevelNumber !== levelNumber), Status: 'Pending', UpdatedAt: now
          });
        }
        await rtdb.ref(PATH + '/' + pdcId).update({
          Status: 'Rejected', RejectionReason: 'Posting failed and could not be completed: ' + err.message + ' — please fix and resubmit.',
          UpdatedAt: now, UpdatedBy: actorOf(user)
        });
        throw new Error('Posting failed: ' + err.message + ' The PDC has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      await rtdb.ref(PATH + '/' + pdcId).update({ Status: 'Rejected', RejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actorOf(user) });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

// Clears one or more Pending cheques of one direction, each with its own
// GL entry. All are checked before any is posted.
exports.clearPdcs = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const ids = [...new Set((d.pdcIds || []).map(x => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) throw new HttpsError('invalid-argument', 'Select at least one PDC to clear.');
  const clearDate = String(d.clearDate || '').trim();
  if (!isDate(clearDate)) throw new HttpsError('invalid-argument', 'Clearing date is required.');

  return withGlobalLock(user.uid, async () => {
    const coa = (await rtdb.ref('coa').get()).val() || {};
    const docs = [];
    for (const id of ids) {
      const p = await loadPdc(id);
      const cfg = DIRECTIONS[p.Direction];
      requireCompany(user, p.CompanyID);
      await requireCap(cfg, 'post', user.profile.role);
      const name = (p.TransactionNumber || id) + ': ';
      if (p.Status !== 'Pending') throw new Error(name + 'only a Pending PDC can be cleared (this one is ' + p.Status + ').');
      if (clearDate < p.ChequeDate) throw new Error(name + 'the clearing date is before the cheque date ' + p.ChequeDate + '.');
      if (clearDate < p.TransactionDate) throw new Error(name + 'the clearing date is before the PDC\'s own date ' + p.TransactionDate + '.');
      let bankId = p.BankAccountID;
      if (p.Direction === 'Received') {
        bankId = String(d.depositAccountId || '').trim();
        if (!bankId) throw new HttpsError('invalid-argument', 'Select the bank account the cheque was deposited into.');
      }
      assertBankAccount(coa[bankId], p.CompanyID, name + 'the bank account');
      const clearing = await resolveClearingAccount(cfg, p.CompanyID, coa);
      docs.push({ id: id, p: p, cfg: cfg, bank: coa[bankId], bankId: bankId, clearing: clearing });
    }
    if (new Set(docs.map(x => x.p.Direction)).size > 1) throw new Error('Clear received and issued PDCs separately.');

    const results = [];
    for (const x of docs) {
      const { id, p, cfg, bank, clearing } = x;
      const amount = round2(p.Amount);
      const received = p.Direction === 'Received';
      const label = cfg.label + ' ' + p.ChequeNumber + ' cleared — ' + (p.PartyName || '');
      const dims = { CostCenterID: p.CostCenterID || '', ProfitCenterID: p.ProfitCenterID || '' };
      const bankLine = Object.assign({ AccountCode: bank.AccountCode, Debit: received ? amount : 0, Credit: received ? 0 : amount, Description: label }, dims);
      const clearingLine = Object.assign({ AccountCode: clearing.AccountCode, Debit: received ? 0 : amount, Credit: received ? amount : 0, Description: label }, dims);
      const glLines = received ? [bankLine, clearingLine] : [clearingLine, bankLine];
      const glResult = await writeStockGlEntry(user, cfg.clearType, clearDate, label, p.TransactionNumber || p.ChequeNumber, glLines, dimsOf(p),
        { SourceTransactionID: id, ReversalOfJV: '', PartyKeys: [], AllocatedRefs: [], AllocatedRefTypes: [] });
      const now = new Date().toISOString();
      await rtdb.ref(PATH + '/' + id).update({
        Status: 'Cleared', ClearedDate: clearDate, DepositAccountID: x.bankId, DepositAccountCode: String(bank.AccountCode),
        ClearJVID: glResult.jvId, ClearJVNumber: glResult.jvNumber,
        JVIDs: (p.JVIDs || []).concat([glResult.jvId]), History: historyWith(p, 'Cleared', clearDate, glResult, actorOf(user)),
        UpdatedAt: now, UpdatedBy: actorOf(user)
      });
      results.push({ pdcId: id, clearNumber: glResult.jvNumber });
    }
    return { success: true, cleared: results };
  });
});

// Mirror of a GL entry: every line swapped, party tags kept with no
// allocations (as the returns' reversal).
function mirrorLines(entry, prefix) {
  return (entry.Lines || []).map(l => {
    const out = {
      AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: prefix + (l.Description || ''),
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
    if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
    Object.assign(out, require('./fx').mirrorFc(l), l.FxAdjustment ? { FxAdjustment: true } : {}); // foreign amounts swap too (MULTI_CURRENCY.md)
    return out;
  });
}

async function reverseGlEntry(user, jvId, voucherType, date, description, reference, dims, extra) {
  const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(jvId);
  const glDoc = await glRef.get();
  if (!glDoc.exists) throw new Error('The GL entry of this PDC was not found.');
  const entry = glDoc.data();
  if (entry.ReversedByJV) throw new Error('That GL entry has already been reversed.');
  if (date < entry.JVDate) throw new Error('The date is before the entry being reversed (' + entry.JVDate + ').');
  const glResult = await writeStockGlEntry(user, voucherType, date, description, reference, mirrorLines(entry, description + ' — '), dims,
    Object.assign({ SourceTransactionID: entry.SourceTransactionID || '', ReversalOfJV: jvId, PartyKeys: entry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] }, extra || {}));
  // The original is marked straight away, so a second reversal can't start.
  await glRef.update({ ReversedByJV: glResult.jvId, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) });
  return glResult;
}

// Bounce or Cancel: reverses the post entry, releasing its allocations.
// Refused on a Cleared cheque (undo the clearing first) and while a New
// Ref it created has been settled by another entry.
async function closePdc(request, event) {
  const user = await requireUser(request);
  const d = request.data || {};
  const pdcId = String(d.pdcId || '').trim();
  const date = String(d.date || '').trim();
  const reason = String(d.reason || '').trim();
  if (!isDate(date)) throw new HttpsError('invalid-argument', 'Date is required.');
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');

  return withGlobalLock(user.uid, async () => {
    const p = await loadPdc(pdcId);
    const cfg = DIRECTIONS[p.Direction];
    requireCompany(user, p.CompanyID);
    await requireCap(cfg, 'post', user.profile.role);
    if (p.Status === 'Cleared') throw new HttpsError('failed-precondition', 'This PDC has cleared — undo the clearing first.');
    if (p.Status !== 'Pending') throw new HttpsError('failed-precondition', 'Only a Pending PDC can be ' + event.toLowerCase() + '.');
    if (date < p.TransactionDate) throw new Error('The date is before the PDC\'s own date ' + p.TransactionDate + '.');

    const glDoc = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(p.LinkedJVID).get();
    if (!glDoc.exists) throw new Error('The GL entry of this PDC was not found.');
    await assertEntryReversible(p.LinkedJVID, Object.assign({}, glDoc.data(), { ReversalOfJV: '' }));

    const description = cfg.label + ' ' + p.ChequeNumber + ' ' + event.toLowerCase() + ' — ' + reason;
    const glResult = await reverseGlEntry(user, p.LinkedJVID, cfg.postType, date, description, p.TransactionNumber, dimsOf(p), { PdcEvent: event });
    const now = new Date().toISOString();
    await rtdb.ref(PATH + '/' + pdcId).update({
      Status: event, ClosedDate: date, ClosedReason: reason, ReversalJVID: glResult.jvId, ReversalJVNumber: glResult.jvNumber,
      JVIDs: (p.JVIDs || []).concat([glResult.jvId]), History: historyWith(p, event, date, glResult, actorOf(user), reason),
      UpdatedAt: now, UpdatedBy: actorOf(user)
    });
    return { success: true, reversalNumber: glResult.jvNumber };
  });
}

exports.bouncePdc = onCallWithMessages(onCallOptions, request => closePdc(request, 'Bounced'));
exports.cancelPdc = onCallWithMessages(onCallOptions, request => closePdc(request, 'Cancelled'));

// A clearing entered by mistake: reverses the clear entry, back to Pending.
exports.undoPdcClearing = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const pdcId = String(d.pdcId || '').trim();
  const date = String(d.date || '').trim();
  const reason = String(d.reason || '').trim();
  if (!isDate(date)) throw new HttpsError('invalid-argument', 'Date is required.');
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');

  return withGlobalLock(user.uid, async () => {
    const p = await loadPdc(pdcId);
    const cfg = DIRECTIONS[p.Direction];
    requireCompany(user, p.CompanyID);
    await requireCap(cfg, 'post', user.profile.role);
    if (p.Status !== 'Cleared' || !p.ClearJVID) throw new HttpsError('failed-precondition', 'Only a Cleared PDC can have its clearing undone.');

    const description = 'Clearing undone: ' + cfg.label + ' ' + p.ChequeNumber + ' — ' + reason;
    const glResult = await reverseGlEntry(user, p.ClearJVID, cfg.clearType, date, description, p.TransactionNumber, dimsOf(p), {});
    const now = new Date().toISOString();
    await rtdb.ref(PATH + '/' + pdcId).update({
      Status: 'Pending', ClearedDate: '', DepositAccountID: '', DepositAccountCode: '', ClearJVID: '', ClearJVNumber: '',
      JVIDs: (p.JVIDs || []).concat([glResult.jvId]), History: historyWith(p, 'Clearing undone', date, glResult, actorOf(user), reason),
      UpdatedAt: now, UpdatedBy: actorOf(user)
    });
    return { success: true, reversalNumber: glResult.jvNumber };
  });
});

// Every PDC of one direction the user's companies can see: all that are
// still in play (not Cleared/Bounced/Cancelled) plus the latest 100 of
// the rest, or everything with limit 'all'.
exports.getPdcEntries = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const cfg = directionOf(d.direction);
  await requireCap(cfg, 'access', user.profile.role);
  const data = (await rtdb.ref(PATH).get()).val() || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ PdcID: id }, data[id]))
    .filter(e => e.Direction === d.direction && userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  if (d.limit === 'all') return { entries: all, total: all.length };
  const done = ['Cleared', 'Bounced', 'Cancelled'];
  const open = all.filter(e => !done.includes(e.Status));
  const closed = all.filter(e => done.includes(e.Status)).slice(0, 100);
  return { entries: open.concat(closed).sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || '')), total: all.length };
});

// Home screen: Pending cheques dated up to today, for the directions the
// user can clear, in the user's companies.
// Home: PDCs to clear. Where the module has a Treasury follow-up team for the
// cheque's scope (Approval Configuration; owner, 2026-10-16, UX_TIER3.md B,
// decisions 154-155), only the team sees it, from DaysBefore days before the
// cheque date; elsewhere, as before, everyone who may post PDCs, from the date.
exports.getPdcsDueForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const asOf = isDate(request.data && request.data.today) ? request.data.today : todayUtc();
  const { scopeKeyFor, pdcDaysBefore } = require('./followUps');
  const rights = {};
  for (const dir of Object.keys(DIRECTIONS)) {
    const m = DIRECTIONS[dir].moduleId;
    rights[dir] = { access: await moduleHasCapability(m, 'access', user.profile.role), post: await moduleHasCapability(m, 'post', user.profile.role) };
  }
  if (!Object.values(rights).some(r => r.access)) return [];
  const [data, configs, teams, days] = await Promise.all([rtdb.ref(PATH).get().then(s => s.val() || {}), rtdb.ref('approvalConfigurations').get().then(s => s.val() || {}),
    rtdb.ref('approvalFollowUps').get().then(s => s.val() || {}), pdcDaysBefore()]);
  const plusDays = n => { const d = new Date(asOf + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const horizon = plusDays(days);
  const mine = p => {
    const m = DIRECTIONS[p.Direction] && DIRECTIONS[p.Direction].moduleId;
    if (!m || !rights[p.Direction].access) return false;
    const key = scopeKeyFor((configs[m] || {}).ScopeType, p);
    const team = (key && (((teams[m] || {})[key]) || {}).UserIDs) || [];
    if (team.length) return team.includes(user.uid) && p.ChequeDate <= horizon;
    return rights[p.Direction].post && p.ChequeDate <= asOf;
  };
  return Object.keys(data)
    .map(id => Object.assign({ PdcID: id }, data[id]))
    .filter(p => p.Status === 'Pending' && userCanAccessCompany(user.profile, p.CompanyID) && mine(p))
    .map(p => ({
      ModuleID: DIRECTIONS[p.Direction].moduleId, ModuleLabel: DIRECTIONS[p.Direction].label, DocumentID: p.PdcID,
      DocumentNumber: p.TransactionNumber || '', ChequeNumber: p.ChequeNumber, ChequeDate: p.ChequeDate,
      PartyName: p.PartyName || '', Amount: p.Amount, Overdue: p.ChequeDate < asOf
    }))
    .sort((a, b) => (a.ChequeDate + a.DocumentNumber).localeCompare(b.ChequeDate + b.DocumentNumber));
});

// For the party statements: the party's PDCs pending as at a date —
// posted on or before it and not yet cleared, bounced or cancelled by then.
async function pendingPdcsForParty(partyType, partyId, companyId, asOf) {
  return pendingPdcsFrom((await rtdb.ref(PATH).get()).val() || {}, partyType, partyId, companyId, asOf);
}
// The same from the PDCs already read (the aging reports read them once for
// every party, docs/modules/AGING_REPORTS.md).
function pendingPdcsFrom(data, partyType, partyId, companyId, asOf) {
  return Object.keys(data)
    .map(id => Object.assign({ PdcID: id }, data[id]))
    .filter(p => {
      if (p.PartyType !== partyType || p.PartyID !== partyId || p.CompanyID !== companyId) return false;
      if (!['Pending', 'Cleared', 'Bounced', 'Cancelled'].includes(p.Status) || !(p.TransactionDate <= asOf)) return false;
      const closedOn = p.Status === 'Cleared' ? p.ClearedDate : (p.Status === 'Pending' ? '' : p.ClosedDate);
      return !closedOn || closedOn > asOf;
    })
    .map(p => ({
      PdcID: p.PdcID, Direction: p.Direction, Number: p.TransactionNumber || '', LinkedJVID: p.LinkedJVID || '',
      Date: p.TransactionDate, ChequeDate: p.ChequeDate, ChequeNumber: p.ChequeNumber,
      Bank: p.Direction === 'Received' ? p.DraweeBank : p.BankAccountCode, Amount: round2(p.Amount)
    }))
    .sort((a, b) => (a.ChequeDate + a.Number).localeCompare(b.ChequeDate + b.Number));
}

exports.pendingPdcsForParty = pendingPdcsForParty;
exports.pendingPdcsFrom = pendingPdcsFrom;
exports.PDC_PATH = PATH;
exports.DIRECTIONS = DIRECTIONS;
