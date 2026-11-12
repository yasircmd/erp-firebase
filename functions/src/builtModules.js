// Module Builder, phase 1 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q461-Q469): the one runtime every built module runs on. New development,
// hand-written.
//
// A built module's records are its corporate's own:
//   Firestore builtRecords/{auto}  { ModuleID, Version, CompanyID, Code, Name,
//     Active (masters) | Number, Date, Status, PendingStatus, ApprovalInstanceID,
//     ApprovalRejected, RejectionReason (documents), Fields: { key: value },
//     Lines: [ { key: value } ], Totals: { key: sum }, History: [...],
//     CreatedAt, CreatedBy, UpdatedAt, UpdatedBy }
//   Firestore builtCounters/{X_ID}_{yyyy}  { Next }   (a document's number)
// A link's value is { id, label } (the label as it was when chosen). It
// never posts to the books (Q462): that comes in phase 3, through the
// existing documents. Rights: the module's access and write; "void" moves a
// document to a final status; approvals through Approval Configuration.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const B = require('./builtDefinitions');
const C = require('./builtCalc');

const onCallOptions = { region: 'us-central1' };
const RECORDS = () => firestore.collection('builtRecords');
const COUNTERS = () => firestore.collection('builtCounters');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v));
const isDateTime = v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v || ''));
const num = v => Number(String(v == null ? '' : v).replace(/,/g, ''));
const by = user => user.profile.username || user.uid;
const MAX_LINES = 500;

// ---------- pure: a record's values, checked by its definition ----------

// One value of a field; ctx.links: { target: Map(id -> label) } of what may be chosen.
function cleanValue(f, v, ctx, at) {
  if (f.type === 'calc') return 0; // worked out on the server (builtCalc.apply), never taken from the screen
  const empty = v == null || (typeof v === 'string' && !v.trim()) || (typeof v === 'object' && !Array.isArray(v) && !v.id);
  if (empty) {
    if (f.required && f.type !== 'yesno') bad(at + f.label + ' is required.');
    return f.type === 'yesno' ? false : null;
  }
  switch (f.type) {
    case 'text': return text(v, 200);
    case 'longtext': return text(v, 4000);
    case 'number': case 'amount': {
      const n = num(v);
      if (!Number.isFinite(n)) bad(at + f.label + ' must be a number.');
      return f.type === 'amount' ? round2(n) : n;
    }
    case 'date': if (!isDate(v)) bad(at + f.label + ': choose a date.'); return String(v);
    case 'datetime': if (!isDateTime(v)) bad(at + f.label + ': choose a date and time.'); return String(v);
    case 'yesno': return v === true || v === 'true' || v === 'Yes';
    case 'choice': if (!f.options.includes(String(v))) bad(at + f.label + ': choose one of its options.'); return String(v);
    case 'link': {
      const id = text(typeof v === 'object' ? v.id : v, 120);
      const known = ctx.links[f.target];
      if (!known || !known.has(id)) bad(at + f.label + ': choose one from the list.');
      return { id, label: known.get(id) };
    }
    default: bad(at + f.label + ': unknown type.');
  }
  return null;
}

function cleanFields(fields, values, ctx, at) {
  const out = {};
  const v = values && typeof values === 'object' ? values : {};
  fields.forEach(f => { out[f.key] = cleanValue(f, v[f.key], ctx, at || ''); });
  return out;
}

// Lines and their totals: each number or amount line field summed.
function cleanLines(def, lines, ctx) {
  if (!def.lines || !def.lines.enabled) return { lines: [], totals: {} };
  const list = Array.isArray(lines) ? lines : [];
  if (list.length > MAX_LINES) bad('At most ' + MAX_LINES + ' lines.');
  // A line left wholly blank is dropped (the grid's empty rows).
  const filled = list.filter(l => l && def.lines.fields.some(f => { const x = l[f.key]; return x != null && x !== '' && x !== false && !(typeof x === 'object' && !x.id); }));
  const out = filled.map((l, i) => cleanFields(def.lines.fields, l, ctx, 'Line ' + (i + 1) + ': '));
  return { lines: out, totals: C.totalsOf(def, out) };
}

