// Fixed Asset Retirement (FARETIRE), phase 2: sale and scrapping of whole
// assets (docs/modules/FIXED_ASSETS.md → Disposal / retirement).
//
// One GL entry per retirement document (voucher FAR):
//   Dr Depreciation Expense · Cr Accumulated Depreciation   depreciation up to the retirement date
//   Dr Accumulated Depreciation (all of it) · Cr Asset Cost
//   Dr Loss on Disposal  or  Cr Gain on Disposal            gain/loss = proceeds − NBV
//   Dr Bank/Cash or Customer (proceeds + VAT) · Cr Output VAT   sale only
// The depreciation up to the date is every unposted month before it plus
// the days of the retirement month before the date (faDepreciation
// .computeToDate), so the date must be after the company's last posted
// depreciation month. The asset becomes Disposed and nothing can be
// posted on it any more except the reversal, which is refused once a
// later depreciation month has been posted for the company.
//
// Documents live in faPostings (Type 'Retirement') and go through the
// same draft / approval / post / reverse calls as the other postings;
// fixedAssetsPostings.js hands them to prepare, commit and reverse here.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { buildStockGlEntry, parseAmountServer, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolvePartyLines, assertEntryReversible, PARTY_TYPES } = require('./partyLedger');
const E = require('./faDepreciation');
const C = require('./fixedAssetsCommon');
const { COL, AREA, str, round2 } = C;

const onCallOptions = { region: 'us-central1' };
const KINDS = { Sale: 'Sale', Scrap: 'Scrapping' };
const depreciates = kind => kind === 'Tangible' || kind === 'Intangible';
const amt = v => round2(parseAmountServer(v));
const isCashOrBank = a => ['10', '11'].includes(String(a.AccountCode || '').substring(0, 2));

// What the screen needs for one company.
exports.getFaRetirementSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FARETIRE', 'access', user.profile.role);
  const companyId = str(request.data && request.data.companyId);
  if (!companyId) return { accounts: [], customers: [], outputTaxConfigured: false, lastPostedPeriod: '' };
  C.requireCompany(user, companyId);
  const [chart, customersSnap, companySnap, settings] = await Promise.all([
    C.coa(), rtdb.ref('customers').get(), rtdb.ref('companies/' + companyId).get(), C.getSettings(companyId)
  ]);
  const customers = customersSnap.val() || {};
  return {
    accounts: Object.keys(chart).filter(id => chart[id].Status === 'Active' && chart[id].IsPostable === true && isCashOrBank(chart[id]) && (!chart[id].CompanyID || chart[id].CompanyID === companyId))
      .map(id => ({ AccountID: id, AccountCode: String(chart[id].AccountCode), AccountName: chart[id].AccountName || '' }))
      .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true })),
    customers: Object.keys(customers).filter(id => customers[id].Status === 'Active' && (!customers[id].CompanyID || customers[id].CompanyID === companyId))
      .map(id => ({ CustomerID: id, Code: customers[id].CustomerCode || '', Name: customers[id].CustomerName || '' }))
      .sort((a, b) => a.Name.localeCompare(b.Name)),
    outputTaxConfigured: Boolean((companySnap.val() || {}).OutputTaxAccountID),
    lastPostedPeriod: settings.LastPostedPeriod || ''
  };
});

