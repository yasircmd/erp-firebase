// Module Builder, phase 1 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q461-Q469): what a built module is, checked, and how it joins the module
// registry. New development, hand-written.
//
// A definition is the firm's (Q461), kept in the firm's own Firestore like the
// screens release:
//   moduleDefinitions/{X_ID}  { Draft: def, Published: def | null, Version,
//                               PublishedAt, PublishedBy, UpdatedAt, UpdatedBy }
//   moduleDefinitions/{X_ID}/versions/{n}  { def, PublishedAt, PublishedBy }
// A published version is for every corporate at once (Q467). Each corporate's
// records are its own (builtModules.js).
//
// The registry: the code's MODULE_REGISTRY plus every published definition,
// so Roles & Permissions, Tree Management, entitlements, Approval
// Configuration and Home treat a built module as any other. The published
// definitions are the firm's, the same for every corporate, so this instance
// keeps them (like getModuleFragment's screens release) and looks again at
// most every REFRESH_MS; callable.js asks before each call.
'use strict';

const ID = /^X_[A-Z][A-Z0-9_]{1,30}$/;
const KEY = /^[a-z][a-zA-Z0-9]{0,30}$/;
// Phase 1's field types (Q465) and links (Q469).
const TYPES = Object.freeze(['text', 'longtext', 'number', 'amount', 'date', 'datetime', 'yesno', 'choice', 'link']);
const LINE_TYPES = Object.freeze(['text', 'number', 'amount', 'date', 'yesno', 'choice', 'link']);
const LINK_TARGETS = Object.freeze({ CUSTOMER: 'Customer', VENDOR: 'Vendor', ITEM: 'Item', EMPLOYEE: 'Employee', COMPANY: 'Company' });
// Fields every record has: never a definition's own key.
const RESERVED = Object.freeze(['id', 'code', 'name', 'number', 'date', 'status', 'companyId', 'lines', 'totals', 'active']);
const MAX_FIELDS = 60;
const MAX_LINE_FIELDS = 20;
const MAX_STATUSES = 12;
const REFRESH_MS = 30000;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
function bad(msg) { const e = new Error(msg); e.code = 'invalid-argument'; throw e; }

// One field, checked; at is "Field 3" or "Line field 2" for the message;
// masters: the published masters' ids a link may name (besides LINK_TARGETS).
function cleanField(f, at, types, masters, selfId) {
  if (!f || typeof f !== 'object') bad(at + ': not a field.');
  const key = text(f.key, 31);
  if (!KEY.test(key)) bad(at + ': its key starts with a small letter, then letters or digits (for example roomType).');
  if (RESERVED.includes(key)) bad(at + ': "' + key + '" is kept for the ERP; choose another key.');
  const label = text(f.label, 60);
  if (!label) bad(at + ': give it a label.');
  const type = text(f.type, 12);
  if (!types.includes(type)) bad(at + ': choose its type.');
  const out = { key, label, type, required: f.required === true };
  if (type === 'choice') {
    const options = [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(/\r?\n|,/)).map(o => text(o, 60)).filter(Boolean))];
    if (!options.length) bad(at + ': a choice list needs its options.');
    if (options.length > 100) bad(at + ': at most 100 options.');
    out.options = options;
  }
  if (type === 'link') {
    const target = text(f.target, 40);
    if (!LINK_TARGETS[target] && !(ID.test(target) && (masters.includes(target) || target === selfId))) bad(at + ': choose what it links to (a customer, vendor, item, employee, company, or a built master).');
    out.target = target;
  }
  if (f.default != null && f.default !== '' && type !== 'link') out.default = type === 'yesno' ? f.default === true : text(f.default, 200);
  return out;
}

function uniqueKeys(fields, what) {
  const seen = new Set();
  fields.forEach(f => { if (seen.has(f.key)) bad(what + ': the key "' + f.key + '" is used twice.'); seen.add(f.key); });
}

