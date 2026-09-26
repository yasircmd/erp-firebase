// Asset Capitalization (FAACQ) and Additional Depreciation (FAADDDEP):
// the posting documents of the Fixed Assets sub-ledger
// (docs/modules/FIXED_ASSETS.md → Accounting, Additional depreciation).
//
//   Capitalization  Dr Asset cost · Cr FA Clearing, from open clearing
//                   lines (Vendor Invoice, CBT, JV). The first on an
//                   asset capitalizes it; later ones are Additions.
//   TakeOver        an asset bought before go-live, already in the GL:
//                   cost, accumulated depreciation and last depreciated
//                   period; no GL entry.
//   AdditionalDepreciation   Dr Additional depreciation expense (or
//                   depreciation expense) · Cr Accumulated depreciation.
//
// Draft → PendingApproval / Rejected (if gated) → Posted → Reversed.
// Posting writes the GL entry, one transaction per asset, the asset
// balances, the posting and the clearing usage in ONE Firestore commit.
// A reversal mirrors it, dated the same day as what it reverses (so
// every as-at report stays consistent), and is refused while the asset
// has a later financial transaction (e.g. depreciation posted after it).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany, buildStockGlEntry, generateStockVoucherNumber, parseAmountServer, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const E = require('./faDepreciation');
const C = require('./fixedAssetsCommon');
const { COL, AREA, str, round2 } = C;

const onCallOptions = { region: 'us-central1' };
const TYPES = {
  Capitalization: { moduleId: 'FAACQ', label: 'Capitalization', voucher: 'FACapitalization' },
  TakeOver: { moduleId: 'FAACQ', label: 'Take-over', voucher: 'FATakeOver' },
  AdditionalDepreciation: { moduleId: 'FAADDDEP', label: 'Additional Depreciation', voucher: 'FAAdditionalDepreciation' }
};
const depreciates = kind => kind === 'Tangible' || kind === 'Intangible';
const amt = v => round2(parseAmountServer(v));
const itemKey = (jvId, lineNo) => jvId + '_' + lineNo;

function typeOf(t) {
  const cfg = TYPES[str(t)];
  if (!cfg) throw new HttpsError('invalid-argument', 'Unknown posting type.');
  return cfg;
}

// ---------- open clearing items ----------

// Every posted debit line on this company's clearing account(s), less
// what has been capitalized from it. Reversed entries and reversals are
// not items. Credits on clearing (a debit note, a correction) are
// returned separately: they lower the balance but aren't capitalized.
async function clearingItems(companyId) {
  const accounts = await C.clearingAccountIds(companyId);
  if (!accounts.size) return { items: [], credits: [], accounts: [] };
  const [entries, uses] = await Promise.all([
    firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).where('Status', '==', 'Posted').get(),
    C.listWhere(COL.clearingUse, 'CompanyID', companyId)
  ]);
  const used = {};
  uses.forEach(u => { used[u._id] = round2(u.Capitalized || 0); });
  const vendorNames = (await rtdb.ref('vendors').get()).val() || {};
  const items = [];
  const credits = [];
  entries.docs.forEach(doc => {
    const e = doc.data();
    if (e.ReversedByJV || e.ReversalOfJV) return;
    (e.Lines || []).forEach((l, idx) => {
      if (!accounts.has(l.AccountID)) return;
      const lineNo = l.LineNo || idx + 1;
      const base = {
        JVID: doc.id, LineNo: lineNo, JVNumber: e.JVNumber || '', JVDate: e.JVDate || '', VoucherType: e.VoucherType || 'JV',
        AccountID: l.AccountID, AccountCode: l.AccountCode, Description: l.Description || e.Description || '',
        Reference: e.Reference || '', VendorID: e.VendorID || '', SourceTransactionID: e.SourceTransactionID || ''
      };
      if (base.VendorID && vendorNames[base.VendorID]) base.VendorName = vendorNames[base.VendorID].VendorName || '';
      if (round2(l.Debit || 0) > 0) {
        const open = round2((l.Debit || 0) - (used[itemKey(doc.id, lineNo)] || 0));
        items.push(Object.assign(base, { Amount: round2(l.Debit), Capitalized: used[itemKey(doc.id, lineNo)] || 0, Open: open }));
      } else if (round2(l.Credit || 0) > 0 && !String(e.VoucherType || '').startsWith('FA')) {
        credits.push(Object.assign(base, { Amount: round2(l.Credit) }));
      }
    });
  });
  const byDate = (a, b) => (a.JVDate + a.JVNumber).localeCompare(b.JVDate + b.JVNumber);
  return { items: items.sort(byDate), credits: credits.sort(byDate), accounts: [...accounts] };
}

