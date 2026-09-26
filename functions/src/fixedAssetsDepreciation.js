// Depreciation Run (FADEPRUN) and the reports built on the sub-ledger:
// the depreciation register and the Asset Register (FAREGISTER)
// (docs/modules/FIXED_ASSETS.md → Depreciation run, Reports).
//
// A run is per company and calendar month, posted in order with no
// gaps. Post recomputes everything under the global lock (the preview
// isn't trusted) and writes: one GL entry dated the period's last day
// (Dr expense by account, cost and profit center · Cr accumulated
// depreciation), one Depreciation transaction per asset, the asset
// balances, and the period record faPeriods/{company}_BOOK_{period},
// whose fixed id makes a duplicate run impossible. Firestore commits
// hold at most 500 writes, so the assets are written in chunks first
// (each chunk marks itself done on the run, in the same commit) and the
// GL entry plus the period record last. A run that stops half-way is
// finished by posting the same period again. Only the latest period
// can be reversed, with a reason, by the `reverse` right.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany, buildStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const E = require('./faDepreciation');
const C = require('./fixedAssetsCommon');
const { COL, AREA, str, round2 } = C;

const onCallOptions = { region: 'us-central1' };
const CHUNK = 200; // assets per commit (2 writes each)
const depreciates = kind => kind === 'Tangible' || kind === 'Intangible';
const periodId = (companyId, period) => companyId + '_' + AREA + '_' + period;

// Every eligible asset's depreciation for the period, with warnings.
async function computeRun(companyId, period) {
  const settings = await C.getSettings(companyId);
  const [assets, classes, chart] = await Promise.all([
    C.listWhere(COL.assets, 'CompanyID', companyId), firestore.collection(COL.classes).get().then(C.docsOf), C.coa()
  ]);
  const classById = {};
  classes.forEach(c => { classById[c._id] = c; });
  const txnsByAsset = {};
  (await C.listWhere(COL.txns, 'CompanyID', companyId)).forEach(t => {
    if ((t.Area || AREA) !== AREA) return;
    (txnsByAsset[t.AssetID] = txnsByAsset[t.AssetID] || []).push(t);
  });
  const lines = [];
  const errors = [];
  for (const a of assets.sort((x, y) => x.AssetNumber.localeCompare(y.AssetNumber))) {
    const area = (a.Areas || {})[AREA] || {};
    if (a.Status !== 'Active' || !depreciates(a.ClassKind) || !['SL', 'WDV'].includes(area.Method)) continue;
    if (!area.DepStartDate || area.DepStartDate > E.lastDay(period)) continue;
    const txns = (txnsByAsset[a._id] || []).sort((x, y) => (x.Date + x.CreatedAt).localeCompare(y.Date + y.CreatedAt));
    const r = E.computeScheduled(C.engineAsset(a, txns), period);
    if (!(r.total > 0)) continue;
    const line = {
      AssetID: a._id, AssetNumber: a.AssetNumber, Description: a.Description, ClassID: a.ClassID, ClassCode: a.ClassCode,
      CostCenterID: a.CostCenterID || '', ProfitCenterID: a.ProfitCenterID || '', Method: area.Method,
      Cost: r.opening.cost, OpeningAccDep: r.opening.accDep, OpeningNBV: r.opening.nbv, Current: r.current, CatchUp: r.catchUp,
      Amount: r.total, ClosingAccDep: r.closing.accDep, ClosingNBV: r.closing.nbv, FullyDepreciated: r.fullyDepreciated,
      CatchUpFrom: r.catchUp > 0 ? r.periods[0].period : '', PrevLastDepPeriod: area.LastDepPeriod || '', Errors: []
    };
    const cls = classById[a.ClassID];
    try {
      if (!cls) throw new Error('its class was not found.');
      const { accounts } = await C.accountsFor(cls, companyId, settings);
      line.ExpenseAccountID = C.requireAccount(accounts, 'DepExpenseAccountID', cls, companyId, chart).AccountID;
      line.AccumAccountID = C.requireAccount(accounts, 'AccumDepAccountID', cls, companyId, chart).AccountID;
    } catch (err) { line.Errors.push(err.message); }
    if (!line.CostCenterID) line.Errors.push('No cost center (depreciation expense needs one).');
    line.Errors.forEach(m => errors.push(a.AssetNumber + ': ' + m));
    lines.push(line);
  }
  return { settings, lines, errors, chart };
}

