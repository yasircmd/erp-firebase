// GL account reconciliation, step R3 (owner, 2026-11-01; docs/modules/
// RECONCILIATION.md, Q371-Q374). New development, hand-written.
//
// Each company keeps a list of the balance-sheet accounts it reconciles
// monthly (Q372), each with its method (Q371):
//   Match     its posted lines that offset each other are matched (a GRN
//             against its invoice in GRN Clearing, an advance against its
//             settlement); what stays unmatched is the balance, item by item;
//   Schedule  a supporting schedule of items (a note, a reference, an
//             amount; attachments through Supporting Documents) that must
//             add up to the balance (accruals, prepayments).
// A month is submitted and approved through Approval Configuration
// ('GLREC', Q373), then locked; reopened with a reason, the latest locked
// month only; months in order. The month's board shows every listed
// account and the bank accounts (Bank Reconciliation's). Period Closing
// checks the listed accounts (Q374, checkMonth).
//   Firestore glRecSetup/{CompanyID} { Accounts [{ AccountID, Method }], UpdatedAt, UpdatedBy }
//   Firestore glRecs/{CompanyID}__{AccountID}__{yyyy-mm} { CompanyID, AccountID, Month, Method,
//     Matches [{ MatchID, GL [lineKey] }] (Match), Items [{ ItemID, Description, Reference, Amount }]
//     (Schedule, Dr positive), Notes, Status Draft|PendingApproval|Approved|Rejected, History, … }
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const K = require('./bankRecCalc');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'GLREC';
const METHODS = ['Match', 'Schedule'];
const BS_TYPES = ['Asset', 'Liability', 'Equity'];
const EDITABLE = ['New', 'Draft', 'Rejected'];
const MAX_ITEMS = 2000, MAX_ACCOUNTS = 300;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const actorOf = user => user.profile.username || user.uid;
const recs = () => firestore.collection('glRecs');
const setupDoc = companyId => firestore.collection('glRecSetup').doc(companyId);
const recId = (c, a, m) => c + '__' + a + '__' + m;
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const lastDay = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const historyWith = (rec, what, user, note) => (rec.History || []).concat([{ At: new Date().toISOString(), By: actorOf(user), What: what, Note: note || '' }]).slice(-200);

const DENIED = { access: 'You do not have access to GL Account Reconciliation.', prepare: 'You do not have permission to prepare GL account reconciliations.',
  reopen: 'You do not have permission to reopen a GL account reconciliation.', setup: 'You do not have permission to choose the accounts reconciled.' };
async function requireCap(user, cap) { if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) throw new HttpsError('permission-denied', DENIED[cap]); }
async function rightsOf(user) {
  const can = cap => moduleHasCapability(MODULE_ID, cap, user.profile.role);
  return { canPrepare: await can('prepare'), canReopen: await can('reopen'), canSetup: await can('setup') };
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
const keyOf = d => ({ companyId: text(d.companyId, 80), accountId: text(d.accountId, 80), month: text(d.month, 7) });

// The balance-sheet accounts a company may reconcile here (bank accounts are Bank Reconciliation's).
function candidates(coa, companyId) {
  return Object.keys(coa).filter(id => coa[id] && coa[id].Status === 'Active' && coa[id].IsPostable === true && BS_TYPES.includes(coa[id].AccountType) &&
    coa[id].CashBank !== 'Bank' && (!coa[id].CompanyID || coa[id].CompanyID === companyId))
    .map(id => ({ AccountID: id, AccountCode: String(coa[id].AccountCode || ''), AccountName: coa[id].AccountName || '', AccountType: coa[id].AccountType }))
    .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true }));
}
async function listOf(companyId) {
  const s = await setupDoc(companyId).get();
  return (s.exists ? s.data().Accounts : null) || [];
}
async function recsOf(companyId, accountId) {
  return (await recs().where('CompanyID', '==', companyId).get()).docs.map(d => Object.assign({ RecID: d.id }, d.data()))
    .filter(r => !accountId || r.AccountID === accountId);
}