exports.getFaClearingItems = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FAACQ', 'access', user.profile.role);
  const companyId = str(request.data && request.data.companyId);
  C.requireCompany(user, companyId);
  const r = await clearingItems(companyId);
  const open = r.items.filter(i => i.Open > 0);
  // The Vendor Invoice behind a VendorInvoice entry, for the asset's supplier and invoice.
  const vi = (await rtdb.ref('vendorInvoices').get()).val() || {};
  open.forEach(i => {
    const inv = i.VoucherType === 'VendorInvoice' ? vi[i.SourceTransactionID] : null;
    if (inv) { i.VendorID = inv.VendorID || ''; i.VendorRefNumber = inv.VendorRefNumber || ''; i.InvoiceNumber = inv.TransactionNumber || i.JVNumber; }
  });
  const vendors = (await rtdb.ref('vendors').get()).val() || {};
  open.forEach(i => { if (i.VendorID && vendors[i.VendorID]) i.VendorName = vendors[i.VendorID].VendorName || ''; });
  return {
    items: open, credits: r.credits,
    openTotal: round2(open.reduce((s, i) => s + i.Open, 0)),
    configured: r.accounts.length > 0
  };
});

// ---------- validation ----------

async function loadAssets(ids) {
  const out = {};
  for (const id of ids) {
    const a = await C.getDoc(COL.assets, id);
    if (!a) throw new HttpsError('not-found', 'Asset not found.');
    out[id] = a;
  }
  return out;
}