function expectedPeriod(settings, period) {
  if (!settings.LastPostedPeriod) return '';
  return E.nextPeriod(settings.LastPostedPeriod);
}

function totalsOf(lines, chart) {
  const byClass = {};
  const byAccount = {};
  lines.forEach(l => {
    byClass[l.ClassCode] = round2((byClass[l.ClassCode] || 0) + l.Amount);
    if (l.ExpenseAccountID) {
      const k = (chart[l.ExpenseAccountID] || {}).AccountCode + ' ' + ((chart[l.ExpenseAccountID] || {}).AccountName || '');
      byAccount[k] = round2((byAccount[k] || 0) + l.Amount);
    }
  });
  return { byClass, byAccount, total: round2(lines.reduce((s, l) => s + l.Amount, 0)) };
}

function periodArgs(user, d) {
  const companyId = str(d.companyId);
  C.requireCompany(user, companyId);
  const period = str(d.period);
  if (!E.isPeriod(period)) throw new HttpsError('invalid-argument', 'Select the period (month).');
  return { companyId, period };
}

exports.previewFaDepreciation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FADEPRUN', 'access', user.profile.role);
  const { companyId, period } = periodArgs(user, request.data || {});
  const { settings, lines, errors, chart } = await computeRun(companyId, period);
  const pdoc = await C.getDoc(COL.periods, periodId(companyId, period));
  const expected = expectedPeriod(settings, period);
  const blockers = [];
  if (pdoc && pdoc.Status === 'Posted') blockers.push('Depreciation for ' + period + ' has already been posted.');
  else if (expected && period !== expected) blockers.push('The next period to post is ' + expected + '.');
  if (settings.RunInProgress && (!pdoc || pdoc.RunID !== settings.RunInProgress)) blockers.push('Another run is still being posted: post its period again to finish it.');
  return {
    period, lastPostedPeriod: settings.LastPostedPeriod || '', expectedPeriod: expected, lines, errors, blockers,
    totals: totalsOf(lines, chart), resumable: Boolean(pdoc && pdoc.Status === 'Posting')
  };
});

exports.postFaDepreciation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FADEPRUN', 'post', user.profile.role);
  const { companyId, period } = periodArgs(user, request.data || {});
  return withGlobalLock(user.uid, async () => {
    await C.assertFaPostingOpen(user, companyId, E.lastDay(period));
    const pref = firestore.collection(COL.periods).doc(periodId(companyId, period));
    let pdoc = await C.getDoc(COL.periods, pref.id);
    if (pdoc && pdoc.Status === 'Posted') throw new Error('Depreciation for ' + period + ' has already been posted.');
    const settings = await C.getSettings(companyId);
    let run;
    if (pdoc && pdoc.Status === 'Posting') {
      run = await C.getDoc(COL.runs, pdoc.RunID); // resume an interrupted run as it was computed
    } else {
      if (settings.RunInProgress) throw new Error('Another run is still being posted: post its period again to finish it.');
      const expected = expectedPeriod(settings, period);
      if (expected && period !== expected) throw new Error('Periods are posted in order: the next one is ' + expected + '.');
      const computed = await computeRun(companyId, period);
      if (computed.errors.length) throw new Error('Fix these first: ' + computed.errors.join(' · '));
      if (!computed.lines.length) throw new Error('Nothing to depreciate for ' + period + '.');
      const now = C.nowIso();
      const runId = C.newId('FAR');
      run = {
        _id: runId, CompanyID: companyId, Area: AREA, Period: period, Status: 'Posting', Lines: computed.lines,
        Total: totalsOf(computed.lines, computed.chart).total, ChunksDone: [], PrevLastPostedPeriod: settings.LastPostedPeriod || '',
        CreatedAt: now, CreatedBy: C.actorOf(user)
      };
      const batch = firestore.batch();
      const stored = Object.assign({}, run); delete stored._id;
      batch.set(firestore.collection(COL.runs).doc(runId), stored);
      batch.set(pref, { CompanyID: companyId, Area: AREA, Period: period, Status: 'Posting', RunID: runId, UpdatedAt: now });
      batch.set(firestore.collection(COL.runState).doc(companyId), { CompanyID: companyId, RunInProgress: runId }, { merge: true });
      await batch.commit();
    }
    return finishRun(user, run, pref);
  });
});