// The account's posted lines to `end` (Dr positive), each keyed 'entryId:index'.
async function linesOf(companyId, accountId, end) {
  const snap = await firestore.collection('journalEntries').where('CompanyID', '==', companyId).where('JVDate', '<=', end).get();
  const out = [];
  snap.docs.forEach(d => {
    const e = d.data();
    if (e.Status !== 'Posted') return;
    (e.Lines || []).forEach((l, i) => {
      if (l.AccountID !== accountId) return;
      const amount = K.glAmount(l, false);
      if (!amount) return;
      out.push({ Key: d.id + ':' + i, Date: e.JVDate, Number: e.JVNumber || '', Reference: e.Reference || '', Description: l.Description || e.Description || '',
        VoucherType: e.VoucherType || '', PartyID: l.PartyID || '', Amount: amount });
    });
  });
  return out.sort((a, b) => a.Date.localeCompare(b.Date) || a.Number.localeCompare(b.Number));
}

// One account and month: the reconciliation (saved or new), its lines, and what explains the balance.
async function load(companyId, accountId, month) {
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const acc = candidates(coa, companyId).find(a => a.AccountID === accountId);
  if (!acc) throw new HttpsError('invalid-argument', 'Choose a balance-sheet account of the company.');
  const listed = (await listOf(companyId)).find(a => a.AccountID === accountId);
  if (!listed) throw new HttpsError('failed-precondition', 'That account is not on the company\'s list of accounts reconciled (Setup).');
  const end = lastDay(month);
  const [lines, all] = await Promise.all([linesOf(companyId, accountId, end), recsOf(companyId, accountId)]);
  const id = recId(companyId, accountId, month);
  const rec = all.find(r => r.RecID === id) || { RecID: id, CompanyID: companyId, AccountID: accountId, Month: month, Method: listed.Method, Status: 'New', Matches: [], Items: [], Notes: '' };
  const method = rec.Status === 'New' ? listed.Method : rec.Method;
  const balance = K.round2(lines.reduce((t, l) => t + l.Amount, 0));
  const elsewhere = new Map();
  all.filter(r => r.RecID !== id).forEach(r => (r.Matches || []).forEach(m => (m.GL || []).forEach(k => elsewhere.set(k, r.Month))));
  const usable = lines.filter(l => !(elsewhere.has(l.Key) && elsewhere.get(l.Key) < month));
  const mine = new Set([].concat(...(rec.Matches || []).map(m => m.GL || [])));
  const open = usable.filter(l => !mine.has(l.Key));
  const explained = method === 'Match' ? K.round2(open.reduce((t, l) => t + l.Amount, 0)) : K.round2((rec.Items || []).reduce((t, i) => t + (Number(i.Amount) || 0), 0));
  const prev = all.filter(r => r.Month < month).sort((a, b) => b.Month.localeCompare(a.Month))[0];
  return {
    account: Object.assign({}, acc, { Method: listed.Method }), month, monthEnd: end, method, rec,
    lines: usable.map(l => Object.assign({}, l, { Matched: mine.has(l.Key), MatchedLater: elsewhere.has(l.Key) ? elsewhere.get(l.Key) : '' })),
    report: { Balance: balance, Explained: explained, Difference: K.round2(balance - explained), OpenLines: open.length },
    previous: prev ? { Month: prev.Month, Status: prev.Status } : null
  };
}

exports.getGlRecSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const rights = await rightsOf(user);
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  if (!companyId) return { rights };
  requireCompany(user, companyId);
  const [coa, list] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), listOf(companyId)]);
  const month = isMonth(text(d.month, 7)) ? text(d.month, 7) : '';
  return { rights, candidates: candidates(coa, companyId), list, board: month ? await board(companyId, month, coa, list) : null };
});

// The month's board (Q372): each listed account, and each bank account (Bank Reconciliation's), with its status.
async function board(companyId, month, coa, list) {
  const [mine, banks] = await Promise.all([recsOf(companyId), firestore.collection('bankRecs').where('CompanyID', '==', companyId).get()]);
  const st = {};
  mine.filter(r => r.Month === month).forEach(r => { st[r.AccountID] = r.Status; });
  const bankSt = {};
  banks.docs.map(x => x.data()).filter(r => r.Month === month).forEach(r => { bankSt[r.AccountID] = r.Status; });
  const name = id => (coa[id] ? String(coa[id].AccountCode || '') + ' ' + (coa[id].AccountName || '') : id);
  const rows = list.map(a => ({ Kind: 'GL', AccountID: a.AccountID, Name: name(a.AccountID), Method: a.Method, Status: st[a.AccountID] || 'Not started' }));
  Object.keys(coa).filter(id => coa[id] && coa[id].CashBank === 'Bank' && coa[id].Status === 'Active' && coa[id].IsPostable === true && (!coa[id].CompanyID || coa[id].CompanyID === companyId))
    .forEach(id => rows.push({ Kind: 'Bank', AccountID: id, Name: name(id), Method: 'Bank', Status: bankSt[id] || 'Not started' }));
  return rows.sort((a, b) => a.Name.localeCompare(b.Name, undefined, { numeric: true }));
}