// Builds and checks a posting from what the screen sent (or a stored
// draft). With `live`, also returns what posting writes: GL lines,
// transactions and asset updates. Everything is re-read from live data.
async function prepare(user, data) {
  const cfg = typeOf(data.Type);
  const companyId = str(data.CompanyID);
  C.requireCompany(user, companyId);
  const date = str(data.Date);
  if (!E.isDate(date)) throw new HttpsError('invalid-argument', 'Posting date is required.');
  const settings = await C.getSettings(companyId);
  if (settings.RunInProgress) throw new Error('A depreciation run is being posted for this company; finish it in Depreciation Run (Post again) first.');
  const description = str(data.Description) || cfg.label;
  const reason = str(data.Reason);
  if (data.Type === 'AdditionalDepreciation' && !reason) throw new HttpsError('invalid-argument', 'A reason is required for additional depreciation.');

  const rawLines = (data.Lines || []).filter(l => str(l.AssetID));
  if (!rawLines.length) throw new HttpsError('invalid-argument', 'Add at least one asset.');
  const ids = rawLines.map(l => str(l.AssetID));
  if (new Set(ids).size !== ids.length) throw new HttpsError('invalid-argument', 'An asset appears twice; put it on one line.');
  const assets = await loadAssets(ids);
  const chart = await C.coa();
  const classes = {};
  const lines = [];
  for (const [i, raw] of rawLines.entries()) {
    const a = assets[str(raw.AssetID)];
    const name = 'Line ' + (i + 1) + ' (' + a.AssetNumber + '): ';
    if (a.CompanyID !== companyId) throw new HttpsError('invalid-argument', name + 'belongs to a different company.');
    const cls = classes[a.ClassID] || (classes[a.ClassID] = await C.getDoc(COL.classes, a.ClassID));
    if (!cls) throw new Error(name + 'its class was not found.');
    const line = { AssetID: a._id, AssetNumber: a.AssetNumber, AssetDescription: a.Description };
    const area = (a.Areas || {})[AREA] || {};
    const { accounts } = await C.accountsFor(cls, companyId, settings);
    const costAcc = C.requireAccount(accounts, 'AssetCostAccountID', cls, companyId, chart);
    if (depreciates(cls.Kind)) {
      C.requireAccount(accounts, 'AccumDepAccountID', cls, companyId, chart);
      C.requireAccount(accounts, 'DepExpenseAccountID', cls, companyId, chart);
      if (!a.CostCenterID) throw new Error(name + 'has no cost center (depreciation expense needs one).');
    }

    if (data.Type === 'Capitalization') {
      if (!['Planned', 'Active', 'FullyDepreciated'].includes(a.Status)) throw new Error(name + 'a ' + a.Status + ' asset can\'t be capitalized.');
      const items = (raw.Items || []).map(it => ({ JVID: str(it.JVID), LineNo: Number(it.LineNo), Amount: amt(it.Amount) })).filter(it => it.JVID && it.Amount > 0);
      if (!items.length) throw new HttpsError('invalid-argument', name + 'pick at least one clearing item and an amount.');
      line.Items = items;
      line.Amount = round2(items.reduce((s, it) => s + it.Amount, 0));
      line.CostAccountID = costAcc.AccountID;
      if (a.Status === 'Planned' && depreciates(cls.Kind)) {
        const v = Object.assign({}, area, { DepStartDate: area.DepStartDate || date });
        const err = E.validateValuation(v, cls.Kind);
        if (err) throw new Error(name + err);
      }
    } else if (data.Type === 'TakeOver') {
      if (a.Status !== 'Planned') throw new Error(name + 'only an asset that was never capitalized can be taken over.');
      const cost = amt(raw.Cost);
      const accDep = amt(raw.AccDep);
      const capDate = str(raw.CapitalizationDate);
      if (!(cost > 0)) throw new HttpsError('invalid-argument', name + 'cost must be more than zero.');
      if (accDep < 0) throw new HttpsError('invalid-argument', name + 'accumulated depreciation can\'t be negative.');
      if (!E.isDate(capDate) || capDate > date) throw new HttpsError('invalid-argument', name + 'the original capitalization date is required, on or before the take-over date.');
      const residual = round2(Number(area.ResidualValue) || 0);
      if (accDep > round2(cost - residual)) throw new HttpsError('invalid-argument', name + 'accumulated depreciation is more than cost less residual value.');
      const lastDep = str(raw.LastDepPeriod);
      if (accDep > 0 && !E.isPeriod(lastDep)) throw new HttpsError('invalid-argument', name + 'give the last period depreciation was charged for.');
      if (lastDep && (!E.isPeriod(lastDep) || lastDep > E.periodOf(date))) throw new HttpsError('invalid-argument', name + 'the last depreciated period must be on or before the take-over date.');
      Object.assign(line, { Cost: cost, AccDep: accDep, CapitalizationDate: capDate, LastDepPeriod: lastDep, Amount: cost });
      if (raw.YearStartNBV !== '' && raw.YearStartNBV != null) line.YearStartNBV = amt(raw.YearStartNBV);
      if (depreciates(cls.Kind)) {
        const v = Object.assign({}, area, { DepStartDate: area.DepStartDate || capDate });
        const err = E.validateValuation(v, cls.Kind);
        if (err) throw new Error(name + err);
        if (lastDep && lastDep < E.periodOf(v.DepStartDate)) throw new HttpsError('invalid-argument', name + 'the last depreciated period is before the depreciation start.');
      }
    } else {
      if (a.Status !== 'Active') throw new Error(name + 'only an Active asset can take additional depreciation (this one is ' + a.Status + ').');
      if (!depreciates(cls.Kind)) throw new Error(name + 'a ' + cls.Kind + ' asset is not depreciated.');
      if (settings.LastPostedPeriod && E.periodOf(date) <= settings.LastPostedPeriod) {
        throw new HttpsError('invalid-argument', 'The date must be after the last posted depreciation period (' + settings.LastPostedPeriod + ').');
      }
      if (date < (area.DepStartDate || '') || date < (a.CapitalizationDate || '')) throw new HttpsError('invalid-argument', name + 'the date is before the asset\'s depreciation start.');
      const amount = amt(raw.Amount);
      if (!(amount > 0)) throw new HttpsError('invalid-argument', name + 'amount must be more than zero.');
      const max = E.maxAdditional(C.engineAsset(a, await C.assetTxns(a._id)), date);
      if (amount > max) throw new Error(name + 'at most ' + max.toFixed(2) + ' can be charged (NBV less residual value on ' + date + ').');
      line.Amount = amount;
      line.ExpenseAccountID = C.requireAccount(accounts, 'AdditionalDepExpenseAccountID', cls, companyId, chart, 'DepExpenseAccountID').AccountID;
      line.AccumAccountID = C.requireAccount(accounts, 'AccumDepAccountID', cls, companyId, chart).AccountID;
    }
    lines.push(line);
  }

  // Clearing items: posted, on a clearing account of this company, dated
  // on or before the posting, with enough still open for every line
  // drawing on them.
  if (data.Type === 'Capitalization') {
    const accounts = await C.clearingAccountIds(companyId);
    if (!accounts.size) throw new Error('This company has no Fixed Asset Clearing Account — set it in Fixed Asset Configuration → Settings.');
    const want = {};
    lines.forEach(l => l.Items.forEach(it => { const k = itemKey(it.JVID, it.LineNo); want[k] = round2((want[k] || 0) + it.Amount); }));
    const excludePosting = str(data.PostingID);
    for (const k of Object.keys(want)) {
      const [jvId, lineNoStr] = [k.substring(0, k.lastIndexOf('_')), k.substring(k.lastIndexOf('_') + 1)];
      const jv = await C.getDoc(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
      const lineNo = Number(lineNoStr);
      const gl = jv && (jv.Lines || []).find((l, idx) => (l.LineNo || idx + 1) === lineNo);
      if (!jv || jv.Status !== 'Posted' || jv.CompanyID !== companyId || !gl) throw new Error('A clearing item was not found (it may have been deleted).');
      if (jv.ReversedByJV || jv.ReversalOfJV) throw new Error('Clearing item ' + jv.JVNumber + ' has been reversed.');
      if (!accounts.has(gl.AccountID) || !(round2(gl.Debit || 0) > 0)) throw new Error('Line ' + lineNo + ' of ' + jv.JVNumber + ' is not a debit on the Fixed Asset Clearing Account.');
      if (jv.JVDate > date) throw new HttpsError('invalid-argument', 'The posting date is before ' + jv.JVNumber + ' (' + jv.JVDate + ').');
      const use = await C.getDoc(COL.clearingUse, k);
      const usedElsewhere = round2((use && use.Capitalized) || 0) - (use && excludePosting ? round2((use.Uses || []).filter(u => u.PostingID === excludePosting && !u.Reversed).reduce((s, u) => s + u.Amount, 0)) : 0);
      const open = round2(gl.Debit - usedElsewhere);
      if (want[k] > open + 0.005) throw new Error(jv.JVNumber + ' line ' + lineNo + ': only ' + open.toFixed(2) + ' is still open, ' + want[k].toFixed(2) + ' asked.');
      lines.forEach(l => l.Items.forEach(it => {
        if (itemKey(it.JVID, it.LineNo) === k) Object.assign(it, { JVNumber: jv.JVNumber, JVDate: jv.JVDate, AccountID: gl.AccountID, AccountCode: gl.AccountCode });
      }));
    }
  }

  const total = round2(lines.reduce((s, l) => s + (l.Amount || 0), 0));
  return {
    cfg: cfg, settings: settings, assets: assets, classes: classes, chart: chart,
    doc: {
      Type: data.Type, ModuleID: cfg.moduleId, CompanyID: companyId, Date: date, Period: E.periodOf(date),
      Description: description, Reference: str(data.Reference), Reason: reason,
      DivisionID: str(data.DivisionID), BranchID: str(data.BranchID), CostCenterID: str(data.CostCenterID),
      Lines: lines, AssetIDs: ids, Total: total
    }
  };
}

// ---------- drafts, list ----------

exports.getFaPostings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const moduleId = d.moduleId === 'FAADDDEP' ? 'FAADDDEP' : 'FAACQ';
  await C.requireCap(moduleId, 'access', user.profile.role);
  const rows = (await C.listWhere(COL.postings, 'ModuleID', moduleId)).filter(p => userCanAccessCompany(user.profile, p.CompanyID));
  return rows.map(p => Object.assign({ PostingID: p._id }, p)).sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
});