// A definition, checked and cleaned. masters: the published masters' ids
// (for link fields; a definition may also link to itself, e.g. a parent).
function cleanDefinition(d, masters) {
  const x = d || {};
  const id = text(x.id, 33).toUpperCase();
  if (!ID.test(id)) bad('Its id starts with X_, then capital letters, digits or _ (for example X_ROOM).');
  const label = text(x.label, 60);
  if (!label) bad('Give the module a name.');
  const kind = x.kind === 'master' ? 'master' : x.kind === 'document' ? 'document' : bad('Choose a master (records like rooms) or a document (like a booking).');
  const known = Array.isArray(masters) ? masters : [];
  const fields = (Array.isArray(x.fields) ? x.fields : []).map((f, i) => cleanField(f, 'Field ' + (i + 1), TYPES, known, id));
  if (fields.length > MAX_FIELDS) bad('At most ' + MAX_FIELDS + ' fields.');
  uniqueKeys(fields, 'Fields');
  const out = { id, label, kind, companyScoped: x.companyScoped !== false, description: text(x.description, 300), fields };
  // One line table (Q466), documents only.
  const l = x.lines || {};
  if (kind === 'document' && l.enabled === true) {
    const lf = (Array.isArray(l.fields) ? l.fields : []).map((f, i) => cleanField(f, 'Line field ' + (i + 1), LINE_TYPES, known, id));
    if (!lf.length) bad('The lines need at least one field.');
    if (lf.length > MAX_LINE_FIELDS) bad('At most ' + MAX_LINE_FIELDS + ' line fields.');
    uniqueKeys(lf, 'Line fields');
    out.lines = { enabled: true, label: text(l.label, 40) || 'Lines', fields: lf };
  } else {
    out.lines = { enabled: false, label: '', fields: [] };
  }
  if (kind === 'document') {
    const prefix = text((x.numbering || {}).prefix, 6).toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(prefix)) bad('Give its numbering a prefix of 1 to 6 capital letters (for example BK).');
    out.numbering = { prefix };
    const raw = Array.isArray(x.statuses) && x.statuses.length ? x.statuses : [{ name: 'Draft' }, { name: 'Confirmed' }, { name: 'Cancelled', final: true }];
    const statuses = raw.map((s, i) => {
      const name = text(s && s.name, 30);
      if (!/^[A-Za-z][A-Za-z0-9 ]{0,29}$/.test(name)) bad('Status ' + (i + 1) + ': a name of letters, digits and spaces.');
      return { name, final: s.final === true, approval: i > 0 && s.approval === true, editable: i === 0 || s.editable === true };
    });
    if (statuses.length < 2) bad('A document needs at least two statuses (for example Draft and Confirmed).');
    if (statuses.length > MAX_STATUSES) bad('At most ' + MAX_STATUSES + ' statuses.');
    if (new Set(statuses.map(s => s.name.toLowerCase())).size !== statuses.length) bad('Two statuses have the same name.');
    if (statuses[0].final) bad('The first status (where a document starts) can\'t be final.');
    out.statuses = statuses;
  }
  // Phase 2 (Q470-Q473): a document's schedule, a master's board.
  out.schedule = cleanSchedule(x.schedule, out);
  out.board = cleanBoard(x.board, out);
  const keys = fields.map(f => f.key);
  const columns = (Array.isArray(x.listColumns) ? x.listColumns : []).map(c => text(c, 31)).filter(c => keys.includes(c));
  out.listColumns = [...new Set(columns)].slice(0, 6);
  out.printTitle = text(x.printTitle, 60) || label;
  return out;
}

// A document's schedule (phase 2, Q471-Q472): its resource (a link to a built
// master, in the header or the lines), its start and end date fields, whether
// the end is the day it is free again (a hotel's departure) or the last day
// used (a rental), and the statuses that hold the resource with the state each
// shows on the board.
function cleanSchedule(sc, def) {
  const x = sc || {};
  if (def.kind !== 'document' || x.enabled !== true) return { enabled: false };
  const rf = text(x.resourceField, 31);
  const head = def.fields.find(f => f.key === rf);
  const line = (def.lines.fields || []).find(f => f.key === rf);
  const res = head || line;
  if (!res || res.type !== 'link' || !ID.test(res.target)) bad('Schedule: its resource is a link field to a built master (for example the Room).');
  const date = k => { const f = def.fields.find(y => y.key === k); return f && f.type === 'date' ? f.key : null; };
  const startField = date(text(x.startField, 31)), endField = date(text(x.endField, 31));
  if (!startField || !endField) bad('Schedule: choose its start and end date fields (header date fields).');
  if (startField === endField) bad('Schedule: the start and the end are two different date fields.');
  const holds = (Array.isArray(x.holds) ? x.holds : []).map(h => ({ status: text(h && h.status, 30), state: text(h && h.state, 20) }))
    .filter(h => h.status);
  if (!holds.length) bad('Schedule: choose at least one status that holds the resource (for example Confirmed).');
  holds.forEach(h => {
    const st = def.statuses.find(y => y.name === h.status);
    if (!st) bad('Schedule: "' + h.status + '" is not one of its statuses.');
    if (!/^[A-Za-z][A-Za-z0-9 ]{0,19}$/.test(h.state)) bad('Schedule: give "' + h.status + '" the state it shows (for example Booked).');
  });
  if (new Set(holds.map(h => h.status)).size !== holds.length) bad('Schedule: a status is listed twice.');
  return { enabled: true, resourceField: rf, resourceInLines: Boolean(line && !head), target: res.target, startField, endField, endIsFree: x.endIsFree !== false, holds };
}

