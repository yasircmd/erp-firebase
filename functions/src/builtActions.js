// Module Builder, phase 3 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q474-Q480): a built record to the books. New development, hand-written.
//
// An action (builtDefinitions.cleanActions) creates a Customer Invoice, a
// Vendor Invoice or a Journal from a record, through that document's own save
// (saveCustomerInvoiceDraft, saveVendorInvoiceDraft, journal.saveJournalFor) as
// the user who runs it, so every check of that document applies (Q462): its
// rights, the company, an active party, postable accounts, the sales type,
// tax, projects, the period lock. "Submitted" is the document's own Post
// (Q479): it posts, or waits for its approvers.
//
// Once (Q477): an action creates its document once; a second is refused
// while the first is still there and not reversed (a deleted draft or a
// reversal frees it). A bulk run (Q475-Q476) takes the records due by their
// next-due date (proposed, the user unticks any), one document per record or
// per party, and moves each record's next-due date on by its period in the
// same step; a record behind by several periods is billed one period a run.
//
// Kept in the corporate's Firestore:
//   builtRecords/{id}.Created  [ { Action, Module, ID, Due?, At, By } ]
//   builtRecords/{id}.Claim    { Action, At, By } while a run makes its document
//   builtSetup/{X_ID}_{companyId}  { Actions: { key: { AccountCode,
//     DebitAccountCode, CreditAccountCode, SalesTypeID, CostCenterID,
//     ProfitCenterID, ProjectID, WarehouseID } } }   (the company's own books)
//   builtRuns/{auto}  { ModuleID, Action, CompanyID, Date, At, By, Made, Refused }
// and on the created document: BuiltSource { ModuleID, Label, Records: [{ id, number }] }
// (Document Links shows it, flows.js).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const B = require('./builtDefinitions');

const onCallOptions = { region: 'us-central1' };
const RECORDS = () => firestore.collection('builtRecords');
const SETUP = () => firestore.collection('builtSetup');
const RUNS = () => firestore.collection('builtRuns');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => { throw new HttpsError('failed-precondition', msg); };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v));
const by = user => user.profile.username || user.uid;
const CLAIM_MS = 10 * 60 * 1000;
const MAX_RUN = 300;
const SETUP_KEYS = Object.freeze(['AccountCode', 'DebitAccountCode', 'CreditAccountCode', 'SalesTypeID', 'CostCenterID', 'ProfitCenterID', 'ProjectID', 'WarehouseID']);
const today = () => { const S = require('./recurringSchedule'); return S.todayIn(S.TIME_ZONE); };

// ---------- pure ----------

