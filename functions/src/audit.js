// The audit log (owner, 2026-11-13; docs/modules/AUDIT_LOG.md, Q508-Q509,
// QA1-QA7). One writer for the whole system: every entry goes through
// record(), and no other file writes auditLog (unit/auditLog checks it).
// Append-only: nothing here updates or deletes an entry; only the 7-year
// sweep and Data Reset will (step 3).
//
// Step 1 (this file): the action of every request that changes something
// (afterCall, from callable.js: QA1, QA4) and every document's status
// change, creation and deletion (documentChanged, from docStore.js). The
// masters' changed fields, sensitive fields, sign-ins and the firm's
// actions come in step 2.
//
//   auditLog/{time-ordered id}
//     At, UserID, UserName, Role, Action, Function, ModuleID, RecordID,
//     RecordLabel, CompanyID, Totals, Changes, Outcome ('done' | 'refused')
// New development, hand-written.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const { firestore, rtdb } = require('./firebaseAdmin');

// Per request (callable.js runs each request inside it): the request, and
// its user once read, so a document written deep inside a save knows who.
const store = new AsyncLocalStorage();
// pending: document changes made in a batch, recorded only once the request
// has succeeded (a batch that failed never committed them).
const runWithRequest = (request, fn) => store.run({ request, who: null, pending: [] }, fn);

const COLLECTION = 'auditLog';

// What a request does, from its function's name (the shell's SAVING_CALL
// verbs, and a few more). A name with none of them changes nothing: it is
// not recorded (QA1: views are not).
const VERBS = [
  ['decide', 'decide'], ['approve', 'approve'], ['reject', 'reject'], ['submit', 'submit'], ['post', 'post'],
  ['reverse', 'reverse'], ['delete', 'delete'], ['remove', 'delete'], ['cancel', 'cancel'], ['close', 'close'],
  ['confirm', 'confirm'], ['finalise', 'finalise'], ['finalize', 'finalise'], ['save', 'save'], ['create', 'create'],
  ['update', 'save'], ['set', 'save'], ['add', 'save'], ['mark', 'status'], ['record', 'save'], ['run', 'run'],
  ['publish', 'publish'], ['reset', 'reset'], ['tick', 'save'], ['copy', 'save'], ['import', 'import'],
  ['provide', 'save'], ['test', null], ['request', 'submit'], ['revise', 'save'], ['restore', 'save'],
  ['release', 'run'], ['purge', 'delete'], ['give', 'save'], ['upload', 'save'], ['change', 'save']
];
// Never actions, whatever their name says: reads, and the log's own reader.
const NOT_ACTIONS = /^(get|list|find|search|check|load|read|preview|compare|corporateSignIn|userIdSignIn|essPortal$|restoreSession|completeLogin)/;

function actionOf(fn, data) {
  const name = String(fn || '');
  if (!name || NOT_ACTIONS.test(name)) return null;
  const lower = name.toLowerCase();
  for (const [verb, action] of VERBS) {
    if (lower.startsWith(verb)) {
      if (action === 'decide') {
        const d = data && (data.decision || (Array.isArray(data.__positional) ? data.__positional[2] : ''));
        return /^reject/i.test(String(d || '')) ? 'reject' : 'approve';
      }
      return action;
    }
  }
  return null;
}

// The module a function belongs to: the longest module id (or alias) its
// name contains, so decideInventoryPurchaseRequisitionApproval is the IPR,
// not the PR. '' when none is found (the entry still has its Function).
const ALIASES = { journal: 'JV', cashbank: 'CBT', cbt: 'CBT', grn: 'GRN', pdcreceived: 'PDCRECEIVED', pdcissued: 'PDCISSUED',
  firebaseuser: 'USERMGMT', role: 'ROLES', permission: 'ROLES', company: 'COMPANYMASTER', vendor: 'VENDORMASTER',
  customer: 'CUSTOMERMASTER', item: 'ITEMMASTER', account: 'COA', orgunit: 'ORGUNITS', developer: 'DEVELOPER',
  materialissue: 'MATERIALISSUE', stockadjustment: 'STOCKADJUSTMENT', warehousemovement: 'WAREHOUSEMOVEMENT' };
function moduleOf(fn) {
  const lower = String(fn || '').toLowerCase();
  let best = '', bestLen = 0;
  const consider = (key, id) => { if (key.length > bestLen && lower.includes(key)) { best = id; bestLen = key.length; } };
  try { require('./moduleRegistry').MODULE_REGISTRY.forEach(m => consider(String(m.id).toLowerCase(), m.id)); } catch (e) { /* the registry is always there */ }
  Object.entries(ALIASES).forEach(([k, id]) => consider(k, id));
  return best;
}

// The record a request acts on: an id its answer gives (a new document's),
// else one it was sent (…Id / …ID, at the top or one level down).
const ID_KEY = /^[A-Za-z]+(Id|ID)$/;
function recordIdOf(data, result) {
  const look = o => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
    const k = Object.keys(o).find(x => ID_KEY.test(x) && !/^(company|division|branch|costCenter|profitCenter|project|warehouse|vendor|customer|employee|account|currency|item|instance|approvalInstance|corporate)I[dD]$/i.test(x) && o[x] && typeof o[x] !== 'object');
    return k ? String(o[k]) : '';
  };
  const fromResult = look(result);
  if (fromResult) return fromResult;
  if (data && Array.isArray(data.__positional) && typeof data.__positional[0] === 'string') return data.__positional[0];
  return look(data) || Object.values(data || {}).map(v => look(v)).find(Boolean) || '';
}