// Which statuses a document in `status` may move to: any other, unless it is final.
function nextStatuses(def, status) {
  const s = (def.statuses || []).find(x => x.name === status);
  if (!s || s.final) return [];
  return def.statuses.filter(x => x.name !== status).map(x => x.name);
}

// The document's amount for Approval Configuration's thresholds: its first amount total, else its first amount field.
function amountOf(def, rec) {
  const lineAmt = ((def.lines || {}).fields || []).find(C.isMoney);
  if (lineAmt) return Number((rec.Totals || {})[lineAmt.key]) || 0;
  const head = def.fields.find(C.isMoney);
  return head ? Number((rec.Fields || {})[head.key]) || 0 : 0;
}

// ---------- pure: schedules (phase 2, Q470-Q473) ----------

const addDay = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// The state a status shows while holding the resource, or null.
const holdingState = (def, status) => ((def.schedule || {}).enabled ? ((def.schedule.holds.find(h => h.status === status) || {}).state || null) : null);
// The days a document holds: [start, end) with end the day it is free again.
function periodOf(def, rec) {
  const sc = def.schedule, f = rec.Fields || {};
  const start = f[sc.startField], end = f[sc.endField];
  if (!start || !end) return null;
  return { start, end: sc.endIsFree ? end : addDay(end, 1) };
}
// The resources (built master records) a document names.
function resourcesOf(def, rec) {
  const sc = def.schedule, k = sc.resourceField;
  const ids = sc.resourceInLines ? (rec.Lines || []).map(l => l[k] && l[k].id) : [((rec.Fields || {})[k] || {}).id];
  return [...new Set(ids.filter(Boolean))];
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
// A document's dates, checked when it holds: its end after its start.
function checkPeriod(def, rec) {
  const p = periodOf(def, rec);
  const lab = k => (def.fields.find(f => f.key === k) || {}).label || k;
  if (!p) bad('A ' + def.label + ' that holds its ' + resourceLabel(def) + ' needs its ' + lab(def.schedule.startField) + ' and ' + lab(def.schedule.endField) + '.');
  if (!(p.start < p.end)) bad(lab(def.schedule.endField) + ' must be ' + (def.schedule.endIsFree ? 'after' : 'on or after') + ' ' + lab(def.schedule.startField) + '.');
  return p;
}
function resourceLabel(def) {
  const k = def.schedule.resourceField;
  return (def.fields.concat(def.lines.fields || []).find(f => f.key === k) || {}).label || 'resource';
}

// ---------- the module, its rights, its links ----------

async function moduleFor(user, moduleId, capability) {
  const id = text(moduleId, 33).toUpperCase();
  const def = B.ID.test(id) ? await B.publishedDef(id, true) : null; // the current version, always
  if (!def) throw new HttpsError('not-found', 'Unknown module: ' + id);
  if (!(await moduleHasCapability(id, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to ' + def.label + '.');
  if (capability && capability !== 'access' && !(await moduleHasCapability(id, capability, user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have the right to ' + (capability === 'void' ? 'move ' + def.label + ' to a final status' : 'change ' + def.label) + ' (' + capability + ').');
  }
  return def;
}

const linkFields = def => def.fields.concat((def.lines || {}).fields || []).filter(f => f.type === 'link');

// What a link to `target` may choose, for a company: Map(id -> label).
async function linkOptions(target, companyId, user) {
  const pick = (all, code, name, active) => {
    const m = new Map();
    Object.keys(all || {}).forEach(id => {
      const r = all[id];
      if (!r || (active && r.Status && r.Status !== 'Active')) return;
      if (r.CompanyID && companyId && r.CompanyID !== companyId) return;
      m.set(id, [r[code], r[name]].filter(Boolean).join(' · ') || id);
    });
    return m;
  };
  if (target === 'CUSTOMER') return pick((await rtdb.ref('customers').get()).val(), 'CustomerCode', 'CustomerName', true);
  if (target === 'VENDOR') return pick((await rtdb.ref('vendors').get()).val(), 'VendorCode', 'VendorName', true);
  if (target === 'ITEM') return pick((await rtdb.ref('items').get()).val(), 'ItemCode', 'ItemName', true);
  if (target === 'ACCOUNT') {
    const m = new Map();
    Object.entries((await rtdb.ref('coa').get()).val() || {}).forEach(([id, a]) => {
      if (a && a.IsPostable === true && a.Status === 'Active' && (!a.CompanyID || !companyId || a.CompanyID === companyId)) m.set(id, [a.AccountCode, a.AccountName].filter(Boolean).join(' · ') || id);
    });
    return m;
  }
  if (target === 'WAREHOUSE') {
    const m = new Map();
    Object.entries((await rtdb.ref('orgUnits').get()).val() || {}).forEach(([id, u]) => {
      if (u && u.Type === 'Warehouse' && u.Status !== 'Inactive' && (!u.CompanyID || !companyId || u.CompanyID === companyId)) m.set(id, [u.Code, u.Name].filter(Boolean).join(' · ') || id);
    });
    return m;
  }
  if (target === 'PROJECT') {
    // Phase 6: the ERP's projects (orgUnits, Type Project), open ones (not Closed or Inactive).
    const m = new Map();
    Object.entries((await rtdb.ref('orgUnits').get()).val() || {}).forEach(([id, u]) => {
      if (u && u.Type === 'Project' && u.Status !== 'Inactive' && u.Status !== 'Closed' && (!u.CompanyID || !companyId || u.CompanyID === companyId)) m.set(id, [u.Code, u.Name].filter(Boolean).join(' · ') || id);
    });
    return m;
  }
  if (target === 'COMPANY') {
    const m = pick((await rtdb.ref('companies').get()).val(), 'CompanyRefCode', 'LegalName', true);
    [...m.keys()].forEach(id => { if (!userCanAccessCompany(user.profile, id)) m.delete(id); });
    return m;
  }
  if (target === 'EMPLOYEE') {
    const q = companyId ? firestore.collection('employees').where('CompanyID', '==', companyId) : firestore.collection('employees');
    const m = new Map();
    (await q.get()).docs.forEach(d => { const e = d.data(); if (e.Status !== 'Left' && e.Status !== 'Inactive') m.set(d.id, [e.EmployeeNo, e.FullName].filter(Boolean).join(' · ') || d.id); });
    return m;
  }
  if (B.ID.test(target)) {
    const m = new Map();
    (await RECORDS().where('ModuleID', '==', target).get()).docs.forEach(d => {
      const r = d.data();
      if (r.Active === false || (r.CompanyID && companyId && r.CompanyID !== companyId)) return;
      m.set(d.id, [r.Code, r.Name].filter(Boolean).join(' · ') || d.id);
    });
    return m;
  }
  return new Map();
}
async function linksFor(def, companyId, user) {
  const out = {};
  for (const t of [...new Set(linkFields(def).map(f => f.target))]) out[t] = await linkOptions(t, companyId, user);
  return out;
}

// Every published document module scheduling `target`, i.e. booking its records.
async function schedulersOf(target) {
  return (await B.refresh(true)).filter(d => d.kind === 'document' && d.schedule && d.schedule.enabled && d.schedule.target === target);
}
// The first document (of any module scheduling the same master) holding one of
// rec's resources over overlapping days, or null (Q472). rec: as it will be saved.
async function findClash(def, rec, status) {
  if (!holdingState(def, status)) return null;
  const mine = checkPeriod(def, rec);
  const res = resourcesOf(def, rec);
  if (!res.length) return null;
  for (const other of await schedulersOf(def.schedule.target)) {
    const docs = (await RECORDS().where('ModuleID', '==', other.id).get()).docs;
    for (const d of docs) {
      if (d.id === rec.RecordID) continue;
      const o = d.data();
      if ((o.CompanyID || '') !== (rec.CompanyID || '') || !holdingState(other, o.Status)) continue;
      const p = periodOf(other, o);
      if (!p || !overlaps(mine, p)) continue;
      const shared = resourcesOf(other, o).find(id => res.includes(id));
      if (shared) return { number: o.Number, resource: shared, start: o.Fields[other.schedule.startField], end: o.Fields[other.schedule.endField] };
    }
  }
  return null;
}
async function refuseClash(def, rec, status, ctx) {
  const c = await findClash(def, rec, status);
  if (!c) return;
  const label = ((ctx && ctx.links[def.schedule.target]) || new Map()).get(c.resource) || c.resource;
  throw new HttpsError('failed-precondition', label + ' is already held by ' + c.number + ' from ' + c.start + ' to ' + c.end + '.');
}
const lockedIfScheduled = (def, user, fn) => (def.schedule && def.schedule.enabled ? require('./lock').withGlobalLock(user.uid, fn) : fn());

async function loadRecord(user, def, id) {
  const s = await RECORDS().doc(text(id, 80) || '-').get();
  if (!s.exists || s.data().ModuleID !== def.id) throw new HttpsError('not-found', def.label + ': record not found.');
  const r = Object.assign({ RecordID: s.id }, s.data());
  if (r.CompanyID && !userCanAccessCompany(user.profile, r.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return r;
}

const activeCompanies = async user => Object.entries((await rtdb.ref('companies').get()).val() || {})
  .filter(([id, c]) => c && c.Status !== 'Inactive' && userCanAccessCompany(user.profile, id))
  .map(([id, c]) => ({ id, name: c.LegalName || id, code: c.CompanyRefCode || '' }))
  .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

// ---------- the callables ----------

// The module as its screen needs it: the definition, the user's rights, companies.
exports.getBuiltModule = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const def = await moduleFor(user, (request.data || {}).moduleId, 'access');
  return { definition: def, companies: def.companyScoped ? await activeCompanies(user) : [],
    rights: { write: await moduleHasCapability(def.id, 'write', user.profile.role), void: def.kind === 'document' && await moduleHasCapability(def.id, 'void', user.profile.role),
      // Phase 3: each target's rights, for the action buttons (the server checks again).
      targets: await targetRights(def, user) }, me: user.uid };
});

async function targetRights(def, user) {
  const out = {};
  for (const t of [...new Set((def.actions || []).map(a => a.target))]) {
    out[t] = { draft: (await moduleHasCapability(t, 'access', user.profile.role)) && (await moduleHasCapability(t, 'draft', user.profile.role)), post: await moduleHasCapability(t, 'post', user.profile.role) };
  }
  return out;
}

// A link field's choices: [{ id, label }], for the record's company.
exports.getBuiltLinkOptions = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'access');
  const target = text(d.target, 40);
  if (!linkFields(def).some(f => f.target === target)) bad('This module has no such link.');
  const companyId = def.companyScoped ? text(d.companyId, 80) : '';
  if (companyId && !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const m = await linkOptions(target, companyId, user);
  return { options: [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 2000) };
});

// The list: the module's records the user may see (an equality query), newest first.
exports.listBuiltRecords = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'access');
  let q = RECORDS().where('ModuleID', '==', def.id);
  if (d.status && def.kind === 'document') q = q.where('Status', '==', text(d.status, 30));
  const rows = (await q.get()).docs.map(x => Object.assign({ RecordID: x.id }, x.data()))
    .filter(r => !r.CompanyID || userCanAccessCompany(user.profile, r.CompanyID))
    .map(r => ({ RecordID: r.RecordID, CompanyID: r.CompanyID || '', Code: r.Code, Name: r.Name, Active: r.Active, Number: r.Number, Date: r.Date, Status: r.Status, PendingStatus: r.PendingStatus || '',
      Fields: def.listColumns.reduce((o, k) => { o[k] = (r.Fields || {})[k]; return o; }, {}), Totals: r.Totals || {}, UpdatedAt: r.UpdatedAt || '' }));
  rows.sort(def.kind === 'master' ? (a, b) => String(a.Code).localeCompare(String(b.Code), undefined, { numeric: true }) : (a, b) => String(b.Date + b.Number).localeCompare(String(a.Date + a.Number)));
  return { records: rows };
});

exports.getBuiltRecord = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'access');
  const r = await loadRecord(user, def, d.id);
  const out = { record: r, next: def.kind === 'document' && !r.PendingStatus ? nextStatuses(def, r.Status) : [] };
  // Phase 3: what its actions made, as those documents are now.
  if ((def.actions || []).length) out.created = await require('./builtActions').createdOf(r);
  // The approver's own level, when the record waits for them.
  if (r.PendingStatus && r.ApprovalInstanceID) {
    const inst = await require('./approvalStore').approvalInstances.get(r.ApprovalInstanceID);
    const decided = new Set(((inst && inst.Decisions) || []).map(x => x.LevelNumber));
    const mine = inst && inst.Status === 'Pending' ? (inst.RequiredLevels || []).find(l => l.ApproverUserID === user.uid && !decided.has(l.LevelNumber)) : null;
    out.approval = { status: inst ? inst.Status : '', myLevel: mine ? mine.LevelNumber : null, levels: (inst && inst.RequiredLevels || []).length, decided: decided.size };
  }
  return out;
});

