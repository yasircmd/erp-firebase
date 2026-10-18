// Renumbering a used account within its heading, and the accounts to fix
// (owner, 2026-10-16; docs/modules/COA_NUMBERING.md, decisions 198-202).
// New development, hand-written.
//
// Renumber: an account that takes postings gets another free code of its
// own group or sub-group (198), by whoever may change the Chart of Accounts
// (199). Under the global lock, every stored copy of the old code is
// rewritten to the new one (GL lines, drafts, invoice and PDC lines,
// recurring templates, requisitions and orders: every ...AccountCode field
// of the stores coaUsage.js searches), then the account takes the new code
// and keeps the old one in FormerCodes. Its ID doesn't change, so balances
// and every link by ID stay as they are. Amounts don't change, so a closed
// month is not in the way. Headings are not renumbered for now (202).
//
// Accounts to fix (201): accounts that take postings but are not under a
// group (coaScheme.accountsToFix), listed on Chart of Accounts.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const scheme = require('./coaScheme');
const { RTDB_STORES, FIRESTORE_STORES } = require('./coaUsage');
const movedPaths = require('./movedPaths');

const onCallOptions = { region: 'us-central1' };
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const isPlain = v => v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const chart = async () => (await rtdb.ref('coa').get()).val() || {};

async function requireCoa(user, cap) {
  if (!(await moduleHasCapability('COA', cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change the Chart of Accounts.' : 'You do not have access to Chart of Accounts.');
  }
}
async function loadAccount(user, id) {
  const coa = await chart();
  const a = coa[text(id, 80)];
  if (!a) throw new HttpsError('not-found', 'Account not found.');
  if (a.CompanyID && !userCanAccessCompany(user.profile, a.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return { coa, a };
}

// A copy of value with every ...AccountCode field equal to from set to to,
// and how many were changed. Only plain objects and arrays are walked
// (Firestore timestamps and the like are kept as they are).
function rewrite(value, from, to, key) {
  if (Array.isArray(value)) {
    let n = 0;
    const out = value.map(v => { const r = rewrite(v, from, to, key); n += r.n; return r.v; });
    return { v: out, n };
  }
  if (isPlain(value)) {
    let n = 0;
    const out = {};
    Object.keys(value).forEach(k => { const r = rewrite(value[k], from, to, k); n += r.n; out[k] = r.v; });
    return { v: out, n };
  }
  if (/accountcode$/i.test(key || '') && String(value) === from && (typeof value === 'string' || typeof value === 'number')) return { v: typeof value === 'number' ? Number(to) : to, n: 1 };
  return { v: value, n: 0 };
}
// Rewrites one record: only its top-level fields that change are written.
function changedFields(data, from, to) {
  const fields = {};
  let n = 0;
  Object.keys(data || {}).forEach(k => {
    const r = rewrite(data[k], from, to, k);
    if (r.n) { fields[k] = r.v; n += r.n; }
  });
  return { fields, n };
}

async function rewriteCopies(from, to) {
  const counts = {};
  for (const [col, what] of FIRESTORE_STORES) {
    const snap = await firestore.collection(col).get();
    let batch = firestore.batch(), inBatch = 0;
    for (const d of snap.docs) {
      const { fields, n } = changedFields(d.data(), from, to);
      if (!n) continue;
      batch.update(d.ref, fields);
      counts[what] = (counts[what] || 0) + 1;
      if (++inBatch === 400) { await batch.commit(); batch = firestore.batch(); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
  }
  for (const [path, what] of RTDB_STORES) {
    // The moved documents are in Firestore (movedPaths.js), by the same path
    // name; their changed fields are written there.
    const moved = movedPaths.storeOf(path);
    const data = (moved ? await moved.all() : (await rtdb.ref(path).get()).val()) || {};
    const updates = {};
    for (const id of Object.keys(data)) {
      const { fields, n } = changedFields(data[id], from, to);
      if (!n) continue;
      if (moved) await moved.update(id, fields);
      else Object.keys(fields).forEach(k => { updates[id + '/' + k] = fields[k]; });
      counts[what] = (counts[what] || 0) + 1;
    }
    if (Object.keys(updates).length) await rtdb.ref(path).update(updates);
  }
  return counts;
}

// The free codes of the account's own heading.
exports.getAccountRenumberCodes = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCoa(user, 'write');
  const { coa, a } = await loadAccount(user, (request.data || {}).accountId);
  const codes = (() => { try { return scheme.freeCodes(text((request.data || {}).accountId, 80), coa); } catch (e) { bad(e.message); } })();
  const heading = coa[a.ParentAccountID] || {};
  return { accountCode: a.AccountCode, accountName: a.AccountName, heading: { AccountCode: heading.AccountCode || '', AccountName: heading.AccountName || '' }, codes };
});

exports.renumberAccount = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCoa(user, 'write');
  const d = request.data || {};
  const id = text(d.accountId, 80), to = text(d.newCode, 6), reason = text(d.reason, 300);
  if (!reason) bad('Give the reason for renumbering the account.');
  await loadAccount(user, id);
  return withGlobalLock(user.uid, async () => {
    const coa = await chart();
    const a = coa[id];
    let free;
    try { free = scheme.freeCodes(id, coa); } catch (e) { bad(e.message); }
    const heading = coa[a.ParentAccountID] || {};
    if (!free.includes(to)) bad(to + ' is not a free code of ' + (heading.AccountCode || 'its heading') + ' ' + (heading.AccountName || '') + ': choose one of its free codes (an account stays in its own heading).');
    const from = String(a.AccountCode);
    // The copies first: the old code is free only once none is left.
    const rewritten = await rewriteCopies(from, to);
    const now = new Date().toISOString(), by = user.profile.fullName || user.profile.username || user.uid;
    const former = (Array.isArray(a.FormerCodes) ? a.FormerCodes : []).concat([{ Code: from, Until: now, By: by, Reason: reason }]);
    await rtdb.ref('coa/' + id).update({ AccountCode: to, FormerCodes: former, UpdatedAt: now, UpdatedBy: user.profile.username || user.uid });
    await rtdb.ref('coaRenumberLog').push({ AccountID: id, AccountName: a.AccountName || '', From: from, To: to, Reason: reason, By: by, ByUid: user.uid, At: now, Rewritten: rewritten });
    return { success: true, from, to, rewritten };
  });
});

// Accounts that take postings but are not under a group (decision 201).
exports.getCoaAccountsToFix = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCoa(user, 'access');
  const coa = await chart();
  const mine = {};
  Object.keys(coa).forEach(id => { if (!coa[id].CompanyID || userCanAccessCompany(user.profile, coa[id].CompanyID)) mine[id] = coa[id]; });
  return { accounts: scheme.accountsToFix(Object.assign({}, coa, mine)).filter(x => mine[x.AccountID]) };
});

module.exports.rewrite = rewrite;
