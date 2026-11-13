// The audit log (owner, 2026-11-13; docs/modules/AUDIT_LOG.md, Q508-Q509,
// QA1-QA7). One writer for the whole system: every entry goes through
// record(), and no other file writes auditLog (unit/auditLog checks it).
// Append-only: nothing here updates or deletes an entry; only the 7-year
// sweep and Data Reset will (step 3).
//
// Step 1: the action of every request that changes something (afterCall,
// from callable.js: QA1, QA4) and every document's status change, creation
// and deletion (documentChanged, from docStore.js).
// Step 2: the changed fields of the masters and settings (masterChanged,
// from auditWrites.js: QA2, QA8), sensitive fields as "changed" only (QA3),
// sign-ins and sign-outs (QA5), and the firm's changes to a client also in
// the client's log, as "The provider" (QA6). Outside a user's request (a
// scheduled function), the user is "System".
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
// has succeeded (a batch that failed never committed them). changes: the
// masters it changed, by record (first before, last after), recorded when
// it answers whether or not it succeeded (each write had committed).
const runWithRequest = (request, fn) => store.run({ request, who: null, pending: [], changes: new Map() }, fn);

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
const NOT_ACTIONS = /^(get|list|find|search|check|load|read|preview|compare|corporateSignIn|userIdSignIn|essPortal$|restoreSession|completeLogin|recordSignOut)/;

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
const SYSTEM = { UserID: '', UserName: 'System', Role: '' };
// Whether writes are being watched: in a request, or in a deployed function
// outside one (a scheduled task). A test or tool calling the modules
// directly is neither.
const watching = () => Boolean(store.getStore() || process.env.FUNCTION_TARGET || process.env.K_SERVICE);
async function whoIs(request) {
  const h = store.getStore();
  const req = request || (h && h.request);
  const uid = req && (req.auth && req.auth.uid || req.__auditUid);
  if (!uid) return h ? { UserID: '', UserName: '', Role: '' } : SYSTEM;
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
  const changed = h ? [...h.changes.values()] : [];
  if (h) h.changes.clear();
  if (changed.length) {
    const who = await whoIs(request);
    for (const c of changed) await recordMaster(c, who, fn);
  }
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
  if (!who.UserID && who !== SYSTEM) return; // a request with no user (signing in)
  if (who === SYSTEM && !watching()) return;
  const entry = Object.assign({}, who, e);
  if (inBatch) { store.getStore().pending.push(entry); return; }
  await record(entry);
}

// ---------- the masters and settings (step 2) ----------

// Fields that change with every save and say nothing about it.
const NOISE = /^(lastLogin|LastSignIn|LastSeen|CreatedAt|CreatedBy|CreatedByName|UpdatedAt|UpdatedBy|UpdatedByName|updatedAt|updatedBy|createdAt|createdBy|ModifiedAt|ModifiedBy|LastModified|LastModifiedAt|LastModifiedBy|ModulesUpdatedAt|ModulesUpdatedBy|LimitsUpdatedAt|LimitsUpdatedBy)$/;
// QA3: these say only that they changed, never their values. Passwords and
// tokens included; a whole record of pay is sensitive.
const SENSITIVE = /(salary|salaries|wage|iban|bank.?account|account.?(no|num|number)$|swift|routing|password|passwd|secret|token|api.?key|private.?key|^pin$|credential)/i;
const SENSITIVE_RECORDS = /^fs:employeeCompensation\//;
const MAX_CHANGES = 100;

const short = v => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > 200 ? t.slice(0, 199) + '…' : t;
};
function flatten(v, at, out, depth) {
  if (v && typeof v === 'object' && !Array.isArray(v) && depth < 6 && Object.keys(v).length) {
    Object.keys(v).forEach(k => flatten(v[k], at ? at + '.' + k : k, out, depth + 1));
  } else if (at) out[at] = v;
  return out;
}
// [{ Field, From, To }] or [{ Field, Changed: true }] for a sensitive one.
function fieldChanges(before, after, ignore, allSensitive) {
  const b = flatten(before, '', {}, 0), a = flatten(after, '', {}, 0);
  const keys = [...new Set(Object.keys(b).concat(Object.keys(a)))].sort();
  const out = [];
  keys.forEach(k => {
    const from = b[k] === undefined ? null : b[k], to = a[k] === undefined ? null : a[k];
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    const parts = k.split('.');
    if (NOISE.test(parts[parts.length - 1])) return;
    if (ignore && ignore.test(k)) return;
    if (allSensitive || parts.some(p => SENSITIVE.test(p))) out.push({ Field: k, Changed: true });
    else out.push({ Field: k, From: short(from), To: short(to) });
  });
  if (out.length > MAX_CHANGES) return out.slice(0, MAX_CHANGES).concat([{ Field: '…', More: out.length - MAX_CHANGES }]);
  return out;
}