// What a document's `previous` calcs add: its module's earlier documents with
// the same link (an equality query on each link; MODULE_BUILDER.md Q497).
async function previousFor(def, me) {
  const pc = C.previousCalcs(def);
  const all = pc.head.concat(pc.lines);
  if (!all.length) return null;
  const records = new Map();
  for (const by of [...new Set(all.map(f => f.by))]) {
    const linkId = C.matchValue((me.Fields || {})[by]);
    if (!linkId) continue;
    (await RECORDS().where('ModuleID', '==', def.id).where('Fields.' + by + '.id', '==', linkId).get()).docs
      .forEach(x => records.set(x.id, Object.assign({ RecordID: x.id }, x.data())));
  }
  return C.previousFrom(def, me, [...records.values()]);
}

// The document's next number, in a transaction: PREFIX-YY-000001.
async function nextNumber(def, date) {
  const year = String(date).slice(0, 4);
  const ref = COUNTERS().doc(def.id + '_' + year);
  const n = await firestore.runTransaction(async t => {
    const s = await t.get(ref);
    const next = (s.exists ? Number(s.data().Next) || 1 : 1);
    t.set(ref, { Next: next + 1 });
    return next;
  });
  return def.numbering.prefix + '-' + year.slice(2) + '-' + String(n).padStart(6, '0');
}

