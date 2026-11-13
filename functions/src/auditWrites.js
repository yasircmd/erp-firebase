// The audit log's view of the masters and settings (owner, 2026-11-13;
// docs/modules/AUDIT_LOG.md step 2, QA2, QA3, QA6, QA8). New development,
// hand-written.
//
// One wrapper on the database handles (firebaseAdmin.js): a write to a
// listed master or settings path, in the Realtime Database or in Firestore
// (directly, in a batch or in a transaction), reads the record before and
// after and tells audit.js, which keeps the changed fields. Nothing else
// is touched: a path that is not listed gets the plain handle back, and a
// wrapped reference is unwrapped before it reaches the SDK.
//
// A record is the master or setting a change belongs to: items/<id> in the
// Realtime Database (depth 2; exchangeRates/<code>/<rate> is depth 3), or a
// Firestore document. A write that touches more than MANY records (an
// import, a depreciation run) is recorded as one summary, unread.
'use strict';

const RAW = Symbol('auditRaw');
const INFO = Symbol('auditInfo');
const MANY = 50;

// Realtime Database: root -> [module, depth].
const RTDB = {
  items: ['ITEMMASTER', 2], itemSubCategories: ['ITEMSUBCAT', 2], uoms: ['UOM', 2], boms: ['BOM', 2],
  vendors: ['VENDORMASTER', 2], customers: ['CUSTOMERMASTER', 2], customerClassifications: ['CUSTOMERMASTER', 2],
  salesReps: ['CUSTOMERMASTER', 2], salesTypes: ['SALESINVOICESETUP', 2], requisitionCategories: ['PROCUREMENTSETUP', 2],
  coa: ['COA', 2], companies: ['COMPANYMASTER', 2], orgUnits: ['ORGUNITS', 2],
  users: ['USERMGMT', 2], roles: ['ROLES', 2], permissions: ['ROLES', 2], tree: ['TREEMGMT', 2],
  currencies: ['CURRENCYCONFIG', 2], exchangeRates: ['CURRENCYCONFIG', 3], fxSettings: ['CURRENCYCONFIG', 2],
  priceLists: ['PRICELISTING', 2], priceListLines: ['PRICELISTING', 2],
  approvalConfigurations: ['APPROVALCONFIG', 2], approvalLevels: ['APPROVALCONFIG', 2], approvalFollowUpSettings: ['APPROVALCONFIG', 2],
  periodClosing: ['PERIODCLOSE', 2], recurringJournals: ['RECURRINGJV', 2]
};
// Roots too large to read whole: a write to the whole list is a summary.
const LARGE = ['items', 'customers', 'vendors', 'priceListLines', 'coa'];

// Firestore (a corporate's): collection -> module, and the fields a posting
// keeps up to date there (not a change to the master: QA2).
const FIRESTORE = {
  employees: 'EMPLOYEES', employeeCompensation: 'EMPLOYEES', essAccounts: 'EMPLOYEES',
  hrDesignations: 'HRSETUP', hrDocumentTypes: 'HRSETUP', hrFields: 'HRSETUP', hrGrades: 'HRSETUP', hrWorkSchedules: 'HRSETUP', hrLeavingReasons: 'HRSETUP',
  hrLeaveTypes: 'LEAVE', hrWorkCalendars: 'LEAVE',
  hrPayElements: 'PAYROLLSETUP', payrollSettings: 'PAYROLLSETUP', payrollPaymentFormats: 'PAYROLLSETUP',
  payrollLoanTypes: 'PAYROLLLOAN', payrollAccrualTypes: 'PROVISIONS',
  reimbursementCategories: 'EMPREQUESTS', employeeRequestTypes: 'EMPREQUESTS', employeeRequestHandlers: 'EMPREQUESTS', employeeEmailSettings: 'EMPREQUESTS',
  clearanceSetup: 'CLEARANCE',
  faSettings: 'FACONFIG', faClasses: 'FACONFIG', faAccountDetermination: 'FACONFIG', faAssets: 'FAASSET',
  budgetSetup: 'BUDGET', budgets: 'BUDGET', creditSetup: 'CREDITCONTROL', creditLimits: 'CREDITCONTROL',
  taxConfig: 'TAXCONFIG', bankDetails: 'COMPANYMASTER', mailAccounts: 'DEVELOPER',
  crmSetup: 'CRM', misSetup: 'MIS', glRecSetup: 'GLREC', settings: 'DOCUMENTSTORAGE', companyDocumentCategories: 'COMPANYDOCS'
};
const KEPT_BY_POSTINGS = {
  faAssets: /^Areas\.[^.]+\.(Cost|AccDep|AccDepScheduled|AccDepAdditional|LastDepPeriod|FullyDepreciatedAt|DepStartDate)$/
};
// The firm's own Firestore (QA6): its directory entry for a client is the
// client's modules, limits and status, so a change also goes in the
// client's log.
const PROVIDER = { corporateDirectory: 'DEVELOPER', corporateGroups: 'DEVELOPER' };
const CLIENT_COPY = ['corporateDirectory'];