// A date n months on, the day kept where the month has it (31 Jan + 1 = 28/29 Feb).
function addMonths(d, n) {
  const [y, m, day] = String(d).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
// A record's period in months for a bulk action, or 0 when it has none.
const monthsOf = (a, rec) => B.PERIODS[a.bulk.period || ((rec.Fields || {})[a.bulk.periodField] || '')] || 0;
const valueText = v => (v == null ? '' : typeof v === 'object' ? String(v.label || '') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const recNo = rec => rec.Number || rec.Code || rec.RecordID || '';

// The description with the record's values: {number}, {code}, {name}, {date},
// {due}, {period} (the due month, yyyy-mm) and any field's {key}.
function render(template, rec, due) {
  const f = rec.Fields || {};
  const own = { number: recNo(rec), code: rec.Code || '', name: rec.Name || '', date: rec.Date || '', due: due || '', period: due ? String(due).slice(0, 7) : '' };
  return String(template || '').replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (m, k) => (k in own ? own[k] : valueText(f[k]))).replace(/\s+/g, ' ').trim().slice(0, 200);
}

// The rows an action takes from a record: its header, or each of its lines.
const rowsOf = (a, rec) => (a.source === 'lines' ? (rec.Lines || []) : [{}]).map(l => ({ l, f: rec.Fields || {} }));
const valueAt = (row, k) => (k && Object.prototype.hasOwnProperty.call(row.l, k) ? row.l[k] : row.f[k]);
const linkId = v => (v && typeof v === 'object' ? text(v.id, 120) : '');

// The target document's draft, as its own save takes it. recs: one record, or
// one party's records (a grouped run). ctx: { date, dueOf(rec), accounts
// { accountId: code }, items { itemId: code }, partyAccounts { partyId: code } }.
function buildTargetDraft(def, a, recs, setup, ctx) {
  const s = setup || {};
  const first = recs[0];
  const at = r => recNo(r) + ': ';
  const grouped = recs.length > 1;
  const date = a.date ? (first.Fields || {})[a.date] : ctx.date;
  if (!isDate(date)) bad(at(first) + 'it has no ' + ((def.fields.find(f => f.key === a.date) || {}).label || 'date') + '.');
  const partyId = a.party ? linkId((first.Fields || {})[a.party]) : '';
  if (a.party && !partyId && a.target !== 'JV') bad(at(first) + 'choose its ' + (a.target === 'CUSTOMERINVOICE' ? 'customer.' : 'vendor.'));
  const dueOf = ctx.dueOf || (() => '');
  const description = grouped ? (a.label + ' ' + date) : render(a.description, first, dueOf(first));
  const lines = [];
  recs.forEach(rec => {
    rowsOf(a, rec).forEach(row => {
      const lineText = (a.lineText ? valueText(valueAt(row, a.lineText)) : '') || render(a.description, rec, dueOf(rec)) || a.label;
      if (a.kind === 'item') {
        const qty = Number(valueAt(row, a.quantity)) || 0;
        if (qty === 0) return;
        if (qty < 0) bad(at(rec) + 'a quantity below zero.');
        const code = (ctx.items || {})[linkId(valueAt(row, a.item))];
        if (!code) bad(at(rec) + 'a line has no item.');
        const wh = a.warehouse ? linkId(valueAt(row, a.warehouse)) : text(s.WarehouseID, 80);
        if (!wh) bad(at(rec) + 'no warehouse: choose one on the record, or set it in the module\'s Setup.');
        lines.push({ ItemCode: code, WarehouseID: wh, Quantity: qty, UnitPrice: round2(Number(valueAt(row, a.price)) || 0), CostCenterID: text(s.CostCenterID, 80) });
        return;
      }
      const amount = round2(Number(valueAt(row, a.amount)) || 0);
      if (amount === 0) return;
      if (amount < 0) bad(at(rec) + 'an amount below zero.');
      const acct = (k, setupKey) => {
        if (!k) return text(s[setupKey], 40);
        return (ctx.accounts || {})[linkId(valueAt(row, k))] || '';
      };
      if (a.target === 'JV') {
        const partyCode = partyId ? (ctx.partyAccounts || {})[partyId] : '';
        if (partyId && !partyCode) bad(at(rec) + 'its party has no account of its own.');
        const dr = a.partySide === 'debit' ? partyCode : acct(a.debitAccount, 'DebitAccountCode');
        const cr = a.partySide === 'credit' ? partyCode : acct(a.creditAccount, 'CreditAccountCode');
        if (!dr || !cr) bad(at(rec) + 'no ' + (!dr ? 'debit' : 'credit') + ' account: choose one on the record, or set it in the module\'s Setup.');
        const party = partyId ? { PartyType: def.fields.find(f => f.key === a.party).target === 'VENDOR' ? 'Vendor' : 'Customer', PartyID: partyId } : null;
        const dims = { CostCenterID: text(s.CostCenterID, 80), ProfitCenterID: text(s.ProfitCenterID, 80), ProjectID: text(s.ProjectID, 80) };
        lines.push(Object.assign({ AccountCode: dr, Description: lineText, Debit: amount, Credit: 0 }, dims, a.partySide === 'debit' && party ? party : {}));
        lines.push(Object.assign({ AccountCode: cr, Description: lineText, Debit: 0, Credit: amount }, dims, a.partySide === 'credit' && party ? party : {}));
        return;
      }
      const code = acct(a.account, 'AccountCode');
      if (!code) bad(at(rec) + 'no account: choose one on the record, or set it in the module\'s Setup.');
      const l = { AccountCode: code, Description: lineText, Amount: amount, CostCenterID: '', ProfitCenterID: '', ProjectID: text(s.ProjectID, 80) };
      if (a.target === 'CUSTOMERINVOICE') l.SalesTypeID = text(s.SalesTypeID, 80);
      lines.push(l);
    });
  });
  if (!lines.length) bad((grouped ? a.label : at(first)) + ' nothing to ' + (a.target === 'JV' ? 'journal' : 'invoice') + ': the amounts are zero.');
  if (a.target === 'CUSTOMERINVOICE' && !text(s.SalesTypeID, 80)) failed('Set the Sales Type for "' + a.label + '" in the module\'s Setup.');
  const reference = a.reference ? recs.map(r => valueText((r.Fields || {})[a.reference])).filter(Boolean).join(', ') : recs.map(recNo).join(', ');
  const head = { CompanyID: first.CompanyID, CostCenterID: text(s.CostCenterID, 80), ProfitCenterID: text(s.ProfitCenterID, 80), ProjectID: text(s.ProjectID, 80), Description: description };
  if (a.target === 'CUSTOMERINVOICE') {
    const items = a.kind === 'item';
    return Object.assign(head, { CustomerID: partyId, InvoiceDate: date, SourceDeliveryNotes: [], DirectLines: items ? [] : lines, ItemLines: items ? lines : [], ItemSalesTypeID: items ? text(s.SalesTypeID, 80) : '' });
  }
  if (a.target === 'VENDORINVOICE') return Object.assign(head, { VendorID: partyId, InvoiceDate: date, VendorRefNumber: reference.slice(0, 60), SourceGRNs: [], DirectLines: lines });
  return Object.assign(head, { JVDate: date, Reference: reference.slice(0, 100), Lines: lines });
}

// A bulk run's groups: one per record, or one per party (Q476).
function groupsOf(a, recs) {
  if (a.bulk.group !== 'party') return recs.map(r => [r]);
  const m = new Map();
  recs.forEach(r => { const k = linkId((r.Fields || {})[a.party]) || ('-' + r.RecordID); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.values()];
}

// Whether a record may run the action now: its status (a document) or on (a master); a reason when not.
function notRunnable(def, a, rec) {
  if (def.kind === 'master') return rec.Active === false ? 'it is switched off' : '';
  if (rec.PendingStatus) return 'it is waiting for approval';
  return a.statuses.includes(rec.Status) ? '' : 'it is ' + rec.Status + ' (the action is for ' + a.statuses.join(', ') + ')';
}
// Due on `date` in a bulk run: its next-due date on or before it, with a period.
function dueOn(a, rec, date) {
  const due = (rec.Fields || {})[a.bulk.nextDue];
  if (!isDate(due)) return { due: '', why: 'it has no next-due date' };
  if (due > date) return { due, why: 'it is due ' + due };
  if (!monthsOf(a, rec)) return { due, why: 'it has no period' };
  return { due, why: '' };
}

// ---------- the documents ----------

const STORES = {
  CUSTOMERINVOICE: () => require('./salesStore').customerInvoices,
  VENDORINVOICE: () => require('./purchaseStore').vendorInvoices
};
// The created document as it is now ({ number, status }), or null when gone or reversed (Q477).
async function liveDoc(module, id) {
  if (!id) return null;
  if (STORES[module]) {
    const d = await STORES[module]().get(id);
    return d && !d.ReversedByInvoiceID && !d.ReversalOfInvoiceID ? { number: d.TransactionNumber || '', status: d.Status || '' } : null;
  }
  const s = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(String(id)).get();
  const d = s.exists ? s.data() : null;
  return d && !d.ReversedByJV && !d.ReversalOfJV && d.Status !== 'Reversed' ? { number: d.JVNumber || '', status: d.Status || '' } : null;
}
// The record's created documents with their state now (newest first, at most 20 read).
async function createdOf(rec) {
  const list = (rec.Created || []).slice(-20).reverse();
  const out = [];
  for (const c of list) {
    const live = await liveDoc(c.Module, c.ID);
    out.push({ action: c.Action, module: c.Module, id: c.ID, due: c.Due || '', at: c.At, live: Boolean(live), number: live ? live.number : '', status: live ? live.status : 'Reversed or deleted' });
  }
  return out;
}
async function liveCreatedFor(rec, actionKey) {
  for (const c of (rec.Created || []).filter(x => x.Action === actionKey && !x.Due)) {
    const live = await liveDoc(c.Module, c.ID);
    if (live) return Object.assign({ module: c.Module, id: c.ID }, live);
  }
  return null;
}

async function createTarget(request, a, payload, source) {
  const L = require('./legacy/codegs');
  const { run } = require('./legacy/runtime');
  const journal = require('./journal');
  const res = a.target === 'CUSTOMERINVOICE' ? await run(request, ctx => L.saveCustomerInvoiceDraft(ctx, payload))
    : a.target === 'VENDORINVOICE' ? await run(request, ctx => L.saveVendorInvoiceDraft(ctx, payload))
      : await journal.saveJournalFor(request, payload);
  if (!res || res.success === false) failed((res && res.error) || 'The ' + B.TARGETS[a.target] + ' was not saved.');
  const id = res.invoiceId || res.jvId;
  try { // the link back (Document Links); the record keeps its own either way
    if (STORES[a.target]) await STORES[a.target]().update(id, { BuiltSource: source });
    else await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(id).update({ BuiltSource: source });
  } catch (e) { console.error('builtActions: BuiltSource not written on ' + a.target + ' ' + id, e); }
  const made = { module: a.target, id, number: '', status: 'Draft', note: '' };
  if (a.state === 'Submitted') {
    const p = a.target === 'CUSTOMERINVOICE' ? await run(request, ctx => L.postCustomerInvoice(ctx, id))
      : a.target === 'VENDORINVOICE' ? await run(request, ctx => L.postVendorInvoice(ctx, id))
        : await journal.postJournalFor(request, id);
    if (p && p.success !== false) Object.assign(made, { status: p.status || 'Posted', number: p.invoiceNumber || p.jvNumber || '' });
    else made.note = 'Saved as a draft, not posted: ' + ((p && p.error) || 'unknown reason');
  }
  return made;
}

// The ids an action's records name that need the books' codes.
async function resolve(def, a, recs) {
  const ctx = { accounts: {}, items: {}, partyAccounts: {} };
  const ids = k => { const out = new Set(); if (!k) return out; recs.forEach(r => rowsOf(a, r).forEach(row => { const id = linkId(valueAt(row, k)); if (id) out.add(id); })); return out; };
  const accountIds = new Set([...ids(a.account), ...ids(a.debitAccount), ...ids(a.creditAccount)]);
  const partyIds = a.target === 'JV' && a.party ? ids(a.party) : new Set();
  if (accountIds.size || partyIds.size) {
    const coa = (await rtdb.ref('coa').get()).val() || {};
    accountIds.forEach(id => { if (coa[id]) ctx.accounts[id] = coa[id].AccountCode; });
    if (partyIds.size) {
      const vendor = def.fields.find(f => f.key === a.party).target === 'VENDOR';
      const parties = (await rtdb.ref(vendor ? 'vendors' : 'customers').get()).val() || {};
      partyIds.forEach(id => { const acc = (parties[id] || {})[vendor ? 'TradePayablesAccountID' : 'TradeReceivablesAccountID']; if (acc && coa[acc]) ctx.partyAccounts[id] = coa[acc].AccountCode; });
    }
  }
  if (a.kind === 'item') {
    const items = (await rtdb.ref('items').get()).val() || {};
    ids(a.item).forEach(id => { if (items[id]) ctx.items[id] = items[id].ItemCode; });
  }
  return ctx;
}

const source = (def, recs) => ({ ModuleID: def.id, Label: def.label, Records: recs.slice(0, 50).map(r => ({ id: r.RecordID, number: recNo(r) })) });
const setupOf = async (def, companyId) => {
  const s = await SETUP().doc(def.id + '_' + companyId).get();
  return s.exists ? (s.data().Actions || {}) : {};
};

// The record held while its document is made (two runs never bill it twice).
async function claim(id, actionKey, user) {
  const ref = RECORDS().doc(id);
  return firestore.runTransaction(async t => {
    const s = await t.get(ref);
    const c = s.exists ? s.data().Claim : null;
    if (c && Date.now() - Date.parse(c.At) < CLAIM_MS) return false;
    t.update(ref, { Claim: { Action: actionKey, At: new Date().toISOString(), By: by(user) } });
    return true;
  });
}
// Release, with what was made: Created and History added, the next-due moved on.
async function release(rec, user, entry, nextDue) {
  const ref = RECORDS().doc(rec.RecordID);
  await firestore.runTransaction(async t => {
    const s = await t.get(ref);
    if (!s.exists) return;
    const r = s.data();
    const upd = { Claim: null };
    if (entry) {
      upd.Created = (r.Created || []).concat([entry]).slice(-200);
      upd.History = (r.History || []).concat([{ At: entry.At, By: entry.By, What: entry.What }]);
      upd.UpdatedAt = entry.At;
    }
    if (nextDue) upd['Fields.' + nextDue.key] = nextDue.value;
    t.update(ref, upd);
  });
}

async function actionFor(user, d, capability) {
  const BM = require('./builtModules');
  const def = await BM.moduleFor(user, d.moduleId, capability || 'write');
  const a = (def.actions || []).find(x => x.key === text(d.action, 31));
  if (!a) bad(def.label + ' has no action "' + text(d.action, 31) + '".');
  return { def, a };
}
async function requireTarget(user, a) {
  const label = B.TARGETS[a.target];
  for (const cap of ['access', 'draft'].concat(a.state === 'Submitted' ? ['post'] : [])) {
    if (!(await moduleHasCapability(a.target, cap, user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to ' + (cap === 'post' ? 'post' : 'create') + ' a ' + label + ' (' + cap + ').');
  }
}
const companyOf = (user, companyId) => {
  const id = text(companyId, 80);
  if (!id) bad('Choose the company.');
  if (!userCanAccessCompany(user.profile, id)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return id;
};

// One group's document; the records released with what was made. Returns { made } or { refused }.
async function makeFor(request, user, def, a, recs, date, setup) {
  const held = [];
  for (const r of recs) {
    if (await claim(r.RecordID, a.key, user)) held.push(r);
    else return releaseAll(held, user).then(() => ({ refused: { records: recs.map(recNo), reason: recNo(r) + ' is being processed by another run.' } }));
  }
  const dueOf = r => (a.bulk.enabled ? (r.Fields || {})[a.bulk.nextDue] : '');
  let made;
  try {
    const ctx = Object.assign(await resolve(def, a, recs), { date, dueOf });
    made = await createTarget(request, a, buildTargetDraft(def, a, recs, setup, ctx), source(def, recs));
  } catch (e) {
    await releaseAll(recs, user);
    if (!(e instanceof HttpsError)) console.error('builtActions: not made', e);
    return { refused: { records: recs.map(recNo), reason: e.message || String(e) } };
  }
  // Made: recorded on each record. A failure here leaves the claim to expire (CLAIM_MS)
  // rather than freeing a record whose document exists; the document keeps its BuiltSource.
  const at = new Date().toISOString();
  for (const r of recs) {
    const due = dueOf(r);
    try {
      await release(r, user, { Action: a.key, Module: a.target, ID: made.id, Due: due || '', At: at, By: by(user),
        What: a.label + ': ' + B.TARGETS[a.target] + ' ' + (made.number || made.status) + (due ? ' (due ' + due + ')' : '') },
      due ? { key: a.bulk.nextDue, value: addMonths(due, monthsOf(a, r)) } : null);
    } catch (e) { console.error('builtActions: ' + made.module + ' ' + made.id + ' made but not recorded on ' + r.RecordID, e); made.note = (made.note ? made.note + ' ' : '') + 'Not recorded on ' + recNo(r) + ': check it before running again.'; }
  }
  return { made: Object.assign(made, { records: recs.map(recNo) }) };
}
const releaseAll = async (recs, user) => { for (const r of recs) await release(r, user, null, null); };

// ---------- the callables ----------

// One record's action (a bulk action: that record's due period now).
exports.runBuiltAction = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const { def, a } = await actionFor(user, d);
  await requireTarget(user, a);
  const BM = require('./builtModules');
  const rec = await BM.loadRecord(user, def, d.id);
  const why = notRunnable(def, a, rec);
  if (why) failed(a.label + ': ' + recNo(rec) + ' — ' + why + '.');
  const date = today();
  if (a.bulk.enabled) {
    const due = dueOn(a, rec, '9999-12-31');
    if (due.why) failed(a.label + ': ' + recNo(rec) + ' — ' + due.why + '.');
  } else {
    const done = await liveCreatedFor(rec, a.key);
    if (done) failed(a.label + ' was already done: ' + B.TARGETS[done.module] + ' ' + (done.number || '(' + done.status + ')') + '. Delete or reverse it first to make it again.');
  }
  const r = await makeFor(request, user, def, a, [rec], date, (await setupOf(def, rec.CompanyID))[a.key]);
  if (r.refused) failed(r.refused.reason);
  return { success: true, made: r.made };
});

// A bulk run's proposal: the records due on `date` (Q475), each ticked on the screen.
exports.previewBuiltRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const { def, a } = await actionFor(user, d, 'access');
  if (!a.bulk.enabled) bad(a.label + ' is not a run.');
  const companyId = companyOf(user, d.companyId);
  const date = isDate(d.date) ? d.date : today();
  const amountKey = a.kind === 'item' ? '' : a.amount;
  const rows = (await RECORDS().where('ModuleID', '==', def.id).get()).docs.map(x => Object.assign({ RecordID: x.id }, x.data()))
    .filter(r => (r.CompanyID || '') === companyId && !notRunnable(def, a, r))
    .map(r => ({ r, due: dueOn(a, r, date) })).filter(x => !x.due.why)
    .map(({ r, due }) => ({ id: r.RecordID, number: recNo(r), name: r.Name || '', party: a.party ? valueText((r.Fields || {})[a.party]) : '', due: due.due,
      period: a.bulk.period || (r.Fields || {})[a.bulk.periodField] || '', amount: a.source === 'lines' ? Number((r.Totals || {})[amountKey]) || 0 : Number((r.Fields || {})[amountKey]) || 0 }))
    .sort((x, y) => String(x.due + x.number).localeCompare(String(y.due + y.number), undefined, { numeric: true }));
  return { date, records: rows.slice(0, MAX_RUN), more: rows.length > MAX_RUN, group: a.bulk.group };
});

// The run: the chosen records still due, grouped, each group's document made; kept as a run.
exports.runBuiltBulk = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const { def, a } = await actionFor(user, d);
  if (!a.bulk.enabled) bad(a.label + ' is not a run.');
  await requireTarget(user, a);
  const companyId = companyOf(user, d.companyId);
  const date = isDate(d.date) ? d.date : today();
  const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map(x => text(x, 80)).filter(Boolean))];
  if (!ids.length) bad('Tick the records to run.');
  if (ids.length > MAX_RUN) bad('At most ' + MAX_RUN + ' records a run.');
  const refused = [], made = [], recs = [];
  for (const id of ids) {
    const s = await RECORDS().doc(id).get();
    const r = s.exists ? Object.assign({ RecordID: s.id }, s.data()) : null;
    if (!r || r.ModuleID !== def.id || (r.CompanyID || '') !== companyId) { refused.push({ records: [id], reason: 'not found in this company' }); continue; }
    const why = notRunnable(def, a, r) || dueOn(a, r, date).why;
    if (why) refused.push({ records: [recNo(r)], reason: why });
    else recs.push(r);
  }
  const setup = (await setupOf(def, companyId))[a.key];
  for (const g of groupsOf(a, recs)) {
    const r = await makeFor(request, user, def, a, g, date, setup);
    if (r.made) made.push(r.made); else refused.push(r.refused);
  }
  const run = { ModuleID: def.id, Action: a.key, ActionLabel: a.label, CompanyID: companyId, Date: date, At: new Date().toISOString(), By: by(user), Made: made, Refused: refused };
  const ref = await RUNS().add(run);
  return { success: true, runId: ref.id, made, refused };
});

