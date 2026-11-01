// Bank reconciliation, step R1 (owner, 2026-11-01; docs/modules/
// RECONCILIATION.md, Q366-Q368). New development, hand-written.
//
// For a company's bank account (COA CashBank 'Bank') and a month: the
// bank's statement (pasted from Excel, or only its balances typed) beside
// the account's posted GL lines; matches suggested (same amount, close date,
// a reference found) and confirmed, or made by hand (one to many, many to
// one, an entry against its reversal); GL lines ticked as cleared where no
// statement was pasted; the report (GL balance, payments not presented,
// deposits not credited, the balance per the bank against the statement's).
// A foreign-currency account is reconciled in its own currency.
//   Firestore bankRecs/{CompanyID}__{AccountID}__{yyyy-mm} { CompanyID,
//     AccountID, Month, Currency, StatementOpening, StatementClosing,
//     StatementLines [{ LineID, Date, Description, Reference, Debit, Credit }],
//     Matches [{ MatchID, GL [lineKey], ST [LineID] }], Ticked [lineKey],
//     Status 'Draft', History, Created/Updated At, By }
//   A GL line's key is its journal entry's id and line index ('id:3').
// Step R2 (Q369-Q370, Q374): a Cash & Bank entry posted for a statement line
// with nothing in the GL, then matched to it; submitted (the difference
// nothing) and approved through Approval Configuration ('BANKREC'), then
// locked (Status 'Approved'); reopened with a reason, the latest locked
// month only; months submitted in order; Period Closing's check (checkMonth).
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const K = require('./bankRecCalc');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'BANKREC';
const MAX_STATEMENT_LINES = 3000;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const actorOf = user => user.profile.username || user.uid;
const recs = () => firestore.collection('bankRecs');
const recId = (companyId, accountId, month) => companyId + '__' + accountId + '__' + month;
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const EDITABLE = ['New', 'Draft', 'Rejected'];
const lastDay = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function requireCap(user, cap) {
  if (await moduleHasCapability(MODULE_ID, cap, user.profile.role)) return;
  throw new HttpsError('permission-denied', cap === 'access' ? 'You do not have access to Bank Reconciliation.' : cap === 'reopen' ? 'You do not have permission to reopen a bank reconciliation.' : 'You do not have permission to prepare bank reconciliations.');
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
// The company's bank accounts: Active, postable, marked Bank, its own or shared.
function bankAccounts(coa, companyId) {
  return Object.keys(coa).filter(id => coa[id] && coa[id].Status === 'Active' && coa[id].IsPostable === true && coa[id].CashBank === 'Bank' &&
    (!coa[id].CompanyID || coa[id].CompanyID === companyId))
    .map(id => ({ AccountID: id, AccountCode: String(coa[id].AccountCode || ''), AccountName: coa[id].AccountName || '', Currency: String(coa[id].Currency || '') }))
    .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true }));
}
async function account(companyId, accountId) {
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const a = bankAccounts(coa, companyId).find(x => x.AccountID === accountId);
  if (!a) throw new HttpsError('invalid-argument', 'Choose one of the company\'s bank accounts.');
  return a;
}
async function recsOf(companyId, accountId) {
  return (await recs().where('CompanyID', '==', companyId).get()).docs.map(d => Object.assign({ RecID: d.id }, d.data()))
    .filter(r => !accountId || r.AccountID === accountId);
}

// The account's posted GL lines to `end`: { Key, Date, Number, Reference, Cheque, Description, Amount, VoucherType }.
async function glLinesOf(companyId, acc, end) {
  const fc = Boolean(acc.Currency);
  const snap = await firestore.collection('journalEntries').where('CompanyID', '==', companyId).where('JVDate', '<=', end).get();
  const out = [];
  snap.docs.forEach(d => {
    const e = d.data();
    if (e.Status !== 'Posted') return;
    (e.Lines || []).forEach((l, i) => {
      if (l.AccountID !== acc.AccountID) return;
      const amount = K.glAmount(l, fc);
      if (!amount) return;
      out.push({ Key: d.id + ':' + i, Date: e.JVDate, Number: e.JVNumber || e.TransactionRef || '', Reference: e.Reference || '', Cheque: l.ChequeNumber || e.ChequeNumber || '',
        Description: l.Description || e.Description || '', VoucherType: e.VoucherType || '', Amount: amount });
    });
  });
  return out.sort((a, b) => a.Date.localeCompare(b.Date) || a.Number.localeCompare(b.Number));
}

