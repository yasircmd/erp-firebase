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
// Submitting, approving and locking, and posting an entry for a statement
// line, are step R2.
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const K = require('./bankRecCalc');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'BANKREC';
const MAX_STATEMENT_LINES = 3000;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const actorOf = user => user.profile.username || user.uid;
const recs = () => firestore.collection('bankRecs');
const recId = (companyId, accountId, month) => companyId + '__' + accountId + '__' + month;
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const lastDay = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function requireCap(user, cap) {
  if (await moduleHasCapability(MODULE_ID, cap, user.profile.role)) return;
  throw new HttpsError('permission-denied', cap === 'access' ? 'You do not have access to Bank Reconciliation.' : 'You do not have permission to prepare bank reconciliations.');
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
  const rights = { canPrepare: await moduleHasCapability(MODULE_ID, 'prepare', user.profile.role) };
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
  return load(user, companyId, accountId, month);
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
  if (cur.rec.Status !== 'New' && cur.rec.Status !== 'Draft') throw new HttpsError('failed-precondition', 'This reconciliation is ' + cur.rec.Status + ': it can no longer be changed.');
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
    CompanyID: companyId, AccountID: accountId, Month: month, Currency: cur.account.Currency, Status: 'Draft',
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
  if (snap.data().Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only a draft can be deleted.');
  await ref.delete();
  return { success: true };
});