async function finishRun(user, run, pref) {
  const now = C.nowIso();
  const actor = C.actorOf(user);
  const date = E.lastDay(run.Period);
  const chunks = [];
  for (let i = 0; i < run.Lines.length; i += CHUNK) chunks.push(run.Lines.slice(i, i + CHUNK));
  const done = new Set(run.ChunksDone || []);
  for (const [k, chunk] of chunks.entries()) {
    if (done.has(k)) continue;
    const batch = firestore.batch();
    chunk.forEach(l => {
      batch.set(firestore.collection(COL.txns).doc(run._id + '_' + l.AssetID), {
        AssetID: l.AssetID, AssetNumber: l.AssetNumber, CompanyID: run.CompanyID, Area: AREA, Type: 'Depreciation',
        Date: date, Period: run.Period, CostDelta: 0, AccDepDelta: l.Amount, Current: l.Current, CatchUp: l.CatchUp, CatchUpFrom: l.CatchUpFrom,
        RunID: run._id, PrevLastDepPeriod: l.PrevLastDepPeriod, ReversedByTxnID: '', CreatedAt: now, CreatedBy: actor
      });
      const upd = {
        [`Areas.${AREA}.AccDep`]: FieldValue.increment(l.Amount), [`Areas.${AREA}.AccDepScheduled`]: FieldValue.increment(l.Amount),
        [`Areas.${AREA}.LastDepPeriod`]: run.Period, UpdatedAt: now, UpdatedBy: actor
      };
      if (l.FullyDepreciated) { upd.Status = 'FullyDepreciated'; upd[`Areas.${AREA}.FullyDepreciatedAt`] = date; }
      batch.update(firestore.collection(COL.assets).doc(l.AssetID), upd);
    });
    batch.update(firestore.collection(COL.runs).doc(run._id), { ChunksDone: FieldValue.arrayUnion(k) });
    await batch.commit();
  }

  // The GL entry: expense by account, cost and profit center; accumulated
  // depreciation by account and profit center.
  const chart = await C.coa();
  const dr = {}; const cr = {};
  run.Lines.forEach(l => {
    const dk = [l.ExpenseAccountID, l.CostCenterID, l.ProfitCenterID].join('|');
    const ck = [l.AccumAccountID, l.ProfitCenterID].join('|');
    dr[dk] = round2((dr[dk] || 0) + l.Amount);
    cr[ck] = round2((cr[ck] || 0) + l.Amount);
  });
  const text = 'Depreciation ' + run.Period;
  const glLines = [];
  Object.keys(dr).forEach(k => { const [acc, cc, pc] = k.split('|'); glLines.push({ AccountCode: chart[acc].AccountCode, Debit: dr[k], Credit: 0, Description: text, CostCenterID: cc, ProfitCenterID: pc }); });
  Object.keys(cr).forEach(k => { const [acc, pc] = k.split('|'); glLines.push({ AccountCode: chart[acc].AccountCode, Debit: 0, Credit: cr[k], Description: text, CostCenterID: '', ProfitCenterID: pc }); });
  const built = await buildStockGlEntry(user, 'FADepreciation', date, text, run.Period, glLines, { CompanyID: run.CompanyID },
    { SourceTransactionID: run._id, ReversalOfJV: '', FixedAssetRunID: run._id });

  const batch = firestore.batch();
  batch.set(firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId), built.record);
  batch.update(firestore.collection(COL.runs).doc(run._id), { Status: 'Posted', JVID: built.jvId, JVNumber: built.jvNumber, PostedAt: now, PostedBy: actor });
  batch.set(pref, { Status: 'Posted', RunID: run._id, UpdatedAt: now }, { merge: true });
  batch.set(firestore.collection(COL.runState).doc(run.CompanyID), { LastPostedPeriod: run.Period, RunInProgress: '' }, { merge: true });
  await batch.commit();
  return { success: true, runId: run._id, jvNumber: built.jvNumber, assets: run.Lines.length, total: run.Total };
}