// The module's last runs (newest first).
exports.getBuiltRuns = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const BM = require('./builtModules');
  const def = await BM.moduleFor(user, d.moduleId, 'access');
  const runs = (await RUNS().where('ModuleID', '==', def.id).get()).docs.map(x => Object.assign({ RunID: x.id }, x.data()))
    .filter(r => userCanAccessCompany(user.profile, r.CompanyID))
    .sort((x, y) => String(y.At).localeCompare(String(x.At))).slice(0, 30);
  return { runs };
});

// What the company's Setup needs, and what it has; the choices for it.
exports.getBuiltSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const BM = require('./builtModules');
  const def = await BM.moduleFor(user, d.moduleId, 'access');
  const companyId = companyOf(user, d.companyId);
  const [coa, units, salesTypes] = await Promise.all(['coa', 'orgUnits', 'salesTypes'].map(p => rtdb.ref(p).get().then(s => s.val() || {})));
  const ofCo = r => r && (!r.CompanyID || r.CompanyID === companyId);
  const unitsOf = type => Object.entries(units).filter(([, u]) => u && u.Type === type && u.Status !== 'Inactive' && ofCo(u)).map(([id, u]) => ({ id, label: [u.Code, u.Name].filter(Boolean).join(' · ') }))
    .sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }));
  return {
    setup: await setupOf(def, companyId),
    needs: (def.actions || []).map(a => ({ key: a.key, label: a.label, target: a.target, fields: needsOf(a) })),
    options: {
      accounts: Object.values(coa).filter(x => x && x.IsPostable === true && x.Status === 'Active' && ofCo(x)).map(x => ({ id: x.AccountCode, label: x.AccountCode + ' · ' + (x.AccountName || '') }))
        .sort((x, y) => String(x.id).localeCompare(String(y.id), undefined, { numeric: true })),
      salesTypes: Object.entries(salesTypes).filter(([, s]) => s && s.Status === 'Active').map(([id, s]) => ({ id, label: s.Name || id })),
      costCenters: unitsOf('CostCenter'), profitCenters: unitsOf('ProfitCenter'), projects: unitsOf('Project'), warehouses: unitsOf('Warehouse')
    },
    canEdit: await canEditSetup(user, def)
  };
});
// The Setup keys an action takes from the company (what no field of the record gives).
function needsOf(a) {
  const out = [];
  if (a.target === 'CUSTOMERINVOICE') out.push('SalesTypeID');
  if (a.kind === 'item') { if (!a.warehouse) out.push('WarehouseID'); } else if (a.target === 'JV') {
    if (a.partySide !== 'debit' && !a.debitAccount) out.push('DebitAccountCode');
    if (a.partySide !== 'credit' && !a.creditAccount) out.push('CreditAccountCode');
  } else if (!a.account) out.push('AccountCode');
  return out.concat(['CostCenterID', 'ProfitCenterID', 'ProjectID']);
}
// The books' settings are set by someone who changes the module and may post its documents.
async function canEditSetup(user, def) {
  if (!(await moduleHasCapability(def.id, 'write', user.profile.role))) return false;
  for (const t of [...new Set((def.actions || []).map(a => a.target))]) if (!(await moduleHasCapability(t, 'post', user.profile.role))) return false;
  return true;
}