exports.saveFaPostingDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const cfg = typeOf(data.Type);
  await C.requireCap(cfg.moduleId, 'draft', user.profile.role);
  const postingId = str(data.PostingID);
  if (postingId) {
    const existing = await C.getDoc(COL.postings, postingId);
    if (!existing) throw new HttpsError('not-found', 'Posting not found.');
    C.requireCompany(user, existing.CompanyID);
    if (existing.ModuleID !== cfg.moduleId || existing.Type !== data.Type) throw new HttpsError('failed-precondition', 'That document is of another type.');
    if (!['Draft', 'Rejected'].includes(existing.Status)) throw new HttpsError('failed-precondition', 'Only draft or rejected documents can be edited.');
  }
  const { doc } = await prepare(user, data);
  const now = C.nowIso();
  Object.assign(doc, { Status: 'Draft', UpdatedAt: now, UpdatedBy: C.actorOf(user) });
  if (postingId) {
    await firestore.collection(COL.postings).doc(postingId).set(doc, { merge: true });
    return { success: true, postingId: postingId };
  }
  const id = C.newId('FAP');
  await firestore.collection(COL.postings).doc(id).set(Object.assign(doc, { PostingNumber: '', History: [], CreatedAt: now, CreatedBy: C.actorOf(user) }));
  return { success: true, postingId: id };
});