// Everything for one account and month: the reconciliation (saved or new),
// the GL lines it may use (those not cleared by another month's), the
// suggestions for what is unmatched, and the report.
async function load(user, companyId, accountId, month) {
  const acc = await account(companyId, accountId);
  const end = lastDay(month);
  const [lines, all] = await Promise.all([glLinesOf(companyId, acc, end), recsOf(companyId, accountId)]);
  const id = recId(companyId, accountId, month);
  const rec = all.find(r => r.RecID === id) || { RecID: id, CompanyID: companyId, AccountID: accountId, Month: month, Currency: acc.Currency, Status: 'New',
    StatementOpening: null, StatementClosing: null, StatementLines: [], Matches: [], Ticked: [] };
  // Cleared in another month's reconciliation: an earlier one's are gone from this one; a later one's stay open here.
  const elsewhere = new Map();
  all.filter(r => r.RecID !== id).forEach(r => {
    (r.Matches || []).forEach(m => (m.GL || []).forEach(k => elsewhere.set(k, r.Month)));
    (r.Ticked || []).forEach(k => elsewhere.set(k, r.Month));
  });
  const usable = lines.filter(g => !(elsewhere.has(g.Key) && elsewhere.get(g.Key) < month));
  const lockedLater = new Set(usable.filter(g => elsewhere.has(g.Key)).map(g => g.Key));
  const mine = new Set([].concat(...(rec.Matches || []).map(m => m.GL || []), rec.Ticked || []));
  // The balance counts every line to the month's end; an earlier month's cleared lines count as cleared.
  const cleared = new Set([...mine, ...[...elsewhere].filter(([, m]) => m < month).map(([k]) => k)]);
  const report = K.report(lines, cleared, rec.StatementClosing, end);
  const matchedSt = new Set([].concat(...(rec.Matches || []).map(m => m.ST || [])));
  const openGl = usable.filter(g => !mine.has(g.Key) && !lockedLater.has(g.Key));
  const openSt = (rec.StatementLines || []).filter(s => !matchedSt.has(s.LineID));
  const prev = all.filter(r => r.Month < month).sort((a, b) => b.Month.localeCompare(a.Month))[0];
  return {
    account: acc, month, monthEnd: end, rec,
    glLines: usable.map(g => Object.assign({}, g, { Cleared: mine.has(g.Key), ClearedLater: lockedLater.has(g.Key) ? elsewhere.get(g.Key) : '' })),
    suggestions: K.suggest(openGl, openSt),
    unmatchedStatement: openSt.map(s => s.LineID),
    report, previousClosing: prev ? prev.StatementClosing : null
  };
}

exports.getBankRecSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const rights = { canPrepare: await moduleHasCapability(MODULE_ID, 'prepare', user.profile.role), canReopen: await moduleHasCapability(MODULE_ID, 'reopen', user.profile.role) };
  const companyId = text(request.data && request.data.companyId, 80);
  if (!companyId) return { rights };
  requireCompany(user, companyId);
  const [coa, list] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), recsOf(companyId)]);
  return { rights, accounts: bankAccounts(coa, companyId),
    recs: list.map(r => ({ RecID: r.RecID, AccountID: r.AccountID, Month: r.Month, Status: r.Status, StatementClosing: r.StatementClosing, UpdatedAt: r.UpdatedAt || '', UpdatedBy: r.UpdatedBy || '' }))
      .sort((a, b) => b.Month.localeCompare(a.Month)) };
});