// Save a master, or a document while its status allows changes.
exports.saveBuiltRecord = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'write');
  const rec = d.record || {};
  const id = text(rec.RecordID, 80);
  const old = id ? await loadRecord(user, def, id) : null;
  const companyId = def.companyScoped ? (old ? old.CompanyID : text(rec.CompanyID, 80)) : '';
  if (def.companyScoped) {
    if (!companyId || !(await rtdb.ref('companies/' + companyId).get()).exists()) bad('Choose the company.');
    if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  }
  const ctx = { links: await linksFor(def, companyId, user) };
  const fields = cleanFields(def.fields, rec.Fields, ctx, '');
  const now = new Date().toISOString();
  const base = { ModuleID: def.id, Version: def.version || 1, CompanyID: companyId, Fields: fields, UpdatedAt: now, UpdatedBy: by(user) };

  if (def.kind === 'master') {
    const code = text(rec.Code, 40), name = text(rec.Name, 120);
    if (!code) bad('Give it a code.');
    if (!name) bad('Give it a name.');
    const clash = (await RECORDS().where('ModuleID', '==', def.id).where('Code', '==', code).get()).docs
      .some(x => x.id !== id && (x.data().CompanyID || '') === companyId);
    if (clash) bad('The code ' + code + ' is already used' + (companyId ? ' in this company.' : '.'));
    base.Fields = C.apply(def, fields, [], null).fields;
    const doc = Object.assign(base, { Code: code, Name: name, Active: old ? old.Active !== false : true });
    if (old) { await RECORDS().doc(id).set(doc, { merge: true }); return { success: true, id }; }
    const ref = await RECORDS().add(Object.assign(doc, { CreatedAt: now, CreatedBy: by(user) }));
    return { success: true, id: ref.id };
  }

  // A document.
  if (old) {
    const st = def.statuses.find(s => s.name === old.Status);
    if (old.PendingStatus) throw new HttpsError('failed-precondition', 'It is waiting for approval: it can\'t be changed now.');
    if (!st || !st.editable) throw new HttpsError('failed-precondition', 'A ' + def.label + ' that is ' + old.Status + ' can\'t be changed.');
  }
  const date = text(rec.Date, 10);
  if (!isDate(date)) bad('Choose the date.');
  const cleaned = cleanLines(def, rec.Lines, ctx);
  // Phase 6 (Q497): the calculated fields, with what earlier documents add.
  const prev = await previousFor(def, { RecordID: id, Date: date, CreatedAt: old ? old.CreatedAt : '', Fields: fields });
  const calc = C.apply(def, fields, cleaned.lines, prev);
  base.Fields = calc.fields;
  const lines = calc.lines, totals = calc.totals;
  const doc = Object.assign(base, { Date: date, Lines: lines, Totals: totals });
  if (old) {
    // A document holding its resource is checked again as changed (Q472).
    return lockedIfScheduled(def, user, async () => {
      await refuseClash(def, Object.assign({ RecordID: id }, doc), old.Status, ctx);
      await RECORDS().doc(id).set(doc, { merge: true });
      return { success: true, id, number: old.Number };
    });
  }
  await refuseClash(def, Object.assign({ RecordID: '' }, doc), def.statuses[0].name, ctx); // a first status that holds (unusual)
  const number = await nextNumber(def, date);
  const ref = await RECORDS().add(Object.assign(doc, { Number: number, Status: def.statuses[0].name, PendingStatus: '', History: [{ At: now, By: by(user), What: 'Created as ' + def.statuses[0].name }], CreatedAt: now, CreatedBy: by(user), CreatedByUid: user.uid }));
  return { success: true, id: ref.id, number };
});