exports.deleteFaPostingDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const existing = await C.getDoc(COL.postings, str(request.data && request.data.postingId));
  if (!existing) throw new HttpsError('not-found', 'Posting not found.');
  C.requireCompany(user, existing.CompanyID);
  await C.requireCap(existing.ModuleID, 'draft', user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only a draft can be deleted.');
  await firestore.collection(COL.postings).doc(existing._id).delete();
  return { success: true };
});

// ---------- post ----------

exports.postFaPosting = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const postingId = str(request.data && request.data.postingId);
  return withGlobalLock(user.uid, async () => {
    const existing = await C.getDoc(COL.postings, postingId);
    if (!existing) throw new HttpsError('not-found', 'Posting not found.');
    C.requireCompany(user, existing.CompanyID);
    await C.requireCap(existing.ModuleID, 'post', user.profile.role);
    if (!['Draft', 'Rejected'].includes(existing.Status)) throw new HttpsError('failed-precondition', 'Only a draft or rejected document can be posted.');
    await C.assertFaPostingOpen(user, existing.CompanyID, existing.Date);
    const prepared = await prepare(user, Object.assign({}, existing, { PostingID: postingId }));

    const now = C.nowIso();
    const scopeKey = await resolveApprovalScopeKeyForDocument(existing.ModuleID, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance(existing.ModuleID, postingId, '', scopeKey, prepared.doc.Total, user.uid);
    if (approval.required) {
      await firestore.collection(COL.postings).doc(postingId).update({
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '',
        SubmittedAt: now, SubmittedBy: C.actorOf(user), UpdatedAt: now, UpdatedBy: C.actorOf(user)
      });
      return { success: true, status: 'PendingApproval' };
    }
    const r = await commitPosting(user, postingId, existing, prepared);
    return { success: true, status: 'Posted', postingNumber: r.postingNumber };
  });
});