exports.getBankRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = text(d.companyId, 80), accountId = text(d.accountId, 80), month = text(d.month, 7);
  requireCompany(user, companyId);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const out = await load(user, companyId, accountId, month);
  // Waiting for approval: the level this user may decide, if any.
  if (out.rec.Status === 'PendingApproval' && out.rec.ApprovalInstanceID) {
    const inst = await require('./approvalStore').approvalInstances.get(out.rec.ApprovalInstanceID);
    out.rec.MyLevel = inst && inst.Status === 'Pending' ? require('./approvalCard').myLevel(inst, user.uid) : null;
  }
  return Object.assign(out, { rights: { canPrepare: await moduleHasCapability(MODULE_ID, 'prepare', user.profile.role), canReopen: await moduleHasCapability(MODULE_ID, 'reopen', user.profile.role) } });
});

// Saves the month's work: the statement (lines replaced, or rows pasted
// added), its balances, the matches and the ticks. Every match must
// balance and use lines no other month has cleared.
exports.saveBankRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const d = request.data || {};
  const companyId = text(d.companyId, 80), accountId = text(d.accountId, 80), month = text(d.month, 7);
  requireCompany(user, companyId);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const cur = await load(user, companyId, accountId, month);
  if (!EDITABLE.includes(cur.rec.Status)) throw new HttpsError('failed-precondition', cur.rec.Status === 'Approved' ? 'This month is reconciled and locked: reopen it to change it.' : 'This reconciliation is waiting for approval: it can no longer be changed.');
  const amountOrNull = (v, label) => {
    if (v === undefined) return undefined;
    if (v === null || String(v).trim() === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new HttpsError('invalid-argument', label + ' must be an amount.');
    return K.round2(n);
  };
  const opening = amountOrNull(d.statementOpening, 'The statement\'s opening balance');
  const closing = amountOrNull(d.statementClosing, 'The statement\'s closing balance');

  // The statement's lines: those kept (by LineID), plus rows pasted.
  let stLines = cur.rec.StatementLines || [];
  if (Array.isArray(d.keepLines)) { const keep = new Set(d.keepLines.map(x => text(x, 60))); stLines = stLines.filter(s => keep.has(s.LineID)); }
  let bad = [];
  if (d.pasteText) {
    const parsed = K.parseStatement(String(d.pasteText).slice(0, 500000));
    bad = parsed.bad;
    stLines = stLines.concat(parsed.rows.map(r => Object.assign({ LineID: randomUUID().slice(0, 12) }, r)));
  }
  if (stLines.length > MAX_STATEMENT_LINES) throw new HttpsError('invalid-argument', 'A month\'s statement holds at most ' + MAX_STATEMENT_LINES + ' lines.');
  const outside = stLines.filter(s => s.Date.slice(0, 7) !== month);
  if (outside.length) throw new HttpsError('invalid-argument', 'Statement lines dated outside ' + month + ': ' + outside.slice(0, 3).map(s => s.Date).join(', ') + '. Paste only the month\'s lines.');

  // The GL lines this month may use: not cleared by another month's.
  const glByKey = {};
  cur.glLines.filter(g => !g.ClearedLater).forEach(g => { glByKey[g.Key] = g; });
  const stById = {};
  stLines.forEach(s => { stById[s.LineID] = s; });
  const matches = Array.isArray(d.matches) ? d.matches : cur.rec.Matches || [];
  const used = new Set(), usedSt = new Set();
  const clean = matches.map((m, i) => {
    const g = (m.GL || []).map(k => text(k, 200)), s = (m.ST || []).map(x => text(x, 60));
    const why = K.checkMatch({ GL: g, ST: s }, glByKey, stById);
    if (why) throw new HttpsError('invalid-argument', 'Match ' + (i + 1) + ': ' + why + '.');
    if (g.some(k => used.has(k)) || s.some(x => usedSt.has(x))) throw new HttpsError('invalid-argument', 'Match ' + (i + 1) + ': a line is in another match too.');
    g.forEach(k => used.add(k)); s.forEach(x => usedSt.add(x));
    return { MatchID: text(m.MatchID, 40) || randomUUID().slice(0, 12), GL: g, ST: s };
  });
  const ticked = (Array.isArray(d.ticked) ? d.ticked : cur.rec.Ticked || []).map(k => text(k, 200));
  ticked.forEach(k => {
    if (!glByKey[k]) throw new HttpsError('invalid-argument', 'A ticked line is not one of this account\'s open GL lines.');
    if (used.has(k)) throw new HttpsError('invalid-argument', 'A line is both ticked and matched.');
  });

  const now = new Date().toISOString(), by = actorOf(user);
  const ref = recs().doc(cur.rec.RecID);
  const doc = {
    CompanyID: companyId, AccountID: accountId, Month: month, Currency: cur.account.Currency, Status: cur.rec.Status === 'Rejected' ? 'Rejected' : 'Draft',
    RejectionReason: cur.rec.RejectionReason || '',
    StatementOpening: opening === undefined ? cur.rec.StatementOpening : opening, StatementClosing: closing === undefined ? cur.rec.StatementClosing : closing,
    StatementLines: stLines, Matches: clean, Ticked: [...new Set(ticked)],
    History: (cur.rec.History || []).concat([{ At: now, By: by, What: cur.rec.Status === 'New' ? 'Started' : 'Saved' }]).slice(-200),
    CreatedAt: cur.rec.CreatedAt || now, CreatedBy: cur.rec.CreatedBy || by, UpdatedAt: now, UpdatedBy: by
  };
  await ref.set(doc);
  const out = await load(user, companyId, accountId, month);
  return Object.assign(out, { success: true, badRows: bad });
});