// Checks a retirement document and works out every figure from live
// data. Called at save, preview and post (under the global lock).
async function prepare(user, data) {
  const companyId = str(data.CompanyID);
  C.requireCompany(user, companyId);
  const date = str(data.Date);
  if (!E.isDate(date)) throw new HttpsError('invalid-argument', 'The retirement date is required.');
  const kind = str(data.RetirementType);
  if (!KINDS[kind]) throw new HttpsError('invalid-argument', 'Choose Sale or Scrap.');
  const reason = str(data.Reason);
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  const settings = await C.getSettings(companyId);
  if (settings.RunInProgress) throw new Error('A depreciation run is being posted for this company; finish it in Depreciation Run (Post again) first.');
  const period = E.periodOf(date);
  if (settings.LastPostedPeriod && period <= settings.LastPostedPeriod) {
    throw new HttpsError('invalid-argument', 'The retirement date must be after the last posted depreciation month (' + settings.LastPostedPeriod + ').');
  }

  const rawLines = (data.Lines || []).filter(l => str(l.AssetID));
  if (!rawLines.length) throw new HttpsError('invalid-argument', 'Add at least one asset.');
  const ids = rawLines.map(l => str(l.AssetID));
  if (new Set(ids).size !== ids.length) throw new HttpsError('invalid-argument', 'An asset appears twice; put it on one line.');
  const chart = await C.coa();
  const assets = {};
  const classes = {};
  const lines = [];
  for (const [i, raw] of rawLines.entries()) {
    const a = await C.getDoc(COL.assets, str(raw.AssetID));
    if (!a) throw new HttpsError('not-found', 'Asset not found.');
    assets[a._id] = a;
    const name = 'Line ' + (i + 1) + ' (' + a.AssetNumber + '): ';
    if (a.CompanyID !== companyId) throw new HttpsError('invalid-argument', name + 'belongs to a different company.');
    if (!['Active', 'FullyDepreciated'].includes(a.Status)) {
      throw new Error(name + (a.Status === 'Planned' ? 'it was never capitalized — delete it in Fixed Asset Master instead.' : 'a ' + a.Status + ' asset can\'t be retired.'));
    }
    const area = (a.Areas || {})[AREA] || {};
    if (date < (a.CapitalizationDate || '')) throw new HttpsError('invalid-argument', name + 'the date is before its capitalization (' + a.CapitalizationDate + ').');
    if (area.LastDepPeriod && period <= area.LastDepPeriod) throw new HttpsError('invalid-argument', name + 'it is depreciated up to ' + area.LastDepPeriod + '; the date must be after that month.');
    const cls = classes[a.ClassID] || (classes[a.ClassID] = await C.getDoc(COL.classes, a.ClassID));
    if (!cls) throw new Error(name + 'its class was not found.');
    const { accounts } = await C.accountsFor(cls, companyId, settings);

    const proceeds = kind === 'Sale' ? amt(raw.Proceeds) : 0;
    if (kind === 'Sale' && !(proceeds > 0)) throw new HttpsError('invalid-argument', name + 'enter the sale proceeds (more than zero); with no proceeds, choose Scrap.');
    if (kind === 'Scrap' && amt(raw.Proceeds) > 0) throw new HttpsError('invalid-argument', name + 'a scrapped asset has no proceeds; if it was sold, choose Sale.');

    const txns = await C.assetTxns(a._id);
    const bal = E.balancesAt(txns.filter(t => t.CostDelta || t.AccDepDelta), '9999-12-31');
    const toDate = depreciates(a.ClassKind) && ['SL', 'WDV'].includes(area.Method) && area.DepStartDate
      ? E.computeToDate(C.engineAsset(a, txns), date) : null;
    const depToDate = toDate ? round2(toDate.total) : 0;
    const accDepTotal = round2(bal.accDep + depToDate);
    const nbv = round2(bal.cost - accDepTotal);
    const gainLoss = round2(proceeds - nbv);

    const line = {
      AssetID: a._id, AssetNumber: a.AssetNumber, AssetDescription: a.Description, Proceeds: proceeds,
      Cost: bal.cost, AccDepBefore: bal.accDep, DepToDate: depToDate, CatchUpFrom: toDate && toDate.catchUp > 0 ? toDate.periods[0].period : '',
      AccDepTotal: accDepTotal, NBV: nbv, GainLoss: gainLoss,
      CostAccountID: C.requireAccount(accounts, 'AssetCostAccountID', cls, companyId, chart).AccountID,
      AccumAccountID: accDepTotal > 0 ? C.requireAccount(accounts, 'AccumDepAccountID', cls, companyId, chart).AccountID : '',
      ExpenseAccountID: depToDate > 0 ? C.requireAccount(accounts, 'DepExpenseAccountID', cls, companyId, chart).AccountID : '',
      GainAccountID: gainLoss > 0 ? C.requireAccount(accounts, 'GainAccountID', cls, companyId, chart).AccountID : '',
      LossAccountID: gainLoss < 0 ? C.requireAccount(accounts, 'LossAccountID', cls, companyId, chart).AccountID : ''
    };
    if ((depToDate > 0 || gainLoss !== 0) && !a.CostCenterID) {
      throw new Error(name + 'it has no cost center, which the depreciation and gain/loss lines need — set one in Fixed Asset Master.');
    }
    lines.push(line);
  }

  // Where the proceeds go, and VAT (sale only).
  const proceedsTotal = round2(lines.reduce((s, l) => s + l.Proceeds, 0));
  const receipt = { ProceedsTo: '', BankAccountID: '', CustomerID: '', CustomerName: '', VatPercent: 0, VatAmount: 0, OutputTaxAccountID: '', ReceiptAccountID: '' };
  if (kind === 'Sale') {
    receipt.ProceedsTo = str(data.ProceedsTo);
    if (receipt.ProceedsTo === 'Bank') {
      receipt.BankAccountID = str(data.BankAccountID);
      const acc = chart[receipt.BankAccountID];
      if (!acc || acc.Status !== 'Active' || acc.IsPostable !== true || !isCashOrBank(acc)) throw new HttpsError('invalid-argument', 'Select the cash or bank account the proceeds were received in.');
      if (acc.CompanyID && acc.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'That bank account belongs to a different company.');
      receipt.ReceiptAccountID = receipt.BankAccountID;
    } else if (receipt.ProceedsTo === 'Customer') {
      receipt.CustomerID = str(data.CustomerID);
      const cust = receipt.CustomerID ? (await rtdb.ref('customers/' + receipt.CustomerID).get()).val() : null;
      if (!cust) throw new HttpsError('invalid-argument', 'Select the customer the asset was sold to.');
      if (cust.CompanyID && cust.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'That customer belongs to a different company.');
      receipt.CustomerName = cust.CustomerName || '';
      receipt.ReceiptAccountID = cust[PARTY_TYPES.Customer.accountField] || '';
      if (!chart[receipt.ReceiptAccountID]) throw new Error('This customer has no Trade Receivables account — set one in Customer Master Data.');
    } else {
      throw new HttpsError('invalid-argument', 'Choose where the proceeds go: a bank/cash account or a customer on account.');
    }
    receipt.VatPercent = Number(data.VatPercent) || 0;
    if (receipt.VatPercent < 0 || receipt.VatPercent >= 100) throw new HttpsError('invalid-argument', 'VAT % must be from 0 to less than 100.');
    receipt.VatAmount = round2(proceedsTotal * receipt.VatPercent / 100);
    if (receipt.VatAmount > 0) {
      const company = (await rtdb.ref('companies/' + companyId).get()).val() || {};
      receipt.OutputTaxAccountID = company.OutputTaxAccountID || '';
      const tax = chart[receipt.OutputTaxAccountID];
      if (!tax || tax.Status !== 'Active' || tax.IsPostable !== true) throw new Error('This company has no valid Output Tax account — set it in Company Master Data, or leave VAT at 0.');
    }
  }

  const nbvTotal = round2(lines.reduce((s, l) => s + l.NBV, 0));
  return {
    cfg: { moduleId: 'FARETIRE' }, settings, assets, chart, receipt,
    doc: Object.assign({
      Type: 'Retirement', ModuleID: 'FARETIRE', CompanyID: companyId, Date: date, Period: period,
      Description: str(data.Description) || (KINDS[kind] + ' of fixed assets'), Reference: str(data.Reference), Reason: reason,
      RetirementType: kind, DivisionID: str(data.DivisionID), BranchID: str(data.BranchID), CostCenterID: str(data.CostCenterID),
      Lines: lines, AssetIDs: ids, Total: nbvTotal, ProceedsTotal: proceedsTotal,
      GainLossTotal: round2(lines.reduce((s, l) => s + l.GainLoss, 0)), ReceiptTotal: round2(proceedsTotal + receipt.VatAmount)
    }, receipt)
  };
}