// The company's list (Q372): accounts and their methods (Q371).
exports.saveGlRecList = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'setup');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const ok = new Set(candidates(coa, companyId).map(a => a.AccountID));
  const seen = new Set();
  const accounts = (Array.isArray(d.accounts) ? d.accounts : []).slice(0, MAX_ACCOUNTS).map(a => {
    const id = text(a.AccountID, 80), m = text(a.Method, 20);
    if (!ok.has(id)) throw new HttpsError('invalid-argument', 'Only the company\'s active balance-sheet accounts, not bank accounts, can be listed: ' + id + '.');
    if (!METHODS.includes(m)) throw new HttpsError('invalid-argument', 'A method is Match or Schedule.');
    if (seen.has(id)) throw new HttpsError('invalid-argument', 'An account is listed twice.');
    seen.add(id);
    return { AccountID: id, Method: m };
  });
  await setupDoc(companyId).set({ Accounts: accounts, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) });
  return { success: true, count: accounts.length };
});

exports.getGlRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const { companyId, accountId, month } = keyOf(request.data || {});
  requireCompany(user, companyId);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const out = await load(companyId, accountId, month);
  if (out.rec.Status === 'PendingApproval' && out.rec.ApprovalInstanceID) {
    const inst = await require('./approvalStore').approvalInstances.get(out.rec.ApprovalInstanceID);
    out.rec.MyLevel = inst && inst.Status === 'Pending' ? require('./approvalCard').myLevel(inst, user.uid) : null;
  }
  return Object.assign(out, { rights: await rightsOf(user) });
});

// Saves the month's work: the matches (Match: each must net to nothing) or
// the schedule's items (Schedule), and the notes.
exports.saveGlRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const d = request.data || {};
  const { companyId, accountId, month } = keyOf(d);
  requireCompany(user, companyId);
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const cur = await load(companyId, accountId, month);
  if (!EDITABLE.includes(cur.rec.Status)) throw new HttpsError('failed-precondition', cur.rec.Status === 'Approved' ? 'This month is reconciled and locked: reopen it to change it.' : 'This reconciliation is waiting for approval: it can no longer be changed.');
  let matches = cur.rec.Matches || [], items = cur.rec.Items || [];
  if (cur.method === 'Match' && Array.isArray(d.matches)) {
    const byKey = {};
    cur.lines.filter(l => !l.MatchedLater).forEach(l => { byKey[l.Key] = l; });
    const used = new Set();
    matches = d.matches.map((m, i) => {
      const g = (m.GL || []).map(k => text(k, 200));
      if (g.length < 2) throw new HttpsError('invalid-argument', 'Match ' + (i + 1) + ': choose at least two lines that offset each other.');
      const why = K.checkMatch({ GL: g, ST: [] }, byKey, {});
      if (why) throw new HttpsError('invalid-argument', 'Match ' + (i + 1) + ': ' + why.replace('and statement lines (0.00) differ', 'do not net to nothing') + '.');
      if (g.some(k => used.has(k))) throw new HttpsError('invalid-argument', 'Match ' + (i + 1) + ': a line is in another match too.');
      g.forEach(k => used.add(k));
      return { MatchID: text(m.MatchID, 40) || randomUUID().slice(0, 12), GL: g };
    });
  }
  if (cur.method === 'Schedule' && Array.isArray(d.items)) {
    if (d.items.length > MAX_ITEMS) throw new HttpsError('invalid-argument', 'A schedule holds at most ' + MAX_ITEMS + ' items.');
    items = d.items.map((x, i) => {
      const amount = Number(String(x.Amount == null ? '' : x.Amount).replace(/,/g, ''));
      if (!Number.isFinite(amount) || !amount) throw new HttpsError('invalid-argument', 'Item ' + (i + 1) + ': an amount (negative for a credit).');
      const desc = text(x.Description, 300);
      if (!desc) throw new HttpsError('invalid-argument', 'Item ' + (i + 1) + ': describe it.');
      return { ItemID: text(x.ItemID, 40) || randomUUID().slice(0, 12), Description: desc, Reference: text(x.Reference, 120), Amount: K.round2(amount) };
    });
  }
  const now = new Date().toISOString(), by = actorOf(user);
  await recs().doc(cur.rec.RecID).set({
    CompanyID: companyId, AccountID: accountId, Month: month, Method: cur.method, Status: cur.rec.Status === 'Rejected' ? 'Rejected' : 'Draft',
    RejectionReason: cur.rec.RejectionReason || '', Matches: matches, Items: items, Notes: d.notes === undefined ? (cur.rec.Notes || '') : text(d.notes, 2000),
    History: historyWith(cur.rec, cur.rec.Status === 'New' ? 'Started' : 'Saved', user), CreatedAt: cur.rec.CreatedAt || now, CreatedBy: cur.rec.CreatedBy || by, UpdatedAt: now, UpdatedBy: by
  });
  return Object.assign(await load(companyId, accountId, month), { success: true, rights: await rightsOf(user) });
});