// Deleting a draft (its matches and ticks with it).
exports.deleteBankRecDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const d = request.data || {};
  const companyId = text(d.companyId, 80), accountId = text(d.accountId, 80), month = text(d.month, 7);
  requireCompany(user, companyId);
  const ref = recs().doc(recId(companyId, accountId, month));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No reconciliation for that month.');
  if (!['Draft', 'Rejected'].includes(snap.data().Status)) throw new HttpsError('failed-precondition', 'Only a draft or a rejected reconciliation can be deleted.');
  await ref.delete();
  return { success: true };
});

// ---------- Step R2 ----------

const keyOf = d => ({ companyId: text(d.companyId, 80), accountId: text(d.accountId, 80), month: text(d.month, 7) });
const historyWith = (rec, what, user, note) => (rec.History || []).concat([{ At: new Date().toISOString(), By: actorOf(user), What: what, Note: note || '' }]).slice(-200);

// A statement line with nothing in the GL (Q369): a Bank Payment (a
// withdrawal) or Bank Receipt (a deposit) posted for it through Cash & Bank
// (its rights, numbering, approval and period lock), then matched to it.
// A foreign-currency account's entry is made in Cash & Bank itself.
exports.postBankRecEntry = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const d = request.data || {};
  const { companyId, accountId, month } = keyOf(d);
  requireCompany(user, companyId);
  const cur = await load(user, companyId, accountId, month);
  if (!EDITABLE.includes(cur.rec.Status) || cur.rec.Status === 'New') throw new HttpsError('failed-precondition', cur.rec.Status === 'New' ? 'Paste the statement first.' : 'This reconciliation can no longer be changed.');
  if (cur.account.Currency) throw new HttpsError('failed-precondition', 'This account is in ' + cur.account.Currency + ': post the entry in Cash & Bank (with its rate), then match it here.');
  const line = (cur.rec.StatementLines || []).find(s => s.LineID === text(d.lineId, 60));
  if (!line) throw new HttpsError('invalid-argument', 'That statement line is not on this statement.');
  if (!cur.unmatchedStatement.includes(line.LineID)) throw new HttpsError('failed-precondition', 'That statement line is matched already.');
  const accountCode = text(d.accountCode, 40);
  if (!accountCode) throw new HttpsError('invalid-argument', 'Choose the account (for example Bank Charges).');
  const out = line.Debit > 0;
  // A cost centre by its id, or by its code as typed.
  let costCenterId = text(d.costCenterId, 80);
  if (!costCenterId && d.costCenterCode) {
    const units = (await rtdb.ref('orgUnits').get()).val() || {};
    costCenterId = Object.keys(units).find(id => units[id].Type === 'CostCenter' && String(units[id].Code) === text(d.costCenterCode, 40) && (!units[id].CompanyID || units[id].CompanyID === companyId)) || '';
    if (!costCenterId) throw new HttpsError('invalid-argument', 'No cost centre ' + text(d.costCenterCode, 40) + ' in this company.');
  }
  const result = await require('./journal').saveAndPostCbt(request, {
    VoucherType: out ? 'Bank Payment' : 'Bank Receipt', SelectedAccountCode: cur.account.AccountCode, JVDate: line.Date, CompanyID: companyId,
    Description: text(d.description, 300) || line.Description || 'Per the bank statement', Reference: line.Reference || '',
    CostCenterID: costCenterId, OppositeLines: [{ AccountCode: accountCode, Amount: out ? line.Debit : line.Credit, Description: text(d.description, 300) || line.Description || '', CostCenterID: costCenterId }]
  });
  if (!result || result.success === false) throw new HttpsError('failed-precondition', (result && result.error) || 'Unable to post the entry.');
  if (result.status !== 'Posted') return { success: true, status: result.status, jvNumber: result.jvNumber || '', matched: false };
  // Matched to the statement line: the new entry's bank line.
  const entry = (await firestore.collection('journalEntries').doc(result.jvId).get()).data() || {};
  const idx = (entry.Lines || []).findIndex(l => l.AccountID === accountId);
  const ref = recs().doc(cur.rec.RecID);
  await firestore.runTransaction(async tx => {
    const r = (await tx.get(ref)).data();
    tx.update(ref, { Matches: (r.Matches || []).concat([{ MatchID: randomUUID().slice(0, 12), GL: [result.jvId + ':' + idx], ST: [line.LineID] }]),
      History: historyWith(r, 'Entry ' + (entry.JVNumber || '') + ' posted for a statement line', user), UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) });
  });
  return Object.assign(await load(user, companyId, accountId, month), { success: true, status: 'Posted', jvNumber: entry.JVNumber || '', matched: true });
});