// The figures before posting, for the screen.
exports.previewFaRetirement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FARETIRE', 'access', user.profile.role);
  const { doc } = await prepare(user, Object.assign({}, request.data || {}, { Type: 'Retirement' }));
  return doc;
});

function glLinesFor(doc, assets, chart) {
  const out = [];
  const code = id => chart[id].AccountCode;
  doc.Lines.forEach(l => {
    const a = assets[l.AssetID];
    const dims = { CostCenterID: a.CostCenterID || '', ProfitCenterID: a.ProfitCenterID || '' };
    const text = KINDS[doc.RetirementType] + ' ' + a.AssetNumber + ' — ' + a.Description;
    if (l.DepToDate > 0) {
      out.push(Object.assign({ AccountCode: code(l.ExpenseAccountID), Debit: l.DepToDate, Credit: 0, Description: text + ' — depreciation to ' + doc.Date }, dims));
      out.push(Object.assign({ AccountCode: code(l.AccumAccountID), Debit: 0, Credit: l.DepToDate, Description: text + ' — depreciation to ' + doc.Date }, dims));
    }
    if (l.AccDepTotal > 0) out.push(Object.assign({ AccountCode: code(l.AccumAccountID), Debit: l.AccDepTotal, Credit: 0, Description: text }, dims));
    out.push(Object.assign({ AccountCode: code(l.CostAccountID), Debit: 0, Credit: l.Cost, Description: text }, dims));
    if (l.GainLoss < 0) out.push(Object.assign({ AccountCode: code(l.LossAccountID), Debit: -l.GainLoss, Credit: 0, Description: text + ' — loss' }, dims));
    if (l.GainLoss > 0) out.push(Object.assign({ AccountCode: code(l.GainAccountID), Debit: 0, Credit: l.GainLoss, Description: text + ' — gain' }, dims));
  });
  return out;
}