// A master on or off (never deleted: documents may link to it).
exports.setBuiltActive = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'write');
  if (def.kind !== 'master') bad('Only a master is switched on or off.');
  const r = await loadRecord(user, def, d.id);
  await RECORDS().doc(r.RecordID).update({ Active: d.active === true, UpdatedAt: new Date().toISOString(), UpdatedBy: by(user) });
  return { success: true };
});

// A document to another status; into one that needs approval, through Approval Configuration.
exports.setBuiltStatus = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'write');
  if (def.kind !== 'document') bad('Only a document has statuses.');
  const r = await loadRecord(user, def, d.id);
  if (r.PendingStatus) throw new HttpsError('failed-precondition', 'It is already waiting for approval to become ' + r.PendingStatus + '.');
  const to = def.statuses.find(s => s.name === text(d.status, 30));
  if (!to || !nextStatuses(def, r.Status).includes(to.name)) throw new HttpsError('failed-precondition', 'A ' + def.label + ' that is ' + r.Status + ' can\'t become ' + text(d.status, 30) + '.');
  if (to.final && !(await moduleHasCapability(def.id, 'void', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to make a ' + def.label + ' ' + to.name + ' (void).');
  const now = new Date().toISOString();
  const history = (r.History || []).concat([]);
  if (holdingState(def, to.name)) {
    const ctx = { links: { [def.schedule.target]: await linkOptions(def.schedule.target, r.CompanyID, user) } };
    return lockedIfScheduled(def, user, async () => {
      await refuseClash(def, r, to.name, ctx);
      return moveStatus(user, def, r, to, d, now, history);
    });
  }
  return moveStatus(user, def, r, to, d, now, history);
});
async function moveStatus(user, def, r, to, d, now, history) {
  if (to.approval) {
    const { beginApprovalInstance, resolveApprovalScopeKeyForDocument } = require('./approvals');
    const scopeKey = await resolveApprovalScopeKeyForDocument(def.id, { CompanyID: r.CompanyID });
    const a = await beginApprovalInstance(def.id, r.RecordID, r.Number, scopeKey, amountOf(def, r), user.uid);
    if (a.required) {
      history.push({ At: now, By: by(user), What: 'Sent for approval to become ' + to.name });
      await RECORDS().doc(r.RecordID).update({ PendingStatus: to.name, ApprovalInstanceID: a.instanceId, ApprovalRejected: false, RejectionReason: '', History: history, UpdatedAt: now, UpdatedBy: by(user) });
      return { success: true, status: r.Status, pending: to.name };
    }
  }
  history.push({ At: now, By: by(user), What: r.Status + ' → ' + to.name + (text(d.reason, 300) ? ': ' + text(d.reason, 300) : '') });
  await RECORDS().doc(r.RecordID).update({ Status: to.name, History: history, UpdatedAt: now, UpdatedBy: by(user) });
  return { success: true, status: to.name };
}

// The approver decides (the approval engine checks the level is theirs).
exports.decideBuiltApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'access');
  const r = await loadRecord(user, def, d.id);
  if (!r.PendingStatus || !r.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'It is not waiting for approval.');
  // Approving it into a status that holds its resource: checked first (Q472), nothing recorded on a clash.
  if (d.decision === 'Approved' && holdingState(def, r.PendingStatus)) {
    const ctx = { links: { [def.schedule.target]: await linkOptions(def.schedule.target, r.CompanyID, user) } };
    await refuseClash(def, r, r.PendingStatus, ctx);
  }
  const result = await require('./approvals').recordApprovalDecision(user, r.ApprovalInstanceID, Number(d.levelNumber), d.decision, d.reason);
  const now = new Date().toISOString();
  const history = (r.History || []).concat([]);
  if (result.status === 'Approved') {
    history.push({ At: now, By: by(user), What: 'Approved: ' + r.Status + ' → ' + r.PendingStatus });
    await RECORDS().doc(r.RecordID).update({ Status: r.PendingStatus, PendingStatus: '', History: history, UpdatedAt: now });
  } else if (result.status === 'Rejected') {
    history.push({ At: now, By: by(user), What: 'Rejected (stays ' + r.Status + ')', Reason: text(d.reason, 500) });
    await RECORDS().doc(r.RecordID).update({ PendingStatus: '', ApprovalRejected: true, RejectionReason: text(d.reason, 500), History: history, UpdatedAt: now });
  } else {
    history.push({ At: now, By: by(user), What: 'Approved level ' + Number(d.levelNumber) });
    await RECORDS().doc(r.RecordID).update({ History: history, UpdatedAt: now });
  }
  return { success: true, status: result.status };
});