// A master's board (phase 2, Q470): optionally a choice field set by hand that wins over the documents.
function cleanBoard(bd, def) {
  const x = bd || {};
  if (def.kind !== 'master' || x.enabled !== true) return { enabled: false };
  const k = text(x.stateField, 31);
  if (k) {
    const f = def.fields.find(y => y.key === k);
    if (!f || f.type !== 'choice') bad('Board: the state set by hand is a choice field (for example Cleaning, Out of order).');
  }
  return { enabled: true, stateField: k || '' };
}

// What the registry, Roles and Approval Configuration need of a published definition.
const capabilitiesOf = def => (def.kind === 'document' ? ['access', 'write', 'void'] : ['access', 'write']);
const needsApproval = def => def.kind === 'document' && (def.statuses || []).some(s => s.approval);

// The registry, extended in place with the published definitions (pure; the
// arrays and the defaults object are the code's own, so every module that
// required them sees the built modules).
function applyToRegistry(defs, registry, defaults, gateable, storage) {
  for (let i = registry.length - 1; i >= 0; i--) if (registry[i].built) registry.splice(i, 1);
  for (let i = gateable.length - 1; i >= 0; i--) if (gateable[i].built) gateable.splice(i, 1);
  Object.keys(storage).filter(k => ID.test(k)).forEach(k => { delete storage[k]; });
  Object.keys(defaults).filter(k => ID.test(k)).forEach(k => { delete defaults[k]; });
  defs.forEach(def => {
    if (!def || !ID.test(def.id) || registry.some(m => m.id === def.id)) return;
    registry.push({ id: def.id, label: def.label, capabilities: capabilitiesOf(def), built: true, kind: def.kind });
    defaults[def.id] = { access: ['ADMIN'], write: ['ADMIN'] };
    storage[def.id] = { type: 'firestore', collection: 'builtRecords' };
    if (needsApproval(def)) gateable.push({ ModuleID: def.id, Label: def.label, built: true });
  });
}

// The firm's published definitions, as this instance last read them.
let loaded = { at: 0, defs: [] };
let loading = null;

async function readPublished() {
  const { firm } = require('./firebaseAdmin');
  const snap = await firm.firestore.collection('moduleDefinitions').get();
  return snap.docs.map(d => d.data().Published).filter(Boolean);
}

// Brings the registry up to date (at most every REFRESH_MS; a failed read
// keeps what was there, so a call never fails for it).
async function refresh(force) {
  if (!force && Date.now() - loaded.at < REFRESH_MS) return loaded.defs;
  if (!loading) {
    loading = readPublished().then(defs => {
      const { MODULE_REGISTRY, DEFAULT_PERMISSIONS } = require('./moduleRegistry');
      const { APPROVAL_GATEABLE_MODULES, APPROVAL_MODULE_STORAGE_ } = require('./approvalRegistry');
      applyToRegistry(defs, MODULE_REGISTRY, DEFAULT_PERMISSIONS, APPROVAL_GATEABLE_MODULES, APPROVAL_MODULE_STORAGE_);
      loaded = { at: Date.now(), defs };
      return defs;
    }, err => { console.error('builtDefinitions: not refreshed', err); loaded = { at: Date.now(), defs: loaded.defs }; return loaded.defs; })
      .finally(() => { loading = null; });
  }
  return loading;
}

// One published definition (after refresh), or null. A miss reads again at once
// (each function is its own instance: one may have published a moment ago).
// fresh: read the firm's definitions now (the runtime's own calls: a version just
// published elsewhere is used at once, not after the 30 s).
async function publishedDef(id, fresh) {
  if (fresh) return (await refresh(true)).find(d => d.id === id) || null;
  const found = (await refresh()).find(d => d.id === id);
  if (found || !ID.test(String(id))) return found || null;
  return (await refresh(true)).find(d => d.id === id) || null;
}

module.exports = { cleanSchedule, cleanBoard, ID, KEY, TYPES, LINE_TYPES, LINK_TARGETS, RESERVED, cleanDefinition, capabilitiesOf, needsApproval, applyToRegistry, refresh, publishedDef };