exports.reverseFaDepreciation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FADEPRUN', 'reverse', user.profile.role);
  const d = request.data || {};
  const { companyId, period } = periodArgs(user, d);
  const reason = str(d.reason);
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  return withGlobalLock(user.uid, async () => {
    const settings = await C.assertFaPostingOpen(user, companyId, E.lastDay(period));
    if (settings.RunInProgress) throw new Error('A run is still being posted for this company; finish it first.');
    if (settings.LastPostedPeriod !== period) throw new Error('Only the latest posted period (' + (settings.LastPostedPeriod || 'none') + ') can be reversed.');
    const pref = firestore.collection(COL.periods).doc(periodId(companyId, period));
    const pdoc = await C.getDoc(COL.periods, pref.id);
    const run = pdoc && await C.getDoc(COL.runs, pdoc.RunID);
    if (!run || run.Status !== 'Posted') throw new Error('No posted run found for ' + period + '.');
    const now = C.nowIso();
    const actor = C.actorOf(user);
    const date = E.lastDay(period);

    const orig = await C.getDoc(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, run.JVID);
    if (!orig || orig.ReversedByJV) throw new Error('The run\'s GL entry was not found or is already reversed.');
    const done = new Set(run.ReverseChunksDone || []);
    for (let i = 0, k = 0; i < run.Lines.length; i += CHUNK, k++) {
      if (done.has(k)) continue;
      const batch = firestore.batch();
      run.Lines.slice(i, i + CHUNK).forEach(l => {
        const tid = run._id + '_' + l.AssetID;
        batch.set(firestore.collection(COL.txns).doc(tid + '_R'), {
          AssetID: l.AssetID, AssetNumber: l.AssetNumber, CompanyID: companyId, Area: AREA, Type: 'Reversal', ReversalOfTxnID: tid,
          ReversalOfType: 'Depreciation', Date: date, Period: period, CostDelta: 0, AccDepDelta: -l.Amount, RunID: run._id,
          Reason: reason, ReversedByTxnID: '', CreatedAt: now, CreatedBy: actor
        });
        batch.update(firestore.collection(COL.txns).doc(tid), { ReversedByTxnID: tid + '_R' });
        const upd = {
          [`Areas.${AREA}.AccDep`]: FieldValue.increment(-l.Amount), [`Areas.${AREA}.AccDepScheduled`]: FieldValue.increment(-l.Amount),
          [`Areas.${AREA}.LastDepPeriod`]: l.PrevLastDepPeriod, UpdatedAt: now, UpdatedBy: actor
        };
        if (l.FullyDepreciated) { upd.Status = 'Active'; upd[`Areas.${AREA}.FullyDepreciatedAt`] = ''; }
        batch.update(firestore.collection(COL.assets).doc(l.AssetID), upd);
      });
      batch.update(firestore.collection(COL.runs).doc(run._id), { ReverseChunksDone: FieldValue.arrayUnion(k) });
      await batch.commit();
    }
    const lines = (orig.Lines || []).map(l => ({
      AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    }));
    const built = await buildStockGlEntry(user, 'FADepreciation', date, 'Reversal of ' + run.JVNumber + ' — ' + reason, run.JVNumber, lines,
      { CompanyID: companyId }, { SourceTransactionID: run._id, ReversalOfJV: run.JVID, FixedAssetRunID: run._id });
    const batch = firestore.batch();
    batch.set(firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(built.jvId), built.record);
    batch.update(firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(run.JVID), { ReversedByJV: built.jvId, UpdatedAt: now, UpdatedBy: actor });
    batch.update(firestore.collection(COL.runs).doc(run._id), {
      Status: 'Reversed', ReversalJVID: built.jvId, ReversalJVNumber: built.jvNumber, ReversalReason: reason, ReversedAt: now, ReversedBy: actor
    });
    batch.set(pref, { Status: 'Reversed', UpdatedAt: now }, { merge: true });
    batch.set(firestore.collection(COL.runState).doc(companyId), { LastPostedPeriod: run.PrevLastPostedPeriod || '' }, { merge: true });
    await batch.commit();
    return { success: true, reversalNumber: built.jvNumber };
  });
});