// ---------- the board and the calendar (phase 2, Q470-Q473) ----------

const companyFor = (def, user, companyId) => {
  const id = def.companyScoped ? text(companyId, 80) : '';
  if (def.companyScoped && !id) bad('Choose the company.');
  if (id && !userCanAccessCompany(user.profile, id)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return id;
};
// Every document holding the master's records over [from, to), as bars.
async function holdingsOf(target, companyId, from, to) {
  const out = [];
  for (const m of await schedulersOf(target)) {
    (await RECORDS().where('ModuleID', '==', m.id).get()).docs.forEach(d => {
      const o = d.data();
      const state = holdingState(m, o.Status);
      if (!state || (o.CompanyID || '') !== companyId) return;
      const p = periodOf(m, o);
      if (!p || !(p.start < to && from < p.end)) return;
      const first = (m.listColumns || [])[0];
      const fv = first ? (o.Fields || {})[first] : null;
      resourcesOf(m, o).forEach(rid => out.push({ resourceId: rid, recordId: d.id, moduleId: m.id, number: o.Number, state, start: p.start, end: p.end,
        title: fv && typeof fv === 'object' ? fv.label || '' : fv == null ? '' : String(fv) }));
    });
  }
  return out;
}

// A master's board: each record's state on the day (its hand-set field, else a document holding it, else Free).
exports.getBuiltBoard = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'access');
  if (def.kind !== 'master' || !def.board || !def.board.enabled) bad(def.label + ' has no board.');
  const companyId = companyFor(def, user, d.companyId);
  const day = isDate(d.date) ? d.date : new Date().toISOString().slice(0, 10);
  const recs = (await RECORDS().where('ModuleID', '==', def.id).get()).docs.map(x => Object.assign({ RecordID: x.id }, x.data()))
    .filter(r => r.Active !== false && (r.CompanyID || '') === companyId)
    .sort((a, b) => String(a.Code).localeCompare(String(b.Code), undefined, { numeric: true }));
  const held = await holdingsOf(def.id, companyId, day, addDay(day, 1));
  const states = [];
  const add = st => { if (st && !states.includes(st)) states.push(st); };
  (await schedulersOf(def.id)).forEach(m => m.schedule.holds.forEach(h => add(h.state)));
  const sf = def.board.stateField ? def.fields.find(f => f.key === def.board.stateField) : null;
  if (sf) sf.options.forEach(add);
  add('Free');
  const cards = recs.map(r => {
    const manual = sf ? (r.Fields || {})[sf.key] : null;
    const h = held.find(x => x.resourceId === r.RecordID);
    return { id: r.RecordID, code: r.Code, name: r.Name, state: manual || (h ? h.state : 'Free'), manual: manual || '',
      doc: h ? { id: h.recordId, moduleId: h.moduleId, number: h.number, title: h.title, start: h.start, end: h.end } : null };
  });
  return { date: day, states, cards, stateField: sf ? { key: sf.key, label: sf.label, options: sf.options } : null,
    canWrite: await moduleHasCapability(def.id, 'write', user.profile.role) };
});