// Caller holds the global lock; `prepared` was built under it.
async function commit(user, postingId, existing, prepared) {
  const { doc, assets, chart } = prepared;
  const now = C.nowIso();
  const actor = C.actorOf(user);
  const col = firestore.collection.bind(firestore);
  const batch = firestore.batch();

  const glLines = glLinesFor(doc, assets, chart);
  let partyFields = {};
  if (doc.RetirementType === 'Sale') {
    const text = 'Sale of ' + doc.Lines.map(l => l.AssetNumber).join(', ');
    const receiptLine = { AccountCode: chart[doc.ReceiptAccountID].AccountCode, Debit: doc.ReceiptTotal, Credit: 0, Description: text, CostCenterID: '', ProfitCenterID: '' };
    if (doc.ProceedsTo === 'Customer') {
      // On the customer's own receivables account, as a New Ref the
      // customer's receipt is later allocated against (Party Payments).
      const resolved = await resolvePartyLines([Object.assign({ LineNo: 1, AccountID: doc.ReceiptAccountID }, receiptLine,
        { PartyType: 'Customer', PartyID: doc.CustomerID, Allocations: [{ RefType: 'New', RefID: '', Amount: doc.ReceiptTotal }] })], doc.CompanyID);
      const pl = resolved.lines[0];
      Object.assign(receiptLine, { PartyType: 'Customer', PartyID: pl.PartyID, PartyName: pl.PartyName, Allocations: pl.Allocations });
      partyFields = resolved.fields;
    }
    glLines.push(receiptLine);
    if (doc.VatAmount > 0) glLines.push({ AccountCode: chart[doc.OutputTaxAccountID].AccountCode, Debit: 0, Credit: doc.VatAmount, Description: 'Output VAT — ' + text, CostCenterID: '', ProfitCenterID: '' });
  }
  const built = await buildStockGlEntry(user, 'FARetirement', doc.Date, doc.Description, doc.Reference, glLines,
    { CompanyID: doc.CompanyID, DivisionID: doc.DivisionID || '', BranchID: doc.BranchID || '', CostCenterID: doc.CostCenterID || '', ProfitCenterID: '' },
    Object.assign({ SourceTransactionID: postingId, ReversalOfJV: '', FixedAssetPostingID: postingId }, partyFields));
  batch.set(col(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId), built.record);

  C.assertBatchSize(doc.Lines.length * 3 + 2);
  for (const l of doc.Lines) {
    const a = assets[l.AssetID];
    const area = (a.Areas || {})[AREA] || {};
    const base = {
      AssetID: l.AssetID, AssetNumber: a.AssetNumber, CompanyID: doc.CompanyID, Area: AREA, Date: doc.Date, Period: doc.Period,
      PostingID: postingId, PostingNumber: built.jvNumber, JVID: built.jvId, JVNumber: built.jvNumber, Reason: doc.Reason,
      ReversedByTxnID: '', CreatedBy: actor
    };
    if (l.DepToDate > 0) {
      batch.set(col(COL.txns).doc(postingId + '_' + l.AssetID + '_D'), Object.assign({}, base, {
        Type: 'Depreciation', DepKind: 'Retirement', CostDelta: 0, AccDepDelta: l.DepToDate, CatchUpFrom: l.CatchUpFrom, CreatedAt: now
      }));
    }
    // A millisecond later, so the history lists the depreciation first.
    const later = new Date(Date.parse(now) + 1).toISOString();
    batch.set(col(COL.txns).doc(postingId + '_' + l.AssetID), Object.assign({}, base, {
      Type: 'Disposal', RetirementType: doc.RetirementType, CostDelta: -l.Cost, AccDepDelta: -l.AccDepTotal,
      Proceeds: l.Proceeds, NBVAtDisposal: l.NBV, GainLoss: l.GainLoss, CreatedAt: later,
      PrevStatus: a.Status, PrevArea: {
        Cost: area.Cost || 0, AccDep: area.AccDep || 0, AccDepScheduled: area.AccDepScheduled || 0, AccDepAdditional: area.AccDepAdditional || 0,
        LastDepPeriod: area.LastDepPeriod || '', FullyDepreciatedAt: area.FullyDepreciatedAt || ''
      }
    }));
    batch.update(col(COL.assets).doc(l.AssetID), {
      Status: 'Disposed', DisposedAt: doc.Date, DisposalType: doc.RetirementType, DisposalPostingID: postingId,
      [`Areas.${AREA}.Cost`]: 0, [`Areas.${AREA}.AccDep`]: 0, [`Areas.${AREA}.AccDepScheduled`]: 0, [`Areas.${AREA}.AccDepAdditional`]: 0,
      [`Areas.${AREA}.LastDepPeriod`]: l.DepToDate > 0 ? doc.Period : (area.LastDepPeriod || ''),
      UpdatedAt: now, UpdatedBy: actor
    });
  }

  batch.update(col(COL.postings).doc(postingId), Object.assign({}, doc, {
    Status: 'Posted', PostingNumber: built.jvNumber, JVID: built.jvId, JVNumber: built.jvNumber, PostedAt: now, PostedBy: actor,
    UpdatedAt: now, UpdatedBy: actor,
    History: (existing.History || []).concat([{ Event: 'Posted', Date: doc.Date, JVID: built.jvId, JVNumber: built.jvNumber, At: now, By: actor }])
  }));
  await batch.commit();
  return { postingNumber: built.jvNumber };
}