exports.decideFaPostingApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const postingId = str(d.postingId);
  return withGlobalLock(user.uid, async () => {
    const existing = await C.getDoc(COL.postings, postingId);
    if (!existing) throw new HttpsError('not-found', 'Posting not found.');
    await C.requireCap(existing.ModuleID, 'post', user.profile.role);
    C.requireCompany(user, existing.CompanyID);
    if (existing.Status !== 'PendingApproval' || !existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'This document is not awaiting approval.');
    const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, d.levelNumber, d.decision, d.reason);
    const now = C.nowIso();
    if (result.status === 'Approved') {
      try {
        await C.assertFaPostingOpen(user, existing.CompanyID, existing.Date);
        const prepared = await prepare(user, Object.assign({}, existing, { PostingID: postingId }));
        const r = await commitPosting(user, postingId, existing, prepared);
        return { success: true, status: 'Approved', postingNumber: r.postingNumber, selfApproved: result.selfApproved };
      } catch (err) {
        // As PDC: undo the decision and hand the document back for editing.
        const instance = (await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).get()).val();
        if (instance) {
          await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).update({
            Decisions: (instance.Decisions || []).filter(x => x.LevelNumber !== d.levelNumber), Status: 'Pending', UpdatedAt: now
          });
        }
        await firestore.collection(COL.postings).doc(postingId).update({
          Status: 'Rejected', RejectionReason: 'Posting failed and could not be completed: ' + err.message + ' — please fix and resubmit.', UpdatedAt: now, UpdatedBy: C.actorOf(user)
        });
        throw new Error('Posting failed: ' + err.message + ' The document has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      await firestore.collection(COL.postings).doc(postingId).update({ Status: 'Rejected', RejectionReason: str(d.reason), UpdatedAt: now, UpdatedBy: C.actorOf(user) });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

function dimsOf(doc) {
  return { CompanyID: doc.CompanyID, DivisionID: doc.DivisionID || '', BranchID: doc.BranchID || '', CostCenterID: doc.CostCenterID || '', ProfitCenterID: '' };
}

// Caller holds the global lock; `prepared` was built under it.
async function commitPosting(user, postingId, existing, prepared) {
  const { doc, assets, chart } = prepared;
  const now = C.nowIso();
  const actor = C.actorOf(user);
  const col = firestore.collection.bind(firestore);
  const batch = firestore.batch();
  const label = TYPES[doc.Type].label;
  let jvId = ''; let jvNumber = ''; let postingNumber = '';

  // GL entry (not for a take-over).
  if (doc.Type !== 'TakeOver') {
    const glLines = [];
    doc.Lines.forEach(l => {
      const a = assets[l.AssetID];
      const dims = { CostCenterID: a.CostCenterID || '', ProfitCenterID: a.ProfitCenterID || '' };
      const text = label + ' ' + a.AssetNumber + ' — ' + a.Description;
      if (doc.Type === 'Capitalization') {
        glLines.push(Object.assign({ AccountCode: chart[l.CostAccountID].AccountCode, Debit: l.Amount, Credit: 0, Description: text }, dims));
        l.Items.forEach(it => glLines.push(Object.assign({ AccountCode: it.AccountCode, Debit: 0, Credit: it.Amount, Description: text + ' (from ' + it.JVNumber + ')' }, dims)));
      } else {
        glLines.push(Object.assign({ AccountCode: chart[l.ExpenseAccountID].AccountCode, Debit: l.Amount, Credit: 0, Description: text + ' — ' + doc.Reason }, dims));
        glLines.push(Object.assign({ AccountCode: chart[l.AccumAccountID].AccountCode, Debit: 0, Credit: l.Amount, Description: text + ' — ' + doc.Reason }, dims));
      }
    });
    const built = await buildStockGlEntry(user, TYPES[doc.Type].voucher, doc.Date, doc.Description, doc.Reference, glLines, dimsOf(doc),
      { SourceTransactionID: postingId, ReversalOfJV: '', FixedAssetPostingID: postingId });
    batch.set(col(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId), built.record);
    jvId = built.jvId; jvNumber = built.jvNumber; postingNumber = built.jvNumber;
  } else {
    postingNumber = await generateStockVoucherNumber('FAO', Number(doc.Date.substring(0, 4)), doc.CompanyID);
  }

  C.assertBatchSize(doc.Lines.length * 3 + 2);
  for (const l of doc.Lines) {
    const a = assets[l.AssetID];
    const area = (a.Areas || {})[AREA] || {};
    const txnId = postingId + '_' + l.AssetID;
    const prev = { PrevStatus: a.Status, PrevCapitalizationDate: a.CapitalizationDate || '', PrevLastDepPeriod: area.LastDepPeriod || '', PrevDepStartDate: area.DepStartDate || '' };
    const txn = Object.assign({
      AssetID: l.AssetID, AssetNumber: a.AssetNumber, CompanyID: doc.CompanyID, Area: AREA, Date: doc.Date, Period: doc.Period,
      PostingID: postingId, PostingNumber: postingNumber, JVID: jvId, JVNumber: jvNumber, Reason: doc.Reason || '',
      ReversedByTxnID: '', CreatedAt: now, CreatedBy: actor
    }, prev);
    const upd = { UpdatedAt: now, UpdatedBy: actor };
    if (doc.Type === 'Capitalization') {
      const first = a.Status === 'Planned';
      Object.assign(txn, { Type: first ? 'Capitalization' : 'Addition', CostDelta: l.Amount, AccDepDelta: 0, ClearingItems: l.Items });
      upd[`Areas.${AREA}.Cost`] = FieldValue.increment(l.Amount);
      upd.Status = 'Active';
      if (first) {
        upd.CapitalizationDate = doc.Date;
        if (!area.DepStartDate && a.ClassKind !== 'Land') upd[`Areas.${AREA}.DepStartDate`] = doc.Date;
      }
      l.Items.forEach(it => {
        const k = itemKey(it.JVID, it.LineNo);
        batch.set(col(COL.clearingUse).doc(k), {
          JVID: it.JVID, LineNo: it.LineNo, JVNumber: it.JVNumber, CompanyID: doc.CompanyID,
          Capitalized: FieldValue.increment(it.Amount),
          Uses: FieldValue.arrayUnion({ PostingID: postingId, AssetID: l.AssetID, AssetNumber: a.AssetNumber, Amount: it.Amount, Reversed: false })
        }, { merge: true });
      });
    } else if (doc.Type === 'TakeOver') {
      Object.assign(txn, { Type: 'TakeOver', CostDelta: l.Cost, AccDepDelta: l.AccDep, CapitalizationDateGiven: l.CapitalizationDate, LastDepPeriodGiven: l.LastDepPeriod });
      if (l.YearStartNBV != null) txn.YearStartNBV = l.YearStartNBV;
      const residual = round2(Number(area.ResidualValue) || 0);
      const fully = a.ClassKind !== 'Land' && round2(l.Cost - residual - l.AccDep) <= 0;
      Object.assign(upd, {
        Status: fully ? 'FullyDepreciated' : 'Active', CapitalizationDate: l.CapitalizationDate,
        [`Areas.${AREA}.Cost`]: l.Cost, [`Areas.${AREA}.AccDep`]: l.AccDep, [`Areas.${AREA}.AccDepScheduled`]: l.AccDep,
        [`Areas.${AREA}.LastDepPeriod`]: l.LastDepPeriod || '', [`Areas.${AREA}.FullyDepreciatedAt`]: fully ? doc.Date : ''
      });
      if (!area.DepStartDate && a.ClassKind !== 'Land') upd[`Areas.${AREA}.DepStartDate`] = l.CapitalizationDate;
    } else {
      Object.assign(txn, { Type: 'AdditionalDepreciation', CostDelta: 0, AccDepDelta: l.Amount });
      upd[`Areas.${AREA}.AccDep`] = FieldValue.increment(l.Amount);
      upd[`Areas.${AREA}.AccDepAdditional`] = FieldValue.increment(l.Amount);
      const residual = round2(Number(area.ResidualValue) || 0);
      if (round2((area.Cost || 0) - residual - (area.AccDep || 0) - l.Amount) <= 0) {
        upd.Status = 'FullyDepreciated'; upd[`Areas.${AREA}.FullyDepreciatedAt`] = doc.Date;
      }
    }
    batch.set(col(COL.txns).doc(txnId), txn);
    batch.update(col(COL.assets).doc(l.AssetID), upd);
  }

  batch.update(col(COL.postings).doc(postingId), Object.assign({}, doc, {
    Status: 'Posted', PostingNumber: postingNumber, JVID: jvId, JVNumber: jvNumber, PostedAt: now, PostedBy: actor,
    UpdatedAt: now, UpdatedBy: actor,
    History: (existing.History || []).concat([{ Event: 'Posted', Date: doc.Date, JVID: jvId, JVNumber: jvNumber, At: now, By: actor }])
  }));
  await batch.commit();
  return { postingNumber: postingNumber };
}

// ---------- reverse ----------

exports.reverseFaPosting = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const postingId = str(d.postingId);
  const reason = str(d.reason);
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  return withGlobalLock(user.uid, async () => {
    const p = await C.getDoc(COL.postings, postingId);
    if (!p) throw new HttpsError('not-found', 'Posting not found.');
    C.requireCompany(user, p.CompanyID);
    await C.requireCap(p.ModuleID, 'post', user.profile.role);
    if (p.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only a posted document can be reversed.');
    const settings = await C.assertFaPostingOpen(user, p.CompanyID, p.Date);
    if (settings.RunInProgress) throw new Error('A depreciation run is being posted for this company; finish it first.');

    // The posting must be each asset's latest financial transaction.
    const own = {};
    for (const l of p.Lines) {
      const txns = await C.assetTxns(l.AssetID);
      const live = txns.filter(t => (t.CostDelta || t.AccDepDelta) && t.Type !== 'Reversal' && !t.ReversedByTxnID)
        .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
      const mine = live.find(t => t.PostingID === postingId);
      if (!mine) throw new Error(l.AssetNumber + ': its transaction of this posting was not found.');
      const later = live.filter(t => t.CreatedAt > mine.CreatedAt);
      if (later.length) {
        const t = later[later.length - 1];
        throw new Error(l.AssetNumber + ' has a later transaction (' + t.Type + (t.Period ? ' ' + t.Period : '') + ', ' + (t.PostingNumber || t.JVNumber || '') + '). Reverse that first.');
      }
      own[l.AssetID] = mine;
    }

    const now = C.nowIso();
    const actor = C.actorOf(user);
    const batch = firestore.batch();
    const col = firestore.collection.bind(firestore);
    let revJv = null;
    if (p.JVID) {
      const orig = await C.getDoc(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, p.JVID);
      if (!orig) throw new Error('The GL entry of this posting was not found.');
      if (orig.ReversedByJV) throw new Error('That GL entry has already been reversed.');
      const lines = (orig.Lines || []).map(l => ({
        AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      }));
      revJv = await buildStockGlEntry(user, orig.VoucherType, p.Date, 'Reversal of ' + p.JVNumber + ' — ' + reason, p.JVNumber, lines, dimsOf(p),
        { SourceTransactionID: postingId, ReversalOfJV: p.JVID, FixedAssetPostingID: postingId });
      batch.set(col(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(revJv.jvId), revJv.record);
      batch.update(col(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(p.JVID), { ReversedByJV: revJv.jvId, UpdatedAt: now, UpdatedBy: actor });
    }

    C.assertBatchSize(p.Lines.length * 4 + 4);
    const clearingUpdates = {};
    for (const l of p.Lines) {
      const t = own[l.AssetID];
      const revId = t._id + '_R';
      batch.set(col(COL.txns).doc(revId), {
        AssetID: l.AssetID, AssetNumber: t.AssetNumber, CompanyID: p.CompanyID, Area: AREA, Type: 'Reversal', ReversalOfTxnID: t._id,
        ReversalOfType: t.Type, Date: t.Date, Period: t.Period, CostDelta: -(t.CostDelta || 0), AccDepDelta: -(t.AccDepDelta || 0),
        PostingID: postingId, PostingNumber: p.PostingNumber, JVID: revJv ? revJv.jvId : '', JVNumber: revJv ? revJv.jvNumber : '',
        Reason: reason, ReversedByTxnID: '', CreatedAt: now, CreatedBy: actor
      });
      batch.update(col(COL.txns).doc(t._id), { ReversedByTxnID: revId });
      const upd = { UpdatedAt: now, UpdatedBy: actor, Status: t.PrevStatus, CapitalizationDate: t.PrevCapitalizationDate };
      if (t.Type === 'TakeOver') {
        Object.assign(upd, {
          [`Areas.${AREA}.Cost`]: 0, [`Areas.${AREA}.AccDep`]: 0, [`Areas.${AREA}.AccDepScheduled`]: 0,
          [`Areas.${AREA}.LastDepPeriod`]: t.PrevLastDepPeriod, [`Areas.${AREA}.DepStartDate`]: t.PrevDepStartDate, [`Areas.${AREA}.FullyDepreciatedAt`]: ''
        });
      } else if (t.Type === 'AdditionalDepreciation') {
        upd[`Areas.${AREA}.AccDep`] = FieldValue.increment(-t.AccDepDelta);
        upd[`Areas.${AREA}.AccDepAdditional`] = FieldValue.increment(-t.AccDepDelta);
        if (t.PrevStatus !== 'FullyDepreciated') upd[`Areas.${AREA}.FullyDepreciatedAt`] = '';
      } else {
        upd[`Areas.${AREA}.Cost`] = FieldValue.increment(-t.CostDelta);
        if (t.Type === 'Capitalization') upd[`Areas.${AREA}.DepStartDate`] = t.PrevDepStartDate;
        (t.ClearingItems || []).forEach(it => {
          const k = itemKey(it.JVID, it.LineNo);
          clearingUpdates[k] = clearingUpdates[k] || [];
          clearingUpdates[k].push({ AssetID: l.AssetID, Amount: it.Amount });
        });
      }
      batch.update(col(COL.assets).doc(l.AssetID), upd);
    }
    for (const k of Object.keys(clearingUpdates)) {
      const use = await C.getDoc(COL.clearingUse, k);
      if (!use) continue;
      const total = round2(clearingUpdates[k].reduce((s, x) => s + x.Amount, 0));
      batch.update(col(COL.clearingUse).doc(k), {
        Capitalized: round2((use.Capitalized || 0) - total),
        Uses: (use.Uses || []).map(u => u.PostingID === postingId ? Object.assign({}, u, { Reversed: true }) : u)
      });
    }
    batch.update(col(COL.postings).doc(postingId), {
      Status: 'Reversed', ReversalJVID: revJv ? revJv.jvId : '', ReversalJVNumber: revJv ? revJv.jvNumber : '',
      ReversalReason: reason, ReversedAt: now, ReversedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      History: (p.History || []).concat([{ Event: 'Reversed', Date: p.Date, JVID: revJv ? revJv.jvId : '', JVNumber: revJv ? revJv.jvNumber : '', Reason: reason, At: now, By: actor }])
    });
    await batch.commit();
    return { success: true, reversalNumber: revJv ? revJv.jvNumber : '' };
  });
});

exports.clearingItems = clearingItems;