exports.deleteGlRecDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const { companyId, accountId, month } = keyOf(request.data || {});
  requireCompany(user, companyId);
  const ref = recs().doc(recId(companyId, accountId, month));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No reconciliation for that month.');
  if (!['Draft', 'Rejected'].includes(snap.data().Status)) throw new HttpsError('failed-precondition', 'Only a draft or a rejected reconciliation can be deleted.');
  await ref.delete();
  return { success: true };
});

async function commitApproval(user, rec, what) {
  const now = new Date().toISOString();
  await recs().doc(rec.RecID).update({ Status: 'Approved', ApprovedAt: now, ApprovedBy: actorOf(user), RejectionReason: '', UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(rec, what, user) });
}

// Submitted: the balance explained (difference nothing) and the account's
// earlier reconciled month approved; approved through Approval
// Configuration (Q373), then locked.
exports.submitGlRec = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'prepare');
  const { companyId, accountId, month } = keyOf(request.data || {});
  requireCompany(user, companyId);
  return withGlobalLock(user.uid, async () => {
    const cur = await load(companyId, accountId, month);
    if (!['Draft', 'Rejected'].includes(cur.rec.Status)) throw new HttpsError('failed-precondition', 'Only a draft or rejected reconciliation can be submitted.');
    if (cur.report.Difference !== 0) throw new HttpsError('failed-precondition', 'The difference is ' + cur.report.Difference.toFixed(2) + ': the balance must be explained to submit.');
    if (cur.previous && cur.previous.Status !== 'Approved') throw new HttpsError('failed-precondition', cur.previous.Month + ' is not approved yet: the months are reconciled in order.');
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: companyId });
    const approval = await beginApprovalInstance(MODULE_ID, cur.rec.RecID, cur.account.AccountCode + ' ' + month, scopeKey, Math.abs(cur.report.Balance), user.uid);
    const now = new Date().toISOString();
    if (approval.required) {
      await recs().doc(cur.rec.RecID).update({ Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '', SubmittedAt: now, SubmittedBy: actorOf(user),
        UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(cur.rec, 'Submitted for approval', user) });
      return { success: true, status: 'PendingApproval' };
    }
    await commitApproval(user, cur.rec, 'Approved (no approval required)');
    return { success: true, status: 'Approved' };
  });
});

exports.decideGlRecApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const snap = await recs().doc(text(d.recId, 200)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'GL account reconciliation not found.');
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

exports.reopenGlRec = onCallWithMessages(onCallOptions, async (request) => {
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
    const now = new Date().toISOString();
    await recs().doc(rec.RecID).update({ Status: 'Draft', ApprovalInstanceID: '', ReopenedAt: now, ReopenedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(rec, 'Reopened', user, reason) });
    return { success: true, status: 'Draft' };
  });
});

// For Period Closing (Q374): the listed accounts whose month is not approved.
async function checkMonth(companyId, month) {
  const list = await listOf(companyId);
  if (!list.length) return [];
  const [coa, all] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), recsOf(companyId)]);
  const st = {};
  all.filter(r => r.Month === month).forEach(r => { st[r.AccountID] = r.Status; });
  return list.filter(a => st[a.AccountID] !== 'Approved').map(a => ({ AccountID: a.AccountID,
    Name: coa[a.AccountID] ? String(coa[a.AccountID].AccountCode || '') + ' ' + (coa[a.AccountID].AccountName || '') : a.AccountID, Status: st[a.AccountID] || 'Not started' }));
}
exports.checkMonth = checkMonth;