// The runs of one company (with its run state), or of every company
// the user can see (GL Report drill-through), newest first.
exports.getFaRuns = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FADEPRUN', 'access', user.profile.role);
  const companyId = str(request.data && request.data.companyId);
  const newest = (a, b) => (b.Period + b.CreatedAt).localeCompare(a.Period + a.CreatedAt);
  if (!companyId) {
    const runs = C.docsOf(await firestore.collection(COL.runs).get()).filter(r => userCanAccessCompany(user.profile, r.CompanyID));
    return { runs: runs.map(r => Object.assign({ RunID: r._id }, r)).sort(newest) };
  }
  C.requireCompany(user, companyId);
  const settings = await C.getSettings(companyId);
  const runs = (await C.listWhere(COL.runs, 'CompanyID', companyId)).map(r => Object.assign({ RunID: r._id }, r)).sort(newest);
  return { runs, lastPostedPeriod: settings.LastPostedPeriod || '', runInProgress: settings.RunInProgress || '' };
});

// ---------- registers ----------

// Classifies a transaction (a reversal counts as what it reverses).
function kindOf(t) {
  const type = t.Type === 'Reversal' ? t.ReversalOfType : t.Type;
  if (type === 'Capitalization' || type === 'TakeOver') return 'original';
  if (type === 'Addition' || type === 'AuCSettlement') return 'addition';
  if (type === 'AdditionalDepreciation') return 'additional';
  if (type === 'Depreciation') return 'scheduled';
  if (type === 'Disposal') return 'disposal';
  return 'other';
}

async function companyData(companyId) {
  const [assets, txns] = await Promise.all([C.listWhere(COL.assets, 'CompanyID', companyId), C.listWhere(COL.txns, 'CompanyID', companyId)]);
  const byAsset = {};
  txns.forEach(t => { if ((t.Area || AREA) === AREA) (byAsset[t.AssetID] = byAsset[t.AssetID] || []).push(t); });
  return { assets, byAsset };
}

// Depreciation register for a period range: opening NBV, scheduled and
// additional depreciation in the range, accumulated depreciation and
// closing NBV at its end.
exports.getFaDepreciationRegister = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FADEPRUN', 'access', user.profile.role);
  const d = request.data || {};
  const companyId = str(d.companyId);
  C.requireCompany(user, companyId);
  const from = str(d.fromPeriod); const to = str(d.toPeriod);
  if (!E.isPeriod(from) || !E.isPeriod(to) || from > to) throw new HttpsError('invalid-argument', 'Select a valid period range.');
  const start = E.firstDay(from); const end = E.lastDay(to);
  const { assets, byAsset } = await companyData(companyId);
  const rows = [];
  assets.forEach(a => {
    const txns = byAsset[a._id] || [];
    const open = E.balancesAt(txns, start, true);
    const close = E.balancesAt(txns, end);
    let scheduled = 0; let additional = 0;
    txns.forEach(t => {
      if (t.Date < start || t.Date > end) return;
      const k = kindOf(t);
      if (k === 'scheduled') scheduled += t.AccDepDelta || 0;
      if (k === 'additional') additional += t.AccDepDelta || 0;
    });
    if (!open.cost && !close.cost && !scheduled && !additional) return;
    rows.push({
      AssetID: a._id, AssetNumber: a.AssetNumber, Description: a.Description, ClassCode: a.ClassCode, CostCenterID: a.CostCenterID || '',
      OpeningNBV: round2(open.cost - open.accDep), Scheduled: round2(scheduled), Additional: round2(additional),
      AccDep: close.accDep, Cost: close.cost, ClosingNBV: round2(close.cost - close.accDep)
    });
  });
  return { rows: rows.sort((x, y) => x.AssetNumber.localeCompare(y.AssetNumber)) };
});