exports.saveBuiltSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const BM = require('./builtModules');
  const def = await BM.moduleFor(user, d.moduleId, 'write');
  if (!(await canEditSetup(user, def))) throw new HttpsError('permission-denied', 'Setting the books for ' + def.label + ' needs the right to change it and to post its documents.');
  const companyId = companyOf(user, d.companyId);
  const [coa, units, salesTypes] = await Promise.all(['coa', 'orgUnits', 'salesTypes'].map(p => rtdb.ref(p).get().then(s => s.val() || {})));
  const ofCo = r => r && (!r.CompanyID || r.CompanyID === companyId);
  const given = d.actions && typeof d.actions === 'object' ? d.actions : {};
  const out = {};
  (def.actions || []).forEach(a => {
    const x = given[a.key] || {};
    const o = {};
    needsOf(a).forEach(k => {
      const v = text(x[k], 80);
      if (!v) return;
      const at = a.label + ': ';
      if (/AccountCode$/.test(k)) { if (!Object.values(coa).some(c => c && c.AccountCode === v && c.IsPostable === true && c.Status === 'Active' && ofCo(c))) bad(at + 'account ' + v + ' is not a postable account of the company.'); }
      else if (k === 'SalesTypeID') { if (!salesTypes[v] || salesTypes[v].Status !== 'Active') bad(at + 'choose an active sales type.'); }
      else {
        const type = { CostCenterID: 'CostCenter', ProfitCenterID: 'ProfitCenter', ProjectID: 'Project', WarehouseID: 'Warehouse' }[k];
        if (!units[v] || units[v].Type !== type || !ofCo(units[v])) bad(at + 'choose one of the company\'s ' + type.replace(/([a-z])([A-Z])/, '$1 $2').toLowerCase() + 's.');
      }
      o[k] = v;
    });
    out[a.key] = o;
  });
  await SETUP().doc(def.id + '_' + companyId).set({ ModuleID: def.id, CompanyID: companyId, Actions: out, UpdatedAt: new Date().toISOString(), UpdatedBy: by(user) });
  return { success: true };
});

module.exports = Object.assign(exports, { addMonths, render, buildTargetDraft, groupsOf, notRunnable, dueOn, monthsOf, needsOf, liveDoc, createdOf, liveCreatedFor, SETUP_KEYS });