// The hand-set state from a board's card (or cleared).
exports.setBuiltBoardState = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'write');
  const sf = def.board && def.board.enabled && def.board.stateField ? def.fields.find(f => f.key === def.board.stateField) : null;
  if (!sf) bad(def.label + ' has no state set by hand.');
  const r = await loadRecord(user, def, d.id);
  const v = text(d.value, 60);
  if (v && !sf.options.includes(v)) bad('Choose one of ' + sf.label + '\'s options.');
  await RECORDS().doc(r.RecordID).update({ ['Fields.' + sf.key]: v || null, UpdatedAt: new Date().toISOString(), UpdatedBy: by(user) });
  return { success: true };
});

// A document's calendar: the resource's records as rows, the documents holding them as bars, over `days` from `from`.
exports.getBuiltCalendar = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'access');
  if (def.kind !== 'document' || !def.schedule || !def.schedule.enabled) bad(def.label + ' has no calendar.');
  const companyId = companyFor(def, user, d.companyId);
  const from = isDate(d.from) ? d.from : new Date().toISOString().slice(0, 10);
  const days = Math.min(Math.max(Number(d.days) || 14, 1), 62);
  const to = addDay(from, days);
  const rows = [...(await linkOptions(def.schedule.target, companyId, user)).entries()].map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const bars = (await holdingsOf(def.schedule.target, companyId, from, to)).filter(b => rows.some(r => r.id === b.resourceId));
  const states = [...new Set((await schedulersOf(def.schedule.target)).flatMap(m => m.schedule.holds.map(h => h.state)))];
  return { from, days, rows, bars, states, resource: resourceLabel(def) };
});

// A document still in its first status may be deleted (its number is not reused).
exports.deleteBuiltRecord = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const def = await moduleFor(user, d.moduleId, 'write');
  if (def.kind !== 'document') bad('A master is switched off, not deleted.');
  const r = await loadRecord(user, def, d.id);
  if (r.Status !== def.statuses[0].name || r.PendingStatus) throw new HttpsError('failed-precondition', 'Only a ' + def.label + ' that is still ' + def.statuses[0].name + ' is deleted.');
  const made = (await require('./builtActions').createdOf(r)).find(c => c.live);
  if (made) throw new HttpsError('failed-precondition', 'It made ' + made.module + ' ' + (made.number || '(' + made.status + ')') + ': delete or reverse that first.');
  await RECORDS().doc(r.RecordID).delete();
  return { success: true };
});

module.exports = Object.assign(exports, { moduleFor, loadRecord, linkOptions, cleanValue, cleanFields, cleanLines, nextStatuses, amountOf, periodOf, resourcesOf, overlaps, holdingState, addDay });