// Fixed Asset Register as at a date, built from the transactions.
exports.getFaRegister = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FAREGISTER', 'access', user.profile.role);
  const d = request.data || {};
  const companyId = str(d.companyId);
  C.requireCompany(user, companyId);
  const asOf = str(d.asOfDate);
  if (!E.isDate(asOf)) throw new HttpsError('invalid-argument', 'Select the "as at" date.');
  const periodStart = E.firstDay(E.periodOf(asOf));
  const { assets, byAsset } = await companyData(companyId);
  const rows = assets.map(a => {
    const txns = (byAsset[a._id] || []).filter(t => t.Date <= asOf);
    const sum = (kind, field, fromDate) => round2(txns.filter(t => kindOf(t) === kind && (!fromDate || t.Date >= fromDate)).reduce((s, t) => s + (t[field] || 0), 0));
    const original = sum('original', 'CostDelta');
    const additions = sum('addition', 'CostDelta');
    const scheduled = sum('scheduled', 'AccDepDelta') + sum('original', 'AccDepDelta');
    const additional = sum('additional', 'AccDepDelta');
    // A retirement takes the cost and all the depreciation off the books;
    // its proceeds and gain/loss count unless reversed by the date.
    const retired = sum('disposal', 'CostDelta');
    const retiredAccDep = sum('disposal', 'AccDepDelta');
    const live = t => t.Type === 'Disposal' && !(t.ReversedByTxnID && txns.some(r => r._id === t.ReversedByTxnID));
    const disposalValue = round2(txns.filter(live).reduce((s, t) => s + (t.Proceeds || 0), 0));
    const gainLoss = round2(txns.filter(live).reduce((s, t) => s + (t.GainLoss || 0), 0));
    const cost = round2(original + additions + retired);
    const accDep = round2(scheduled + additional + retiredAccDep);
    return {
      AssetID: a._id, AssetNumber: a.AssetNumber, Description: a.Description, ClassID: a.ClassID, ClassCode: a.ClassCode, ClassName: a.ClassName,
      SerialNumber: a.SerialNumber || '', CostCenterID: a.CostCenterID || '', ProfitCenterID: a.ProfitCenterID || '',
      DivisionID: a.DivisionID || '', BranchID: a.BranchID || '', DepartmentID: a.DepartmentID || '', LocationID: a.LocationID || '',
      SupplierID: a.SupplierID || '', SupplierName: a.SupplierName || '', PurchaseDate: a.PurchaseDate || '',
      CapitalizationDate: cost ? a.CapitalizationDate || '' : '', Status: a.Status,
      OriginalCost: original, Additions: additions, Transfers: 0, Retirements: retired, Cost: cost,
      AccDepScheduled: round2(scheduled), AccDepAdditional: additional, AccDep: accDep,
      CurrentPeriodDep: round2(sum('scheduled', 'AccDepDelta', periodStart) + sum('additional', 'AccDepDelta', periodStart)),
      NBV: round2(cost - accDep), DisposalValue: disposalValue, GainLoss: gainLoss,
      DisposedAt: a.DisposedAt || '', DisposalType: a.DisposalType || ''
    };
  }).filter(r => r.Cost || r.AccDep || r.Status === 'Planned' || r.Retirements);
  return { rows: rows.sort((x, y) => x.AssetNumber.localeCompare(y.AssetNumber)), asOfDate: asOf };
});