// Caller holds the global lock and has checked the document is Posted.
async function reverse(user, p, reason, settings) {
  if (settings.LastPostedPeriod && settings.LastPostedPeriod >= p.Period) {
    throw new Error('Depreciation up to ' + settings.LastPostedPeriod + ' has been posted since this retirement; reverse those depreciation months first.');
  }
  const orig = await C.getDoc(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, p.JVID);
  if (!orig) throw new Error('The GL entry of this retirement was not found.');
  if (orig.ReversedByJV) throw new Error('That GL entry has already been reversed.');
  // A sale on account can't be reversed while the customer's payment is allocated to it.
  await assertEntryReversible(p.JVID, Object.assign({}, orig, { ReversalOfJV: '' }));

  const now = C.nowIso();
  const actor = C.actorOf(user);
  const col = firestore.collection.bind(firestore);
  const batch = firestore.batch();
  const lines = (orig.Lines || []).map(l => {
    const out = {
      AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
    if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
    return out;
  });
  const revJv = await buildStockGlEntry(user, 'FARetirement', p.Date, 'Reversal of ' + p.JVNumber + ' — ' + reason, p.JVNumber, lines,
    { CompanyID: p.CompanyID, DivisionID: p.DivisionID || '', BranchID: p.BranchID || '', CostCenterID: p.CostCenterID || '', ProfitCenterID: '' },
    { SourceTransactionID: p._id, ReversalOfJV: p.JVID, FixedAssetPostingID: p._id, PartyKeys: orig.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] });
  batch.set(col(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(revJv.jvId), revJv.record);
  batch.update(col(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(p.JVID), { ReversedByJV: revJv.jvId, UpdatedAt: now, UpdatedBy: actor });

  C.assertBatchSize(p.Lines.length * 5 + 4);
  for (const l of p.Lines) {
    const txns = (await C.listWhere(COL.txns, 'PostingID', p._id)).filter(t => t.AssetID === l.AssetID && !t.ReversedByTxnID && t.Type !== 'Reversal');
    const disposal = txns.find(t => t.Type === 'Disposal');
    if (!disposal) throw new Error(l.AssetNumber + ': its retirement transaction was not found.');
    txns.forEach(t => {
      batch.set(col(COL.txns).doc(t._id + '_R'), {
        AssetID: l.AssetID, AssetNumber: t.AssetNumber, CompanyID: p.CompanyID, Area: AREA, Type: 'Reversal', ReversalOfTxnID: t._id,
        ReversalOfType: t.Type, Date: t.Date, Period: t.Period, CostDelta: -(t.CostDelta || 0), AccDepDelta: -(t.AccDepDelta || 0),
        PostingID: p._id, PostingNumber: p.PostingNumber, JVID: revJv.jvId, JVNumber: revJv.jvNumber, Reason: reason,
        ReversedByTxnID: '', CreatedAt: now, CreatedBy: actor
      });
      batch.update(col(COL.txns).doc(t._id), { ReversedByTxnID: t._id + '_R' });
    });
    const prev = disposal.PrevArea || {};
    batch.update(col(COL.assets).doc(l.AssetID), {
      Status: disposal.PrevStatus, DisposedAt: '', DisposalType: '', DisposalPostingID: '',
      [`Areas.${AREA}.Cost`]: prev.Cost || 0, [`Areas.${AREA}.AccDep`]: prev.AccDep || 0,
      [`Areas.${AREA}.AccDepScheduled`]: prev.AccDepScheduled || 0, [`Areas.${AREA}.AccDepAdditional`]: prev.AccDepAdditional || 0,
      [`Areas.${AREA}.LastDepPeriod`]: prev.LastDepPeriod || '', [`Areas.${AREA}.FullyDepreciatedAt`]: prev.FullyDepreciatedAt || '',
      UpdatedAt: now, UpdatedBy: actor
    });
  }
  batch.update(col(COL.postings).doc(p._id), {
    Status: 'Reversed', ReversalJVID: revJv.jvId, ReversalJVNumber: revJv.jvNumber,
    ReversalReason: reason, ReversedAt: now, ReversedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    History: (p.History || []).concat([{ Event: 'Reversed', Date: p.Date, JVID: revJv.jvId, JVNumber: revJv.jvNumber, Reason: reason, At: now, By: actor }])
  });
  await batch.commit();
  return { success: true, reversalNumber: revJv.jvNumber };
}

exports.prepare = prepare;
exports.commit = commit;
exports.reverse = reverse;