const audit = () => require('./audit');
const unwrap = x => (x && x[RAW]) || x;
const unwrapAll = args => args.map(unwrap);
const segs = p => String(p || '').split('/').filter(Boolean);

// A Firestore value as plain JSON (Timestamps as ISO text).
function plain(v) {
  if (v === null || v === undefined) return null;
  if (typeof v.toDate === 'function' && typeof v.seconds === 'number') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') return { latitude: v.latitude, longitude: v.longitude };
    if (v.path && v.firestore) return String(v.path);
    const o = {};
    Object.keys(v).forEach(k => { o[k] = plain(v[k]); });
    return o;
  }
  return v;
}

// ---------- Realtime Database ----------

// The records a write at path (with value) touches: their paths, or
// { many } when there are too many to read, or a whole large list.
function rtdbRecords(path, method, value) {
  const s = segs(path);
  if (!s.length) {
    if (method !== 'update' || !value || typeof value !== 'object') return { list: [] };
    const all = new Set(); let many = false;
    Object.keys(value).forEach(k => {
      const r = rtdbRecords(k, 'set', value[k]);
      if (r.many) many = true; else r.list.forEach(x => all.add(x));
    });
    return many || all.size > MANY ? { many: true, list: [...all] } : { list: [...all] };
  }
  const def = RTDB[s[0]];
  if (!def) return { list: [] };
  const depth = def[1];
  if (s.length >= depth) return { list: [s.slice(0, depth).join('/')] };
  // Above a record: the records under it.
  if ((method === 'set' || method === 'remove') && LARGE.includes(s[0])) {
    const keys = method === 'set' && value && typeof value === 'object' ? Object.keys(value) : [];
    return { many: true, list: [s.join('/')], count: keys.length, ids: keys.slice(0, 20), wholeList: true };
  }
  if (method === 'update' && value && typeof value === 'object') {
    const all = new Set();
    Object.keys(value).forEach(k => rtdbRecords(s.concat(segs(k)).join('/'), 'set', value[k]).list.forEach(x => all.add(x)));
    return all.size > MANY ? { many: true, list: [...all] } : { list: [...all] };
  }
  return { list: [], whole: s.join('/') }; // a set or remove of a small list: read it whole
}

const ctxNow = () => {
  const fa = require('./firebaseAdmin');
  return { id: fa.corporateId(), entry: fa.corporateEntry() };
};

async function auditedRtdb(raw, path, method, value, doWrite) {
  const a = audit();
  if (!a.watching()) return doWrite();
  let found;
  try { found = rtdbRecords(path, method, value); } catch (e) { return doWrite(); }
  const corporate = ctxNow();
  const root = raw.root;
  if (found.many) {
    const res = await doWrite();
    const r0 = segs(found.list[0] || path)[0] || '';
    const ids = found.ids || found.list.slice(0, 20).map(p => segs(p).slice(1).join('/'));
    await a.masterChanged({ kind: 'rtdb', module: (RTDB[r0] || [''])[0], key: 'rtdb:' + (found.list[0] || path), corporate, many: found.wholeList ? (found.count || 'all') : found.list.length, ids });
    return res;
  }
  if (found.whole) {
    // A small list set or removed whole: compare each record under it.
    const def = RTDB[segs(found.whole)[0]];
    const before = (await root.child(found.whole).get()).val() || {};
    const res = await doWrite();
    const after = (await root.child(found.whole).get()).val() || {};
    const prefix = segs(found.whole);
    const extra = def[1] - prefix.length;
    const flat = (obj, depth, at) => depth <= 0 ? { [at.join('/')]: obj } : Object.assign({}, ...Object.keys(obj || {}).map(k => obj[k] && typeof obj[k] === 'object' && depth > 1 ? flat(obj[k], depth - 1, at.concat(k)) : { [at.concat(k).join('/')]: obj[k] }));
    const b = flat(before, extra, prefix), f = flat(after, extra, prefix);
    // Only the records that differ; more than MANY of them (a list seeded
    // whole), one summary.
    const keys = [...new Set(Object.keys(b).concat(Object.keys(f)))].filter(k => JSON.stringify(b[k] === undefined ? null : b[k]) !== JSON.stringify(f[k] === undefined ? null : f[k]));
    if (keys.length > MANY) {
      await a.masterChanged({ kind: 'rtdb', module: def[0], key: 'rtdb:' + found.whole, corporate, many: keys.length, ids: keys.slice(0, 20).map(k => segs(k).slice(1).join('/')) });
      return res;
    }
    for (const k of keys) await a.masterChanged({ kind: 'rtdb', module: def[0], key: 'rtdb:' + k, corporate, before: b[k] === undefined ? null : b[k], after: f[k] === undefined ? null : f[k] });
    return res;
  }
  if (!found.list.length) return doWrite();
  const read = async p => (await root.child(p).get()).val();
  const befores = await Promise.all(found.list.map(p => a.knownAfter(corporate, 'rtdb:' + p).then(k => (k !== undefined ? k : read(p)))));
  const res = await doWrite();
  const afters = await Promise.all(found.list.map(read));
  for (let i = 0; i < found.list.length; i++) {
    const p = found.list[i];
    await a.masterChanged({ kind: 'rtdb', module: RTDB[segs(p)[0]][0], key: 'rtdb:' + p, corporate, before: befores[i], after: afters[i] });
  }
  return res;
}