const LABELS = ['Name', 'name', 'LegalName', 'FullName', 'fullName', 'AccountName', 'ItemName', 'VendorName', 'CustomerName', 'Title', 'Code', 'Description', 'username', 'Email', 'email'];
// The entry for one record's change (null when nothing that matters changed).
function masterEntry(c) {
  const where = String(c.key || '').replace(/^(rtdb|fs):/, '');
  const parts = where.split('/');
  const source = (c.key || '').startsWith('fs:') ? parts[0] : 'rtdb:' + parts[0];
  if (c.many) {
    const n = c.many === 'all' ? 'the whole list' : c.many + (c.many === 1 ? ' record' : ' records');
    return { Action: 'change', ModuleID: c.module || '', RecordID: '(' + n + ')', RecordLabel: '', Source: source, Changes: null, Totals: { Records: c.many, IDs: (c.ids || []).map(String) } };
  }
  const before = c.before === undefined ? null : c.before, after = c.after === undefined ? null : c.after;
  if (before === null && after === null) return null;
  const isObj = v => v !== null && typeof v === 'object';
  const changes = fieldChanges(isObj(before) ? before : (before === null ? null : { value: before }), isObj(after) ? after : (after === null ? null : { value: after }), c.ignore, SENSITIVE_RECORDS.test(c.key || ''));
  if (!changes.length) return null;
  const action = before === null ? 'create' : (after === null ? 'delete' : 'change');
  const rec = isObj(after) ? after : (isObj(before) ? before : {});
  const label = LABELS.map(k => rec[k]).find(v => v && typeof v !== 'object');
  return { Action: action, ModuleID: c.module || '', RecordID: parts.slice(1).join('/').slice(0, 120), RecordLabel: String(label || '').slice(0, 120), Source: source, Changes: changes, CompanyID: String(rec.CompanyID || '') };
}

const PROVIDER = { UserID: '', UserName: 'The provider', Role: 'Provider' };
const CLIENT_FIELDS = /^(Modules|Packs|MaxCompanies|MaxUsers|Status|Name|Group)$/;
// In another corporate's log (QA6): never fails, never waits long.
async function recordIn(corporate, entry) {
  try {
    const fa = require('./firebaseAdmin');
    if (!corporate || !corporate.id || String(corporate.id) === fa.corporateId()) return;
    await fa.withinReach(corporate, () => fa.runInCorporate(corporate, () => record(entry)), 8000);
  } catch (e) {
    console.error('audit: could not record in corporate', corporate && corporate.id, e && e.message);
  }
}

async function recordMaster(c, who, fn) {
  const e = masterEntry(c);
  if (!e) return;
  const entry = Object.assign({}, who, e, { Function: String(fn || process.env.FUNCTION_TARGET || '') });
  const fa = require('./firebaseAdmin');
  let here = '';
  try { here = fa.corporateId(); } catch (err) { return; }
  if (c.corporate && String(c.corporate.id) !== here) {
    // The firm, working inside a client: in the client's log as the provider, and in its own.
    await recordIn(c.corporate, Object.assign({}, entry, PROVIDER));
    await record(Object.assign({}, entry, { ClientCorporate: String(c.corporate.id) }));
    return;
  }
  await record(c.client ? Object.assign({}, entry, { ClientCorporate: String(c.client) }) : entry);
  // The client's copy: only what is the client's business (its modules,
  // limits, status), not the firm's own notes on it (a connection test, a
  // release's result).
  const theirs = c.client && (entry.Changes || []).filter(x => CLIENT_FIELDS.test(String(x.Field).split('.')[0]));
  if (theirs && theirs.length) {
    const dir = (c.after && typeof c.after === 'object' ? c.after : c.before) || {};
    await recordIn({ id: String(c.client), entry: dir }, Object.assign({}, entry, PROVIDER, { Changes: theirs }));
  }
}

// From auditWrites.js: a master's record changed (or, with many, a write
// touched too many records to read). In a request, kept until it answers.
async function masterChanged(c) {
  const h = store.getStore();
  if (h) {
    const key = (c.corporate && c.corporate.id) + '|' + c.key;
    const prev = h.changes.get(key);
    if (prev && !prev.many && !c.many) prev.after = c.after;
    else h.changes.set(key, Object.assign({}, c));
    return;
  }
  await recordMaster(c, SYSTEM, '');
}
// The record as this request last left it, if it has written it (undefined
// if not), so a second write needs no second read.
async function knownAfter(corporate, key) {
  const h = store.getStore();
  const prev = h && h.changes.get((corporate && corporate.id) + '|' + key);
  return prev && !prev.many ? prev.after : undefined;
}

// ---------- sign-ins and sign-outs (QA5) ----------

// how: 'ERP' or 'Portal'. who: given for the portal (its users are
// employees, not ERP users).
async function session(action, request, how, who) {
  const w = who || await whoIs(request);
  if (!w.UserID) return;
  await record(Object.assign({}, w, {
    Action: action, Function: String(process.env.FUNCTION_TARGET || ''), ModuleID: '', RecordID: w.UserID, RecordLabel: how
  }));
}
const signIn = (request, how, who) => session('signin', request, how, who);
const signOut = (request, how, who) => session('signout', request, how, who);

module.exports = {
  COLLECTION, runWithRequest, record, afterCall, documentChanged, actionOf, moduleOf, recordIdOf, refusalOf, documentEntry,
  watching, masterChanged, knownAfter, fieldChanges, masterEntry, signIn, signOut
};