// A refusal worth keeping (QA4): rights and limits, not validation.
const REFUSAL = /permission|do not have access|not allowed|subscription allows|only an admin|admin only/i;
function refusalOf(err, result) {
  const msg = err ? String((err && err.message) || err) : (result && result.success === false ? String(result.error || '') : '');
  if (!msg) return null;
  const code = err && err.code;
  if (code === 'permission-denied' || REFUSAL.test(msg)) return msg.slice(0, 300);
  return '';
}

function newId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + Math.random().toString(36).slice(2, 8);
}

// The user a request runs as (a client corporate's request carries its own
// user's token: callable.js has already checked it). Read once per request.
async function whoIs(request) {
  const h = store.getStore();
  const req = request || (h && h.request);
  const uid = req && (req.auth && req.auth.uid || req.__auditUid);
  if (!uid) return { UserID: '', UserName: '', Role: '' };
  if (h && h.who && h.who.UserID === uid) return h.who;
  let u = {};
  try { u = (await rtdb.ref('users/' + uid).get()).val() || {}; } catch (e) { u = {}; }
  const who = { UserID: uid, UserName: String(u.fullName || u.username || ''), Role: String(u.role || '') };
  if (h) h.who = who;
  return who;
}

// One entry. Never throws: a failed audit write must not fail the save.
async function record(entry) {
  try {
    const doc = Object.assign({
      At: new Date().toISOString(), UserID: '', UserName: '', Role: '', Action: '', Function: '', ModuleID: '',
      RecordID: '', RecordLabel: '', CompanyID: '', Totals: null, Changes: null, Outcome: 'done'
    }, entry);
    Object.keys(doc).forEach(k => { if (doc[k] === undefined) doc[k] = null; });
    await firestore.collection(COLLECTION).doc(newId()).set(doc);
  } catch (e) {
    console.error('audit: could not record', e && e.message);
  }
}

// From callable.js, once a request has answered (result) or failed (err).
async function afterCall(fn, request, result, err) {
  const data = (request && request.data && request.data.__data !== undefined) ? request.data.__data : (request && request.data);
  const h = store.getStore();
  const pending = h ? h.pending.splice(0) : [];
  const failed = Boolean(err) || (result && result.success === false);
  if (!failed) for (const e of pending) await record(e); // the batch committed
  const action = actionOf(fn, data);
  if (!action) return;
  const refused = refusalOf(err, result);
  if (refused === '') return; // failed for another reason: nothing changed (QA4)
  const who = await whoIs(request);
  if (!who.UserID) return;
  await record(Object.assign({}, who, {
    Action: action, Function: String(fn), ModuleID: moduleOf(fn), RecordID: recordIdOf(data, result).slice(0, 120),
    CompanyID: String((data && (data.CompanyID || data.companyId || (data.header && data.header.CompanyID))) || ''),
    Outcome: refused ? 'refused' : 'done', Totals: refused ? { Reason: refused } : null
  }));
}

// From docStore.js, after a document is written: its creation, deletion or
// status change, with its key totals (Q508: not every line).
const AMOUNT_FIELDS = ['GrandTotal', 'TotalAmount', 'Total', 'Amount', 'NetAmount', 'TotalDebit'];
const NUMBER_FIELDS = ['TransactionNumber', 'DocumentNumber', 'Number', 'PONumber', 'SONumber', 'IPRNumber', 'PRNumber', 'JVNumber', 'QuotationNumber'];
function documentEntry(store, id, before, after) {
  const was = before ? before.Status : undefined, is = after ? after.Status : undefined;
  let action;
  if (!before && after) action = 'create';
  else if (before && !after) action = 'delete';
  else if (was !== is) action = 'status';
  else return null;
  const doc = after || before || {};
  const amountKey = AMOUNT_FIELDS.find(k => typeof doc[k] === 'number');
  const label = NUMBER_FIELDS.map(k => doc[k]).find(v => v);
  return {
    Action: action, Function: '', ModuleID: String(doc.ModuleID || ''), RecordID: String(id), RecordLabel: String(label || ''),
    CompanyID: String(doc.CompanyID || ''), Store: String(store || ''), DocumentType: String(doc.TransactionType || ''),
    Totals: Object.assign({ Status: (was || '') + ' → ' + (is || '') }, amountKey ? { Amount: doc[amountKey], Currency: doc.CurrencyCode || doc.Currency || '' } : {})
  };
}
// inBatch: the write joined a batch or transaction not yet committed.
async function documentChanged(storeName, id, before, after, inBatch) {
  const e = documentEntry(storeName, id, before, after);
  if (!e) return;
  const who = await whoIs();
  if (!who.UserID) return; // outside a user's request (a scheduled task): step 2 names those
  const entry = Object.assign({}, who, e);
  if (inBatch) { store.getStore().pending.push(entry); return; }
  await record(entry);
}

module.exports = { COLLECTION, runWithRequest, record, afterCall, documentChanged, actionOf, moduleOf, recordIdOf, refusalOf, documentEntry };