function wrapRef(raw, path) {
  const s = segs(path);
  if (s.length && !RTDB[s[0]]) return raw;
  return new Proxy(raw, {
    get(t, prop) {
      if (prop === RAW) return t;
      const join = p => s.concat(segs(p)).join('/');
      if (prop === 'child') return p => wrapRef(t.child(p), join(p));
      if (prop === 'set') return (v, cb) => auditedRtdb(t, path, 'set', v, () => t.set(v, cb));
      if (prop === 'update') return (v, cb) => auditedRtdb(t, path, 'update', v, () => t.update(v, cb));
      if (prop === 'remove') return cb => auditedRtdb(t, path, 'remove', null, () => t.remove(cb));
      if (prop === 'push') {
        return (v, cb) => {
          const c = t.push();
          const child = wrapRef(c, join(c.key));
          if (v === undefined) return child;
          const done = child.set(v, cb).then(() => child);
          return new Proxy(child, { get(t2, p2) { if (p2 === 'then' || p2 === 'catch' || p2 === 'finally') return done[p2].bind(done); return t2[p2]; } });
        };
      }
      if (prop === 'transaction') {
        return async (fn, onComplete, applyLocally) => {
          const a = audit();
          const recs = rtdbRecords(path, 'set', null);
          if (!a.watching() || recs.list.length !== 1 || segs(recs.list[0]).length !== s.length) return t.transaction(fn, onComplete, applyLocally);
          let current;
          const corporate = ctxNow();
          const res = await t.transaction(cur => { current = cur; return fn(cur); }, onComplete, applyLocally);
          if (res && res.committed) await a.masterChanged({ kind: 'rtdb', module: RTDB[s[0]][0], key: 'rtdb:' + recs.list[0], corporate, before: current === undefined ? null : current, after: res.snapshot.val() });
          return res;
        };
      }
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}

// The database handle's ref(): firebaseAdmin.js calls this for every ref.
function ref(rawRef, path) {
  return wrapRef(rawRef, segs(path).join('/'));
}

// ---------- Firestore ----------

const listFor = scope => (scope === 'provider' ? PROVIDER : FIRESTORE);

function wrapDoc(raw, scope, collection) {
  const info = { scope, collection, id: raw.id, module: listFor(scope)[collection] };
  return new Proxy(raw, {
    get(t, prop) {
      if (prop === RAW) return t;
      if (prop === INFO) return info;
      if (prop === 'set' || prop === 'update' || prop === 'delete' || prop === 'create') {
        return (...args) => auditedDocs([{ raw: t, info }], () => t[prop](...unwrapAll(args)));
      }
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}

function wrapCollection(raw, scope) {
  const name = raw.id;
  if (!listFor(scope)[name]) return raw;
  return new Proxy(raw, {
    get(t, prop) {
      if (prop === RAW) return t;
      if (prop === 'doc') return (...a) => wrapDoc(a.length ? t.doc(...a) : t.doc(), scope, name);
      if (prop === 'add') {
        return async data => {
          const d = wrapDoc(t.doc(), scope, name);
          await d.set(data);
          return d[RAW];
        };
      }
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}

const docCorporate = (info) => (info.scope === 'provider' ? { id: require('./firebaseAdmin').HOME_ID, entry: null } : ctxNow());

// Tells audit.js of the documents a commit changed: their before (read
// first) and after (read once committed). Many: one summary, unread.
async function auditedDocs(touched, commit, beforesGiven) {
  const a = audit();
  const list = touched.filter(x => x.info && x.info.module);
  if (!list.length || !a.watching()) return commit();
  const unique = [];
  list.forEach(x => { if (!unique.some(u => u.raw.path === x.raw.path)) unique.push(x); });
  const corp = docCorporate(unique[0].info);
  if (unique.length > MANY) {
    const res = await commit();
    await a.masterChanged({ kind: 'fs', module: unique[0].info.module, key: 'fs:' + unique[0].info.collection, corporate: corp, many: unique.length, ids: unique.slice(0, 20).map(u => u.info.id) });
    return res;
  }
  const read = async u => { const s = await u.raw.get(); return s.exists ? plain(s.data()) : null; };
  const befores = beforesGiven ? await Promise.all(beforesGiven) : await Promise.all(unique.map(u => a.knownAfter(docCorporate(u.info), 'fs:' + u.raw.path).then(k => (k !== undefined ? k : read(u)))));
  const res = await commit();
  const afters = await Promise.all(unique.map(read));
  for (let i = 0; i < unique.length; i++) {
    const u = unique[i];
    await a.masterChanged({
      kind: 'fs', module: u.info.module, key: 'fs:' + u.raw.path, corporate: docCorporate(u.info), before: befores[i], after: afters[i],
      ignore: KEPT_BY_POSTINGS[u.info.collection] || null,
      client: u.info.scope === 'provider' && CLIENT_COPY.includes(u.info.collection) ? u.info.id : null
    });
  }
  return res;
}

// A batch or a transaction: its writes are queued, their befores read as
// they are queued, and audit.js told once it has committed.
const WRITES = ['set', 'update', 'delete', 'create'];
function wrapWrites(raw, touched, befores) {
  const proxy = new Proxy(raw, {
    get(t, prop) {
      if (prop === RAW) return t;
      const v = t[prop];
      if (typeof v !== 'function') return v;
      if (WRITES.includes(prop)) {
        return (ref, ...rest) => {
          const info = ref && ref[INFO];
          if (info && info.module && audit().watching() && !touched.some(x => x.raw.path === ref[RAW].path)) {
            const r = ref[RAW];
            const corp = docCorporate(info);
            touched.push({ raw: r, info });
            befores.push(audit().knownAfter(corp, 'fs:' + r.path).then(k => (k !== undefined ? k : r.get().then(s => (s.exists ? plain(s.data()) : null)))).catch(() => null));
          }
          const out = v.call(t, unwrap(ref), ...unwrapAll(rest));
          return out === t ? proxy : out;
        };
      }
      if (prop === 'commit') return () => auditedDocs(touched, () => t.commit(), touched.length ? befores : null);
      return (...args) => v.apply(t, unwrapAll(args));
    }
  });
  return proxy;
}

function firestoreHandle(raw, scope) {
  return new Proxy(raw, {
    get(t, prop) {
      if (prop === RAW) return t;
      if (prop === 'collection') return p => (segs(p).length === 1 ? wrapCollection(t.collection(p), scope) : t.collection(p));
      if (prop === 'doc') {
        return p => {
          const s = segs(p);
          return s.length === 2 && listFor(scope)[s[0]] ? wrapDoc(t.doc(p), scope, s[0]) : t.doc(p);
        };
      }
      if (prop === 'batch') return () => wrapWrites(t.batch(), [], []);
      if (prop === 'runTransaction') {
        return async (fn, opts) => {
          let touched = [], befores = [];
          const res = await t.runTransaction(async tx => {
            touched = []; befores = [];
            const out = await fn(wrapWrites(tx, touched, befores));
            await Promise.all(befores); // read before the transaction commits
            return out;
          }, opts);
          if (touched.length) await auditedDocs(touched, async () => res, befores);
          return res;
        };
      }
      const v = t[prop];
      return typeof v === 'function' ? (...args) => v.apply(t, unwrapAll(args)) : v;
    }
  });
}

module.exports = { ref, firestoreHandle, rtdbRecords, plain, RTDB, FIRESTORE, PROVIDER, MANY };