// The month is approved and locked (or Approved at once with no approval set).
async function commitApproval(user, rec, what) {
  const now = new Date().toISOString();
  await recs().doc(rec.RecID).update({ Status: 'Approved', ApprovedAt: now, ApprovedBy: actorOf(user), RejectionReason: '', UpdatedAt: now, UpdatedBy: actorOf(user),
    History: historyWith(rec, what, user) });
}

// Submitted (Q370): reconciled (the statement's closing balance typed, the
// difference nothing) and the account's earlier reconciled month approved.
exports.submitBankRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const { companyId, accountId, month } = keyOf(request.data || {});
  requireCompany(user, companyId);
  return withGlobalLock(user.uid, async () => {
    const cur = await load(user, companyId, accountId, month);
    if (!['Draft', 'Rejected'].includes(cur.rec.Status)) throw new HttpsError('failed-precondition', 'Only a draft or rejected reconciliation can be submitted.');
    if (cur.report.StatementClosing === null) throw new HttpsError('failed-precondition', 'Type the statement\'s closing balance first.');
    if (cur.report.Difference !== 0) throw new HttpsError('failed-precondition', 'The difference is ' + cur.report.Difference.toFixed(2) + ': it must be nothing to submit.');
    const earlier = (await recsOf(companyId, accountId)).filter(r => r.Month < month).sort((a, b) => b.Month.localeCompare(a.Month))[0];
    if (earlier && earlier.Status !== 'Approved') throw new HttpsError('failed-precondition', earlier.Month + ' is not approved yet: the months are reconciled in order.');
    const a = cur.account;
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: companyId });
    const approval = await beginApprovalInstance(MODULE_ID, cur.rec.RecID, a.AccountCode + ' ' + month, scopeKey, Math.abs(cur.report.StatementClosing), user.uid);
    const now = new Date().toISOString();
    const rec = Object.assign({}, cur.rec);
    if (approval.required) {
      await recs().doc(rec.RecID).update({ Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '', SubmittedAt: now, SubmittedBy: actorOf(user),
        UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(rec, 'Submitted for approval', user) });
      return { success: true, status: 'PendingApproval' };
    }
    await commitApproval(user, rec, 'Approved (no approval required)');
    return { success: true, status: 'Approved' };
  });
});

// The approver's decision (Approval Configuration's levels; Home tasks and the phone card).
exports.decideBankRecApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const snap = await recs().doc(text(d.recId, 200)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Bank reconciliation not found.');
  const rec = Object.assign({ RecID: snap.id }, snap.data());
  requireCompany(user, rec.CompanyID);
  return withGlobalLock(user.uid, async () => {
    if (rec.Status !== 'PendingApproval' || !rec.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'This reconciliation is not waiting for approval.');
    const result = await recordApprovalDecision(user, rec.ApprovalInstanceID, d.levelNumber, d.decision, d.reason);
    if (result.status === 'Approved') await commitApproval(user, rec, 'Approved');
    if (result.status === 'Rejected') {
      const reason = text(d.reason, 500);
      await recs().doc(rec.RecID).update({ Status: 'Rejected', RejectionReason: reason, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user), History: historyWith(rec, 'Rejected', user, reason) });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

// Reopened with a reason (Q370): the latest locked month of the account
// only, so a later month never rests on a changed one. Back to Draft.
exports.reopenBankRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'reopen');
  const d = request.data || {};
  const { companyId, accountId, month } = keyOf(d);
  requireCompany(user, companyId);
  const reason = text(d.reason, 500);
  if (!reason) throw new HttpsError('invalid-argument', 'Give the reason for reopening.');
  return withGlobalLock(user.uid, async () => {
    const all = await recsOf(companyId, accountId);
    const rec = all.find(r => r.Month === month);
    if (!rec || rec.Status !== 'Approved') throw new HttpsError('failed-precondition', 'Only an approved (locked) month can be reopened.');
    const later = all.find(r => r.Month > month && ['Approved', 'PendingApproval'].includes(r.Status));
    if (later) throw new HttpsError('failed-precondition', later.Month + ' is ' + (later.Status === 'Approved' ? 'locked' : 'waiting for approval') + ': reopen the latest month first.');
    await recs().doc(rec.RecID).update({ Status: 'Draft', ApprovalInstanceID: '', ReopenedAt: new Date().toISOString(), ReopenedBy: actorOf(user),
      UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user), History: historyWith(rec, 'Reopened', user, reason) });
    return { success: true, status: 'Draft' };
  });
});

// For Period Closing (Q374): the company's bank accounts with posted lines to
// the month's end whose reconciliation for the month is not approved.
async function checkMonth(companyId, month) {
  const end = lastDay(month);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const banks = bankAccounts(coa, companyId);
  if (!banks.length) return [];
  const ids = new Set(banks.map(b => b.AccountID)), used = new Set();
  (await firestore.collection('journalEntries').where('CompanyID', '==', companyId).where('JVDate', '<=', end).get()).docs.forEach(doc => {
    const e = doc.data();
    if (e.Status === 'Posted') (e.Lines || []).forEach(l => { if (ids.has(l.AccountID)) used.add(l.AccountID); });
  });
  const byId = {};
  (await recsOf(companyId)).filter(r => r.Month === month).forEach(r => { byId[r.AccountID] = r; });
  return banks.filter(b => used.has(b.AccountID) && !(byId[b.AccountID] && byId[b.AccountID].Status === 'Approved'))
    .map(b => ({ AccountID: b.AccountID, Name: b.AccountCode + ' ' + b.AccountName, Status: byId[b.AccountID] ? byId[b.AccountID].Status : 'Not started' }));
}
exports.checkMonth = checkMonth;
