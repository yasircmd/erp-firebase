// ============================================================
// ERP SYSTEM — MAIN SERVER SCRIPT
// ============================================================
// Everything (auth, users, roles, permissions, module tree, COA, GL)
// lives in Firebase RTDB now. This spreadsheet's own cells are no longer
// read by the app at runtime — the "Tree" sheet has been fully retired
// in favor of a Firebase-backed, admin-editable module tree (see
// MODULE TREE section below). If you still keep the physical Tree sheet
// around, it's now just a historical reference, not a data source.
//
// Roles and per-module permissions are DATA now, not code: adding a new
// module is still a code change (new functions here + a new fragment
// file), but WHO can access/draft/post/write within a module is fully
// editable from the Roles & Permissions screen with no redeploy needed.
//
// Role IDs are permanent once created; only their display Name can be
// renamed. The four original roles (ADMIN, FINANCE_MGR, ACCOUNTANT,
// VIEWER) use their own name as their ID, which is what makes this a
// non-breaking change against user records already written with
// role: "ADMIN" etc. as a plain string — that string is now treated as
// a Role ID that happens to also be readable.

const FIREBASE_URL = 'https://erp1-8f4cd-default-rtdb.firebaseio.com';

// Same project as FIREBASE_URL above — Firestore is a second, separately
// metered database living inside the SAME Firebase/Cloud project, not a
// different one. See the Firestore access layer further below.
const FIRESTORE_PROJECT_ID = 'erp1-8f4cd';

// Code-level registry of what modules EXIST and what capabilities each
// one has. This does NOT say who can do what — that's the Firebase
// permissions matrix (see PERMISSIONS section). Adding a new module
// means adding an entry here (plus its Code.gs functions and its
// fragment file); it will automatically get default-seeded permissions
// and show up in the Roles & Permissions matrix.
const MODULE_REGISTRY = [
  { id: 'USERMGMT', label: 'User Management', capabilities: ['access', 'write'] },
  { id: 'COA', label: 'Chart of Accounts', capabilities: ['access', 'write'] },
  { id: 'JV', label: 'Journal Entry Processing (JV)', capabilities: ['access', 'draft', 'post'] },
  { id: 'CBT', label: 'Cash and Bank Transactions (CBT)', capabilities: ['access', 'draft', 'post'] },
  { id: 'TREEMGMT', label: 'Module Tree & Navigation', capabilities: ['access', 'write'] },
  { id: 'ROLES', label: 'Roles & Permissions', capabilities: ['access', 'write'] },
  { id: 'COMPANYMASTER', label: 'Company Master Data', capabilities: ['access', 'write'] },
  { id: 'VENDORMASTER', label: 'Vendor Master Data', capabilities: ['access', 'write'] },
  { id: 'CUSTOMERMASTER', label: 'Customer Master Data', capabilities: ['access', 'write'] },
  { id: 'PROCUREMENTSETUP', label: 'Procurement Setup', capabilities: ['access', 'write'] },
  { id: 'SALESINVOICESETUP', label: 'Sales Invoice Configuration', capabilities: ['access', 'write'] },
  { id: 'APPROVALCONFIG', label: 'Approval Configuration', capabilities: ['access', 'write'] },
  { id: 'APPROVALTRACKER', label: 'Approval Tracker', capabilities: ['access'] },
  { id: 'PURCHASEREQUISITION', label: 'Purchase Requisition', capabilities: ['access', 'draft', 'post'] },
  { id: 'INVENTORYPURCHASEREQUISITION', label: 'Inventory Purchase Requisition', capabilities: ['access', 'draft', 'post'] },
  { id: 'PURCHASEORDER', label: 'Purchase Order', capabilities: ['access', 'draft', 'post'] },
  { id: 'JOBORDERREQUEST', label: 'Job Order Request', capabilities: ['access', 'draft', 'post'] },
  { id: 'PRICELISTING', label: 'Price Listing', capabilities: ['access', 'write'] },
  { id: 'SALESORDER', label: 'Sales Order', capabilities: ['access', 'draft', 'post'] },
  { id: 'CURRENCYCONFIG', label: 'Currency Configuration', capabilities: ['access', 'write'] },
  { id: 'ORGUNITS', label: 'Organizational Units', capabilities: ['access', 'write'] },
  { id: 'UOM', label: 'Unit of Measure', capabilities: ['access', 'write'] },
  { id: 'ITEMSUBCAT', label: 'Item Sub-Category', capabilities: ['access', 'write'] },
  { id: 'ITEMMASTER', label: 'Item Master', capabilities: ['access', 'write'] },
  { id: 'GLREPORT', label: 'General Ledger Reports (GL)', capabilities: ['access'] },
  { id: 'STOCKAVAILABILITY', label: 'Stock Availability', capabilities: ['access'] },
  { id: 'INVENTORYVALUATION', label: 'Inventory Valuation List', capabilities: ['access', 'write'] },
  { id: 'STOCKLEDGER', label: 'Stock Ledger Report', capabilities: ['access'] },
  { id: 'PRODCONSUMPTION', label: 'Production & Consumption Report', capabilities: ['access'] },
  { id: 'STOCKVALUATION', label: 'Stock Valuation Report', capabilities: ['access'] },
  { id: 'TRIALBALANCE', label: 'Trial Balance (TB)', capabilities: ['access'] },
  { id: 'PROFITLOSS', label: 'Profit and Loss Statement (P&L)', capabilities: ['access'] },
  { id: 'BALANCESHEET', label: 'Balance Sheet (BS)', capabilities: ['access'] },
  { id: 'CASHFLOW', label: 'Cash Flow Statement (CFS)', capabilities: ['access'] },
  { id: 'GRN', label: 'Goods Receipt (GRN)', capabilities: ['access', 'draft', 'post'] },
  { id: 'MATERIALISSUE', label: 'Material Issue (MI)', capabilities: ['access', 'draft', 'post'] },
  { id: 'PRODUCTION', label: 'Production Entry', capabilities: ['access', 'draft', 'post'] },
  { id: 'WAREHOUSEMOVEMENT', label: 'Warehouse Movement', capabilities: ['access', 'draft', 'post'] },
  { id: 'STOCKADJUSTMENT', label: 'Stock Adjustment', capabilities: ['access', 'draft', 'post'] },
  { id: 'PHYSICALCOUNT', label: 'Physical / Cycle Count', capabilities: ['access', 'draft', 'post'] },
  { id: 'BOM', label: 'Bill of Materials', capabilities: ['access', 'write'] },
  { id: 'MATERIALVARIANCE', label: 'Material Variance Report', capabilities: ['access'] },
  { id: 'VENDORINVOICE', label: 'Vendor Invoice Processing', capabilities: ['access', 'draft', 'post'] },
  { id: 'DELIVERYNOTE', label: 'Delivery Note (Goods Dispatch)', capabilities: ['access', 'draft', 'post'] },
  { id: 'CUSTOMERINVOICE', label: 'Customer Invoice Processing', capabilities: ['access', 'draft', 'post'] },
  { id: 'DATARESET', label: 'Data Reset (Admin)', capabilities: ['access', 'write'] }
];

// Seeded once into /roles if empty. IDs are permanent; Name is editable
// afterward from the Roles & Permissions screen.
const DEFAULT_ROLES = [
  { id: 'ADMIN', name: 'ADMIN', description: 'Full administrative access to every module.' },
  { id: 'FINANCE_MGR', name: 'FINANCE_MGR', description: 'Can post and approve financial entries.' },
  { id: 'ACCOUNTANT', name: 'ACCOUNTANT', description: 'Can create and edit draft entries; cannot post.' },
  { id: 'VIEWER', name: 'VIEWER', description: 'Read-only access.' }
];

// Seeded once per module into /permissions if that module has no entry
// yet — matches what was previously hardcoded, so this is a non-breaking
// migration. New modules added later automatically get seeded here too.
const DEFAULT_PERMISSIONS = {
  USERMGMT: { access: ['ADMIN'], write: ['ADMIN'] },
  COA:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  JV:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  CBT:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  TREEMGMT: { access: ['ADMIN'], write: ['ADMIN'] },
  ROLES:    { access: ['ADMIN'], write: ['ADMIN'] },
  COMPANYMASTER:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  VENDORMASTER:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  CUSTOMERMASTER: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  PROCUREMENTSETUP: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  SALESINVOICESETUP: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  // Admin-only write, no exceptions — this controls who approves what
  // across every gated module in the system. More sensitive than any
  // individual module's own approval levels used to be.
  APPROVALCONFIG: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  // Admin only, explicitly — this is the audit/dispute trail across
  // every gated module, deliberately narrower than every other
  // read-only report in this system (which default to a broader
  // access list). Nobody who could be a SUBJECT of an approval
  // decision should also be able to browse the full history of them.
  APPROVALTRACKER: { access: ['ADMIN'] },
  // Deliberately broad, and draft/post kept EQUAL rather than mirroring
  // GRN's pattern of a more-restricted post — GRN's "post" is a real
  // financial/stock commitment needing higher trust, but this module's
  // "Submit" is just "lock and hand off to Procurement," not a
  // financial commitment (see the module's own header comment on why
  // it carries no value/approval gate at all). No reason to trust
  // Submit less than Draft here.
  PURCHASEREQUISITION: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  // Confirmed requesters are Sales and Production specifically, not
  // every department — but this system has no department-specific
  // roles by default (just ADMIN/FINANCE_MGR/ACCOUNTANT/VIEWER), so
  // that restriction has to be enforced by whichever org-specific roles
  // an admin creates in Roles & Permissions (e.g. SALES_STAFF,
  // PRODUCTION_STAFF), granted access here explicitly — same approach
  // taken for Purchase Requisition's own "all departments" scope.
  INVENTORYPURCHASEREQUISITION: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  PURCHASEORDER: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  // Confirmed: Sales and Production only, and confirmed daily-task, no
  // approval gate — same broad default as the other requisition
  // modules, restricted by whatever org-specific roles an admin
  // assigns (e.g. SALES_STAFF, PRODUCTION_STAFF).
  JOBORDERREQUEST: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  PRICELISTING: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  // Sales-facing, same broad-default reasoning as the requisition
  // modules — org-specific SALES_STAFF-style roles assign write access
  // via Roles & Permissions the same way as everywhere else.
  SALESORDER: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  CURRENCYCONFIG: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  ORGUNITS:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  UOM:            { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  ITEMSUBCAT:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  ITEMMASTER:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  GLREPORT:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // Read-only report, same broad-access pattern as GL Report — Sales
  // needs this to actually use Claim/Release intelligently, so it
  // shouldn't be locked behind a narrower role set than Sales Order itself.
  STOCKAVAILABILITY: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // Same sensitivity as Price Listing — cost data feeds margin/COGS,
  // not something every role should be able to change.
  INVENTORYVALUATION: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  STOCKLEDGER:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  PRODCONSUMPTION:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  STOCKVALUATION:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  TRIALBALANCE: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  PROFITLOSS:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  BALANCESHEET: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  CASHFLOW:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  GRN:                { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  VENDORINVOICE:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  DELIVERYNOTE:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  CUSTOMERINVOICE:    { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  MATERIALISSUE:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PRODUCTION:         { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  WAREHOUSEMOVEMENT:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  STOCKADJUSTMENT:    { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PHYSICALCOUNT:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  BOM:                { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  MATERIALVARIANCE:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  DATARESET:          { access: ['ADMIN'], write: ['ADMIN'] }
};

// ---------- WEB APP ----------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ERP System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------- FIREBASE HELPERS ----------

function getFirebaseApiKey_() {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('FIREBASE_API_KEY');

  if (!apiKey) {
    throw new Error('FIREBASE_API_KEY is missing from Script Properties.');
  }

  return apiKey;
}

function firebaseAuthRequest_(endpoint, payload) {
  const response = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${getFirebaseApiKey_()}`,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const data = JSON.parse(response.getContentText() || '{}');

  if (response.getResponseCode() >= 400) {
    throw new Error(data.error?.message || 'Firebase Authentication request failed.');
  }

  return data;
}

// path '' targets the database root — needed for Firebase's multi-path
// update feature (see moveTreeNode), where keys in the payload are
// themselves slash-separated relative paths.
function firebaseDbRequest_(path, method, payload, idToken) {
  const cleanPath = String(path).replace(/^\/+|\/+$/g, '');
  const authPart = idToken ? `?auth=${encodeURIComponent(idToken)}` : '';

  const options = {
    method: method || 'get',
    muteHttpExceptions: true
  };

  if (payload !== null && payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(
    `${FIREBASE_URL}/${cleanPath}.json${authPart}`,
    options
  );

  const data = JSON.parse(response.getContentText() || 'null');

  if (response.getResponseCode() >= 400) {
    throw new Error(data?.error || 'Firebase database request failed.');
  }

  return data;
}

// ============================================================
// FIRESTORE ACCESS LAYER (Phase 1 of the GL/Firestore migration)
// ============================================================
// The Firestore equivalent of firebaseDbRequest_ above — built as its
// own layer because Firestore's wire format is genuinely different
// from RTDB's, not just a different URL. RTDB stores and returns plain
// JSON; Firestore requires every field to be wrapped in a typed,
// tagged value ({ stringValue: "x" }, { doubleValue: 1.5 }, etc. — see
// https://firebase.google.com/docs/firestore/reference/rest/v1/Value)
// on the way in, and returns that same tagged shape on the way out.
// Nothing above this layer should ever construct a Firestore request
// body or parse a Firestore response directly — every caller (Phase 2
// onward) works in plain JS objects; the conversion happens here,
// once, the same reason firebaseDbRequest_ exists as a single
// chokepoint for RTDB.
//
// Design choices worth being explicit about:
// - Every JS number is written as Firestore's doubleValue, never
//   integerValue — this sidesteps a real wire-format gotcha
//   (integerValue is encoded as a STRING in JSON, to avoid int64
//   precision loss) and is simpler and safer for financial data, which
//   should be treated as decimal-capable regardless of whether a given
//   amount currently happens to be a whole number.
// - A document's own Firestore document ID is returned as `_id` on the
//   plain object handed back to the caller — every caller needs this
//   constantly (it's the equivalent of an RTDB key), and callers
//   should never have to parse Firestore's own resource-name path
//   format (`projects/.../documents/{collection}/{id}`) themselves.
// - Composite queries (a filter on one field plus a sort/range on a
//   DIFFERENT field) often require a composite index that doesn't
//   exist yet. Firestore fails such a query on its FIRST run with a
//   direct link in the error response to auto-create the needed
//   index — that's expected, ordinary behavior the first time any new
//   query shape runs, not a bug to work around here.

const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROJECT_ID + '/databases/(default)/documents';

// ---- Plain JS <-> Firestore typed-field conversion ----

function toFirestoreValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue_) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields_(value) } };
  }
  throw new Error('Unsupported value type for Firestore: ' + typeof value);
}

function toFirestoreFields_(obj) {
  const fields = {};
  Object.keys(obj || {}).forEach(key => {
    if (obj[key] === undefined) return; // omit, same as JSON.stringify's own behavior
    fields[key] = toFirestoreValue_(obj[key]);
  });
  return fields;
}

function fromFirestoreValue_(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue_);
  }
  if ('mapValue' in value) {
    return fromFirestoreFields_(value.mapValue.fields || {});
  }
  return null;
}

function fromFirestoreFields_(fields) {
  const obj = {};
  Object.keys(fields || {}).forEach(key => {
    obj[key] = fromFirestoreValue_(fields[key]);
  });
  return obj;
}

// Converts one raw Firestore document ({ name, fields, createTime,
// updateTime }) into a plain object with _id attached — see the
// design-choices comment above for why.
function fromFirestoreDocument_(doc) {
  if (!doc || !doc.name) return null;
  const parts = doc.name.split('/');
  const id = parts[parts.length - 1];
  const obj = fromFirestoreFields_(doc.fields || {});
  obj._id = id;
  return obj;
}

// ---- Low-level request helper ----
// Returns { code, data } rather than throwing directly, unlike
// firebaseDbRequest_ — Firestore callers need to distinguish a genuine
// error from an expected 404 (get_/delete_ below both treat "not
// found" as a normal, non-error outcome), so the error-vs-not-found
// decision is made by each caller, not baked into this shared helper.
function firestoreRequest_(method, urlPath, body) {
  const token = ScriptApp.getOAuthToken();
  const options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body !== null && body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const response = UrlFetchApp.fetch(FIRESTORE_BASE_URL + urlPath, options);
  return { code: response.getResponseCode(), data: JSON.parse(response.getContentText() || 'null') };
}

// Firestore's error response shape differs by endpoint: a single-document
// operation (get/set/update/delete) returns a plain { error: {...} }
// object, but :runQuery and :runAggregationQuery wrap it in an array —
// [{ error: {...} }] — since those endpoints normally return an array of
// result rows. Missing this distinction meant every query/count failure
// fell through to the generic fallback message below, silently hiding
// the actual Firestore error (including index-creation links) behind a
// useless "Firestore request failed." — found via a real failure this
// caused, not proactively.
function throwIfFirestoreError_(result) {
  if (result.code >= 400) {
    const errorObj = Array.isArray(result.data) ? (result.data[0] && result.data[0].error) : (result.data && result.data.error);
    const message = (errorObj && errorObj.message) || 'Firestore request failed.';
    throw new Error(message);
  }
}

// ---- Public CRUD surface ----

// Returns null if the document doesn't exist, rather than throwing —
// same not-found-means-null convention firebaseDbRequest_ already uses
// for RTDB, kept consistent here.
function firestoreGet_(collection, docId) {
  const result = firestoreRequest_('get', '/' + collection + '/' + docId, null);
  if (result.code === 404) return null;
  throwIfFirestoreError_(result);
  return fromFirestoreDocument_(result.data);
}

// Fully replaces a document's fields, creating it if it doesn't exist
// — mirrors firebaseDbRequest_'s own 'put' semantics exactly.
function firestoreSet_(collection, docId, data) {
  const body = { fields: toFirestoreFields_(data) };
  const result = firestoreRequest_('patch', '/' + collection + '/' + docId, body);
  throwIfFirestoreError_(result);
  return fromFirestoreDocument_(result.data);
}

// Merges only the given fields into an EXISTING document, leaving
// every other field untouched — mirrors firebaseDbRequest_'s own
// 'patch' semantics. Firestore's PATCH endpoint needs an explicit
// updateMask listing exactly which top-level fields are being
// touched; without one, PATCH silently becomes a full replace instead
// of a merge, which is the single easiest mistake to make against this
// API — so the mask is always built automatically here from whatever
// keys are actually present in data, rather than leaving every future
// caller to remember it for themselves.
function firestoreUpdate_(collection, docId, data) {
  const fieldNames = Object.keys(data || {});
  if (!fieldNames.length) return firestoreGet_(collection, docId);
  const maskParams = fieldNames.map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const body = { fields: toFirestoreFields_(data) };
  const result = firestoreRequest_('patch', '/' + collection + '/' + docId + '?' + maskParams, body);
  throwIfFirestoreError_(result);
  return fromFirestoreDocument_(result.data);
}

// Creates a document with a Firestore-generated ID, for the rarer case
// a caller doesn't already have its own ID to assign (this codebase's
// existing convention, everywhere else, is generating its own IDs via
// Utilities.getUuid() and using an explicit doc ID — firestoreSet_ is
// almost always the right choice, not this).
function firestoreAdd_(collection, data) {
  const body = { fields: toFirestoreFields_(data) };
  const result = firestoreRequest_('post', '/' + collection, body);
  throwIfFirestoreError_(result);
  return fromFirestoreDocument_(result.data);
}

// Treats "already gone" as success, not an error — deleting something
// that doesn't exist achieves the caller's actual goal either way.
function firestoreDelete_(collection, docId) {
  const result = firestoreRequest_('delete', '/' + collection + '/' + docId, null);
  if (result.code === 404) return;
  throwIfFirestoreError_(result);
}

// ---- Structured queries — the actual point of this whole migration ----
// where: array of [fieldPath, op, value] triples, e.g.
//   [['CompanyID', 'EQUAL', 'CO-1'], ['Status', 'EQUAL', 'Posted']]
// op matches Firestore's own operator names: EQUAL, NOT_EQUAL,
// LESS_THAN, LESS_THAN_OR_EQUAL, GREATER_THAN, GREATER_THAN_OR_EQUAL,
// ARRAY_CONTAINS.
// orderBy: array of [fieldPath, direction] pairs, direction
// 'ASCENDING' or 'DESCENDING'.
function firestoreQuery_(collection, where, orderBy, limit) {
  const structuredQuery = { from: [{ collectionId: collection }] };
  const whereClause = buildFirestoreWhereClause_(where);
  if (whereClause) structuredQuery.where = whereClause;

  if (orderBy && orderBy.length) {
    structuredQuery.orderBy = orderBy.map(pair => ({
      field: { fieldPath: pair[0] }, direction: pair[1] || 'ASCENDING'
    }));
  }

  if (limit) structuredQuery.limit = limit;

  const result = firestoreRequest_('post', ':runQuery', { structuredQuery: structuredQuery });
  throwIfFirestoreError_(result);
  return (result.data || [])
    .filter(r => r.document)
    .map(r => fromFirestoreDocument_(r.document));
}

// Shared by firestoreQuery_ and firestoreCount_ below — both build the
// exact same where-clause shape, just plug it into a different outer
// query type.
function buildFirestoreWhereClause_(where) {
  if (!where || !where.length) return null;
  const filters = where.map(triple => ({
    fieldFilter: {
      field: { fieldPath: triple[0] },
      op: triple[1],
      value: toFirestoreValue_(triple[2])
    }
  }));
  return filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters: filters } };
}

// Server-side COUNT — added specifically because a capped, sorted list
// query (getJournalEntries and its kind) needs to show a genuine total
// alongside however many rows are actually returned, and fetching every
// matching document just to count them defeats the entire point of
// moving off RTDB's whole-node reads in the first place. Same where
// triples as firestoreQuery_, no orderBy/limit — a count has no order.
function firestoreCount_(collection, where) {
  const structuredQuery = { from: [{ collectionId: collection }] };
  const whereClause = buildFirestoreWhereClause_(where);
  if (whereClause) structuredQuery.where = whereClause;

  const result = firestoreRequest_('post', ':runAggregationQuery', {
    structuredAggregationQuery: { structuredQuery: structuredQuery, aggregations: [{ alias: 'total', count: {} }] }
  });
  throwIfFirestoreError_(result);
  const row = (result.data || [])[0];
  if (!row || !row.result || !row.result.aggregateFields) return 0;
  return Number(row.result.aggregateFields.total.integerValue || 0);
}

// ---------- AUTHENTICATION ----------

// Fixed, shared organization-wide gate checked at login, alongside the
// user's own email/password — deliberately a server-only constant, not
// stored in any editable settings screen or database record: only
// someone with access to this script itself (the developer) can ever
// change it, by design.
const CORPORATE_ID = '100';

function loginWithFirebase(email, password, corporateId) {
  if (String(corporateId || '').trim() !== CORPORATE_ID) {
    return { authenticated: false, error: 'Invalid Corporate ID.' };
  }
  try {
    const auth = firebaseAuthRequest_('accounts:signInWithPassword', {
      email: String(email || '').trim(),
      password: String(password || ''),
      returnSecureToken: true
    });

    const profile = firebaseDbRequest_(
      `users/${auth.localId}`,
      'get',
      null,
      auth.idToken
    );

    if (!profile) {
      return {
        authenticated: false,
        error: 'This Firebase account has no ERP user profile.'
      };
    }

    if (profile.status !== 'Active') {
      return {
        authenticated: false,
        error: 'This ERP account is inactive.'
      };
    }

    firebaseDbRequest_(
      `users/${auth.localId}`,
      'patch',
      { lastLogin: new Date().toISOString() },
      auth.idToken
    );

    const roles = ensureRolesSeeded_(auth.idToken);
    const roleName = (roles[profile.role] && roles[profile.role].Name) || profile.role || 'VIEWER';

    return {
      authenticated: true,
      token: auth.idToken,
      expiresIn: auth.expiresIn,
      uid: auth.localId,
      fullName: profile.fullName || '',
      role: profile.role || 'VIEWER',
      roleName: roleName,
      data: buildTreeForRole_(auth.idToken, profile.role || 'VIEWER')
    };
  } catch (err) {
    return {
      authenticated: false,
      error: err.message
    };
  }
}

// Used when a new browser tab picks up an existing session from
// localStorage (see the client's own persistence logic) — re-validates
// the token against Firebase AND re-fetches the user's CURRENT
// profile/tree data fresh from the server, rather than blindly
// trusting whatever the new tab found sitting in storage. This
// matters: if an admin deactivated this account or changed its role
// since the original sign-in, a new tab needs to see that change, not
// silently carry forward stale permissions just because the token
// itself still parses. Same success shape as loginWithFirebase's own
// (minus expiresIn — restoring doesn't mint a new token, so the
// client tracks the original expiry itself), so the client can reuse
// the exact same onAuthResponse handler for both.
function restoreSession(idToken) {
  try {
    if (!idToken) throw new Error('No session to restore.');
    const lookup = firebaseAuthRequest_('accounts:lookup', { idToken: idToken });
    const uid = lookup.users && lookup.users[0] && lookup.users[0].localId;
    if (!uid) throw new Error('Session expired.');

    const profile = firebaseDbRequest_(`users/${uid}`, 'get', null, idToken);
    if (!profile) return { authenticated: false, error: 'This Firebase account has no ERP user profile.' };
    if (profile.status !== 'Active') return { authenticated: false, error: 'This ERP account is inactive.' };

    const roles = ensureRolesSeeded_(idToken);
    const roleName = (roles[profile.role] && roles[profile.role].Name) || profile.role || 'VIEWER';

    return {
      authenticated: true,
      token: idToken,
      uid: uid,
      fullName: profile.fullName || '',
      role: profile.role || 'VIEWER',
      roleName: roleName,
      data: buildTreeForRole_(idToken, profile.role || 'VIEWER')
    };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
}

function requireUser_(idToken) {
  if (!idToken) {
    throw new Error('Please sign in again.');
  }

  const account = firebaseAuthRequest_('accounts:lookup', {
    idToken: idToken
  });

  const uid = account.users?.[0]?.localId;

  if (!uid) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const profile = firebaseDbRequest_(
    `users/${uid}`,
    'get',
    null,
    idToken
  );

  if (!profile || profile.status !== 'Active') {
    throw new Error('This ERP account is inactive or not configured.');
  }

  return { uid, profile };
}

// Kept as requireAdmin_ for minimal disruption to existing call sites,
// but this is no longer hardcoded to a literal "ADMIN" string — it now
// checks whichever role(s) currently hold write access to USERMGMT in
// the permissions matrix.
function requireAdmin_(idToken) {
  const user = requireUser_(idToken);

  if (!moduleHasCapability_(idToken, 'USERMGMT', 'write', user.profile.role)) {
    throw new Error('You do not have permission to manage users.');
  }

  return user;
}

function changePassword(idToken, newPassword) {
  try {
    requireUser_(idToken);

    const password = String(newPassword || '');

    if (password.length < 6) {
      return {
        success: false,
        message: 'New password must be at least 6 characters long.'
      };
    }

    const result = firebaseAuthRequest_('accounts:update', {
      idToken: idToken,
      password: password,
      returnSecureToken: true
    });

    return {
      success: true,
      message: 'Password updated successfully.',
      token: result.idToken
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Login-screen "Forgot Password" flow — sends Firebase's own reset
// email (a link the user clicks to set a new password on Firebase's
// hosted reset page; this app has no page of its own for that step).
// Still called changePassword for an already-authenticated user's own
// "reset my password" action if one is added later — this is the
// separate, unauthenticated entry point that used to live behind the
// login screen's old "verify current password, then change it" tab.
//
// Deliberately returns the SAME generic success message whether or not
// the email actually belongs to an account, and on any other request
// failure too — never distinguishing "sent" from "no such account" is
// standard, deliberate practice for a forgot-password flow, since the
// alternative lets anyone probe which emails are registered users.
function sendPasswordResetEmail(email) {
  const generic = { success: true, message: 'If an account exists for that email, a password reset link has been sent.' };
  try {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) return { success: false, message: 'Enter your email address.' };
    firebaseAuthRequest_('accounts:sendOobCode', {
      requestType: 'PASSWORD_RESET',
      email: cleanEmail
    });
    return generic;
  } catch (err) {
    return generic;
  }
}

// Direct in-app alternative to the forgot-password/email-reset flow
// above — for a user who's already signed in and simply wants to
// change their own password. Re-verifies the CURRENT password first,
// via a fresh sign-in attempt, before allowing the change — a
// deliberate extra safeguard even though the caller already holds a
// valid session token: someone finding an unlocked, still-signed-in
// session shouldn't be able to silently take over the account by
// changing its password with no further check at all.
function changeOwnPassword(idToken, currentPassword, newPassword) {
  try {
    if (!idToken) throw new Error('Please sign in again.');
    const newPasswordTrimmed = String(newPassword || '');
    if (newPasswordTrimmed.length < 6) throw new Error('New password must be at least 6 characters.');

    const lookup = firebaseAuthRequest_('accounts:lookup', { idToken: idToken });
    const email = lookup.users && lookup.users[0] && lookup.users[0].email;
    if (!email) throw new Error('Your session has expired. Please sign in again.');

    let reauth;
    try {
      reauth = firebaseAuthRequest_('accounts:signInWithPassword', {
        email: email, password: String(currentPassword || ''), returnSecureToken: true
      });
    } catch (err) {
      throw new Error('Current password is incorrect.');
    }

    firebaseAuthRequest_('accounts:update', {
      idToken: reauth.idToken, password: newPasswordTrimmed, returnSecureToken: false
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// ROLES & PERMISSIONS
// ============================================================
// Storage: Firebase RTDB.
//   /roles/{roleId}       -> { Name, Description, CreatedAt, ... }
//   /permissions/{moduleId} -> { access: [roleId,...], write: [...], ... }
//                               (capability keys per MODULE_REGISTRY)
//
// Two lockout guards are enforced in code, not just convention:
//   1. A role in use by any user cannot be deleted.
//   2. Write access to ROLES or USERMGMT can never drop to zero roles —
//      either of those reaching zero would be unrecoverable without
//      direct Firebase console access.

function ensureRolesSeeded_(idToken) {
  const existing = firebaseDbRequest_('roles', 'get', null, idToken) || {};
  if (Object.keys(existing).length) return existing;

  const now = new Date().toISOString();
  const seeded = {};
  DEFAULT_ROLES.forEach(r => {
    seeded[r.id] = { Name: r.name, Description: r.description, CreatedAt: now, CreatedBy: 'SYSTEM', UpdatedAt: now, UpdatedBy: 'SYSTEM' };
  });

  try {
    firebaseDbRequest_('roles', 'put', seeded, idToken);
  } catch (err) {
    // Read-only caller — proceed with in-memory defaults; a writer's
    // next visit will persist them.
  }
  return seeded;
}

function ensurePermissionsSeeded_(idToken) {
  const existing = firebaseDbRequest_('permissions', 'get', null, idToken) || {};
  let changed = false;

  Object.keys(DEFAULT_PERMISSIONS).forEach(moduleId => {
    if (!existing[moduleId]) {
      existing[moduleId] = DEFAULT_PERMISSIONS[moduleId];
      changed = true;
    }
  });

  if (changed) {
    try {
      firebaseDbRequest_('permissions', 'put', existing, idToken);
    } catch (err) {
      // Read-only caller — proceed with in-memory defaults for this call.
    }
  }
  return existing;
}

function moduleHasCapability_(idToken, moduleId, capability, roleId) {
  const permissions = ensurePermissionsSeeded_(idToken);
  const modulePerm = permissions[moduleId] || {};
  return (modulePerm[capability] || []).includes(roleId);
}

function getRoles(idToken) {
  requireUser_(idToken);
  const roles = ensureRolesSeeded_(idToken);
  return Object.keys(roles).map(id => Object.assign({ RoleID: id }, roles[id]));
}

function getModuleRegistry(idToken) {
  requireUser_(idToken);
  return MODULE_REGISTRY;
}

function getModulePermissionsForUser(idToken, moduleId) {
  const user = requireUser_(idToken);
  const id = String(moduleId || '').trim().toUpperCase();
  return {
    canDraft: moduleHasCapability_(idToken, id, 'draft', user.profile.role),
    canPost: moduleHasCapability_(idToken, id, 'post', user.profile.role)
  };
}

function saveRole(idToken, roleData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ROLES', 'write', user.profile.role)) {
      throw new Error('You do not have permission to manage roles.');
    }

    const roleId = String(roleData.RoleID || '').trim();
    const name = String(roleData.Name || '').trim();
    const description = String(roleData.Description || '').trim();
    if (!name) throw new Error('Role name is required.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (roleId) {
      const existing = firebaseDbRequest_('roles/' + roleId, 'get', null, idToken);
      if (!existing) throw new Error('Role not found.');
      firebaseDbRequest_('roles/' + roleId, 'patch', {
        Name: name, Description: description, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, roleId: roleId };
    }

    const newId = 'ROLE-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('roles/' + newId, 'put', {
      Name: name, Description: description,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, roleId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteRole(idToken, roleId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ROLES', 'write', user.profile.role)) {
      throw new Error('You do not have permission to manage roles.');
    }

    const users = firebaseDbRequest_('users', 'get', null, idToken) || {};
    const inUse = Object.values(users).some(u => u.role === roleId);
    if (inUse) throw new Error('This role is assigned to one or more users. Reassign them first.');

    const permissions = ensurePermissionsSeeded_(idToken);
    ['ROLES', 'USERMGMT'].forEach(moduleId => {
      const writers = (permissions[moduleId] && permissions[moduleId].write) || [];
      if (writers.includes(roleId) && writers.length <= 1) {
        throw new Error('Cannot delete this role — it is the only role that can manage ' + moduleId + '. Grant that permission to another role first.');
      }
    });

    firebaseDbRequest_('roles/' + roleId, 'delete', null, idToken);

    // Clean up dangling references so the matrix and tree don't silently
    // reference a role that no longer exists.
    let permissionsChanged = false;
    Object.keys(permissions).forEach(moduleId => {
      Object.keys(permissions[moduleId]).forEach(capability => {
        const idx = permissions[moduleId][capability].indexOf(roleId);
        if (idx !== -1) { permissions[moduleId][capability].splice(idx, 1); permissionsChanged = true; }
      });
    });
    if (permissionsChanged) firebaseDbRequest_('permissions', 'put', permissions, idToken);

    const treeNodes = firebaseDbRequest_('tree', 'get', null, idToken) || {};
    let treeChanged = false;
    Object.keys(treeNodes).forEach(nodeId => {
      const idx = (treeNodes[nodeId].AllowedRoles || []).indexOf(roleId);
      if (idx !== -1) { treeNodes[nodeId].AllowedRoles.splice(idx, 1); treeChanged = true; }
    });
    if (treeChanged) firebaseDbRequest_('tree', 'put', treeNodes, idToken);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getModulePermissionsMatrix(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'ROLES', 'access', user.profile.role)) {
    throw new Error('You do not have access to Roles & Permissions.');
  }
  return {
    modules: MODULE_REGISTRY,
    permissions: ensurePermissionsSeeded_(idToken)
  };
}

// Kept as a general-purpose single-module update utility, but no
// longer the save path the Roles & Permissions screen actually uses —
// see saveAllModulePermissions below for why.
function saveModulePermissions(idToken, moduleId, permissionsForModule) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ROLES', 'write', user.profile.role)) {
      throw new Error('You do not have permission to manage roles.');
    }

    const id = String(moduleId || '').trim().toUpperCase();
    const moduleDef = MODULE_REGISTRY.find(m => m.id === id);
    if (!moduleDef) throw new Error('Unknown module: ' + moduleId);

    if ((id === 'ROLES' || id === 'USERMGMT') && (!permissionsForModule.write || !permissionsForModule.write.length)) {
      throw new Error('At least one role must keep write access to ' + id + ' to avoid locking everyone out.');
    }

    const cleaned = {};
    moduleDef.capabilities.forEach(cap => {
      cleaned[cap] = Array.isArray(permissionsForModule[cap]) ? permissionsForModule[cap] : [];
    });

    firebaseDbRequest_('permissions/' + id, 'put', cleaned, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// The actual save path the Roles & Permissions screen uses. Saving used
// to call saveModulePermissions once PER MODULE, sequentially — with
// 30+ modules now registered, that meant 30+ separate round-trips to
// Apps Script (each one its own Firebase call), one after another. This
// is the actual fix for that reported slowness: every module's
// permissions arrive in ONE call and get written in ONE Firebase
// request (a single put at the /permissions root, which every module's
// entry lives under), not one request per module.
//
// Validates EVERY module before writing anything — if any one module
// fails validation (e.g. the ROLES/USERMGMT lockout guard), nothing is
// written at all, rather than partially applying whatever came before
// the invalid entry. That's a genuine behavior change from the old
// per-module loop, which could save some modules successfully and then
// hit an error partway through, leaving the permission set in a
// half-updated state — this version is all-or-nothing instead.
function saveAllModulePermissions(idToken, allPermissions) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ROLES', 'write', user.profile.role)) {
      throw new Error('You do not have permission to manage roles.');
    }

    const cleaned = {};
    Object.keys(allPermissions || {}).forEach(rawId => {
      const id = String(rawId || '').trim().toUpperCase();
      const moduleDef = MODULE_REGISTRY.find(m => m.id === id);
      if (!moduleDef) throw new Error('Unknown module: ' + rawId);

      const permissionsForModule = allPermissions[rawId] || {};
      if ((id === 'ROLES' || id === 'USERMGMT') && (!permissionsForModule.write || !permissionsForModule.write.length)) {
        throw new Error('At least one role must keep write access to ' + id + ' to avoid locking everyone out.');
      }

      cleaned[id] = {};
      moduleDef.capabilities.forEach(cap => {
        cleaned[id][cap] = Array.isArray(permissionsForModule[cap]) ? permissionsForModule[cap] : [];
      });
    });

    firebaseDbRequest_('permissions', 'put', cleaned, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- USER MANAGEMENT ----------

function getAllFirebaseUsers(idToken) {
  requireAdmin_(idToken);

  const users = firebaseDbRequest_('users', 'get', null, idToken) || [];

  return Object.keys(users).map(uid => ({
    id: uid,
    username: users[uid].username || '',
    email: users[uid].email || '',
    fullName: users[uid].fullName || '',
    role: users[uid].role || 'VIEWER',
    status: users[uid].status || 'Active',
    lastLogin: users[uid].lastLogin || 'Never',
    assignedCompanies: Array.isArray(users[uid].AssignedCompanies) ? users[uid].AssignedCompanies : []
  }));
}

function saveFirebaseUser(idToken, userData) {
  try {
    requireAdmin_(idToken);

    const id = String(userData.id || '').trim();
    const username = String(userData.username || '').trim();
    const email = String(userData.email || '').trim().toLowerCase();
    const fullName = String(userData.fullName || '').trim();
    const role = String(userData.role || 'VIEWER').trim();
    const status = String(userData.status || 'Active').trim();
    const password = String(userData.password || '');
    const assignedCompanies = Array.isArray(userData.assignedCompanies)
      ? userData.assignedCompanies.map(c => String(c).trim()).filter(Boolean)
      : [];

    if (!username || !fullName) {
      throw new Error('Username and full name are required.');
    }

    const roles = ensureRolesSeeded_(idToken);
    if (!roles[role]) throw new Error('Unknown role: ' + role);

    if (!id) {
      if (!email) throw new Error('Email is required for a new Firebase account.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');

      const authUser = firebaseAuthRequest_('accounts:signUp', {
        email: email,
        password: password,
        returnSecureToken: true
      });

      firebaseDbRequest_(
        `users/${authUser.localId}`,
        'put',
        {
          username: username,
          email: email,
          fullName: fullName,
          role: role,
          status: status,
          lastLogin: 'Never',
          createdAt: new Date().toISOString(),
          AssignedCompanies: assignedCompanies
        },
        idToken
      );
    } else {
      firebaseDbRequest_(
        `users/${id}`,
        'patch',
        {
          fullName: fullName,
          role: role,
          status: status,
          updatedAt: new Date().toISOString(),
          AssignedCompanies: assignedCompanies
        },
        idToken
      );
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteFirebaseUser(idToken, userId) {
  try {
    const admin = requireAdmin_(idToken);

    if (admin.uid === userId) {
      throw new Error('You cannot delete your own administrator profile.');
    }

    // Removes ERP access only. The Firebase Auth account remains until
    // removed separately in the Firebase Authentication console.
    firebaseDbRequest_(`users/${userId}`, 'delete', null, idToken);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// MODULE TREE & NAVIGATION (fully replaces the old "Tree" sheet)
// ============================================================
// Storage: Firebase RTDB, /tree/{nodeId} ->
//   { Text, ParentID, Order, ModuleID, AllowedRoles: [roleId,...], ... }
//
// A node is visible to a role only if BOTH the node itself and every
// ancestor up the chain allow that role — hiding a parent hides its
// whole subtree, which is the behavior an admin editing this expects.
//
// The flat seed list below (TREE_SEED_NODES) mirrors the full original
// hierarchy you provided, plus: your JV rename, the CBT leaf (placed
// under Financial Accounting > Bank & Cash Ledger — move it in the Tree
// screen if you had it elsewhere), and two new leaves for this build:
// "ERP Module Tree & Navigation Management" (section 8) and "Roles &
// Permissions Management" (section 11). This seed only ever runs once,
// when /tree is empty — after that, the Tree Management screen is the
// only thing that touches this data.
const TREE_SEED_NODES = [
  { text: 'FINANCIAL MANAGEMENT & ACCOUNTING (FIN)', depth: 0 },
  { text: 'Financial Accounting (FI)', depth: 1 },
  { text: 'General Ledger (FI-GL)', depth: 2 },
  { text: 'Chart of Accounts (COA) Management', depth: 3, moduleId: 'COA' },
  { text: 'Parallel Accounting & Multi-Ledger Framework', depth: 3 },
  { text: 'Journal Entry Processing (JV)', depth: 3, moduleId: 'JV' },
  { text: 'Period-End Closing & Financial Statements', depth: 3 },
  { text: 'Accounts Payable (FI-AP)', depth: 2 },
  { text: 'Vendor Master Data & Evaluation', depth: 3 },
  { text: 'Invoice Processing & Automated Matching (3-Way Match)', depth: 3 },
  { text: 'Automatic Payment Program (APP)', depth: 3 },
  { text: 'Vendor Ledger & Down Payment Handling', depth: 3 },
  { text: 'Accounts Receivable (FI-AR)', depth: 2 },
  { text: 'Customer Master Data & Credit Limits', depth: 3 },
  { text: 'Customer Invoicing & Billing Integration', depth: 3 },
  { text: 'Cash Application & Incoming Payments', depth: 3 },
  { text: 'Dunning & Dispute Management', depth: 3 },
  { text: 'Asset Accounting (FI-AA)', depth: 2 },
  { text: 'Capital Asset Master Management', depth: 3 },
  { text: 'Asset Acquisition & Capital Work-in-Progress (CWIP)', depth: 3 },
  { text: 'Multi-GAAP Depreciation Calculation Engine', depth: 3 },
  { text: 'Asset Retirement, Transfer & Impairment', depth: 3 },
  { text: 'Bank & Cash Ledger (FI-BL)', depth: 2 },
  { text: 'Bank Account Management (BAM)', depth: 3 },
  { text: 'Cash and Bank Transactions (CBT)', depth: 3, moduleId: 'CBT' },
  { text: 'Electronic Funds Transfer (EFT) Processing', depth: 3 },
  { text: 'Electronic Bank Statement (EBS) Reconciliation', depth: 3 },
  { text: 'Financial Controlling & Managerial Accounting (CO)', depth: 1 },
  { text: 'Cost Center Accounting (CO-OM-CCA)', depth: 2 },
  { text: 'Cost Center Planning & Budgeting', depth: 3 },
  { text: 'Overhead Cost Allocation & Assessment', depth: 3 },
  { text: 'Activity Type Planning & Price Calculation', depth: 3 },
  { text: 'Internal Orders (CO-OM-OPA)', depth: 2 },
  { text: 'Overhead Order Tracking', depth: 3 },
  { text: 'Investment Order Budgeting', depth: 3 },
  { text: 'Order Settlement to G/L or Fixed Assets', depth: 3 },
  { text: 'Product Costing (CO-PC)', depth: 2 },
  { text: 'Product Cost Planning (BOM & Routing Costing)', depth: 3 },
  { text: 'Cost Object Controlling (Make-to-Stock / Make-to-Order)', depth: 3 },
  { text: 'Actual Costing & Material Ledger (Revaluation at Actuals)', depth: 3 },
  { text: 'Profitability Analysis (CO-PA)', depth: 2 },
  { text: 'Margin Analysis (Account-Based)', depth: 3 },
  { text: 'Costing-Based Profitability Analysis', depth: 3 },
  { text: 'Customer, Product Line & Market Segment Evaluation', depth: 3 },
  { text: 'Profit Center Accounting (EC-PCA)', depth: 2 },
  { text: 'Strategic Business Unit (SBU) Reporting', depth: 3 },
  { text: 'Balance Sheet / Income Statement by Profit Center', depth: 3 },
  { text: 'Treasury & Financial Risk Management (TRM)', depth: 1 },
  { text: 'Cash & Liquidity Management (Cash Forecasting & Position)', depth: 2 },
  { text: 'Treasury Management (Debt, Investment & Derivatives)', depth: 2 },
  { text: 'Financial Risk Management (Foreign Exchange & Interest Rate Risk)', depth: 2 },
  { text: 'In-House Cash (IHC - Internal Banking & Netting)', depth: 2 },

  { text: 'SUPPLY CHAIN & LOGISTICS MANAGEMENT (SCM)', depth: 0 },
  { text: 'Materials Management & Procurement (MM)', depth: 1 },
  { text: 'Purchasing & Strategic Sourcing (MM-PUR)', depth: 2 },
  { text: 'Purchase Requisitions (PR) & Approval Workflows', depth: 3 },
  { text: 'Request for Quotation (RFQ) & Vendor Comparison', depth: 3 },
  { text: 'Purchase Order (PO) Processing & Release Strategies', depth: 3 },
  { text: 'Outline Agreements (Contracts & Scheduling Agreements)', depth: 3 },
  { text: 'Inventory Management (MM-IM)', depth: 2 },
  { text: 'Goods Receipt (GR) & Goods Issue (GI)', depth: 3 },
  { text: 'Transfer Postings & Stock Transfers', depth: 3 },
  { text: 'Batch Management & Serial Number Tracking', depth: 3 },
  { text: 'Physical Inventory Counting & Adjustments', depth: 3 },
  { text: 'Logistics Invoice Verification (MM-LIV)', depth: 2 },
  { text: 'Invoice Verification & Variance Park/Post', depth: 3 },
  { text: 'Evaluated Receipt Settlement (ERS)', depth: 3 },
  { text: 'Service Procurement (MM-SRV)', depth: 2 },
  { text: 'Service Master & Specifications', depth: 3 },
  { text: 'Service Entry Sheet (SES) Creation & Acceptance', depth: 3 },
  { text: 'Extended Warehouse Management (EWM)', depth: 1 },
  { text: 'Inbound Processing (Unloading, Deconsolidation, Putaway)', depth: 2 },
  { text: 'Outbound Processing (Wave Management, Picking, Packing, Staging)', depth: 2 },
  { text: 'Internal Warehouse Operations (Stock Relocation, Slotting, Rearrangement)', depth: 2 },
  { text: 'Yard Management (Truck Arrival, Parking, Dock Scheduling)', depth: 2 },
  { text: 'Labor Management & Value-Added Services (VAS)', depth: 2 },
  { text: 'Transportation Management (TM)', depth: 1 },
  { text: 'Order Management & Freight Demand Capture', depth: 2 },
  { text: 'Transportation Planning & Load Optimization', depth: 2 },
  { text: 'Freight Execution & Carrier Tracking', depth: 2 },
  { text: 'Freight Cost Calculation, Settlement & Invoicing', depth: 2 },

  { text: 'SALES & CUSTOMER RELATIONSHIP MANAGEMENT (SD / CRM)', depth: 0 },
  { text: 'Sales & Distribution (SD)', depth: 1 },
  { text: 'Pre-Sales Activities', depth: 2 },
  { text: 'Lead Tracking', depth: 3 },
  { text: 'Inquiries', depth: 3 },
  { text: 'Quotations', depth: 3 },
  { text: 'Sales Order Management (SD-SLS)', depth: 2 },
  { text: 'Order Entry, Contract Management & Backorder Handling', depth: 3 },
  { text: 'Available-to-Promise (ATP / Advanced ATP Check)', depth: 3 },
  { text: 'Pricing & Revenue Management (SD-BF-PR)', depth: 2 },
  { text: 'Condition Technique, Discounts, & Surcharges', depth: 3 },
  { text: 'Tax Determination & Rebate/Accrual Agreements', depth: 3 },
  { text: 'Shipping & Delivery Processing (SD-SHP)', depth: 2 },
  { text: 'Outbound Delivery Creation & Picking Lists', depth: 3 },
  { text: 'Packing (Handling Units) & Goods Issue Posting', depth: 3 },
  { text: 'Billing & Revenue Recognition (SD-BIL)', depth: 2 },
  { text: 'Standard Invoicing, Credit/Debit Memos', depth: 3 },
  { text: 'Revenue Recognition (IFRS 15 / ASC 606 Compliance)', depth: 3 },
  { text: 'Customer Experience & CRM Solutions', depth: 1 },
  { text: 'Lead & Opportunity Management', depth: 2 },
  { text: 'Omnichannel Customer Service & Field Service Management', depth: 2 },
  { text: 'Partner Relationship Management (PRM)', depth: 2 },

  { text: 'MANUFACTURING & PRODUCTION MANAGEMENT (PP)', depth: 0 },
  { text: 'Production Planning & Control (PP)', depth: 1 },
  { text: 'Master Data (Bills of Materials - BOM, Work Centers, Routings)', depth: 2 },
  { text: 'Demand Management & Sales Operations Planning (S&OP)', depth: 2 },
  { text: 'Master Production Scheduling (MPS)', depth: 2 },
  { text: 'Material Requirements Planning (MRP Live)', depth: 2 },
  { text: 'Shop Floor Control & Production Execution (PP-SFC)', depth: 1 },
  { text: 'Production Order / Process Order Creation & Release', depth: 2 },
  { text: 'Material Staging & Goods Issue to Production', depth: 2 },
  { text: 'Operations Confirmation (Labor, Machine, Output Tracking)', depth: 2 },
  { text: 'Finished Goods Receipt & Order Settlement', depth: 2 },
  { text: 'Specialized Production Types', depth: 1 },
  { text: 'Repetitive Manufacturing (REM)', depth: 2 },
  { text: 'Process Manufacturing (PP-PI - Batch Processing & Recipes)', depth: 2 },
  { text: 'Kanban & Lean Production Control', depth: 2 },
  { text: 'Integrated Business Planning (IBP)', depth: 1 },
  { text: 'Demand Sensing & Forecasting', depth: 2 },
  { text: 'Supply & Response Management', depth: 2 },
  { text: 'Inventory Optimization Engine', depth: 2 },

  { text: 'ASSET & QUALITY MANAGEMENT', depth: 0 },
  { text: 'Plant Maintenance / Enterprise Asset Management (PM / EAM)', depth: 1 },
  { text: 'Technical Structure (Functional Locations & Equipment Master)', depth: 2 },
  { text: 'Preventive Maintenance (Maintenance Plans & Task Lists)', depth: 2 },
  { text: 'Corrective Maintenance (Notifications & Maintenance Orders)', depth: 2 },
  { text: 'Calibration & Condition-Based Predictive Maintenance', depth: 2 },
  { text: 'Quality Management (QM)', depth: 1 },
  { text: 'Quality Planning (Inspection Plans & Inspection Characteristics)', depth: 2 },
  { text: 'Quality Inspection (Goods Receipt Inspection, In-Process, Final Inspection)', depth: 2 },
  { text: 'Quality Certificates & Certificate of Analysis (CoA)', depth: 2 },
  { text: 'Quality Control & Quality Notifications (CAPA - Corrective & Preventive Action)', depth: 2 },

  { text: 'PROJECT SYSTEM & CAPITAL EXECUTION (PS)', depth: 0 },
  { text: 'Project Structuring (Work Breakdown Structure - WBS & Network Activities)', depth: 1 },
  { text: 'Project Planning (Time Scheduling, Resource Allocation, Cost Estimation)', depth: 1 },
  { text: 'Project Budgeting (Original Budget, Release, Transfers, Supplements)', depth: 1 },
  { text: 'Project Execution (Time Sheet Recording, Procurement Integration, Progress Tracking)', depth: 1 },
  { text: 'Project Period-End Closing (Progress Analysis, Work-in-Progress - WIP, Settlement)', depth: 1 },

  { text: 'HUMAN CAPITAL MANAGEMENT (HCM)', depth: 0 },
  { text: 'Core Human Resources', depth: 1 },
  { text: 'Personnel Administration (PA - Organizational Assignment, Personal Data)', depth: 2 },
  { text: 'Organizational Management (OM - Organizational Units, Jobs, Positions)', depth: 2 },
  { text: 'Time & Attendance Management (Work Schedules, Time Recording, Absence Tracking)', depth: 2 },
  { text: 'Payroll Accounting (Gross-to-Net Processing, Taxing, Direct Deposit)', depth: 2 },
  { text: 'Talent & Employee Lifecycle Management', depth: 1 },
  { text: 'Talent Acquisition & Onboarding', depth: 2 },
  { text: 'Performance & Goal Management', depth: 2 },
  { text: 'Learning Management & Training Administration', depth: 2 },
  { text: 'Compensation & Succession Planning', depth: 2 },

  { text: 'BACKEND APPLICATION & DEVELOPMENT LAYER', depth: 0 },
  { text: 'User Interface & Presentation Layer', depth: 1 },
  { text: 'Fiori App Ecosystem (Role-Based HTML5/UI5 User Interface)', depth: 2 },
  { text: 'Desktop Graphical User Interface (GUI)', depth: 2 },
  { text: 'Screen Persona & Mobile App Frameworks', depth: 2 },
  { text: 'ERP Module Tree & Navigation Management', depth: 2, moduleId: 'TREEMGMT' },
  { text: 'Core Application Programming Framework', depth: 1 },
  { text: 'Data Modeling Layer (Core Data Services - CDS Views)', depth: 2 },
  { text: 'Database Execution Layer (Managed Database Procedures - AMDP / SQLScript)', depth: 2 },
  { text: 'Business Object Framework (RESTful Application Programming Model - RAP / BOPF)', depth: 2 },
  { text: 'API & Communication Layer (OData Services, REST, SOAP APIs)', depth: 2 },
  { text: 'Cloud Extension & Integration Infrastructure', depth: 1 },
  { text: 'Enterprise Integration Platform (Process Orchestration & Integration)', depth: 2 },
  { text: 'Extensibility Suite (Side-by-Side Custom App Extensions & Microservices)', depth: 2 },

  { text: 'IN-MEMORY DATABASE ENGINE & SERVER CORE (Backend Architecture)', depth: 0 },
  { text: 'Core Database Service Processes', depth: 1 },
  { text: 'Index Server (Primary engine for SQL processing, SQLScript, and data storage)', depth: 2 },
  { text: 'Name Server (Holds cluster topology information, maps active nodes)', depth: 2 },
  { text: 'Preprocessor Server (Text extraction, tokenization, and linguistic analysis)', depth: 2 },
  { text: 'Compile Server (JIT compilation of SQLScript procedures into C++ execution code)', depth: 2 },
  { text: 'Web Dispatcher (Handles incoming HTTP/HTTPS traffic routing)', depth: 2 },
  { text: 'Storage & Memory Management Architecture', depth: 1 },
  { text: 'Column-Oriented Store (Primary store for fast vector processing and high compression)', depth: 2 },
  { text: 'Row-Oriented Store (Used for metadata, transaction locks, and operational configuration)', depth: 2 },
  { text: 'Main Memory Area (Read-optimized, dictionary-compressed active storage)', depth: 2 },
  { text: 'Delta Memory Area (Write-optimized, uncompressed buffer for rapid real-time inserts)', depth: 2 },
  { text: 'Delta Merge Engine (Asynchronous process merging Delta buffer into Main Store)', depth: 2 },
  { text: 'Persistence Layer (Disk-based Data Volumes & Log Volumes for point-in-time recovery)', depth: 2 },
  { text: 'Specialized Native Analytical Processing Engines', depth: 1 },
  { text: 'Calculation Engine (Executes multi-dimensional joins, aggregations, and views)', depth: 2 },
  { text: 'Spatial Engine (Geographical coordinate processing & GIS vector analytics)', depth: 2 },
  { text: 'Graph Engine (Network topology, pathfinding, and node relationship analysis)', depth: 2 },
  { text: 'Text & Search Engine (Full-text search, fuzzy search, sentiment analysis)', depth: 2 },
  { text: 'Machine Learning Libraries (Predictive Analytics Library - PAL & Application Function Library - AFL)', depth: 2 },

  { text: 'ENTERPRISE DATA WAREHOUSING & ANALYTICS', depth: 0 },
  { text: 'Enterprise Data Warehousing (EDW)', depth: 1 },
  { text: 'Advanced Data Store Objects (ADSO) & Composite Providers', depth: 2 },
  { text: 'Real-time Data Extraction (CDC - Change Data Capture)', depth: 2 },
  { text: 'Data Tiering Optimization (Hot, Warm, Cold Data Lifecycle Management)', depth: 2 },
  { text: 'Cloud Analytics & Business Intelligence', depth: 1 },
  { text: 'Executive Dashboards & Dynamic KPI Reporting', depth: 2 },
  { text: 'Enterprise Financial Planning & Budget Modeling', depth: 2 },
  { text: 'Predictive Forecasting Engines', depth: 2 },
  { text: 'Embedded Real-Time Operational Analytics', depth: 1 },
  { text: 'Live Transactional Reporting (Direct Execution on Core CDS Views)', depth: 2 },
  { text: 'Operational KPIs & Smart Alerting Indicators', depth: 2 },

  { text: 'SYSTEM ADMIN', depth: 0 },
  { text: 'User Management', depth: 1, moduleId: 'USERMGMT' },
  { text: 'Security & Access Control', depth: 1 },
  { text: 'Roles & Permissions Management', depth: 1, moduleId: 'ROLES' },
  { text: 'System Health & Maintenance', depth: 1 },
  { text: 'Configuration & Data Management', depth: 1 }
];

function ensureTreeSeeded_(idToken) {
  const existing = firebaseDbRequest_('tree', 'get', null, idToken);
  if (existing && Object.keys(existing).length) return existing;

  const records = {};
  const stack = [];
  let order = 0;
  const now = new Date().toISOString();

  TREE_SEED_NODES.forEach(node => {
    const nodeId = 'NODE-' + Utilities.getUuid().split('-')[0].toUpperCase();
    const parentId = node.depth > 0 ? (stack[node.depth - 1] || '') : '';
    const allowedRoles = ['USERMGMT', 'TREEMGMT', 'ROLES'].includes(node.moduleId)
      ? ['ADMIN']
      : ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'];

    records[nodeId] = {
      Text: node.text,
      ParentID: parentId,
      Order: order++,
      ModuleID: node.moduleId || '',
      AllowedRoles: allowedRoles,
      CreatedAt: now, CreatedBy: 'SYSTEM',
      UpdatedAt: now, UpdatedBy: 'SYSTEM'
    };
    stack[node.depth] = nodeId;
    stack.length = node.depth + 1;
  });

  try {
    firebaseDbRequest_('tree', 'put', records, idToken);
  } catch (err) {
    // Read-only caller — proceed with in-memory seed for this call only;
    // it will persist on a writer's next visit.
  }
  return records;
}

// Depth-first flatten of visible nodes only, sorted by Order within each
// parent. A node is visible only if it AND every ancestor allow the role.
function buildVisibleTreeList_(nodesById, roleId) {
  const childrenByParent = {};
  Object.keys(nodesById).forEach(id => {
    const parent = nodesById[id].ParentID || '';
    if (!childrenByParent[parent]) childrenByParent[parent] = [];
    childrenByParent[parent].push(id);
  });
  Object.keys(childrenByParent).forEach(parent => {
    childrenByParent[parent].sort((a, b) => (nodesById[a].Order || 0) - (nodesById[b].Order || 0));
  });

  const result = [];
  function walk(parentId, depth, ancestorVisible) {
    (childrenByParent[parentId] || []).forEach(id => {
      const node = nodesById[id];
      const ownAllowed = (node.AllowedRoles || []).includes(roleId);
      const visible = ancestorVisible && ownAllowed;
      if (visible) {
        result.push({ text: node.Text, depth: depth, moduleId: node.ModuleID || '' });
      }
      walk(id, depth + 1, visible);
    });
  }
  walk('', 0, true);
  return result;
}

function buildTreeForRole_(idToken, roleId) {
  let nodes = firebaseDbRequest_('tree', 'get', null, idToken);
  if (!nodes || !Object.keys(nodes).length) nodes = ensureTreeSeeded_(idToken);
  return buildVisibleTreeList_(nodes, roleId);
}

// Public entry point for the home-screen Refresh action — re-fetches and
// re-filters the nav tree for the current user without a full logout/login.
function getMyTree(idToken) {
  const user = requireUser_(idToken);
  return buildTreeForRole_(idToken, user.profile.role);
}

function getTreeNodes(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'TREEMGMT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Module Tree & Navigation Management.');
  }
  let nodes = firebaseDbRequest_('tree', 'get', null, idToken);
  if (!nodes || !Object.keys(nodes).length) nodes = ensureTreeSeeded_(idToken);
  return Object.keys(nodes).map(id => Object.assign({ NodeID: id }, nodes[id]));
}

function saveTreeNode(idToken, nodeData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'TREEMGMT', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify the module tree.');
    }

    const nodeId = String(nodeData.NodeID || '').trim();
    const text = String(nodeData.Text || '').trim();
    const parentId = String(nodeData.ParentID || '').trim();
    const moduleId = String(nodeData.ModuleID || '').trim().toUpperCase();
    const allowedRoles = Array.isArray(nodeData.AllowedRoles) ? nodeData.AllowedRoles : [];

    if (!text) throw new Error('Item text is required.');
    if (moduleId && !MODULE_REGISTRY.some(m => m.id === moduleId)) {
      throw new Error('Unknown module: ' + moduleId);
    }
    if (nodeId && parentId === nodeId) {
      throw new Error('An item cannot be its own parent.');
    }

    const existingAll = firebaseDbRequest_('tree', 'get', null, idToken) || {};

    if (parentId && !existingAll[parentId]) {
      throw new Error('Parent item not found.');
    }
    if (nodeId && parentId) {
      let walkId = parentId;
      while (walkId) {
        if (walkId === nodeId) throw new Error('Cannot move an item under one of its own descendants.');
        walkId = existingAll[walkId] ? existingAll[walkId].ParentID : '';
      }
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (nodeId) {
      if (!existingAll[nodeId]) throw new Error('Item not found.');
      firebaseDbRequest_('tree/' + nodeId, 'patch', {
        Text: text, ParentID: parentId, ModuleID: moduleId, AllowedRoles: allowedRoles,
        UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, nodeId: nodeId };
    }

    const siblingOrders = Object.values(existingAll)
      .filter(n => (n.ParentID || '') === parentId)
      .map(n => n.Order || 0);
    const nextOrder = siblingOrders.length ? Math.max.apply(null, siblingOrders) + 1 : 0;

    const newId = 'NODE-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('tree/' + newId, 'put', {
      Text: text, ParentID: parentId, Order: nextOrder, ModuleID: moduleId, AllowedRoles: allowedRoles,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, nodeId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteTreeNode(idToken, nodeId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'TREEMGMT', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify the module tree.');
    }

    const existingAll = firebaseDbRequest_('tree', 'get', null, idToken) || {};
    if (!existingAll[nodeId]) throw new Error('Item not found.');

    const hasChildren = Object.values(existingAll).some(n => n.ParentID === nodeId);
    if (hasChildren) throw new Error('This item has sub-items. Delete or move them first.');

    firebaseDbRequest_('tree/' + nodeId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Repositions draggedNodeId as the previous/next sibling of targetNodeId
// (position: 'before' | 'after'), adopting the target's parent — this is
// what makes dropping onto an item under a different parent a re-parent,
// not just a same-list reorder. Reindexes affected siblings in one
// atomic Firebase multi-path update.
function moveTreeNode(idToken, draggedNodeId, targetNodeId, position) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'TREEMGMT', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify the module tree.');
    }

    const existingAll = firebaseDbRequest_('tree', 'get', null, idToken) || {};
    const dragged = existingAll[draggedNodeId];
    const target = existingAll[targetNodeId];
    if (!dragged || !target) throw new Error('Item not found.');
    if (draggedNodeId === targetNodeId) return { success: true };

    let walkId = target.ParentID;
    while (walkId) {
      if (walkId === draggedNodeId) throw new Error('Cannot move an item under one of its own descendants.');
      walkId = existingAll[walkId] ? existingAll[walkId].ParentID : '';
    }

    const newParentId = target.ParentID || '';
    const siblings = Object.keys(existingAll)
      .filter(id => (existingAll[id].ParentID || '') === newParentId && id !== draggedNodeId)
      .sort((a, b) => (existingAll[a].Order || 0) - (existingAll[b].Order || 0));

    const targetIndex = siblings.indexOf(targetNodeId);
    const insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
    siblings.splice(insertAt, 0, draggedNodeId);

    const updates = {};
    siblings.forEach((id, i) => {
      updates['tree/' + id + '/Order'] = i;
      if (id === draggedNodeId) updates['tree/' + id + '/ParentID'] = newParentId;
    });

    firebaseDbRequest_('', 'patch', updates, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- MODULE LOADING (lazy, permission-gated) ----------
// A module's markup/JS is only ever sent to the browser after both
// (a) a valid session is confirmed and (b) the user's role is checked
// against the live Firebase permissions matrix. This is deliberate:
// injecting all module HTML into the page up front and hiding it
// client-side would leak every module's structure to users who can't
// open it.

function getModuleFragment(idToken, moduleId) {
  const user = requireUser_(idToken);
  const id = String(moduleId || '').trim().toUpperCase();
  const moduleDef = MODULE_REGISTRY.find(m => m.id === id);

  if (!moduleDef) {
    throw new Error('Unknown module: ' + moduleId);
  }
  if (!moduleHasCapability_(idToken, id, 'access', user.profile.role)) {
    throw new Error('You do not have access to this module.');
  }

  let html;
  try {
    html = HtmlService.createHtmlOutputFromFile(id).getContent();
  } catch (err) {
    throw new Error('Module "' + id + '" has no fragment file yet.');
  }

  const canWrite = moduleDef.capabilities.includes('write') && moduleHasCapability_(idToken, id, 'write', user.profile.role);

  return { html: html, canWrite: canWrite };
}

function requireModuleWrite_(idToken, user, moduleId) {
  if (!moduleHasCapability_(idToken, moduleId, 'write', user.profile.role)) {
    throw new Error('You do not have permission to modify ' + moduleId + '.');
  }
}

// ============================================================
// CHART OF ACCOUNTS (COA) — Firebase-backed
// ============================================================
// Master data — not a transactional ledger. Direct CRUD here is
// appropriate; this is NOT one of the five write-only ledgers
// (GL/Inventory/VAT/AR/AP) that must only ever be written by
// AccountingEngine. COA entries are never hard-deleted: once GL
// exists, a code could already be referenced by journal lines, so
// deactivation (soft delete) is the only removal path.
//
// Storage: Firebase RTDB, path /coa/{accountId}. Make sure your RTDB
// security rules require auth != null (or a role-based rule) — every
// write here is also gated in Apps Script, but if the rules are open,
// that gate can be bypassed entirely by hitting the REST endpoint
// directly with any valid Firebase Auth token.
//
// Account code scheme (system-generated, immutable once assigned), 6 digits:
//   digit 1        = category   (1 Asset, 2 Liability, 3 Equity,
//                                 4 Revenue, 5 COGS, 6 Expense)
//   digit 2        = sub-category, auto-assigned 0-9, code ends "0000"
//   digits 3-6     = sequential leaf number under a sub-category header
//                    (e.g. 100000 "Cash / Petty Cash" -> 100001 "Cash in Hand")
// This supports exactly two levels below category (sub-category header,
// then leaves), 10 sub-categories per type, 9,999 leaves per sub-category.
// Deeper nesting is not supported by this numbering scheme.

const ACCOUNT_TYPE_CONFIG = {
  Asset:     { digit: '1', normalBalance: 'Debit'  },
  Liability: { digit: '2', normalBalance: 'Credit' },
  Equity:    { digit: '3', normalBalance: 'Credit' },
  Revenue:   { digit: '4', normalBalance: 'Credit' },
  COGS:      { digit: '5', normalBalance: 'Debit'  },
  Expense:   { digit: '6', normalBalance: 'Debit'  }
};

// Fixed reference data — these 16 sub-category headers are seeded into
// Firebase automatically (idempotently) the first time a writer opens
// COA. Codes are exact per the agreed numbering table; do not renumber
// without checking nothing downstream (GL, once built) references them.
//
// cashFlowCategory defaults to a sensible Operating/Financing split for
// the Cash Flow Statement (see CASH FLOW STATEMENT section below). Cash
// and Bank headers themselves are left blank — they're never categorized,
// since they're the "cash" side of the movement, not the "why."
const COA_SUBCATEGORIES = [
  { code: '100000', name: 'Cash / Petty Cash',              type: 'Asset',     cashFlowCategory: '' },
  { code: '110000', name: 'Bank Accounts',                  type: 'Asset',     cashFlowCategory: '' },
  { code: '120000', name: 'Accounts Receivable (Trade)',    type: 'Asset',     cashFlowCategory: 'Operating' },
  { code: '130000', name: 'Inventory',                      type: 'Asset',     cashFlowCategory: 'Operating' },
  { code: '200000', name: 'Accounts Payable (Trade)',       type: 'Liability', cashFlowCategory: 'Operating' },
  { code: '210000', name: 'Short-Term Loans Payable',       type: 'Liability', cashFlowCategory: 'Financing' },
  { code: '220000', name: 'Accrued Liabilities',            type: 'Liability', cashFlowCategory: 'Operating' },
  { code: '300000', name: 'Common Stock / Share Capital',   type: 'Equity',    cashFlowCategory: 'Financing' },
  { code: '310000', name: 'Retained Earnings',              type: 'Equity',    cashFlowCategory: 'Operating' },
  { code: '400000', name: 'Domestic Sales Revenues',        type: 'Revenue',   cashFlowCategory: 'Operating' },
  { code: '410000', name: 'Sales Returns & Discounts',      type: 'Revenue',   cashFlowCategory: 'Operating' },
  { code: '420000', name: 'Interest / Other Income',        type: 'Revenue',   cashFlowCategory: 'Operating' },
  { code: '500000', name: 'Cost of Goods Sold (COGS)',      type: 'COGS',      cashFlowCategory: 'Operating' },
  { code: '510000', name: 'Direct Material Cost',           type: 'COGS',      cashFlowCategory: 'Operating' },
  { code: '600000', name: 'Wages & Salaries Expense',       type: 'Expense',   cashFlowCategory: 'Operating' },
  { code: '610000', name: 'Rent & Facility Expense',        type: 'Expense',   cashFlowCategory: 'Operating' },
  { code: '620000', name: 'Depreciation Expense',           type: 'Expense',   cashFlowCategory: 'Operating' }
];

function getCoaData_(idToken) {
  return firebaseDbRequest_('coa', 'get', null, idToken) || {};
}

function ensureSubCategoriesSeeded_(idToken, existing) {
  const existingCodes = new Set(Object.values(existing).map(a => String(a.AccountCode)));
  const missing = COA_SUBCATEGORIES.filter(sc => !existingCodes.has(sc.code));
  if (!missing.length) return existing;

  const now = new Date().toISOString();
  const updates = {};
  missing.forEach(sc => {
    const id = 'ACC-' + Utilities.getUuid().split('-')[0].toUpperCase();
    updates[id] = {
      AccountCode: sc.code,
      AccountName: sc.name,
      AccountType: sc.type,
      AccountSubType: '',
      NormalBalance: ACCOUNT_TYPE_CONFIG[sc.type].normalBalance,
      CashFlowCategory: sc.cashFlowCategory || '',
      ParentAccountID: '',
      IsPostable: false,
      CompanyID: '',
      Status: 'Active',
      CreatedAt: now, CreatedBy: 'SYSTEM',
      UpdatedAt: now, UpdatedBy: 'SYSTEM'
    };
  });

  try {
    firebaseDbRequest_('coa', 'patch', updates, idToken);
    Object.assign(existing, updates);
  } catch (err) {
    // Read-only role — proceed with what already exists.
  }
  return existing;
}

// Three levels supported: a top-level header (e.g. 220000), an optional
// non-postable SUB-PARENT directly beneath one header (e.g. 221000 —
// digit 3 becomes 1-9, distinguishing it from ordinary leaves), and
// postable leaves under either a header directly (0001-0999, digit 3
// stays 0) or under a sub-parent (221001, 221002, ... — the sub-parent's
// own 4 digits plus a 3-digit sequence). The numbering scheme has no
// room for a further level beneath a sub-parent — see the error thrown
// in that branch below.
function generateAccountCode_(accountType, parentAccountId, existingAccounts, isPostable) {
  const config = ACCOUNT_TYPE_CONFIG[accountType];
  if (!config) throw new Error('Unknown account type: ' + accountType);
  const categoryDigit = config.digit;

  if (!parentAccountId) {
    const used = new Set();
    Object.values(existingAccounts).forEach(a => {
      const code = String(a.AccountCode || '');
      if (code.charAt(0) === categoryDigit && !a.ParentAccountID) {
        used.add(code.charAt(1));
      }
    });
    for (let d = 0; d <= 9; d++) {
      if (!used.has(String(d))) {
        return categoryDigit + String(d) + '0000';
      }
    }
    throw new Error('All 10 sub-category slots for this account type are used.');
  }

  const parent = existingAccounts[parentAccountId];
  if (!parent) throw new Error('Parent account not found.');
  if (parent.IsPostable === true) {
    throw new Error('Parent account must be a non-postable header or sub-parent.');
  }

  const parentCode = String(parent.AccountCode || '');

  // Parent is a top-level header (e.g. 220000).
  if (/^\d{2}0000$/.test(parentCode)) {
    const prefix = parentCode.substring(0, 2);

    if (!isPostable) {
      // Creating a SUB-PARENT under this header — takes the next
      // available "thousand slot" (221000, 222000, ... 229000), kept
      // visually distinct from ordinary leaves (which stay in the
      // 0001-0999 range directly under the header, digit 3 fixed at 0).
      const usedSlots = new Set();
      Object.values(existingAccounts).forEach(a => {
        const code = String(a.AccountCode || '');
        if (code.substring(0, 2) === prefix && /^\d{2}[1-9]000$/.test(code)) {
          usedSlots.add(code.charAt(2));
        }
      });
      for (let d = 1; d <= 9; d++) {
        if (!usedSlots.has(String(d))) {
          return prefix + String(d) + '000';
        }
      }
      throw new Error('All 9 sub-parent slots under this header are used.');
    }

    // Ordinary postable leaf directly under the header — digit 3 stays 0,
    // sequence runs 0001-0999 (capped below 1000 so it can never collide
    // with the X1000-X9000 sub-parent slots above).
    let maxSeq = 0;
    Object.values(existingAccounts).forEach(a => {
      const code = String(a.AccountCode || '');
      if (code.substring(0, 2) === prefix && /^\d{2}0\d{3}$/.test(code)) {
        const seq = parseInt(code.substring(3), 10);
        if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
      }
    });
    const nextSeq = maxSeq + 1;
    if (nextSeq > 999) throw new Error('This header has reached its maximum of 999 directly-postable accounts — consider grouping further accounts under a sub-parent.');
    return prefix + '0' + String(nextSeq).padStart(3, '0');
  }

  // Parent is a sub-parent (e.g. 221000) — its children are always
  // postable leaves; the 6-digit scheme has no digits left for a further
  // level beneath this one.
  if (/^\d{2}[1-9]000$/.test(parentCode)) {
    if (!isPostable) {
      throw new Error('A sub-parent cannot itself have another sub-parent — only one level of grouping is supported beneath a header.');
    }
    const prefix = parentCode.substring(0, 3);
    let maxSeq = 0;
    Object.values(existingAccounts).forEach(a => {
      const code = String(a.AccountCode || '');
      if (code.substring(0, 3) === prefix && code !== parentCode) {
        const seq = parseInt(code.substring(3), 10);
        if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
      }
    });
    const nextSeq = maxSeq + 1;
    if (nextSeq > 999) throw new Error('This sub-parent has reached its maximum of 999 accounts.');
    return prefix + String(nextSeq).padStart(3, '0');
  }

  throw new Error('New accounts can only be created under a top-level header or a sub-parent beneath one.');
}

function getChartOfAccounts(idToken) {
  const user = requireUser_(idToken);

  if (!moduleHasCapability_(idToken, 'COA', 'access', user.profile.role)) {
    throw new Error('You do not have access to Chart of Accounts.');
  }

  let data = getCoaData_(idToken);
  data = ensureSubCategoriesSeeded_(idToken, data);
  return Object.keys(data)
    .map(id => Object.assign({ AccountID: id }, data[id]))
    .filter(a => userCanAccessCompany_(user.profile, a.CompanyID));
}

function saveAccount(idToken, accountData) {
  const user = requireUser_(idToken);

  try {
    requireModuleWrite_(idToken, user, 'COA');
  } catch (err) {
    return { success: false, error: err.message };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const accountId = String(accountData.AccountID || '').trim();
    const accountName = String(accountData.AccountName || '').trim();
    const accountSubType = String(accountData.AccountSubType || '').trim();
    const parentAccountId = String(accountData.ParentAccountID || '').trim();
    const isPostable = accountData.IsPostable === true || accountData.IsPostable === 'true';
    const companyId = String(accountData.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) {
      throw new Error('You do not have access to that company.');
    }
    // Cash Flow Category can only ever be set on a non-postable (header)
    // account — postable leaf accounts always inherit it from their parent
    // at report time (see resolveCashFlowCategory_), so no value is ever
    // stored directly on a leaf, even if one was sent.
    const cashFlowCategory = isPostable ? '' : String(accountData.CashFlowCategory || '').trim();
    const status = String(accountData.Status || 'Active').trim();

    if (cashFlowCategory && !['Operating', 'Investing', 'Financing'].includes(cashFlowCategory)) {
      throw new Error('Cash Flow Category must be Operating, Investing, or Financing.');
    }

    if (!accountName) {
      throw new Error('Account name is required.');
    }

    const existing = getCoaData_(idToken);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (!accountId) {
      const accountType = String(accountData.AccountType || '').trim();
      if (!ACCOUNT_TYPE_CONFIG[accountType]) {
        throw new Error('Account type must be one of: Asset, Liability, Equity, Revenue, COGS, Expense.');
      }

      if (parentAccountId) {
        const parent = existing[parentAccountId];
        if (!parent) throw new Error('Parent account not found.');
        if (parent.AccountType !== accountType) {
          throw new Error('Parent account must be the same account type.');
        }
        if (parent.CompanyID && parent.CompanyID !== companyId) {
          throw new Error('Parent account is restricted to a specific company; this account must belong to the same company.');
        }
      }

      const code = generateAccountCode_(accountType, parentAccountId || null, existing, isPostable);
      const newId = 'ACC-' + Utilities.getUuid().split('-')[0].toUpperCase();

      const record = {
        AccountCode: code,
        AccountName: accountName,
        AccountType: accountType,
        AccountSubType: accountSubType,
        NormalBalance: ACCOUNT_TYPE_CONFIG[accountType].normalBalance,
        ParentAccountID: parentAccountId,
        IsPostable: isPostable,
        CompanyID: companyId,
        CashFlowCategory: cashFlowCategory,
        Status: status,
        CreatedAt: now, CreatedBy: actor,
        UpdatedAt: now, UpdatedBy: actor
      };

      firebaseDbRequest_('coa/' + newId, 'put', record, idToken);
      return { success: true, accountId: newId, accountCode: code };
    }

    const current = existing[accountId];
    if (!current) throw new Error('Account not found.');

    if (parentAccountId) {
      if (parentAccountId === accountId) throw new Error('An account cannot be its own parent.');
      const parent = existing[parentAccountId];
      if (!parent) throw new Error('Parent account not found.');
      if (parent.AccountType !== current.AccountType) {
        throw new Error('Parent account must be the same account type.');
      }
      if (parent.CompanyID && parent.CompanyID !== companyId) {
        throw new Error('Parent account is restricted to a specific company; this account must belong to the same company.');
      }
    }

    const hasChildren = Object.keys(existing).some(id => existing[id].ParentAccountID === accountId);
    if (hasChildren && isPostable) {
      throw new Error('This account has child accounts and cannot be marked postable.');
    }

    // If this becomes company-restricted (or changes company), any existing
    // children must already match — otherwise they'd be orphaned into an
    // inconsistent scope.
    if (companyId) {
      const mismatchedChild = Object.keys(existing).some(id =>
        existing[id].ParentAccountID === accountId && existing[id].CompanyID && existing[id].CompanyID !== companyId
      );
      if (mismatchedChild) {
        throw new Error('This account has child accounts belonging to a different company. Reassign them first.');
      }
    }

    const record = {
      AccountCode: current.AccountCode,
      AccountName: accountName,
      AccountType: current.AccountType,
      AccountSubType: accountSubType,
      NormalBalance: current.NormalBalance,
      ParentAccountID: parentAccountId,
      IsPostable: isPostable,
      CompanyID: companyId,
      CashFlowCategory: cashFlowCategory,
      Status: status,
      CreatedAt: current.CreatedAt, CreatedBy: current.CreatedBy,
      UpdatedAt: now, UpdatedBy: actor
    };

    firebaseDbRequest_('coa/' + accountId, 'put', record, idToken);
    return { success: true, accountId: accountId, accountCode: current.AccountCode };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

function deactivateAccount(idToken, accountId) {
  try {
    const user = requireUser_(idToken);
    requireModuleWrite_(idToken, user, 'COA');

    const existing = getCoaData_(idToken);
    if (!existing[accountId]) throw new Error('Account not found.');

    const hasActiveChildren = Object.keys(existing).some(id =>
      existing[id].ParentAccountID === accountId && existing[id].Status === 'Active'
    );
    if (hasActiveChildren) {
      throw new Error('Deactivate or reassign this account\'s child accounts first.');
    }

    firebaseDbRequest_('coa/' + accountId, 'patch', {
      Status: 'Inactive',
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: user.profile.username || user.uid
    }, idToken);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateAccount(idToken, accountId) {
  try {
    const user = requireUser_(idToken);
    requireModuleWrite_(idToken, user, 'COA');

    const existing = getCoaData_(idToken);
    if (!existing[accountId]) throw new Error('Account not found.');

    firebaseDbRequest_('coa/' + accountId, 'patch', {
      Status: 'Active',
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: user.profile.username || user.uid
    }, idToken);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// JOURNAL ENTRY PROCESSING (JV)
// ============================================================
// This is the GL write path. Per the target architecture, GL is one of
// five ledgers (GL/Inventory/VAT/AR/AP) that must only ever be written
// by a dedicated posting engine — never freely edited like COA. The
// discipline enforced here:
//   - Status "Draft"   -> freely editable/deletable staging data, NOT
//                         yet part of the permanent ledger.
//   - Status "Posted"  -> immutable. postJournalEntry() is the ONLY
//                         function that writes a record into that state,
//                         and it re-validates against live COA data at
//                         the moment of posting (an account could have
//                         been deactivated since the draft was saved).
//   - Status "Reversed" is not a real status change — a posted entry
//                         gets a ReversedByJV pointer, and a brand-new
//                         posted entry with swapped debit/credit is the
//                         only way to undo it. Nothing is ever deleted
//                         or rewritten once posted.
//
// Storage: Firestore, collection 'journalEntries' (see
// FIRESTORE_JOURNAL_ENTRIES_COLLECTION) — one JV header + embedded
// lines per document, ID format unchanged (JVD-XXXXXXXX). Voucher
// numbering itself deliberately stays in RTDB:
//   /gl/counters/{year}        — last-used sequence number per year,
//                                 incremented under LockService
//
// NOTE on fiscal year: JV numbers are scoped by the calendar year of
// the entry date (JV-2026-000001) as a placeholder. Per the target
// architecture, fiscal year is not guaranteed to equal calendar year —
// revisit this numbering once fiscal-year configuration exists.
//
// Permissions for draft/post are per-module now (JV vs CBT each have
// their own entries in /permissions), even though both write into this
// same GL store — moduleIdForEntry_() below determines which one to
// check for a given record, based on whether it has a VoucherType.

function moduleIdForEntry_(record) {
  if (record.VoucherType && CBT_VOUCHER_CONFIG[record.VoucherType]) return 'CBT';
  if (record.VoucherType && STOCK_VOUCHER_TYPE_TO_MODULE[record.VoucherType]) return STOCK_VOUCHER_TYPE_TO_MODULE[record.VoucherType];
  return 'JV';
}

// Voucher number prefix for a given entry — JV for manual journal entries,
// the type-specific CP/CR/BP/BR prefix for CBT vouchers, or the matching
// GRN/MI/PRD/WM/ADJ/PC prefix for stock-originated entries. Previously
// every entry got a hardcoded "JV-" prefix regardless of actual type;
// this is the fix for that.
function voucherPrefixForEntry_(record) {
  if (record.VoucherType && CBT_VOUCHER_CONFIG[record.VoucherType]) {
    return CBT_VOUCHER_CONFIG[record.VoucherType].voucherPrefix;
  }
  if (record.VoucherType && STOCK_TRANSACTION_PREFIXES[record.VoucherType]) {
    return STOCK_TRANSACTION_PREFIXES[record.VoucherType];
  }
  return 'JV';
}

function requireDraftAccess_(idToken, user, moduleId) {
  if (!moduleHasCapability_(idToken, moduleId, 'draft', user.profile.role)) {
    throw new Error('You do not have permission to create or edit entries in ' + moduleId + '.');
  }
}

function requirePostAccess_(idToken, user, moduleId) {
  if (!moduleHasCapability_(idToken, moduleId, 'post', user.profile.role)) {
    throw new Error('You do not have permission to post or reverse entries in ' + moduleId + '.');
  }
}

// Strips thousand-separator commas before parsing — the client formats
// grid amounts with commas for display (e.g. "1,234.56"), so this guards
// against that reaching numeric parsing server-side regardless of
// whatever state the client was in when it sent the value.
function parseAmountServer_(value) {
  const num = parseFloat(String(value == null ? '' : value).replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

// Validates raw line input against live COA data and returns normalized,
// server-trusted line records plus totals. Blank trailing rows (no
// account code entered) are silently skipped rather than rejected, so
// the grid can always keep one empty row for typing convenience.
//
// entryCompanyId (optional) closes the loop between COA's per-account
// Company restriction and an entry's own Company tag: if an account is
// restricted to a specific company, the entry using it must be tagged
// with that same company. An entry with no company selected cannot use
// a company-restricted account at all — ambiguous ownership is treated
// as an error, not silently allowed.
// Account types where a Cost Center is mandatory per line — P&L-facing
// categories where cost attribution actually matters for reporting.
// Balance sheet types (Asset/Liability/Equity) are left optional.
const COST_CENTER_REQUIRED_TYPES = ['Expense', 'Revenue', 'COGS'];

function validateAndNormalizeLines_(rawLines, coaData, entryCompanyId) {
  const accountList = Object.keys(coaData).map(id => Object.assign({ AccountID: id }, coaData[id]));
  const lines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  (rawLines || []).forEach((line, idx) => {
    const accountCode = String(line.AccountCode || '').trim();
    if (!accountCode) return;

    const account = accountList.find(a => String(a.AccountCode) === accountCode);
    if (!account) throw new Error('Line ' + (idx + 1) + ': account code "' + accountCode + '" not found.');
    if (account.Status !== 'Active') throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' is inactive.');
    if (account.IsPostable !== true) throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' is a header account and cannot be posted to.');
    if (account.CompanyID && account.CompanyID !== (entryCompanyId || '')) {
      throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' is restricted to a specific company — select that company for this entry.');
    }

    const debit = parseAmountServer_(line.Debit);
    const credit = parseAmountServer_(line.Credit);

    if (debit < 0 || credit < 0) throw new Error('Line ' + (idx + 1) + ': amounts cannot be negative.');
    if (debit > 0 && credit > 0) throw new Error('Line ' + (idx + 1) + ': enter either a debit or a credit, not both.');
    if (debit === 0 && credit === 0) throw new Error('Line ' + (idx + 1) + ': enter a debit or credit amount.');

    const description = String(line.Description || '').trim();
    if (!description) throw new Error('Line ' + (idx + 1) + ': description is required.');

    const costCenterId = String(line.CostCenterID || '').trim();
    if (COST_CENTER_REQUIRED_TYPES.includes(account.AccountType) && !costCenterId) {
      throw new Error('Line ' + (idx + 1) + ': account ' + accountCode + ' (' + account.AccountType + ') requires a Cost Center.');
    }

    totalDebit += debit;
    totalCredit += credit;

    lines.push({
      LineNo: lines.length + 1,
      AccountID: account.AccountID,
      AccountCode: account.AccountCode,
      AccountName: account.AccountName,
      Description: description,
      Debit: Math.round(debit * 100) / 100,
      Credit: Math.round(credit * 100) / 100,
      CostCenterID: costCenterId,
      ProfitCenterID: String(line.ProfitCenterID || '')
    });
  });

  return {
    lines: lines,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100
  };
}

// Must be called while the caller already holds LockService.getScriptLock() —
// no internal locking here, to avoid nested lock acquisition in the same call.
// Counter is scoped per prefix, year, AND company:
// /gl/counters/{prefix}/{year}/{companyRefCode} — so each company's
// sequence starts independently at 000001, e.g. a company's first JV of
// the year is JV-26-01-000001 regardless of how many entries OTHER
// companies have already posted that year. The company reference code
// exists ONLY for this display string — it is not used as an identifier
// anywhere else (CompanyID remains the real key everywhere else in the
// system). The counter path itself still keys on the full 4-digit year
// (avoids any ambiguity at a century rollover); only the DISPLAYED
// voucher number is shortened to 2 digits.
function generateVoucherNumber_(idToken, prefix, year, companyId) {
  const companyRefCode = getCompanyRefCode_(idToken, companyId);
  const yy = String(year).slice(-2);
  const counterPath = 'gl/counters/' + prefix + '/' + year + '/' + companyRefCode;
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return prefix + '-' + yy + '-' + companyRefCode + '-' + String(next).padStart(6, '0');
}

// The separate, type-agnostic GL transaction reference. One lifetime
// sequence, never resets by year, increments across every entry that
// hits the GL regardless of whether it's a JV, CP, CR, BP, or BR — this
// is the audit-sequence number, distinct from the voucher number.
function generateGlTransactionRef_(idToken) {
  const counterPath = 'gl/transactionRefCounter';
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return 'TXN-' + String(next).padStart(8, '0');
}

// Returns { entries, total }. Capped at 100 most-recently-created entries
// Firestore collection name for the whole GL journal store — JV, CBT,
// and (once writeStockGlEntry_ is migrated too, as necessary follow-on
// work within this same phase) every stock-originated entry. Kept as
// its own constant since every function below references it, and a
// single collection name to update beats hunting down every literal
// string if it's ever renamed.
const FIRESTORE_JOURNAL_ENTRIES_COLLECTION = 'journalEntries';

function getJournalEntries(idToken, limit) {
  const user = requireUser_(idToken);

  if (!moduleHasCapability_(idToken, 'JV', 'access', user.profile.role)) {
    throw new Error('You do not have access to Journal Entry Processing.');
  }

  // Same access model as before (and the same one applyCompanyAccessRestriction_
  // uses elsewhere) — no role-based bypass, an Admin's own visibility is
  // still bounded by their own AssignedCompanies, exactly as the RTDB
  // version already behaved. Firestore's IN operator caps at 30 values,
  // more than any real user's assigned-company list should ever reach.
  const assignedCompanies = getUserAssignedCompanies_(user.profile);
  if (!assignedCompanies.length) return { entries: [], total: 0 };

  const where = [['VoucherType', 'EQUAL', 'JV'], ['CompanyID', 'IN', assignedCompanies]];
  const cap = (limit === 'all' || limit === 0) ? 1000 : (Number(limit) || 100);

  const rows = firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], cap);
  const total = firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  const entries = rows.map(e => Object.assign({ JVID: e._id }, e));
  return { entries: entries, total: total };
}

function getCbtEntries(idToken, limit) {
  const user = requireUser_(idToken);

  if (!moduleHasCapability_(idToken, 'CBT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Cash and Bank Transactions.');
  }

  const assignedCompanies = getUserAssignedCompanies_(user.profile);
  if (!assignedCompanies.length) return { entries: [], total: 0 };

  const cbtTypes = Object.keys(CBT_VOUCHER_CONFIG);
  const where = [['VoucherType', 'IN', cbtTypes], ['CompanyID', 'IN', assignedCompanies]];
  const cap = (limit === 'all' || limit === 0) ? 1000 : (Number(limit) || 100);

  const rows = firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']], cap);
  const total = firestoreCount_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where);
  const entries = rows.map(e => Object.assign({ JVID: e._id }, e));
  return { entries: entries, total: total };
}

// Shared core used by both saveJournalDraft() (plain manual JV) and
// saveCbtDraft() (Cash/Bank voucher entry) — both ultimately produce the
// same kind of GL record; only how the lines get built differs, and
// which module's "draft" permission applies.
//
// dimensions carries the header-level tags added for company/org
// structure: CurrencyCode (snapshotted from the current default currency,
// never a free pick — no conversion logic exists), CompanyID, DivisionID,
// BranchID, CostCenterID, ProfitCenterID. All optional except Currency,
// which auto-fills; none of these are validated against each other
// (e.g. a Branch isn't checked to belong to the selected Company) — that
// cross-validation doesn't exist yet.
function saveJournalRecord_(idToken, moduleId, jvId, jvDate, description, reference, rawLines, dimensions, extraFields) {
  const user = requireUser_(idToken);
  requireDraftAccess_(idToken, user, moduleId);

  if (!jvDate) throw new Error('Entry date is required.');
  if (!description) throw new Error('Description is required.');

  const dim = dimensions || {};
  const dimensionFields = {
    CurrencyCode: String(dim.CurrencyCode || ''),
    CompanyID: String(dim.CompanyID || ''),
    DivisionID: String(dim.DivisionID || ''),
    BranchID: String(dim.BranchID || ''),
    CostCenterID: String(dim.CostCenterID || ''),
    ProfitCenterID: String(dim.ProfitCenterID || '')
  };

  // Company is mandatory — without it there's no way to know which
  // company's books this entry belongs to, and the account picker on the
  // client won't even list accounts until one is chosen. Enforced here too
  // so a direct/malformed call can't bypass that client-side gate.
  if (!dimensionFields.CompanyID) throw new Error('Select a Company for this entry.');
  if (!userCanAccessCompany_(user.profile, dimensionFields.CompanyID)) {
    throw new Error('You do not have access to that company.');
  }

  const coaData = getCoaData_(idToken);
  const normalized = validateAndNormalizeLines_(rawLines, coaData, dimensionFields.CompanyID);
  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;

  if (jvId) {
    const existing = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    // Rejected is editable too now, same as Draft — a resubmission
    // reuses this exact save path, same symmetry already established
    // for Purchase Requisition and Inventory Purchase Requisition.
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected entries can be edited. Posted entries must be reversed instead.');

    const record = Object.assign({}, existing, dimensionFields, extraFields || {}, {
      JVDate: jvDate, Description: description, Reference: reference,
      Lines: normalized.lines, TotalDebit: normalized.totalDebit, TotalCredit: normalized.totalCredit,
      UpdatedAt: now, UpdatedBy: actor
    });
    delete record._id; // never write Firestore's own bookkeeping field back as data
    firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, record);
    return { success: true, jvId: jvId };
  }

  const newId = 'JVD-' + Utilities.getUuid().split('-')[0].toUpperCase();
  // VoucherType always gets a real value now — 'JV' for a plain manual
  // entry, never left blank/absent the way RTDB's version allowed.
  // Firestore's query model has no clean "field is absent" filter, so
  // getJournalEntries above needs every JV record to explicitly say
  // so, not imply it by omission.
  const record = Object.assign({
    JVNumber: '', TransactionRef: '', JVDate: jvDate, Description: description, Reference: reference,
    Status: 'Draft', Lines: normalized.lines,
    TotalDebit: normalized.totalDebit, TotalCredit: normalized.totalCredit,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    PostedAt: '', PostedBy: '', ReversedByJV: '', ReversalOfJV: '', VoucherType: 'JV'
  }, dimensionFields, extraFields || {});
  firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, newId, record);
  return { success: true, jvId: newId };
}

function saveJournalDraft(idToken, jvData) {
  try {
    return saveJournalRecord_(
      idToken, 'JV',
      String(jvData.JVID || '').trim(),
      String(jvData.JVDate || '').trim(),
      String(jvData.Description || '').trim(),
      String(jvData.Reference || '').trim(),
      jvData.Lines,
      {
        CurrencyCode: jvData.CurrencyCode, CompanyID: jvData.CompanyID,
        DivisionID: jvData.DivisionID, BranchID: jvData.BranchID,
        CostCenterID: jvData.CostCenterID, ProfitCenterID: jvData.ProfitCenterID
      },
      { VoucherType: 'JV' }
    );
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteJournalDraft(idToken, jvId) {
  try {
    const user = requireUser_(idToken);
    const existing = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, moduleIdForEntry_(existing));
    if (existing.Status !== 'Draft') throw new Error('Only draft entries can be deleted. Posted entries must be reversed instead.');

    firestoreDelete_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// The ONLY function that ever writes a "Posted" record — this is the
// AccountingEngine boundary for GL. Re-validates lines against live COA
// data (not the possibly-stale draft) before committing, including the
// company-restriction check (an account could have gained a company
// restriction, or the restriction could have changed, since the draft
// was saved).
function postJournalEntry(idToken, jvId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const moduleId = moduleIdForEntry_(existing);
    requirePostAccess_(idToken, user, moduleId);
    // Draft (first posting attempt) or Rejected (resubmitting after a
    // revision) — both go through identical logic below, same as the
    // Draft/Rejected symmetry already established for Purchase
    // Requisition and Inventory Purchase Requisition.
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected entries can be posted.');

    const coaData = getCoaData_(idToken);
    const normalized = validateAndNormalizeLines_(existing.Lines, coaData, existing.CompanyID);

    if (normalized.lines.length < 2) throw new Error('A journal entry needs at least two lines.');
    if (normalized.totalDebit === 0) throw new Error('Entry has no amounts.');
    if (Math.abs(normalized.totalDebit - normalized.totalCredit) > 0.005) {
      throw new Error('Entry is not balanced: total debit ' + normalized.totalDebit.toFixed(2) + ' vs total credit ' + normalized.totalCredit.toFixed(2) + '.');
    }

    const year = (new Date(existing.JVDate)).getFullYear() || new Date().getFullYear();
    const prefix = voucherPrefixForEntry_(existing);
    // Voucher numbering deliberately stays in RTDB even though the
    // document itself now lives in Firestore — it's just a small,
    // atomically-incrementing counter, shared identically by every
    // module regardless of which database its own records live in.
    // Moving it would add complexity for no real benefit: the only
    // failure mode if this succeeds and the Firestore write below
    // doesn't is a skipped voucher number, which accounting already
    // tolerates (numbers just need to be unique, not gapless) — a
    // fundamentally different, much lower-stakes risk than the
    // physical-stock-vs-GL mismatch Phase 3 is built to guard against.
    const jvNumber = generateVoucherNumber_(idToken, prefix, year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval gate — keyed by whichever module this entry actually
    // belongs to (JV or CBT; moduleIdForEntry_ already resolves this,
    // and postJournalEntry/saveJournalRecord_ are shared infrastructure
    // for both, so this one change covers both at once). Scope
    // resolution uses the entry's own HEADER Cost
    // Center/Division/Branch — the "line default" a user may or may
    // not have set, individual lines can still override it — same
    // reasoning as Purchase Order's own CostCenterID: one entry, one
    // unambiguous scope value, even though its own lines can vary. If
    // Admin configures a CostCenter-scoped gate and the header field
    // is left blank, no gate applies — the same "can't resolve scope
    // means no gate" behavior already established for every other
    // retrofit, not special-cased here.
    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, moduleId, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, moduleId, jvId, jvNumber, scopeKey, normalized.totalDebit, user.uid);

    const record = Object.assign({}, existing, {
      JVNumber: jvNumber, Lines: normalized.lines,
      TotalDebit: normalized.totalDebit, TotalCredit: normalized.totalCredit,
      RejectionReason: '', SubmittedAt: now, SubmittedBy: actor
    });
    delete record._id;
    let transactionRef = '';
    if (approval.required) {
      record.Status = 'PendingApproval';
      record.ApprovalInstanceID = approval.instanceId;
      record.TransactionRef = '';
    } else {
      // TransactionRef is deliberately only ever assigned at the
      // moment an entry actually becomes Posted — not here if a gate
      // applies (see decideJournalEntryApproval, which assigns it on
      // final approval instead). It represents a committed GL
      // posting, which a still-PendingApproval entry isn't yet.
      transactionRef = generateGlTransactionRef_(idToken);
      record.Status = 'Posted';
      record.TransactionRef = transactionRef;
      record.PostedAt = now;
      record.PostedBy = actor;
    }

    firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, record);
    return { success: true, jvNumber: jvNumber, transactionRef: transactionRef, status: record.Status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

function decideJournalEntryApproval(idToken, jvId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    const existing = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (existing) {
      requirePostAccess_(idToken, user, moduleIdForEntry_(existing));
      if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    }
    const result = decideApprovalForDocument_(idToken, FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, levelNumber, decision, reason, 'Posted', 'firestore');
    if (result.status === 'Approved') {
      // Only NOW, once every required level has actually approved,
      // does this become a real, committed GL posting.
      const transactionRef = generateGlTransactionRef_(idToken);
      const now = new Date().toISOString();
      firestoreUpdate_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, {
        TransactionRef: transactionRef, PostedAt: now, PostedBy: user.profile.username || user.uid
      });
    }
    return Object.assign({ success: true }, result);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reverseJournalEntry(idToken, jvId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Journal entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, moduleIdForEntry_(existing));
    if (existing.Status !== 'Posted') throw new Error('Only posted entries can be reversed.');
    if (existing.ReversedByJV) throw new Error('This entry has already been reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const reversedLines = (existing.Lines || []).map(line => Object.assign({}, line, {
      Debit: line.Credit, Credit: line.Debit
    }));

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const year = (new Date(date)).getFullYear() || new Date().getFullYear();
    const prefix = voucherPrefixForEntry_(existing);
    const jvNumber = generateVoucherNumber_(idToken, prefix, year, existing.CompanyID);
    const transactionRef = generateGlTransactionRef_(idToken);
    const newId = 'JVD-' + Utilities.getUuid().split('-')[0].toUpperCase();

    const reversalRecord = {
      JVNumber: jvNumber, TransactionRef: transactionRef, JVDate: date,
      Description: 'Reversal of ' + existing.JVNumber + ' — ' + existing.Description,
      Reference: existing.JVNumber,
      Status: 'Posted', Lines: reversedLines,
      TotalDebit: existing.TotalCredit, TotalCredit: existing.TotalDebit,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      PostedAt: now, PostedBy: actor, ReversedByJV: '', ReversalOfJV: jvId,
      VoucherType: existing.VoucherType || 'JV', SelectedAccountCode: existing.SelectedAccountCode || '',
      CurrencyCode: existing.CurrencyCode || '', CompanyID: existing.CompanyID || '',
      DivisionID: existing.DivisionID || '', BranchID: existing.BranchID || '',
      CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    };

    firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, newId, reversalRecord);
    firestoreUpdate_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, { ReversedByJV: newId });

    return { success: true, jvId: newId, jvNumber: jvNumber, transactionRef: transactionRef };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// CASH AND BANK TRANSACTIONS (CBT)
// ============================================================
// A friendlier voucher-style front end over the SAME GL journal store as
// JV — not a separate ledger. Every voucher still becomes a normal
// balanced double-entry record; this layer just removes the need to
// think in Dr/Cr for the common cash/bank case by inferring it from the
// voucher type:
//   Cash/Bank Receipt -> the selected ledger account is DEBITED,
//                         every opposite line is CREDITED
//   Cash/Bank Payment  -> the selected ledger account is CREDITED,
//                         every opposite line is DEBITED
// "Cash" vs "Bank" is determined by the selected account's code prefix,
// which follows directly from the COA numbering scheme: leaf accounts
// under the 100000 (Cash/Petty Cash) header start with "10"; leaf
// accounts under 110000 (Bank Accounts) start with "11".
const CBT_VOUCHER_CONFIG = {
  'Cash Receipt': { ledgerPrefix: '10', ledgerIsDebit: true, voucherPrefix: 'CR' },
  'Bank Receipt': { ledgerPrefix: '11', ledgerIsDebit: true, voucherPrefix: 'BR' },
  'Cash Payment': { ledgerPrefix: '10', ledgerIsDebit: false, voucherPrefix: 'CP' },
  'Bank Payment': { ledgerPrefix: '11', ledgerIsDebit: false, voucherPrefix: 'BP' }
};

// headerDescription is used for the ledger (Cash/Bank) line's own
// Description, since that line has no user-facing description field of
// its own — mirroring the header keeps it meaningful now that every line
// requires a description. headerDimensions supplies the ledger line's
// Cost/Profit Center default (it isn't part of the editable opposite-lines
// grid, so it always inherits from the header, never overridden per line).
function buildLinesFromVoucher_(voucherType, selectedAccountCode, oppositeLines, headerDescription, headerDimensions) {
  const config = CBT_VOUCHER_CONFIG[voucherType];
  if (!config) throw new Error('Unknown transaction type: ' + voucherType);

  const rawLines = [];

  (oppositeLines || []).forEach((line, idx) => {
    const code = String(line.AccountCode || '').trim();
    if (!code) return;
    if (code === selectedAccountCode) {
      throw new Error('Line ' + (idx + 1) + ': cannot use the same account selected as the ' + (config.ledgerPrefix === '10' ? 'cash' : 'bank') + ' ledger.');
    }
    const amount = parseAmountServer_(line.Amount);
    if (amount <= 0) throw new Error('Line ' + (idx + 1) + ': enter an amount greater than zero.');

    rawLines.push({
      AccountCode: code,
      Description: String(line.Description || '').trim(),
      Debit: config.ledgerIsDebit ? 0 : amount,
      Credit: config.ledgerIsDebit ? amount : 0,
      CostCenterID: String(line.CostCenterID || ''),
      ProfitCenterID: String(line.ProfitCenterID || '')
    });
  });

  if (!rawLines.length) throw new Error('Enter at least one line.');

  const total = rawLines.reduce((sum, l) => sum + l.Debit + l.Credit, 0);
  const dim = headerDimensions || {};

  rawLines.unshift({
    AccountCode: selectedAccountCode,
    Description: String(headerDescription || '').trim(),
    Debit: config.ledgerIsDebit ? total : 0,
    Credit: config.ledgerIsDebit ? 0 : total,
    CostCenterID: String(dim.CostCenterID || ''),
    ProfitCenterID: String(dim.ProfitCenterID || '')
  });

  return rawLines;
}


function saveCbtDraft(idToken, cbtData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'CBT');

    const voucherType = String(cbtData.VoucherType || '').trim();
    const config = CBT_VOUCHER_CONFIG[voucherType];
    if (!config) throw new Error('Select a transaction type.');

    const selectedAccountCode = String(cbtData.SelectedAccountCode || '').trim();
    if (!selectedAccountCode) throw new Error('Select a cash or bank ledger.');

    const companyId = String(cbtData.CompanyID || '').trim();

    const coaData = getCoaData_(idToken);
    const selectedAccount = Object.keys(coaData)
      .map(id => Object.assign({ AccountID: id }, coaData[id]))
      .find(a => String(a.AccountCode) === selectedAccountCode);

    if (!selectedAccount) throw new Error('Selected ledger account not found.');
    if (selectedAccount.Status !== 'Active') throw new Error('Selected ledger account is inactive.');
    if (selectedAccount.IsPostable !== true) throw new Error('Selected ledger account is a header account and cannot be posted to.');
    if (String(selectedAccount.AccountCode).substring(0, 2) !== config.ledgerPrefix) {
      throw new Error('Selected account is not a valid ' + (config.ledgerPrefix === '10' ? 'Cash' : 'Bank') + ' ledger account.');
    }
    if (selectedAccount.CompanyID && selectedAccount.CompanyID !== companyId) {
      throw new Error('Selected ledger account is restricted to a specific company — select that company for this entry.');
    }

    const rawLines = buildLinesFromVoucher_(
      voucherType, selectedAccountCode, cbtData.OppositeLines,
      cbtData.Description,
      { CostCenterID: cbtData.CostCenterID, ProfitCenterID: cbtData.ProfitCenterID }
    );

    return saveJournalRecord_(
      idToken, 'CBT',
      String(cbtData.JVID || '').trim(),
      String(cbtData.JVDate || '').trim(),
      String(cbtData.Description || '').trim(),
      String(cbtData.Reference || '').trim(),
      rawLines,
      {
        CurrencyCode: cbtData.CurrencyCode, CompanyID: cbtData.CompanyID,
        DivisionID: cbtData.DivisionID, BranchID: cbtData.BranchID,
        CostCenterID: cbtData.CostCenterID, ProfitCenterID: cbtData.ProfitCenterID
      },
      { VoucherType: voucherType, SelectedAccountCode: selectedAccountCode }
    );
  } catch (err) {
    return { success: false, error: err.message };
  }
}
// NOTE: postJournalEntry(), deleteJournalDraft(), and reverseJournalEntry()
// are reused as-is for CBT entries — see moduleIdForEntry_() above for
// how they know to check CBT's permissions instead of JV's.

// Narrow, audited exception to "posted is immutable": lets the header
// Description be corrected after posting — a typo shouldn't require a
// full reversal. This can NEVER touch lines, amounts, accounts, dates,
// dimensions, JVNumber, TransactionRef, or Status; those stay locked.
// Gated at the same trust level as posting/reversing, not draft-level,
// since it still edits a permanent record. Line-level descriptions are
// NOT editable here — only the header description.
function updatePostedDescription(idToken, jvId, description) {
  try {
    const user = requireUser_(idToken);
    const existing = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
    if (!existing) throw new Error('Entry not found.');
    requirePostAccess_(idToken, user, moduleIdForEntry_(existing));
    if (existing.Status !== 'Posted') throw new Error('This entry is not posted — edit it normally instead.');

    const newDescription = String(description || '').trim();
    if (!newDescription) throw new Error('Description is required.');

    firestoreUpdate_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId, {
      Description: newDescription,
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: user.profile.username || user.uid
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// ENTERPRISE STRUCTURE & ORGANIZATIONAL MASTER DATA
// ============================================================
// Three sub-modules sharing one theme: foundational org data that other
// modules (FI, CO, HR, inventory) will reference going forward, not
// finance-specific in itself. None of this is a transactional ledger, so
// direct CRUD is appropriate — same posture as COA. Currencies and org
// units are deactivate-only, never hard-deleted, since future modules
// (multi-currency JV lines, employee/department assignment) may end up
// referencing them.

// ---------- Company Master Data ----------
// Storage: Firebase RTDB, /companies/{companyId} — a LIST now, not a
// singleton, to support a parent company plus any number of subsidiaries,
// each with its own legal name, tax numbers, and address. ParentCompanyID
// is empty for a top-level entity, set for a subsidiary. Multiple
// independent top-level entities are allowed (no forced single root).
//
// IMPORTANT SCOPE NOTE: this is reference data only. COA, JV, and CBT have
// no concept of "company" at all — nothing here makes journal entries or
// the chart of accounts entity-specific. If separate books per subsidiary
// are actually needed, that's a materially larger design decision (shared
// COA with a Company dimension per line, vs. fully separate COA per
// entity) and hasn't been built.
//
// Write access is ADMIN-only by default (tighter than the other two —
// legal name and tax registration numbers are more sensitive than a
// currency list or a branch code). Adjust in Roles & Permissions if
// that default doesn't fit.

// ============================================================
// USER-BASED COMPANY ACCESS
// ============================================================
// Every user record can carry AssignedCompanies: [companyId, ...]. This
// is SECURE BY DEFAULT: an empty or missing list means the user has NO
// access to any company-specific data — not "sees everything," the
// opposite. That's a deliberate choice (confirmed explicitly), which
// means every user created before this feature existed loses access to
// COA/JV/CBT/Financial Reports the moment this deploys, until an ADMIN
// assigns them companies via User Management.
//
// Company Master Data, Currency Configuration, Organizational Units,
// User Management, Roles & Permissions, and Module Tree Management are
// deliberately NOT restricted by this — those are administrative/
// reference screens, not day-to-day operating-within-one-company work,
// and leaving them open is what keeps an ADMIN able to log in and fix
// assignments even if their own account has none yet.
//
// KNOWN GAP: Division/Branch/Cost Center/Profit Center have no Company
// field of their own, so those dropdowns are NOT scoped by this — a
// restricted user still sees every org unit regardless of which company
// it conceptually belongs to. Adding Company to Org Units would close
// this but is separate, not-yet-built scope.

function getUserAssignedCompanies_(profile) {
  return Array.isArray(profile.AssignedCompanies) ? profile.AssignedCompanies : [];
}

// Blank companyId (shared/company-agnostic data — e.g. a shared COA
// account) is always accessible to everyone; company restriction only
// ever applies to data explicitly tied to ONE company.
function userCanAccessCompany_(profile, companyId) {
  if (!companyId) return true;
  return getUserAssignedCompanies_(profile).includes(companyId);
}

// Used by every report (TB/P&L/BS/CFS/GL): if the caller explicitly
// picked one company, it must be one they're allowed to see (or this
// throws). If they left the company filter blank, scope the report to
// exactly their assigned set instead of "everyone's" — an empty
// assigned list correctly yields zero rows rather than silently
// showing all companies' data.
function applyCompanyAccessRestriction_(user, requestedCompanyId) {
  const assigned = getUserAssignedCompanies_(user.profile);
  if (requestedCompanyId) {
    if (!assigned.includes(requestedCompanyId)) {
      throw new Error('You do not have access to that company.');
    }
    return { companyId: requestedCompanyId, assignedCompanies: null };
  }
  return { companyId: '', assignedCompanies: assigned };
}

// Minimal reference read (ID + name only, Active only) available to any
// authenticated user — used by other modules (e.g. COA, JV, CBT, and
// every Financial Report) to populate a "which company" dropdown. This
// is THE enforcement point for company access in most of the app: since
// every one of those screens' Company dropdown calls this same function,
// restricting it here automatically restricts what a user can even
// select everywhere else, with no changes needed to those screens.
function getActiveCompanies(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('companies', 'get', null, idToken) || {};
  const assigned = getUserAssignedCompanies_(user.profile);
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => assigned.includes(id))
    .map(id => ({ CompanyID: id, LegalName: data[id].LegalName, CompanyRefCode: data[id].CompanyRefCode || '', AddressLine1: data[id].AddressLine1 || '', AddressLine2: data[id].AddressLine2 || '', TaxNumbers: data[id].TaxNumbers || [] }));
}

// Same pattern, for Organizational Units — used by JV/CBT to populate
// Division/Branch/Cost Center/Profit Center dropdowns without requiring
// full ORGUNITS access. CompanyID is optional per unit (blank = shared
// across all companies, same convention as COA's CompanyID) — restricted
// units are filtered by the requesting user's company access, closing
// the gap flagged earlier where org units (especially Warehouse) weren't
// scoped by company at all.
function getActiveOrgUnits(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID || ''))
    .map(id => ({ UnitID: id, Type: data[id].Type, Code: data[id].Code, Name: data[id].Name, CompanyID: data[id].CompanyID || '' }));
}

// Same pattern, for the current default currency only — used by JV/CBT
// to snapshot CurrencyCode at save time. Returns null if no currency is
// marked default yet.
function getDefaultCurrency(idToken) {
  requireUser_(idToken);
  const data = firebaseDbRequest_('currencies', 'get', null, idToken) || {};
  const defaultId = Object.keys(data).find(id => data[id].IsDefault && data[id].Status === 'Active');
  if (!defaultId) return null;
  return { CurrencyID: defaultId, Code: data[defaultId].Code, Name: data[defaultId].Name, Symbol: data[defaultId].Symbol || '' };
}

// Every company needs a short numeric reference code (2 digits, unique)
// used ONLY to make voucher numbers identify their company at a glance
// (e.g. JV-26-01-000001 vs JV-26-02-000001). This code is NOT used as an
// identifier anywhere else in the system — CompanyID remains the real
// key everywhere else. Backfills any company missing one (same lazy
// pattern as ensureSubCategoriesSeeded_), so voucher generation never
// breaks even for a company created before this feature existed, or if
// Company Master Data hasn't been opened since it shipped.
function ensureCompanyRefCodesSeeded_(idToken, companies) {
  const used = new Set(Object.values(companies).map(c => c.CompanyRefCode).filter(Boolean));
  const missingIds = Object.keys(companies)
    .filter(id => !companies[id].CompanyRefCode)
    .sort((a, b) => String(companies[a].CreatedAt || '').localeCompare(String(companies[b].CreatedAt || '')));

  const updates = {};
  let next = 1;
  missingIds.forEach(id => {
    while (used.has(String(next).padStart(2, '0'))) next++;
    const code = String(next).padStart(2, '0');
    used.add(code);
    companies[id].CompanyRefCode = code;
    updates[id + '/CompanyRefCode'] = code;
    next++;
  });

  if (Object.keys(updates).length) {
    firebaseDbRequest_('companies', 'patch', updates, idToken);
  }
  return companies;
}

// On-demand single-company lookup used at voucher-generation time — never
// throws for a "missing code" (backfills it inline instead), only if the
// company itself doesn't exist at all.
function getCompanyRefCode_(idToken, companyId) {
  const companies = firebaseDbRequest_('companies', 'get', null, idToken) || {};
  ensureCompanyRefCodesSeeded_(idToken, companies);
  const company = companies[companyId];
  if (!company) throw new Error('Company not found for voucher numbering.');
  return company.CompanyRefCode;
}

function getCompanies(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'COMPANYMASTER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Company Master Data.');
  }
  let data = firebaseDbRequest_('companies', 'get', null, idToken) || {};
  data = ensureCompanyRefCodesSeeded_(idToken, data);
  return Object.keys(data).map(id => Object.assign({ CompanyID: id }, data[id]));
}

function saveCompany(idToken, companyData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'COMPANYMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Company Master Data.');
    }

    const companyId = String(companyData.CompanyID || '').trim();
    const legalName = String(companyData.LegalName || '').trim();
    const parentCompanyId = String(companyData.ParentCompanyID || '').trim();
    const status = String(companyData.Status || 'Active').trim();
    const grnClearingAccountId = String(companyData.GrnClearingAccountID || '').trim();
    const discountReceivedAccountId = String(companyData.DiscountReceivedAccountID || '').trim();
    const inputTaxAccountId = String(companyData.InputTaxAccountID || '').trim();
    const roundOffAccountId = String(companyData.RoundOffAccountID || '').trim();
    const discountGivenAccountId = String(companyData.DiscountGivenAccountID || '').trim();
    const outputTaxAccountId = String(companyData.OutputTaxAccountID || '').trim();
    let refCode = String(companyData.CompanyRefCode || '').trim();

    if (!legalName) throw new Error('Legal company name is required.');
    if (companyId && parentCompanyId === companyId) throw new Error('A company cannot be its own parent.');

    // GRN Clearing Account is a FIXED, per-company setting — not chosen
    // per-transaction. A clearing account only works as one if it's
    // always the same account; letting each GRN pick a different offset
    // would mean nothing ever nets to zero when later matched against a
    // vendor invoice. GRN itself reads this automatically and never
    // shows an account picker.
    if (grnClearingAccountId) {
      const coaData = getCoaData_(idToken);
      const account = coaData[grnClearingAccountId];
      if (!account || !account.IsPostable || account.Status !== 'Active') {
        throw new Error('GRN Clearing Account must be an active, postable account.');
      }
      if (account.CompanyID && companyId && account.CompanyID !== companyId) {
        throw new Error('GRN Clearing Account is restricted to a different company.');
      }
    }

    // Same fixed, per-company treatment as GRN Clearing above, for the
    // OTHER accounts Vendor Invoice Processing and Customer Invoice
    // Processing need automatically — Discount Received/Given, Input/
    // Output Tax, and Round Off (shared by both directions — see
    // requestReverseVendorInvoice's own comment on why one Round Off
    // account is enough regardless of AP/AR). NOT Accounts Payable or
    // Accounts Receivable themselves, deliberately: those are already
    // TradePayablesAccountID / TradeReceivablesAccountID on Vendor and
    // Customer Master Data respectively — per-vendor/per-customer
    // fields, added there specifically in anticipation of these exact
    // modules, precisely so different vendors or customers (e.g. Local
    // vs Foreign) can post to different control accounts. A second,
    // company-level AP/AR account here would have been redundant with
    // — and could silently disagree with — those existing,
    // deliberately-placed fields.
    const fixedAccountFields = [
      { id: discountReceivedAccountId, label: 'Discount Received Account' },
      { id: inputTaxAccountId, label: 'Input Tax Account' },
      { id: roundOffAccountId, label: 'Round Off Account' },
      { id: discountGivenAccountId, label: 'Discount Given Account' },
      { id: outputTaxAccountId, label: 'Output Tax Account' }
    ];
    fixedAccountFields.forEach(f => {
      if (!f.id) return;
      const coaData = getCoaData_(idToken);
      const account = coaData[f.id];
      if (!account || !account.IsPostable || account.Status !== 'Active') {
        throw new Error(f.label + ' must be an active, postable account.');
      }
      if (account.CompanyID && companyId && account.CompanyID !== companyId) {
        throw new Error(f.label + ' is restricted to a different company.');
      }
    });


    const taxNumbers = Array.isArray(companyData.TaxNumbers)
      ? companyData.TaxNumbers
          .map(t => ({ Type: String(t.Type || '').trim(), Number: String(t.Number || '').trim() }))
          .filter(t => t.Type || t.Number)
      : [];

    const existing = firebaseDbRequest_('companies', 'get', null, idToken) || {};
    ensureCompanyRefCodesSeeded_(idToken, existing);

    if (refCode) {
      if (!/^\d{2}$/.test(refCode)) throw new Error('Company reference code must be exactly 2 digits (e.g. 01).');
      const clash = Object.keys(existing).find(id => id !== companyId && existing[id].CompanyRefCode === refCode);
      if (clash) throw new Error('That reference code is already used by ' + existing[clash].LegalName + '.');
    } else {
      // Blank on the form — keep the existing code if editing one that
      // already has it, otherwise auto-assign the next available (covers
      // a brand-new company left blank, and the unlikely case of an
      // existing one that somehow still has none after the backfill above).
      const currentCode = companyId && existing[companyId] ? existing[companyId].CompanyRefCode : '';
      if (currentCode) {
        refCode = currentCode;
      } else {
        const used = new Set(Object.values(existing).map(c => c.CompanyRefCode).filter(Boolean));
        let next = 1;
        while (used.has(String(next).padStart(2, '0'))) next++;
        refCode = String(next).padStart(2, '0');
      }
    }

    if (parentCompanyId) {
      if (!existing[parentCompanyId]) throw new Error('Parent company not found.');
      let walkId = parentCompanyId;
      while (walkId) {
        if (walkId === companyId) throw new Error('Cannot move a company under one of its own subsidiaries.');
        walkId = existing[walkId] ? existing[walkId].ParentCompanyID : '';
      }
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      LegalName: legalName,
      CompanyRefCode: refCode,
      TaxNumbers: taxNumbers,
      AddressLine1: String(companyData.AddressLine1 || '').trim(),
      AddressLine2: String(companyData.AddressLine2 || '').trim(),
      City: String(companyData.City || '').trim(),
      StateOrEmirate: String(companyData.StateOrEmirate || '').trim(),
      Country: String(companyData.Country || '').trim(),
      PostalCode: String(companyData.PostalCode || '').trim(),
      ParentCompanyID: parentCompanyId,
      GrnClearingAccountID: grnClearingAccountId,
      DiscountReceivedAccountID: discountReceivedAccountId,
      InputTaxAccountID: inputTaxAccountId,
      RoundOffAccountID: roundOffAccountId,
      DiscountGivenAccountID: discountGivenAccountId,
      OutputTaxAccountID: outputTaxAccountId,
      Status: status
    };

    if (companyId) {
      if (!existing[companyId]) throw new Error('Company not found.');
      firebaseDbRequest_('companies/' + companyId, 'patch', Object.assign({}, fields, { UpdatedAt: now, UpdatedBy: actor }), idToken);
      return { success: true, companyId: companyId };
    }

    const newId = 'CO-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('companies/' + newId, 'put', Object.assign({}, fields, {
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }), idToken);
    return { success: true, companyId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateCompany(idToken, companyId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'COMPANYMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Company Master Data.');
    }
    const existing = firebaseDbRequest_('companies', 'get', null, idToken) || {};
    if (!existing[companyId]) throw new Error('Company not found.');

    const hasActiveChildren = Object.keys(existing).some(id =>
      existing[id].ParentCompanyID === companyId && existing[id].Status === 'Active'
    );
    if (hasActiveChildren) throw new Error('Deactivate or reassign this company\'s subsidiaries first.');

    firebaseDbRequest_('companies/' + companyId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateCompany(idToken, companyId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'COMPANYMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Company Master Data.');
    }
    const existing = firebaseDbRequest_('companies/' + companyId, 'get', null, idToken);
    if (!existing) throw new Error('Company not found.');

    firebaseDbRequest_('companies/' + companyId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Currency Configuration ----------
// Storage: Firebase RTDB, /currencies/{currencyId}.
// Exactly one currency may be IsDefault at a time — saving a new default
// unsets the previous one in the same call.

function getCurrencies(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'CURRENCYCONFIG', 'access', user.profile.role)) {
    throw new Error('You do not have access to Currency Configuration.');
  }
  const data = firebaseDbRequest_('currencies', 'get', null, idToken) || {};
  return Object.keys(data).map(id => Object.assign({ CurrencyID: id }, data[id]));
}

function saveCurrency(idToken, currencyData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'CURRENCYCONFIG', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Currency Configuration.');
    }

    const currencyId = String(currencyData.CurrencyID || '').trim();
    const code = String(currencyData.Code || '').trim().toUpperCase();
    const name = String(currencyData.Name || '').trim();
    const symbol = String(currencyData.Symbol || '').trim();
    const isDefault = currencyData.IsDefault === true || currencyData.IsDefault === 'true';
    const status = String(currencyData.Status || 'Active').trim();

    if (!code || !name) throw new Error('Currency code and name are required.');
    if (!/^[A-Z]{3}$/.test(code)) throw new Error('Currency code should be a 3-letter ISO code (e.g. AED, USD).');

    const existing = firebaseDbRequest_('currencies', 'get', null, idToken) || {};
    const duplicate = Object.keys(existing).some(id => id !== currencyId && String(existing[id].Code).toUpperCase() === code);
    if (duplicate) throw new Error('Currency code "' + code + '" is already in use.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // If this one becomes the default, unset the flag on every other
    // currency in the same write.
    const updates = {};
    if (isDefault) {
      Object.keys(existing).forEach(id => {
        if (id !== currencyId && existing[id].IsDefault) updates[id] = Object.assign({}, existing[id], { IsDefault: false, UpdatedAt: now, UpdatedBy: actor });
      });
    }

    if (currencyId) {
      if (!existing[currencyId]) throw new Error('Currency not found.');
      updates[currencyId] = {
        Code: code, Name: name, Symbol: symbol, IsDefault: isDefault, Status: status,
        CreatedAt: existing[currencyId].CreatedAt, CreatedBy: existing[currencyId].CreatedBy,
        UpdatedAt: now, UpdatedBy: actor
      };
      firebaseDbRequest_('currencies', 'patch', updates, idToken);
      return { success: true, currencyId: currencyId };
    }

    const newId = 'CUR-' + Utilities.getUuid().split('-')[0].toUpperCase();
    updates[newId] = {
      Code: code, Name: name, Symbol: symbol, IsDefault: isDefault, Status: status,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    };
    firebaseDbRequest_('currencies', 'patch', updates, idToken);
    return { success: true, currencyId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateCurrency(idToken, currencyId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'CURRENCYCONFIG', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Currency Configuration.');
    }
    const existing = firebaseDbRequest_('currencies/' + currencyId, 'get', null, idToken);
    if (!existing) throw new Error('Currency not found.');
    if (existing.IsDefault) throw new Error('Cannot deactivate the default currency — set another currency as default first.');

    firebaseDbRequest_('currencies/' + currencyId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateCurrency(idToken, currencyId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'CURRENCYCONFIG', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Currency Configuration.');
    }
    const existing = firebaseDbRequest_('currencies/' + currencyId, 'get', null, idToken);
    if (!existing) throw new Error('Currency not found.');

    firebaseDbRequest_('currencies/' + currencyId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Organizational Units ----------
// Storage: Firebase RTDB, /orgUnits/{unitId}. One collection covers all
// five types (Division, Branch, Warehouse, CostCenter, ProfitCenter) —
// they share the same shape (Code, Name, optional ParentUnitID for
// grouping) and the UI filters by Type rather than needing five separate
// screens. Codes are free-text and unique across the whole collection
// (not just within a type) to keep lookups unambiguous.
//
// NOTE: Cost Center / Profit Center codes here are entered manually, not
// system-generated like COA's account codes — no numbering scheme was
// specified for them. If you want auto-sequenced codes (e.g. CC-1000,
// PC-2000) the way COA does, say so and it can be added the same way.

const ORG_UNIT_TYPES = ['Division', 'Branch', 'Warehouse', 'Rack', 'CostCenter', 'ProfitCenter'];

function getOrgUnits(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'ORGUNITS', 'access', user.profile.role)) {
    throw new Error('You do not have access to Organizational Units.');
  }
  const data = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
  return Object.keys(data).map(id => Object.assign({ UnitID: id }, data[id]));
}

function saveOrgUnit(idToken, unitData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ORGUNITS', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Organizational Units.');
    }

    const unitId = String(unitData.UnitID || '').trim();
    const type = String(unitData.Type || '').trim();
    const code = String(unitData.Code || '').trim();
    const name = String(unitData.Name || '').trim();
    const parentUnitId = String(unitData.ParentUnitID || '').trim();
    const companyId = String(unitData.CompanyID || '').trim();
    const status = String(unitData.Status || 'Active').trim();

    if (!ORG_UNIT_TYPES.includes(type)) throw new Error('Type must be one of: ' + ORG_UNIT_TYPES.join(', ') + '.');
    if (!code || !name) throw new Error('Code and name are required.');
    if (unitId && parentUnitId === unitId) throw new Error('An item cannot be its own parent.');
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) {
      throw new Error('You do not have access to that company.');
    }

    const existing = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    const duplicateCode = Object.keys(existing).some(id => id !== unitId && String(existing[id].Code).toUpperCase() === code.toUpperCase());
    if (duplicateCode) throw new Error('Code "' + code + '" is already in use.');

    if (parentUnitId) {
      if (!existing[parentUnitId]) throw new Error('Parent item not found.');
      let walkId = parentUnitId;
      while (walkId) {
        if (walkId === unitId) throw new Error('Cannot move an item under one of its own descendants.');
        walkId = existing[walkId] ? existing[walkId].ParentUnitID : '';
      }
    }

    // A Rack always belongs under a Warehouse — this is what makes
    // Item Master's "Default Warehouse" picker meaningful alongside racks
    // (a rack without a warehouse parent would be an orphaned location).
    if (type === 'Rack') {
      if (!parentUnitId) throw new Error('A Rack must have a Warehouse selected as its parent.');
      if (!existing[parentUnitId] || existing[parentUnitId].Type !== 'Warehouse') {
        throw new Error('A Rack\'s parent must be a Warehouse.');
      }
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (unitId) {
      if (!existing[unitId]) throw new Error('Item not found.');
      firebaseDbRequest_('orgUnits/' + unitId, 'patch', {
        Type: type, Code: code, Name: name, ParentUnitID: parentUnitId, CompanyID: companyId, Status: status,
        UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, unitId: unitId };
    }

    const newId = 'ORG-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('orgUnits/' + newId, 'put', {
      Type: type, Code: code, Name: name, ParentUnitID: parentUnitId, CompanyID: companyId, Status: status,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, unitId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateOrgUnit(idToken, unitId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ORGUNITS', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Organizational Units.');
    }
    const existing = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
    if (!existing[unitId]) throw new Error('Item not found.');

    const hasActiveChildren = Object.keys(existing).some(id => existing[id].ParentUnitID === unitId && existing[id].Status === 'Active');
    if (hasActiveChildren) throw new Error('Deactivate or reassign this item\'s sub-items first.');

    firebaseDbRequest_('orgUnits/' + unitId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateOrgUnit(idToken, unitId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ORGUNITS', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Organizational Units.');
    }
    const existing = firebaseDbRequest_('orgUnits/' + unitId, 'get', null, idToken);
    if (!existing) throw new Error('Item not found.');

    firebaseDbRequest_('orgUnits/' + unitId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Unit of Measure (UOM) ----------
// Storage: Firebase RTDB, /uoms/{uomId}. Simple flat master — Code (short,
// e.g. KG, PCS), Name (e.g. Kilogram, Pieces), Status. No conversion
// factors between UOMs in this pass — each Item Master record picks ONE
// base UOM for stock-keeping; multi-UOM (e.g. purchase in boxes, stock in
// pieces, with a conversion factor) is a clearly-scoped future
// enhancement, not built here.

const DEFAULT_UOMS = [
  { code: 'PCS', name: 'Pieces', allowDecimals: false, decimalPlaces: 0 },
  { code: 'KG', name: 'Kilogram', allowDecimals: true, decimalPlaces: 3 },
  { code: 'LTR', name: 'Litre', allowDecimals: true, decimalPlaces: 2 },
  { code: 'MTR', name: 'Metre', allowDecimals: true, decimalPlaces: 2 },
  { code: 'BOX', name: 'Box', allowDecimals: false, decimalPlaces: 0 }
];

function ensureUOMsSeeded_(idToken, existing) {
  const existingCodes = new Set(Object.values(existing).map(u => String(u.Code).toUpperCase()));
  const missing = DEFAULT_UOMS.filter(u => !existingCodes.has(u.code));
  if (!missing.length) return existing;

  const now = new Date().toISOString();
  const updates = {};
  missing.forEach(u => {
    const id = 'UOM-' + Utilities.getUuid().split('-')[0].toUpperCase();
    const record = { Code: u.code, Name: u.name, AllowDecimals: u.allowDecimals, DecimalPlaces: u.decimalPlaces, Status: 'Active', CreatedAt: now, CreatedBy: 'system', UpdatedAt: now, UpdatedBy: 'system' };
    updates[id] = record;
    existing[id] = record;
  });
  firebaseDbRequest_('uoms', 'patch', updates, idToken);
  return existing;
}

function getUOMs(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'UOM', 'access', user.profile.role)) {
    throw new Error('You do not have access to Unit of Measure.');
  }
  let data = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
  data = ensureUOMsSeeded_(idToken, data);
  return Object.keys(data).map(id => Object.assign({ UOMID: id }, data[id]));
}

// Minimal reference read — used by Item Master (and later Stock
// transactions) to populate a UOM picker without requiring full UOM access.
function getActiveUOMs(idToken) {
  requireUser_(idToken);
  let data = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
  data = ensureUOMsSeeded_(idToken, data);
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .map(id => ({ UOMID: id, Code: data[id].Code, Name: data[id].Name, AllowDecimals: Boolean(data[id].AllowDecimals), DecimalPlaces: data[id].DecimalPlaces || 0 }));
}

function saveUOM(idToken, uomData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'UOM', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Unit of Measure.');
    }

    const uomId = String(uomData.UOMID || '').trim();
    const code = String(uomData.Code || '').trim().toUpperCase();
    const name = String(uomData.Name || '').trim();
    const allowDecimals = uomData.AllowDecimals === true || uomData.AllowDecimals === 'true';
    const decimalPlaces = allowDecimals ? Math.max(0, Math.min(6, Math.round(Number(uomData.DecimalPlaces) || 0))) : 0;
    const status = String(uomData.Status || 'Active').trim();

    if (!code || !name) throw new Error('Code and name are required.');

    const existing = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const duplicate = Object.keys(existing).some(id => id !== uomId && String(existing[id].Code).toUpperCase() === code);
    if (duplicate) throw new Error('UOM code "' + code + '" is already in use.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (uomId) {
      if (!existing[uomId]) throw new Error('UOM not found.');
      firebaseDbRequest_('uoms/' + uomId, 'patch', {
        Code: code, Name: name, AllowDecimals: allowDecimals, DecimalPlaces: decimalPlaces, Status: status,
        UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, uomId: uomId };
    }

    const newId = 'UOM-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('uoms/' + newId, 'put', {
      Code: code, Name: name, AllowDecimals: allowDecimals, DecimalPlaces: decimalPlaces, Status: status,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, uomId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateUOM(idToken, uomId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'UOM', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Unit of Measure.');
    }
    const existing = firebaseDbRequest_('uoms/' + uomId, 'get', null, idToken);
    if (!existing) throw new Error('UOM not found.');
    firebaseDbRequest_('uoms/' + uomId, 'patch', { Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateUOM(idToken, uomId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'UOM', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Unit of Measure.');
    }
    const existing = firebaseDbRequest_('uoms/' + uomId, 'get', null, idToken);
    if (!existing) throw new Error('UOM not found.');
    firebaseDbRequest_('uoms/' + uomId, 'patch', { Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Item Sub-Category ----------
// Storage: Firebase RTDB, /itemSubCategories/{id}. Purely a classification/
// filtering aid layered on top of Item Master's fixed 5-way Category
// (RawMaterial/SemiFinishedGood/FinishedGood/Consumable/Scrap) — e.g.
// under Raw Material you might have "Metals", "Plastics", "Chemicals".
// Each sub-category belongs to exactly one of the 5 fixed categories.
// This does NOT affect ItemCode generation (still just category prefix +
// sequence) — it's for organizing/filtering the item list, nothing more.

function getItemSubCategories(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'ITEMSUBCAT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Item Sub-Category.');
  }
  const data = firebaseDbRequest_('itemSubCategories', 'get', null, idToken) || {};
  return Object.keys(data).map(id => Object.assign({ SubCategoryID: id }, data[id]));
}

// Minimal reference read — used by Item Master to populate a sub-category
// picker (filtered client-side to the item's selected Category) without
// requiring full ITEMSUBCAT access.
function getActiveItemSubCategories(idToken) {
  requireUser_(idToken);
  const data = firebaseDbRequest_('itemSubCategories', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .map(id => ({ SubCategoryID: id, Name: data[id].Name, ParentCategory: data[id].ParentCategory }));
}

function saveItemSubCategory(idToken, data) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ITEMSUBCAT', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Item Sub-Category.');
    }

    const subCategoryId = String(data.SubCategoryID || '').trim();
    const name = String(data.Name || '').trim();
    const parentCategory = String(data.ParentCategory || '').trim();
    const status = String(data.Status || 'Active').trim();

    if (!name) throw new Error('Name is required.');
    if (!ITEM_CATEGORY_PREFIXES[parentCategory]) throw new Error('Select a valid parent category.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (subCategoryId) {
      const existing = firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'get', null, idToken);
      if (!existing) throw new Error('Sub-category not found.');
      firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'patch', {
        Name: name, ParentCategory: parentCategory, Status: status, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, subCategoryId: subCategoryId };
    }

    const newId = 'ISC-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('itemSubCategories/' + newId, 'put', {
      Name: name, ParentCategory: parentCategory, Status: status,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, subCategoryId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateItemSubCategory(idToken, subCategoryId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ITEMSUBCAT', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Item Sub-Category.');
    }
    const existing = firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'get', null, idToken);
    if (!existing) throw new Error('Sub-category not found.');
    firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'patch', { Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateItemSubCategory(idToken, subCategoryId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ITEMSUBCAT', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Item Sub-Category.');
    }
    const existing = firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'get', null, idToken);
    if (!existing) throw new Error('Sub-category not found.');
    firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'patch', { Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Item Master ----------
// Storage: Firebase RTDB, /items/{itemId}. The Chart-of-Accounts
// equivalent for Stock — every stock transaction (built in a later
// phase: GRN, Material Issue, Production, etc.) references an item here
// and gets its GL accounts FROM THIS RECORD (InventoryAccountID /
// ConsumptionAccountID), never picked per-transaction. This is what
// makes real-time GL auto-posting possible without asking the user to
// choose accounts on every movement.
//
// ItemCode is auto-generated, prefixed by category and sequential WITHIN
// that category (RM-000001, FG-000001, ...) — the same identify-by-
// prefix convention already used for voucher numbers.

const ITEM_CATEGORY_PREFIXES = {
  RawMaterial: 'RM',
  SemiFinishedGood: 'SFG',
  FinishedGood: 'FG',
  Consumable: 'CONS',
  Scrap: 'SCRAP'
};

function generateItemCode_(idToken, category) {
  const prefix = ITEM_CATEGORY_PREFIXES[category];
  if (!prefix) throw new Error('Unknown item category: ' + category);
  const counterPath = 'itemCounters/' + prefix;
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return prefix + '-' + String(next).padStart(6, '0');
}

function getItems(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'ITEMMASTER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Item Master.');
  }
  const data = firebaseDbRequest_('items', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ ItemID: id }, data[id]))
    .filter(item => userCanAccessCompany_(user.profile, item.CompanyID));
}

// Minimal reference read for other modules (future Stock transactions) to
// populate an item picker without requiring full ITEMMASTER access.
// Picks the correct expense-side GL account for a given outbound stock
// reason, with graceful fallback to Consumption when the more specific
// account hasn't been set up for this item. Used by future Stock
// transactions (Material Issue, Sales integration, Stock Adjustment) —
// not called anywhere yet, since those transaction types aren't built,
// but the resolution logic belongs here next to the account fields
// themselves rather than being re-implemented per transaction screen.
function resolveItemExpenseAccount_(item, reason) {
  if (reason === 'Sales' && item.SalesCogsAccountID) return item.SalesCogsAccountID;
  if (reason === 'WriteOff' && item.WriteOffAccountID) return item.WriteOffAccountID;
  return item.ConsumptionAccountID;
}

function getActiveItems(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('items', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({
      ItemID: id, ItemCode: data[id].ItemCode, ItemName: data[id].ItemName,
      Category: data[id].Category, SubCategoryID: data[id].SubCategoryID || '',
      UOMID: data[id].UOMID, AltUOMID: data[id].AltUOMID || '', ConversionFactor: data[id].ConversionFactor || 0,
      CompanyID: data[id].CompanyID || '', DefaultWarehouseID: data[id].DefaultWarehouseID || '',
      InventoryAccountID: data[id].InventoryAccountID, ConsumptionAccountID: data[id].ConsumptionAccountID,
      SalesCogsAccountID: data[id].SalesCogsAccountID || '', WriteOffAccountID: data[id].WriteOffAccountID || '',
      BatchTracked: Boolean(data[id].BatchTracked)
    }));
}

function saveItem(idToken, itemData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ITEMMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Item Master.');
    }

    const itemId = String(itemData.ItemID || '').trim();
    const itemName = String(itemData.ItemName || '').trim();
    const category = String(itemData.Category || '').trim();
    const subCategoryId = String(itemData.SubCategoryID || '').trim();
    const uomId = String(itemData.UOMID || '').trim();
    const altUomId = String(itemData.AltUOMID || '').trim();
    const conversionFactor = altUomId ? Number(itemData.ConversionFactor) : 0;
    const companyId = String(itemData.CompanyID || '').trim();
    const defaultWarehouseId = String(itemData.DefaultWarehouseID || '').trim();
    const inventoryAccountId = String(itemData.InventoryAccountID || '').trim();
    const consumptionAccountId = String(itemData.ConsumptionAccountID || '').trim();
    const salesCogsAccountId = String(itemData.SalesCogsAccountID || '').trim();
    const writeOffAccountId = String(itemData.WriteOffAccountID || '').trim();
    const batchTracked = itemData.BatchTracked === true || itemData.BatchTracked === 'true';
    const reorderLevel = Number(itemData.ReorderLevel) || 0;
    const status = String(itemData.Status || 'Active').trim();

    if (!itemName) throw new Error('Item name is required.');
    if (!ITEM_CATEGORY_PREFIXES[category]) throw new Error('Select a valid item category.');
    if (!uomId) throw new Error('Select a Unit of Measure.');
    if (!inventoryAccountId) throw new Error('Select an Inventory (asset) account.');
    if (!consumptionAccountId) throw new Error('Select a Consumption (expense/COGS) account.');
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) {
      throw new Error('You do not have access to that company.');
    }

    if (subCategoryId) {
      const subCats = firebaseDbRequest_('itemSubCategories', 'get', null, idToken) || {};
      const subCat = subCats[subCategoryId];
      if (!subCat) throw new Error('Sub-category not found.');
      if (subCat.ParentCategory !== category) throw new Error('Sub-category does not belong to the selected Category.');
    }

    const uoms = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    if (!uoms[uomId]) throw new Error('Unit of Measure not found.');

    // Alternate UOM: e.g. base unit KG, alternate BOX where 1 BOX = 200 KG
    // (ConversionFactor is always expressed as "how many base units per 1
    // alternate unit"). Optional — an item can stay single-UOM.
    if (altUomId) {
      if (altUomId === uomId) throw new Error('Alternate UOM must be different from the base Unit of Measure.');
      if (!uoms[altUomId]) throw new Error('Alternate Unit of Measure not found.');
      if (!conversionFactor || conversionFactor <= 0) throw new Error('Enter a conversion factor greater than zero for the alternate UOM.');
    }

    const coaData = getCoaData_(idToken);

    const inventoryAccount = coaData[inventoryAccountId];
    if (!inventoryAccount || !inventoryAccount.IsPostable) throw new Error('Inventory account must be an active, postable account.');
    if (inventoryAccount.AccountType !== 'Asset') throw new Error('Inventory account must be an Asset-type account.');
    if (inventoryAccount.CompanyID && companyId && inventoryAccount.CompanyID !== companyId) {
      throw new Error('Inventory account is restricted to a different company than this item.');
    }

    // Three possible expense-side accounts, covering the different reasons
    // stock can leave inventory. Only Consumption is mandatory; the other
    // two fall back to it if left blank — see resolveItemExpenseAccount_,
    // used by future Stock transactions to pick the right one per
    // transaction type. This is what makes it possible for the SAME Raw
    // Material item to hit "RM Consumption / Production Cost" when issued
    // to production, but "COGS – Raw Materials" when sold directly, and
    // "Inventory Write-off" when scrapped or adjusted away — three
    // different transaction types, three different accounts, same item.
    //
    // Sales COGS and Write-off are genuinely expense-only roles (a sale or
    // a scrap write-off is always an expense), so they stay restricted to
    // Expense/COGS account types. Consumption is different: Production
    // Entry now ALSO credits this same field (crediting the item's own
    // Consumption account when it's produced, mirroring Material Issue's
    // debit of it when issued) — the same unrestricted, not-paternalistic
    // treatment already given to GRN's Clearing Account, since a
    // production-offset/clearing account is just as legitimately a
    // Liability or Asset in many charts as an Expense.
    function validateExpenseAccount(accountId, label) {
      if (!accountId) return;
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error(label + ' account must be an active, postable account.');
      if (!['Expense', 'COGS'].includes(account.AccountType)) throw new Error(label + ' account must be an Expense or COGS account.');
      if (account.CompanyID && companyId && account.CompanyID !== companyId) {
        throw new Error(label + ' account is restricted to a different company than this item.');
      }
    }
    function validateOffsetAccount(accountId, label) {
      if (!accountId) return;
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error(label + ' account must be an active, postable account.');
      if (account.CompanyID && companyId && account.CompanyID !== companyId) {
        throw new Error(label + ' account is restricted to a different company than this item.');
      }
    }
    validateOffsetAccount(consumptionAccountId, 'Consumption');
    validateExpenseAccount(salesCogsAccountId, 'Sales COGS');
    validateExpenseAccount(writeOffAccountId, 'Write-off');

    if (defaultWarehouseId) {
      const orgUnits = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
      const wh = orgUnits[defaultWarehouseId];
      if (!wh || wh.Type !== 'Warehouse') throw new Error('Default warehouse not found.');
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      ItemName: itemName,
      Category: category,
      SubCategoryID: subCategoryId,
      UOMID: uomId,
      AltUOMID: altUomId,
      ConversionFactor: conversionFactor,
      CompanyID: companyId,
      DefaultWarehouseID: defaultWarehouseId,
      InventoryAccountID: inventoryAccountId,
      ConsumptionAccountID: consumptionAccountId,
      SalesCogsAccountID: salesCogsAccountId,
      WriteOffAccountID: writeOffAccountId,
      BatchTracked: batchTracked,
      ReorderLevel: reorderLevel,
      Status: status
    };

    if (itemId) {
      const existing = firebaseDbRequest_('items/' + itemId, 'get', null, idToken);
      if (!existing) throw new Error('Item not found.');
      // Category (and therefore the ItemCode prefix) is locked after
      // creation — same reasoning as COA's AccountType lock: changing it
      // would orphan the code's meaning and any future stock ledger
      // history tied to this item.
      if (existing.Category !== category) throw new Error('Item category cannot be changed after creation.');
      firebaseDbRequest_('items/' + itemId, 'patch', Object.assign({}, fields, { UpdatedAt: now, UpdatedBy: actor }), idToken);
      return { success: true, itemId: itemId, itemCode: existing.ItemCode };
    }

    const itemCode = generateItemCode_(idToken, category);
    const newId = 'ITM-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('items/' + newId, 'put', Object.assign({}, fields, {
      ItemCode: itemCode, CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }), idToken);
    return { success: true, itemId: newId, itemCode: itemCode };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateItem(idToken, itemId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ITEMMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Item Master.');
    }
    const existing = firebaseDbRequest_('items/' + itemId, 'get', null, idToken);
    if (!existing) throw new Error('Item not found.');
    firebaseDbRequest_('items/' + itemId, 'patch', { Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateItem(idToken, itemId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'ITEMMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Item Master.');
    }
    const existing = firebaseDbRequest_('items/' + itemId, 'get', null, idToken);
    if (!existing) throw new Error('Item not found.');
    firebaseDbRequest_('items/' + itemId, 'patch', { Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// FINANCIAL REPORTS (FR)
// ============================================================
// All five reports below are pure read-only aggregations over POSTED GL
// data (JV + CBT entries share one store — see moduleIdForEntry_ earlier).
// None of them write anything. All support the same dimension filters
// (Company/Division/Branch header-level; Cost Center/Profit Center
// line-level) via buildDimensionFilters_/getPostedGlLines_ below.
//
// SCALE NOTE: Trial Balance and Balance Sheet call getPostedGlLines_
// below, which now pushes its Status filter into Firestore rather than
// fetching the whole collection — but Trial Balance and Balance Sheet
// are inherently cumulative-since-inception concepts, so
// there's no way to serve them from a partial/recent-only fetch. This is
// the same scaling ceiling flagged earlier, now shared by five more
// endpoints instead of two.
//
// BALANCE SHEET NOTE: since there is no period-end closing process,
// cumulative Revenue − COGS − Expense from inception through the as-of
// date is rolled into Equity as a computed "Retained Earnings (Current
// Period)" line, rather than assuming a formal closing entry has already
// moved it there. This is standard practice for a live, continuously-
// posting ledger, but worth knowing that's what that line represents.
//
// CASH FLOW STATEMENT NOTE: uses the direct method, categorizing each
// entry's net cash movement by whichever account sits on the OTHER side
// of the transaction (via COA's CashFlowCategory field, defaulting to
// Operating if unset). This works because of a property of double-entry
// bookkeeping: for any entry with a nonzero net cash change, the sum of
// its non-cash lines' (Credit − Debit) always equals that net cash
// change exactly — so summing the categorized amounts can never drift
// from the real cash movement. Entries with NO net cash line change
// (pure non-cash entries like depreciation, or transfers between two
// cash/bank accounts) are automatically excluded, correctly. The
// "reconciles" flag in the response is a live check of this guarantee
// against the actual GL cash balance change — if it's ever false, that
// indicates a data problem (e.g. a line missing its AccountID), not a
// flaw in the method itself.

function buildDimensionFilters_(params) {
  return {
    companyId: String(params.CompanyID || '').trim(),
    divisionId: String(params.DivisionID || '').trim(),
    branchId: String(params.BranchID || '').trim(),
    costCenterId: String(params.CostCenterID || '').trim(),
    profitCenterId: String(params.ProfitCenterID || '').trim()
  };
}

// Flattens every POSTED entry's lines into one array, each line annotated
// with its parent entry's date/number/reference for display, filtered by
// the given dimensions. Company/Division/Branch are entry-level filters
// (exclude the whole entry); Cost Center/Profit Center are line-level
// (exclude just non-matching lines within an otherwise-included entry).
// Flattens every entry's lines into one array, each line annotated with
// its parent entry's date/number/reference for display, filtered by the
// given dimensions. Company/Division/Branch are entry-level filters
// (exclude the whole entry); Cost Center/Profit Center are line-level
// (exclude just non-matching lines within an otherwise-included entry).
//
// By default only POSTED entries are included — Trial Balance, P&L,
// Balance Sheet, and Cash Flow must never include unconfirmed data. Pass
// filters.includeDraft: true to also include Draft entries; this is used
// ONLY by the General Ledger Report's opt-in "Include Draft Entries"
// checkbox, since seeing pending activity in context is genuinely useful
// there in a way it wouldn't be for the other four (a Trial Balance or
// Balance Sheet that included drafts would be presenting un-posted,
// still-changeable numbers as if they were final).
function getPostedGlLines_(idToken, filters) {
  const f = filters || {};
  // Only Status is pushed into Firestore — a single-field filter needs
  // no composite index at all, unlike combining it with CompanyID/
  // DivisionID/BranchID would (a different index requirement for every
  // distinct combination a report actually ends up using). Everything
  // else stays filtered here in JS, exactly as it did against RTDB —
  // CostCenterID/ProfitCenterID genuinely HAVE to, since they're
  // per-LINE fields inside an array; Firestore has no way to query by
  // a property of an array element at all. This still captures most of
  // the real benefit (not fetching drafts/rejected entries most report
  // calls never want) without the index-proliferation risk of trying
  // to push every possible filter combination server-side up front.
  const statusFilter = f.includeDraft
    ? [['Status', 'IN', ['Posted', 'Draft', 'PendingApproval']]]
    : [['Status', 'EQUAL', 'Posted']];
  const entries = firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, statusFilter, null, null);
  const lines = [];

  entries.forEach(entry => {
    const jvId = entry._id;
    if (f.companyId && entry.CompanyID !== f.companyId) return;
    // Company access restriction — see applyCompanyAccessRestriction_.
    // A non-null array here means "scope to exactly these companies";
    // an EMPTY array correctly excludes every entry rather than being
    // treated as "no restriction."
    if (f.assignedCompanies && !f.assignedCompanies.includes(entry.CompanyID)) return;
    if (f.divisionId && entry.DivisionID !== f.divisionId) return;
    if (f.branchId && entry.BranchID !== f.branchId) return;

    (entry.Lines || []).forEach(line => {
      if (f.costCenterId && line.CostCenterID !== f.costCenterId) return;
      if (f.profitCenterId && line.ProfitCenterID !== f.profitCenterId) return;

      lines.push({
        JVID: jvId,
        JVDate: entry.JVDate,
        JVNumber: entry.JVNumber,
        TransactionRef: entry.TransactionRef,
        EntryDescription: entry.Description,
        Status: entry.Status,
        VoucherType: entry.VoucherType || '',
        AccountID: line.AccountID,
        AccountCode: line.AccountCode,
        AccountName: line.AccountName,
        Description: line.Description,
        Debit: Number(line.Debit) || 0,
        Credit: Number(line.Credit) || 0,
        CostCenterID: line.CostCenterID || '',
        ProfitCenterID: line.ProfitCenterID || ''
      });
    });
  });

  return lines;
}

// Leaf accounts under the 100000 (Cash) or 110000 (Bank) headers all get
// codes starting "10" or "11" per the COA numbering scheme — see COA
// section above for the full scheme.
function isCashOrBankAccount_(account) {
  const prefix = String(account.AccountCode || '').substring(0, 2);
  return prefix === '10' || prefix === '11';
}

// Cash Flow Category can only be SET on a non-postable (header) account —
// see saveAccount, which forces it blank on any postable leaf. A leaf
// therefore never has its own value; it always resolves from its parent
// at report time, which means changing the header's category later
// applies to every leaf beneath it automatically, with nothing to re-save.
function resolveCashFlowCategory_(account, coaData) {
  if (account.CashFlowCategory) return account.CashFlowCategory;
  if (account.ParentAccountID && coaData[account.ParentAccountID]) {
    return coaData[account.ParentAccountID].CashFlowCategory || '';
  }
  return '';
}

// ---------- General Ledger Report ----------
// One account's full activity over a period, with a running balance —
// the classic "T-account as a list" view.

function getGlReport(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'GLREPORT', 'access', user.profile.role)) {
    throw new Error('You do not have access to General Ledger Reports.');
  }

  const accountId = String(params.AccountID || '').trim();
  if (!accountId) throw new Error('Select an account.');

  const coaData = getCoaData_(idToken);
  const account = coaData[accountId];
  if (!account) throw new Error('Account not found.');
  if (!userCanAccessCompany_(user.profile, account.CompanyID)) {
    throw new Error('You do not have access to that company.');
  }

  // A header (non-postable) account rolls up every leaf directly beneath
  // it into one combined ledger — e.g. selecting "Bank Accounts" shows
  // every bank sub-account's activity together, sorted into one running
  // balance. A postable leaf just reports on itself, as before.
  const isRollup = account.IsPostable !== true;
  const targetAccountIds = isRollup
    ? Object.keys(coaData).filter(id => coaData[id].ParentAccountID === accountId)
    : [accountId];

  const filters = buildDimensionFilters_(params);
  const access = applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  filters.includeDraft = params.IncludeDraft === true || params.IncludeDraft === 'true';
  const allLines = getPostedGlLines_(idToken, filters).filter(l => targetAccountIds.includes(l.AccountID));

  const fromDate = String(params.FromDate || '').trim();
  const toDate = String(params.ToDate || '').trim() || '9999-12-31';
  const sign = account.NormalBalance === 'Debit' ? 1 : -1;

  let opening = 0;
  allLines.forEach(l => {
    if (fromDate && l.JVDate < fromDate) opening += sign * (l.Debit - l.Credit);
  });
  opening = Math.round(opening * 100) / 100;

  const periodLines = allLines
    .filter(l => (!fromDate || l.JVDate >= fromDate) && l.JVDate <= toDate)
    .sort((a, b) => a.JVDate === b.JVDate
      ? String(a.TransactionRef || '').localeCompare(String(b.TransactionRef || ''))
      : a.JVDate.localeCompare(b.JVDate));

  let running = opening;
  const rows = periodLines.map(l => {
    running = Math.round((running + sign * (l.Debit - l.Credit)) * 100) / 100;
    return {
      JVID: l.JVID, JVDate: l.JVDate, JVNumber: l.JVNumber, TransactionRef: l.TransactionRef,
      Status: l.Status, VoucherType: l.VoucherType,
      // Resolved server-side (moduleIdForEntry_ already knows how to
      // route CBT vouchers, every stock transaction type, and plain JV
      // entries) rather than leaving the client to guess from VoucherType
      // alone — a plain truthy check on VoucherType would misroute any
      // stock-originated line (GRN, MI, etc.) to the CBT screen, since
      // those also set VoucherType to a non-empty value.
      SourceModule: moduleIdForEntry_({ VoucherType: l.VoucherType }),
      AccountCode: l.AccountCode, AccountName: l.AccountName,
      Description: l.Description || l.EntryDescription, Debit: l.Debit, Credit: l.Credit, Balance: running
    };
  });

  return {
    account: { AccountCode: account.AccountCode, AccountName: account.AccountName, NormalBalance: account.NormalBalance, IsRollup: isRollup },
    openingBalance: opening,
    rows: rows,
    closingBalance: running
  };
}

// ---------- Trial Balance ----------
// Every account's cumulative net balance as of a date, split into
// Debit/Credit columns — the two column totals must match, which is the
// whole point of the report as an integrity check.

function getTrialBalance(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'TRIALBALANCE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Trial Balance.');
  }

  const asOfDate = String(params.AsOfDate || '').trim() || new Date().toISOString().substring(0, 10);
  const filters = buildDimensionFilters_(params);
  const access = applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  const coaData = getCoaData_(idToken);
  const lines = getPostedGlLines_(idToken, filters).filter(l => l.JVDate <= asOfDate);

  const netByAccount = {};
  lines.forEach(l => { netByAccount[l.AccountID] = (netByAccount[l.AccountID] || 0) + (l.Debit - l.Credit); });

  const rows = [];
  let totalDebit = 0, totalCredit = 0;

  Object.keys(netByAccount).forEach(accId => {
    const account = coaData[accId];
    if (!account) return;
    const net = Math.round(netByAccount[accId] * 100) / 100;
    if (Math.abs(net) < 0.005) return;

    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    totalDebit += debit; totalCredit += credit;
    rows.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, AccountType: account.AccountType, Debit: debit, Credit: credit });
  });

  rows.sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode), undefined, { numeric: true }));

  return {
    asOfDate: asOfDate,
    rows: rows,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100
  };
}

// ---------- Profit and Loss Statement ----------
// Revenue, COGS, and Expense accounts only, for a date range — a period
// concept, unlike the cumulative-since-inception Trial Balance/Balance Sheet.

function getProfitAndLoss(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PROFITLOSS', 'access', user.profile.role)) {
    throw new Error('You do not have access to the Profit and Loss Statement.');
  }

  const fromDate = String(params.FromDate || '').trim();
  const toDate = String(params.ToDate || '').trim() || new Date().toISOString().substring(0, 10);
  if (!fromDate) throw new Error('Select a start date.');

  const filters = buildDimensionFilters_(params);
  const access = applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  const coaData = getCoaData_(idToken);
  const lines = getPostedGlLines_(idToken, filters).filter(l => l.JVDate >= fromDate && l.JVDate <= toDate);

  const netByAccount = {};
  lines.forEach(l => { netByAccount[l.AccountID] = (netByAccount[l.AccountID] || 0) + (l.Debit - l.Credit); });

  const revenue = [], cogs = [], expense = [];
  let totalRevenue = 0, totalCogs = 0, totalExpense = 0;

  Object.keys(netByAccount).forEach(accId => {
    const account = coaData[accId];
    if (!account) return;
    const net = Math.round(netByAccount[accId] * 100) / 100;
    if (Math.abs(net) < 0.005) return;

    if (account.AccountType === 'Revenue') {
      const amount = -net; // Credit − Debit: positive = revenue earned
      totalRevenue += amount;
      revenue.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, Amount: amount });
    } else if (account.AccountType === 'COGS') {
      totalCogs += net; // Debit − Credit: positive = cost incurred
      cogs.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, Amount: net });
    } else if (account.AccountType === 'Expense') {
      totalExpense += net;
      expense.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, Amount: net });
    }
  });

  const sortByCode = (a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode), undefined, { numeric: true });
  revenue.sort(sortByCode); cogs.sort(sortByCode); expense.sort(sortByCode);

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCogs = Math.round(totalCogs * 100) / 100;
  totalExpense = Math.round(totalExpense * 100) / 100;
  const grossProfit = Math.round((totalRevenue - totalCogs) * 100) / 100;
  const netIncome = Math.round((grossProfit - totalExpense) * 100) / 100;

  return {
    fromDate: fromDate, toDate: toDate,
    revenue: revenue, totalRevenue: totalRevenue,
    cogs: cogs, totalCogs: totalCogs,
    grossProfit: grossProfit,
    expense: expense, totalExpense: totalExpense,
    netIncome: netIncome
  };
}

// ---------- Balance Sheet ----------
// Asset/Liability/Equity accounts as of a date, with cumulative P&L
// rolled into Equity as "Retained Earnings (Current Period)" — see the
// module-level note above on why.

function getBalanceSheet(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'BALANCESHEET', 'access', user.profile.role)) {
    throw new Error('You do not have access to the Balance Sheet.');
  }

  const asOfDate = String(params.AsOfDate || '').trim() || new Date().toISOString().substring(0, 10);
  const filters = buildDimensionFilters_(params);
  const access = applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  const coaData = getCoaData_(idToken);
  const lines = getPostedGlLines_(idToken, filters).filter(l => l.JVDate <= asOfDate);

  const netByAccount = {};
  lines.forEach(l => { netByAccount[l.AccountID] = (netByAccount[l.AccountID] || 0) + (l.Debit - l.Credit); });

  const assets = [], liabilities = [], equity = [];
  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0, netIncomeToDate = 0;

  Object.keys(netByAccount).forEach(accId => {
    const account = coaData[accId];
    if (!account) return;
    const net = Math.round(netByAccount[accId] * 100) / 100;
    if (Math.abs(net) < 0.005) return;

    if (account.AccountType === 'Asset') {
      totalAssets += net;
      assets.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, Amount: net });
    } else if (account.AccountType === 'Liability') {
      const amount = -net;
      totalLiabilities += amount;
      liabilities.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, Amount: amount });
    } else if (account.AccountType === 'Equity') {
      const amount = -net;
      totalEquity += amount;
      equity.push({ AccountCode: account.AccountCode, AccountName: account.AccountName, Amount: amount });
    } else if (account.AccountType === 'Revenue') {
      netIncomeToDate += -net;
    } else if (account.AccountType === 'COGS' || account.AccountType === 'Expense') {
      netIncomeToDate -= net;
    }
  });

  netIncomeToDate = Math.round(netIncomeToDate * 100) / 100;
  if (Math.abs(netIncomeToDate) >= 0.005) {
    equity.push({ AccountCode: '', AccountName: 'Retained Earnings (Current Period — not yet closed)', Amount: netIncomeToDate });
    totalEquity += netIncomeToDate;
  }

  const sortByCode = (a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode), undefined, { numeric: true });
  assets.sort(sortByCode); liabilities.sort(sortByCode); equity.sort(sortByCode);

  totalAssets = Math.round(totalAssets * 100) / 100;
  totalLiabilities = Math.round(totalLiabilities * 100) / 100;
  totalEquity = Math.round(totalEquity * 100) / 100;

  return {
    asOfDate: asOfDate,
    assets: assets, totalAssets: totalAssets,
    liabilities: liabilities, totalLiabilities: totalLiabilities,
    equity: equity, totalEquity: totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
  };
}

// ---------- Cash Flow Statement ----------
// Direct method — see module-level note above for the categorization
// logic and why it's guaranteed to reconcile.

function getCashFlowStatement(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'CASHFLOW', 'access', user.profile.role)) {
    throw new Error('You do not have access to the Cash Flow Statement.');
  }

  const fromDate = String(params.FromDate || '').trim();
  const toDate = String(params.ToDate || '').trim() || new Date().toISOString().substring(0, 10);
  if (!fromDate) throw new Error('Select a start date.');

  const filters = buildDimensionFilters_(params);
  const access = applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  const coaData = getCoaData_(idToken);
  const allLines = getPostedGlLines_(idToken, filters);

  const cashLines = allLines.filter(l => { const a = coaData[l.AccountID]; return a && isCashOrBankAccount_(a); });
  let openingCash = 0, closingCash = 0;
  cashLines.forEach(l => {
    const net = l.Debit - l.Credit;
    if (l.JVDate < fromDate) openingCash += net;
    if (l.JVDate <= toDate) closingCash += net;
  });
  openingCash = Math.round(openingCash * 100) / 100;
  closingCash = Math.round(closingCash * 100) / 100;

  const periodLines = allLines.filter(l => l.JVDate >= fromDate && l.JVDate <= toDate);
  const byEntry = {};
  periodLines.forEach(l => { (byEntry[l.JVID] = byEntry[l.JVID] || []).push(l); });

  const categoryTotals = { Operating: 0, Investing: 0, Financing: 0 };
  const breakdown = {};

  Object.values(byEntry).forEach(entryLines => {
    let cashNet = 0;
    entryLines.forEach(l => {
      const acc = coaData[l.AccountID];
      if (acc && isCashOrBankAccount_(acc)) cashNet += (l.Debit - l.Credit);
    });
    if (Math.abs(cashNet) < 0.005) return; // no net cash effect: excluded by design

    entryLines.forEach(l => {
      const acc = coaData[l.AccountID];
      if (!acc || isCashOrBankAccount_(acc)) return;
      const impact = l.Credit - l.Debit;
      const resolvedCategory = resolveCashFlowCategory_(acc, coaData);
      const category = ['Operating', 'Investing', 'Financing'].includes(resolvedCategory) ? resolvedCategory : 'Operating';
      categoryTotals[category] += impact;
      const key = category + '|' + l.AccountID;
      if (!breakdown[key]) breakdown[key] = { category: category, accountCode: acc.AccountCode, accountName: acc.AccountName, amount: 0 };
      breakdown[key].amount += impact;
    });
  });

  Object.keys(categoryTotals).forEach(k => { categoryTotals[k] = Math.round(categoryTotals[k] * 100) / 100; });
  const breakdownList = Object.values(breakdown).map(b => Object.assign({}, b, { amount: Math.round(b.amount * 100) / 100 }));
  const sortByAccount = (a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true });

  const netChange = Math.round((categoryTotals.Operating + categoryTotals.Investing + categoryTotals.Financing) * 100) / 100;
  const reconciles = Math.abs(netChange - Math.round((closingCash - openingCash) * 100) / 100) < 0.01;

  return {
    fromDate: fromDate, toDate: toDate,
    operating: breakdownList.filter(b => b.category === 'Operating').sort(sortByAccount),
    totalOperating: categoryTotals.Operating,
    investing: breakdownList.filter(b => b.category === 'Investing').sort(sortByAccount),
    totalInvesting: categoryTotals.Investing,
    financing: breakdownList.filter(b => b.category === 'Financing').sort(sortByAccount),
    totalFinancing: categoryTotals.Financing,
    netChange: netChange,
    openingCash: openingCash,
    closingCash: closingCash,
    reconciles: reconciles
  };
}

// ============================================================
// STOCK MANAGEMENT — CORE ENGINE
// ============================================================
// Shared infrastructure for every stock transaction type (GRN, Material
// Issue, Production, Warehouse Movement, Stock Adjustment, Physical
// Count) — same relationship to those screens as saveJournalRecord_ /
// postJournalEntry has to JV and CBT. Each transaction type will be a
// thin wrapper supplying its own lines and offset-account logic against
// this shared, single implementation of WAC math and GL posting — not
// six separate reimplementations.
//
// STORAGE:
//   /stock/ledger/{itemId}/{warehouseId} = { Quantity, AvgCost, TotalValue, UpdatedAt }
//     — current balance only, denormalized for fast lookup, same role
//     as a running account balance. "{warehouseId}" here is actually
//     "location ID" — Warehouse Movement can move stock into a Rack, not
//     just a Warehouse, and a Rack's balance is tracked under its OWN
//     UnitID, entirely separate from its parent warehouse's balance.
//     This is deliberate, confirmed design, not an oversight: goods
//     typically land in a warehouse's main area first (tracked under the
//     warehouse's own ID) and get moved to specific racks later (tracked
//     separately under each rack's ID) — the two are genuinely different
//     locations with their own stock, not one location with a sub-label.
//     CONSEQUENCE FOR REPORTS (not yet built): a "stock on hand" report
//     must be able to show a warehouse's racks EITHER aggregated
//     together (warehouse + all its racks summed as one number) OR
//     broken out separately (each rack's own balance shown on its own
//     line) — nothing currently sums a warehouse and its racks
//     automatically, so a naive per-warehouse report would silently
//     exclude anything sitting in a rack. Whichever report(s) end up
//     showing on-hand quantity need to offer both views explicitly, not
//     default to reporting only the warehouse-level entry.
//   /stock/transactions/{id} = the actual GRN/MI/etc. document (Draft or
//     Posted) — NOT built yet; the first caller (GRN, next) will define
//     its own header/line shape and call into the functions below.
//   /stock/counters/... = voucher number + transaction ref sequences,
//     entirely separate from /gl/counters/... so stock and GL numbering
//     never collide, even though every posted stock transaction also
//     writes an entry into Firestore's journalEntries collection.
//
// VALUATION: Weighted Average Cost (WAC), computed per Item+Warehouse —
// NOT per batch. Batches (Item Master's BatchTracked flag) track
// quantity and expiry only; the cost basis always comes from the
// Item+Warehouse ledger. This is a deliberate decoupling, matching
// common ERP practice — batch/expiry is a traceability concern, WAC is
// a valuation concern, and conflating them would mean a differently-
// costed sub-lot of the same item in the same warehouse, which WAC
// doesn't support.
//
// NEGATIVE STOCK: hard-blocked, not just warned. WAC is mathematically
// meaningless with a negative quantity (you cannot compute a meaningful
// average cost for a quantity below zero), so an outbound line that
// would take Quantity below zero throws rather than proceeding.

function stockLedgerPath_(itemId, warehouseId) {
  return 'stock/ledger/' + itemId + '/' + warehouseId;
}

function getStockLedgerEntry_(idToken, itemId, warehouseId) {
  const entry = firebaseDbRequest_(stockLedgerPath_(itemId, warehouseId), 'get', null, idToken);
  return entry || { Quantity: 0, AvgCost: 0, TotalValue: 0 };
}

// Read-only reference for reporting/UI — current balance for one item in
// one warehouse. Company access is enforced via the item, not here
// directly (callers already resolve the item through getActiveItems /
// getItems, which already apply userCanAccessCompany_).
function getStockLedgerEntryPublic(idToken, itemId, warehouseId) {
  requireUser_(idToken);
  if (!itemId || !warehouseId) throw new Error('Item and warehouse are required.');
  return getStockLedgerEntry_(idToken, itemId, warehouseId);
}

// Same 2-digit-year + company-ref-code + 6-digit-sequence shape as GL
// voucher numbers (see generateVoucherNumber_), but scoped to its own
// /stock/counters/voucher/ namespace so stock and GL numbering never
// collide even though every stock transaction eventually posts a GL entry.
function generateStockVoucherNumber_(idToken, prefix, year, companyId) {
  const companyRefCode = getCompanyRefCode_(idToken, companyId);
  const yy = String(year).slice(-2);
  const counterPath = 'stock/counters/voucher/' + prefix + '/' + year + '/' + companyRefCode;
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return prefix + '-' + yy + '-' + companyRefCode + '-' + String(next).padStart(6, '0');
}

// Lifetime audit sequence across every stock transaction type, mirroring
// generateGlTransactionRef_ — kept in its own /stock/ counter namespace,
// separate from the GL's own TXN-* sequence.
function generateStockTransactionRef_(idToken) {
  const counterPath = 'stock/counters/transactionRef';
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return 'STK-' + String(next).padStart(8, '0');
}

// Voucher prefix and module-routing for each stock transaction type —
// extended here now so moduleIdForEntry_/voucherPrefixForEntry_ (used by
// GL Report's drill-through and by reversal) already know how to route a
// stock-originated GL entry once one exists, without needing to revisit
// those two functions again when each transaction type is actually built.
const STOCK_TRANSACTION_PREFIXES = {
  GRN: 'GRN',
  MaterialIssue: 'MI',
  Production: 'PRD',
  WarehouseMovement: 'WM',
  StockAdjustment: 'ADJ',
  PhysicalCount: 'PC',
  VendorInvoice: 'VINV',
  DeliveryNote: 'DN',
  CustomerInvoice: 'CINV'
};

const STOCK_VOUCHER_TYPE_TO_MODULE = {
  GRN: 'GRN',
  MaterialIssue: 'MATERIALISSUE',
  Production: 'PRODUCTION',
  WarehouseMovement: 'WAREHOUSEMOVEMENT',
  StockAdjustment: 'STOCKADJUSTMENT',
  PhysicalCount: 'PHYSICALCOUNT',
  VendorInvoice: 'VENDORINVOICE',
  DeliveryNote: 'DELIVERYNOTE',
  CustomerInvoice: 'CUSTOMERINVOICE'
};

// Core WAC computation — pure calculation, no writes. Given a set of
// stock-line movements, computes: (a) the resulting ledger balance for
// every item+warehouse touched, (b) the Inventory-account side of the
// underlying GL entry (auto-derived from each item's InventoryAccountID
// — Debit for an inbound line, Credit for an outbound line), and
// mutates each line in place with its resolved UnitCost/TotalValue so
// the caller can persist the finalized transaction afterward.
//
// Processes Out lines before In lines deliberately — a future
// transaction type (Production) will need an In line's cost to be
// DERIVED from the sum of its Out lines' computed costs (RM consumed
// becomes the produced item's cost basis), which requires Out lines to
// be resolved first. Not used by any caller yet, but the ordering is
// already correct for when Production needs it.
//
// lines: [{ ItemID, WarehouseID, Direction: 'In'|'Out', Quantity (base
//   UOM), UnitCost (required for 'In' only — 'Out' always costs at the
//   item+warehouse's CURRENT WAC, computed here, never user-entered),
//   Description, CostCenterID, ProfitCenterID }]
//
// Returns { ledgerUpdates: { "itemId|warehouseId": {Quantity,AvgCost,
//   TotalValue} }, inventoryGlLines: [...] } — inventoryGlLines are in
//   the SAME { AccountCode, Description, Debit, Credit, CostCenterID,
//   ProfitCenterID } shape validateAndNormalizeLines_ already expects,
//   so the caller can concatenate them with its own offset-side lines
//   and reuse that exact same validation (mandatory description, cost
//   center required for Expense-type accounts, company consistency)
//   rather than reimplementing it.
function computeStockMovement_(idToken, itemsData, coaData, lines) {
  if (!lines || !lines.length) throw new Error('Enter at least one line.');

  const ledgerUpdates = {};
  function ledgerKey(itemId, warehouseId) { return itemId + '|' + warehouseId; }
  function currentLedger(itemId, warehouseId) {
    const key = ledgerKey(itemId, warehouseId);
    if (!ledgerUpdates[key]) ledgerUpdates[key] = getStockLedgerEntry_(idToken, itemId, warehouseId);
    return ledgerUpdates[key];
  }

  const inventoryGlLines = [];
  const outLines = lines.filter(l => l.Direction === 'Out');
  const inLines = lines.filter(l => l.Direction === 'In');

  outLines.forEach((line, idx) => {
    const item = itemsData[line.ItemID];
    if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
    if (!line.WarehouseID) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
    const qty = Number(line.Quantity) || 0;
    if (qty <= 0) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');

    const key = ledgerKey(line.ItemID, line.WarehouseID);
    const ledger = currentLedger(line.ItemID, line.WarehouseID);
    if (ledger.Quantity < qty - 0.000001) {
      throw new Error('Line ' + (idx + 1) + ': insufficient stock for ' + item.ItemCode + ' at this warehouse — available ' + ledger.Quantity + ', requested ' + qty + '.');
    }

    const unitCost = ledger.AvgCost;
    const lineValue = Math.round(qty * unitCost * 100) / 100;
    const newQty = Math.round((ledger.Quantity - qty) * 1e6) / 1e6;
    const newTotalValue = Math.round((ledger.TotalValue - lineValue) * 100) / 100;
    const newAvgCost = newQty > 0.000001 ? Math.round((newTotalValue / newQty) * 10000) / 10000 : 0;
    ledgerUpdates[key] = { Quantity: newQty, AvgCost: newAvgCost, TotalValue: newQty > 0.000001 ? newTotalValue : 0 };

    line.UnitCost = unitCost;
    line.TotalValue = lineValue;

    const account = coaData[item.InventoryAccountID];
    if (!account) throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' has no valid Inventory account configured.');
    inventoryGlLines.push({
      AccountCode: account.AccountCode, Debit: 0, Credit: lineValue,
      Description: line.Description || (item.ItemCode + ' — ' + item.ItemName),
      CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || ''
    });
  });

  inLines.forEach((line, idx) => {
    const item = itemsData[line.ItemID];
    if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
    if (!line.WarehouseID) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
    const qty = Number(line.Quantity) || 0;
    if (qty <= 0) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');
    const unitCost = Number(line.UnitCost);
    // Strictly greater than zero, not >= 0 — a $0 line produces a
    // worthless GL entry with neither a real debit nor credit, which
    // validateAndNormalizeLines_ correctly rejects later with a much
    // more confusing message ("enter a debit or credit amount") than
    // catching it here, at the actual source, with a clear one.
    if (!(unitCost > 0)) throw new Error('Line ' + (idx + 1) + ': enter a unit cost greater than zero for ' + item.ItemCode + '.');

    const key = ledgerKey(line.ItemID, line.WarehouseID);
    const ledger = currentLedger(line.ItemID, line.WarehouseID);
    const lineValue = Math.round(qty * unitCost * 100) / 100;
    const newQty = Math.round((ledger.Quantity + qty) * 1e6) / 1e6;
    const newTotalValue = Math.round((ledger.TotalValue + lineValue) * 100) / 100;
    const newAvgCost = Math.round((newTotalValue / newQty) * 10000) / 10000;
    ledgerUpdates[key] = { Quantity: newQty, AvgCost: newAvgCost, TotalValue: newTotalValue };

    line.UnitCost = unitCost;
    line.TotalValue = lineValue;

    const account = coaData[item.InventoryAccountID];
    if (!account) throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' has no valid Inventory account configured.');
    inventoryGlLines.push({
      AccountCode: account.AccountCode, Debit: lineValue, Credit: 0,
      Description: line.Description || (item.ItemCode + ' — ' + item.ItemName),
      CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || ''
    });
  });

  return { ledgerUpdates: ledgerUpdates, inventoryGlLines: inventoryGlLines };
}

// Commits ledger balance changes computed by computeStockMovement_ — a
// separate step from the computation itself so a transaction type's
// post<Type>() wrapper can validate and post the GL entry FIRST (via
// validateAndNormalizeLines_ + writing to Firestore's journalEntries
// collection, exactly
// like postJournalEntry does) and only call this once that has
// succeeded. This ordering means a rejected GL posting (bad account,
// unbalanced lines, missing description) never leaves a stock ledger
// update behind with no corresponding GL entry.
function commitStockLedgerUpdates_(idToken, ledgerUpdates) {
  const now = new Date().toISOString();
  Object.keys(ledgerUpdates).forEach(key => {
    const parts = key.split('|');
    const itemId = parts[0], warehouseId = parts[1];
    const update = ledgerUpdates[key];
    firebaseDbRequest_(stockLedgerPath_(itemId, warehouseId), 'put', {
      Quantity: update.Quantity, AvgCost: update.AvgCost, TotalValue: update.TotalValue, UpdatedAt: now
    }, idToken);
  });
}

// Writes the GL entry for a stock transaction, mirroring postJournalEntry's
// record shape and mechanics exactly (voucher numbering, transaction ref,
// Posted status immediately — stock transactions have no separate GL
// draft stage, since the stock transaction ITSELF is the draft/posted
// document). rawGlLines = inventoryGlLines (from computeStockMovement_)
// concatenated with the caller's own offset-side lines. Returns the new
// GL entry's ID and voucher number so the caller can store LinkedJVID
// and the matching stock voucher number on its own transaction record.
//
// Caller MUST already hold LockService.getScriptLock() — no internal
// locking here, consistent with generateVoucherNumber_'s same contract.
// extraFields (optional): merged into the GL record before it's
// written — used by Phase 3's commit-attempt marker to tag each GL
// entry with the CommitAttemptID and source stock transaction ID that
// produced it, so a stuck 'Committing' transaction (see
// beginCommitAttempt_/reconcileStockGlCommits) can be traced to
// whichever GL entry, if any, actually made it through.
function writeStockGlEntry_(idToken, user, stockTransactionType, transactionDate, description, reference, rawGlLines, dimensions, extraFields) {
  const dim = dimensions || {};
  if (!dim.CompanyID) throw new Error('Select a Company for this transaction.');
  if (!userCanAccessCompany_(user.profile, dim.CompanyID)) throw new Error('You do not have access to that company.');

  const coaData = getCoaData_(idToken);
  const normalized = validateAndNormalizeLines_(rawGlLines, coaData, dim.CompanyID);
  const totalDebit = normalized.totalDebit;
  const totalCredit = normalized.totalCredit;
  if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
    throw new Error('Transaction does not balance: Debit ' + totalDebit.toFixed(2) + ' vs Credit ' + totalCredit.toFixed(2) + '.');
  }

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const year = (new Date(transactionDate)).getFullYear() || new Date().getFullYear();
  const prefix = STOCK_TRANSACTION_PREFIXES[stockTransactionType];
  if (!prefix) throw new Error('Unknown stock transaction type: ' + stockTransactionType);

  const jvNumber = generateStockVoucherNumber_(idToken, prefix, year, dim.CompanyID);
  const transactionRef = generateStockTransactionRef_(idToken);
  const newId = 'STKJV-' + Utilities.getUuid().split('-')[0].toUpperCase();

  const record = Object.assign({
    JVNumber: jvNumber, TransactionRef: transactionRef, JVDate: transactionDate,
    Description: description, Reference: reference || '',
    Status: 'Posted', Lines: normalized.lines,
    TotalDebit: Math.round(totalDebit * 100) / 100, TotalCredit: Math.round(totalCredit * 100) / 100,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    PostedAt: now, PostedBy: actor, ReversedByJV: '',
    VoucherType: stockTransactionType, SelectedAccountCode: '',
    CurrencyCode: dim.CurrencyCode || '', CompanyID: dim.CompanyID,
    DivisionID: dim.DivisionID || '', BranchID: dim.BranchID || '',
    CostCenterID: dim.CostCenterID || '', ProfitCenterID: dim.ProfitCenterID || ''
  }, extraFields || {});

  firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, newId, record);
  return { jvId: newId, jvNumber: jvNumber, transactionRef: transactionRef };
}

// ============================================================
// STOCK-TO-GL COMMIT SAFETY (Phase 3 of the GL/Firestore migration)
// ============================================================
// Firestore and RTDB have no shared transaction coordinator — nothing
// here makes "write the GL entry, then update the stock ledger, then
// finalize the source transaction" atomic across the two. That isn't
// achievable, and this doesn't attempt it. What it does instead:
// narrow the window where the two could disagree, and make any
// disagreement that does happen detectable and resolvable rather than
// silent — see reconcileStockGlCommits below for the other half of
// this.
//
// The pattern, used by every commit* and reverse* stock function:
//   1. Once validation has fully passed and only the writes themselves
//      remain as a risk, call beginCommitAttempt_ — patches the source
//      transaction to Status: 'Committing' with a fresh CommitAttemptID.
//   2. Call writeStockGlEntry_ wrapped in its OWN try/catch, passing
//      that CommitAttemptID as an extra field so the GL entry is
//      traceable back to this attempt. This call is the one place
//      where "it threw" reliably means "nothing was written yet" —
//      writeStockGlEntry_ fully validates before it ever writes. If it
//      throws here, abandonCommitAttempt_ reverts the marker and the
//      original error propagates exactly as it did before this
//      retrofit — an ordinary, safely-retriable failure.
//   3. Past that point, a GL entry genuinely exists. Nothing from here
//      on ever silently reverts — any further failure (the ledger
//      update, the finalize patch) leaves the transaction sitting at
//      'Committing' on purpose, for the sweep to find.
//   4. finalizeCommitAttempt_ clears the marker and moves to the real
//      final status once every write has actually succeeded.

function beginCommitAttempt_(idToken, transactionId, actor, collectionPath) {
  const attemptId = Utilities.getUuid();
  const now = new Date().toISOString();
  firebaseDbRequest_((collectionPath || 'stock/transactions') + '/' + transactionId, 'patch', {
    Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
    UpdatedAt: now, UpdatedBy: actor
  }, idToken);
  return attemptId;
}

// Only ever called when nothing has actually been written yet — see
// the ordering guarantee in the section comment above.
function abandonCommitAttempt_(idToken, transactionId, priorStatus, actor, collectionPath) {
  const now = new Date().toISOString();
  firebaseDbRequest_((collectionPath || 'stock/transactions') + '/' + transactionId, 'patch', {
    Status: priorStatus, CommitAttemptID: '', CommitAttemptStartedAt: '',
    UpdatedAt: now, UpdatedBy: actor
  }, idToken);
}

// extraFields carries whatever module-specific fields the final Posted
// record needs beyond the common ones (e.g. Lines — the shape varies
// per module, GRN's are inbound movement lines, Physical Count's are
// finalLines, etc.). collectionPath: optional, defaults to
// 'stock/transactions' — every one of the five original stock modules
// passes nothing here and is completely unaffected. Vendor Invoice
// Processing is the first caller to pass something else ('vendorInvoices'),
// since its own records live in a different collection but carry the
// identical cross-database risk shape (a Firestore GL write paired
// with an RTDB side effect — marking the matched GRNs as invoiced,
// same role Production's Job Order update and Stock Adjustment's
// allocation call already play) that this whole pattern exists for.
function finalizeCommitAttempt_(idToken, transactionId, glResult, extraFields, actor, collectionPath) {
  const now = new Date().toISOString();
  firebaseDbRequest_((collectionPath || 'stock/transactions') + '/' + transactionId, 'patch', Object.assign({
    Status: 'Posted', TransactionNumber: glResult.jvNumber, TransactionRef: glResult.transactionRef,
    LinkedJVID: glResult.jvId, CommitAttemptID: '', CommitAttemptStartedAt: '',
    PostedAt: now, PostedBy: actor, UpdatedAt: now, UpdatedBy: actor
  }, extraFields || {}), idToken);
}

// Admin-triggered, not scheduled — deliberately, so a stuck commit is
// something a person deliberately looks at and resolves, not something
// silently retried or silently ignored in the background. Scans every
// collection that uses this commit-marker pattern — the original
// stock/transactions, plus vendorInvoices now that Vendor Invoice
// Processing uses the same pattern — finds anything still sitting at
// 'Committing' past a grace window (avoids flagging an attempt that's
// still genuinely mid-execution), checks whether a matching GL entry
// actually made it to Firestore, and reports what it finds — it never
// auto-resumes or auto-reverts anything itself. That's deliberate:
// from the stuck state alone there is no safe way to tell whether the
// RTDB-side effect (a stock ledger update, or a GRN's invoiced flag)
// succeeded before whatever failed next, and guessing wrong in either
// direction (re-running it when it already happened, or leaving it
// undone when it didn't) is worse than surfacing the ambiguity for a
// person to resolve with actual judgment.
function reconcileStockGlCommits(idToken) {
  const user = requireUser_(idToken);
  requireAdminRole_(user);

  const graceMs = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  const collectionsToScan = ['stock/transactions', 'vendorInvoices'];

  const stuck = [];
  collectionsToScan.forEach(collectionPath => {
    const allTx = firebaseDbRequest_(collectionPath, 'get', null, idToken) || {};
    Object.keys(allTx)
      .map(id => Object.assign({ id: id, collectionPath: collectionPath }, allTx[id]))
      .filter(tx => tx.Status === 'Committing')
      .filter(tx => {
        const startedAt = tx.CommitAttemptStartedAt ? new Date(tx.CommitAttemptStartedAt).getTime() : 0;
        return !startedAt || (now - startedAt) > graceMs;
      })
      .forEach(tx => stuck.push(tx));
  });

  if (!stuck.length) {
    return { checked: 0, findings: [] };
  }

  const findings = stuck.map(tx => {
    const matches = tx.CommitAttemptID
      ? firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, [['CommitAttemptID', 'EQUAL', tx.CommitAttemptID]], null, null)
      : [];
    return {
      transactionId: tx.id,
      collectionPath: tx.collectionPath,
      transactionType: tx.TransactionType || '',
      description: tx.Description || '',
      commitAttemptId: tx.CommitAttemptID || '',
      commitAttemptStartedAt: tx.CommitAttemptStartedAt || '',
      glEntryFound: matches.length > 0,
      glEntryId: matches.length ? matches[0]._id : '',
      glEntryNumber: matches.length ? matches[0].JVNumber : '',
      guidance: matches.length
        ? 'A GL entry (' + matches[0].JVNumber + ') was written for this attempt. Check whether the RTDB-side effect (stock ledger, or GRN invoiced-flag) reflects this transaction — if it does, the only thing that failed was the final status patch, and this can be safely finalized manually to Posted with LinkedJVID ' + matches[0]._id + '. If it does NOT reflect it, this needs full manual review before touching anything, since re-running the commit could double-post.'
        : 'No matching GL entry was found for this attempt — the failure most likely happened before any write completed. Check whether the RTDB-side effect reflects this transaction; if not, it is very likely safe to reset this transaction back to a postable status and try posting it again from the module screen.'
    };
  });

  return { checked: stuck.length, findings: findings };
}

// ============================================================
// GOODS RECEIPT (GRN)
// ============================================================
// First real transaction type built on the Core Stock Engine — pure
// inbound movement. Every line increases stock at a user-entered unit
// cost (unlike an outbound line, which always costs at the current
// WAC — a receipt is exactly how a NEW cost enters the system).
//
// GL shape: Dr Inventory (auto, per item, via computeStockMovement_) /
// Cr Offset Account (user-picked at posting time — e.g. a "GRN
// Clearing" or Accounts Payable account; there's no PO/AP module yet to
// supply this automatically). Same "one auto side + one user-picked
// side" shape as CBT's ledger + opposite account.
//
// Storage: /stock/transactions/{id}, TransactionType: 'GRN'.

function saveGrnDraft(idToken, grnData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'GRN');

    const grnId = String(grnData.GRNID || '').trim();
    const transactionDate = String(grnData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(grnData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(grnData.Reference || '').trim();
    const companyId = String(grnData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(grnData.DivisionID || '').trim();
    const branchId = String(grnData.BranchID || '').trim();
    const costCenterId = String(grnData.CostCenterID || '').trim();
    const profitCenterId = String(grnData.ProfitCenterID || '').trim();

    // Every GRN needs a determinable vendor, whether every line is
    // PO-sourced, fully direct, or a mix — Vendor Invoice's own GRN
    // picker (filtered by vendor) needs this on every GRN it might
    // ever list, not just PO-sourced ones.
    const vendorId = String(grnData.VendorID || '').trim();
    if (!vendorId) throw new Error('Select a Vendor for this transaction.');
    const vendorData = firebaseDbRequest_('vendors/' + vendorId, 'get', null, idToken);
    if (!vendorData || vendorData.Status !== 'Active') throw new Error('Unknown or inactive Vendor.');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    // Source POs referenced by any line, fetched once and cached here
    // rather than per-line — a GRN commonly pulls several lines from
    // the same PO. Confirmed design: a single GRN is restricted to
    // exactly one vendor, even across multiple POs — enforced below by
    // checking every referenced PO's own VendorID against this GRN's.
    const poCache = {};
    function loadSourcePO_(poId) {
      if (!poCache.hasOwnProperty(poId)) {
        poCache[poId] = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
      }
      return poCache[poId];
    }

    const rawLines = grnData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const itemId = String(line.ItemID || '').trim();
      if (!itemId) return; // skip blank trailing row

      const item = itemsData[itemId];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
      const warehouseId = String(line.WarehouseID || '').trim();
      if (!warehouseId) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
      const wh = orgUnitsData[warehouseId];
      if (!wh || wh.Type !== 'Warehouse') throw new Error('Line ' + (idx + 1) + ': warehouse not found.');

      const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
      const enteredQty = Number(line.EnteredQuantity);
      if (!(enteredQty > 0)) throw new Error('Line ' + (idx + 1) + ': enter a quantity greater than zero.');

      // Convert entered quantity into the item's BASE UOM — the stock
      // ledger and WAC are always kept in base units regardless of which
      // unit was used to enter the transaction (e.g. 5 BOX -> 1000 KG).
      let baseQty;
      if (enteredUomId === item.UOMID) {
        baseQty = enteredQty;
      } else if (enteredUomId === item.AltUOMID) {
        baseQty = enteredQty * (item.ConversionFactor || 0);
        if (!(baseQty > 0)) throw new Error('Line ' + (idx + 1) + ': item has no valid alternate UOM conversion factor set.');
      } else {
        throw new Error('Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
      }

      // Enforce the UOM's own decimal policy on the ENTERED quantity.
      const enteredUom = uomsData[enteredUomId];
      if (enteredUom && !enteredUom.AllowDecimals && Math.abs(enteredQty - Math.round(enteredQty)) > 0.0001) {
        throw new Error('Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
      }

      // PO-sourced line: UnitCost is locked to the PO line's own price,
      // server-side, regardless of whatever the client sends — a
      // "read-only" field enforced only in the browser is not actually
      // enforced at all. Over-receipt (quantity beyond what's left on
      // the PO line) is deliberately never checked or blocked here —
      // that's flagged for visibility in the PO's own line display
      // instead, never gated.
      const sourcePOId = String(line.SourcePOID || '').trim();
      const sourcePOLineId = String(line.SourcePOLineID || '').trim();
      let unitCost;
      if (sourcePOId && sourcePOLineId) {
        const sourcePO = loadSourcePO_(sourcePOId);
        if (!sourcePO || sourcePO.Status !== 'Approved') throw new Error('Line ' + (idx + 1) + ': the referenced Purchase Order is no longer approved and available for receipt.');
        if (sourcePO.CompanyID !== companyId) throw new Error('Line ' + (idx + 1) + ': the referenced Purchase Order belongs to a different Company.');
        if (sourcePO.VendorID !== vendorId) throw new Error('Line ' + (idx + 1) + ': the referenced Purchase Order belongs to a different Vendor than this GRN — a GRN can only draw from one Vendor\'s Purchase Orders.');
        const sourcePOLine = (sourcePO.Lines || []).find(l => l.LineID === sourcePOLineId);
        if (!sourcePOLine) throw new Error('Line ' + (idx + 1) + ': the referenced Purchase Order line was not found.');
        if (sourcePOLine.ItemCode !== item.ItemCode) throw new Error('Line ' + (idx + 1) + ': item does not match the referenced Purchase Order line — a PO-sourced line\'s item cannot be changed independently of its source.');
        unitCost = Number(sourcePOLine.UnitPrice) || 0;
      } else {
        unitCost = Number(line.UnitCost);
      }
      // See computeStockMovement_'s identical check for why this is > 0,
      // not >= 0.
      if (!(unitCost > 0)) throw new Error('Line ' + (idx + 1) + ': enter a unit cost greater than zero.');

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
        throw new Error('Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
      }

      lines.push({
        LineNo: lines.length + 1,
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        WarehouseID: warehouseId,
        EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
        Quantity: Math.round(baseQty * 1e6) / 1e6,
        UnitCost: Math.round(unitCost * 10000) / 10000,
        BatchNumber: String(line.BatchNumber || '').trim(),
        ExpiryDate: String(line.ExpiryDate || '').trim(),
        CostCenterID: String(line.CostCenterID || '').trim(),
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription,
        SourcePOID: sourcePOId, SourcePOLineID: sourcePOLineId
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'GRN',
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
      VendorID: vendorId,
      Lines: lines,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (grnId) {
      const existing = firebaseDbRequest_('stock/transactions/' + grnId, 'get', null, idToken);
      if (!existing) throw new Error('GRN not found.');
      // Rejected is editable too now, same as Draft — a resubmission
      // reuses this exact save path. Note: this save always sets
      // Status back to 'Draft' regardless of what it was before (the
      // existing, pre-approval behavior of this function, unchanged
      // here) — so an explicit "Save as Draft" on a Rejected GRN
      // deliberately drops it out of "awaiting resubmission" into an
      // ordinary work-in-progress draft, rather than silently keeping
      // the Rejected label through a save the user didn't ask to post.
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected GRNs can be edited.');
      firebaseDbRequest_('stock/transactions/' + grnId, 'patch', fields, idToken);
      return { success: true, grnId: grnId };
    }

    const newId = 'GRND-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, grnId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Resolves a company's fixed GRN Clearing Account (configured once in
// Company Master Data, not chosen per-transaction — see saveCompany's
// comment for why). Throws a clear, actionable error if the company
// hasn't been configured yet, rather than falling back to anything.
// GRN-to-PO linking (Phase A of the AP build). Returns Approved POs for
// a given company AND vendor — vendor is required here, not optional,
// since a single GRN is restricted to exactly one vendor even when it
// draws from multiple POs (confirmed design decision — see the GRN
// header's own VendorID validation in saveGrnDraft below). Each line
// carries its own RemainingQuantity (Quantity - ReceivedQuantity) so
// the client can show what's actually still open, but this is
// informational only — over-receipt is explicitly allowed (flagged in
// the PO's own line display, never blocked here or anywhere else).
function getEligibleApprovedPOsForGRN(idToken, companyId, vendorId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'GRN', 'access', user.profile.role)) {
    throw new Error('You do not have access to Goods Receipt.');
  }
  if (!companyId || !vendorId) return [];

  const data = firebaseDbRequest_('purchaseOrders', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ POID: id }, data[id]))
    .filter(po => po.Status === 'Approved' && po.CompanyID === companyId && po.VendorID === vendorId)
    .map(po => Object.assign({}, po, {
      Lines: (po.Lines || []).map(l => Object.assign({}, l, {
        RemainingQuantity: Math.max(0, Number(l.Quantity || 0) - Number(l.ReceivedQuantity || 0))
      }))
    }));
}

// Sales Order counterpart — Reserved or Partially Reserved SOs for the
// given company AND customer. Each line's own RemainingQuantity is
// Ordered minus already-Delivered, same shape as PO's own
// RemainingQuantity above; separately, ReservedQuantity is what's
// currently actually set aside and physically shippable right now —
// the two can differ when a line was only partially reserved due to a
// stock shortfall at confirm time, so the real cap on what Delivery
// Note can ship for a line is whichever of the two is smaller, not
// RemainingQuantity alone.
function getEligibleSOsForDelivery(idToken, companyId, customerId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'DELIVERYNOTE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Delivery Note.');
  }
  if (!companyId || !customerId) return [];

  const data = firebaseDbRequest_('salesOrders', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ SOID: id }, data[id]))
    .filter(so => (so.Status === 'Reserved' || so.Status === 'Partially Reserved') && so.CompanyID === companyId && so.CustomerID === customerId)
    .map(so => {
      const reservations = getReservationsForSource_(idToken, 'SalesOrder', so.SOID).filter(r => r.Status === 'Active');
      return Object.assign({}, so, {
        Lines: (so.Lines || []).map(l => {
          const reserved = reservations.filter(r => r.SourceLineID === l.LineID).reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
          const remaining = Math.max(0, Number(l.OrderedQuantity || 0) - Number(l.DeliveredQuantity || 0));
          return Object.assign({}, l, { RemainingQuantity: remaining, ReservedQuantity: reserved, MaxShippable: Math.min(remaining, reserved) });
        })
      });
    });
}

// The received-quantity counterpart to updateJobOrderLineProgressAfterProduction_
// — same role (accumulate progress on a line once a posting is
// genuinely, finally committed), adapted to PO's storage shape: Lines
// is a single embedded array on the PO document, not individually
// addressable nodes the way jobOrderLines are, so this reads the whole
// PO, mutates the matching line in place, and writes the whole Lines
// array back. Caller MUST already hold LockService.getScriptLock() —
// same precondition as commitGrnPosting_ itself, which is the only
// caller, so this inherits that lock rather than needing its own.
function updatePOLineReceivedQuantity_(idToken, poId, poLineId, receivedQty) {
  if (!poId || !poLineId) return;
  const po = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
  if (!po || !po.Lines) return;
  const lines = po.Lines.map(l => l.LineID === poLineId
    ? Object.assign({}, l, { ReceivedQuantity: Number(l.ReceivedQuantity || 0) + Number(receivedQty || 0) })
    : l);
  firebaseDbRequest_('purchaseOrders/' + poId, 'patch', { Lines: lines }, idToken);
}

// Same role on the sales side as updatePOLineReceivedQuantity_ above —
// tracks how much of an SO line has actually shipped, independent of
// its live reservation figure (which shrinks as stock ships, per
// refreshSalesOrderReservationStatus_'s own comment on why "covered"
// needs both numbers together).
function updateSOLineDeliveredQuantity_(idToken, soId, soLineId, deliveredQty) {
  if (!soId || !soLineId) return;
  const so = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
  if (!so || !so.Lines) return;
  const lines = so.Lines.map(l => l.LineID === soLineId
    ? Object.assign({}, l, { DeliveredQuantity: Number(l.DeliveredQuantity || 0) + Number(deliveredQty || 0) })
    : l);
  firebaseDbRequest_('salesOrders/' + soId, 'patch', { Lines: lines }, idToken);
}

function rollbackSOLineDeliveredQuantity_(idToken, soId, soLineId, reversedQty) {
  if (!soId || !soLineId) return;
  const so = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
  if (!so || !so.Lines) return;
  const lines = so.Lines.map(l => l.LineID === soLineId
    ? Object.assign({}, l, { DeliveredQuantity: Math.max(0, Number(l.DeliveredQuantity || 0) - Number(reversedQty || 0)) })
    : l);
  firebaseDbRequest_('salesOrders/' + soId, 'patch', { Lines: lines }, idToken);
}

// Reduces this line's own Active reservation(s) by exactly what just
// shipped — the stock is genuinely gone now, not sitting reserved.
// Same underlying primitive releaseStockForSalesOrderLine already
// uses (oldest reservation first, deterministic not meaningful), but
// called automatically as a direct consequence of shipping rather
// than as a manual user action, and with no "reason" required — the
// delivery itself IS the reason.
function consumeReservationForDelivery_(idToken, soId, soLineId, shippedQty) {
  const lineReservations = getReservationsForSource_(idToken, 'SalesOrder', soId)
    .filter(r => r.Status === 'Active' && r.SourceLineID === soLineId)
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
  let remaining = Math.min(shippedQty, lineReservations.reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0));
  lineReservations.forEach(r => {
    if (remaining <= 0) return;
    const toReduce = Math.min(remaining, Number(r.Quantity));
    reduceStockReservationQuantity_(idToken, r.ReservationID, toReduce, 'Consumed by Delivery Note');
    remaining -= toReduce;
  });
}

// The reversal counterpart — decrements rather than deletes any
// tracking, same reasoning as every other reversal-side rollback this
// session: a reversed GRN's own record stays Posted forever as an
// audit trail, so this only ever needs to undo the RECEIVED-QUANTITY
// side effect, never anything about the GRN record itself.
function rollbackPOLineReceivedQuantity_(idToken, poId, poLineId, reversedQty) {
  if (!poId || !poLineId) return;
  const po = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
  if (!po || !po.Lines) return;
  const lines = po.Lines.map(l => l.LineID === poLineId
    ? Object.assign({}, l, { ReceivedQuantity: Math.max(0, Number(l.ReceivedQuantity || 0) - Number(reversedQty || 0)) })
    : l);
  firebaseDbRequest_('purchaseOrders/' + poId, 'patch', { Lines: lines }, idToken);
}

function resolveGrnClearingAccount_(idToken, companyId) {
  const companies = firebaseDbRequest_('companies', 'get', null, idToken) || {};
  const company = companies[companyId];
  if (!company) throw new Error('Company not found.');
  if (!company.GrnClearingAccountID) {
    throw new Error('This company has no GRN Clearing Account configured. Set one in Company Master Data before posting a GRN.');
  }
  return company.GrnClearingAccountID;
}

// Generic resolver for every OTHER fixed, per-company account Vendor
// Invoice Processing needs — Accounts Payable, Discount Received,
// Input Tax, Round Off. Always throws if missing; it's the CALLER's
// job to decide whether a given account is even needed for a specific
// invoice (Discount Received, for instance, is only actually resolved
// when an invoice has a non-zero discount — an invoice with no
// discount at all shouldn't be blocked by a company that's simply
// never bothered configuring an account it's never needed yet).
function resolveCompanyFixedAccount_(idToken, companyId, fieldName, label) {
  const companies = firebaseDbRequest_('companies', 'get', null, idToken) || {};
  const company = companies[companyId];
  if (!company) throw new Error('Company not found.');
  if (!company[fieldName]) {
    throw new Error('This company has no ' + label + ' configured. Set one in Company Master Data before posting this invoice.');
  }
  return company[fieldName];
}

// Same "fixed, per-company setting" treatment as GRN's clearing account —
// see saveCompany's comment for why this can't be picked per-transaction.
function postGrn(idToken, grnId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + grnId, 'get', null, idToken);
    if (!existing) throw new Error('GRN not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'GRN');
    // Draft (first posting attempt) or Rejected (resubmitting) — same
    // symmetry established for every other module's own retrofit.
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected GRNs can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('This GRN has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount is the goods value being received — quantity x
    // unit cost, both user-entered on the GRN's own lines, summed
    // directly here rather than via computeStockMovement_. That
    // function also reads the LIVE stock ledger and validates
    // scenarios this always-inbound module never uses ("Out" lines),
    // so computing the gate amount this way keeps checking the gate
    // completely free of side effects — nothing about the stock
    // ledger or GL is touched unless this GRN actually proceeds to
    // commitGrnPosting_ below.
    const previewAmount = existing.Lines.reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0);

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'GRN', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'GRN', grnId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no stock ledger change, no GL
      // entry — until this is actually approved (see
      // decideGrnApproval, which is where commitGrnPosting_ runs in
      // that case instead of here).
      firebaseDbRequest_('stock/transactions/' + grnId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitGrnPosting_(idToken, user, existing, grnId);
    return { success: true, grnId: grnId, grnNumber: result.grnNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The actual stock-ledger-and-GL commit — the real work postGrn() always
// did, extracted so it can run from EITHER postGrn() itself (no approval
// gate configured) OR decideGrnApproval() (once fully approved). Caller
// MUST already hold LockService.getScriptLock().
function commitGrnPosting_(idToken, user, existing, grnId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);

  const clearingAccountId = resolveGrnClearingAccount_(idToken, existing.CompanyID);
  const offsetAccount = coaData[clearingAccountId];
  if (!offsetAccount || !offsetAccount.IsPostable) throw new Error('This company\'s configured GRN Clearing Account is no longer valid — check it in Company Master Data.');

  // Every GRN line is inbound.
  const movementLines = existing.Lines.map(l => Object.assign({ Direction: 'In' }, l));
  const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

  const totalValue = movement.inventoryGlLines.reduce((sum, l) => sum + l.Debit, 0);
  const offsetLine = {
    AccountCode: offsetAccount.AccountCode, Debit: 0, Credit: Math.round(totalValue * 100) / 100,
    Description: existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
  };

  const actor = user.profile.username || user.uid;
  // Everything above this point is pure validation and read-only
  // computation — nothing written yet, so any failure up to here is
  // ordinary and safely retriable, exactly as before this retrofit.
  // From here on, see the Phase 3 section comment above
  // beginCommitAttempt_ for the full reasoning.
  const attemptId = beginCommitAttempt_(idToken, grnId, actor);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'GRN', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat([offsetLine]),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: grnId });
  } catch (err) {
    abandonCommitAttempt_(idToken, grnId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
  finalizeCommitAttempt_(idToken, grnId, glResult, { Lines: movementLines }, actor);

  // PO received-quantity progress only ever updates once the
  // transaction is genuinely, finally committed — same invariant
  // Production's Job Order update and Stock Adjustment's allocation
  // call already established: if the GL or ledger write had failed
  // above, execution never reaches here at all. Direct (non-PO) lines
  // simply contribute nothing, same as everywhere else this session.
  movementLines.forEach(l => {
    if (l.SourcePOID && l.SourcePOLineID) {
      updatePOLineReceivedQuantity_(idToken, l.SourcePOID, l.SourcePOLineID, l.Quantity);
    }
  });

  return { grnNumber: glResult.jvNumber };
}

// Does NOT use the shared decideApprovalForDocument_ helper — that one
// assumes a simple "patch Status to a fixed value" on approval, but a
// GRN's approval has real work to do at that moment (the stock ledger
// and GL commit itself), not just a status flip. recordApprovalDecision
// is still reused for the actual decision-recording; only the
// "what happens once resolved" part is GRN-specific here.
function decideGrnApproval(idToken, grnId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'GRN');
    const existing = firebaseDbRequest_('stock/transactions/' + grnId, 'get', null, idToken);
    if (!existing) throw new Error('GRN not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This GRN is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this GRN.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    if (result.status === 'Approved') {
      // NOW, and only now, does the actual stock ledger update and GL
      // posting happen.
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        commitGrnPosting_(idToken, user, existing, grnId);
      } finally {
        lock.releaseLock();
      }
    } else if (result.status === 'Rejected') {
      const now = new Date().toISOString();
      firebaseDbRequest_('stock/transactions/' + grnId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(),
        UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
      }, idToken);
    }
    // Still Pending (more required levels haven't decided yet) —
    // nothing on the GRN record changes until the instance resolves.
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteGrnDraft(idToken, grnId) {
  try {
    const user = requireUser_(idToken);
    const existing = firebaseDbRequest_('stock/transactions/' + grnId, 'get', null, idToken);
    if (!existing) throw new Error('GRN not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, 'GRN');
    if (existing.Status !== 'Draft') throw new Error('Only draft GRNs can be deleted. Posted GRNs must be reversed instead.');
    firebaseDbRequest_('stock/transactions/' + grnId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getGrnEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'GRN', 'access', user.profile.role)) {
    throw new Error('You do not have access to Goods Receipt.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ GRNID: id }, data[id]))
    .filter(e => e.TransactionType === 'GRN')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Reversing a GRN takes the SAME stock back out — flips every line to
// Direction 'Out'. computeStockMovement_'s own negative-stock guard
// naturally protects this: if some of the received stock has already
// been consumed or issued elsewhere by the time someone tries to
// reverse the receipt, the reversal is rejected rather than silently
// pushing a ledger negative. No special-case logic needed for that —
// it falls out of the same validation every outbound line already gets.
function reverseGrn(idToken, grnId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + grnId, 'get', null, idToken);
    if (!existing) throw new Error('GRN not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'GRN');
    if (existing.Status !== 'Posted') throw new Error('Only posted GRNs can be reversed.');
    if (existing.ReversedByGRN) throw new Error('This GRN has already been reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    // Re-resolves the company's CURRENT clearing account rather than
    // trusting anything stored on the original GRN — if it's been
    // changed in Company Master Data since, the reversal should still
    // use whatever is configured now, same account the original entry
    // would use if it were posted today.
    const clearingAccountId = resolveGrnClearingAccount_(idToken, existing.CompanyID);
    const offsetAccount = coaData[clearingAccountId];
    if (!offsetAccount || !offsetAccount.IsPostable) throw new Error('This company\'s configured GRN Clearing Account is no longer valid — check it in Company Master Data.');

    const movementLines = existing.Lines.map(l => Object.assign({}, l, { Direction: 'Out' }));
    const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

    const totalValue = movement.inventoryGlLines.reduce((sum, l) => sum + l.Credit, 0);
    const offsetLine = {
      AccountCode: offsetAccount.AccountCode, Debit: Math.round(totalValue * 100) / 100, Credit: 0,
      Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    };

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'GRND-' + Utilities.getUuid().split('-')[0].toUpperCase();

    // Everything above this point is pure validation and read-only
    // computation — nothing written yet, so any failure up to here is
    // ordinary and safely retriable, same as before this retrofit. The
    // new reversal record doesn't exist yet either, unlike commitGrnPosting_
    // where the source record already existed — so "begin" here means
    // creating it fresh, already marked Committing, rather than patching
    // an existing one.
    const attemptId = Utilities.getUuid();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'GRN', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfGRN: grnId, ReversedByGRN: '', VendorID: existing.VendorID || ''
    }, idToken);

    let glResult;
    try {
      glResult = writeStockGlEntry_(idToken, user, 'GRN', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat([offsetLine]),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      // Nothing was written for this reversal yet, and nothing else
      // references the placeholder record — safe to remove it
      // entirely rather than leave a meaningless stuck attempt behind.
      firebaseDbRequest_('stock/transactions/' + newId, 'delete', null, idToken);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);

    // Deliberately patches the ORIGINAL record's ReversedByGRN before
    // finalizing the new reversal to Posted, not after — if only one
    // of these two writes can be guaranteed to have happened when
    // something goes wrong, this order guarantees it's never possible
    // for the original to look un-reversed while a fully-Posted
    // reversal already exists (which would allow a second, duplicate
    // reversal to be triggered). The cost is the opposite, safer
    // failure shape: the original could show as reversed while its
    // reversal record is still visibly stuck at Committing — exactly
    // what reconcileStockGlCommits exists to catch and surface.
    firebaseDbRequest_('stock/transactions/' + grnId, 'patch', { ReversedByGRN: newId }, idToken);
    finalizeCommitAttempt_(idToken, newId, glResult, { Lines: movementLines }, actor);

    // Roll back exactly this GRN's own contribution to each PO line it
    // touched — same reasoning as Production's rollback: a reversed
    // GRN's own record never changes its own Status, so this is what
    // actually undoes the received-quantity side effect.
    movementLines.forEach(l => {
      if (l.SourcePOID && l.SourcePOLineID) {
        rollbackPOLineReceivedQuantity_(idToken, l.SourcePOID, l.SourcePOLineID, l.Quantity);
      }
    });

    return { success: true, grnId: newId, grnNumber: glResult.jvNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// MATERIAL ISSUE (MI)
// ============================================================
// Second transaction type on the Core Stock Engine — pure outbound
// movement. Every line decreases stock at the CURRENT WAC (never
// user-entered — that's what distinguishes an outbound line from a
// GRN's inbound one), and this is the first transaction type that
// actually exercises computeStockMovement_'s negative-stock guard, since
// GRN never issues anything out.
//
// GL shape: Dr Consumption (auto, per item, via resolveItemExpenseAccount_
// with reason 'Consumption') / Cr Inventory (auto, per item). BOTH sides
// resolve automatically from the item — unlike GRN, there is no offset
// account to configure anywhere; Material Issue needs zero user-selected
// GL accounts.
//
// Batch number is captured as a reference/traceability field only — it
// is NOT validated against a specific batch's remaining quantity, since
// batch-level quantity tracking doesn't exist (only item+warehouse-level
// WAC does). Flagging this here so it isn't mistaken for real batch
// control later.
//
// Storage: /stock/transactions/{id}, TransactionType: 'MaterialIssue'.

function saveMaterialIssueDraft(idToken, miData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'MATERIALISSUE');

    const miId = String(miData.MIID || '').trim();
    const transactionDate = String(miData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(miData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(miData.Reference || '').trim();
    // Defaults to 'Issue' since that's ~99% of real usage — Return is
    // always an explicit, manual choice, never inferred.
    const entryType = String(miData.EntryType || 'Issue').trim();
    if (entryType !== 'Issue' && entryType !== 'Return') throw new Error('Select Issue or Return.');
    const companyId = String(miData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(miData.DivisionID || '').trim();
    const branchId = String(miData.BranchID || '').trim();
    const costCenterId = String(miData.CostCenterID || '').trim();
    const profitCenterId = String(miData.ProfitCenterID || '').trim();

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    const rawLines = miData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const itemId = String(line.ItemID || '').trim();
      if (!itemId) return; // skip blank trailing row

      const item = itemsData[itemId];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
      const warehouseId = String(line.WarehouseID || '').trim();
      if (!warehouseId) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
      const wh = orgUnitsData[warehouseId];
      if (!wh || wh.Type !== 'Warehouse') throw new Error('Line ' + (idx + 1) + ': warehouse not found.');

      const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
      const enteredQty = Number(line.EnteredQuantity);
      if (!(enteredQty > 0)) throw new Error('Line ' + (idx + 1) + ': enter a quantity greater than zero.');

      let baseQty;
      if (enteredUomId === item.UOMID) {
        baseQty = enteredQty;
      } else if (enteredUomId === item.AltUOMID) {
        baseQty = enteredQty * (item.ConversionFactor || 0);
        if (!(baseQty > 0)) throw new Error('Line ' + (idx + 1) + ': item has no valid alternate UOM conversion factor set.');
      } else {
        throw new Error('Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
      }

      const enteredUom = uomsData[enteredUomId];
      if (enteredUom && !enteredUom.AllowDecimals && Math.abs(enteredQty - Math.round(enteredQty)) > 0.0001) {
        throw new Error('Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
      }

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      lines.push({
        LineNo: lines.length + 1,
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        WarehouseID: warehouseId,
        EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
        Quantity: Math.round(baseQty * 1e6) / 1e6,
        BatchNumber: String(line.BatchNumber || '').trim(), // reference only, see module note
        CostCenterID: String(line.CostCenterID || '').trim(),
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'MaterialIssue', EntryType: entryType,
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
      Lines: lines,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (miId) {
      const existing = firebaseDbRequest_('stock/transactions/' + miId, 'get', null, idToken);
      if (!existing) throw new Error('Material Issue not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Material Issues can be edited.');
      firebaseDbRequest_('stock/transactions/' + miId, 'patch', fields, idToken);
      return { success: true, miId: miId };
    }

    const newId = 'MID-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, miId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function postMaterialIssue(idToken, miId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + miId, 'get', null, idToken);
    if (!existing) throw new Error('Material Issue not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'MATERIALISSUE');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Material Issues can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('This Material Issue has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount: unlike GRN, an issued item's cost is the
    // CURRENT ledger WAC, not something user-entered — so getting an
    // accurate preview genuinely requires calling computeStockMovement_
    // here, against fresh, separate line objects (never existing.Lines
    // itself, which computeStockMovement_ would otherwise mutate in
    // place). This also usefully re-validates stock availability at
    // submit time — the same negative-stock guard the actual commit
    // will run again later. Nothing here writes anything: no ledger
    // update, no GL entry, regardless of whether a gate applies.
    const itemsDataPreview = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaDataPreview = getCoaData_(idToken);
    const previewLines = existing.Lines.map(l => Object.assign({ Direction: 'Out' }, l));
    computeStockMovement_(idToken, itemsDataPreview, coaDataPreview, previewLines);
    // Sum each line's own TotalValue (set directly on these line
    // objects by computeStockMovement_ as a side effect) rather than
    // inventoryGlLines' Debit field — an outbound line CREDITS
    // inventory (Debit: 0, Credit: lineValue), so reading Debit here
    // would silently give zero regardless of the real value moved.
    const previewAmount = previewLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'MATERIALISSUE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'MATERIALISSUE', miId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — the calculation above was a
      // read-only preview; no ledger update, no GL entry — until this
      // is actually approved (see decideMaterialIssueApproval, which
      // is where commitMaterialIssuePosting_ runs in that case).
      firebaseDbRequest_('stock/transactions/' + miId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitMaterialIssuePosting_(idToken, user, existing, miId);
    return { success: true, miId: miId, miNumber: result.miNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The actual stock-ledger-and-GL commit — extracted from the original
// postMaterialIssue so it can run from EITHER postMaterialIssue itself
// (no gate configured) OR decideMaterialIssueApproval (once approved).
// Recomputes movement fresh against whatever the ledger's WAC actually
// is AT THIS MOMENT — deliberately not reusing postMaterialIssue's own
// earlier preview, since that was only ever a read, and the real
// consumption should be costed at the moment it actually happens, not
// at whatever WAC happened to hold when originally submitted. Caller
// MUST already hold LockService.getScriptLock().
function commitMaterialIssuePosting_(idToken, user, existing, miId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);
  const isReturn = existing.EntryType === 'Return';

  // Return has no source document to inherit a cost from (confirmed
  // design — it's an accumulated quantity coming back to store, not
  // tied to any specific original Issue), so its cost basis is
  // resolved from the item's own CURRENT WAC at commit time — same
  // established pattern Stock Adjustment's own Increase direction
  // already uses (see buildStockAdjustmentMovementLines_), including
  // the same guard against an item with no existing stock to inherit
  // a cost from at all.
  const movementLines = existing.Lines.map(l => {
    const line = Object.assign({ Direction: isReturn ? 'In' : 'Out' }, l);
    if (isReturn) {
      const ledger = getStockLedgerEntry_(idToken, l.ItemID, l.WarehouseID);
      if (!(ledger.AvgCost > 0)) {
        throw new Error('Line for ' + l.ItemCode + ': cannot post a return — this item has zero current stock, so there is no existing cost to inherit. Use GRN or Production Entry to establish an initial cost basis first.');
      }
      line.UnitCost = ledger.AvgCost;
    }
    return line;
  });
  const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

  // Issue debits Consumption (an expense going up); Return credits it
  // (reversing part of that expense) — the "opposite GL logic"
  // confirmed design, mirroring exactly how Stock Adjustment's own
  // Increase/Decrease already flip Debit/Credit based on direction.
  const consumptionGlLines = movementLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = resolveItemExpenseAccount_(item, 'Consumption');
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Consumption account for ' + item.ItemCode + ' is not valid — check Item Master.');
    return {
      AccountCode: account.AccountCode,
      Debit: isReturn ? 0 : l.TotalValue, Credit: isReturn ? l.TotalValue : 0,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const actor = user.profile.username || user.uid;
  // Everything above is pure validation and read-only computation —
  // see the Phase 3 section comment above beginCommitAttempt_ for the
  // full reasoning behind what follows.
  const attemptId = beginCommitAttempt_(idToken, miId, actor);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'MaterialIssue', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(consumptionGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: miId });
  } catch (err) {
    abandonCommitAttempt_(idToken, miId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
  finalizeCommitAttempt_(idToken, miId, glResult, { Lines: movementLines }, actor);

  return { miNumber: glResult.jvNumber };
}

function decideMaterialIssueApproval(idToken, miId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'MATERIALISSUE');
    const existing = firebaseDbRequest_('stock/transactions/' + miId, 'get', null, idToken);
    if (!existing) throw new Error('Material Issue not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This Material Issue is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this Material Issue.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    if (result.status === 'Approved') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        commitMaterialIssuePosting_(idToken, user, existing, miId);
      } finally {
        lock.releaseLock();
      }
    } else if (result.status === 'Rejected') {
      const now = new Date().toISOString();
      firebaseDbRequest_('stock/transactions/' + miId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(),
        UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
      }, idToken);
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteMaterialIssueDraft(idToken, miId) {
  try {
    const user = requireUser_(idToken);
    const existing = firebaseDbRequest_('stock/transactions/' + miId, 'get', null, idToken);
    if (!existing) throw new Error('Material Issue not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, 'MATERIALISSUE');
    if (existing.Status !== 'Draft') throw new Error('Only draft Material Issues can be deleted. Posted ones must be reversed instead.');
    firebaseDbRequest_('stock/transactions/' + miId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getMaterialIssueEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'MATERIALISSUE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Material Issue.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ MIID: id }, data[id]))
    .filter(e => e.TransactionType === 'MaterialIssue')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Reversing a Material Issue puts the SAME stock back IN — flips every
// line to Direction 'In', but at the ORIGINAL line's cost (not a fresh
// WAC receipt cost — the point is undoing the exact issue, not receiving
// new stock at today's average). computeStockMovement_ requires 'In'
// lines to carry an explicit UnitCost, so it's supplied here from what
// was actually charged when the issue posted.
function reverseMaterialIssue(idToken, miId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + miId, 'get', null, idToken);
    if (!existing) throw new Error('Material Issue not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'MATERIALISSUE');
    if (existing.Status !== 'Posted') throw new Error('Only posted Material Issues can be reversed.');
    if (existing.ReversedByMI) throw new Error('This Material Issue has already been reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    // Flips whichever direction each line actually was, not hardcoded
    // to 'In' — an Issue (Out) reverses to In, but a Return (In)
    // reverses to Out. The Out case explicitly carries the ORIGINAL
    // line's own UnitCost forward (undoing the exact original GL
    // impact, not a fresh lookup) — same as this function's own prior
    // behavior. The In case (reversing a Return) deliberately does
    // NOT do this: computeStockMovement_'s own 'Out' logic always
    // resolves the ledger's CURRENT WAC for an Out line, with no
    // override mechanism anywhere in this codebase, for any module —
    // consistent with every other Out movement in the system, not a
    // special case introduced just for this one.
    const movementLines = existing.Lines.map(l => {
      const reversedDirection = l.Direction === 'In' ? 'Out' : 'In';
      const line = Object.assign({}, l, { Direction: reversedDirection });
      if (reversedDirection === 'In') line.UnitCost = l.UnitCost;
      else delete line.UnitCost;
      return line;
    });
    const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

    const consumptionGlLines = movementLines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = resolveItemExpenseAccount_(item, 'Consumption');
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error('Consumption account for ' + item.ItemCode + ' is not valid — check Item Master.');
      // Reversing an Issue (now In) credits Consumption — undoing the
      // original Debit. Reversing a Return (now Out) debits
      // Consumption instead — undoing the original Credit.
      const isReversalOfReturn = l.Direction === 'Out';
      return {
        AccountCode: account.AccountCode,
        Debit: isReversalOfReturn ? l.TotalValue : 0, Credit: isReversalOfReturn ? 0 : l.TotalValue,
        Description: 'Reversal of ' + existing.TransactionNumber,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'MID-' + Utilities.getUuid().split('-')[0].toUpperCase();

    // Everything above is pure validation and read-only computation —
    // nothing written yet. The new reversal record doesn't exist yet
    // either, so "begin" means creating it fresh, already marked
    // Committing.
    const attemptId = Utilities.getUuid();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'MaterialIssue', EntryType: existing.EntryType === 'Return' ? 'Issue' : 'Return',
      Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfMI: miId, ReversedByMI: ''
    }, idToken);

    let glResult;
    try {
      glResult = writeStockGlEntry_(idToken, user, 'MaterialIssue', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(consumptionGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      // Nothing references the placeholder yet — safe to remove it
      // entirely.
      firebaseDbRequest_('stock/transactions/' + newId, 'delete', null, idToken);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);

    // Original patched BEFORE the new reversal finalizes — same
    // deliberate ordering as GRN's reversal, for the same reason:
    // guarantees a second reversal can never be triggered even if
    // something fails between these two writes.
    firebaseDbRequest_('stock/transactions/' + miId, 'patch', { ReversedByMI: newId }, idToken);
    finalizeCommitAttempt_(idToken, newId, glResult, { Lines: movementLines }, actor);

    return { success: true, miId: newId, miNumber: glResult.jvNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// BILL OF MATERIALS (BOM)
// ============================================================
// Pure master data — no stock ledger or GL impact at all. Defines what
// components (and how much of each) are needed to produce ONE unit of a
// Finished Good or Semi-Finished Good. Consumed by Production Entry
// (not built yet) to know what to draw from inventory when producing.
//
// RULES:
// - Parent item must be FinishedGood or SemiFinishedGood — only those
//   categories are ever "produced." RawMaterial/Consumable/Scrap can
//   never be a BOM's parent.
// - Component items must be RawMaterial, SemiFinishedGood, or
//   Consumable — anything that gets CONSUMED into production.
//   SemiFinishedGood can be BOTH a parent (of its own BOM) AND a
//   component (of a higher-level BOM) — that's exactly what "semi-
//   finished" means: an intermediate product with its own recipe that
//   also feeds into something else.
// - Only ONE Active BOM per parent item at a time. Saving a new BOM as
//   Active for a parent that already has one auto-deactivates the old
//   one — the old version stays on record (Inactive), not deleted.
// - Circular BOMs are rejected: a parent's own component tree — walked
//   through every component's OWN active BOM, recursively — must never
//   loop back to the parent itself. Without this check, a future
//   Production Entry "explosion" of a BOM tree could recurse forever.
//
// Storage: /boms/{id} = { ParentItemID, BOMVersion, Status, EffectiveFrom
//   (date this version took effect — see saveBom), Components: [
//   { ComponentItemID, Quantity (in component's base UOM, per 1 unit of
//   parent), ScrapPercent }], Notes, CreatedAt/By, UpdatedAt/By }

const BOM_PARENT_CATEGORIES = ['FinishedGood', 'SemiFinishedGood'];
const BOM_COMPONENT_CATEGORIES = ['RawMaterial', 'SemiFinishedGood', 'Consumable'];

function getBoms(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'BOM', 'access', user.profile.role)) {
    throw new Error('You do not have access to Bill of Materials.');
  }
  const data = firebaseDbRequest_('boms', 'get', null, idToken) || {};
  return Object.keys(data).map(id => Object.assign({ BOMID: id }, data[id]));
}

// Used by future Production Entry to resolve what a Finished/Semi-
// Finished Good actually consumes. Returns null if the item has no
// active recipe.
function getActiveBomForItem_(idToken, itemId) {
  const data = firebaseDbRequest_('boms', 'get', null, idToken) || {};
  const match = Object.keys(data).find(id => data[id].ParentItemID === itemId && data[id].Status === 'Active');
  return match ? Object.assign({ BOMID: match }, data[match]) : null;
}

// Resolves whichever BOM version was ACTUALLY in effect for a parent
// item on a specific date — not just whatever's marked Active today.
// This is what makes the Material Variance Report correct across a
// period where the recipe changed: a BOM's Status only tells you what's
// CURRENT, but a production transaction from before a recipe change
// needs judging against the OLD recipe, which is still on record as
// Inactive (saveBom preserves history rather than deleting it — see
// its own comment). Considers every version for the parent regardless
// of Status, and picks whichever has the latest EffectiveFrom that is
// still on or before the given date. Returns null if no version was
// effective yet by that date (e.g. production predates any recorded
// BOM for that item).
function getBomEffectiveOnDate_(bomsByParent, parentItemId, date) {
  const versions = bomsByParent[parentItemId];
  if (!versions || !versions.length) return null;
  let match = null;
  versions.forEach(v => {
    const effFrom = v.EffectiveFrom || '';
    if (effFrom && effFrom <= date && (!match || effFrom > (match.EffectiveFrom || ''))) match = v;
  });
  return match;
}

// Groups every BOM (every version, every status) by parent item and
// sorts each group by EffectiveFrom — the shape getBomEffectiveOnDate_
// expects. Built once per report run rather than re-querying Firebase
// per transaction.
function groupBomsByParent_(idToken) {
  const allBoms = firebaseDbRequest_('boms', 'get', null, idToken) || {};
  const byParent = {};
  Object.keys(allBoms).forEach(id => {
    const b = Object.assign({ BOMID: id }, allBoms[id]);
    if (!byParent[b.ParentItemID]) byParent[b.ParentItemID] = [];
    byParent[b.ParentItemID].push(b);
  });
  Object.keys(byParent).forEach(pid => {
    byParent[pid].sort((a, b) => String(a.EffectiveFrom || '').localeCompare(String(b.EffectiveFrom || '')));
  });
  return byParent;
}

// Walks a proposed component tree looking for the parent item appearing
// anywhere below it — directly, or nested inside a component's OWN
// active BOM, however many levels deep. `visited` guards against
// runaway recursion if bad data already contains a cycle elsewhere in
// the graph (shouldn't happen once this check is in place, but existing
// data predates it being possible to check).
function bomTreeContainsItem_(allBomsByParent, startItemId, targetItemId, visited) {
  if (visited.has(startItemId)) return false;
  visited.add(startItemId);
  const bom = allBomsByParent[startItemId];
  if (!bom) return false;
  for (let i = 0; i < bom.Components.length; i++) {
    const compId = bom.Components[i].ComponentItemID;
    if (compId === targetItemId) return true;
    if (bomTreeContainsItem_(allBomsByParent, compId, targetItemId, visited)) return true;
  }
  return false;
}

function saveBom(idToken, bomData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'BOM', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Bill of Materials.');
    }

    const bomId = String(bomData.BOMID || '').trim();
    const parentItemId = String(bomData.ParentItemID || '').trim();
    const bomVersion = String(bomData.BOMVersion || '').trim() || '1.0';
    const status = String(bomData.Status || 'Active').trim();
    const notes = String(bomData.Notes || '').trim();
    // When this recipe actually took effect — required so the Material
    // Variance Report (and anything else needing "what was the recipe
    // on date X") can resolve the CORRECT version for a given production
    // transaction's date, not just whichever version happens to be
    // marked Active today. Defaults to today only as a convenience for
    // a brand-new BOM; a genuine recipe CHANGE should always get an
    // explicit, correct effective date, not silently inherit "now".
    const effectiveFrom = String(bomData.EffectiveFrom || '').trim() || new Date().toISOString().substring(0, 10);

    if (!parentItemId) throw new Error('Select a parent item.');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const parentItem = itemsData[parentItemId];
    if (!parentItem) throw new Error('Parent item not found.');
    if (BOM_PARENT_CATEGORIES.indexOf(parentItem.Category) === -1) {
      throw new Error('Parent item must be a Finished Good or Semi-Finished Good.');
    }

    const rawComponents = bomData.Components || [];
    const components = [];
    rawComponents.forEach((c, idx) => {
      const componentItemId = String(c.ComponentItemID || '').trim();
      if (!componentItemId) return; // skip blank trailing row

      const compItem = itemsData[componentItemId];
      if (!compItem) throw new Error('Component ' + (idx + 1) + ': item not found.');
      if (BOM_COMPONENT_CATEGORIES.indexOf(compItem.Category) === -1) {
        throw new Error('Component ' + (idx + 1) + ' (' + compItem.ItemCode + '): must be Raw Material, Semi-Finished Good, or Consumable.');
      }
      if (componentItemId === parentItemId) {
        throw new Error('Component ' + (idx + 1) + ': an item cannot be a component of its own BOM.');
      }
      if (parentItem.CompanyID && compItem.CompanyID && parentItem.CompanyID !== compItem.CompanyID) {
        throw new Error('Component ' + (idx + 1) + ' (' + compItem.ItemCode + ') belongs to a different company than the parent item.');
      }

      const quantity = Number(c.Quantity);
      if (!(quantity > 0)) throw new Error('Component ' + (idx + 1) + ' (' + compItem.ItemCode + '): enter a quantity greater than zero.');
      const scrapPercent = Number(c.ScrapPercent) || 0;
      if (scrapPercent < 0 || scrapPercent >= 100) throw new Error('Component ' + (idx + 1) + ' (' + compItem.ItemCode + '): scrap % must be between 0 and 100.');

      components.push({
        ComponentItemID: componentItemId, ComponentItemCode: compItem.ItemCode, ComponentItemName: compItem.ItemName,
        Quantity: Math.round(quantity * 1e6) / 1e6, UOMID: compItem.UOMID,
        ScrapPercent: Math.round(scrapPercent * 100) / 100
      });
    });

    if (!components.length) throw new Error('Add at least one component.');

    // Cycle detection — only meaningful if this BOM is (or will be)
    // Active, since an Inactive BOM never actually gets used by
    // Production and can't create a real circular consumption path.
    if (status === 'Active') {
      const allBoms = firebaseDbRequest_('boms', 'get', null, idToken) || {};
      const allBomsByParent = {};
      Object.keys(allBoms).forEach(id => {
        if (id === bomId) return; // exclude the record being edited — its old component list is irrelevant here
        const b = allBoms[id];
        if (b.Status === 'Active') allBomsByParent[b.ParentItemID] = b;
      });
      // Inject the PROPOSED version of this BOM so the walk checks
      // against what's about to be saved, not stale data.
      allBomsByParent[parentItemId] = { Components: components };

      for (let i = 0; i < components.length; i++) {
        if (bomTreeContainsItem_(allBomsByParent, components[i].ComponentItemID, parentItemId, new Set())) {
          throw new Error('This would create a circular BOM: ' + components[i].ComponentItemCode + '\'s own recipe eventually consumes ' + parentItem.ItemCode + ' again.');
        }
      }
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const updates = {};

    // Only one Active BOM per parent — saving this one as Active
    // deactivates any other Active BOM for the same parent (history
    // stays on record as Inactive, not deleted).
    if (status === 'Active') {
      const allBoms = firebaseDbRequest_('boms', 'get', null, idToken) || {};
      Object.keys(allBoms).forEach(id => {
        if (id === bomId) return;
        if (allBoms[id].ParentItemID === parentItemId && allBoms[id].Status === 'Active') {
          updates[id] = Object.assign({}, allBoms[id], { Status: 'Inactive', UpdatedAt: now, UpdatedBy: actor });
        }
      });
    }

    const fields = {
      ParentItemID: parentItemId, ParentItemCode: parentItem.ItemCode, ParentItemName: parentItem.ItemName,
      BOMVersion: bomVersion, Status: status, Components: components, Notes: notes, EffectiveFrom: effectiveFrom,
      UpdatedAt: now, UpdatedBy: actor
    };

    if (bomId) {
      const existing = firebaseDbRequest_('boms/' + bomId, 'get', null, idToken);
      if (!existing) throw new Error('BOM not found.');
      updates[bomId] = Object.assign({}, existing, fields);
    } else {
      const newId = 'BOM-' + Utilities.getUuid().split('-')[0].toUpperCase();
      updates[newId] = Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor });
    }

    firebaseDbRequest_('boms', 'patch', updates, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateBom(idToken, bomId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'BOM', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Bill of Materials.');
    }
    const existing = firebaseDbRequest_('boms/' + bomId, 'get', null, idToken);
    if (!existing) throw new Error('BOM not found.');
    firebaseDbRequest_('boms/' + bomId, 'patch', { Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Reactivating re-runs the SAME "only one Active BOM per parent" and
// cycle-detection rules saveBom applies — reactivation is just another
// path to an Active BOM, and must not bypass either check.
function reactivateBom(idToken, bomId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'BOM', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Bill of Materials.');
    }
    const existing = firebaseDbRequest_('boms/' + bomId, 'get', null, idToken);
    if (!existing) throw new Error('BOM not found.');
    return saveBom(idToken, Object.assign({}, existing, { BOMID: bomId, Status: 'Active' }));
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// PRODUCTION ENTRY
// ============================================================
// Records a produced Finished or Semi-Finished Good entering inventory —
// structurally a near-clone of GRN (single inbound direction, manually
// entered Unit Cost, per-item Consumption account resolved automatically
// from Item Master), not the earlier dual in/out design.
//
// The earlier version consumed component lines AND produced an item in
// one document, deriving the produced item's cost from what was
// consumed. That's been deliberately dropped: consumption is now a
// separate Material Issue transaction, posted independently, at
// whatever time materials actually leave the warehouse — which may be
// well before a production run finishes. Production Entry's only job
// now is recording what came OUT of production and its cost, exactly
// the same shape as GRN records what came in from a vendor.
//
// GL shape: Dr [item]'s Inventory Account (auto, per line) / Cr that same
// item's own Consumption account (per line — see resolveItemExpenseAccount_,
// the same one Material Issue debits when the item is issued out).
// Crediting it here instead of debiting makes Production Entry the
// mirror image of Material Issue on the same account: its running
// balance naturally reflects work-in-process or yield variance over
// time, with no company-level setting to configure. No BOM reference, no
// component consumption logic here at all.
//
// Storage: /stock/transactions/{id}, TransactionType: 'Production'.

function saveProductionDraft(idToken, prodData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'PRODUCTION');

    const prodId = String(prodData.ProductionID || '').trim();
    const transactionDate = String(prodData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(prodData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(prodData.Reference || '').trim();
    const companyId = String(prodData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(prodData.DivisionID || '').trim();
    const branchId = String(prodData.BranchID || '').trim();
    const costCenterId = String(prodData.CostCenterID || '').trim();
    const profitCenterId = String(prodData.ProfitCenterID || '').trim();

    // Job Order link is optional — validated here (at draft-save time)
    // rather than only at posting, so a bad link surfaces before the
    // user has filled in the whole grid. The user picks the PARENT
    // BATCH (confirmed design: "only the main JO number need to
    // select"); which specific line within it gets credited resolves
    // per produced item at posting time (see postProduction), not
    // here — the produced grid may still be in flux while drafting.
    const jobOrderId = String(prodData.JobOrderID || '').trim();
    if (jobOrderId) {
      const batch = firebaseDbRequest_('jobOrderBatches/' + jobOrderId, 'get', null, idToken);
      if (!batch) throw new Error('Selected Job Order not found.');
      if (batch.Status !== 'Submitted') throw new Error('Selected Job Order has not been submitted yet.');
      if (batch.CompanyID !== companyId) throw new Error('Selected Job Order belongs to a different company.');
    }

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    const rawLines = prodData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const itemId = String(line.ItemID || '').trim();
      if (!itemId) return; // skip blank trailing row

      const item = itemsData[itemId];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
      const warehouseId = String(line.WarehouseID || '').trim();
      if (!warehouseId) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
      const wh = orgUnitsData[warehouseId];
      if (!wh || wh.Type !== 'Warehouse') throw new Error('Line ' + (idx + 1) + ': warehouse not found.');

      const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
      const enteredQty = Number(line.EnteredQuantity);
      if (!(enteredQty > 0)) throw new Error('Line ' + (idx + 1) + ': enter a quantity greater than zero.');

      let baseQty;
      if (enteredUomId === item.UOMID) {
        baseQty = enteredQty;
      } else if (enteredUomId === item.AltUOMID) {
        baseQty = enteredQty * (item.ConversionFactor || 0);
        if (!(baseQty > 0)) throw new Error('Line ' + (idx + 1) + ': item has no valid alternate UOM conversion factor set.');
      } else {
        throw new Error('Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
      }
      const enteredUom = uomsData[enteredUomId];
      if (enteredUom && !enteredUom.AllowDecimals && Math.abs(enteredQty - Math.round(enteredQty)) > 0.0001) {
        throw new Error('Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
      }

      const unitCost = Number(line.UnitCost);
      // See computeStockMovement_'s identical check for why this is > 0,
      // not >= 0.
      if (!(unitCost > 0)) throw new Error('Line ' + (idx + 1) + ': enter a unit cost greater than zero.');

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
        throw new Error('Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
      }

      lines.push({
        LineNo: lines.length + 1,
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        WarehouseID: warehouseId,
        EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
        Quantity: Math.round(baseQty * 1e6) / 1e6,
        UnitCost: Math.round(unitCost * 10000) / 10000,
        BatchNumber: String(line.BatchNumber || '').trim(),
        ExpiryDate: String(line.ExpiryDate || '').trim(),
        CostCenterID: String(line.CostCenterID || '').trim(),
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'Production',
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
      JobOrderID: jobOrderId,
      Lines: lines,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (prodId) {
      const existing = firebaseDbRequest_('stock/transactions/' + prodId, 'get', null, idToken);
      if (!existing) throw new Error('Production entry not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Production entries can be edited.');
      firebaseDbRequest_('stock/transactions/' + prodId, 'patch', fields, idToken);
      return { success: true, prodId: prodId };
    }

    const newId = 'PRDD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, prodId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function postProduction(idToken, prodId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + prodId, 'get', null, idToken);
    if (!existing) throw new Error('Production entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'PRODUCTION');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Production entries can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('This Production entry has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount: value of goods produced — quantity x unit cost,
    // both already fixed on the entry's own lines from draft time
    // (whether manually entered or auto-filled from the Inventory
    // Valuation List), NOT dependent on live ledger state the way
    // Material Issue/Stock Adjustment/Physical Count's costing is.
    // Nothing here writes anything — and the Job Order line matching
    // (which DOES depend on live Job Order line status) is
    // deliberately skipped here; it isn't needed for the amount, and
    // doing it only at actual commit time means it reflects the Job
    // Order's real state then, not whatever it was at submission.
    const previewAmount = existing.Lines.reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0);

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'PRODUCTION', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'PRODUCTION', prodId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no stock ledger change, no GL
      // entry, no Job Order progress update, no Sales Order
      // allocation — until this is actually approved (see
      // decideProductionApproval, which is where
      // commitProductionPosting_ runs in that case instead of here).
      firebaseDbRequest_('stock/transactions/' + prodId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitProductionPosting_(idToken, user, existing, prodId);
    return { success: true, prodId: prodId, prodNumber: result.prodNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The actual stock-ledger-and-GL commit, plus Job Order line progress
// and Sales Order allocation — extracted so it can run from EITHER
// postProduction itself (no gate configured) OR decideProductionApproval
// (once approved). Caller MUST already hold LockService.getScriptLock().
function commitProductionPosting_(idToken, user, existing, prodId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);

  // Every line is inbound — the produced item entering stock.
  let movementLines = existing.Lines.map(l => Object.assign({ Direction: 'In' }, l));

  // Resolve which Job Order LINE (within the selected parent batch)
  // each produced item matches, by item code — confirmed design: the
  // user only picks the parent batch; the specific line resolves from
  // what's actually being produced. Read fresh, right now, against
  // live Job Order line status (see postProduction's own comment for
  // why this can't happen any earlier).
  const matchedLineQuantities = {}; // LineID -> total newly-produced qty across this posting
  if (existing.JobOrderID) {
    const eligibleStatuses = ['Accepted', 'Open', 'In Progress', 'Stop Requested'];
    const batchLines = linesForBatch_(idToken, existing.JobOrderID).filter(l => eligibleStatuses.indexOf(l.Status) !== -1);
    movementLines = movementLines.map(l => {
      const matchedLine = batchLines.find(bl => bl.ItemCode === l.ItemCode);
      if (!matchedLine) return l;
      matchedLineQuantities[matchedLine.LineID] = (matchedLineQuantities[matchedLine.LineID] || 0) + (Number(l.Quantity) || 0);
      return Object.assign({}, l, { JobOrderLineID: matchedLine.LineID });
    });
  }

  const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

  const offsetGlLines = movementLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = resolveItemExpenseAccount_(item, 'Consumption');
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Consumption account for ' + item.ItemCode + ' is not valid — check Item Master.');
    return {
      AccountCode: account.AccountCode, Debit: 0, Credit: l.TotalValue,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const actor = user.profile.username || user.uid;
  // Everything above is pure validation and read-only computation.
  const attemptId = beginCommitAttempt_(idToken, prodId, actor);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'Production', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(offsetGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: prodId });
  } catch (err) {
    abandonCommitAttempt_(idToken, prodId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
  finalizeCommitAttempt_(idToken, prodId, glResult, { Lines: movementLines }, actor);

  // Job Order progress only ever updates once the transaction is
  // genuinely, finally committed — same invariant the approval
  // retrofit already proved ("never before approval"), now equally
  // true against a failed GL/ledger write: if either of those failed
  // above, execution never reaches here at all.
  Object.keys(matchedLineQuantities).forEach(lineId => {
    updateJobOrderLineProgressAfterProduction_(idToken, lineId, matchedLineQuantities[lineId], prodId);
  });

  return { prodNumber: glResult.jvNumber };
}

function decideProductionApproval(idToken, prodId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PRODUCTION');
    const existing = firebaseDbRequest_('stock/transactions/' + prodId, 'get', null, idToken);
    if (!existing) throw new Error('Production entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This Production entry is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this Production entry.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    if (result.status === 'Approved') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        commitProductionPosting_(idToken, user, existing, prodId);
      } finally {
        lock.releaseLock();
      }
    } else if (result.status === 'Rejected') {
      const now = new Date().toISOString();
      firebaseDbRequest_('stock/transactions/' + prodId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(),
        UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
      }, idToken);
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteProductionDraft(idToken, prodId) {
  try {
    const user = requireUser_(idToken);
    const existing = firebaseDbRequest_('stock/transactions/' + prodId, 'get', null, idToken);
    if (!existing) throw new Error('Production entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, 'PRODUCTION');
    if (existing.Status !== 'Draft') throw new Error('Only draft Production entries can be deleted. Posted ones must be reversed instead.');
    firebaseDbRequest_('stock/transactions/' + prodId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getProductionEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PRODUCTION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Production Entry.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ ProductionID: id }, data[id]))
    .filter(e => e.TransactionType === 'Production')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Reversing a Production Entry takes the produced item back OUT — same
// negative-stock guard as GRN's reversal: if it's already been issued,
// sold, or consumed elsewhere, the reversal is rejected rather than
// pushing the ledger negative.
function reverseProduction(idToken, prodId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + prodId, 'get', null, idToken);
    if (!existing) throw new Error('Production entry not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'PRODUCTION');
    if (existing.Status !== 'Posted') throw new Error('Only posted Production entries can be reversed.');
    if (existing.ReversedByProduction) throw new Error('This Production entry has already been reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    const movementLines = existing.Lines.map(l => Object.assign({}, l, { Direction: 'Out' }));
    const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

    // Same per-item Consumption account as postProduction, polarity
    // flipped back (debited here, since the reversal is undoing a
    // credit).
    const offsetGlLines = movementLines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = resolveItemExpenseAccount_(item, 'Consumption');
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error('Consumption account for ' + item.ItemCode + ' is not valid — check Item Master.');
      return {
        AccountCode: account.AccountCode, Debit: l.TotalValue, Credit: 0,
        Description: 'Reversal of ' + existing.TransactionNumber,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'PRDD-' + Utilities.getUuid().split('-')[0].toUpperCase();

    const attemptId = Utilities.getUuid();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'Production', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfProduction: prodId, ReversedByProduction: ''
    }, idToken);

    let glResult;
    try {
      glResult = writeStockGlEntry_(idToken, user, 'Production', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(offsetGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      firebaseDbRequest_('stock/transactions/' + newId, 'delete', null, idToken);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);

    // Original patched before the new reversal finalizes — same
    // deliberate ordering as GRN/Material Issue's reversals.
    firebaseDbRequest_('stock/transactions/' + prodId, 'patch', { ReversedByProduction: newId }, idToken);
    finalizeCommitAttempt_(idToken, newId, glResult, { Lines: movementLines }, actor);

    // Job Order rollback stays at the very end, in the same relative
    // position it held before this retrofit — a separate, pre-existing
    // RTDB-only side effect that this phase isn't targeting.
    const touchedLineIds = new Set();
    (existing.Lines || []).forEach(l => { if (l.JobOrderLineID) touchedLineIds.add(l.JobOrderLineID); });
    touchedLineIds.forEach(lineId => rollbackJobOrderLineAfterReversal_(idToken, lineId, prodId));

    return { success: true, prodId: newId, prodNumber: glResult.jvNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// VENDOR INVOICE PROCESSING (Phase B of the AP build)
// ============================================================
// Matches a Vendor's Posted, not-yet-invoiced GRNs (whole GRNs, never
// partial lines — confirmed design) against a manually entered
// Discount, Tax %, and Round Off, plus optional direct (non-GRN)
// expense lines for charges that never went through goods receipt at
// all (freight, services). Since GRN price is already locked to PO
// price at receipt time (see saveGrnDraft's own comment on this), an
// invoice line sourced from a GRN can never itself carry a price
// disagreement — there's no editable price field on that path at
// all. The real reconciliation happening here is simpler than a
// textbook three-way match: does what's been entered (which GRNs,
// what discount, what tax) actually total correctly, not "is the
// price right" — that question was already closed at GRN time.
//
// GL shape, once posted:
//   Dr GRN Clearing (company's own account, same one GRN itself
//     credited — this is what actually clears that suspense balance)
//   Dr each direct line's own account, for its own amount
//   Cr Discount Received (company's own account) — only if Discount > 0
//   Dr Input Tax (company's own account) — only if TaxAmount > 0
//   Dr OR Cr Round Off (company's own account, by sign) — only if != 0
//   Cr the VENDOR's own TradePayablesAccountID — the invoice Total
//
// Storage: /vendorInvoices/{id}. Uses the SAME commit-marker safety
// pattern as every stock module (see beginCommitAttempt_'s own section
// comment for the full reasoning) — posting here has the identical
// cross-database risk shape: a Firestore GL write paired with an RTDB
// side effect (marking each matched GRN's MatchedToInvoiceID, so it
// drops out of every future invoice picker — the double-invoicing
// prevention). collectionPath is 'vendorInvoices' throughout, not the
// default 'stock/transactions'.

function getVendorInvoiceEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'VENDORINVOICE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Vendor Invoice Processing.');
  }
  const data = firebaseDbRequest_('vendorInvoices', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ VendorInvoiceID: id }, data[id]))
    .filter(inv => userCanAccessCompany_(user.profile, inv.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Posted GRNs for the given company AND vendor, not already matched to
// any invoice. Vendor is required, same reasoning as GRN's own
// single-vendor-per-document picker — an invoice belongs to exactly
// one vendor, and every GRN it can possibly match against already
// carries its own VendorID (set at GRN save time, Phase A).
function getEligibleGRNsForInvoice(idToken, companyId, vendorId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'VENDORINVOICE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Vendor Invoice Processing.');
  }
  if (!companyId || !vendorId) return [];

  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ GRNID: id }, data[id]))
    .filter(g => g.TransactionType === 'GRN' && g.Status === 'Posted' && g.CompanyID === companyId && g.VendorID === vendorId && !g.MatchedToInvoiceID)
    .map(g => ({
      GRNID: g.GRNID, GRNNumber: g.TransactionNumber, TransactionDate: g.TransactionDate,
      Description: g.Description,
      Amount: (g.Lines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0)
    }));
}

function deleteVendorInvoiceDraft(idToken, invoiceId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'VENDORINVOICE');
    const existing = firebaseDbRequest_('vendorInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor Invoice not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Vendor Invoice can be deleted.');
    firebaseDbRequest_('vendorInvoices/' + invoiceId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function saveVendorInvoiceDraft(idToken, invoiceData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'VENDORINVOICE');

    const invoiceId = String(invoiceData.VendorInvoiceID || '').trim();
    const invoiceDate = String(invoiceData.InvoiceDate || '').trim();
    if (!invoiceDate) throw new Error('Invoice date is required.');
    const description = String(invoiceData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const vendorRefNumber = String(invoiceData.VendorRefNumber || '').trim();
    if (!vendorRefNumber) throw new Error('The Vendor\'s own invoice number is required.');
    const companyId = String(invoiceData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this invoice.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const vendorId = String(invoiceData.VendorID || '').trim();
    if (!vendorId) throw new Error('Select a Vendor for this invoice.');
    const vendorData = firebaseDbRequest_('vendors/' + vendorId, 'get', null, idToken);
    if (!vendorData || vendorData.Status !== 'Active') throw new Error('Unknown or inactive Vendor.');

    const divisionId = String(invoiceData.DivisionID || '').trim();
    const branchId = String(invoiceData.BranchID || '').trim();
    const costCenterId = String(invoiceData.CostCenterID || '').trim();
    const profitCenterId = String(invoiceData.ProfitCenterID || '').trim();

    // Source GRNs — each must be Posted, same Company AND Vendor as
    // this invoice, and not already matched to a DIFFERENT invoice
    // (matched to THIS SAME draft, on a re-save, is fine).
    const rawGRNs = invoiceData.SourceGRNs || [];
    const grnCache = {};
    function loadGRN_(grnId) {
      if (!grnCache.hasOwnProperty(grnId)) grnCache[grnId] = firebaseDbRequest_('stock/transactions/' + grnId, 'get', null, idToken);
      return grnCache[grnId];
    }
    const sourceGRNs = rawGRNs.map((g, idx) => {
      const grnId = String(g.GRNID || '').trim();
      if (!grnId) throw new Error('Source GRN ' + (idx + 1) + ': missing ID.');
      const grn = loadGRN_(grnId);
      if (!grn || grn.TransactionType !== 'GRN' || grn.Status !== 'Posted') {
        throw new Error('Source GRN ' + (idx + 1) + ': not found or not Posted.');
      }
      if (grn.CompanyID !== companyId) throw new Error('Source GRN ' + (idx + 1) + ': belongs to a different Company.');
      if (grn.VendorID !== vendorId) throw new Error('Source GRN ' + (idx + 1) + ': belongs to a different Vendor — an invoice can only draw from one Vendor\'s GRNs.');
      if (grn.MatchedToInvoiceID && grn.MatchedToInvoiceID !== invoiceId) {
        throw new Error('Source GRN ' + (idx + 1) + ' (' + (grn.TransactionNumber || grnId) + ') is already matched to a different invoice.');
      }
      const amount = (grn.Lines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0);
      return { GRNID: grnId, GRNNumber: grn.TransactionNumber || '', Amount: Math.round(amount * 100) / 100 };
    });

    // Direct lines — non-GRN charges (freight, services). Each is
    // always a debit to its own account; there's no "direction" to
    // pick, since a vendor invoice line not tied to a GRN is
    // essentially always an expense or asset being incurred.
    const coaData = getCoaData_(idToken);
    const rawDirectLines = (invoiceData.DirectLines || []).filter(l => String(l.AccountCode || '').trim());
    const directLines = rawDirectLines.map((l, idx) => {
      const accountCode = String(l.AccountCode || '').trim();
      const account = Object.values(coaData).find(a => a.AccountCode === accountCode);
      if (!account || !account.IsPostable || account.Status !== 'Active') {
        throw new Error('Direct line ' + (idx + 1) + ': unknown or non-postable account.');
      }
      const amount = Number(l.Amount);
      if (!(amount > 0)) throw new Error('Direct line ' + (idx + 1) + ': amount must be greater than zero.');
      const lineDescription = String(l.Description || '').trim();
      if (!lineDescription) throw new Error('Direct line ' + (idx + 1) + ': description is required.');
      return {
        AccountCode: accountCode, Description: lineDescription, Amount: Math.round(amount * 100) / 100,
        CostCenterID: String(l.CostCenterID || '').trim(), ProfitCenterID: String(l.ProfitCenterID || '').trim()
      };
    });

    if (!sourceGRNs.length && !directLines.length) {
      throw new Error('Add at least one GRN or one direct line.');
    }

    const discount = Number(invoiceData.Discount) || 0;
    if (discount < 0) throw new Error('Discount cannot be negative.');
    const taxPercent = Number(invoiceData.TaxPercent) || 0;
    if (taxPercent < 0) throw new Error('Tax % cannot be negative.');
    const roundOff = Number(invoiceData.RoundOff) || 0;

    const grnSubtotal = sourceGRNs.reduce((sum, g) => sum + g.Amount, 0);
    const directTotal = directLines.reduce((sum, l) => sum + l.Amount, 0);
    const subtotal = Math.round((grnSubtotal + directTotal) * 100) / 100;
    if (discount > subtotal) throw new Error('Discount cannot exceed the invoice subtotal.');
    // Tax computed on the NET of discount, per the confirmed formula —
    // most tax regimes calculate this way, not on the gross.
    const taxAmount = Math.round(((subtotal - discount) * taxPercent / 100) * 100) / 100;
    const total = Math.round((subtotal - discount + taxAmount + roundOff) * 100) / 100;

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'VendorInvoice',
      InvoiceDate: invoiceDate, Description: description, VendorRefNumber: vendorRefNumber,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId, VendorID: vendorId,
      SourceGRNs: sourceGRNs, DirectLines: directLines,
      Discount: discount, TaxPercent: taxPercent, TaxAmount: taxAmount, RoundOff: roundOff,
      Subtotal: subtotal, Total: total,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (invoiceId) {
      const existing = firebaseDbRequest_('vendorInvoices/' + invoiceId, 'get', null, idToken);
      if (!existing) throw new Error('Vendor Invoice not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected invoices can be edited.');
      firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', fields, idToken);
      return { success: true, invoiceId: invoiceId };
    }

    const newId = 'VINVD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('vendorInvoices/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, invoiceId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function postVendorInvoice(idToken, invoiceId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('vendorInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'VENDORINVOICE');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected invoices can be posted.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'VENDORINVOICE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'VENDORINVOICE', invoiceId, '', scopeKey, existing.Total, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no GL entry, no GRN matched —
      // until this is actually approved (see decideVendorInvoiceApproval,
      // which is where commitVendorInvoicePosting_ runs in that case).
      firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitVendorInvoicePosting_(idToken, user, existing, invoiceId);
    return { success: true, invoiceId: invoiceId, invoiceNumber: result.invoiceNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Caller MUST already hold LockService.getScriptLock() — same
// precondition as every other commit*Posting_ function.
function commitVendorInvoicePosting_(idToken, user, existing, invoiceId) {
  const vendor = firebaseDbRequest_('vendors/' + existing.VendorID, 'get', null, idToken);
  const coaData = getCoaData_(idToken);
  if (!vendor || !vendor.TradePayablesAccountID) {
    throw new Error('This Vendor has no Trade Payables Account configured. Set one in Vendor Master Data before posting.');
  }
  const apAccount = coaData[vendor.TradePayablesAccountID];
  if (!apAccount || !apAccount.IsPostable) throw new Error('This Vendor\'s Trade Payables Account is no longer valid.');

  const glLines = [];

  const grnSubtotal = (existing.SourceGRNs || []).reduce((sum, g) => sum + (Number(g.Amount) || 0), 0);
  if (grnSubtotal > 0) {
    const clearingAccountId = resolveGrnClearingAccount_(idToken, existing.CompanyID);
    const clearingAccount = coaData[clearingAccountId];
    if (!clearingAccount || !clearingAccount.IsPostable) throw new Error('This company\'s GRN Clearing Account is no longer valid.');
    glLines.push({
      AccountCode: clearingAccount.AccountCode, Debit: Math.round(grnSubtotal * 100) / 100, Credit: 0,
      Description: existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    });
  }

  (existing.DirectLines || []).forEach(l => {
    glLines.push({
      AccountCode: l.AccountCode, Debit: l.Amount, Credit: 0,
      Description: l.Description, CostCenterID: l.CostCenterID || existing.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || existing.ProfitCenterID || ''
    });
  });

  if (existing.Discount > 0) {
    const discountAccountId = resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'DiscountReceivedAccountID', 'Discount Received Account');
    const discountAccount = coaData[discountAccountId];
    if (!discountAccount || !discountAccount.IsPostable) throw new Error('This company\'s Discount Received Account is no longer valid.');
    glLines.push({
      AccountCode: discountAccount.AccountCode, Debit: 0, Credit: Math.round(existing.Discount * 100) / 100,
      Description: 'Discount received — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    });
  }

  if (existing.TaxAmount > 0) {
    const taxAccountId = resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'InputTaxAccountID', 'Input Tax Account');
    const taxAccount = coaData[taxAccountId];
    if (!taxAccount || !taxAccount.IsPostable) throw new Error('This company\'s Input Tax Account is no longer valid.');
    glLines.push({
      AccountCode: taxAccount.AccountCode, Debit: Math.round(existing.TaxAmount * 100) / 100, Credit: 0,
      Description: 'Input tax — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    });
  }

  if (existing.RoundOff) {
    const roundOffAccountId = resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'RoundOffAccountID', 'Round Off Account');
    const roundOffAccount = coaData[roundOffAccountId];
    if (!roundOffAccount || !roundOffAccount.IsPostable) throw new Error('This company\'s Round Off Account is no longer valid.');
    const magnitude = Math.round(Math.abs(existing.RoundOff) * 100) / 100;
    if (existing.RoundOff > 0) {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: magnitude, Credit: 0, Description: 'Round off — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    } else {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: 0, Credit: magnitude, Description: 'Round off — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    }
  }

  glLines.push({
    AccountCode: apAccount.AccountCode, Debit: 0, Credit: Math.round(existing.Total * 100) / 100,
    Description: existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
  });

  const actor = user.profile.username || user.uid;
  // Everything above is pure validation and read-only computation —
  // nothing written yet, so any failure up to here is ordinary and
  // safely retriable. From here on, see beginCommitAttempt_'s own
  // section comment for the full reasoning.
  const attemptId = beginCommitAttempt_(idToken, invoiceId, actor, 'vendorInvoices');

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'VendorInvoice', existing.InvoiceDate, existing.Description, existing.VendorRefNumber,
      glLines,
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: invoiceId });
  } catch (err) {
    abandonCommitAttempt_(idToken, invoiceId, existing.Status, actor, 'vendorInvoices');
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  // Marks each matched GRN so it drops out of every future invoice
  // picker — the actual double-invoicing prevention, and the RTDB-side
  // effect this whole commit-marker pattern exists to protect.
  (existing.SourceGRNs || []).forEach(g => {
    firebaseDbRequest_('stock/transactions/' + g.GRNID, 'patch', { MatchedToInvoiceID: invoiceId }, idToken);
  });

  finalizeCommitAttempt_(idToken, invoiceId, glResult, {}, actor, 'vendorInvoices');

  return { invoiceNumber: glResult.jvNumber };
}

function decideVendorInvoiceApproval(idToken, invoiceId, levelNumber, decision, reason) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    requirePostAccess_(idToken, user, 'VENDORINVOICE');
    const existing = firebaseDbRequest_('vendorInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This invoice is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this invoice.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (result.status === 'Approved') {
      try {
        const commitResult = commitVendorInvoicePosting_(idToken, user, existing, invoiceId);
        return { success: true, status: 'Approved', invoiceNumber: commitResult.invoiceNumber };
      } catch (commitErr) {
        // Same architectural gap, same fix, as Customer Invoice's own
        // decideCustomerInvoiceApproval — see its comment for the full
        // reasoning: recordApprovalDecision already permanently
        // persisted this decision before the commit was attempted, so
        // a commit failure here needs an explicit rollback, or the
        // invoice gets stuck forever (still PendingApproval and locked
        // for editing, while the approval instance itself already
        // shows Approved and refuses any further decision).
        const instance = firebaseDbRequest_('approvalInstances/' + existing.ApprovalInstanceID, 'get', null, idToken);
        if (instance) {
          const revertedDecisions = (instance.Decisions || []).filter(d => d.LevelNumber !== levelNumber);
          firebaseDbRequest_('approvalInstances/' + existing.ApprovalInstanceID, 'patch', {
            Decisions: revertedDecisions, Status: 'Pending', UpdatedAt: new Date().toISOString()
          }, idToken);
        }
        firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', {
          Status: 'Rejected',
          RejectionReason: 'Posting failed and could not be completed: ' + commitErr.message + ' — please fix and resubmit.',
          UpdatedAt: new Date().toISOString(), UpdatedBy: actor
        }, idToken);
        throw new Error('Posting failed: ' + commitErr.message + '. The invoice has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'Rejected' };
    }
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Core reversal execution — builds and posts the offsetting GL entry,
// unmatches the source GRNs, and links the two records together.
// Called either immediately (no approval gate configured) or once a
// reversal request has actually been approved. Caller MUST already
// hold LockService.getScriptLock() and have validated existing.Status
// === 'Posted' with no prior ReversedByInvoiceID.
function executeVendorInvoiceReversal_(idToken, user, existing, invoiceId, date) {
  const vendor = firebaseDbRequest_('vendors/' + existing.VendorID, 'get', null, idToken);
  const coaData = getCoaData_(idToken);
  const apAccount = coaData[vendor.TradePayablesAccountID];

  // Same GL lines as the original, every Debit/Credit swapped.
  const glLines = [];
  const grnSubtotal = (existing.SourceGRNs || []).reduce((sum, g) => sum + (Number(g.Amount) || 0), 0);
  if (grnSubtotal > 0) {
    const clearingAccount = coaData[resolveGrnClearingAccount_(idToken, existing.CompanyID)];
    glLines.push({ AccountCode: clearingAccount.AccountCode, Debit: 0, Credit: Math.round(grnSubtotal * 100) / 100, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
  }
  (existing.DirectLines || []).forEach(l => {
    glLines.push({ AccountCode: l.AccountCode, Debit: 0, Credit: l.Amount, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: l.CostCenterID || existing.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || existing.ProfitCenterID || '' });
  });
  if (existing.Discount > 0) {
    const discountAccount = coaData[resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'DiscountReceivedAccountID', 'Discount Received Account')];
    glLines.push({ AccountCode: discountAccount.AccountCode, Debit: Math.round(existing.Discount * 100) / 100, Credit: 0, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
  }
  if (existing.TaxAmount > 0) {
    const taxAccount = coaData[resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'InputTaxAccountID', 'Input Tax Account')];
    glLines.push({ AccountCode: taxAccount.AccountCode, Debit: 0, Credit: Math.round(existing.TaxAmount * 100) / 100, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
  }
  if (existing.RoundOff) {
    const roundOffAccount = coaData[resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'RoundOffAccountID', 'Round Off Account')];
    const magnitude = Math.round(Math.abs(existing.RoundOff) * 100) / 100;
    if (existing.RoundOff > 0) {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: 0, Credit: magnitude, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    } else {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: magnitude, Credit: 0, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    }
  }
  glLines.push({ AccountCode: apAccount.AccountCode, Debit: Math.round(existing.Total * 100) / 100, Credit: 0, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const newId = 'VINVD-' + Utilities.getUuid().split('-')[0].toUpperCase();

  const attemptId = Utilities.getUuid();
  firebaseDbRequest_('vendorInvoices/' + newId, 'put', {
    TransactionType: 'VendorInvoice', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
    InvoiceDate: date, Description: 'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description,
    VendorRefNumber: existing.VendorRefNumber,
    CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
    CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID, VendorID: existing.VendorID,
    SourceGRNs: existing.SourceGRNs || [], DirectLines: existing.DirectLines || [],
    Discount: existing.Discount, TaxPercent: existing.TaxPercent, TaxAmount: existing.TaxAmount, RoundOff: existing.RoundOff,
    Subtotal: existing.Subtotal, Total: existing.Total,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    ReversalOfInvoiceID: invoiceId, ReversedByInvoiceID: ''
  }, idToken);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'VendorInvoice', date,
      'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, existing.VendorRefNumber,
      glLines,
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: newId });
  } catch (err) {
    firebaseDbRequest_('vendorInvoices/' + newId, 'delete', null, idToken);
    throw err;
  }

  // Original patched before the new reversal finalizes — same
  // deliberate ordering as every other module's reversal, preventing
  // double-reversal even under a failure at the worst possible
  // moment. Status reset back to Posted here too — when a reversal
  // gate is configured, requestReverseVendorInvoice already moved the
  // original to PendingReversalApproval, and nothing else ever moved
  // it back; leaving it there was a real bug (the invoice stayed
  // stuck showing "Pending Reversal Approval" forever, even after the
  // reversal had actually gone through).
  firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', { Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '', ReversedByInvoiceID: newId }, idToken);
  finalizeCommitAttempt_(idToken, newId, glResult, {}, actor, 'vendorInvoices');

  // Unmatch every GRN this invoice had claimed — they become
  // available in every future invoice picker again.
  (existing.SourceGRNs || []).forEach(g => {
    firebaseDbRequest_('stock/transactions/' + g.GRNID, 'patch', { MatchedToInvoiceID: '' }, idToken);
  });

  return { invoiceId: newId, invoiceNumber: glResult.jvNumber };
}

// Reversal requires the SAME approval treatment as original posting —
// confirmed deliberately, a genuine departure from every other module
// in this system, where reversal never requires approval. Resolved
// fresh against the CURRENT, live VENDORINVOICE approval configuration
// — the exact same gate resolution postVendorInvoice itself uses, not
// a frozen snapshot of whatever gate existed when this invoice was
// first posted. If no gate is currently configured, reversal proceeds
// immediately, same "no gate configured means no gate" rule every
// other approval-gated action in this system already follows.
function requestReverseVendorInvoice(idToken, invoiceId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('vendorInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'VENDORINVOICE');
    if (existing.Status !== 'Posted') throw new Error('Only posted invoices can be reversed.');
    if (existing.ReversedByInvoiceID) throw new Error('This invoice has already been reversed.');
    if (existing.ReversalOfInvoiceID) throw new Error('A reversal entry cannot itself be reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'VENDORINVOICE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'VENDORINVOICE', invoiceId, (existing.TransactionNumber || '') + ' (Reversal)', scopeKey, existing.Total, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no GL entry, no GRN unmatched —
      // until this is actually approved (see
      // decideVendorInvoiceReversalApproval, which is where
      // executeVendorInvoiceReversal_ runs in that case). A dedicated
      // status, not the shared 'PendingApproval' a fresh submission
      // uses — that distinction matters here: it makes it structurally
      // impossible for decideVendorInvoiceApproval (which only ever
      // acts on 'PendingApproval') to be called against a
      // reversal-in-progress invoice by mistake, which would otherwise
      // risk re-triggering a normal post on an already-posted invoice.
      firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', {
        Status: 'PendingReversalApproval', ReversalApprovalInstanceID: approval.instanceId,
        PendingReversalDate: date, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingReversalApproval' };
    }

    const result = executeVendorInvoiceReversal_(idToken, user, existing, invoiceId, date);
    return { success: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// A rejected reversal request falls back to Posted, not a generic
// 'Rejected' state — there's no edit form for a reversal request,
// nothing to revise and resubmit. The invoice simply remains exactly
// as it was: posted, unreversed.
function decideVendorInvoiceReversalApproval(idToken, invoiceId, levelNumber, decision, reason) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    requirePostAccess_(idToken, user, 'VENDORINVOICE');
    const existing = firebaseDbRequest_('vendorInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingReversalApproval') throw new Error('This invoice is not awaiting reversal approval.');
    if (!existing.ReversalApprovalInstanceID) throw new Error('No approval record found for this reversal request.');

    const result = recordApprovalDecision(idToken, existing.ReversalApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (result.status === 'Approved') {
      const date = existing.PendingReversalDate || new Date().toISOString().substring(0, 10);
      const reversalResult = executeVendorInvoiceReversal_(idToken, user, existing, invoiceId, date);
      return { success: true, status: 'Approved', invoiceId: reversalResult.invoiceId, invoiceNumber: reversalResult.invoiceNumber };
    }
    if (result.status === 'Rejected') {
      firebaseDbRequest_('vendorInvoices/' + invoiceId, 'patch', {
        Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '',
        ReversalRejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'Rejected' };
    }
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// CUSTOMER INVOICE PROCESSING — AR's counterpart to Vendor Invoice
// ============================================================
// Matches a Customer's Posted, not-yet-invoiced Delivery Notes (whole
// Delivery Notes, mirroring Vendor Invoice's own whole-GRN picker —
// not line-level, unlike Delivery Note's own line-level SO picker)
// against a manually entered Discount, Tax %, and Round Off, plus
// optional direct (non-delivery) lines for charges never shipped at
// all (installation, consulting). Delivery Note's own UnitPrice is
// already locked to the Sales Order's own price at delivery time, so
// there's no price disagreement possible here either — same reasoning
// as Vendor Invoice's own GRN-sourced lines.
//
// GL shape — mirrors Vendor Invoice's structure, but genuinely
// different in one place, not just relabelled: revenue is resolved by
// SALES TYPE, not by item. Each Sales Type (Local Sales, Export Sales,
// RM Sales, Service Invoice, etc. — managed in Sales Invoice
// Configuration) maps to its own Revenue account, since the SAME item
// sold locally vs. exported often needs to post to a different
// account for tax reconciliation — something a fixed per-item field
// couldn't represent. Sales Types can genuinely mix within one
// invoice (confirmed: an Export Sales invoice can still carry a
// Local-flavored direct line like freight), so each Delivery Note and
// each direct line carries its OWN required Sales Type — no default —
// rather than one choice for the whole invoice. A Sales Type may
// optionally be restricted to one Customer Classification (e.g.
// "Export Sales" restricted to "Export" customers only); enforced at
// save time via resolveAndValidateSalesType_, not just suggested.
//
//   Dr Accounts Receivable (customer's own TradeReceivablesAccountID)
//   Cr Revenue (per Sales Type's own mapped account — aggregated, so
//     several lines sharing one Sales Type still produce one credit)
//   Cr Revenue (direct lines' own Sales Type, same aggregation — a
//     direct line here is additional billing, not an expense the way
//     Vendor Invoice's own direct lines are)
//   Dr Discount Given (if any — company account, mirrors Discount
//     Received but the opposite side, since giving a discount reduces
//     what we're owed rather than what we owe)
//   Cr Output Tax (if any — company account, a liability we now owe
//     the tax authority, mirroring Input Tax's opposite role as a
//     receivable)
//   Dr OR Cr Round Off — THE SIGN CONVENTION FLIPS from Vendor
//     Invoice's own: AP sits on the credit side there, so a positive
//     round-off (owing slightly more) debits Round Off to balance.
//     Here AR sits on the DEBIT side, so a positive round-off
//     (owed slightly more) needs to CREDIT Round Off instead, to
//     balance against the larger AR debit. Proven with a direct
//     balance test, not just mirrored blind.
//
// Storage: /customerInvoices/{id}, using the SAME commit-marker safety
// pattern as Vendor Invoice — collectionPath is 'customerInvoices'
// throughout, not the default 'stock/transactions'.

function getCustomerInvoiceEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'CUSTOMERINVOICE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Customer Invoice Processing.');
  }
  const data = firebaseDbRequest_('customerInvoices', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ CustomerInvoiceID: id }, data[id]))
    .filter(inv => userCanAccessCompany_(user.profile, inv.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Posted Delivery Notes for the given company AND customer, not
// already matched to any invoice. Customer is required, same
// reasoning as Delivery Note's own single-customer-per-document rule
// — an invoice belongs to exactly one customer, and every Delivery
// Note it can possibly match against already carries its own
// CustomerID.
function getEligibleDeliveryNotesForInvoice(idToken, companyId, customerId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'CUSTOMERINVOICE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Customer Invoice Processing.');
  }
  if (!companyId || !customerId) return [];

  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ DeliveryNoteID: id }, data[id]))
    .filter(dn => dn.TransactionType === 'DeliveryNote' && dn.Status === 'Posted' && dn.CompanyID === companyId && dn.CustomerID === customerId && !dn.MatchedToInvoiceID)
    .map(dn => ({
      DeliveryNoteID: dn.DeliveryNoteID, DeliveryNoteNumber: dn.TransactionNumber, TransactionDate: dn.TransactionDate,
      Description: dn.Description,
      Amount: (dn.Lines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0), 0)
    }));
}

function deleteCustomerInvoiceDraft(idToken, invoiceId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'CUSTOMERINVOICE');
    const existing = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Customer Invoice not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Customer Invoice can be deleted.');
    firebaseDbRequest_('customerInvoices/' + invoiceId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Shared by saveCustomerInvoiceDraft, commitCustomerInvoicePosting_ and
// executeCustomerInvoiceReversal_ — resolves a chosen Sales Type,
// confirms it's active, and if it's restricted to a specific Customer
// Classification, confirms the invoice's own customer actually holds
// that classification. customerClassificationName is the customer's
// own stored Classification (a NAME string, matching
// saveCustomer's own storage), resolved to a ClassificationID here the
// same backward-compatible way saveCustomer itself resolves it, so a
// customer classified under either the current managed list or an
// old pre-migration plain string is handled identically.
function resolveAndValidateSalesType_(idToken, salesTypeId, customerClassificationName, label) {
  const id = String(salesTypeId || '').trim();
  if (!id) throw new Error(label + ': a Sales Type is required.');
  const salesTypeData = firebaseDbRequest_('salesTypes/' + id, 'get', null, idToken);
  if (!salesTypeData || salesTypeData.Status !== 'Active') throw new Error(label + ': unknown or inactive Sales Type.');

  if (salesTypeData.RestrictedToClassificationID) {
    let classificationData = firebaseDbRequest_('customerClassifications', 'get', null, idToken) || {};
    classificationData = ensureCustomerClassificationsSeeded_(idToken, classificationData);
    const customerClassification = classificationData[customerClassificationName]
      || Object.values(classificationData).find(c => c.Name === customerClassificationName);
    const restrictionClassification = classificationData[salesTypeData.RestrictedToClassificationID];
    const customerClassificationId = customerClassification
      ? Object.keys(classificationData).find(cid => classificationData[cid] === customerClassification)
      : null;
    if (customerClassificationId !== salesTypeData.RestrictedToClassificationID) {
      throw new Error(label + ': Sales Type "' + salesTypeData.Name + '" is restricted to ' +
        (restrictionClassification ? restrictionClassification.Name : 'a different') +
        ' customers — this customer is classified as ' + (customerClassificationName || 'unset') + '.');
    }
  }

  return Object.assign({ SalesTypeID: id }, salesTypeData);
}

function saveCustomerInvoiceDraft(idToken, invoiceData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'CUSTOMERINVOICE');

    const invoiceId = String(invoiceData.CustomerInvoiceID || '').trim();
    const invoiceDate = String(invoiceData.InvoiceDate || '').trim();
    if (!invoiceDate) throw new Error('Invoice date is required.');
    const description = String(invoiceData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const companyId = String(invoiceData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this invoice.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const customerId = String(invoiceData.CustomerID || '').trim();
    if (!customerId) throw new Error('Select a Customer for this invoice.');
    const customerData = firebaseDbRequest_('customers/' + customerId, 'get', null, idToken);
    if (!customerData || customerData.Status !== 'Active') throw new Error('Unknown or inactive Customer.');

    const divisionId = String(invoiceData.DivisionID || '').trim();
    const branchId = String(invoiceData.BranchID || '').trim();
    const costCenterId = String(invoiceData.CostCenterID || '').trim();
    const profitCenterId = String(invoiceData.ProfitCenterID || '').trim();

    // Source Delivery Notes — each must be Posted, same Company AND
    // Customer as this invoice, and not already matched to a
    // DIFFERENT invoice (matched to THIS SAME draft, on a re-save, is
    // fine). Each carries its OWN required Sales Type — no default,
    // and validated against the customer's own Classification via
    // resolveAndValidateSalesType_ — since Sales Types can genuinely
    // mix within one invoice (confirmed: an Export Sales invoice can
    // still carry a Local-flavored direct line like freight, or vice
    // versa), each Delivery Note (and each direct line, below) is
    // tagged independently rather than the invoice as a whole. Each
    // line's own item/quantity/price is still carried through for
    // audit/display purposes, even though revenue GL posting itself no
    // longer needs it — see commitCustomerInvoicePosting_'s own
    // section comment for why.
    const rawDNs = invoiceData.SourceDeliveryNotes || [];
    const dnCache = {};
    function loadDN_(dnId) {
      if (!dnCache.hasOwnProperty(dnId)) dnCache[dnId] = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
      return dnCache[dnId];
    }
    const sourceDeliveryNotes = rawDNs.map((d, idx) => {
      const dnId = String(d.DeliveryNoteID || '').trim();
      if (!dnId) throw new Error('Source Delivery Note ' + (idx + 1) + ': missing ID.');
      const dn = loadDN_(dnId);
      if (!dn || dn.TransactionType !== 'DeliveryNote' || dn.Status !== 'Posted') {
        throw new Error('Source Delivery Note ' + (idx + 1) + ': not found or not Posted.');
      }
      if (dn.CompanyID !== companyId) throw new Error('Source Delivery Note ' + (idx + 1) + ': belongs to a different Company.');
      if (dn.CustomerID !== customerId) throw new Error('Source Delivery Note ' + (idx + 1) + ': belongs to a different Customer — an invoice can only draw from one Customer\'s Delivery Notes.');
      if (dn.MatchedToInvoiceID && dn.MatchedToInvoiceID !== invoiceId) {
        throw new Error('Source Delivery Note ' + (idx + 1) + ' (' + (dn.TransactionNumber || dnId) + ') is already matched to a different invoice.');
      }
      const salesType = resolveAndValidateSalesType_(idToken, d.SalesTypeID, customerData.Classification, 'Source Delivery Note ' + (idx + 1) + ' (' + (dn.TransactionNumber || dnId) + ')');
      const lines = (dn.Lines || []).map(l => ({ ItemCode: l.ItemCode, Quantity: Number(l.Quantity) || 0, UnitPrice: Number(l.UnitPrice) || 0, CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '' }));
      const amount = lines.reduce((sum, l) => sum + l.Quantity * l.UnitPrice, 0);
      return { DeliveryNoteID: dnId, DeliveryNoteNumber: dn.TransactionNumber || '', SalesTypeID: salesType.SalesTypeID, Amount: Math.round(amount * 100) / 100, Lines: lines };
    });

    // Direct lines — non-delivery charges (installation, consulting).
    // Each is always a CREDIT to its own account — additional billing,
    // not an expense, the opposite role Vendor Invoice's own direct
    // lines play. Each also carries its OWN required Sales Type, same
    // as a Delivery Note above — e.g. a freight charge added to an
    // otherwise Export Sales invoice might reasonably be tagged with a
    // different Sales Type of its own.
    const coaData = getCoaData_(idToken);
    const rawDirectLines = (invoiceData.DirectLines || []).filter(l => String(l.AccountCode || '').trim());
    const directLines = rawDirectLines.map((l, idx) => {
      const accountCode = String(l.AccountCode || '').trim();
      const account = Object.values(coaData).find(a => a.AccountCode === accountCode);
      if (!account || !account.IsPostable || account.Status !== 'Active') {
        throw new Error('Direct line ' + (idx + 1) + ': unknown or non-postable account.');
      }
      const amount = Number(l.Amount);
      if (!(amount > 0)) throw new Error('Direct line ' + (idx + 1) + ': amount must be greater than zero.');
      const lineDescription = String(l.Description || '').trim();
      if (!lineDescription) throw new Error('Direct line ' + (idx + 1) + ': description is required.');
      const salesType = resolveAndValidateSalesType_(idToken, l.SalesTypeID, customerData.Classification, 'Direct line ' + (idx + 1));
      return {
        AccountCode: accountCode, Description: lineDescription, Amount: Math.round(amount * 100) / 100,
        SalesTypeID: salesType.SalesTypeID,
        CostCenterID: String(l.CostCenterID || '').trim(), ProfitCenterID: String(l.ProfitCenterID || '').trim()
      };
    });

    if (!sourceDeliveryNotes.length && !directLines.length) {
      throw new Error('Add at least one Delivery Note or one direct line.');
    }

    // Cost Center is required somewhere for the Revenue side of every
    // line — either the line's own (Direct Lines only expose this),
    // or the header's own as a fallback — same reasoning and same
    // wording as Delivery Note's own established pattern: Revenue is
    // one of the account types that always triggers the
    // Cost-Center-required rule, so catching a missing one clearly
    // here, at save time, is better than letting it surface as a
    // cryptic account-code error deep in GL posting at commit time.
    if (sourceDeliveryNotes.length && !costCenterId) {
      throw new Error('A Cost Center is required (set the header default) — every Delivery Note-sourced line posts to a Revenue account, which always needs one.');
    }
    directLines.forEach((l, idx) => {
      if (!l.CostCenterID && !costCenterId) {
        throw new Error('Direct line ' + (idx + 1) + ': Cost Center is required — set one on this line or as the header default.');
      }
    });

    const discount = Number(invoiceData.Discount) || 0;
    if (discount < 0) throw new Error('Discount cannot be negative.');
    const taxPercent = Number(invoiceData.TaxPercent) || 0;
    if (taxPercent < 0) throw new Error('Tax % cannot be negative.');
    const roundOff = Number(invoiceData.RoundOff) || 0;

    const dnSubtotal = sourceDeliveryNotes.reduce((sum, d) => sum + d.Amount, 0);
    const directTotal = directLines.reduce((sum, l) => sum + l.Amount, 0);
    const subtotal = Math.round((dnSubtotal + directTotal) * 100) / 100;
    if (discount > subtotal) throw new Error('Discount cannot exceed the invoice subtotal.');
    // Tax computed on the NET of discount, same confirmed formula as
    // Vendor Invoice's own.
    const taxAmount = Math.round(((subtotal - discount) * taxPercent / 100) * 100) / 100;
    const total = Math.round((subtotal - discount + taxAmount + roundOff) * 100) / 100;

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'CustomerInvoice',
      InvoiceDate: invoiceDate, Description: description,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId, CustomerID: customerId,
      SourceDeliveryNotes: sourceDeliveryNotes, DirectLines: directLines,
      Discount: discount, TaxPercent: taxPercent, TaxAmount: taxAmount, RoundOff: roundOff,
      Subtotal: subtotal, Total: total,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (invoiceId) {
      const existing = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
      if (!existing) throw new Error('Customer Invoice not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected invoices can be edited.');
      firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', fields, idToken);
      return { success: true, invoiceId: invoiceId };
    }

    const newId = 'CINVD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('customerInvoices/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, invoiceId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function postCustomerInvoice(idToken, invoiceId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Customer Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'CUSTOMERINVOICE');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected invoices can be posted.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'CUSTOMERINVOICE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'CUSTOMERINVOICE', invoiceId, '', scopeKey, existing.Total, user.uid);

    if (approval.required) {
      firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitCustomerInvoicePosting_(idToken, user, existing, invoiceId);
    return { success: true, invoiceId: invoiceId, invoiceNumber: result.invoiceNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Caller MUST already hold LockService.getScriptLock().
function commitCustomerInvoicePosting_(idToken, user, existing, invoiceId) {
  const customer = firebaseDbRequest_('customers/' + existing.CustomerID, 'get', null, idToken);
  const coaData = getCoaData_(idToken);
  if (!customer || !customer.TradeReceivablesAccountID) {
    throw new Error('This Customer has no Trade Receivables Account configured. Set one in Customer Master Data before posting.');
  }
  const arAccount = coaData[customer.TradeReceivablesAccountID];
  if (!arAccount || !arAccount.IsPostable) throw new Error('This Customer\'s Trade Receivables Account is no longer valid.');

  const salesTypeData = firebaseDbRequest_('salesTypes', 'get', null, idToken) || {};

  const glLines = [];

  // Revenue, aggregated by SALES TYPE — replaces the earlier per-item
  // resolution entirely. Each Delivery Note and each direct line
  // already carries its own validated SalesTypeID (set and checked
  // against the customer's own Classification back at save time), so
  // this only needs to look up each Sales Type's own mapped account —
  // no per-line item lookups needed here at all, genuinely simpler
  // than the design it replaces.
  //
  // Aggregated by a COMPOSITE key (account + Cost Center + Profit
  // Center), not by account alone — a Direct Line carries its own
  // editable Cost Center/Profit Center (shown right in the grid), and
  // collapsing everything to the header's own would silently discard
  // whatever the user actually chose there. A Delivery Note has no
  // single dimension of its own to offer here (its Lines can span
  // several), so DN-sourced revenue always uses the header's — which
  // is exactly why the header Cost Center is required at save time
  // whenever any Delivery Note is attached.
  const revenueByKey = {};
  function addRevenue_(salesTypeId, amount, costCenterId, profitCenterId, contextLabel) {
    const salesType = salesTypeData[salesTypeId];
    if (!salesType || salesType.Status !== 'Active') throw new Error(contextLabel + ': its Sales Type is no longer valid — check Sales Invoice Configuration.');
    const key = salesType.GLAccountID + '|' + costCenterId + '|' + profitCenterId;
    if (!revenueByKey[key]) revenueByKey[key] = { accountId: salesType.GLAccountID, costCenterId: costCenterId, profitCenterId: profitCenterId, amount: 0 };
    revenueByKey[key].amount += amount;
  }
  (existing.SourceDeliveryNotes || []).forEach(dn => {
    addRevenue_(dn.SalesTypeID, dn.Amount, existing.CostCenterID || '', existing.ProfitCenterID || '', 'Delivery Note ' + (dn.DeliveryNoteNumber || dn.DeliveryNoteID));
  });
  (existing.DirectLines || []).forEach(l => {
    // A direct line's OWN account (l.AccountCode) is what it's
    // eventually billed against in the customer-facing sense, but
    // revenue recognition itself follows the same Sales-Type-mapped
    // account as everything else — consistent treatment across the
    // whole invoice regardless of source.
    addRevenue_(l.SalesTypeID, l.Amount, l.CostCenterID || existing.CostCenterID || '', l.ProfitCenterID || existing.ProfitCenterID || '', 'Direct line — ' + l.Description);
  });
  Object.values(revenueByKey).forEach(entry => {
    const account = coaData[entry.accountId];
    if (!account || !account.IsPostable) throw new Error('A Sales Type\'s mapped Revenue Account is no longer valid — check Sales Invoice Configuration.');
    glLines.push({
      AccountCode: account.AccountCode, Debit: 0, Credit: Math.round(entry.amount * 100) / 100,
      Description: existing.Description, CostCenterID: entry.costCenterId, ProfitCenterID: entry.profitCenterId
    });
  });

  if (existing.Discount > 0) {
    const discountAccountId = resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'DiscountGivenAccountID', 'Discount Given Account');
    const discountAccount = coaData[discountAccountId];
    if (!discountAccount || !discountAccount.IsPostable) throw new Error('This company\'s Discount Given Account is no longer valid.');
    glLines.push({
      AccountCode: discountAccount.AccountCode, Debit: Math.round(existing.Discount * 100) / 100, Credit: 0,
      Description: 'Discount given — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    });
  }

  if (existing.TaxAmount > 0) {
    const taxAccountId = resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'OutputTaxAccountID', 'Output Tax Account');
    const taxAccount = coaData[taxAccountId];
    if (!taxAccount || !taxAccount.IsPostable) throw new Error('This company\'s Output Tax Account is no longer valid.');
    glLines.push({
      AccountCode: taxAccount.AccountCode, Debit: 0, Credit: Math.round(existing.TaxAmount * 100) / 100,
      Description: 'Output tax — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    });
  }

  if (existing.RoundOff) {
    const roundOffAccountId = resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'RoundOffAccountID', 'Round Off Account');
    const roundOffAccount = coaData[roundOffAccountId];
    if (!roundOffAccount || !roundOffAccount.IsPostable) throw new Error('This company\'s Round Off Account is no longer valid.');
    const magnitude = Math.round(Math.abs(existing.RoundOff) * 100) / 100;
    // Sign convention FLIPPED from Vendor Invoice — see this module's
    // own section comment for the full reasoning: AR sits on the debit
    // side here, so a positive round-off credits Round Off, not debits
    // it.
    if (existing.RoundOff > 0) {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: 0, Credit: magnitude, Description: 'Round off — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    } else {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: magnitude, Credit: 0, Description: 'Round off — ' + existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    }
  }

  glLines.push({
    AccountCode: arAccount.AccountCode, Debit: Math.round(existing.Total * 100) / 100, Credit: 0,
    Description: existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
  });

  const actor = user.profile.username || user.uid;
  const attemptId = beginCommitAttempt_(idToken, invoiceId, actor, 'customerInvoices');

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'CustomerInvoice', existing.InvoiceDate, existing.Description, '',
      glLines,
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: invoiceId });
  } catch (err) {
    abandonCommitAttempt_(idToken, invoiceId, existing.Status, actor, 'customerInvoices');
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  // Marks each matched Delivery Note so it drops out of every future
  // invoice picker.
  (existing.SourceDeliveryNotes || []).forEach(dn => {
    firebaseDbRequest_('stock/transactions/' + dn.DeliveryNoteID, 'patch', { MatchedToInvoiceID: invoiceId }, idToken);
  });

  finalizeCommitAttempt_(idToken, invoiceId, glResult, {}, actor, 'customerInvoices');

  return { invoiceNumber: glResult.jvNumber };
}

function decideCustomerInvoiceApproval(idToken, invoiceId, levelNumber, decision, reason) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    requirePostAccess_(idToken, user, 'CUSTOMERINVOICE');
    const existing = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Customer Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This invoice is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this invoice.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (result.status === 'Approved') {
      try {
        const commitResult = commitCustomerInvoicePosting_(idToken, user, existing, invoiceId);
        return { success: true, status: 'Approved', invoiceNumber: commitResult.invoiceNumber };
      } catch (commitErr) {
        // recordApprovalDecision, above, already permanently persisted
        // this decision to Firebase before the commit was even
        // attempted — the two are NOT atomic. Left alone, a commit
        // failure here (a missing Cost Center, an invalid account,
        // etc.) leaves the invoice stuck forever: still
        // PendingApproval, so the client locks every field including
        // the one that needs fixing — while the approval instance
        // itself is already Approved, so a retry (approve OR reject)
        // is refused, since recordApprovalDecision only accepts a
        // decision on a still-Pending instance.
        //
        // Roll the instance back to Pending, dropping this level's now-
        // invalid decision, and return the INVOICE itself to Rejected
        // — reusing Rejected's existing, already fully-editable
        // semantics rather than inventing a new status — so the user
        // can actually fix the problem and resubmit.
        const instance = firebaseDbRequest_('approvalInstances/' + existing.ApprovalInstanceID, 'get', null, idToken);
        if (instance) {
          const revertedDecisions = (instance.Decisions || []).filter(d => d.LevelNumber !== levelNumber);
          firebaseDbRequest_('approvalInstances/' + existing.ApprovalInstanceID, 'patch', {
            Decisions: revertedDecisions, Status: 'Pending', UpdatedAt: new Date().toISOString()
          }, idToken);
        }
        firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', {
          Status: 'Rejected',
          RejectionReason: 'Posting failed and could not be completed: ' + commitErr.message + ' — please fix and resubmit.',
          UpdatedAt: new Date().toISOString(), UpdatedBy: actor
        }, idToken);
        throw new Error('Posting failed: ' + commitErr.message + '. The invoice has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'Rejected' };
    }
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Core reversal execution — builds and posts the offsetting GL entry,
// unmatches the source Delivery Notes, and links the two records
// together. Called either immediately (no approval gate configured)
// or once a reversal request has actually been approved. Caller MUST
// already hold LockService.getScriptLock() and have validated
// existing.Status === 'Posted' with no prior ReversedByInvoiceID.
function executeCustomerInvoiceReversal_(idToken, user, existing, invoiceId, date) {
  const customer = firebaseDbRequest_('customers/' + existing.CustomerID, 'get', null, idToken);
  const coaData = getCoaData_(idToken);
  const arAccount = coaData[customer.TradeReceivablesAccountID];

  const salesTypeData = firebaseDbRequest_('salesTypes', 'get', null, idToken) || {};

  // Same GL lines as the original, every Debit/Credit swapped — same
  // Sales-Type-based, composite-key aggregation as
  // commitCustomerInvoicePosting_'s own (see its section comment for
  // the full reasoning), reusing exactly the SalesTypeID each line
  // already carries from when it was originally posted (not
  // re-validated against the customer's current Classification here —
  // this is reproducing a historical entry, not making a new
  // classification decision).
  const glLines = [];
  const revenueByKey = {};
  function addReversalRevenue_(salesTypeId, amount, costCenterId, profitCenterId) {
    const salesType = salesTypeData[salesTypeId];
    if (!salesType) return;
    const key = salesType.GLAccountID + '|' + costCenterId + '|' + profitCenterId;
    if (!revenueByKey[key]) revenueByKey[key] = { accountId: salesType.GLAccountID, costCenterId: costCenterId, profitCenterId: profitCenterId, amount: 0 };
    revenueByKey[key].amount += amount;
  }
  (existing.SourceDeliveryNotes || []).forEach(dn => {
    addReversalRevenue_(dn.SalesTypeID, dn.Amount, existing.CostCenterID || '', existing.ProfitCenterID || '');
  });
  (existing.DirectLines || []).forEach(l => {
    addReversalRevenue_(l.SalesTypeID, l.Amount, l.CostCenterID || existing.CostCenterID || '', l.ProfitCenterID || existing.ProfitCenterID || '');
  });
  Object.values(revenueByKey).forEach(entry => {
    const account = coaData[entry.accountId];
    glLines.push({ AccountCode: account.AccountCode, Debit: Math.round(entry.amount * 100) / 100, Credit: 0, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: entry.costCenterId, ProfitCenterID: entry.profitCenterId });
  });
  if (existing.Discount > 0) {
    const discountAccount = coaData[resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'DiscountGivenAccountID', 'Discount Given Account')];
    glLines.push({ AccountCode: discountAccount.AccountCode, Debit: 0, Credit: Math.round(existing.Discount * 100) / 100, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
  }
  if (existing.TaxAmount > 0) {
    const taxAccount = coaData[resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'OutputTaxAccountID', 'Output Tax Account')];
    glLines.push({ AccountCode: taxAccount.AccountCode, Debit: Math.round(existing.TaxAmount * 100) / 100, Credit: 0, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
  }
  if (existing.RoundOff) {
    const roundOffAccount = coaData[resolveCompanyFixedAccount_(idToken, existing.CompanyID, 'RoundOffAccountID', 'Round Off Account')];
    const magnitude = Math.round(Math.abs(existing.RoundOff) * 100) / 100;
    if (existing.RoundOff > 0) {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: magnitude, Credit: 0, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    } else {
      glLines.push({ AccountCode: roundOffAccount.AccountCode, Debit: 0, Credit: magnitude, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });
    }
  }
  glLines.push({ AccountCode: arAccount.AccountCode, Debit: 0, Credit: Math.round(existing.Total * 100) / 100, Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' });

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const newId = 'CINVD-' + Utilities.getUuid().split('-')[0].toUpperCase();

  const attemptId = Utilities.getUuid();
  firebaseDbRequest_('customerInvoices/' + newId, 'put', {
    TransactionType: 'CustomerInvoice', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
    InvoiceDate: date, Description: 'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description,
    CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
    CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID, CustomerID: existing.CustomerID,
    SourceDeliveryNotes: existing.SourceDeliveryNotes || [], DirectLines: existing.DirectLines || [],
    Discount: existing.Discount, TaxPercent: existing.TaxPercent, TaxAmount: existing.TaxAmount, RoundOff: existing.RoundOff,
    Subtotal: existing.Subtotal, Total: existing.Total,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
    ReversalOfInvoiceID: invoiceId, ReversedByInvoiceID: ''
  }, idToken);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'CustomerInvoice', date,
      'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, '',
      glLines,
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: newId });
  } catch (err) {
    firebaseDbRequest_('customerInvoices/' + newId, 'delete', null, idToken);
    throw err;
  }

  // Status reset back to Posted here too — when a reversal gate is
  // configured, requestReverseCustomerInvoice already moved the
  // original to PendingReversalApproval, and nothing else ever moved
  // it back; leaving it there was a real bug (the invoice stayed
  // stuck showing "Pending Reversal Approval" forever, even after the
  // reversal had actually gone through) — same bug also found and
  // fixed in Vendor Invoice's own reversal.
  firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', { Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '', ReversedByInvoiceID: newId }, idToken);
  finalizeCommitAttempt_(idToken, newId, glResult, {}, actor, 'customerInvoices');

  (existing.SourceDeliveryNotes || []).forEach(dn => {
    firebaseDbRequest_('stock/transactions/' + dn.DeliveryNoteID, 'patch', { MatchedToInvoiceID: '' }, idToken);
  });

  return { invoiceId: newId, invoiceNumber: glResult.jvNumber };
}

// Reversal requires the SAME approval treatment as original posting —
// same confirmed rule as Vendor Invoice's own. Resolved fresh against
// the CURRENT, live CUSTOMERINVOICE approval configuration.
function requestReverseCustomerInvoice(idToken, invoiceId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Customer Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'CUSTOMERINVOICE');
    if (existing.Status !== 'Posted') throw new Error('Only posted invoices can be reversed.');
    if (existing.ReversedByInvoiceID) throw new Error('This invoice has already been reversed.');
    if (existing.ReversalOfInvoiceID) throw new Error('A reversal entry cannot itself be reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'CUSTOMERINVOICE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'CUSTOMERINVOICE', invoiceId, (existing.TransactionNumber || '') + ' (Reversal)', scopeKey, existing.Total, user.uid);

    if (approval.required) {
      firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', {
        Status: 'PendingReversalApproval', ReversalApprovalInstanceID: approval.instanceId,
        PendingReversalDate: date, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingReversalApproval' };
    }

    const result = executeCustomerInvoiceReversal_(idToken, user, existing, invoiceId, date);
    return { success: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// A rejected reversal request falls back to Posted, not a generic
// 'Rejected' state — same reasoning as Vendor Invoice's own.
function decideCustomerInvoiceReversalApproval(idToken, invoiceId, levelNumber, decision, reason) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    requirePostAccess_(idToken, user, 'CUSTOMERINVOICE');
    const existing = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
    if (!existing) throw new Error('Customer Invoice not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingReversalApproval') throw new Error('This invoice is not awaiting reversal approval.');
    if (!existing.ReversalApprovalInstanceID) throw new Error('No approval record found for this reversal request.');

    const result = recordApprovalDecision(idToken, existing.ReversalApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (result.status === 'Approved') {
      const date = existing.PendingReversalDate || new Date().toISOString().substring(0, 10);
      const reversalResult = executeCustomerInvoiceReversal_(idToken, user, existing, invoiceId, date);
      return { success: true, status: 'Approved', invoiceId: reversalResult.invoiceId, invoiceNumber: reversalResult.invoiceNumber };
    }
    if (result.status === 'Rejected') {
      firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', {
        Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '',
        ReversalRejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'Rejected' };
    }
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// DELIVERY NOTE (Goods Dispatch) — SO's counterpart to GRN
// ============================================================
// Outbound stock movement fulfilling a Sales Order, sourced ONLY from
// SO lines — confirmed design: unlike GRN (which mixes PO-sourced and
// free-entry lines), Delivery Note has no direct-entry mode at all,
// since shipping stock with no order behind it doesn't fit this
// system's flow. Every line locks to its SO line's own Warehouse (the
// reservation sits at a specific warehouse — shipping from a different
// one would leave that reservation meaningless) and own UnitPrice
// (confirmed: same price as the SO, not re-enterable), and is capped
// at whichever is smaller of what's still Remaining on the line or
// what's currently Reserved for it — confirmed: never more than SO
// quantity, a deliberate asymmetry from GRN's own permitted
// over-receipt.
//
// GL shape, once posted — simpler than GRN's, deliberately (see the
// Delivery Note design discussion): no clearing/suspense account,
// since there's no price uncertainty the way GRN has before its
// invoice arrives. Cost is fully known the instant goods leave:
//   Cr Inventory (item's own InventoryAccountID, at WAC — exactly what
//     computeStockMovement_ already produces for any outbound line)
//   Dr COGS (resolveItemExpenseAccount_(item, 'Sales') — already
//     exists, already checks item.SalesCogsAccountID first, same
//     mechanism Material Issue's own Consumption side already uses
//     live)
// UnitPrice carried on each line is NOT used in this GL entry at all —
// it rides along purely for Customer Invoice to read later, the same
// role GRN's own locked PO price plays for Vendor Invoice.
//
// Same commit-safety pattern as every stock module (write-ahead
// marker, Firestore GL write, RTDB side effects, reconciliation
// sweep) — collectionPath stays the default 'stock/transactions',
// since this genuinely IS a stock module like GRN, not a different
// collection the way Vendor Invoice needed.
//
// RTDB side effects on successful commit: each SO line's own
// DeliveredQuantity accumulates (mirrors updatePOLineReceivedQuantity_),
// its matching reservation shrinks by the shipped amount
// (consumeReservationForDelivery_), and the SO's own Reserved/Partially
// Reserved status is refreshed to account for both together.

function getDeliveryNoteEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'DELIVERYNOTE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Delivery Note.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ DeliveryNoteID: id }, data[id]))
    .filter(dn => dn.TransactionType === 'DeliveryNote')
    .filter(dn => userCanAccessCompany_(user.profile, dn.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

function saveDeliveryNoteDraft(idToken, dnData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'DELIVERYNOTE');

    const dnId = String(dnData.DeliveryNoteID || '').trim();
    const transactionDate = String(dnData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(dnData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(dnData.Reference || '').trim();
    const companyId = String(dnData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(dnData.DivisionID || '').trim();
    const branchId = String(dnData.BranchID || '').trim();
    const costCenterId = String(dnData.CostCenterID || '').trim();
    const profitCenterId = String(dnData.ProfitCenterID || '').trim();

    const customerId = String(dnData.CustomerID || '').trim();
    if (!customerId) throw new Error('Select a Customer for this transaction.');
    const customerData = firebaseDbRequest_('customers/' + customerId, 'get', null, idToken);
    if (!customerData || customerData.Status !== 'Active') throw new Error('Unknown or inactive Customer.');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemByCode = {};
    Object.keys(itemsData).forEach(id => { itemByCode[itemsData[id].ItemCode] = Object.assign({ ItemID: id }, itemsData[id]); });

    // Source SOs referenced by any line, cached once — a single
    // delivery commonly pulls several lines from the same SO.
    // Confirmed design mirrors GRN's own single-vendor rule: one
    // Delivery Note is restricted to exactly one Customer, even across
    // multiple SOs.
    const soCache = {};
    function loadSourceSO_(soId) {
      if (!soCache.hasOwnProperty(soId)) soCache[soId] = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
      return soCache[soId];
    }

    const rawLines = dnData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const sourceSOId = String(line.SourceSOID || '').trim();
      const sourceSOLineId = String(line.SourceSOLineID || '').trim();
      if (!sourceSOId || !sourceSOLineId) return; // skip blank trailing row

      const sourceSO = loadSourceSO_(sourceSOId);
      if (!sourceSO || (sourceSO.Status !== 'Reserved' && sourceSO.Status !== 'Partially Reserved')) {
        throw new Error('Line ' + (idx + 1) + ': the referenced Sales Order is no longer available for delivery.');
      }
      if (sourceSO.CompanyID !== companyId) throw new Error('Line ' + (idx + 1) + ': the referenced Sales Order belongs to a different Company.');
      if (sourceSO.CustomerID !== customerId) throw new Error('Line ' + (idx + 1) + ': the referenced Sales Order belongs to a different Customer than this Delivery Note — a Delivery Note can only draw from one Customer\'s Sales Orders.');
      const sourceSOLine = (sourceSO.Lines || []).find(l => l.LineID === sourceSOLineId);
      if (!sourceSOLine) throw new Error('Line ' + (idx + 1) + ': the referenced Sales Order line was not found.');

      const item = itemByCode[sourceSOLine.ItemCode];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found (' + sourceSOLine.ItemCode + ').');

      // Warehouse is LOCKED to the SO line's own — the reservation sits
      // at that specific warehouse, so shipping from anywhere else
      // would leave it meaningless. Unlike GRN, this is never a
      // freely-editable field.
      const warehouseId = sourceSOLine.WarehouseID;

      const enteredQty = Number(line.Quantity);
      if (!(enteredQty > 0)) throw new Error('Line ' + (idx + 1) + ': enter a quantity greater than zero.');

      // Confirmed cap: never more than what's still on the SO line AND
      // never more than what's actually reserved right now — the
      // smaller of the two, since a line only partially reserved (a
      // stock shortfall at confirm time) can't physically ship more
      // than what's genuinely set aside for it, even if more remains
      // on order.
      const activeReservations = getReservationsForSource_(idToken, 'SalesOrder', sourceSOId).filter(r => r.Status === 'Active' && r.SourceLineID === sourceSOLineId);
      const reservedQty = activeReservations.reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
      const remainingQty = Math.max(0, Number(sourceSOLine.OrderedQuantity || 0) - Number(sourceSOLine.DeliveredQuantity || 0));
      const maxShippable = Math.min(remainingQty, reservedQty);
      if (enteredQty > maxShippable + 0.000001) {
        throw new Error('Line ' + (idx + 1) + ': cannot ship more than ' + maxShippable + ' — capped at the smaller of what remains on the order (' + remainingQty + ') and what is currently reserved (' + reservedQty + ').');
      }

      // Price is LOCKED to the SO line's own — confirmed: same price
      // as ordered, never re-entered. This never feeds Delivery Note's
      // own GL entry (which is pure cost/WAC) — it rides along purely
      // for Customer Invoice to read later.
      const unitPrice = Number(sourceSOLine.UnitPrice) || 0;

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      // No batch requirement here — Delivery Note is a pure outbound
      // shipment, same as Material Issue (the one other existing
      // outbound module, which also has no such requirement). The
      // stock ledger itself has no batch dimension at all
      // (stockLedgerPath_ is keyed by item+warehouse only), confirming
      // BatchNumber is purely a reference/traceability field recorded
      // at the point stock ENTERS the system (GRN, an Increase
      // Adjustment) — there's nothing to select or re-enter when it
      // leaves.

      // Cost Center is required somewhere for every line — either the
      // line's own, or the header's own as a fallback default (the
      // client already defaults every new line's Cost Center from the
      // header at the moment it's added, but a line can still end up
      // blank if the header's own Cost Center was itself blank at that
      // moment). This matters more here than it does for GRN: GRN's
      // own offsetting account (GRN Clearing) is a Liability, which
      // never triggers the Cost-Center-required rule — Delivery
      // Note's own COGS account is always an Expense, which always
      // does. Catching it here, clearly, at save time, is better than
      // letting it surface as a cryptic account-code error deep in GL
      // posting at commit time.
      const lineCostCenterId = String(line.CostCenterID || '').trim() || costCenterId;
      if (!lineCostCenterId) throw new Error('Line ' + (idx + 1) + ': Cost Center is required — set one on this line or as the header default.');

      lines.push({
        LineNo: lines.length + 1,
        ItemID: item.ItemID, ItemCode: item.ItemCode, ItemName: item.ItemName,
        WarehouseID: warehouseId,
        Quantity: Math.round(enteredQty * 1e6) / 1e6,
        UnitPrice: Math.round(unitPrice * 10000) / 10000,
        BatchNumber: String(line.BatchNumber || '').trim(),
        ExpiryDate: String(line.ExpiryDate || '').trim(),
        CostCenterID: lineCostCenterId,
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription,
        SourceSOID: sourceSOId, SourceSOLineID: sourceSOLineId, SourceSONumber: sourceSO.SONumber || ''
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'DeliveryNote',
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId, CustomerID: customerId,
      Lines: lines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
    };

    if (dnId) {
      const existing = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
      if (!existing || existing.TransactionType !== 'DeliveryNote') throw new Error('Delivery Note not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a draft or rejected Delivery Note can be edited.');
      firebaseDbRequest_('stock/transactions/' + dnId, 'patch', fields, idToken);
      return { success: true, dnId: dnId };
    }

    const newId = 'DND-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, dnId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteDeliveryNoteDraft(idToken, dnId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'DELIVERYNOTE');
    const existing = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
    if (!existing || existing.TransactionType !== 'DeliveryNote') throw new Error('Delivery Note not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Delivery Note can be deleted.');
    firebaseDbRequest_('stock/transactions/' + dnId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function postDeliveryNote(idToken, dnId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
    if (!existing || existing.TransactionType !== 'DeliveryNote') throw new Error('Delivery Note not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'DELIVERYNOTE');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a draft or rejected Delivery Note can be posted.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'DELIVERYNOTE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const totalValue = (existing.Lines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0), 0);
    const approval = beginApprovalInstance_(idToken, 'DELIVERYNOTE', dnId, '', scopeKey, totalValue, user.uid);

    if (approval.required) {
      firebaseDbRequest_('stock/transactions/' + dnId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitDeliveryNotePosting_(idToken, user, existing, dnId);
    return { success: true, dnId: dnId, dnNumber: result.dnNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Caller MUST already hold LockService.getScriptLock().
function commitDeliveryNotePosting_(idToken, user, existing, dnId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);

  const movementLines = existing.Lines.map(l => Object.assign({ Direction: 'Out' }, l));
  const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

  const cogsGlLines = movementLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = resolveItemExpenseAccount_(item, 'Sales');
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Sales COGS account for ' + item.ItemCode + ' is not valid — check Item Master.');
    return {
      AccountCode: account.AccountCode, Debit: l.TotalValue, Credit: 0,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const actor = user.profile.username || user.uid;
  // Everything above is pure validation and read-only computation —
  // see beginCommitAttempt_'s own section comment for the full
  // reasoning behind what follows.
  const attemptId = beginCommitAttempt_(idToken, dnId, actor);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'DeliveryNote', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(cogsGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: dnId });
  } catch (err) {
    abandonCommitAttempt_(idToken, dnId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  // Stock ledger update, then the three SO-side effects: accumulate
  // DeliveredQuantity, shrink the matching reservation, refresh the
  // SO's own header status.
  commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
  existing.Lines.forEach(l => {
    updateSOLineDeliveredQuantity_(idToken, l.SourceSOID, l.SourceSOLineID, l.Quantity);
    consumeReservationForDelivery_(idToken, l.SourceSOID, l.SourceSOLineID, l.Quantity);
  });
  // Distinct SO ids only — a multi-line delivery from the same SO
  // should only refresh its header status once.
  const distinctSOIds = Array.from(new Set(existing.Lines.map(l => l.SourceSOID)));
  distinctSOIds.forEach(soId => refreshSalesOrderReservationStatus_(idToken, soId));

  finalizeCommitAttempt_(idToken, dnId, glResult, { Lines: movementLines }, actor);

  return { dnNumber: glResult.jvNumber };
}

function decideDeliveryNoteApproval(idToken, dnId, levelNumber, decision, reason) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    requirePostAccess_(idToken, user, 'DELIVERYNOTE');
    const existing = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
    if (!existing || existing.TransactionType !== 'DeliveryNote') throw new Error('Delivery Note not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This Delivery Note is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this Delivery Note.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    if (result.status === 'Approved') {
      const commitResult = commitDeliveryNotePosting_(idToken, user, existing, dnId);
      return { success: true, status: 'Approved', dnNumber: commitResult.dnNumber };
    }
    if (result.status === 'Rejected') {
      firebaseDbRequest_('stock/transactions/' + dnId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'Rejected' };
    }
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

function reverseDeliveryNote(idToken, dnId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
    if (!existing || existing.TransactionType !== 'DeliveryNote') throw new Error('Delivery Note not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'DELIVERYNOTE');
    if (existing.Status !== 'Posted') throw new Error('Only a posted Delivery Note can be reversed.');
    if (existing.ReversedByDeliveryNoteID) throw new Error('This Delivery Note has already been reversed.');
    if (existing.ReversalOfDeliveryNoteID) throw new Error('A reversal entry cannot itself be reversed.');
    if (existing.MatchedToInvoiceID) throw new Error('This Delivery Note has already been matched to a Customer Invoice and cannot be reversed. Reverse the invoice first.');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    // Same lines, movement direction flipped — an 'In' movement puts
    // the exact quantity back at the exact WAC it left at (each
    // original line already carries its own UnitCost from the
    // original commit), same reasoning as every other module's
    // reversal.
    // Object.assign order matters here: l is the ALREADY-COMMITTED
    // line, which carries its own Direction: 'Out' baked in from the
    // original commit — merging it AFTER the override would let that
    // stale value win instead of the 'In' this reversal actually
    // needs, silently producing the exact same direction as the
    // original posting rather than reversing it.
    const reversalMovementLines = existing.Lines.map(l => Object.assign({}, l, { Direction: 'In' }));
    const movement = computeStockMovement_(idToken, itemsData, coaData, reversalMovementLines);

    const cogsGlLines = existing.Lines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = resolveItemExpenseAccount_(item, 'Sales');
      const account = coaData[accountId];
      return {
        AccountCode: account.AccountCode, Debit: 0, Credit: l.TotalValue,
        Description: 'Reversal of ' + (existing.TransactionNumber || ''),
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'DND-' + Utilities.getUuid().split('-')[0].toUpperCase();

    const attemptId = Utilities.getUuid();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'DeliveryNote', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description,
      Reference: existing.Reference,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID, CustomerID: existing.CustomerID,
      Lines: existing.Lines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfDeliveryNoteID: dnId, ReversedByDeliveryNoteID: ''
    }, idToken);

    let glResult;
    try {
      glResult = writeStockGlEntry_(idToken, user, 'DeliveryNote', date,
        'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, existing.Reference,
        movement.inventoryGlLines.concat(cogsGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      firebaseDbRequest_('stock/transactions/' + newId, 'delete', null, idToken);
      throw err;
    }

    // Original patched before the new reversal finalizes — same
    // deliberate ordering as every other module's reversal, preventing
    // double-reversal even under a failure at the worst possible
    // moment.
    firebaseDbRequest_('stock/transactions/' + dnId, 'patch', { ReversedByDeliveryNoteID: newId }, idToken);
    commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
    finalizeCommitAttempt_(idToken, newId, glResult, { Lines: reversalMovementLines }, actor);

    // Roll back the SO-side effects: give back DeliveredQuantity,
    // re-reserve the shipped amount (the stock physically came back),
    // refresh the header status.
    existing.Lines.forEach(l => {
      rollbackSOLineDeliveredQuantity_(idToken, l.SourceSOID, l.SourceSOLineID, l.Quantity);
      const so = firebaseDbRequest_('salesOrders/' + l.SourceSOID, 'get', null, idToken);
      if (so) {
        createStockReservation_(idToken, {
          ItemID: l.ItemID, ItemCode: l.ItemCode, WarehouseID: l.WarehouseID, CompanyID: existing.CompanyID,
          Quantity: l.Quantity, SourceType: 'SalesOrder', SourceID: l.SourceSOID, SourceLineID: l.SourceSOLineID,
          SourceLabel: so.SONumber, Reason: 'Restored by Delivery Note reversal'
        });
      }
    });
    Array.from(new Set(existing.Lines.map(l => l.SourceSOID))).forEach(soId => refreshSalesOrderReservationStatus_(idToken, soId));

    return { success: true, dnId: newId, dnNumber: glResult.jvNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// DATA RESET — admin-only testing/setup utility
// ============================================================
// Lets an Admin wipe test data without touching Firebase directly.
// Deliberately gated MORE strictly than the standard capability system:
// every function here hard-checks user.profile.role === 'ADMIN'
// directly, rather than relying solely on moduleHasCapability_/
// DEFAULT_PERMISSIONS — those control ordinary feature access, and this
// is destructive, irreversible data loss, not an ordinary feature.
// DEFAULT_PERMISSIONS.DATARESET is ALSO restricted to ADMIN, so both
// layers agree, but this function-level check is the one that actually
// matters if the permission config is ever changed by mistake.
//
// Categories are grouped into 'transactional' (safe to clear repeatedly
// during testing — GL entries, stock data, BOMs) and 'master' (the
// structural setup — items, COA, companies, etc. — cleared far less
// often, and each requires the SAME explicit selection + confirmation
// phrase as everything else; nothing here is pre-selected for the user).
//
// User Management, Roles, Tree structure, and Permissions are
// deliberately NEVER offered here — clearing those could lock every
// user (including the person running this) out of the system entirely.

const DATA_RESET_CATEGORIES = {
  // 'firestore:' prefix marks the one path that actually moved — the
  // journal entries themselves. gl/counters and gl/transactionRefCounter
  // deliberately stay in RTDB (see writeStockGlEntry_/postJournalEntry's
  // own comments on why), so this category is genuinely mixed-backend;
  // every function below that walks .paths or uses .recordsPath checks
  // for this prefix rather than assuming everything is an RTDB path.
  glEntries: { paths: ['firestore:journalEntries', 'gl/counters', 'gl/transactionRefCounter'], recordsPath: 'firestore:journalEntries', label: 'GL Journal Entries', detail: 'JV, CBT, and every stock- or AP/AR-originated entry (GRN, Material Issue, Production, Warehouse Movement, Stock Adjustment, Physical Count, Delivery Note, Vendor Invoice, Customer Invoice) — plus their voucher numbering sequences and the lifetime TXN- audit reference.', group: 'transactional' },
  stockData: { paths: ['stock/transactions', 'stock/ledger', 'stock/counters'], recordsPath: 'stock/transactions', label: 'Stock Transactions & Ledger', detail: 'GRN, Material Issue, Production, Warehouse Movement, Stock Adjustment, Physical Count, and Delivery Note records, current stock-on-hand balances, stock voucher numbering, and the lifetime STK- audit reference (nested under stock/counters, cleared along with it).', group: 'transactional' },
  vendorInvoices: { paths: ['vendorInvoices'], recordsPath: 'vendorInvoices', label: 'Vendor Invoice Processing', detail: 'Every Vendor Invoice record (its own collection, separate from GL Journal Entries and Stock Transactions) — Draft, Posted, and reversal entries alike.', group: 'transactional' },
  customerInvoices: { paths: ['customerInvoices'], recordsPath: 'customerInvoices', label: 'Customer Invoice Processing', detail: 'Every Customer Invoice record (its own collection, separate from GL Journal Entries and Stock Transactions) — Draft, Posted, and reversal entries alike.', group: 'transactional' },
  boms: { paths: ['boms'], recordsPath: 'boms', label: 'Bill of Materials', detail: 'All BOM records.', group: 'transactional' },
  items: { paths: ['items', 'itemCounters'], recordsPath: 'items', label: 'Item Master', detail: 'Every item and the item-code numbering sequence.', group: 'master' },
  itemSubCategories: { paths: ['itemSubCategories'], recordsPath: 'itemSubCategories', label: 'Item Sub-Categories', detail: 'Sub-category master list.', group: 'master' },
  uoms: { paths: ['uoms'], recordsPath: 'uoms', label: 'Units of Measure', detail: 'UOM master list — will reseed defaults (KG/PCS/etc.) next time it\'s opened.', group: 'master' },
  coa: { paths: ['coa'], recordsPath: 'coa', label: 'Chart of Accounts', detail: 'The entire chart. Clearing this alone, without also clearing GL Journal Entries, will leave every posted entry referencing accounts that no longer exist.', group: 'master' },
  companies: { paths: ['companies'], recordsPath: 'companies', label: 'Company Master Data', detail: 'Every company record and its configured accounts.', group: 'master' },
  orgUnits: { paths: ['orgUnits'], recordsPath: 'orgUnits', label: 'Organizational Units', detail: 'Divisions, Branches, Warehouses, Racks, Cost Centers, Profit Centers.', group: 'master' },
  salesTypes: { paths: ['salesTypes'], recordsPath: 'salesTypes', label: 'Sales Types', detail: 'Local Sales, Export Sales, and any other Sales Type configured for Customer Invoice — clearing this without also addressing Customer Invoice will leave posted invoices referencing a Sales Type that no longer exists.', group: 'master' },
  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications', detail: 'Local/Export and any other classification configured for Customer Master Data — will reseed the Local/Export defaults next time it\'s opened.', group: 'master' }
};

// One-line, human-readable summary per record, per category — used only
// for the individual-record browse/select list, never stored.
function summarizeDataResetRecord_(categoryKey, id, r) {
  switch (categoryKey) {
    case 'glEntries':
      return (r.JVNumber || 'DRAFT') + ' — ' + (r.JVDate || '') + ' — ' + (r.Description || '') + ' [' + (r.VoucherType || 'JV') + ', ' + (r.Status || '') + ']';
    case 'stockData':
      return (r.TransactionNumber || 'DRAFT') + ' — ' + (r.TransactionDate || '') + ' — ' + (r.Description || '') + ' [' + (r.TransactionType || '') + ', ' + (r.Status || '') + ']';
    case 'vendorInvoices':
      return (r.TransactionNumber || 'DRAFT') + ' — ' + (r.InvoiceDate || '') + ' — ' + (r.Description || '') + ' [' + (r.Status || '') + ']';
    case 'customerInvoices':
      return (r.TransactionNumber || 'DRAFT') + ' — ' + (r.InvoiceDate || '') + ' — ' + (r.Description || '') + ' [' + (r.Status || '') + ']';
    case 'boms':
      return (r.ParentItemCode || '') + ' — ' + (r.ParentItemName || '') + ' (v' + (r.BOMVersion || '') + ', ' + (r.Status || '') + ')';
    case 'items':
      return (r.ItemCode || '') + ' — ' + (r.ItemName || '') + ' [' + (r.Category || '') + ']';
    case 'itemSubCategories':
      return r.Name || '';
    case 'uoms':
      return (r.Code || '') + ' — ' + (r.Name || '');
    case 'coa':
      return (r.AccountCode || '') + ' — ' + (r.AccountName || '') + ' [' + (r.AccountType || '') + ']';
    case 'companies':
      return r.LegalName || '';
    case 'orgUnits':
      return (r.Code || '') + ' — ' + (r.Name || '') + ' [' + (r.Type || '') + ']';
    case 'salesTypes':
      return (r.Name || '') + (r.RestrictedToClassificationID ? ' [restricted]' : ' [unrestricted]');
    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');
    default:
      return id;
  }
}

// Lists individual records in a category with a display summary — the
// browse/select view for deleting SPECIFIC entries rather than the whole
// category at once.
function getCategoryRecords(idToken, categoryKey) {
  const user = requireUser_(idToken);
  requireAdminRole_(user);
  const cat = DATA_RESET_CATEGORIES[categoryKey];
  if (!cat || !cat.recordsPath) throw new Error('Unknown or unsupported category.');

  if (cat.recordsPath.indexOf('firestore:') === 0) {
    const collection = cat.recordsPath.substring('firestore:'.length);
    const rows = firestoreQuery_(collection, null, null, null);
    return rows
      .map(r => ({ id: r._id, summary: summarizeDataResetRecord_(categoryKey, r._id, r) }))
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  const data = firebaseDbRequest_(cat.recordsPath, 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => ({ id: id, summary: summarizeDataResetRecord_(categoryKey, id, data[id]) }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

// Deletes SPECIFIC records within a category, not the whole thing.
//
// A stock transaction (GRN/MI/Production) and its linked GL entry are
// two SEPARATE records — deleting only one would silently orphan the
// other (a GL entry nobody can trace back to a source document, or a
// stock record with no corresponding ledger impact explained anywhere).
// This keeps the two in sync regardless of which side you delete from:
// deleting a stock transaction also deletes its LinkedJVID GL entry;
// deleting a stock-originated GL entry also deletes the stock
// transaction that points to it.
//
// This does NOT recalculate the stock ledger — deleting historical
// transactions leaves quantity/WAC balances reflecting transactions
// that no longer exist. Use recalculateStockLedger separately for that.
function clearSelectedRecords(idToken, categoryKey, recordIds, confirmPhrase) {
  try {
    const user = requireUser_(idToken);
    requireAdminRole_(user);
    if (String(confirmPhrase || '') !== 'DELETE') throw new Error('Type DELETE exactly to confirm.');
    if (!Array.isArray(recordIds) || !recordIds.length) throw new Error('Select at least one record to delete.');

    const cat = DATA_RESET_CATEGORIES[categoryKey];
    if (!cat || !cat.recordsPath) throw new Error('Unknown or unsupported category.');

    let linkedCleared = 0;

    // stockData, vendorInvoices, and customerInvoices all carry their
    // own LinkedJVID — deleting one of their records individually
    // should also remove the GL entry it posted, the same way clearing
    // glEntries individually needs to reach back into ALL THREE of
    // these source-side collections, not just stock/transactions, to
    // avoid leaving Vendor/Customer Invoice records pointing at a GL
    // entry that no longer exists.
    const LINKED_JV_SOURCE_CATEGORIES = ['stockData', 'vendorInvoices', 'customerInvoices'];
    if (LINKED_JV_SOURCE_CATEGORIES.indexOf(categoryKey) !== -1) {
      recordIds.forEach(id => {
        const record = firebaseDbRequest_(cat.recordsPath + '/' + id, 'get', null, idToken);
        if (record && record.LinkedJVID) {
          firestoreDelete_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, record.LinkedJVID);
          linkedCleared++;
        }
      });
    } else if (categoryKey === 'glEntries') {
      const idSet = {};
      recordIds.forEach(id => { idSet[id] = true; });
      LINKED_JV_SOURCE_CATEGORIES.forEach(sourceKey => {
        const sourcePath = DATA_RESET_CATEGORIES[sourceKey].recordsPath;
        const allSourceRecords = firebaseDbRequest_(sourcePath, 'get', null, idToken) || {};
        Object.keys(allSourceRecords).forEach(sourceId => {
          const linked = allSourceRecords[sourceId].LinkedJVID;
          if (linked && idSet[linked]) {
            firebaseDbRequest_(sourcePath + '/' + sourceId, 'delete', null, idToken);
            linkedCleared++;
          }
        });
      });
    }

    if (cat.recordsPath.indexOf('firestore:') === 0) {
      const collection = cat.recordsPath.substring('firestore:'.length);
      recordIds.forEach(id => { firestoreDelete_(collection, id); });
    } else {
      recordIds.forEach(id => {
        firebaseDbRequest_(cat.recordsPath + '/' + id, 'delete', null, idToken);
      });
    }

    return { success: true, count: recordIds.length, linkedCleared: linkedCleared };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Wipes the stock ledger entirely and rebuilds it from whatever POSTED
// stock transactions remain, replayed in the order they were ORIGINALLY
// posted (CreatedAt, not TransactionDate — the latter is user-editable/
// backdatable and would give the wrong sequence for WAC purposes).
//
// Reuses computeStockMovement_/commitStockLedgerUpdates_ one transaction
// at a time rather than reimplementing WAC math — each call reads
// whatever the PREVIOUS call just committed, so Out lines correctly cost
// at the REPLAYED (not the original, now possibly stale) WAC. In lines
// reuse their originally saved UnitCost, since a receipt's cost is a
// historical fact independent of ledger sequence — the one deliberate
// exception is a Material Issue reversal's In line, whose saved cost was
// itself WAC-derived at original posting time and could theoretically
// differ slightly after a replay; treating "what it originally cost" as
// the stable, correct value for a reversal is a reasonable simplification,
// not a fully exhaustive re-derivation of every historical WAC.
function recalculateStockLedger(idToken, confirmPhrase) {
  try {
    const user = requireUser_(idToken);
    requireAdminRole_(user);
    if (String(confirmPhrase || '') !== 'DELETE') throw new Error('Type DELETE exactly to confirm.');

    firebaseDbRequest_('stock/ledger', 'delete', null, idToken);

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);
    const allTx = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};

    const posted = Object.keys(allTx)
      .map(id => Object.assign({ _id: id }, allTx[id]))
      .filter(t => t.Status === 'Posted' && t.Lines && t.Lines.length)
      .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));

    posted.forEach(tx => {
      const lines = tx.Lines.map(l => Object.assign({}, l));
      const movement = computeStockMovement_(idToken, itemsData, coaData, lines);
      commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
    });

    return { success: true, count: posted.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Named distinctly from the EXISTING requireAdmin_(idToken) (used by
// User Management, which checks whoever currently holds USERMGMT write
// capability — a configurable role, not necessarily literally "ADMIN").
// This one is deliberately different: a hard-coded, non-configurable
// check that the CURRENT role is literally 'ADMIN', for a feature where
// "whoever the permissions matrix says can write here" isn't a strong
// enough guarantee.
function requireAdminRole_(user) {
  if (user.profile.role !== 'ADMIN') throw new Error('Only Admin users can access Data Reset.');
}

// Returns a live record count per category so the UI can show exactly
// what's at stake BEFORE anything is selected for deletion.
function getDataResetCounts(idToken) {
  const user = requireUser_(idToken);
  requireAdminRole_(user);
  const counts = {};
  Object.keys(DATA_RESET_CATEGORIES).forEach(key => {
    const cat = DATA_RESET_CATEGORIES[key];
    let total = 0;
    cat.paths.forEach(path => {
      if (path.indexOf('firestore:') === 0) {
        // A genuine improvement over the RTDB path below, not just
        // parity — a server-side count, not a whole-collection fetch
        // just to measure its size.
        total += firestoreCount_(path.substring('firestore:'.length), null);
        return;
      }
      const data = firebaseDbRequest_(path, 'get', null, idToken);
      if (data && typeof data === 'object') total += Object.keys(data).length;
    });
    counts[key] = { label: cat.label, detail: cat.detail, group: cat.group, count: total };
  });
  return counts;
}

// Returns the CURRENT value of both lifetime audit counters (TXN- and
// STK-), so the UI can show what's actually stored before offering to
// reset them — same "show what's at stake first" principle as
// getDataResetCounts.
function getLifetimeAuditCounterValues(idToken) {
  const user = requireUser_(idToken);
  requireAdminRole_(user);
  return {
    txn: firebaseDbRequest_('gl/transactionRefCounter', 'get', null, idToken) || 0,
    stk: firebaseDbRequest_('stock/counters/transactionRef', 'get', null, idToken) || 0
  };
}

// A separate, much narrower operation from clearDataCategories — this
// touches ONLY the two lifetime audit-reference counters (TXN-/STK-),
// never the journalEntries collection, stock/transactions, or any voucher-numbering
// counter. Safe to run at any time, including after new transactions
// have already been posted since a prior reset — it can't orphan or
// duplicate anything, since TXN-/STK- values are audit labels, not
// foreign keys anything else in the system looks up by. Exists
// specifically to recover from a reset performed before this file's
// glEntries category included gl/transactionRefCounter in its own
// cleared paths (see that category's own comment) — after this fix,
// clearing "GL Journal Entries" going forward handles TXN- on its own,
// and "Stock Transactions & Ledger" already handled STK- correctly
// (it's nested under stock/counters, which that category clears).
function resetLifetimeAuditCounters(idToken, confirmPhrase) {
  try {
    const user = requireUser_(idToken);
    requireAdminRole_(user);
    if (String(confirmPhrase || '') !== 'DELETE') throw new Error('Type DELETE exactly to confirm.');
    firebaseDbRequest_('gl/transactionRefCounter', 'delete', null, idToken);
    firebaseDbRequest_('stock/counters/transactionRef', 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


// Deletes every path under each selected category — a Firebase REST
// DELETE on a collection-level path (not a single record) removes that
// entire node and everything under it, same mechanism used everywhere
// else in this file for single-record deletes, just at a wider path.
// Requires the literal phrase "DELETE" as an explicit, typed
// confirmation — this is not something a stray click should be able to
// trigger.
function clearDataCategories(idToken, categoryKeys, confirmPhrase) {
  try {
    const user = requireUser_(idToken);
    requireAdminRole_(user);
    if (String(confirmPhrase || '') !== 'DELETE') throw new Error('Type DELETE exactly to confirm.');
    if (!Array.isArray(categoryKeys) || !categoryKeys.length) throw new Error('Select at least one category to clear.');

    const invalid = categoryKeys.filter(key => !DATA_RESET_CATEGORIES[key]);
    if (invalid.length) throw new Error('Unknown category: ' + invalid.join(', '));

    const clearedLabels = [];
    categoryKeys.forEach(key => {
      const cat = DATA_RESET_CATEGORIES[key];
      cat.paths.forEach(path => {
        if (path.indexOf('firestore:') === 0) {
          // Firestore's REST API has no single-call "delete this whole
          // collection" the way an RTDB node delete does — every
          // document genuinely has to be deleted one at a time. For a
          // large collection this is real: noticeably slower than the
          // RTDB equivalent, and at some size could risk Apps Script's
          // own execution time limit. Acceptable at today's testing-
          // stage data volumes; worth revisiting (batched deletes,
          // or a dedicated cleanup trigger) if this category ever
          // grows large before a reset is needed.
          const collection = path.substring('firestore:'.length);
          const rows = firestoreQuery_(collection, null, null, null);
          rows.forEach(r => firestoreDelete_(collection, r._id));
          return;
        }
        firebaseDbRequest_(path, 'delete', null, idToken);
      });
      clearedLabels.push(cat.label);
    });

    return { success: true, cleared: clearedLabels };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// WAREHOUSE MOVEMENT
// ============================================================
// Moves stock of the SAME item from one warehouse/rack to another. No
// GL entry is posted — the first stock transaction type where that's
// true. Every item has exactly ONE Inventory account (not one per
// warehouse), so a transfer would be Dr Inventory / Cr Inventory on the
// SAME account — a journal entry that nets to itself and carries no
// financial meaning. This is purely a stock-ledger operation: the
// source loses quantity at its current WAC, the destination receives
// the SAME quantity at that SAME cost (valuation is preserved, not
// recomputed — unlike GRN's fresh receipt cost or Production's derived
// cost).
//
// Still gets its own voucher number and transaction ref for
// traceability, via assignStockVoucherNumbering_ — the same numbering
// infrastructure every other stock transaction uses, just without the
// GL-writing step that normally accompanies it.
//
// Storage: /stock/transactions/{id}, TransactionType: 'WarehouseMovement'.
// Each line carries BOTH FromWarehouseID and ToWarehouseID — the one
// structural difference from GRN/MI/Production's single-warehouse lines.

const MOVABLE_ORG_UNIT_TYPES = ['Warehouse', 'Rack'];

// Assigns voucher numbering to a stock transaction WITHOUT writing a GL
// entry — used only by Warehouse Movement, which has no financial side
// to post. Mirrors writeStockGlEntry_'s numbering exactly (same prefix
// map, same per-company counter, same lifetime transaction ref), just
// stops short of building or writing a journal entry.
function assignStockVoucherNumbering_(idToken, stockTransactionType, transactionDate, companyId) {
  const year = (new Date(transactionDate)).getFullYear() || new Date().getFullYear();
  const prefix = STOCK_TRANSACTION_PREFIXES[stockTransactionType];
  if (!prefix) throw new Error('Unknown stock transaction type: ' + stockTransactionType);
  const voucherNumber = generateStockVoucherNumber_(idToken, prefix, year, companyId);
  const transactionRef = generateStockTransactionRef_(idToken);
  return { voucherNumber: voucherNumber, transactionRef: transactionRef };
}

function saveWarehouseMovementDraft(idToken, moveData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'WAREHOUSEMOVEMENT');

    const moveId = String(moveData.MoveID || '').trim();
    const transactionDate = String(moveData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(moveData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(moveData.Reference || '').trim();
    const companyId = String(moveData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(moveData.DivisionID || '').trim();
    const branchId = String(moveData.BranchID || '').trim();
    const costCenterId = String(moveData.CostCenterID || '').trim();
    const profitCenterId = String(moveData.ProfitCenterID || '').trim();

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    const rawLines = moveData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const itemId = String(line.ItemID || '').trim();
      if (!itemId) return; // skip blank trailing row

      const item = itemsData[itemId];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');

      const fromWarehouseId = String(line.FromWarehouseID || '').trim();
      const toWarehouseId = String(line.ToWarehouseID || '').trim();
      if (!fromWarehouseId) throw new Error('Line ' + (idx + 1) + ': From location is required.');
      if (!toWarehouseId) throw new Error('Line ' + (idx + 1) + ': To location is required.');
      if (fromWarehouseId === toWarehouseId) throw new Error('Line ' + (idx + 1) + ': From and To locations must be different.');
      const fromWh = orgUnitsData[fromWarehouseId];
      const toWh = orgUnitsData[toWarehouseId];
      if (!fromWh || MOVABLE_ORG_UNIT_TYPES.indexOf(fromWh.Type) === -1) throw new Error('Line ' + (idx + 1) + ': From location not found.');
      if (!toWh || MOVABLE_ORG_UNIT_TYPES.indexOf(toWh.Type) === -1) throw new Error('Line ' + (idx + 1) + ': To location not found.');

      const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
      const enteredQty = Number(line.EnteredQuantity);
      if (!(enteredQty > 0)) throw new Error('Line ' + (idx + 1) + ': enter a quantity greater than zero.');

      let baseQty;
      if (enteredUomId === item.UOMID) {
        baseQty = enteredQty;
      } else if (enteredUomId === item.AltUOMID) {
        baseQty = enteredQty * (item.ConversionFactor || 0);
        if (!(baseQty > 0)) throw new Error('Line ' + (idx + 1) + ': item has no valid alternate UOM conversion factor set.');
      } else {
        throw new Error('Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
      }
      const enteredUom = uomsData[enteredUomId];
      if (enteredUom && !enteredUom.AllowDecimals && Math.abs(enteredQty - Math.round(enteredQty)) > 0.0001) {
        throw new Error('Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
      }

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
        throw new Error('Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
      }

      lines.push({
        LineNo: lines.length + 1,
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        FromWarehouseID: fromWarehouseId, ToWarehouseID: toWarehouseId,
        EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
        Quantity: Math.round(baseQty * 1e6) / 1e6,
        BatchNumber: String(line.BatchNumber || '').trim(),
        CostCenterID: String(line.CostCenterID || '').trim(),
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'WarehouseMovement',
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
      Lines: lines,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (moveId) {
      const existing = firebaseDbRequest_('stock/transactions/' + moveId, 'get', null, idToken);
      if (!existing) throw new Error('Warehouse Movement not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Warehouse Movements can be edited.');
      firebaseDbRequest_('stock/transactions/' + moveId, 'patch', fields, idToken);
      return { success: true, moveId: moveId };
    }

    const newId = 'WMD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, moveId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function postWarehouseMovement(idToken, moveId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + moveId, 'get', null, idToken);
    if (!existing) throw new Error('Warehouse Movement not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'WAREHOUSEMOVEMENT');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Warehouse Movements can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('This Warehouse Movement has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // No GL entry exists for a Warehouse Movement (moving stock between
    // locations within the same company doesn't change total inventory
    // value), but a gate still needs a meaningful amount to check
    // against — the value of goods being moved, from the SAME read-only
    // preview computation the actual commit will redo. Nothing here
    // writes anything.
    const itemsDataPreview = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaDataPreview = getCoaData_(idToken);
    const previewOutLines = existing.Lines.map(l => Object.assign({ Direction: 'Out', WarehouseID: l.FromWarehouseID }, l));
    computeStockMovement_(idToken, itemsDataPreview, coaDataPreview, previewOutLines);
    // Sum each line's own TotalValue directly — same fix as Material
    // Issue's identical bug: an outbound line CREDITS inventory
    // (Debit: 0), so reading inventoryGlLines' Debit field here would
    // silently give zero.
    const previewAmount = previewOutLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'WAREHOUSEMOVEMENT', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'WAREHOUSEMOVEMENT', moveId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no stock ledger change, no
      // Sales Order allocation — until this is actually approved (see
      // decideWarehouseMovementApproval).
      firebaseDbRequest_('stock/transactions/' + moveId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitWarehouseMovementPosting_(idToken, user, existing, moveId);
    return { success: true, moveId: moveId, moveNumber: result.moveNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The actual stock-ledger commit (and destination-side Sales Order
// allocation) — extracted so it can run from EITHER postWarehouseMovement
// itself (no gate configured) OR decideWarehouseMovementApproval (once
// approved). Caller MUST already hold LockService.getScriptLock().
function commitWarehouseMovementPosting_(idToken, user, existing, moveId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);

  const outLines = existing.Lines.map(l => Object.assign({ Direction: 'Out', WarehouseID: l.FromWarehouseID }, l));
  const outMovement = computeStockMovement_(idToken, itemsData, coaData, outLines);

  const inLines = existing.Lines.map((l, idx) => Object.assign({}, l, {
    Direction: 'In', WarehouseID: l.ToWarehouseID, UnitCost: outLines[idx].UnitCost
  }));
  const inMovement = computeStockMovement_(idToken, itemsData, coaData, inLines);

  const combinedLedgerUpdates = Object.assign({}, outMovement.ledgerUpdates, inMovement.ledgerUpdates);
  commitStockLedgerUpdates_(idToken, combinedLedgerUpdates);

  const numbering = assignStockVoucherNumbering_(idToken, 'WarehouseMovement', existing.TransactionDate, existing.CompanyID);

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  firebaseDbRequest_('stock/transactions/' + moveId, 'patch', {
    Status: 'Posted', TransactionNumber: numbering.voucherNumber, TransactionRef: numbering.transactionRef,
    Lines: outLines.map((l, idx) => Object.assign({}, l, { UnitCost: l.UnitCost, TotalValue: l.TotalValue })),
    PostedAt: now, PostedBy: actor, UpdatedAt: now, UpdatedBy: actor
  }, idToken);

  inLines.forEach(l => {
    allocateAvailableStockToShortfalls_(idToken, l.ItemID, l.ItemCode, l.ToWarehouseID, existing.CompanyID, Number(l.Quantity) || 0, numbering.voucherNumber);
  });

  return { moveNumber: numbering.voucherNumber };
}

function decideWarehouseMovementApproval(idToken, moveId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'WAREHOUSEMOVEMENT');
    const existing = firebaseDbRequest_('stock/transactions/' + moveId, 'get', null, idToken);
    if (!existing) throw new Error('Warehouse Movement not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This Warehouse Movement is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this Warehouse Movement.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    if (result.status === 'Approved') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        commitWarehouseMovementPosting_(idToken, user, existing, moveId);
      } finally {
        lock.releaseLock();
      }
    } else if (result.status === 'Rejected') {
      const now = new Date().toISOString();
      firebaseDbRequest_('stock/transactions/' + moveId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(),
        UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
      }, idToken);
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteWarehouseMovementDraft(idToken, moveId) {
  try {
    const user = requireUser_(idToken);
    const existing = firebaseDbRequest_('stock/transactions/' + moveId, 'get', null, idToken);
    if (!existing) throw new Error('Warehouse Movement not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, 'WAREHOUSEMOVEMENT');
    if (existing.Status !== 'Draft') throw new Error('Only draft Warehouse Movements can be deleted. Posted ones must be reversed instead.');
    firebaseDbRequest_('stock/transactions/' + moveId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getWarehouseMovementEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'WAREHOUSEMOVEMENT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Warehouse Movement.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ MoveID: id }, data[id]))
    .filter(e => e.TransactionType === 'WarehouseMovement')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Reversing a movement simply moves it back — From and To swap. Same
// negative-stock guard: if the destination no longer has enough (moved
// again, issued, sold), the reversal is rejected. No GL entry here
// either, same reasoning as the original post.
function reverseWarehouseMovement(idToken, moveId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + moveId, 'get', null, idToken);
    if (!existing) throw new Error('Warehouse Movement not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'WAREHOUSEMOVEMENT');
    if (existing.Status !== 'Posted') throw new Error('Only posted Warehouse Movements can be reversed.');
    if (existing.ReversedByWarehouseMovement) throw new Error('This Warehouse Movement has already been reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    // Swap From/To — moving it back.
    const swappedLines = existing.Lines.map(l => Object.assign({}, l, { FromWarehouseID: l.ToWarehouseID, ToWarehouseID: l.FromWarehouseID }));

    const outLines = swappedLines.map(l => Object.assign({ Direction: 'Out', WarehouseID: l.FromWarehouseID }, l));
    const outMovement = computeStockMovement_(idToken, itemsData, coaData, outLines);

    const inLines = swappedLines.map((l, idx) => Object.assign({}, l, {
      Direction: 'In', WarehouseID: l.ToWarehouseID, UnitCost: outLines[idx].UnitCost
    }));
    const inMovement = computeStockMovement_(idToken, itemsData, coaData, inLines);

    const combinedLedgerUpdates = Object.assign({}, outMovement.ledgerUpdates, inMovement.ledgerUpdates);
    commitStockLedgerUpdates_(idToken, combinedLedgerUpdates);

    const numbering = assignStockVoucherNumbering_(idToken, 'WarehouseMovement', date, existing.CompanyID);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'WMD-' + Utilities.getUuid().split('-')[0].toUpperCase();

    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'WarehouseMovement', TransactionNumber: numbering.voucherNumber, TransactionRef: numbering.transactionRef,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber, Status: 'Posted',
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: outLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor, PostedAt: now, PostedBy: actor,
      ReversalOfWarehouseMovement: moveId, ReversedByWarehouseMovement: ''
    }, idToken);

    firebaseDbRequest_('stock/transactions/' + moveId, 'patch', { ReversedByWarehouseMovement: newId }, idToken);

    return { success: true, moveId: newId, moveNumber: numbering.voucherNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// STOCK ADJUSTMENT
// ============================================================
// Corrects stock quantity for reasons outside normal transaction flow —
// damage, shrinkage, theft, or a count correction (found more or less
// than the ledger says). Unlike every other stock transaction type,
// direction is set PER LINE, not fixed for the whole document: one
// Stock Adjustment can increase Item A by 5 units while decreasing Item
// B by 3, in the same entry.
//
// GL shape uses the item's own Write-off account (resolveItemExpenseAccount_
// with reason 'WriteOff', falling back to Consumption if not set) for
// BOTH directions, polarity reversed by direction — the same "same
// account, reversed polarity" pattern Production Entry already uses on
// Consumption: Dr Write-off / Cr Inventory for a decrease, Dr Inventory
// / Cr Write-off for an increase.
//
// Cost is NEVER user-entered, in either direction. A decrease costs at
// the item+warehouse's current WAC, same as Material Issue. An increase
// ALSO uses the current WAC — adjusting an item UP means correcting
// existing inventory, not establishing a fresh cost basis, so it
// inherits whatever the ledger already says that item is worth. If the
// item currently has zero stock (nothing to inherit a cost from),
// posting an increase is rejected with a clear message — GRN or
// Production Entry are the right tools for establishing an initial cost
// basis from nothing, not this one.
//
// Storage: /stock/transactions/{id}, TransactionType: 'StockAdjustment'.
// Each line carries AdjustmentDirection: 'Increase' | 'Decrease'.

function saveStockAdjustmentDraft(idToken, adjData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'STOCKADJUSTMENT');

    const adjId = String(adjData.AdjustmentID || '').trim();
    const transactionDate = String(adjData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(adjData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(adjData.Reference || '').trim();
    const companyId = String(adjData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(adjData.DivisionID || '').trim();
    const branchId = String(adjData.BranchID || '').trim();
    const costCenterId = String(adjData.CostCenterID || '').trim();
    const profitCenterId = String(adjData.ProfitCenterID || '').trim();

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    const rawLines = adjData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const itemId = String(line.ItemID || '').trim();
      if (!itemId) return; // skip blank trailing row

      const item = itemsData[itemId];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
      const warehouseId = String(line.WarehouseID || '').trim();
      if (!warehouseId) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
      const wh = orgUnitsData[warehouseId];
      if (!wh || MOVABLE_ORG_UNIT_TYPES.indexOf(wh.Type) === -1) throw new Error('Line ' + (idx + 1) + ': warehouse not found.');

      const direction = String(line.AdjustmentDirection || '').trim();
      if (direction !== 'Increase' && direction !== 'Decrease') throw new Error('Line ' + (idx + 1) + ': select Increase or Decrease.');

      const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
      const enteredQty = Number(line.EnteredQuantity);
      if (!(enteredQty > 0)) throw new Error('Line ' + (idx + 1) + ': enter a quantity greater than zero.');

      let baseQty;
      if (enteredUomId === item.UOMID) {
        baseQty = enteredQty;
      } else if (enteredUomId === item.AltUOMID) {
        baseQty = enteredQty * (item.ConversionFactor || 0);
        if (!(baseQty > 0)) throw new Error('Line ' + (idx + 1) + ': item has no valid alternate UOM conversion factor set.');
      } else {
        throw new Error('Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
      }
      const enteredUom = uomsData[enteredUomId];
      if (enteredUom && !enteredUom.AllowDecimals && Math.abs(enteredQty - Math.round(enteredQty)) > 0.0001) {
        throw new Error('Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
      }

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
        throw new Error('Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
      }

      lines.push({
        LineNo: lines.length + 1,
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        WarehouseID: warehouseId, AdjustmentDirection: direction,
        EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
        Quantity: Math.round(baseQty * 1e6) / 1e6,
        BatchNumber: String(line.BatchNumber || '').trim(),
        CostCenterID: String(line.CostCenterID || '').trim(),
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'StockAdjustment',
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
      Lines: lines,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (adjId) {
      const existing = firebaseDbRequest_('stock/transactions/' + adjId, 'get', null, idToken);
      if (!existing) throw new Error('Stock Adjustment not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Stock Adjustments can be edited.');
      firebaseDbRequest_('stock/transactions/' + adjId, 'patch', fields, idToken);
      return { success: true, adjId: adjId };
    }

    const newId = 'ADJD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, adjId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Builds each line's Direction and (for an Increase) its inherited
// current-WAC UnitCost — shared by the read-only preview computation
// and the actual commit, since getStockLedgerEntry_ is just a read and
// is safe to call twice.
function buildStockAdjustmentMovementLines_(idToken, existing) {
  return existing.Lines.map((l, idx) => {
    const direction = l.AdjustmentDirection === 'Increase' ? 'In' : 'Out';
    const line = Object.assign({ Direction: direction }, l);
    if (direction === 'In') {
      const ledger = getStockLedgerEntry_(idToken, l.ItemID, l.WarehouseID);
      if (!(ledger.AvgCost > 0)) {
        throw new Error('Line ' + (idx + 1) + ' (' + l.ItemCode + '): cannot post an increase — this item has zero current stock, so there is no existing cost to inherit. Use GRN or Production Entry to establish an initial cost basis first.');
      }
      line.UnitCost = ledger.AvgCost;
    }
    return line;
  });
}

function postStockAdjustment(idToken, adjId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + adjId, 'get', null, idToken);
    if (!existing) throw new Error('Stock Adjustment not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'STOCKADJUSTMENT');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Stock Adjustments can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('This Stock Adjustment has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount: total gross value of the adjustment — increase
    // and decrease lines both add to this (never net against each
    // other), since a large increase and a large decrease sitting side
    // by side shouldn't be able to hide behind a small net figure.
    // Read-only: getStockLedgerEntry_ and computeStockMovement_ are
    // both reads here, nothing gets written.
    const itemsDataPreview = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaDataPreview = getCoaData_(idToken);
    const previewMovementLines = buildStockAdjustmentMovementLines_(idToken, existing);
    const previewMovement = computeStockMovement_(idToken, itemsDataPreview, coaDataPreview, previewMovementLines);
    const previewAmount = previewMovementLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'STOCKADJUSTMENT', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'STOCKADJUSTMENT', adjId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no stock ledger change, no GL
      // entry, no Sales Order allocation — until this is actually
      // approved (see decideStockAdjustmentApproval).
      firebaseDbRequest_('stock/transactions/' + adjId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitStockAdjustmentPosting_(idToken, user, existing, adjId);
    return { success: true, adjId: adjId, adjNumber: result.adjNumber, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The actual stock-ledger-and-GL commit (and increase-side Sales Order
// allocation) — extracted so it can run from EITHER postStockAdjustment
// itself (no gate configured) OR decideStockAdjustmentApproval (once
// approved). Caller MUST already hold LockService.getScriptLock().
function commitStockAdjustmentPosting_(idToken, user, existing, adjId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);

  const movementLines = buildStockAdjustmentMovementLines_(idToken, existing);
  const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

  const offsetGlLines = movementLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = resolveItemExpenseAccount_(item, 'WriteOff');
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Write-off account for ' + item.ItemCode + ' is not valid — check Item Master.');
    const isDecrease = l.Direction === 'Out';
    return {
      AccountCode: account.AccountCode,
      Debit: isDecrease ? l.TotalValue : 0, Credit: isDecrease ? 0 : l.TotalValue,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const actor = user.profile.username || user.uid;
  const attemptId = beginCommitAttempt_(idToken, adjId, actor);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'StockAdjustment', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(offsetGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: adjId });
  } catch (err) {
    abandonCommitAttempt_(idToken, adjId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
  finalizeCommitAttempt_(idToken, adjId, glResult, { Lines: movementLines }, actor);

  // Sales Order allocation only ever runs once the transaction is
  // genuinely, finally committed — same reasoning as Production's Job
  // Order update: if the GL or ledger write failed above, execution
  // never reaches here at all.
  movementLines.forEach(l => {
    if (l.Direction === 'In') {
      allocateAvailableStockToShortfalls_(idToken, l.ItemID, l.ItemCode, l.WarehouseID, existing.CompanyID, Number(l.Quantity) || 0, glResult.jvNumber);
    }
  });

  return { adjNumber: glResult.jvNumber };
}

function decideStockAdjustmentApproval(idToken, adjId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'STOCKADJUSTMENT');
    const existing = firebaseDbRequest_('stock/transactions/' + adjId, 'get', null, idToken);
    if (!existing) throw new Error('Stock Adjustment not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This Stock Adjustment is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this Stock Adjustment.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    if (result.status === 'Approved') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        commitStockAdjustmentPosting_(idToken, user, existing, adjId);
      } finally {
        lock.releaseLock();
      }
    } else if (result.status === 'Rejected') {
      const now = new Date().toISOString();
      firebaseDbRequest_('stock/transactions/' + adjId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(),
        UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
      }, idToken);
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteStockAdjustmentDraft(idToken, adjId) {
  try {
    const user = requireUser_(idToken);
    const existing = firebaseDbRequest_('stock/transactions/' + adjId, 'get', null, idToken);
    if (!existing) throw new Error('Stock Adjustment not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, 'STOCKADJUSTMENT');
    if (existing.Status !== 'Draft') throw new Error('Only draft Stock Adjustments can be deleted. Posted ones must be reversed instead.');
    firebaseDbRequest_('stock/transactions/' + adjId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getStockAdjustmentEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'STOCKADJUSTMENT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Stock Adjustment.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ AdjustmentID: id }, data[id]))
    .filter(e => e.TransactionType === 'StockAdjustment')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Reversing flips EVERY line's direction (Increase becomes Decrease and
// vice versa) and replays through the exact same posting mechanism —
// same negative-stock guard on the flipped-to-Decrease lines, same
// zero-cost guard on the flipped-to-Increase lines.
function reverseStockAdjustment(idToken, adjId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + adjId, 'get', null, idToken);
    if (!existing) throw new Error('Stock Adjustment not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'STOCKADJUSTMENT');
    if (existing.Status !== 'Posted') throw new Error('Only posted Stock Adjustments can be reversed.');
    if (existing.ReversedByAdjustment) throw new Error('This Stock Adjustment has already been reversed.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    const swappedLines = existing.Lines.map(l => Object.assign({}, l, {
      AdjustmentDirection: l.AdjustmentDirection === 'Increase' ? 'Decrease' : 'Increase'
    }));

    const movementLines = swappedLines.map((l, idx) => {
      const direction = l.AdjustmentDirection === 'Increase' ? 'In' : 'Out';
      // Object.assign order matters here: l is the ALREADY-COMMITTED
      // line, which carries its own stale Direction baked in from the
      // original commit (persisted via finalizeCommitAttempt_'s own
      // extraFields) — merging it AFTER the freshly-computed direction
      // would let that stale value win instead, silently reapplying
      // the ORIGINAL direction rather than the flipped one this
      // reversal actually needs. Confirmed bug, fixed: swappedLines
      // above only touches AdjustmentDirection, so l's own Direction
      // key survives that step unchanged and must be overridden here,
      // last, not first.
      const line = Object.assign({}, l, { Direction: direction });
      if (direction === 'In') {
        const ledger = getStockLedgerEntry_(idToken, l.ItemID, l.WarehouseID);
        if (!(ledger.AvgCost > 0)) {
          throw new Error('Line ' + (idx + 1) + ' (' + l.ItemCode + '): cannot reverse — this item now has zero current stock, so there is no existing cost to inherit for putting it back.');
        }
        line.UnitCost = ledger.AvgCost;
      }
      return line;
    });

    const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

    const offsetGlLines = movementLines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = resolveItemExpenseAccount_(item, 'WriteOff');
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error('Write-off account for ' + item.ItemCode + ' is not valid — check Item Master.');
      const isDecrease = l.Direction === 'Out';
      return {
        AccountCode: account.AccountCode,
        Debit: isDecrease ? l.TotalValue : 0, Credit: isDecrease ? 0 : l.TotalValue,
        Description: 'Reversal of ' + existing.TransactionNumber,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'ADJD-' + Utilities.getUuid().split('-')[0].toUpperCase();

    const attemptId = Utilities.getUuid();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'StockAdjustment', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfAdjustment: adjId, ReversedByAdjustment: ''
    }, idToken);

    let glResult;
    try {
      glResult = writeStockGlEntry_(idToken, user, 'StockAdjustment', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(offsetGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      firebaseDbRequest_('stock/transactions/' + newId, 'delete', null, idToken);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);

    // Original patched before the new reversal finalizes — same
    // deliberate ordering as every other module's reversal.
    firebaseDbRequest_('stock/transactions/' + adjId, 'patch', { ReversedByAdjustment: newId }, idToken);
    finalizeCommitAttempt_(idToken, newId, glResult, { Lines: movementLines }, actor);

    return { success: true, adjId: newId, adjNumber: glResult.jvNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// GL IMPACT VIEWER — shared by every stock transaction screen
// ============================================================
// Every stock transaction that posts a GL entry (GRN, Material Issue,
// Production, Stock Adjustment — everything except Warehouse Movement,
// which posts none) links to it via LinkedJVID. Rather than making
// someone leave the stock screen and hunt through GL Report to see
// which accounts got debited/credited, this reads that linked entry
// directly and attaches readable account names to each line (GL lines
// only ever store AccountCode, not a name), so any stock module can
// show a plain Dr/Cr table inline — the same information a JV entry
// already displays, just reached in one click from where the stock
// transaction itself lives instead of a separate report.
function getJournalEntryDetail(idToken, jvId) {
  const user = requireUser_(idToken);
  if (!jvId) throw new Error('No linked GL entry to show.');
  const entry = firestoreGet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, jvId);
  if (!entry) throw new Error('Journal entry not found.');
  if (!userCanAccessCompany_(user.profile, entry.CompanyID)) throw new Error('You do not have access to that company.');

  const coaData = getCoaData_(idToken);
  const accountsByCode = {};
  Object.keys(coaData).forEach(id => { accountsByCode[coaData[id].AccountCode] = coaData[id]; });

  const lines = (entry.Lines || []).map(l => {
    const account = accountsByCode[l.AccountCode];
    return {
      AccountCode: l.AccountCode, AccountName: account ? account.AccountName : '(account not found)',
      Debit: l.Debit || 0, Credit: l.Credit || 0, Description: l.Description || ''
    };
  });

  return {
    JVID: jvId, JVNumber: entry.JVNumber, JVDate: entry.JVDate,
    Description: entry.Description, Reference: entry.Reference,
    TotalDebit: entry.TotalDebit, TotalCredit: entry.TotalCredit,
    Lines: lines
  };
}

// ============================================================
// PHYSICAL / CYCLE COUNT
// ============================================================
// Records a physical count against system quantity and posts the
// difference — a count variance IS a Stock Adjustment under the hood,
// reusing the exact same GL treatment (per-item Write-off account,
// polarity by direction) rather than a second implementation of it.
// What's genuinely different here is the WORKFLOW: the user enters what
// they physically counted, not a raw increase/decrease quantity, and
// the system computes the variance.
//
// CORRECTNESS NOTE — this is the one real subtlety in this module: the
// "system quantity" shown while entering a count is only a snapshot for
// the counter's reference, taken at draft-save time. It is NEVER trusted
// as the basis for the actual adjustment. If someone else posts a GRN or
// Material Issue against the same item between when the count was
// entered and when it's posted, the stored snapshot goes stale — so
// postPhysicalCount always re-fetches the CURRENT ledger quantity for
// every line and recomputes the variance fresh, right before posting.
// Using the stale draft-time snapshot instead would silently post the
// wrong adjustment whenever stock moved in the meantime.
//
// Lines with zero variance (counted matches system) are recorded for a
// complete audit trail — "we counted 10 items, 2 had a variance" — but
// do NOT get an adjustment line and do NOT feed into the GL entry. A
// clean count (nothing to adjust at all) still posts successfully with
// no GL entry, exactly like Warehouse Movement's "no financial impact"
// case — there's a real difference between "we counted and everything
// matched" and "nothing was counted", and this preserves that record
// either way.
//
// Storage: /stock/transactions/{id}, TransactionType: 'PhysicalCount'.
// Each line carries SystemQuantity (the draft-time snapshot, display
// only) and CountedQuantity (what was physically counted, base UOM).

function savePhysicalCountDraft(idToken, pcData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'PHYSICALCOUNT');

    const pcId = String(pcData.CountID || '').trim();
    const transactionDate = String(pcData.TransactionDate || '').trim();
    if (!transactionDate) throw new Error('Transaction date is required.');
    const description = String(pcData.Description || '').trim();
    if (!description) throw new Error('Description is required.');
    const reference = String(pcData.Reference || '').trim();
    const companyId = String(pcData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this transaction.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const divisionId = String(pcData.DivisionID || '').trim();
    const branchId = String(pcData.BranchID || '').trim();
    const costCenterId = String(pcData.CostCenterID || '').trim();
    const profitCenterId = String(pcData.ProfitCenterID || '').trim();

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
    const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

    const rawLines = pcData.Lines || [];
    const lines = [];
    rawLines.forEach((line, idx) => {
      const itemId = String(line.ItemID || '').trim();
      if (!itemId) return; // skip blank trailing row

      const item = itemsData[itemId];
      if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
      const warehouseId = String(line.WarehouseID || '').trim();
      if (!warehouseId) throw new Error('Line ' + (idx + 1) + ': location is required.');
      const wh = orgUnitsData[warehouseId];
      if (!wh || MOVABLE_ORG_UNIT_TYPES.indexOf(wh.Type) === -1) throw new Error('Line ' + (idx + 1) + ': location not found.');

      const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
      const countedQty = Number(line.CountedQuantity);
      if (!(countedQty >= 0)) throw new Error('Line ' + (idx + 1) + ': enter a counted quantity of zero or more.');

      let countedBaseQty;
      if (enteredUomId === item.UOMID) {
        countedBaseQty = countedQty;
      } else if (enteredUomId === item.AltUOMID) {
        countedBaseQty = countedQty * (item.ConversionFactor || 0);
      } else {
        throw new Error('Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
      }
      const enteredUom = uomsData[enteredUomId];
      if (enteredUom && !enteredUom.AllowDecimals && Math.abs(countedQty - Math.round(countedQty)) > 0.0001) {
        throw new Error('Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
      }

      const lineDescription = String(line.Description || '').trim();
      if (!lineDescription) throw new Error('Line ' + (idx + 1) + ': description is required.');

      if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
        throw new Error('Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
      }

      // System quantity is a draft-time snapshot for the counter's own
      // reference ONLY — see module note above. Never used to compute
      // the actual adjustment at posting time.
      const systemQtySnapshot = Number(line.SystemQuantity) || 0;

      lines.push({
        LineNo: lines.length + 1,
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        WarehouseID: warehouseId,
        EnteredUOMID: enteredUomId, CountedQuantityEntered: countedQty,
        CountedQuantity: Math.round(countedBaseQty * 1e6) / 1e6,
        SystemQuantity: systemQtySnapshot,
        BatchNumber: String(line.BatchNumber || '').trim(),
        CostCenterID: String(line.CostCenterID || '').trim(),
        ProfitCenterID: String(line.ProfitCenterID || '').trim(),
        Description: lineDescription
      });
    });

    if (!lines.length) throw new Error('Enter at least one line.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      TransactionType: 'PhysicalCount',
      TransactionDate: transactionDate, Description: description, Reference: reference,
      CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
      CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
      Lines: lines,
      Status: 'Draft',
      UpdatedAt: now, UpdatedBy: actor
    };

    if (pcId) {
      const existing = firebaseDbRequest_('stock/transactions/' + pcId, 'get', null, idToken);
      if (!existing) throw new Error('Physical Count not found.');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Physical Counts can be edited.');
      firebaseDbRequest_('stock/transactions/' + pcId, 'patch', fields, idToken);
      return { success: true, pcId: pcId };
    }

    const newId = 'PCD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }), idToken);
    return { success: true, pcId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Computes each line's variance against the CURRENT ledger and splits
// into finalLines (every line, for the audit trail) and adjustmentLines
// (only the non-zero-variance ones, what actually posts) — shared by
// the read-only preview and the actual commit, since this is purely a
// read (getStockLedgerEntry_) against whatever the ledger says AT THE
// MOMENT this is called. That's a deliberate, unavoidable consequence
// of the module's own design (compare against CURRENT stock, never a
// stale draft-time snapshot) — inserting an approval step between
// submission and commit means the "current" moment that matters shifts
// from submit time to approval time, same as it would have shifted
// from submit time to "whenever someone got around to clicking Post"
// even before approval existed here at all.
function buildPhysicalCountLines_(idToken, existing) {
  const finalLines = [];
  const adjustmentLines = [];
  existing.Lines.forEach((l, idx) => {
    const currentLedger = getStockLedgerEntry_(idToken, l.ItemID, l.WarehouseID);
    const variance = Math.round((l.CountedQuantity - currentLedger.Quantity) * 1e6) / 1e6;

    finalLines.push(Object.assign({}, l, { SystemQuantityAtPosting: currentLedger.Quantity, Variance: variance }));

    if (Math.abs(variance) < 0.000001) return; // clean line, no adjustment needed

    const direction = variance > 0 ? 'In' : 'Out';
    const line = Object.assign({}, l, { Direction: direction, Quantity: Math.abs(variance) });
    if (direction === 'In') {
      if (!(currentLedger.AvgCost > 0)) {
        throw new Error('Line ' + (idx + 1) + ' (' + l.ItemCode + '): counted quantity is higher than system, but this item has zero current stock/cost — there is no existing cost to value the surplus at. Use GRN or Production Entry first to establish a cost basis.');
      }
      line.UnitCost = currentLedger.AvgCost;
    }
    adjustmentLines.push(line);
  });
  return { finalLines: finalLines, adjustmentLines: adjustmentLines };
}

function postPhysicalCount(idToken, pcId) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + pcId, 'get', null, idToken);
    if (!existing) throw new Error('Physical Count not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'PHYSICALCOUNT');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only draft or rejected Physical Counts can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('This Physical Count has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount: total absolute variance value across every
    // adjustment line (never net, same reasoning as Stock Adjustment).
    // A clean count naturally previews at 0 — whether that still
    // requires approval depends entirely on Admin's own configured
    // gate (e.g. a Flat gate would still require it; that's Admin's
    // choice to make, not something to special-case around here).
    // Nothing here writes anything.
    const preview = buildPhysicalCountLines_(idToken, existing);
    // buildPhysicalCountLines_ itself never sets TotalValue — only
    // computeStockMovement_ does, as a mutation on these same line
    // objects, so it has to actually run here (read-only; it costs
    // each line but writes nothing) or every preview would silently
    // sum to zero. Guarded for the clean-count case, where
    // computeStockMovement_ would otherwise throw on an empty array.
    const itemsDataPreview = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaDataPreview = getCoaData_(idToken);
    if (preview.adjustmentLines.length) {
      computeStockMovement_(idToken, itemsDataPreview, coaDataPreview, preview.adjustmentLines);
    }
    const previewAmount = preview.adjustmentLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'PHYSICALCOUNT', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'PHYSICALCOUNT', pcId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no stock ledger change, no GL
      // entry — until this is actually approved (see
      // decidePhysicalCountApproval). The variance itself will be
      // RECOMPUTED at that moment, against whatever the ledger says
      // then — see buildPhysicalCountLines_'s own comment for why.
      firebaseDbRequest_('stock/transactions/' + pcId, 'patch', {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
      return { success: true, status: 'PendingApproval' };
    }

    const result = commitPhysicalCountPosting_(idToken, user, existing, pcId);
    return { success: true, pcId: pcId, pcNumber: result.pcNumber, cleanCount: result.cleanCount, status: 'Posted' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The actual commit — extracted so it can run from EITHER
// postPhysicalCount itself (no gate configured) OR
// decidePhysicalCountApproval (once approved). Recomputes variance
// fresh against the ledger AT THIS MOMENT — see buildPhysicalCountLines_.
// Caller MUST already hold LockService.getScriptLock().
function commitPhysicalCountPosting_(idToken, user, existing, pcId) {
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const coaData = getCoaData_(idToken);
  const { finalLines, adjustmentLines } = buildPhysicalCountLines_(idToken, existing);

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;

  if (!adjustmentLines.length) {
    // Clean count — nothing to adjust. Still gets a real voucher
    // number for its own audit trail, same as Warehouse Movement's
    // no-financial-impact case, but posts no GL entry at all.
    const year = (new Date(existing.TransactionDate)).getFullYear() || new Date().getFullYear();
    const voucherNumber = generateStockVoucherNumber_(idToken, 'PC', year, existing.CompanyID);
    const transactionRef = generateStockTransactionRef_(idToken);
    firebaseDbRequest_('stock/transactions/' + pcId, 'patch', {
      Status: 'Posted', TransactionNumber: voucherNumber, TransactionRef: transactionRef,
      Lines: finalLines,
      PostedAt: now, PostedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { pcNumber: voucherNumber, cleanCount: true };
  }

  const movement = computeStockMovement_(idToken, itemsData, coaData, adjustmentLines);

  const offsetGlLines = adjustmentLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = resolveItemExpenseAccount_(item, 'WriteOff');
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Write-off account for ' + item.ItemCode + ' is not valid — check Item Master.');
    const isDecrease = l.Direction === 'Out';
    return {
      AccountCode: account.AccountCode,
      Debit: isDecrease ? l.TotalValue : 0, Credit: isDecrease ? 0 : l.TotalValue,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const attemptId = beginCommitAttempt_(idToken, pcId, actor);

  let glResult;
  try {
    glResult = writeStockGlEntry_(idToken, user, 'PhysicalCount', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(offsetGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: pcId });
  } catch (err) {
    abandonCommitAttempt_(idToken, pcId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
  finalizeCommitAttempt_(idToken, pcId, glResult, { Lines: finalLines }, actor);

  return { pcNumber: glResult.jvNumber, cleanCount: false };
}

function decidePhysicalCountApproval(idToken, pcId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PHYSICALCOUNT');
    const existing = firebaseDbRequest_('stock/transactions/' + pcId, 'get', null, idToken);
    if (!existing) throw new Error('Physical Count not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new Error('This Physical Count is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this Physical Count.');

    const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
    if (!result.success) throw new Error(result.error);

    if (result.status === 'Approved') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        commitPhysicalCountPosting_(idToken, user, existing, pcId);
      } finally {
        lock.releaseLock();
      }
    } else if (result.status === 'Rejected') {
      const now = new Date().toISOString();
      firebaseDbRequest_('stock/transactions/' + pcId, 'patch', {
        Status: 'Rejected', RejectionReason: String(reason || '').trim(),
        UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
      }, idToken);
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deletePhysicalCountDraft(idToken, pcId) {
  try {
    const user = requireUser_(idToken);
    const existing = firebaseDbRequest_('stock/transactions/' + pcId, 'get', null, idToken);
    if (!existing) throw new Error('Physical Count not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requireDraftAccess_(idToken, user, 'PHYSICALCOUNT');
    if (existing.Status !== 'Draft') throw new Error('Only draft Physical Counts can be deleted. Posted ones must be reversed instead.');
    firebaseDbRequest_('stock/transactions/' + pcId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getPhysicalCountEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PHYSICALCOUNT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Physical / Cycle Count.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ CountID: id }, data[id]))
    .filter(e => e.TransactionType === 'PhysicalCount')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

// Reversing undoes whatever variance adjustments were actually applied —
// lines that had zero variance never affected the ledger, so there's
// nothing for them to undo. Same negative-stock/zero-cost guards apply
// to the flipped-direction lines as the original post.
function reversePhysicalCount(idToken, pcId, reversalDate) {
  const user = requireUser_(idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existing = firebaseDbRequest_('stock/transactions/' + pcId, 'get', null, idToken);
    if (!existing) throw new Error('Physical Count not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'PHYSICALCOUNT');
    if (existing.Status !== 'Posted') throw new Error('Only posted Physical Counts can be reversed.');
    if (existing.ReversedByCount) throw new Error('This Physical Count has already been reversed.');
    if (!existing.LinkedJVID) throw new Error('This was a clean count with no adjustment — there is nothing to reverse.');

    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);

    const varianceLines = (existing.Lines || []).filter(l => Math.abs(l.Variance || 0) >= 0.000001);
    if (!varianceLines.length) throw new Error('No variance lines found to reverse on this entry.');

    const swapped = varianceLines.map(l => Object.assign({}, l, {
      Direction: l.Variance > 0 ? 'Out' : 'In', Quantity: Math.abs(l.Variance)
    }));

    const movementLines = swapped.map((l, idx) => {
      const line = Object.assign({}, l);
      if (line.Direction === 'In') {
        const ledger = getStockLedgerEntry_(idToken, l.ItemID, l.WarehouseID);
        if (!(ledger.AvgCost > 0)) {
          throw new Error('Line ' + (idx + 1) + ' (' + l.ItemCode + '): cannot reverse — this item now has zero current stock, so there is no existing cost to inherit for putting it back.');
        }
        line.UnitCost = ledger.AvgCost;
      }
      return line;
    });

    const movement = computeStockMovement_(idToken, itemsData, coaData, movementLines);

    const offsetGlLines = movementLines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = resolveItemExpenseAccount_(item, 'WriteOff');
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error('Write-off account for ' + item.ItemCode + ' is not valid — check Item Master.');
      const isDecrease = l.Direction === 'Out';
      return {
        AccountCode: account.AccountCode,
        Debit: isDecrease ? l.TotalValue : 0, Credit: isDecrease ? 0 : l.TotalValue,
        Description: 'Reversal of ' + existing.TransactionNumber,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'PCD-' + Utilities.getUuid().split('-')[0].toUpperCase();

    const attemptId = Utilities.getUuid();
    firebaseDbRequest_('stock/transactions/' + newId, 'put', {
      TransactionType: 'PhysicalCount', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfCount: pcId, ReversedByCount: ''
    }, idToken);

    let glResult;
    try {
      glResult = writeStockGlEntry_(idToken, user, 'PhysicalCount', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(offsetGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      firebaseDbRequest_('stock/transactions/' + newId, 'delete', null, idToken);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);

    // Original patched before the new reversal finalizes — same
    // deliberate ordering as every other module's reversal.
    firebaseDbRequest_('stock/transactions/' + pcId, 'patch', { ReversedByCount: newId }, idToken);
    finalizeCommitAttempt_(idToken, newId, glResult, { Lines: movementLines }, actor);

    return { success: true, pcId: newId, pcNumber: glResult.jvNumber };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// STOCK VALUATION REPORT
// ============================================================
// A snapshot of current stock-on-hand and its value, across all items —
// the inventory equivalent of a trial balance. Reads /stock/ledger/
// directly (current balances only), no transaction history involved.
//
// Racks vs warehouses (aggregateRacks parameter): implements the
// requirement noted in the Core Engine's storage comment when Warehouse
// Movement was built — a rack's balance is tracked completely separately
// from its parent warehouse's own balance, so a naive per-warehouse
// report would silently exclude anything sitting in a rack. This report
// can show either view: aggregateRacks=true merges every rack's balance
// into its parent warehouse's row (one number per warehouse, everything
// included); aggregateRacks=false shows each warehouse and each rack as
// its own separate row (grouped display like "WH-01 / A1"), so you can
// see exactly what's in the main area versus a specific rack.
function getStockValuationReport(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'STOCKVALUATION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Stock Valuation.');
  }

  const companyId = String(params.CompanyID || '').trim();
  if (!companyId) throw new Error('Select a Company.');
  if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
  const categoryFilter = String(params.Category || '').trim();
  const aggregateRacks = params.AggregateRacks !== false; // default true

  const ledgerData = firebaseDbRequest_('stock/ledger', 'get', null, idToken) || {};
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};

  const rowsMap = {};

  Object.keys(ledgerData).forEach(itemId => {
    const item = itemsData[itemId];
    if (!item) return; // orphaned ledger entry (item since deleted) — nothing to report against
    if (item.CompanyID && item.CompanyID !== companyId) return;
    if (categoryFilter && item.Category !== categoryFilter) return;

    const locations = ledgerData[itemId] || {};
    Object.keys(locations).forEach(locationId => {
      const entry = locations[locationId];
      if (!entry || Math.abs(entry.Quantity || 0) < 0.000001) return; // nothing on hand here — skip entirely

      const loc = orgUnitsData[locationId];
      let effectiveLocationId = locationId;
      let locationLabel = loc ? loc.Code : locationId;
      let isRackRow = false;

      if (loc && loc.Type === 'Rack') {
        if (aggregateRacks) {
          effectiveLocationId = loc.ParentUnitID || locationId;
          const parentWh = orgUnitsData[effectiveLocationId];
          locationLabel = parentWh ? parentWh.Code : effectiveLocationId;
        } else {
          const parentWh = orgUnitsData[loc.ParentUnitID];
          locationLabel = (parentWh ? parentWh.Code : '?') + ' / ' + loc.Code;
          isRackRow = true;
        }
      }

      const key = itemId + '|' + effectiveLocationId;
      if (!rowsMap[key]) {
        rowsMap[key] = {
          ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName, Category: item.Category,
          LocationID: effectiveLocationId, LocationLabel: locationLabel, IsRack: isRackRow,
          Quantity: 0, TotalValue: 0
        };
      }
      rowsMap[key].Quantity = Math.round((rowsMap[key].Quantity + entry.Quantity) * 1e6) / 1e6;
      rowsMap[key].TotalValue = Math.round((rowsMap[key].TotalValue + entry.TotalValue) * 100) / 100;
    });
  });

  const rows = Object.keys(rowsMap).map(k => rowsMap[k]).map(r => Object.assign({}, r, {
    AvgCost: r.Quantity > 0.000001 ? Math.round((r.TotalValue / r.Quantity) * 10000) / 10000 : 0
  })).sort((a, b) =>
    String(a.ItemCode).localeCompare(String(b.ItemCode), undefined, { numeric: true }) ||
    String(a.LocationLabel).localeCompare(String(b.LocationLabel))
  );

  const grandTotal = Math.round(rows.reduce((sum, r) => sum + r.TotalValue, 0) * 100) / 100;

  return { rows: rows, grandTotal: grandTotal, aggregateRacks: aggregateRacks };
}

// ============================================================
// STOCK LEDGER REPORT
// ============================================================
// A transaction-level history for ONE item at ONE location, over a date
// range — the same shape GL Report already gives for an account: opening
// balance, each movement, a running balance, closing balance. Requires
// picking a specific item and a specific warehouse/rack (not "all"),
// same design choice GL Report already makes for accounts, for the same
// reason — a combined view across many locations would need its own
// separate aggregation logic and isn't what this report is for; use
// Stock Valuation for a cross-location snapshot instead.
//
// Walks every POSTED transaction touching this item+location, in the
// order they were ORIGINALLY posted (CreatedAt — the actual sequence
// that determined WAC), same ordering rule as recalculateStockLedger.
// Transactions before the requested date range are folded into the
// opening balance rather than shown as rows; transactions after the
// range are excluded entirely so the closing balance reflects the
// window requested, not today's live balance.
function getStockLedgerReport(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'STOCKLEDGER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Stock Ledger Report.');
  }

  const itemId = String(params.ItemID || '').trim();
  if (!itemId) throw new Error('Select an item.');
  const warehouseId = String(params.WarehouseID || '').trim();
  if (!warehouseId) throw new Error('Select a warehouse or rack.');
  const fromDate = String(params.FromDate || '').trim();
  const toDate = String(params.ToDate || '').trim();
  if (!fromDate || !toDate) throw new Error('Select a date range.');

  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const item = itemsData[itemId];
  if (!item) throw new Error('Item not found.');
  if (item.CompanyID && !userCanAccessCompany_(user.profile, item.CompanyID)) throw new Error('You do not have access to that company.');

  const allTx = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};

  const relevant = Object.keys(allTx)
    .map(id => Object.assign({ _id: id }, allTx[id]))
    .filter(t => t.Status === 'Posted' && t.Lines && t.Lines.some(l => l.ItemID === itemId && l.WarehouseID === warehouseId))
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));

  let runningQty = 0, runningValue = 0;
  let openingQty = 0, openingValue = 0;
  const rows = [];

  relevant.forEach(tx => {
    const line = tx.Lines.find(l => l.ItemID === itemId && l.WarehouseID === warehouseId);
    if (!line) return;

    const qty = line.Quantity || 0;
    const isIn = line.Direction === 'In';
    const lineValue = (line.TotalValue != null) ? line.TotalValue : Math.round(qty * (line.UnitCost || 0) * 100) / 100;

    if (isIn) {
      runningValue = Math.round((runningValue + lineValue) * 100) / 100;
      runningQty = Math.round((runningQty + qty) * 1e6) / 1e6;
    } else {
      runningValue = Math.round((runningValue - lineValue) * 100) / 100;
      runningQty = Math.round((runningQty - qty) * 1e6) / 1e6;
    }
    const runningAvgCost = runningQty > 0.000001 ? Math.round((runningValue / runningQty) * 10000) / 10000 : 0;

    if (tx.TransactionDate < fromDate) {
      openingQty = runningQty;
      openingValue = runningValue;
      return; // folds into opening — not shown as its own row
    }
    if (tx.TransactionDate > toDate) return; // outside the window entirely

    rows.push({
      TransactionDate: tx.TransactionDate, TransactionNumber: tx.TransactionNumber || tx._id,
      TransactionType: tx.TransactionType, Description: line.Description || tx.Description,
      Direction: line.Direction, Quantity: qty, UnitCost: line.UnitCost || 0,
      RunningQuantity: runningQty, RunningAvgCost: runningAvgCost, RunningValue: runningValue,
      LinkedJVID: tx.LinkedJVID || '', SourceModule: STOCK_VOUCHER_TYPE_TO_MODULE[tx.TransactionType] || ''
    });
  });

  return {
    ItemCode: item.ItemCode, ItemName: item.ItemName,
    OpeningQuantity: openingQty, OpeningValue: openingValue,
    Rows: rows,
    ClosingQuantity: rows.length ? rows[rows.length - 1].RunningQuantity : openingQty,
    ClosingValue: rows.length ? rows[rows.length - 1].RunningValue : openingValue
  };
}

// ============================================================
// MATERIAL VARIANCE REPORT
// ============================================================
// Period-wide, not per-item: explodes EVERY Production Entry in the
// date range through whichever BOM was actually effective on each
// transaction's own date, aggregates expected consumption per raw
// material across every finished good that shares it, and compares
// against actual net depletion of that material — not just Material
// Issue, but the net effect of Material Issue, Stock Adjustment, and
// Physical Count together, since all three move real material out of
// (or back into) inventory.
//
// BOM EFFECTIVITY: this is the part that makes the report correct
// across a period where a recipe changed. getBomEffectiveOnDate_ is
// called PER PRODUCTION TRANSACTION, using that transaction's own date
// — never "whichever BOM is marked Active right now" applied blanket
// across the whole window. A period spanning a BOM change correctly
// blends both versions' expectations in the right proportion, because
// each unit produced is judged against the recipe that was actually in
// effect when it was made.
//
// ACTUAL CONSUMPTION: summed across MaterialIssue, StockAdjustment, and
// PhysicalCount transaction lines (GRN, Warehouse Movement, and
// Production itself are irrelevant here — GRN and Warehouse Movement
// don't consume anything, and Production's own lines are the FG side,
// not the RM side). Every one of these transaction types already stores
// Direction ('In'/'Out') on its posted lines, so net consumption is
// simply Out minus In — an Adjustment or Count increase (found extra)
// correctly offsets against issues/decreases rather than being ignored.
//
// A produced item with no BOM effective on its production date
// contributes nothing to expected consumption and is called out
// separately (NoBomWarning) rather than silently ignored — that's a
// real gap in the data worth surfacing, not something to hide.
function getMaterialVarianceReport(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'MATERIALVARIANCE', 'access', user.profile.role)) {
    throw new Error('You do not have access to Material Variance Report.');
  }

  const companyId = String(params.CompanyID || '').trim();
  if (!companyId) throw new Error('Select a Company.');
  if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
  const fromDate = String(params.FromDate || '').trim();
  const toDate = String(params.ToDate || '').trim();
  if (!fromDate || !toDate) throw new Error('Select a date range.');

  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const bomsByParent = groupBomsByParent_(idToken);
  const allTx = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};

  const inWindow = Object.keys(allTx).map(id => allTx[id])
    .filter(t => t.Status === 'Posted' && t.CompanyID === companyId && t.TransactionDate >= fromDate && t.TransactionDate <= toDate);

  // Expected consumption: walk every Production line individually,
  // resolving the BOM effective on THAT transaction's own date.
  const expectedByComponent = {};
  const producedByItem = {};
  const noBomItemIds = new Set();

  inWindow.filter(t => t.TransactionType === 'Production').forEach(t => {
    (t.Lines || []).forEach(l => {
      producedByItem[l.ItemID] = Math.round(((producedByItem[l.ItemID] || 0) + (l.Quantity || 0)) * 1e6) / 1e6;

      const bom = getBomEffectiveOnDate_(bomsByParent, l.ItemID, t.TransactionDate);
      if (!bom) { noBomItemIds.add(l.ItemID); return; }

      (bom.Components || []).forEach(c => {
        const scrapMultiplier = 1 + ((c.ScrapPercent || 0) / 100);
        const contribution = (c.Quantity || 0) * scrapMultiplier * (l.Quantity || 0);
        expectedByComponent[c.ComponentItemID] = (expectedByComponent[c.ComponentItemID] || 0) + contribution;
      });
    });
  });

  // Actual consumption: net Out across MI, Stock Adjustment, Physical Count.
  const actualByComponent = {};
  const CONSUMPTION_TYPES = { MaterialIssue: true, StockAdjustment: true, PhysicalCount: true };
  inWindow.filter(t => CONSUMPTION_TYPES[t.TransactionType]).forEach(t => {
    (t.Lines || []).forEach(l => {
      const sign = l.Direction === 'Out' ? 1 : -1;
      actualByComponent[l.ItemID] = (actualByComponent[l.ItemID] || 0) + sign * (l.Quantity || 0);
    });
  });

  const allComponentIds = {};
  Object.keys(expectedByComponent).forEach(id => { allComponentIds[id] = true; });
  Object.keys(actualByComponent).forEach(id => { allComponentIds[id] = true; });

  const rows = Object.keys(allComponentIds).map(cid => {
    const item = itemsData[cid];
    const expected = Math.round((expectedByComponent[cid] || 0) * 1e6) / 1e6;
    const actual = Math.round((actualByComponent[cid] || 0) * 1e6) / 1e6;
    const variance = Math.round((actual - expected) * 1e6) / 1e6;
    const variancePercent = expected > 0.000001 ? Math.round((variance / expected) * 10000) / 100 : null;
    return {
      ComponentItemID: cid, ComponentItemCode: item ? item.ItemCode : '(item not found)', ComponentItemName: item ? item.ItemName : '',
      ExpectedConsumption: expected, ActualConsumption: actual,
      Variance: variance, VariancePercent: variancePercent
    };
  }).sort((a, b) => String(a.ComponentItemCode).localeCompare(String(b.ComponentItemCode), undefined, { numeric: true }));

  const producedRows = Object.keys(producedByItem).map(iid => {
    const item = itemsData[iid];
    return {
      ItemID: iid, ItemCode: item ? item.ItemCode : '', ItemName: item ? item.ItemName : '',
      Quantity: producedByItem[iid], NoBomWarning: noBomItemIds.has(iid)
    };
  }).sort((a, b) => String(a.ItemCode).localeCompare(String(b.ItemCode), undefined, { numeric: true }));

  return { ProducedItems: producedRows, Rows: rows };
}

// ============================================================
// PRODUCTION & CONSUMPTION REPORT
// ============================================================
// Aggregate, category/sub-category-grouped view of either total
// production (from Production Entry) or total consumption (net across
// Material Issue, Stock Adjustment, and Physical Count — same netting
// rule as Material Variance Report) across ALL items in a period. This
// is deliberately a separate module from Stock Ledger Report, not an
// extension of it: Stock Ledger Report is single-item, transaction-
// level detail with a running balance (same shape as GL Report for an
// account); this is the flow equivalent of what Stock Valuation Report
// already is for balances — a many-item aggregate snapshot, not a
// detailed trace of any one item.
//
// Quantity is shown per item in that item's OWN UOM at the detail row
// level — meaningful there. But category/sub-category subtotals and
// the grand total are shown as VALUE, not summed quantity, since
// different items in the same category can have different UOMs
// (summing 10 KG and 5 PCS produces a meaningless "15"). Value is
// free to aggregate this way because every stock transaction line
// already stores its own TotalValue at posting time.
function getProductionConsumptionReport(idToken, params) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PRODCONSUMPTION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Production & Consumption Report.');
  }

  const companyId = String(params.CompanyID || '').trim();
  if (!companyId) throw new Error('Select a Company.');
  if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
  const reportType = String(params.ReportType || '').trim();
  if (reportType !== 'Production' && reportType !== 'Consumption') throw new Error('Select Production or Consumption.');
  const categoryFilter = String(params.Category || '').trim();
  const subCategoryFilter = String(params.SubCategoryID || '').trim();
  const fromDate = String(params.FromDate || '').trim();
  const toDate = String(params.ToDate || '').trim();
  if (!fromDate || !toDate) throw new Error('Select a date range.');

  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const subCatsData = firebaseDbRequest_('itemSubCategories', 'get', null, idToken) || {};
  const uomsData = firebaseDbRequest_('uoms', 'get', null, idToken) || {};
  const allTx = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};

  const inWindow = Object.keys(allTx).map(id => allTx[id])
    .filter(t => t.Status === 'Posted' && t.CompanyID === companyId && t.TransactionDate >= fromDate && t.TransactionDate <= toDate);

  const qtyByItem = {};
  const valueByItem = {};

  function addLine(itemId, qty, value) {
    qtyByItem[itemId] = (qtyByItem[itemId] || 0) + qty;
    valueByItem[itemId] = (valueByItem[itemId] || 0) + value;
  }

  if (reportType === 'Production') {
    // A reversal is stored as its own Posted 'Production' transaction
    // with Direction 'Out' lines (the original never changes its own
    // Status — it stays Posted forever as an audit record, same
    // pairing convention used everywhere else in this system). Without
    // checking Direction, a reversal's lines were being summed as MORE
    // production instead of netting the original back out — this is
    // the fix.
    inWindow.filter(t => t.TransactionType === 'Production').forEach(t => {
      (t.Lines || []).forEach(l => {
        const sign = l.Direction === 'Out' ? -1 : 1;
        const value = (l.TotalValue != null) ? l.TotalValue : (l.Quantity || 0) * (l.UnitCost || 0);
        addLine(l.ItemID, sign * (l.Quantity || 0), sign * value);
      });
    });
  } else {
    const CONSUMPTION_TYPES = { MaterialIssue: true, StockAdjustment: true, PhysicalCount: true };
    inWindow.filter(t => CONSUMPTION_TYPES[t.TransactionType]).forEach(t => {
      (t.Lines || []).forEach(l => {
        const sign = l.Direction === 'Out' ? 1 : -1;
        const value = (l.TotalValue != null) ? l.TotalValue : (l.Quantity || 0) * (l.UnitCost || 0);
        addLine(l.ItemID, sign * (l.Quantity || 0), sign * value);
      });
    });
  }

  const rows = Object.keys(qtyByItem)
    .map(itemId => {
      const item = itemsData[itemId];
      if (!item) return null;
      const qty = Math.round(qtyByItem[itemId] * 1e6) / 1e6;
      const uom = uomsData[item.UOMID];
      const subCat = item.SubCategoryID ? subCatsData[item.SubCategoryID] : null;
      return {
        ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
        Category: item.Category || '(Uncategorized)',
        SubCategoryID: item.SubCategoryID || '', SubCategoryName: subCat ? subCat.Name : '(No Sub-Category)',
        UOMCode: uom ? uom.Code : '', Quantity: qty,
        Value: Math.round((valueByItem[itemId] || 0) * 100) / 100
      };
    })
    .filter(r => r && Math.abs(r.Quantity) > 0.000001)
    .filter(r => !categoryFilter || r.Category === categoryFilter)
    .filter(r => !subCategoryFilter || r.SubCategoryID === subCategoryFilter)
    .sort((a, b) =>
      String(a.Category).localeCompare(String(b.Category)) ||
      String(a.SubCategoryName).localeCompare(String(b.SubCategoryName)) ||
      String(a.ItemCode).localeCompare(String(b.ItemCode), undefined, { numeric: true })
    );

  const grandTotalValue = Math.round(rows.reduce((sum, r) => sum + r.Value, 0) * 100) / 100;

  return { ReportType: reportType, Rows: rows, GrandTotalValue: grandTotalValue };
}

// ============================================================
// VENDOR MASTER DATA (Accounts Payable — FI-AP foundation)
// ============================================================
// First piece of the AP module — everything else planned for it
// (Invoice Processing / 3-way match against GRN, Automatic Payment,
// Vendor Ledger reporting) depends on vendors existing first, the same
// way Item Master had to exist before any GRN/MI/Production could be
// built. Originally built without a per-vendor GL account, reasoning
// that vendor-level detail could be tracked via a VendorID dimension
// on GL lines against one shared, company-wide AP control account
// (the same pattern GRN Clearing / Production Offset established).
// Revised on request to add TradePayablesAccountID per vendor instead
// — a real, legitimate alternative: most vendors can still share one
// account, but this allows genuinely different treatment where needed
// (e.g. Local vs Foreign vendors posting to different Trade Payables
// accounts, which is exactly why Classification was added alongside
// this). The VendorID-dimension idea isn't gone — it's still how
// per-vendor drill-down within whichever account a vendor posts to
// will work once Invoice Processing is built; it just no longer means
// every vendor is FORCED onto the same single account.
//
// Storage: /vendors/{id} = { VendorCode, VendorName, Category,
//   Classification ('Local' | 'Foreign'), Country (required only when
//   Foreign — a Local vendor's Country is always blank), ContactPerson,
//   Phone, Email, AddressLine1, AddressLine2, TaxRegistrationNumber,
//   PaymentTermsDays, DefaultCurrency, TradePayablesAccountID (the
//   Liability-type GL account this vendor's balance posts against —
//   required; see saveVendor's own comment on why this is restricted to
//   Liability accounts, unlike Item Master's Consumption Account),
//   BankName, BankAccountNumber, BankIBAN, BankSwift, CompanyID
//   (optional restriction, blank = shared across all companies, same
//   convention as COA/Items), Status, Notes, CreatedAt/By, UpdatedAt/By }
// /vendorCounters/VEN = running sequence for VendorCode.

const VENDOR_CATEGORIES = ['RawMaterialSupplier', 'ServiceProvider', 'Contractor', 'Utility', 'Other'];

function generateVendorCode_(idToken) {
  const counterPath = 'vendorCounters/VEN';
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return 'VEN-' + String(next).padStart(6, '0');
}

function getVendors(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'VENDORMASTER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Vendor Master Data.');
  }
  const data = firebaseDbRequest_('vendors', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ VendorID: id }, data[id]))
    .filter(v => userCanAccessCompany_(user.profile, v.CompanyID));
}

// Minimal reference read for future AP transaction screens (Invoice
// Processing, Payment) to populate a vendor picker without requiring
// full VENDORMASTER access — same role getActiveItems/getActiveCompanies
// play for their own modules.
function getActiveVendors(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('vendors', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({
      VendorID: id, VendorCode: data[id].VendorCode, VendorName: data[id].VendorName,
      Category: data[id].Category || '', CompanyID: data[id].CompanyID || '',
      Classification: data[id].Classification || '', Country: data[id].Country || '',
      TradePayablesAccountID: data[id].TradePayablesAccountID || '',
      PaymentTermsDays: data[id].PaymentTermsDays || 0, DefaultCurrency: data[id].DefaultCurrency || '',
      // Added for Purchase Order's own print document — a genuine
      // vendor-facing document needs an address and a contact to be
      // worth anything, not just the internal fields used elsewhere.
      AddressLine1: data[id].AddressLine1 || '', AddressLine2: data[id].AddressLine2 || '',
      ContactPerson: data[id].ContactPerson || '', Phone: data[id].Phone || '',
      Email: data[id].Email || '', TaxRegistrationNumber: data[id].TaxRegistrationNumber || ''
    }));
}

function saveVendor(idToken, vendorData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'VENDORMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Vendor Master Data.');
    }

    const vendorId = String(vendorData.VendorID || '').trim();
    const vendorName = String(vendorData.VendorName || '').trim();
    if (!vendorName) throw new Error('Vendor name is required.');
    const category = String(vendorData.Category || '').trim();
    if (category && VENDOR_CATEGORIES.indexOf(category) === -1) throw new Error('Unknown vendor category.');
    const companyId = String(vendorData.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const classification = String(vendorData.Classification || '').trim();
    if (classification !== 'Local' && classification !== 'Foreign') throw new Error('Select Local or Foreign.');
    const country = String(vendorData.Country || '').trim();
    if (classification === 'Foreign' && !country) throw new Error('Select a country for a Foreign vendor.');
    // A Local vendor's country isn't asked for on the form, but if one
    // slipped in from switching Classification back and forth, don't
    // silently keep it — Country only means something for Foreign.
    const finalCountry = classification === 'Foreign' ? country : '';

    // Trade Payables must be a real, active, postable Liability account
    // — unlike Item Master's Consumption Account (deliberately left
    // unrestricted because it serves a dual role across Material Issue
    // and Production Entry), Trade Payables has exactly one accounting
    // meaning, so restricting the type here is a real safeguard, not
    // paternalism.
    const tradePayablesAccountId = String(vendorData.TradePayablesAccountID || '').trim();
    if (!tradePayablesAccountId) throw new Error('Select a Trade Payables account.');
    const coaData = getCoaData_(idToken);
    const tpAccount = coaData[tradePayablesAccountId];
    if (!tpAccount || !tpAccount.IsPostable || tpAccount.Status !== 'Active') throw new Error('Trade Payables account must be an active, postable account.');
    if (tpAccount.AccountType !== 'Liability') throw new Error('Trade Payables account must be a Liability-type account.');
    if (tpAccount.CompanyID && companyId && tpAccount.CompanyID !== companyId) throw new Error('Trade Payables account is restricted to a different company.');

    const paymentTermsDays = Number(vendorData.PaymentTermsDays);
    if (!(paymentTermsDays >= 0)) throw new Error('Payment terms (days) must be zero or more.');

    const email = String(vendorData.Email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      VendorName: vendorName, Category: category,
      Classification: classification, Country: finalCountry,
      TradePayablesAccountID: tradePayablesAccountId,
      ContactPerson: String(vendorData.ContactPerson || '').trim(),
      Phone: String(vendorData.Phone || '').trim(), Email: email,
      AddressLine1: String(vendorData.AddressLine1 || '').trim(),
      AddressLine2: String(vendorData.AddressLine2 || '').trim(),
      TaxRegistrationNumber: String(vendorData.TaxRegistrationNumber || '').trim(),
      PaymentTermsDays: paymentTermsDays,
      DefaultCurrency: String(vendorData.DefaultCurrency || '').trim(),
      BankName: String(vendorData.BankName || '').trim(),
      BankAccountNumber: String(vendorData.BankAccountNumber || '').trim(),
      BankIBAN: String(vendorData.BankIBAN || '').trim(),
      BankSwift: String(vendorData.BankSwift || '').trim(),
      CompanyID: companyId, Notes: String(vendorData.Notes || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    };

    if (vendorId) {
      const existing = firebaseDbRequest_('vendors/' + vendorId, 'get', null, idToken);
      if (!existing) throw new Error('Vendor not found.');
      // VendorCode and Category are set once at creation and not
      // editable afterward — same rule Item Master enforces on
      // ItemCode/Category, since changing either after transactions
      // exist against this vendor would misrepresent history.
      firebaseDbRequest_('vendors/' + vendorId, 'patch', fields, idToken);
      return { success: true, vendorId: vendorId };
    }

    const vendorCode = generateVendorCode_(idToken);
    const newId = 'VND-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('vendors/' + newId, 'put', Object.assign({}, fields, {
      VendorCode: vendorCode, Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, vendorId: newId, vendorCode: vendorCode };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateVendor(idToken, vendorId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'VENDORMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Vendor Master Data.');
    }
    const existing = firebaseDbRequest_('vendors/' + vendorId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor not found.');
    firebaseDbRequest_('vendors/' + vendorId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateVendor(idToken, vendorId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'VENDORMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Vendor Master Data.');
    }
    const existing = firebaseDbRequest_('vendors/' + vendorId, 'get', null, idToken);
    if (!existing) throw new Error('Vendor not found.');
    firebaseDbRequest_('vendors/' + vendorId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// FAVORITE MODULES (home page quick access)
// ============================================================
// Per-user, capped at 5 — stored under the user's own Firebase uid so
// favorites follow them across devices/sessions rather than living in
// browser localStorage, which a theme preference can get away with but
// a piece of actual user data shouldn't.
//
// Storage: /userFavorites/{uid} = [{ moduleId, label }, ...]
// No access-capability check beyond requireUser_ — favoriting a module
// doesn't grant access to it (openModule's own getModuleFragment call
// still enforces the real permission check when a favorite is clicked),
// this is purely a personal shortcut list.

function getMyFavorites(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('userFavorites/' + user.uid, 'get', null, idToken);
  return data || [];
}

function toggleFavorite(idToken, moduleId, moduleLabel) {
  try {
    const user = requireUser_(idToken);
    const cleanModuleId = String(moduleId || '').trim();
    if (!cleanModuleId) throw new Error('No module specified.');

    const path = 'userFavorites/' + user.uid;
    let favorites = firebaseDbRequest_(path, 'get', null, idToken) || [];
    const existingIndex = favorites.findIndex(f => f.moduleId === cleanModuleId);

    if (existingIndex !== -1) {
      favorites.splice(existingIndex, 1);
    } else {
      if (favorites.length >= 5) throw new Error('You can have at most 5 favorite modules — remove one first.');
      favorites.push({ moduleId: cleanModuleId, label: String(moduleLabel || cleanModuleId).trim() });
    }

    firebaseDbRequest_(path, 'put', favorites, idToken);
    return { success: true, favorites: favorites };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// CUSTOMER MASTER DATA (Accounts Receivable — FI-AR foundation)
// ============================================================
// Mirrors Vendor Master Data's overall structure closely, but with two
// genuine, deliberate differences rather than a straight copy:
//
// 1. CODE GENERATION IS SPLIT BY CLASSIFICATION. Vendor used one flat
//    VEN- counter regardless of Local/Foreign. Customer instead uses
//    CL- for Local and CE- for Export — same mechanism Item Master
//    already uses for its own category-prefixed codes (RM-/FG-/etc.),
//    not a new pattern invented here. Because the code's prefix
//    literally encodes Classification, Classification is LOCKED after
//    creation — same rule, same reasoning, Item Master already applies
//    to Category (its own code-determining field) and Vendor Master
//    applies to VendorCode/Category.
//
// 2. GL MAPPING IS TRADE RECEIVABLES (Asset), NOT TRADE PAYABLES
//    (Liability) — a customer owes the company money, the reverse of a
//    vendor, so the account type restriction flips accordingly. Same
//    reasoning as Vendor's TradePayablesAccountID for why this field is
//    type-restricted at all (a real, single accounting meaning) — just
//    pointed the other direction on the balance sheet.
//
// Storage: /customers/{id} = { CustomerCode, CustomerName, Category,
//   Classification ('Local' | 'Export'), Country (required only when
//   Export), ContactPerson, Phone, Email, AddressLine1, AddressLine2,
//   TaxRegistrationNumber, PaymentTermsDays, DefaultCurrency,
//   TradeReceivablesAccountID (Asset-type GL account this customer's
//   balance posts against — required), BankName, BankAccountNumber,
//   BankIBAN, BankSwift (for refunds/credit notes, not for paying the
//   customer the way Vendor's bank details are for paying a vendor),
//   CompanyID (optional restriction, blank = shared across all
//   companies), Status, Notes, CreatedAt/By, UpdatedAt/By }
// /customerCounters/CL, /customerCounters/CE = running sequences, one
// per classification.

const CUSTOMER_CATEGORIES = ['Retailer', 'Wholesaler', 'Distributor', 'Government', 'Individual', 'Other'];

// Seeds the two classifications every existing customer record
// already uses as plain strings ('Local'/'Export') — same names, so
// nothing needs migrating and every existing customer stays valid
// against this new managed list without any data change at all.
// IsExport is the field that makes this genuinely extensible: code
// generation and the country-requirement rule both key off THIS flag
// now, not a hardcoded string comparison — so a newly added
// classification (say, "Free Zone") works correctly for both as long
// as its own IsExport is set correctly, with no code change needed.
// ============================================================
// SALES INVOICE CONFIGURATION — mirrors Procurement Setup's own
// pattern, on the AR side. Two managed lists: Sales Types (each
// mapped to its own Revenue account — confirmed replacement for
// Customer Invoice's earlier per-item revenue resolution, since the
// SAME item sold locally vs. exported needs different accounts, which
// a fixed per-item field can't represent) and Customer Classifications
// (see ensureCustomerClassificationsSeeded_ below, which this section
// also owns).
// ============================================================

function getSalesTypes(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'access', user.profile.role)) {
    throw new Error('You do not have access to Sales Invoice Configuration.');
  }
  const data = firebaseDbRequest_('salesTypes', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ SalesTypeID: id }, data[id]))
    .filter(t => userCanAccessCompany_(user.profile, t.CompanyID));
}

// Minimal reference read for Customer Invoice's own Sales Type picker
// — no SALESINVOICESETUP access required, same role
// getActiveRequisitionCategories plays for Purchase Requisition.
function getActiveSalesTypes(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('salesTypes', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({ SalesTypeID: id, Name: data[id].Name, GLAccountID: data[id].GLAccountID, CompanyID: data[id].CompanyID || '', RestrictedToClassificationID: data[id].RestrictedToClassificationID || '' }));
}

function saveSalesType(idToken, data) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Sales Invoice Configuration.');
    }

    const salesTypeId = String(data.SalesTypeID || '').trim();
    const name = String(data.Name || '').trim();
    if (!name) throw new Error('Sales Type name is required.');
    const companyId = String(data.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const glAccountId = String(data.GLAccountID || '').trim();
    if (!glAccountId) throw new Error('Select a Sales Revenue account.');
    const coaData = getCoaData_(idToken);
    const account = coaData[glAccountId];
    if (!account || !account.IsPostable || account.Status !== 'Active') throw new Error('Sales Revenue account must be an active, postable account.');
    if (account.AccountType !== 'Revenue') throw new Error('Sales Revenue account must be a Revenue-type account.');
    if (account.CompanyID && companyId && account.CompanyID !== companyId) throw new Error('Sales Revenue account is restricted to a different company.');

    // Optional link to a Customer Classification — this is what
    // actually connects the two lists. Some Sales Types describe WHO
    // the customer is (Local Sales, Export Sales) and should only be
    // usable for a matching customer; others describe WHAT's being
    // sold (RM Sales, Service Invoice) and reasonably apply regardless
    // of classification — those are left with no restriction at all,
    // by leaving this blank. Enforced at Customer Invoice save time,
    // not just suggested — a mismatch here would genuinely misrepresent
    // the tax treatment this whole feature exists to get right.
    const restrictedToClassificationId = String(data.RestrictedToClassificationID || '').trim();
    if (restrictedToClassificationId) {
      let classificationData = firebaseDbRequest_('customerClassifications', 'get', null, idToken) || {};
      classificationData = ensureCustomerClassificationsSeeded_(idToken, classificationData);
      const cls = classificationData[restrictedToClassificationId];
      if (!cls || cls.Status !== 'Active') throw new Error('Select a valid, active Classification to restrict this Sales Type to, or leave it unrestricted.');
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = { Name: name, GLAccountID: glAccountId, CompanyID: companyId, RestrictedToClassificationID: restrictedToClassificationId, UpdatedAt: now, UpdatedBy: actor };

    if (salesTypeId) {
      const existing = firebaseDbRequest_('salesTypes/' + salesTypeId, 'get', null, idToken);
      if (!existing) throw new Error('Sales Type not found.');
      firebaseDbRequest_('salesTypes/' + salesTypeId, 'patch', fields, idToken);
      return { success: true, salesTypeId: salesTypeId };
    }

    const newId = 'STYP-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('salesTypes/' + newId, 'put', Object.assign({}, fields, {
      Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, salesTypeId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateSalesType(idToken, salesTypeId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Sales Invoice Configuration.');
    }
    const existing = firebaseDbRequest_('salesTypes/' + salesTypeId, 'get', null, idToken);
    if (!existing) throw new Error('Sales Type not found.');
    firebaseDbRequest_('salesTypes/' + salesTypeId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateSalesType(idToken, salesTypeId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Sales Invoice Configuration.');
    }
    const existing = firebaseDbRequest_('salesTypes/' + salesTypeId, 'get', null, idToken);
    if (!existing) throw new Error('Sales Type not found.');
    firebaseDbRequest_('salesTypes/' + salesTypeId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function ensureCustomerClassificationsSeeded_(idToken, existing) {
  if (Object.keys(existing).length) return existing;
  const now = new Date().toISOString();
  const updates = {};
  [{ Name: 'Local', IsExport: false }, { Name: 'Export', IsExport: true }].forEach(c => {
    const id = 'CCLS-' + Utilities.getUuid().split('-')[0].toUpperCase();
    const record = { Name: c.Name, IsExport: c.IsExport, CompanyID: '', Status: 'Active', CreatedAt: now, CreatedBy: 'system', UpdatedAt: now, UpdatedBy: 'system' };
    updates[id] = record;
    existing[id] = record;
  });
  firebaseDbRequest_('customerClassifications', 'patch', updates, idToken);
  return existing;
}

function getCustomerClassifications(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'access', user.profile.role)) {
    throw new Error('You do not have access to Sales Invoice Configuration.');
  }
  let data = firebaseDbRequest_('customerClassifications', 'get', null, idToken) || {};
  data = ensureCustomerClassificationsSeeded_(idToken, data);
  return Object.keys(data)
    .map(id => Object.assign({ ClassificationID: id }, data[id]))
    .filter(c => userCanAccessCompany_(user.profile, c.CompanyID));
}

// Minimal reference read for Customer Master's own Classification
// dropdown — no SALESINVOICESETUP access required, same role
// getActiveRequisitionCategories plays for Purchase Requisition.
function getActiveCustomerClassifications(idToken) {
  const user = requireUser_(idToken);
  let data = firebaseDbRequest_('customerClassifications', 'get', null, idToken) || {};
  data = ensureCustomerClassificationsSeeded_(idToken, data);
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({ ClassificationID: id, Name: data[id].Name, IsExport: Boolean(data[id].IsExport), CompanyID: data[id].CompanyID || '' }));
}

function saveCustomerClassification(idToken, data) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Sales Invoice Configuration.');
    }
    const classificationId = String(data.ClassificationID || '').trim();
    const name = String(data.Name || '').trim();
    if (!name) throw new Error('Classification name is required.');
    const isExport = data.IsExport === true || data.IsExport === 'true';
    const companyId = String(data.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = { Name: name, IsExport: isExport, CompanyID: companyId, UpdatedAt: now, UpdatedBy: actor };

    if (classificationId) {
      const existing = firebaseDbRequest_('customerClassifications/' + classificationId, 'get', null, idToken);
      if (!existing) throw new Error('Classification not found.');
      // IsExport is editable even after customers exist against this
      // classification — unlike CustomerCode itself, which freezes at
      // creation, a classification's own IsExport is read fresh every
      // time code generation or the country rule runs, so changing it
      // here only affects customers created AFTER the change, never
      // rewrites any existing customer's own frozen code.
      firebaseDbRequest_('customerClassifications/' + classificationId, 'patch', fields, idToken);
      return { success: true, classificationId: classificationId };
    }

    const newId = 'CCLS-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('customerClassifications/' + newId, 'put', Object.assign({}, fields, {
      Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, classificationId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateCustomerClassification(idToken, classificationId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Sales Invoice Configuration.');
    }
    const existing = firebaseDbRequest_('customerClassifications/' + classificationId, 'get', null, idToken);
    if (!existing) throw new Error('Classification not found.');
    firebaseDbRequest_('customerClassifications/' + classificationId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateCustomerClassification(idToken, classificationId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'SALESINVOICESETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Sales Invoice Configuration.');
    }
    const existing = firebaseDbRequest_('customerClassifications/' + classificationId, 'get', null, idToken);
    if (!existing) throw new Error('Classification not found.');
    firebaseDbRequest_('customerClassifications/' + classificationId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function generateCustomerCode_(idToken, isExport) {
  const prefix = isExport ? 'CE' : 'CL';
  const counterPath = 'customerCounters/' + prefix;
  const current = firebaseDbRequest_(counterPath, 'get', null, idToken) || 0;
  const next = current + 1;
  firebaseDbRequest_(counterPath, 'put', next, idToken);
  return prefix + '-' + String(next).padStart(6, '0');
}

function getCustomers(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'CUSTOMERMASTER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Customer Master Data.');
  }
  const data = firebaseDbRequest_('customers', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ CustomerID: id }, data[id]))
    .filter(c => userCanAccessCompany_(user.profile, c.CompanyID));
}

// Minimal reference read for future AR transaction screens (Sales
// Invoicing, Cash Application) to populate a customer picker without
// requiring full CUSTOMERMASTER access — same role getActiveVendors
// plays for AP.
function getActiveCustomers(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('customers', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({
      CustomerID: id, CustomerCode: data[id].CustomerCode, CustomerName: data[id].CustomerName,
      Category: data[id].Category || '', CompanyID: data[id].CompanyID || '',
      Classification: data[id].Classification || '', Country: data[id].Country || '',
      AddressLine1: data[id].AddressLine1 || '', AddressLine2: data[id].AddressLine2 || '',
      ContactPerson: data[id].ContactPerson || '', Phone: data[id].Phone || '',
      TradeReceivablesAccountID: data[id].TradeReceivablesAccountID || '',
      TaxRegistrationNumber: data[id].TaxRegistrationNumber || '',
      PaymentTermsDays: data[id].PaymentTermsDays || 0, DefaultCurrency: data[id].DefaultCurrency || ''
    }));
}

function saveCustomer(idToken, customerData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'CUSTOMERMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Customer Master Data.');
    }

    const customerId = String(customerData.CustomerID || '').trim();
    const customerName = String(customerData.CustomerName || '').trim();
    if (!customerName) throw new Error('Customer name is required.');
    const category = String(customerData.Category || '').trim();
    if (category && CUSTOMER_CATEGORIES.indexOf(category) === -1) throw new Error('Unknown customer category.');
    const companyId = String(customerData.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const classification = String(customerData.Classification || '').trim();
    let classificationData = firebaseDbRequest_('customerClassifications', 'get', null, idToken) || {};
    classificationData = ensureCustomerClassificationsSeeded_(idToken, classificationData);
    const classificationById = {};
    Object.keys(classificationData).forEach(id => { classificationById[id] = classificationData[id]; });
    // Backward compatibility: an existing customer record may still
    // carry the OLD plain-string value ('Local'/'Export') from before
    // this became a managed list — match on that too, not just an ID,
    // so nothing already saved needs any migration.
    const matchedClassification = classificationById[classification]
      || Object.values(classificationById).find(c => c.Name === classification && c.Status === 'Active');
    if (!matchedClassification || matchedClassification.Status !== 'Active') throw new Error('Select a valid, active Classification.');
    const isExport = Boolean(matchedClassification.IsExport);
    const country = String(customerData.Country || '').trim();
    if (isExport && !country) throw new Error('Select a country for an Export customer.');
    const finalCountry = isExport ? country : '';

    // Trade Receivables must be a real, active, postable Asset account —
    // see the module comment above for why this is Asset, not Liability.
    const tradeReceivablesAccountId = String(customerData.TradeReceivablesAccountID || '').trim();
    if (!tradeReceivablesAccountId) throw new Error('Select a Trade Receivables account.');
    const coaData = getCoaData_(idToken);
    const trAccount = coaData[tradeReceivablesAccountId];
    if (!trAccount || !trAccount.IsPostable || trAccount.Status !== 'Active') throw new Error('Trade Receivables account must be an active, postable account.');
    if (trAccount.AccountType !== 'Asset') throw new Error('Trade Receivables account must be an Asset-type account.');
    if (trAccount.CompanyID && companyId && trAccount.CompanyID !== companyId) throw new Error('Trade Receivables account is restricted to a different company.');

    const paymentTermsDays = Number(customerData.PaymentTermsDays);
    if (!(paymentTermsDays >= 0)) throw new Error('Payment terms (days) must be zero or more.');

    const email = String(customerData.Email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const fields = {
      CustomerName: customerName, Category: category,
      Classification: matchedClassification.Name, Country: finalCountry,
      TradeReceivablesAccountID: tradeReceivablesAccountId,
      ContactPerson: String(customerData.ContactPerson || '').trim(),
      Phone: String(customerData.Phone || '').trim(), Email: email,
      AddressLine1: String(customerData.AddressLine1 || '').trim(),
      AddressLine2: String(customerData.AddressLine2 || '').trim(),
      TaxRegistrationNumber: String(customerData.TaxRegistrationNumber || '').trim(),
      PaymentTermsDays: paymentTermsDays,
      DefaultCurrency: String(customerData.DefaultCurrency || '').trim(),
      BankName: String(customerData.BankName || '').trim(),
      BankAccountNumber: String(customerData.BankAccountNumber || '').trim(),
      BankIBAN: String(customerData.BankIBAN || '').trim(),
      BankSwift: String(customerData.BankSwift || '').trim(),
      CompanyID: companyId, Notes: String(customerData.Notes || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    };

    if (customerId) {
      const existing = firebaseDbRequest_('customers/' + customerId, 'get', null, idToken);
      if (!existing) throw new Error('Customer not found.');
      // CustomerCode and Classification are set once at creation and
      // not editable afterward — the code's own prefix (CL-/CE-)
      // literally encodes Classification, so changing it later would
      // misrepresent the code, same rule Item Master enforces on
      // ItemCode/Category.
      firebaseDbRequest_('customers/' + customerId, 'patch', fields, idToken);
      return { success: true, customerId: customerId };
    }

    const customerCode = generateCustomerCode_(idToken, isExport);
    const newId = 'CST-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('customers/' + newId, 'put', Object.assign({}, fields, {
      CustomerCode: customerCode, Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, customerId: newId, customerCode: customerCode };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateCustomer(idToken, customerId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'CUSTOMERMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Customer Master Data.');
    }
    const existing = firebaseDbRequest_('customers/' + customerId, 'get', null, idToken);
    if (!existing) throw new Error('Customer not found.');
    firebaseDbRequest_('customers/' + customerId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateCustomer(idToken, customerId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'CUSTOMERMASTER', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Customer Master Data.');
    }
    const existing = firebaseDbRequest_('customers/' + customerId, 'get', null, idToken);
    if (!existing) throw new Error('Customer not found.');
    firebaseDbRequest_('customers/' + customerId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// PROCUREMENT SETUP (foundation for Purchase Requisition and
// Inventory Purchase Requisition)
// ============================================================
// REQUISITION CATEGORIES — a curated, GL-mapped list so a non-finance
// requester (Marketing, HR, etc.) picks a friendly name like
// "Printing & Stationery" instead of a raw account code. Each
// category has a Type (FixedAsset | DirectExpense) that determines
// which account TYPE it may map to — Fixed Asset categories can only
// map to Asset-type accounts (capitalized), Direct Expense categories
// only to Expense-type accounts (expensed on receipt). This mirrors
// Vendor/Customer Master's own TradePayables/TradeReceivables
// pattern of restricting an account picker by required AccountType,
// just with the required type itself varying by the category's Type
// field instead of being fixed.
//
// Approval levels used to live here too, scoped only to Cost Center
// and only for what would eventually become PO. That's now the
// master Approval Configuration module instead — admin-controlled,
// covering every gated module (not just Procurement) with a choice
// of scope, not just Cost Center. See that module's own header for
// the storage shape and the cascading, multi-approver resolution
// rule.
//
// Storage:
//   /requisitionCategories/{id} = { Name, Type ('FixedAsset' |
//     'DirectExpense'), GLAccountID, CompanyID (optional restriction,
//     blank = shared), Status, CreatedAt/By, UpdatedAt/By }

const REQUISITION_CATEGORY_REQUIRED_ACCOUNT_TYPE = { FixedAsset: 'Asset', DirectExpense: 'Expense' };

function getRequisitionCategories(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PROCUREMENTSETUP', 'access', user.profile.role)) {
    throw new Error('You do not have access to Procurement Setup.');
  }
  const data = firebaseDbRequest_('requisitionCategories', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ CategoryID: id }, data[id]))
    .filter(c => userCanAccessCompany_(user.profile, c.CompanyID));
}

// Minimal reference read for Purchase Requisition's category picker —
// no PROCUREMENTSETUP access required, same role getActiveVendors etc.
// play for their own modules.
function getActiveRequisitionCategories(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('requisitionCategories', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({
      CategoryID: id, Name: data[id].Name, Type: data[id].Type,
      GLAccountID: data[id].GLAccountID, CompanyID: data[id].CompanyID || ''
    }));
}

function saveRequisitionCategory(idToken, data) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PROCUREMENTSETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Procurement Setup.');
    }

    const categoryId = String(data.CategoryID || '').trim();
    const name = String(data.Name || '').trim();
    if (!name) throw new Error('Category name is required.');
    const type = String(data.Type || '').trim();
    const requiredAccountType = REQUISITION_CATEGORY_REQUIRED_ACCOUNT_TYPE[type];
    if (!requiredAccountType) throw new Error('Select Fixed Asset or Direct Expense.');
    const companyId = String(data.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const glAccountId = String(data.GLAccountID || '').trim();
    if (!glAccountId) throw new Error('Select a GL account.');
    const coaData = getCoaData_(idToken);
    const account = coaData[glAccountId];
    if (!account || !account.IsPostable || account.Status !== 'Active') throw new Error('GL account must be an active, postable account.');
    if (account.AccountType !== requiredAccountType) {
      throw new Error((type === 'FixedAsset' ? 'Fixed Asset' : 'Direct Expense') + ' categories must map to a(n) ' + requiredAccountType + '-type account.');
    }
    if (account.CompanyID && companyId && account.CompanyID !== companyId) throw new Error('GL account is restricted to a different company.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = {
      Name: name, Type: type, GLAccountID: glAccountId, CompanyID: companyId,
      UpdatedAt: now, UpdatedBy: actor
    };

    if (categoryId) {
      const existing = firebaseDbRequest_('requisitionCategories/' + categoryId, 'get', null, idToken);
      if (!existing) throw new Error('Category not found.');
      firebaseDbRequest_('requisitionCategories/' + categoryId, 'patch', fields, idToken);
      return { success: true, categoryId: categoryId };
    }

    const newId = 'RCAT-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('requisitionCategories/' + newId, 'put', Object.assign({}, fields, {
      Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, categoryId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateRequisitionCategory(idToken, categoryId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PROCUREMENTSETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Procurement Setup.');
    }
    const existing = firebaseDbRequest_('requisitionCategories/' + categoryId, 'get', null, idToken);
    if (!existing) throw new Error('Category not found.');
    firebaseDbRequest_('requisitionCategories/' + categoryId, 'patch', {
      Status: 'Inactive', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivateRequisitionCategory(idToken, categoryId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PROCUREMENTSETUP', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Procurement Setup.');
    }
    const existing = firebaseDbRequest_('requisitionCategories/' + categoryId, 'get', null, idToken);
    if (!existing) throw new Error('Category not found.');
    firebaseDbRequest_('requisitionCategories/' + categoryId, 'patch', {
      Status: 'Active', UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Minimal reference read for the approver picker — deliberately NOT
// gated behind requireAdmin_ (unlike getAllFirebaseUsers) since
// Procurement Setup's own write capability already controls who can
// reach this screen at all; a user just needs to be signed in to
// populate a dropdown of who COULD be assigned as an approver.
function getActiveUsersForPicker(idToken) {
  requireUser_(idToken);
  const users = firebaseDbRequest_('users', 'get', null, idToken) || {};
  return Object.keys(users)
    .filter(uid => users[uid].status === 'Active')
    .map(uid => ({ UserID: uid, Username: users[uid].username || '', FullName: users[uid].fullName || '' }));
}

// ============================================================
// APPROVAL CONFIGURATION (master, admin-controlled, cross-module)
// ============================================================
// Generalizes what Procurement Setup's own approval levels used to be
// — the exact same cascading, multi-approver semantics (preserved
// below, unchanged), now keyed by module instead of hardcoded to
// Purchase Order, and with a choice of scope instead of always being
// Cost Center. Confirmed design: not every gated module has a natural
// scope OR a natural monetary amount, so both are configurable per
// module rather than assumed.
//
// This module only decides WHETHER approval is required for a given
// module/scope/amount and WHO the required approvers are — enforcing
// that (a Pending Approval status, an approve/reject action, a queue
// UI) is each consuming module's own job, built when that module is
// retrofitted. Nothing here assumes a consumer exists yet beyond
// Purchase Order.
//
// Storage:
//   /approvalConfigurations/{moduleId} = { Enabled, ScopeType
//     ('Global'|'Company'|'Division'|'Branch'|'CostCenter'), GateType
//     ('Threshold'|'Flat'), UpdatedAt, UpdatedBy }
//   /approvalLevels/{moduleId}/{scopeKey} = { Levels: [{ LevelNumber,
//     ThresholdAmount, ApproverUserID }], UpdatedAt, UpdatedBy }
//   scopeKey is a real org unit ID for Division/Branch/CostCenter, a
//   Company ID for Company, or the literal string 'GLOBAL' for Global.
//
// GateType only changes what the admin screen shows for editing
// (Threshold exposes the amount field; Flat hides it and forces every
// level's ThresholdAmount to 0) — the resolution rule underneath is
// identical either way: a level is required whenever the document's
// amount is AT OR ABOVE that level's own threshold. Flat is really
// just Threshold with every level pinned to 0, which is exactly
// "always required regardless of value" — no separate code path
// needed for it.

const APPROVAL_GATEABLE_MODULES = [
  { ModuleID: 'PURCHASEREQUISITION', Label: 'Purchase Requisition' },
  { ModuleID: 'INVENTORYPURCHASEREQUISITION', Label: 'Inventory Purchase Requisition' },
  { ModuleID: 'JOBORDERREQUEST', Label: 'Job Order Request' },
  { ModuleID: 'JV', Label: 'Journal Entry (JV)' },
  { ModuleID: 'CBT', Label: 'Cash & Bank Transactions' },
  { ModuleID: 'GRN', Label: 'Goods Receipt Note' },
  { ModuleID: 'MATERIALISSUE', Label: 'Material Issue' },
  { ModuleID: 'PRODUCTION', Label: 'Production Entry' },
  { ModuleID: 'STOCKADJUSTMENT', Label: 'Stock Adjustment' },
  { ModuleID: 'WAREHOUSEMOVEMENT', Label: 'Warehouse Movement' },
  { ModuleID: 'PHYSICALCOUNT', Label: 'Physical Inventory Counting & Adjustments' },
  { ModuleID: 'PURCHASEORDER', Label: 'Purchase Order' },
  { ModuleID: 'VENDORINVOICE', Label: 'Vendor Invoice Processing' },
  { ModuleID: 'DELIVERYNOTE', Label: 'Delivery Note (Goods Dispatch)' },
  { ModuleID: 'CUSTOMERINVOICE', Label: 'Customer Invoice Processing' },
];
const APPROVAL_SCOPE_TYPES = ['Global', 'Company', 'Division', 'Branch', 'CostCenter'];
const APPROVAL_GATE_TYPES = ['Threshold', 'Flat'];

function getApprovalConfigurations(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'APPROVALCONFIG', 'access', user.profile.role)) {
    throw new Error('You do not have access to Approval Configuration.');
  }
  const saved = firebaseDbRequest_('approvalConfigurations', 'get', null, idToken) || {};
  return APPROVAL_GATEABLE_MODULES.map(m => {
    const config = saved[m.ModuleID] || {};
    return {
      ModuleID: m.ModuleID, Label: m.Label,
      Enabled: Boolean(config.Enabled),
      ScopeType: config.ScopeType || 'CostCenter',
      GateType: config.GateType || 'Threshold',
      UpdatedAt: config.UpdatedAt || '', UpdatedBy: config.UpdatedBy || ''
    };
  });
}

function saveApprovalConfiguration(idToken, moduleId, config) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'APPROVALCONFIG', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Approval Configuration.');
    }
    if (!APPROVAL_GATEABLE_MODULES.some(m => m.ModuleID === moduleId)) throw new Error('Unknown module.');
    const scopeType = String((config || {}).ScopeType || '').trim();
    if (APPROVAL_SCOPE_TYPES.indexOf(scopeType) === -1) throw new Error('Invalid scope type.');
    const gateType = String((config || {}).GateType || '').trim();
    if (APPROVAL_GATE_TYPES.indexOf(gateType) === -1) throw new Error('Invalid gate type.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('approvalConfigurations/' + moduleId, 'put', {
      Enabled: Boolean((config || {}).Enabled), ScopeType: scopeType, GateType: gateType,
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getApprovalLevelsForModule(idToken, moduleId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'APPROVALCONFIG', 'access', user.profile.role)) {
    throw new Error('You do not have access to Approval Configuration.');
  }
  const data = firebaseDbRequest_('approvalLevels/' + moduleId, 'get', null, idToken) || {};
  return Object.keys(data).map(scopeKey => ({
    ScopeKey: scopeKey, Levels: data[scopeKey].Levels || [],
    UpdatedAt: data[scopeKey].UpdatedAt, UpdatedBy: data[scopeKey].UpdatedBy
  }));
}

// scopeKey's own validity depends entirely on the module's currently
// configured ScopeType — a Cost Center ID is meaningless for a module
// scoped Globally, and vice versa.
function validateApprovalScopeKey_(idToken, scopeType, scopeKey) {
  if (scopeType === 'Global') {
    if (scopeKey !== 'GLOBAL') throw new Error('A Globally-scoped module only has one configuration (scope key must be GLOBAL).');
    return;
  }
  if (scopeType === 'Company') {
    const companies = firebaseDbRequest_('companies', 'get', null, idToken) || {};
    if (!companies[scopeKey]) throw new Error('Unknown Company.');
    return;
  }
  // Division / Branch / CostCenter
  const orgUnits = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
  if (!orgUnits[scopeKey] || orgUnits[scopeKey].Type !== scopeType) throw new Error('Unknown ' + scopeType + '.');
}

function saveApprovalLevels(idToken, moduleId, scopeKey, levels) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'APPROVALCONFIG', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Approval Configuration.');
    }
    if (!APPROVAL_GATEABLE_MODULES.some(m => m.ModuleID === moduleId)) throw new Error('Unknown module.');
    const config = firebaseDbRequest_('approvalConfigurations/' + moduleId, 'get', null, idToken);
    if (!config) throw new Error('Configure this module\'s scope and gate type before adding levels.');

    const key = String(scopeKey || '').trim();
    if (!key) throw new Error('Select a scope.');
    validateApprovalScopeKey_(idToken, config.ScopeType, key);

    const activeUsers = firebaseDbRequest_('users', 'get', null, idToken) || {};
    const isFlat = config.GateType === 'Flat';

    // LevelNumber is always derived from array position, never trusted
    // from the client, so gaps/duplicates are structurally impossible.
    // Threshold is "the value AT OR ABOVE which this level's approval
    // is required" — must never decrease level over level, since a
    // lower threshold on a later level would make it either redundant
    // or unreachable in the wrong direction. Equal thresholds ARE
    // allowed, deliberately: two levels sharing the same threshold
    // (most commonly both at 0) is exactly how "both of these
    // approvals are always required together, regardless of value"
    // gets expressed — a strictly-increasing-only rule couldn't say
    // that at all. For a Flat gate every level is simply forced to 0,
    // which is this same mechanism applied uniformly.
    const cleaned = [];
    let previousThreshold = -1;
    (levels || []).forEach((lvl, i) => {
      const threshold = isFlat ? 0 : Number(lvl.ThresholdAmount);
      if (!isFlat) {
        if (!(threshold >= 0)) throw new Error('Level ' + (i + 1) + ': threshold must be zero or more.');
        if (threshold < previousThreshold) throw new Error('Level ' + (i + 1) + ': threshold cannot be lower than the previous level\'s.');
        previousThreshold = threshold;
      }

      const approverId = String(lvl.ApproverUserID || '').trim();
      if (!approverId) throw new Error('Level ' + (i + 1) + ': select an approver.');
      if (!activeUsers[approverId] || activeUsers[approverId].status !== 'Active') {
        throw new Error('Level ' + (i + 1) + ': approver must be an active user.');
      }
      cleaned.push({ LevelNumber: i + 1, ThresholdAmount: threshold, ApproverUserID: approverId });
    });

    firebaseDbRequest_('approvalLevels/' + moduleId + '/' + key, 'put', {
      Levels: cleaned, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Resolves which specific levels are required for a document of the
// given amount, in the module's own configured scope. Returns an
// empty array if the module isn't gated, isn't enabled, or has no
// levels configured for that scope — never throws for "not gated",
// since that's the normal, common case for most calls.
function resolveRequiredApprovalLevels_(idToken, moduleId, scopeKey, amount) {
  const config = firebaseDbRequest_('approvalConfigurations/' + moduleId, 'get', null, idToken);
  if (!config || !config.Enabled) return [];
  const key = String(scopeKey || '').trim();
  if (!key) return [];
  const levelsRecord = firebaseDbRequest_('approvalLevels/' + moduleId + '/' + key, 'get', null, idToken);
  const levels = (levelsRecord && levelsRecord.Levels) || [];
  const docAmount = Number(amount) || 0;
  // A level is required whenever the document's amount is AT OR ABOVE
  // that level's own threshold — identical rule for Threshold and Flat
  // gates, since Flat just means every level's threshold is 0.
  return levels.filter(l => docAmount >= Number(l.ThresholdAmount || 0));
}

// Public wrapper — lets a consuming module's client preview approval
// requirements before submitting (e.g. show "this will need 2
// approvals" on a confirmation screen), and gives a future module's
// server-side submit function the same resolution without duplicating
// the logic above.
function getRequiredApprovalLevels(idToken, moduleId, scopeKey, amount) {
  requireUser_(idToken);
  return resolveRequiredApprovalLevels_(idToken, moduleId, scopeKey, amount);
}

// ============================================================
// APPROVAL WORKFLOW ENGINE (generic — any gated module plugs into this)
// ============================================================
// The configuration functions above only answer "is approval required,
// and by whom" — this is the part that actually TRACKS a real
// document's approval through to a decision, and is what the Approval
// Tracker later reads for audit/dispute history. Built once here so
// every future module retrofit (JV, CBT, GRN, etc.) reuses the exact
// same instance shape rather than inventing its own.
//
// Self-approval (the same person who created the document also holds
// one of its required approval levels) is PERMITTED, not blocked — a
// hard block would paralyze a small department where the same person
// is genuinely the only Level 1 approver. Instead every decision
// carries a SelfApproved flag, so an auditor can see at a glance which
// approvals were genuinely independent and which weren't, rather than
// this being invisible.
//
// Storage: /approvalInstances/{id} = { ModuleID, DocumentID,
//   DocumentNumber, ScopeKey, Amount, CreatedBy (the document's own
//   creator/submitter — what SelfApproved is checked against),
//   RequiredLevels: [{ LevelNumber, ThresholdAmount, ApproverUserID }]
//   (snapshotted at submit time — later changes to the module's own
//   configuration never retroactively alter an in-flight document,
//   same principle as BOM/Price List effective-dating),
//   Decisions: [{ LevelNumber, ApproverUserID, Decision
//   ('Approved'|'Rejected'), DecidedAt, Reason, SelfApproved }],
//   Status ('Pending'|'Approved'|'Rejected'), CreatedAt, UpdatedAt }

// Called by a module's own submit function. Returns { required: false }
// if this document doesn't need approval at all (module disabled, or
// no levels configured for its scope) — the caller can post straight
// through. Otherwise creates the tracking instance and returns its ID
// for the caller to store on its own document.
//
// createdBy MUST be the submitting user's UID (user.uid) — NOT the
// display username most CreatedBy/UpdatedBy fields elsewhere use.
// recordApprovalDecision_ compares an approver's own UID against this
// exact value to flag SelfApproved; passing a username here would
// make that check silently never fire.
// Generic helper any module's submit function calls to figure out
// WHICH of its own dimension fields to pass as scopeKey — a module
// configured for CostCenter scope needs its own CostCenterID, one
// configured for Company scope needs its own CompanyID, and so on.
// Written once here so every future retrofit shares it rather than
// each reimplementing the same switch.
function resolveApprovalScopeKeyForDocument_(idToken, moduleId, dimensions) {
  const config = firebaseDbRequest_('approvalConfigurations/' + moduleId, 'get', null, idToken);
  if (!config) return '';
  const d = dimensions || {};
  switch (config.ScopeType) {
    case 'Global': return 'GLOBAL';
    case 'Company': return d.CompanyID || '';
    case 'Division': return d.DivisionID || '';
    case 'Branch': return d.BranchID || '';
    case 'CostCenter': return d.CostCenterID || '';
    default: return '';
  }
}

function beginApprovalInstance_(idToken, moduleId, documentId, documentNumber, scopeKey, amount, createdBy) {
  const levels = resolveRequiredApprovalLevels_(idToken, moduleId, scopeKey, amount);
  if (!levels.length) return { required: false };

  const now = new Date().toISOString();
  const newId = 'APR-' + Utilities.getUuid().split('-')[0].toUpperCase();
  firebaseDbRequest_('approvalInstances/' + newId, 'put', {
    ModuleID: moduleId, DocumentID: documentId, DocumentNumber: documentNumber,
    ScopeKey: scopeKey, Amount: Number(amount) || 0, CreatedBy: createdBy,
    RequiredLevels: levels, Decisions: [], Status: 'Pending',
    CreatedAt: now, UpdatedAt: now
  }, idToken);
  return { required: true, instanceId: newId };
}

// The actual approve/reject action, called by whoever is signing off.
// Authorization is strict: only the user assigned to a specific
// REQUIRED level may decide for that level — not any approver from
// anywhere in the system, and not twice for the same level.
function recordApprovalDecision(idToken, instanceId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    // ApproverUserID (both on a saved level and here) is always the
    // user's own key in the users collection — the UID — same
    // convention the config picker itself uses (value="${u.UserID}").
    // Comparing against username instead, as most CreatedBy/UpdatedBy
    // fields elsewhere in this system do, would never actually match
    // a real approver. CreatedBy on the instance follows the same
    // rule for exactly the same reason — see beginApprovalInstance_'s
    // own comment on why its caller must pass the creator's UID, not
    // their display username, for SelfApproved to mean anything.
    const actor = user.uid;
    const activeUsers = firebaseDbRequest_('users', 'get', null, idToken) || {};
    const actorName = (activeUsers[actor] && (activeUsers[actor].fullName || activeUsers[actor].username)) || actor;
    const instance = firebaseDbRequest_('approvalInstances/' + instanceId, 'get', null, idToken);
    if (!instance) throw new Error('Approval record not found.');
    if (instance.Status !== 'Pending') throw new Error('This document has already been ' + instance.Status.toLowerCase() + '.');

    const level = (instance.RequiredLevels || []).find(l => l.LevelNumber === levelNumber);
    if (!level) throw new Error('That approval level does not apply to this document.');
    if (level.ApproverUserID !== actor) throw new Error('You are not the assigned approver for this level.');
    if ((instance.Decisions || []).some(d => d.LevelNumber === levelNumber)) {
      throw new Error('This level has already recorded a decision.');
    }

    if (decision !== 'Approved' && decision !== 'Rejected') throw new Error('Invalid decision.');
    const reasonText = String(reason || '').trim();
    if (decision === 'Rejected' && !reasonText) throw new Error('A reason is required to reject.');

    const now = new Date().toISOString();
    const newDecision = {
      LevelNumber: levelNumber, ApproverUserID: actor, ApproverName: actorName, Decision: decision,
      DecidedAt: now, Reason: reasonText, SelfApproved: actor === instance.CreatedBy
    };
    const decisions = (instance.Decisions || []).concat([newDecision]);

    // A single rejection, at any level, stops the whole document —
    // no need for every other level to also weigh in once one has
    // said no. Otherwise it's Approved only once every required level
    // has its own decision recorded.
    let newStatus = instance.Status;
    if (decision === 'Rejected') {
      newStatus = 'Rejected';
    } else if (instance.RequiredLevels.every(l => decisions.some(d => d.LevelNumber === l.LevelNumber && d.Decision === 'Approved'))) {
      newStatus = 'Approved';
    }

    firebaseDbRequest_('approvalInstances/' + instanceId, 'patch', {
      Decisions: decisions, Status: newStatus, UpdatedAt: now
    }, idToken);
    return { success: true, status: newStatus, selfApproved: newDecision.SelfApproved };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getApprovalInstance_(idToken, instanceId) {
  if (!instanceId) return null;
  const instance = firebaseDbRequest_('approvalInstances/' + instanceId, 'get', null, idToken);
  return instance ? Object.assign({ InstanceID: instanceId }, instance) : null;
}

// Powers an approver's own queue — every Pending instance where the
// current user is assigned to at least one level that hasn't decided
// yet, regardless of which module the document belongs to.
// Maps each approval-gateable module to where its own documents
// actually live — needed so the home-page task lists (pending
// approvals, rejected-to-resubmit) can verify a document still
// genuinely exists before showing it. A document CAN become orphaned
// from its own approval instance: e.g. a Rejected entry gets edited
// (which resets it to Draft) and is then deleted as a draft — the
// delete itself is entirely legitimate, but nothing else in the
// system ever goes back and cleans up the OLD approval instance that
// still points at it. Without this check, that stale task sits stuck
// in the list forever, since clicking it can only ever fail with
// "could not be found."
const APPROVAL_MODULE_STORAGE_ = {
  JV: { type: 'firestore', collection: FIRESTORE_JOURNAL_ENTRIES_COLLECTION },
  CBT: { type: 'firestore', collection: FIRESTORE_JOURNAL_ENTRIES_COLLECTION },
  GRN: { type: 'rtdb', path: 'stock/transactions' },
  MATERIALISSUE: { type: 'rtdb', path: 'stock/transactions' },
  PRODUCTION: { type: 'rtdb', path: 'stock/transactions' },
  STOCKADJUSTMENT: { type: 'rtdb', path: 'stock/transactions' },
  WAREHOUSEMOVEMENT: { type: 'rtdb', path: 'stock/transactions' },
  PHYSICALCOUNT: { type: 'rtdb', path: 'stock/transactions' },
  DELIVERYNOTE: { type: 'rtdb', path: 'stock/transactions' },
  PURCHASEORDER: { type: 'rtdb', path: 'purchaseOrders' },
  VENDORINVOICE: { type: 'rtdb', path: 'vendorInvoices' },
  CUSTOMERINVOICE: { type: 'rtdb', path: 'customerInvoices' },
  PURCHASEREQUISITION: { type: 'rtdb', path: 'purchaseRequisitions' },
  INVENTORYPURCHASEREQUISITION: { type: 'rtdb', path: 'inventoryPurchaseRequisitions' },
  JOBORDERREQUEST: { type: 'rtdb', path: 'jobOrderBatches' }
};

// Returns the full underlying document (or null if it no longer
// exists) — used both by documentStillExists_ below (existence alone)
// and by getMyRejectedSubmissions (which additionally needs to check
// whether a "Rejected" instance is still the document's own CURRENT
// one, since resubmitting after a rejection creates a fresh instance
// without ever going back to mark the old one as superseded).
function fetchApprovalSourceDocument_(idToken, moduleId, documentId) {
  const storage = APPROVAL_MODULE_STORAGE_[moduleId];
  if (!storage || !documentId) return null;
  if (storage.type === 'firestore') return firestoreGet_(storage.collection, documentId);
  return firebaseDbRequest_(storage.path + '/' + documentId, 'get', null, idToken);
}

function documentStillExists_(idToken, moduleId, documentId) {
  // Unknown module (e.g. one added after this map, not yet wired in)
  // — don't hide a task we genuinely can't verify one way or another.
  if (!APPROVAL_MODULE_STORAGE_[moduleId]) return true;
  return Boolean(fetchApprovalSourceDocument_(idToken, moduleId, documentId));
}

function getPendingApprovalsForUser(idToken) {
  const user = requireUser_(idToken);
  const actor = user.uid; // same UID convention as recordApprovalDecision — see its comment
  const data = firebaseDbRequest_('approvalInstances', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ InstanceID: id }, data[id]))
    .filter(inst => inst.Status === 'Pending')
    .filter(inst => {
      const decidedLevels = new Set((inst.Decisions || []).map(d => d.LevelNumber));
      return inst.RequiredLevels.some(l => l.ApproverUserID === actor && !decidedLevels.has(l.LevelNumber));
    })
    .filter(inst => documentStillExists_(idToken, inst.ModuleID, inst.DocumentID))
    .map(inst => {
      const moduleInfo = APPROVAL_GATEABLE_MODULES.find(m => m.ModuleID === inst.ModuleID);
      return Object.assign({ ModuleLabel: moduleInfo ? moduleInfo.Label : inst.ModuleID }, inst);
    })
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
}

// Home page's other half — documents THIS user submitted that got
// rejected and are waiting to be fixed and resubmitted. Same
// approvalInstances collection as getPendingApprovalsForUser above
// covers this too: only a document that actually went through an
// approval gate gets a Rejected status via this pathway at all, so
// there's no need to separately query every individual module's own
// collection (vendorInvoices, customerInvoices, stock/transactions,
// etc.) — this one shared collection already indexes every gated
// document's approval outcome, regardless of which module it belongs
// to. The rejection reason itself lives on the LAST decision in the
// instance's own Decisions array (the one that actually rejected it),
// not as a separate top-level field — pulled out here so the client
// doesn't need to know that shape.
function getMyRejectedSubmissions(idToken) {
  const user = requireUser_(idToken);
  const actor = user.uid;
  const data = firebaseDbRequest_('approvalInstances', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ InstanceID: id }, data[id]))
    .filter(inst => inst.Status === 'Rejected' && inst.CreatedBy === actor)
    .filter(inst => {
      // A "Rejected" instance's own Status field is frozen forever,
      // even once the document is edited and resubmitted — resubmitting
      // creates a genuinely FRESH approval instance (see
      // beginApprovalInstance_), rather than ever going back to mark
      // this old one as superseded. Without this check, an already-
      // resubmitted document — sitting in PendingApproval under a new
      // instance the submitter can no longer act on anyway — would
      // still show up here forever as if it still needed resubmission.
      // Checking the document's own CURRENT ApprovalInstanceID against
      // this instance's own ID is what actually distinguishes "still
      // the active rejection" from "superseded by a later resubmission."
      // Unknown/unmapped module (e.g. one added after
      // APPROVAL_MODULE_STORAGE_ but not yet wired in) — same safe
      // default as documentStillExists_ uses: don't hide a task we
      // genuinely can't verify one way or another.
      if (!APPROVAL_MODULE_STORAGE_[inst.ModuleID]) return true;
      const doc = fetchApprovalSourceDocument_(idToken, inst.ModuleID, inst.DocumentID);
      return Boolean(doc) && doc.ApprovalInstanceID === inst.InstanceID;
    })
    .map(inst => {
      const rejection = (inst.Decisions || []).slice().reverse().find(d => d.Decision === 'Rejected');
      const moduleInfo = APPROVAL_GATEABLE_MODULES.find(m => m.ModuleID === inst.ModuleID);
      return {
        InstanceID: inst.InstanceID, ModuleID: inst.ModuleID,
        ModuleLabel: moduleInfo ? moduleInfo.Label : inst.ModuleID,
        DocumentID: inst.DocumentID, DocumentNumber: inst.DocumentNumber,
        RejectionReason: rejection ? rejection.Reason : '', RejectedAt: rejection ? rejection.DecidedAt : inst.UpdatedAt
      };
    })
    .sort((a, b) => (b.RejectedAt || '').localeCompare(a.RejectedAt || ''));
}

// Powers the Approval Tracker — the full history, for audit or
// dispute review. Optional filters narrow it down; with none, returns
// everything the user has visibility into.
function getApprovalHistory(idToken, filters) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'APPROVALTRACKER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Approval Tracker.');
  }
  const f = filters || {};
  const data = firebaseDbRequest_('approvalInstances', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ InstanceID: id }, data[id]))
    .filter(inst => !f.ModuleID || inst.ModuleID === f.ModuleID)
    .filter(inst => !f.DocumentNumber || (inst.DocumentNumber || '').toLowerCase().indexOf(String(f.DocumentNumber).toLowerCase()) !== -1)
    .filter(inst => !f.ApproverUserID || inst.RequiredLevels.some(l => l.ApproverUserID === f.ApproverUserID))
    .filter(inst => !f.FromDate || (inst.CreatedAt || '') >= f.FromDate)
    .filter(inst => !f.ToDate || (inst.CreatedAt || '') <= f.ToDate + 'T23:59:59.999Z')
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
}


// PURCHASE REQUISITION (non-stock — Fixed Asset / Direct Expense only)
// ============================================================
// Open to every department, not just finance-adjacent ones — see the
// deliberately broad PURCHASEREQUISITION permission default above. Two
// design points settled explicitly during this build, not guessed:
//
// 1. NO VALUE FIELD ANYWHERE ON THIS ENTITY. A requisition's real price
//    only exists once vendor quotations are compared at PO stage — this
//    module only ever expresses need (what, how much, which GL-mapped
//    category), never cost. The Procurement Setup approval chain
//    (levels + thresholds) checks the PO's value once PO exists; it has
//    nothing to check here, which is why this module carries no
//    approval step of its own.
//
// 2. Requisition Category (from Procurement Setup) supplies BOTH the
//    Type (Fixed Asset | Direct Expense) and the GL account a line
//    posts against — the requester picks a friendly category name,
//    never an account code directly.
//
// Status: Draft (editable) -> Submitted (locked, PR Number assigned
// here, not at draft-save — mirrors every other voucher in this system
// only consuming a real sequential number once it's no longer just a
// draft) -> Closed (write-access users mark this once Procurement has
// dealt with it, since there's no PO yet to close it automatically) or
// Cancelled (requester or write-access users, from Draft or Submitted).
//
// Storage: /purchaseRequisitions/{id} = { PRNumber (blank until
//   Submitted), PRDate, CompanyID, DivisionID, BranchID, CostCenterID,
//   ProfitCenterID, Priority ('Normal'|'Urgent'), NeededByDate,
//   Description, RequestedBy, Status, Lines: [{ CategoryID,
//   Description, Quantity, Unit, CostCenterID (line-level override,
//   defaults from header) }], CreatedAt/By, UpdatedAt/By, SubmittedAt/By,
//   ClosedAt/By, CancelledAt/By }

function getPurchaseRequisitionEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PURCHASEREQUISITION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Purchase Requisition.');
  }
  const data = firebaseDbRequest_('purchaseRequisitions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ PRID: id }, data[id]))
    .filter(pr => userCanAccessCompany_(user.profile, pr.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;
  return { entries: capped, total: all.length };
}

function validatePrHeader_(idToken, header, orgUnits) {
  const companyId = String(header.CompanyID || '').trim();
  if (!companyId) throw new Error('Select a Company for this requisition.');
  const costCenterId = String(header.CostCenterID || '').trim();
  if (!costCenterId) throw new Error('Select a Cost Center (requesting department) for this requisition.');
  if (!orgUnits[costCenterId] || orgUnits[costCenterId].Type !== 'CostCenter') throw new Error('Unknown Cost Center.');
  const priority = String(header.Priority || 'Normal').trim();
  if (priority !== 'Normal' && priority !== 'Urgent') throw new Error('Priority must be Normal or Urgent.');
  return { companyId, costCenterId, priority };
}

function saveDraftPurchaseRequisition(idToken, header) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'PURCHASEREQUISITION');
    const orgUnits = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
    const { companyId, costCenterId, priority } = validatePrHeader_(idToken, header, orgUnits);
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const categories = firebaseDbRequest_('requisitionCategories', 'get', null, idToken) || {};
    const lines = (header.Lines || [])
      .filter(l => String(l.CategoryID || '').trim())
      .map(l => {
        const categoryId = String(l.CategoryID).trim();
        const category = categories[categoryId];
        if (!category || category.Status !== 'Active') throw new Error('One or more lines reference an inactive or unknown category.');
        const description = String(l.Description || '').trim();
        if (!description) throw new Error('Every line needs a description.');
        const quantity = Number(l.Quantity);
        if (!(quantity > 0)) throw new Error('Every line needs a quantity greater than zero.');
        return {
          CategoryID: categoryId, Description: description, Quantity: quantity,
          Unit: String(l.Unit || '').trim(),
          CostCenterID: String(l.CostCenterID || costCenterId).trim()
        };
      });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = {
      PRDate: header.PRDate || '', CompanyID: companyId,
      DivisionID: String(header.DivisionID || '').trim(), BranchID: String(header.BranchID || '').trim(),
      CostCenterID: costCenterId, ProfitCenterID: String(header.ProfitCenterID || '').trim(),
      Priority: priority, NeededByDate: header.NeededByDate || '',
      Description: String(header.Description || '').trim(),
      Lines: lines, UpdatedAt: now, UpdatedBy: actor
    };

    const prId = String(header.PRID || '').trim();
    if (prId) {
      const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
      if (!existing) throw new Error('Requisition not found.');
      // Rejected is editable too now — a resubmission after revision
      // reuses this exact save path, same as first drafting.
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a Draft or Rejected requisition can be edited.');
      firebaseDbRequest_('purchaseRequisitions/' + prId, 'patch', fields, idToken);
      return { success: true, prId: prId };
    }

    const newId = 'PRQ-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('purchaseRequisitions/' + newId, 'put', Object.assign({}, fields, {
      PRNumber: '', Status: 'Draft', RequestedBy: actor, CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, prId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function submitPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // Draft (first submission) or Rejected (resubmitting after a
    // revision) — both go through identical logic below, since a
    // resubmission is structurally the same action as a first
    // submission, just starting from a different status.
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a Draft or Rejected requisition can be submitted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('Add at least one line before submitting.');

    const year = (new Date(existing.PRDate)).getFullYear() || new Date().getFullYear();
    const prNumber = generateVoucherNumber_(idToken, 'PR', year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // No value field exists anywhere on a Purchase Requisition —
    // pricing only exists from Purchase Order onward — so the amount
    // passed here is always 0. Confirmed design: a Threshold gate with
    // a level set at 0 behaves exactly like Flat in this case, which
    // is intentional, not a workaround; Admin can use either.
    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'PURCHASEREQUISITION', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'PURCHASEREQUISITION', prId, prNumber, scopeKey, 0, user.uid);

    const fields = {
      PRNumber: prNumber, RejectionReason: '', SubmittedAt: now, SubmittedBy: actor,
      UpdatedAt: now, UpdatedBy: actor
    };
    if (approval.required) {
      fields.Status = 'PendingApproval'; fields.ApprovalInstanceID = approval.instanceId;
    } else {
      // Submitted remains the same final, actionable status it always
      // was — getEligibleRequisitionsForPO and everything else that
      // checks for it needed no changes at all.
      fields.Status = 'Submitted';
    }
    firebaseDbRequest_('purchaseRequisitions/' + prId, 'patch', fields, idToken);
    return { success: true, prNumber: prNumber, status: fields.Status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function decidePurchaseRequisitionApproval(idToken, prId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (existing && !userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const result = decideApprovalForDocument_(idToken, 'purchaseRequisitions', prId, levelNumber, decision, reason, 'Submitted');
    return Object.assign({ success: true }, result);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function closePurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'Submitted') throw new Error('Only a Submitted requisition can be closed.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('purchaseRequisitions/' + prId, 'patch', {
      Status: 'Closed', ClosedAt: now, ClosedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cancelPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // PendingApproval and Rejected are now real, reachable statuses —
    // a requisition sitting in either should still be abandonable,
    // not stuck waiting on an approval or a resubmission nobody wants
    // to pursue anymore.
    if (['Draft', 'Submitted', 'PendingApproval', 'Rejected'].indexOf(existing.Status) === -1) {
      throw new Error('This requisition can no longer be cancelled.');
    }
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('purchaseRequisitions/' + prId, 'patch', {
      Status: 'Cancelled', CancelledAt: now, CancelledBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteDraftPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft requisition can be deleted.');
    firebaseDbRequest_('purchaseRequisitions/' + prId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// INVENTORY PURCHASE REQUISITION (Sales / Production -> Purchase, to
// BUY externally rather than make internally — the Job Order Request
// counterpart)
// ============================================================
// Structurally near-identical to Purchase Requisition (no value field,
// no approval gate, same Draft -> Submitted -> Closed/Cancelled
// workflow, same draft/post capability split) — the one real
// difference is WHAT gets requested: a real item from Item Master
// rather than a free-text category line, since this is genuine stock,
// not a non-stock spend. Confirmed explicitly: item selection is
// unrestricted here — any item, any Category, any type — the
// requester (Sales or Production) judges for themselves what they
// need bought rather than made.
//
// Storage: /inventoryPurchaseRequisitions/{id} = { IPRNumber (blank
//   until Submitted), IPRDate, CompanyID, DivisionID, BranchID,
//   CostCenterID, ProfitCenterID, Priority ('Normal'|'Urgent'),
//   NeededByDate, Description, RequestedBy, Status, Lines: [{ ItemCode,
//   WarehouseID (delivery destination once purchased — optional),
//   Description, EnteredUOMID, EnteredQuantity, CostCenterID (line
//   default from header) }], CreatedAt/By, UpdatedAt/By, SubmittedAt/By,
//   ClosedAt/By, CancelledAt/By }

function getInventoryPurchaseRequisitionEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'INVENTORYPURCHASEREQUISITION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Inventory Purchase Requisition.');
  }
  const data = firebaseDbRequest_('inventoryPurchaseRequisitions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ IPRID: id }, data[id]))
    .filter(ipr => userCanAccessCompany_(user.profile, ipr.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;
  return { entries: capped, total: all.length };
}

function saveDraftInventoryPurchaseRequisition(idToken, header) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'INVENTORYPURCHASEREQUISITION');

    const orgUnits = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
    const companyId = String(header.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company for this requisition.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const costCenterId = String(header.CostCenterID || '').trim();
    if (!costCenterId) throw new Error('Select a Cost Center (requesting department) for this requisition.');
    if (!orgUnits[costCenterId] || orgUnits[costCenterId].Type !== 'CostCenter') throw new Error('Unknown Cost Center.');
    const priority = String(header.Priority || 'Normal').trim();
    if (priority !== 'Normal' && priority !== 'Urgent') throw new Error('Priority must be Normal or Urgent.');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemByCode = {};
    Object.keys(itemsData).forEach(id => { itemByCode[itemsData[id].ItemCode] = Object.assign({ ItemID: id }, itemsData[id]); });

    // Deliberately no Category/type restriction on which items are
    // eligible — confirmed explicitly: any item can appear on this
    // requisition, unlike Purchase Requisition's category system.
    const lines = (header.Lines || [])
      .filter(l => String(l.ItemCode || '').trim())
      .map(l => {
        const itemCode = String(l.ItemCode).trim();
        const item = itemByCode[itemCode];
        if (!item || item.Status !== 'Active') throw new Error('One or more lines reference an unknown or inactive item: ' + itemCode);
        const quantity = Number(l.EnteredQuantity);
        if (!(quantity > 0)) throw new Error('Every line needs a quantity greater than zero.');
        return {
          ItemCode: itemCode, WarehouseID: String(l.WarehouseID || '').trim(),
          Description: String(l.Description || '').trim(),
          EnteredUOMID: String(l.EnteredUOMID || item.UOMID || '').trim(),
          EnteredQuantity: quantity,
          CostCenterID: String(l.CostCenterID || costCenterId).trim()
        };
      });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = {
      IPRDate: header.IPRDate || '', CompanyID: companyId,
      DivisionID: String(header.DivisionID || '').trim(), BranchID: String(header.BranchID || '').trim(),
      CostCenterID: costCenterId, ProfitCenterID: String(header.ProfitCenterID || '').trim(),
      Priority: priority, NeededByDate: header.NeededByDate || '',
      Description: String(header.Description || '').trim(),
      Lines: lines, UpdatedAt: now, UpdatedBy: actor
    };

    const iprId = String(header.IPRID || '').trim();
    if (iprId) {
      const existing = firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'get', null, idToken);
      if (!existing) throw new Error('Requisition not found.');
      // Rejected is editable too now — same reasoning as Purchase
      // Requisition's own identical fix.
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a Draft or Rejected requisition can be edited.');
      firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'patch', fields, idToken);
      return { success: true, iprId: iprId };
    }

    const newId = 'IPR-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('inventoryPurchaseRequisitions/' + newId, 'put', Object.assign({}, fields, {
      IPRNumber: '', Status: 'Draft', RequestedBy: actor, CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, iprId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function submitInventoryPurchaseRequisition(idToken, iprId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'INVENTORYPURCHASEREQUISITION');
    const existing = firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a Draft or Rejected requisition can be submitted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('Add at least one line before submitting.');

    const year = (new Date(existing.IPRDate)).getFullYear() || new Date().getFullYear();
    const iprNumber = generateVoucherNumber_(idToken, 'IPR', year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'INVENTORYPURCHASEREQUISITION', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'INVENTORYPURCHASEREQUISITION', iprId, iprNumber, scopeKey, 0, user.uid);

    const fields = {
      IPRNumber: iprNumber, RejectionReason: '', SubmittedAt: now, SubmittedBy: actor,
      UpdatedAt: now, UpdatedBy: actor
    };
    if (approval.required) {
      fields.Status = 'PendingApproval'; fields.ApprovalInstanceID = approval.instanceId;
    } else {
      fields.Status = 'Submitted';
    }
    firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'patch', fields, idToken);
    return { success: true, iprNumber: iprNumber, status: fields.Status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function decideInventoryPurchaseRequisitionApproval(idToken, iprId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'INVENTORYPURCHASEREQUISITION');
    const existing = firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'get', null, idToken);
    if (existing && !userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const result = decideApprovalForDocument_(idToken, 'inventoryPurchaseRequisitions', iprId, levelNumber, decision, reason, 'Submitted');
    return Object.assign({ success: true }, result);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function closeInventoryPurchaseRequisition(idToken, iprId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'INVENTORYPURCHASEREQUISITION');
    const existing = firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'Submitted') throw new Error('Only a Submitted requisition can be closed.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'patch', {
      Status: 'Closed', ClosedAt: now, ClosedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cancelInventoryPurchaseRequisition(idToken, iprId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'INVENTORYPURCHASEREQUISITION');
    const existing = firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (['Draft', 'Submitted', 'PendingApproval', 'Rejected'].indexOf(existing.Status) === -1) {
      throw new Error('This requisition can no longer be cancelled.');
    }
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'patch', {
      Status: 'Cancelled', CancelledAt: now, CancelledBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteDraftInventoryPurchaseRequisition(idToken, iprId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'INVENTORYPURCHASEREQUISITION');
    const existing = firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft requisition can be deleted.');
    firebaseDbRequest_('inventoryPurchaseRequisitions/' + iprId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// STOCK RESERVATION SUBSYSTEM
// ============================================================
// Foundational to Sales Order / Job Order Request's upcoming
// availability-checking design (confirmed across a design discussion,
// not yet built as screens) — everything after this depends on it, so
// it comes first and stands on its own, with no dedicated module
// screen of its own. Introduces the one concept the stock ledger never
// had: the difference between what's physically on hand and what's
// actually free to promise to a new Sales Order.
//
//   Free Stock = On-Hand Quantity − sum of Active reservations
//
// Confirmed reservation lifecycle (this subsystem provides the
// generic primitives; WHEN to call them is each source module's own
// business logic, built later):
//   - Created when a Sales Order confirms and stock is available (for
//     the available portion only — a shortfall gets NO reservation
//     record; it's just implied by ordered > reserved until Job Order
//     production later allocates against it)
//   - Created again, via FIFO allocation, as linked Job Order lines
//     produce the shortfall (built when Job Order Request is
//     redesigned — needs the JO-line-to-SO-line link that doesn't
//     exist yet)
//   - Released in full — including any portion already produced and
//     allocated — when the source Sales Order is cancelled; the freed
//     stock becomes available again immediately, no distinction
//     between "was always on hand" and "was just produced for this"
//   - NEVER released by a future Delivery/Shipment step — that step
//     CONSUMES the reservation permanently (goods gone) rather than
//     releasing it back to available. Delivery doesn't exist yet, so
//     nothing here calls that path; noted for whoever builds it.
//   - Overproduction against a Job Order line is never reserved by
//     anything — it becomes free stock the moment it posts, same as
//     any other stock receipt
//
// Deliberately follows this codebase's own established convention
// (see computeJobOrderProducedQty_'s "never trust a snapshot" comment)
// of deriving reserved quantity live from the actual reservation
// records on every read, rather than maintaining a denormalized
// running counter that could drift from what's actually reserved.
//
// Storage: /stock/reservations/{id} = { ItemID, ItemCode, WarehouseID,
//   CompanyID, Quantity, Status ('Active'|'Released'), SourceType
//   (e.g. 'SalesOrder' — kept as a field rather than hardcoded, so a
//   future source type doesn't need this subsystem touched), SourceID,
//   SourceLineID, SourceLabel (human-readable, e.g. 'SO-26-01-000004'),
//   CreatedAt, CreatedBy, ReleasedAt, ReleasedBy, ReleaseReason }

// All Active reservations for one item+warehouse, regardless of source
// — the building block getReservedQuantity_/getAvailableQuantity_ both
// sum over. Fetches the whole reservations node and filters, same
// pattern every other collection-scan function in this file already
// uses (see getJobOrderEntries, computeJobOrderProducedQty_).
function getActiveReservationsForItem_(idToken, itemId, warehouseId) {
  const data = firebaseDbRequest_('stock/reservations', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ ReservationID: id }, data[id]))
    .filter(r => r.Status === 'Active' && r.ItemID === itemId && r.WarehouseID === warehouseId);
}

function getReservedQuantity_(idToken, itemId, warehouseId) {
  return getActiveReservationsForItem_(idToken, itemId, warehouseId)
    .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
}

function getAvailableQuantity_(idToken, itemId, warehouseId) {
  const onHand = Number(getStockLedgerEntry_(idToken, itemId, warehouseId).Quantity) || 0;
  return onHand - getReservedQuantity_(idToken, itemId, warehouseId);
}

// Read-only reference for reporting/UI — mirrors getStockLedgerEntryPublic's
// own shape and access-check pattern exactly, one level up.
function getStockAvailabilityPublic(idToken, itemId, warehouseId) {
  const user = requireUser_(idToken);
  if (!itemId || !warehouseId) throw new Error('Item and warehouse are required.');
  const ledger = getStockLedgerEntry_(idToken, itemId, warehouseId);
  const onHand = Number(ledger.Quantity) || 0;
  const reserved = getReservedQuantity_(idToken, itemId, warehouseId);
  return { onHand: onHand, reserved: reserved, available: onHand - reserved };
}

// Creates exactly the reservation asked for — this is a primitive, not
// a decision-maker. Whether the requested quantity should actually be
// reserved (e.g. "only reserve what's currently available") is the
// CALLER's business logic (Sales Order confirmation, Job Order FIFO
// allocation — both built later); re-deciding that here would just be
// a second, redundant judgment call sitting on top of the caller's
// real one. This function only guarantees the record itself is valid.
function createStockReservation_(idToken, params) {
  const itemId = String(params.ItemID || '').trim();
  const warehouseId = String(params.WarehouseID || '').trim();
  const companyId = String(params.CompanyID || '').trim();
  const quantity = Number(params.Quantity);
  const sourceType = String(params.SourceType || '').trim();
  const sourceId = String(params.SourceID || '').trim();

  if (!itemId) throw new Error('Reservation requires an ItemID.');
  if (!warehouseId) throw new Error('Reservation requires a WarehouseID.');
  if (!companyId) throw new Error('Reservation requires a CompanyID.');
  if (!(quantity > 0)) throw new Error('Reservation quantity must be greater than zero.');
  if (!sourceType) throw new Error('Reservation requires a SourceType.');
  if (!sourceId) throw new Error('Reservation requires a SourceID.');

  const now = new Date().toISOString();
  const user = requireUser_(idToken);
  const actor = user.profile.username || user.uid;
  const newId = 'RSV-' + Utilities.getUuid().split('-')[0].toUpperCase();

  firebaseDbRequest_('stock/reservations/' + newId, 'put', {
    ItemID: itemId, ItemCode: String(params.ItemCode || '').trim(),
    WarehouseID: warehouseId, CompanyID: companyId, Quantity: quantity,
    Status: 'Active', SourceType: sourceType, SourceID: sourceId,
    SourceLineID: String(params.SourceLineID || '').trim(),
    SourceLabel: String(params.SourceLabel || '').trim(),
    // Traces this reservation back to the specific Production Entry
    // that created it via allocation (blank for a direct SO-confirm
    // reservation, or a Claim, neither of which come from production)
    // — lets a later reversal of that exact posting find and undo
    // only its own contribution, never a different posting's.
    CreatedByProductionID: String(params.CreatedByProductionID || '').trim(),
    // Free-text justification — required by the CALLER for anything
    // discretionary (Claim/Release), optional here since this
    // primitive doesn't second-guess why it's being asked to reserve,
    // same as it doesn't second-guess how much.
    Reason: String(params.Reason || '').trim(),
    CreatedAt: now, CreatedBy: actor
  }, idToken);

  return newId;
}

// Marks one reservation Released — the stock it held becomes available
// again immediately. Idempotent-safe: releasing an already-Released
// reservation is a no-op error rather than silently double-processing.
function releaseStockReservation_(idToken, reservationId, reason) {
  const existing = firebaseDbRequest_('stock/reservations/' + reservationId, 'get', null, idToken);
  if (!existing) throw new Error('Reservation not found.');
  if (existing.Status !== 'Active') throw new Error('Only an Active reservation can be released.');

  const now = new Date().toISOString();
  const user = requireUser_(idToken);
  const actor = user.profile.username || user.uid;

  firebaseDbRequest_('stock/reservations/' + reservationId, 'patch', {
    Status: 'Released', ReleasedAt: now, ReleasedBy: actor,
    ReleaseReason: String(reason || '').trim()
  }, idToken);
}

// Reduces one reservation's Quantity by a given amount WITHOUT fully
// releasing it — the primitive a partial Release (e.g. release 15 of a
// 30-unit reservation) needs, since releaseStockReservation_ is only
// ever all-or-nothing on one record. If the reduction consumes the
// entire remaining quantity, this defers to a full release instead of
// leaving a Quantity: 0 "Active" record sitting around.
function reduceStockReservationQuantity_(idToken, reservationId, reduceBy, reason) {
  const existing = firebaseDbRequest_('stock/reservations/' + reservationId, 'get', null, idToken);
  if (!existing) throw new Error('Reservation not found.');
  if (existing.Status !== 'Active') throw new Error('Only an Active reservation can be reduced.');
  if (!(reduceBy > 0)) throw new Error('Reduction amount must be greater than zero.');
  if (reduceBy > Number(existing.Quantity)) throw new Error('Cannot reduce a reservation by more than its own quantity.');

  if (reduceBy === Number(existing.Quantity)) {
    releaseStockReservation_(idToken, reservationId, reason);
    return;
  }

  const now = new Date().toISOString();
  const user = requireUser_(idToken);
  const actor = user.profile.username || user.uid;
  firebaseDbRequest_('stock/reservations/' + reservationId, 'patch', {
    Quantity: Number(existing.Quantity) - reduceBy, UpdatedAt: now, UpdatedBy: actor
  }, idToken);
}

// Every reservation (Active or Released) tied to one source document —
// the primitive a future Sales Order cancellation calls to find
// everything of its own to release, and useful for audit/debugging
// regardless of source type.
function getReservationsForSource_(idToken, sourceType, sourceId) {
  const data = firebaseDbRequest_('stock/reservations', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ ReservationID: id }, data[id]))
    .filter(r => r.SourceType === sourceType && r.SourceID === sourceId);
}

// ============================================================
// PRICE LISTING
// ============================================================
// Confirmed design: exactly two lists for now (Local -> AED, Export ->
// USD), auto-derived from a customer's own Classification field on
// Customer Master (which already uses the identical 'Local'/'Export'
// enum — no new vocabulary introduced, this just plugs into it). Kept
// general rather than hardcoded to exactly two, since more price list
// types (interstate, etc.) were named as a real future need — a list's
// CustomerClassificationMapping is what makes it auto-selectable; a
// list with no mapping still exists and can be used, just never
// auto-picked for a customer.
//
// Lines carry price HISTORY the same way BOM carries recipe history —
// EffectiveFrom-dated versions, never overwritten in place; a genuine
// price change is a NEW line, resolved by getPriceEffectiveOnDate_
// exactly like getBomEffectiveOnDate_ resolves a recipe version. This
// is deliberate, not incidental: Sales Order (built next) needs to
// know what a price WAS on a given order's date, not just what it is
// today.
//
// Storage: /priceLists/{id} = { Name, CustomerClassificationMapping
//   ('Local'|'Export'|'' — '' means not auto-selected), CurrencyID,
//   CompanyID, Status ('Active'|'Inactive'), CreatedAt/By, UpdatedAt/By }
// Storage: /priceListLines/{id} = { PriceListID, ItemCode, UnitPrice,
//   EffectiveFrom, Status ('Active'|'Inactive'), CreatedAt/By, UpdatedAt/By }

// Ungated reference read (requireUser_ only, no CURRENCYCONFIG access
// check) — mirrors getActiveItems' own pattern exactly. A Price List
// user picking a currency at creation time has no reason to also hold
// Currency Configuration's own module access.
function getActiveCurrencies(idToken) {
  requireUser_(idToken);
  const data = firebaseDbRequest_('currencies', 'get', null, idToken) || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .map(id => ({ CurrencyID: id, Code: data[id].Code, Name: data[id].Name, Symbol: data[id].Symbol || '' }));
}

function getPriceLists(idToken) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PRICELISTING', 'access', user.profile.role)) {
    throw new Error('You do not have access to Price Listing.');
  }
  const data = firebaseDbRequest_('priceLists', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ PriceListID: id }, data[id]))
    .filter(pl => userCanAccessCompany_(user.profile, pl.CompanyID));
}

function savePriceList(idToken, header) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PRICELISTING', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Price Listing.');
    }

    const companyId = String(header.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const name = String(header.Name || '').trim();
    if (!name) throw new Error('Enter a name for this price list.');
    const currencyId = String(header.CurrencyID || '').trim();
    if (!currencyId) throw new Error('Select a currency.');
    const currency = firebaseDbRequest_('currencies/' + currencyId, 'get', null, idToken);
    if (!currency || currency.Status !== 'Active') throw new Error('Selected currency is not active.');
    const mapping = String(header.CustomerClassificationMapping || '').trim();
    if (mapping && mapping !== 'Local' && mapping !== 'Export') {
      throw new Error('Classification mapping must be Local, Export, or left unset.');
    }

    const priceListId = String(header.PriceListID || '').trim();

    // Auto-derivation only works if exactly one ACTIVE list claims a
    // given classification per company — enforce that here rather than
    // leaving it to whichever list Sales Order happens to find first.
    if (mapping) {
      const existingLists = firebaseDbRequest_('priceLists', 'get', null, idToken) || {};
      const conflict = Object.keys(existingLists).find(id =>
        id !== priceListId &&
        existingLists[id].CompanyID === companyId &&
        existingLists[id].Status !== 'Inactive' &&
        existingLists[id].CustomerClassificationMapping === mapping
      );
      if (conflict) {
        throw new Error('"' + existingLists[conflict].Name + '" is already mapped to ' + mapping + ' for this company — only one active list can auto-apply per classification.');
      }
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = {
      Name: name, CustomerClassificationMapping: mapping, CurrencyID: currencyId,
      CompanyID: companyId, UpdatedAt: now, UpdatedBy: actor
    };

    if (priceListId) {
      const existing = firebaseDbRequest_('priceLists/' + priceListId, 'get', null, idToken);
      if (!existing) throw new Error('Price list not found.');
      firebaseDbRequest_('priceLists/' + priceListId, 'patch', fields, idToken);
      return { success: true, priceListId: priceListId };
    }

    const newId = 'PL-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('priceLists/' + newId, 'put', Object.assign({}, fields, {
      Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, priceListId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivatePriceList(idToken, priceListId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PRICELISTING', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Price Listing.');
    }
    const existing = firebaseDbRequest_('priceLists/' + priceListId, 'get', null, idToken);
    if (!existing) throw new Error('Price list not found.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('priceLists/' + priceListId, 'patch', { Status: 'Inactive', UpdatedAt: now, UpdatedBy: actor }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reactivatePriceList(idToken, priceListId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PRICELISTING', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Price Listing.');
    }
    const existing = firebaseDbRequest_('priceLists/' + priceListId, 'get', null, idToken);
    if (!existing) throw new Error('Price list not found.');

    // Reactivating must not silently create a second active claim on
    // the same classification — same uniqueness rule savePriceList enforces.
    if (existing.CustomerClassificationMapping) {
      const allLists = firebaseDbRequest_('priceLists', 'get', null, idToken) || {};
      const conflict = Object.keys(allLists).find(id =>
        id !== priceListId &&
        allLists[id].CompanyID === existing.CompanyID &&
        allLists[id].Status !== 'Inactive' &&
        allLists[id].CustomerClassificationMapping === existing.CustomerClassificationMapping
      );
      if (conflict) {
        throw new Error('"' + allLists[conflict].Name + '" already actively claims ' + existing.CustomerClassificationMapping + ' for this company — deactivate it first.');
      }
    }

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('priceLists/' + priceListId, 'patch', { Status: 'Active', UpdatedAt: now, UpdatedBy: actor }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getPriceListLines(idToken, priceListId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PRICELISTING', 'access', user.profile.role)) {
    throw new Error('You do not have access to Price Listing.');
  }
  const data = firebaseDbRequest_('priceListLines', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ LineID: id }, data[id]))
    .filter(l => l.PriceListID === priceListId)
    .sort((a, b) => (a.ItemCode || '').localeCompare(b.ItemCode || '') || (b.EffectiveFrom || '').localeCompare(a.EffectiveFrom || ''));
}

function savePriceListLine(idToken, lineData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PRICELISTING', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Price Listing.');
    }

    const priceListId = String(lineData.PriceListID || '').trim();
    if (!priceListId) throw new Error('Missing Price List reference.');
    const priceList = firebaseDbRequest_('priceLists/' + priceListId, 'get', null, idToken);
    if (!priceList) throw new Error('Price list not found.');

    const itemCode = String(lineData.ItemCode || '').trim();
    if (!itemCode) throw new Error('Select an item.');
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemEntry = Object.keys(itemsData).find(id => itemsData[id].ItemCode === itemCode);
    if (!itemEntry || itemsData[itemEntry].Status !== 'Active') throw new Error('Item not found or inactive: ' + itemCode);

    const unitPrice = Number(lineData.UnitPrice);
    if (!(unitPrice > 0)) throw new Error('Unit price must be greater than zero.');
    const effectiveFrom = String(lineData.EffectiveFrom || '').trim();
    if (!effectiveFrom) throw new Error('Effective From date is required.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = { PriceListID: priceListId, ItemCode: itemCode, UnitPrice: unitPrice, EffectiveFrom: effectiveFrom, UpdatedAt: now, UpdatedBy: actor };

    const lineId = String(lineData.LineID || '').trim();
    if (lineId) {
      const existing = firebaseDbRequest_('priceListLines/' + lineId, 'get', null, idToken);
      if (!existing) throw new Error('Price line not found.');
      firebaseDbRequest_('priceListLines/' + lineId, 'patch', fields, idToken);
      return { success: true, lineId: lineId };
    }

    const newId = 'PLL-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('priceListLines/' + newId, 'put', Object.assign({}, fields, {
      Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, lineId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivatePriceListLine(idToken, lineId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'PRICELISTING', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Price Listing.');
    }
    const existing = firebaseDbRequest_('priceListLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Price line not found.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('priceListLines/' + lineId, 'patch', { Status: 'Inactive', UpdatedAt: now, UpdatedBy: actor }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Mirrors getBomEffectiveOnDate_ exactly — finds the latest version of
// an item's price on a given list that was effective on or before the
// given date. linesByItem groups every line (any status) by ItemCode,
// same shape groupBomsByParent_ builds for BOM.
function getPriceEffectiveOnDate_(linesByItem, itemCode, date) {
  const versions = linesByItem[itemCode];
  if (!versions || !versions.length) return null;
  let match = null;
  versions.forEach(v => {
    const effFrom = v.EffectiveFrom || '';
    if (effFrom && effFrom <= date && (!match || effFrom > (match.EffectiveFrom || ''))) match = v;
  });
  return match;
}

function groupPriceListLinesByItem_(idToken, priceListId) {
  const data = firebaseDbRequest_('priceListLines', 'get', null, idToken) || {};
  const grouped = {};
  Object.keys(data).forEach(id => {
    const line = data[id];
    if (line.PriceListID !== priceListId || line.Status !== 'Active') return;
    if (!grouped[line.ItemCode]) grouped[line.ItemCode] = [];
    grouped[line.ItemCode].push(Object.assign({ LineID: id }, line));
  });
  return grouped;
}

// The auto-derivation itself, ready for Sales Order to call: given a
// company and a customer's Classification, finds the one Active price
// list mapped to it. Returns null if none is mapped (a Sales Order
// would then need a manual price list choice — not this function's
// concern).
function resolvePriceListForClassification_(idToken, companyId, classification) {
  if (!classification) return null;
  const data = firebaseDbRequest_('priceLists', 'get', null, idToken) || {};
  const matchId = Object.keys(data).find(id =>
    data[id].CompanyID === companyId &&
    data[id].Status === 'Active' &&
    data[id].CustomerClassificationMapping === classification
  );
  return matchId ? Object.assign({ PriceListID: matchId }, data[matchId]) : null;
}

// "Sellable" is deliberately defined by real, assigned data — has this
// item EVER had a price set on ANY price list — rather than a
// hardcoded item Category check. This decouples what's sellable from
// how an item happens to be classified in Item Master: if a company
// wants to sell a Semi-Finished Good or even a Raw Material as a
// trading item, giving it a price is what makes it sellable, not
// reclassifying it. Any status, any effective date, any price list —
// once a price has been assigned at all, the item counts.
function getSellableItemCodes_(idToken) {
  const linesData = firebaseDbRequest_('priceListLines', 'get', null, idToken) || {};
  const codes = new Set();
  Object.values(linesData).forEach(line => { if (line.ItemCode) codes.add(line.ItemCode); });
  return codes;
}

// Public wrapper for Sales Order's own item picker — mirrors
// getActiveItems' shape exactly, just pre-filtered to sellable items.
function getSellableItems(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const sellableCodes = getSellableItemCodes_(idToken);
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => sellableCodes.has(data[id].ItemCode))
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({
      ItemID: id, ItemCode: data[id].ItemCode, ItemName: data[id].ItemName,
      Category: data[id].Category, UOMID: data[id].UOMID, AltUOMID: data[id].AltUOMID || '',
      ConversionFactor: data[id].ConversionFactor || 0, CompanyID: data[id].CompanyID || '',
      DefaultWarehouseID: data[id].DefaultWarehouseID || ''
    }));
}

// ============================================================
// SALES ORDER
// ============================================================
// The first real caller of both the Stock Reservation subsystem and
// Price Listing — confirmed design across a multi-part discussion:
//
// PRICING: price list auto-derives from the customer's own
// Classification via resolvePriceListForClassification_ (already
// built) — a customer never picks a price list directly. Each line's
// price resolves from that list on the SO's OWN date via
// getPriceEffectiveOnDate_ (already built), then is SNAPSHOTTED onto
// the line — same principle as GRN capturing UnitCost at receipt
// time rather than deriving it live forever after. The resolved price
// pre-fills but stays editable — real sales negotiate off list price,
// and nothing in the confirmed design said otherwise; only which
// PRICE LIST applies was said to be non-negotiable, not the price on
// on individual line.
//
// STOCK CHECK, on Confirm only (never on Draft save): for each line,
// reserve min(Ordered, Available) via createStockReservation_.
// Whatever's short is NOT reserved — Sales Order doesn't create a Job
// Order itself; raising one (possibly covering several Sales Orders
// with the same shortfall) is a separate, manual action Sales takes
// in Job Order Request, built next. Status becomes 'Reserved' if every
// line was fully covered, 'Partially Reserved' if any line came up
// short.
//
// CANCELLATION releases every Active reservation tied to this SO back
// to available stock — including any portion a Job Order already
// produced and allocated here, per the confirmed reservation
// lifecycle. A Draft SO has no reservations yet, so cancelling one is
// just a status change.
//
// HONEST GAP, not a silent omission: there is no 'Fulfilled' status
// yet, because there is nothing that could set it correctly — a
// Delivery/Shipment module is confirmed future work ("only then does
// Finished stock actually go out"), and until it exists there's no
// real goods-movement event to hang "Fulfilled" on. Inventing a manual
// "mark fulfilled" button now would let a reservation be abandoned
// without any stock actually having left, which is worse than not
// offering the status at all. A Confirmed Sales Order's lifecycle
// currently ends at Reserved / Partially Reserved or Cancelled.
//
// NO GL IMPACT: Sales Order records a commitment, not revenue —
// standard practice recognizes revenue at billing/delivery, not at
// order confirmation, and Billing & Revenue Recognition is its own
// unbuilt future module. Confirming a Sales Order posts nothing to
// the GL.
//
// Storage: /salesOrders/{id} = { SONumber (blank until Confirmed),
//   CustomerID, CompanyID, DivisionID, BranchID, CostCenterID,
//   ProfitCenterID, SODate, RequestedDeliveryDate, PriceListID,
//   CurrencyID, Description, Status ('Draft'|'Reserved'|'Partially
//   Reserved'|'Cancelled'), Lines: [{ LineID, ItemCode, WarehouseID,
//   OrderedQuantity, EnteredUOMID, UnitPrice, LineTotal }], Total,
//   RequestedBy, CreatedAt/By, UpdatedAt/By, ConfirmedAt/By,
//   CancelledAt/By, CancelReason }

// Public wrapper around resolvePriceListForClassification_ — the
// client calls this once a customer is picked, to know which list
// (and therefore which currency) applies before any line is priced.
function getPriceListForCustomer(idToken, companyId, customerId) {
  requireUser_(idToken);
  const customersData = firebaseDbRequest_('customers', 'get', null, idToken) || {};
  const customer = customersData[customerId];
  if (!customer) throw new Error('Customer not found.');
  return resolvePriceListForClassification_(idToken, companyId, customer.Classification || '');
}

// Public wrapper resolving one item's price on one list as of one date
// — the client calls this each time an item is picked on a line, to
// pre-fill Unit Price (which then stays editable, per the module's own
// header comment on why).
function getItemPriceOnPriceList(idToken, priceListId, itemCode, date) {
  requireUser_(idToken);
  if (!priceListId) return null;
  const linesByItem = groupPriceListLinesByItem_(idToken, priceListId);
  const match = getPriceEffectiveOnDate_(linesByItem, itemCode, date || new Date().toISOString().substring(0, 10));
  return match ? match.UnitPrice : null;
}

function getSalesOrderEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'SALESORDER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Sales Order.');
  }
  const data = firebaseDbRequest_('salesOrders', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ SOID: id }, data[id]))
    .filter(so => userCanAccessCompany_(user.profile, so.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;

  // Reserved quantity per line, computed live from actual reservation
  // records — never trusted from a stored snapshot, same principle as
  // computeJobOrderProducedQty_.
  capped.forEach(so => {
    const reservations = getReservationsForSource_(idToken, 'SalesOrder', so.SOID).filter(r => r.Status === 'Active');
    (so.Lines || []).forEach(line => {
      line.ReservedQuantity = reservations
        .filter(r => r.SourceLineID === line.LineID)
        .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
    });
  });
  return { entries: capped, total: all.length };
}

function saveDraftSalesOrder(idToken, header) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'SALESORDER');

    const orgUnits = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
    const companyId = String(header.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const costCenterId = String(header.CostCenterID || '').trim();
    if (!costCenterId) throw new Error('Select a Cost Center.');
    if (!orgUnits[costCenterId] || orgUnits[costCenterId].Type !== 'CostCenter') throw new Error('Unknown Cost Center.');

    const customerId = String(header.CustomerID || '').trim();
    if (!customerId) throw new Error('Select a Customer.');
    const customersData = firebaseDbRequest_('customers', 'get', null, idToken) || {};
    const customer = customersData[customerId];
    if (!customer || customer.Status !== 'Active') throw new Error('Customer not found or inactive.');

    const soDate = header.SODate || new Date().toISOString().substring(0, 10);
    const priceList = resolvePriceListForClassification_(idToken, companyId, customer.Classification || '');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemByCode = {};
    Object.keys(itemsData).forEach(id => { itemByCode[itemsData[id].ItemCode] = Object.assign({ ItemID: id }, itemsData[id]); });

    let total = 0;
    const lines = (header.Lines || [])
      .filter(l => String(l.ItemCode || '').trim())
      .map((l, idx) => {
        const itemCode = String(l.ItemCode).trim();
        const item = itemByCode[itemCode];
        if (!item || item.Status !== 'Active') throw new Error('Line ' + (idx + 1) + ': unknown or inactive item (' + itemCode + ').');
        const warehouseId = String(l.WarehouseID || '').trim();
        if (!warehouseId) throw new Error('Line ' + (idx + 1) + ': select a warehouse.');
        const quantity = Number(l.OrderedQuantity);
        if (!(quantity > 0)) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');
        const unitPrice = Number(l.UnitPrice) || 0;
        const lineTotal = quantity * unitPrice;
        total += lineTotal;
        // LineID is assigned once and never regenerated — reservations
        // reference it directly, so an existing line keeps the same
        // identity across edits.
        const lineId = String(l.LineID || '').trim() || ('SOL-' + Utilities.getUuid().split('-')[0].toUpperCase());
        return {
          LineID: lineId, ItemCode: itemCode, WarehouseID: warehouseId,
          OrderedQuantity: quantity, EnteredUOMID: String(l.EnteredUOMID || item.UOMID || '').trim(),
          UnitPrice: unitPrice, LineTotal: lineTotal
        };
      });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = {
      CustomerID: customerId, CompanyID: companyId,
      DivisionID: String(header.DivisionID || '').trim(), BranchID: String(header.BranchID || '').trim(),
      CostCenterID: costCenterId, ProfitCenterID: String(header.ProfitCenterID || '').trim(),
      SODate: soDate, RequestedDeliveryDate: header.RequestedDeliveryDate || '',
      PriceListID: priceList ? priceList.PriceListID : '', CurrencyID: priceList ? priceList.CurrencyID : '',
      Description: String(header.Description || '').trim(),
      Lines: lines, Total: total, UpdatedAt: now, UpdatedBy: actor
    };

    const soId = String(header.SOID || '').trim();
    if (soId) {
      const existing = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
      if (!existing) throw new Error('Sales Order not found.');
      if (existing.Status !== 'Draft') throw new Error('Only a Draft Sales Order can be edited.');
      firebaseDbRequest_('salesOrders/' + soId, 'patch', fields, idToken);
      return { success: true, soId: soId };
    }

    const newId = 'SO-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('salesOrders/' + newId, 'put', Object.assign({}, fields, {
      SONumber: '', Status: 'Draft', RequestedBy: actor, CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, soId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// The core action — stock check plus reservation, atomically, at
// confirm time. Never re-run automatically later; if stock frees up
// after a Partially Reserved confirm, covering the rest is what the
// linked Job Order's own production-allocation is for (built when Job
// Order Request is redesigned), not a re-confirm of this SO.
function confirmSalesOrder(idToken, soId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'SALESORDER');
    const existing = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
    if (!existing) throw new Error('Sales Order not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Sales Order can be confirmed.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('Add at least one line before confirming.');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemByCode = {};
    Object.keys(itemsData).forEach(id => { itemByCode[itemsData[id].ItemCode] = Object.assign({ ItemID: id }, itemsData[id]); });

    const year = (new Date(existing.SODate)).getFullYear() || new Date().getFullYear();
    const soNumber = generateVoucherNumber_(idToken, 'SO', year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    let anyShortfall = false;
    existing.Lines.forEach(line => {
      const item = itemByCode[line.ItemCode];
      if (!item) throw new Error('Line references an item that no longer exists: ' + line.ItemCode);
      const available = getAvailableQuantity_(idToken, item.ItemID, line.WarehouseID);
      const toReserve = Math.min(line.OrderedQuantity, Math.max(available, 0));
      if (toReserve < line.OrderedQuantity) anyShortfall = true;
      if (toReserve > 0) {
        createStockReservation_(idToken, {
          ItemID: item.ItemID, ItemCode: line.ItemCode, WarehouseID: line.WarehouseID, CompanyID: existing.CompanyID,
          Quantity: toReserve, SourceType: 'SalesOrder', SourceID: soId, SourceLineID: line.LineID, SourceLabel: soNumber
        });
      }
    });

    const finalStatus = anyShortfall ? 'Partially Reserved' : 'Reserved';
    firebaseDbRequest_('salesOrders/' + soId, 'patch', {
      SONumber: soNumber, Status: finalStatus, ConfirmedAt: now, ConfirmedBy: actor,
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, soNumber: soNumber, status: finalStatus };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cancelSalesOrder(idToken, soId, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'SALESORDER');
    const existing = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
    if (!existing) throw new Error('Sales Order not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status === 'Cancelled') throw new Error('This Sales Order is already Cancelled.');

    // Release every Active reservation tied to this SO — including
    // anything a linked Job Order already produced and allocated here,
    // per the confirmed reservation lifecycle. A Draft SO simply has
    // none yet, so this is a no-op loop for that case.
    const reservations = getReservationsForSource_(idToken, 'SalesOrder', soId).filter(r => r.Status === 'Active');
    reservations.forEach(r => releaseStockReservation_(idToken, r.ReservationID, 'Sales Order cancelled'));

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('salesOrders/' + soId, 'patch', {
      Status: 'Cancelled', CancelledAt: now, CancelledBy: actor, CancelReason: String(reason || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, releasedCount: reservations.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteDraftSalesOrder(idToken, soId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'SALESORDER');
    const existing = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
    if (!existing) throw new Error('Sales Order not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Sales Order can be deleted.');
    firebaseDbRequest_('salesOrders/' + soId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// CLAIM / RELEASE — confirmed design: pure FIFO can't handle a real
// business priority call (a rush order, a VIP account), so instead of
// trying to encode priority into the automatic allocation rule, Sales
// gets direct manual control over an individual line's reservation.
// Available any time a Sales Order is Reserved or Partially Reserved
// (dispatch-based locking is confirmed future work, not built yet).
// A reason is REQUIRED on both — this can visibly favor one customer
// over another, and that decision should be answerable later, same
// principle as Job Order's Stop Request already requiring one.
//
// Deliberately two separate, single-purpose actions rather than one
// "move between orders" transfer: each stays tied to exactly one
// Sales Order and leaves its own clean, independently-reasoned trail
// — why THIS order's reservation dropped, and separately, why THAT
// order's grew — rather than one opaque combined event.

// Claim can only pull from stock that's genuinely UNRESERVED right
// now — never directly from another order's existing reservation. If
// the stock a line needs is sitting inside a different order's
// reservation, that order has to Release first. Two-step and
// two-screen by design: it's what keeps this auditable and stops a
// Claim from silently outbidding someone.
function claimStockForSalesOrderLine(idToken, soId, lineId, quantity, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'SALESORDER');
    const so = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
    if (!so) throw new Error('Sales Order not found.');
    if (!userCanAccessCompany_(user.profile, so.CompanyID)) throw new Error('You do not have access to that company.');
    if (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved') throw new Error('Stock can only be claimed for a Reserved or Partially Reserved Sales Order.');
    const line = (so.Lines || []).find(l => l.LineID === lineId);
    if (!line) throw new Error('Line not found on this Sales Order.');

    const qty = Number(quantity);
    if (!(qty > 0)) throw new Error('Claim quantity must be greater than zero.');
    const reasonText = String(reason || '').trim();
    if (!reasonText) throw new Error('A reason is required to claim stock.');

    const reserved = getReservationsForSource_(idToken, 'SalesOrder', soId)
      .filter(r => r.Status === 'Active' && r.SourceLineID === lineId)
      .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
    const shortfall = Number(line.OrderedQuantity) - reserved;
    if (qty > shortfall) throw new Error('Cannot claim more than this line\'s outstanding shortfall (' + shortfall + ').');

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemEntry = Object.keys(itemsData).find(id => itemsData[id].ItemCode === line.ItemCode);
    if (!itemEntry) throw new Error('Item not found: ' + line.ItemCode);
    const available = getAvailableQuantity_(idToken, itemEntry, line.WarehouseID);
    if (qty > available) throw new Error('Not enough free stock available to claim (' + available + ' available).');

    createStockReservation_(idToken, {
      ItemID: itemEntry, ItemCode: line.ItemCode, WarehouseID: line.WarehouseID, CompanyID: so.CompanyID,
      Quantity: qty, SourceType: 'SalesOrder', SourceID: soId, SourceLineID: lineId, SourceLabel: so.SONumber,
      Reason: reasonText
    });
    refreshSalesOrderReservationStatus_(idToken, soId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Releases up to the requested quantity from this line's own Active
// reservations, oldest first — which specific record gets reduced
// first doesn't matter substantively (all fungible, same item and
// warehouse), so this just needs to be deterministic, not clever.
function releaseStockForSalesOrderLine(idToken, soId, lineId, quantity, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'SALESORDER');
    const so = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
    if (!so) throw new Error('Sales Order not found.');
    if (!userCanAccessCompany_(user.profile, so.CompanyID)) throw new Error('You do not have access to that company.');
    if (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved') throw new Error('Stock can only be released for a Reserved or Partially Reserved Sales Order.');
    const line = (so.Lines || []).find(l => l.LineID === lineId);
    if (!line) throw new Error('Line not found on this Sales Order.');

    const qty = Number(quantity);
    if (!(qty > 0)) throw new Error('Release quantity must be greater than zero.');
    const reasonText = String(reason || '').trim();
    if (!reasonText) throw new Error('A reason is required to release stock.');

    const lineReservations = getReservationsForSource_(idToken, 'SalesOrder', soId)
      .filter(r => r.Status === 'Active' && r.SourceLineID === lineId)
      .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
    const totalReserved = lineReservations.reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
    if (qty > totalReserved) throw new Error('Cannot release more than is currently reserved for this line (' + totalReserved + ').');

    let remaining = qty;
    lineReservations.forEach(r => {
      if (remaining <= 0) return;
      const toReduce = Math.min(remaining, Number(r.Quantity));
      reduceStockReservationQuantity_(idToken, r.ReservationID, toReduce, reasonText);
      remaining -= toReduce;
    });
    refreshSalesOrderReservationStatus_(idToken, soId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// JOB ORDER REQUEST (Sales <-> Production, internal "make this")
// ============================================================
// REDESIGNED from a single-item-per-JobOrder model. Confirmed design:
// each ITEM within a batch is now its own fully independent instance
// of the exact state machine the original single-item build already
// had — own Accept/Request Amendment/Stop/Completion, own Sales Order
// links. The parent BATCH is purely a creation and grouping
// convenience: submit happens once, at the batch, and fans out into N
// independent lines sharing a number prefix (JOB-26-03-000001/01,
// /02, ...) — "it will reduce to process multiple JO" was the
// explicit reasoning. Nothing about the state machine ITSELF changed
// from the original build; only its unit of work did (one line, not
// one whole document).
//
// SALES ORDER LINKAGE + FIFO ALLOCATION is genuinely new, not a
// rescope of prior logic. A Sales-triggered line records which Sales
// Order LINE(s) it exists to cover (LinkedSalesOrderLines — picked at
// line-creation time from Sales Order lines currently showing a
// shortfall). Every time Production posts against a line, the newly
// produced quantity is allocated across its linked Sales Order lines
// in FIFO order by each Sales Order's own ConfirmedAt (confirmed as
// the allocation rule) — a new stock reservation created for each,
// converting "awaiting production" into "reserved" exactly as
// designed. Any quantity left over once every linked line is fully
// covered — overproduction, or a Production-direct line with no links
// at all — is never reserved by anything; it's free stock the moment
// it posts, per the confirmed reservation lifecycle.
//
// Storage: /jobOrderBatches/{id} = { BatchNumber (blank until
//   Submitted), Origin ('Sales'|'Production'), CompanyID, DivisionID,
//   BranchID, CostCenterID, ProfitCenterID, JODate, Description,
//   Status ('Draft'|'Submitted'), RequestedBy, CreatedAt/By,
//   UpdatedAt/By, SubmittedAt/By }
// Storage: /jobOrderLines/{id} = { ParentBatchID, LineNumber,
//   SubJONumber (blank until Submitted), ItemCode, EnteredUOMID,
//   OrderedQuantity, TargetDate, Status (same values as the original
//   single-item build's state machine), LinkedSalesOrderLines: [{
//   SOID, SOLineID, SONumber }], AmendmentProposedQuantity,
//   AmendmentProposedDate, AmendmentNote, StopRequestNote,
//   CreatedAt/By, UpdatedAt/By, SubmittedAt/By, AcceptedAt/By,
//   StopRequestedAt/By, StoppedAt/By, CancelledAt/By, CompletedAt }

function getEligibleJobOrderItems(idToken) {
  const user = requireUser_(idToken);
  const data = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const boms = firebaseDbRequest_('boms', 'get', null, idToken) || {};
  const itemIdsWithActiveBom = new Set(Object.values(boms).filter(b => b.Status === 'Active').map(b => b.ParentItemID));
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => data[id].Category === 'FinishedGood' || data[id].Category === 'SemiFinishedGood')
    .filter(id => itemIdsWithActiveBom.has(id))
    .filter(id => userCanAccessCompany_(user.profile, data[id].CompanyID))
    .map(id => ({
      ItemID: id, ItemCode: data[id].ItemCode, ItemName: data[id].ItemName, Category: data[id].Category,
      UOMID: data[id].UOMID, AltUOMID: data[id].AltUOMID || '', CompanyID: data[id].CompanyID || ''
    }));
}

// Sales Order lines currently showing a shortfall for a given item —
// the picker source when a Sales-triggered Job Order line is created,
// so Sales links it to real outstanding demand rather than typing a
// Sales Order number from memory. "Shortfall" is always computed live
// (Ordered minus whatever's currently Reserved for that specific
// line), never stored.
function getSalesOrderLinesWithShortfall_(idToken, itemCode, companyId) {
  const soData = firebaseDbRequest_('salesOrders', 'get', null, idToken) || {};
  const results = [];
  Object.keys(soData).forEach(soId => {
    const so = soData[soId];
    if (so.CompanyID !== companyId) return;
    if (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved') return;
    (so.Lines || []).forEach(line => {
      if (line.ItemCode !== itemCode) return;
      const reserved = getReservationsForSource_(idToken, 'SalesOrder', soId)
        .filter(r => r.Status === 'Active' && r.SourceLineID === line.LineID)
        .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
      const shortfall = Number(line.OrderedQuantity) - reserved;
      if (shortfall > 0) {
        results.push({ SOID: soId, SONumber: so.SONumber, SOLineID: line.LineID, WarehouseID: line.WarehouseID, ShortfallQuantity: shortfall, ConfirmedAt: so.ConfirmedAt || '' });
      }
    });
  });
  return results;
}

function getEligibleJobOrderItemsForProduction(idToken) { return getEligibleJobOrderItems(idToken); }

// Produced quantity for ONE line — never stored, always summed live
// from every Production Entry posted against it, same "never trust a
// snapshot" principle as before. Matches on the line's own ID now
// (JobOrderLineID, resolved server-side by Production Entry when the
// user picks an item under a batch — see saveProductionDraft), not by
// re-deriving from item code each time.
function computeJobOrderLineProducedQty_(idToken, line) {
  const productions = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  let produced = 0;
  Object.values(productions).forEach(txn => {
    if (txn.TransactionType !== 'Production' || txn.Status !== 'Posted') return;
    // JobOrderLineID lives on each LINE, not the transaction header — a
    // single Production Entry can produce more than one item, each
    // potentially matching a different Job Order line. A reversal is
    // its own separate, Posted transaction whose lines carry the same
    // JobOrderLineID (copied over from what it's reversing) but with
    // Direction 'Out' — netting those out here is what makes a
    // reversed posting actually disappear from this total, since the
    // original posting's own Status never changes (it stays Posted
    // forever as an audit record; only a paired reversal cancels its
    // effect).
    (txn.Lines || []).forEach(l => {
      if (l.ItemCode !== line.ItemCode || l.JobOrderLineID !== line.LineID) return;
      if (l.Direction === 'In') produced += Number(l.Quantity) || 0;
      else if (l.Direction === 'Out') produced -= Number(l.Quantity) || 0;
    });
  });
  return produced;
}

// FIFO allocation — the genuinely new piece. Called with exactly the
// quantity THIS posting just produced (not the line's running total),
// since allocation happens incrementally, once per posting.
// Deliberately does NOT sort by Sales Order confirmation date (FIFO)
// — confirmed decision, since real prioritization needs a human call
// (a rush order, a VIP account) that a date-based rule can't make.
// Sales makes that call directly via claimStockForSalesOrderLine_ /
// releaseStockForSalesOrderLine_ (Release stock from a lower-priority
// order, then Claim it for the one that actually needs it first).
// This function just needs a DETERMINISTIC default when nobody's
// actively managing priority, so it walks links in the order they
// were attached to this Job Order line — simple, predictable, and
// easily corrected afterward if it picks the "wrong" order by
// business standards.
//
// createdByProductionId: threaded onto every reservation this call
// creates, so a later reversal of that SAME production posting can
// find and undo exactly its own contribution — never a different
// posting's, even if they both fed the same Sales Order line.
function allocateProducedQuantityToLinkedSalesOrders_(idToken, line, newlyProducedQty, createdByProductionId) {
  let remaining = newlyProducedQty;
  const links = line.LinkedSalesOrderLines || [];
  if (!links.length || remaining <= 0) return;

  const soData = firebaseDbRequest_('salesOrders', 'get', null, idToken) || {};
  const candidates = links
    .map(link => {
      const so = soData[link.SOID];
      if (!so || (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved')) return null;
      const soLine = (so.Lines || []).find(l => l.LineID === link.SOLineID);
      if (!soLine) return null;
      const reserved = getReservationsForSource_(idToken, 'SalesOrder', link.SOID)
        .filter(r => r.Status === 'Active' && r.SourceLineID === link.SOLineID)
        .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
      const shortfall = Number(soLine.OrderedQuantity) - reserved;
      if (shortfall <= 0) return null;
      return { SOID: link.SOID, SONumber: so.SONumber, SOLineID: link.SOLineID, WarehouseID: soLine.WarehouseID, Shortfall: shortfall };
    })
    .filter(Boolean);
  // No sort — candidates stay in the order LinkedSalesOrderLines was
  // stored, i.e. the order Sales attached them when building this line.

  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  const itemEntry = Object.keys(itemsData).find(id => itemsData[id].ItemCode === line.ItemCode);
  const itemId = itemEntry || '';

  const touchedSoIds = new Set();
  candidates.forEach(c => {
    if (remaining <= 0) return;
    const toAllocate = Math.min(remaining, c.Shortfall);
    if (toAllocate <= 0) return;
    createStockReservation_(idToken, {
      ItemID: itemId, ItemCode: line.ItemCode, WarehouseID: c.WarehouseID,
      CompanyID: soData[c.SOID].CompanyID, Quantity: toAllocate,
      SourceType: 'SalesOrder', SourceID: c.SOID, SourceLineID: c.SOLineID, SourceLabel: c.SONumber,
      CreatedByProductionID: createdByProductionId || ''
    });
    remaining -= toAllocate;
    touchedSoIds.add(c.SOID);
  });
  // Whatever's left after every linked Sales Order line is fully
  // covered is deliberately NOT reserved by anything — it's free
  // stock the moment it posts, per the confirmed lifecycle.

  // The reservation itself is the source of truth for what's actually
  // covered — but the Sales Order's own Status field is a separate,
  // stored value that nothing else here updates automatically. Without
  // this, Reserved Quantity correctly grows (readers derive it live
  // from reservations) while Status stays frozen at whatever it was
  // when the shortfall was first detected, even once every line is
  // genuinely fully reserved.
  touchedSoIds.forEach(soId => refreshSalesOrderReservationStatus_(idToken, soId));
}

// Re-derives a Sales Order's Status from what its own reservations
// actually cover right now — called whenever an allocation might have
// changed the picture. Only ever moves Partially Reserved -> Reserved
// (or leaves it as-is); never touches Draft or Cancelled, and never
// invents a "Fulfilled" transition — that still has no real trigger
// until Delivery/Shipment exists (see the module's own header comment).
function refreshSalesOrderReservationStatus_(idToken, soId) {
  const so = firebaseDbRequest_('salesOrders/' + soId, 'get', null, idToken);
  if (!so || (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved')) return;

  // "Covered" means either still reserved (waiting to ship) OR already
  // delivered (shipped and gone) — both mean this portion of the order
  // is not at risk of a shortfall. Without accounting for delivered
  // quantity here, a line that's been fully shipped (so its reservation
  // correctly shrank to zero once Delivery Note consumed it) would
  // wrongly flip the whole Sales Order back to Partially Reserved, as
  // if the shipped portion had somehow become unfulfilled again.
  const allLinesCovered = (so.Lines || []).every(soLine => {
    const reserved = getReservationsForSource_(idToken, 'SalesOrder', soId)
      .filter(r => r.Status === 'Active' && r.SourceLineID === soLine.LineID)
      .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
    const delivered = Number(soLine.DeliveredQuantity || 0);
    return (reserved + delivered) >= Number(soLine.OrderedQuantity);
  });

  const correctStatus = allLinesCovered ? 'Reserved' : 'Partially Reserved';
  if (correctStatus !== so.Status) {
    firebaseDbRequest_('salesOrders/' + soId, 'patch', { Status: correctStatus, UpdatedAt: new Date().toISOString() }, idToken);
  }
}

// The counterpart to allocateProducedQuantityToLinkedSalesOrders_ for
// stock that arrives WITHOUT a Job Order line driving it — a Stock
// Adjustment increase or a Warehouse Movement's inbound leg. Confirmed
// design: these should also auto-allocate to outstanding Sales Order
// shortfalls for the same item+warehouse, not just JO-produced stock.
// No Job Order link means no natural "attachment order" to walk, so
// this scans every Sales Order line with an outstanding shortfall for
// this exact item+warehouse and orders them by Sales Order Number —
// simple and deterministic, not meant to encode real priority (same
// as the JO-linked version, Claim/Release is the tool for that).
function allocateAvailableStockToShortfalls_(idToken, itemId, itemCode, warehouseId, companyId, newlyAvailableQty, sourceLabel) {
  let remaining = newlyAvailableQty;
  if (!(remaining > 0)) return;

  const soData = firebaseDbRequest_('salesOrders', 'get', null, idToken) || {};
  const candidates = [];
  Object.keys(soData).forEach(soId => {
    const so = soData[soId];
    if (so.CompanyID !== companyId) return;
    if (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved') return;
    (so.Lines || []).forEach(soLine => {
      if (soLine.ItemCode !== itemCode || soLine.WarehouseID !== warehouseId) return;
      const reserved = getReservationsForSource_(idToken, 'SalesOrder', soId)
        .filter(r => r.Status === 'Active' && r.SourceLineID === soLine.LineID)
        .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
      const shortfall = Number(soLine.OrderedQuantity) - reserved;
      if (shortfall > 0) candidates.push({ SOID: soId, SONumber: so.SONumber || '', SOLineID: soLine.LineID, Shortfall: shortfall });
    });
  });
  candidates.sort((a, b) => a.SONumber.localeCompare(b.SONumber));

  const touchedSoIds = new Set();
  candidates.forEach(c => {
    if (remaining <= 0) return;
    const toAllocate = Math.min(remaining, c.Shortfall);
    if (toAllocate <= 0) return;
    createStockReservation_(idToken, {
      ItemID: itemId, ItemCode: itemCode, WarehouseID: warehouseId, CompanyID: companyId,
      Quantity: toAllocate, SourceType: 'SalesOrder', SourceID: c.SOID, SourceLineID: c.SOLineID,
      SourceLabel: c.SONumber, Reason: 'Auto-allocated from ' + (sourceLabel || 'a stock increase')
    });
    remaining -= toAllocate;
    touchedSoIds.add(c.SOID);
  });
  touchedSoIds.forEach(soId => refreshSalesOrderReservationStatus_(idToken, soId));
}

// Called after a Production Entry linked to a Job Order line
// successfully posts (or is reversed — see rollbackJobOrderLineAfterReversal_
// for that direction specifically). Same status-transition rules as
// the original single-item build (completion checked first, takes
// precedence over a pending Stop Request; terminal statuses never
// change automatically), now scoped to one line, plus triggers
// allocation to whatever Sales Orders this line is linked to (see that
// function's own comment on why this is no longer FIFO-ordered).
function updateJobOrderLineProgressAfterProduction_(idToken, lineId, newlyProducedQty, createdByProductionId) {
  const line = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
  if (!line) return;
  line.LineID = lineId;
  if (line.Status === 'Stopped' || line.Status === 'Cancelled' || line.Status === 'Completed') return;

  allocateProducedQuantityToLinkedSalesOrders_(idToken, line, newlyProducedQty, createdByProductionId);

  const produced = computeJobOrderLineProducedQty_(idToken, line);
  const now = new Date().toISOString();

  if (produced >= line.OrderedQuantity) {
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', { Status: 'Completed', CompletedAt: now, UpdatedAt: now }, idToken);
    return;
  }
  if (line.Status === 'Accepted' || line.Status === 'Open') {
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', { Status: 'In Progress', UpdatedAt: now }, idToken);
  }
}

// The reversal counterpart. A reversed Production Entry's original
// record never changes its own Status (it stays Posted forever as an
// audit trail; the reversal is a separate, paired transaction) — so
// nothing here re-triggers the forward function above. This handles
// three things a reversal needs that a new posting never does: produced
// quantity can go DOWN (possibly below the Completed threshold, or all
// the way to zero), reservations that this specific posting created via
// allocation need to be released (not just any reservation on the
// affected Sales Order — only this posting's own contribution, found
// via CreatedByProductionID), and the Sales Order's own Status needs
// re-checking afterward, same as the forward path.
function rollbackJobOrderLineAfterReversal_(idToken, lineId, reversedProductionId) {
  const line = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
  if (!line) return;
  line.LineID = lineId;

  // Release exactly this posting's own contribution — never a
  // different posting's, even if they fed the same Sales Order line.
  const data = firebaseDbRequest_('stock/reservations', 'get', null, idToken) || {};
  const touchedSoIds = new Set();
  Object.keys(data).forEach(resId => {
    const r = data[resId];
    if (r.Status !== 'Active' || r.CreatedByProductionID !== reversedProductionId) return;
    releaseStockReservation_(idToken, resId, 'Production Entry reversed');
    if (r.SourceType === 'SalesOrder') touchedSoIds.add(r.SourceID);
  });
  touchedSoIds.forEach(soId => refreshSalesOrderReservationStatus_(idToken, soId));

  // Terminal statuses (Stopped/Cancelled) never reopen from a
  // reversal — a deliberate human decision stays final regardless of
  // what happens to produced quantity afterward. Pending
  // Acceptance/Amendment Requested/Stop Requested are also left
  // alone; none of those are production-derived states.
  if (line.Status === 'Stopped' || line.Status === 'Cancelled') return;

  const produced = computeJobOrderLineProducedQty_(idToken, line);
  const now = new Date().toISOString();

  if (line.OrderedQuantity > 0 && produced >= line.OrderedQuantity) {
    if (line.Status !== 'Completed') {
      firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', { Status: 'Completed', CompletedAt: now, UpdatedAt: now }, idToken);
    }
    return;
  }

  if (['Accepted', 'Open', 'In Progress', 'Completed'].indexOf(line.Status) === -1) return;

  // No longer meets the Completed threshold, or produced dropped back
  // to (or stayed at) zero — step back down to whatever's accurate.
  // Origin decides the pre-production starting point (Sales lines
  // start at Accepted, Production-direct at Open), same rule
  // submitJobOrderBatch itself used originally.
  const batch = firebaseDbRequest_('jobOrderBatches/' + line.ParentBatchID, 'get', null, idToken);
  const preProductionStatus = batch && batch.Origin === 'Production' ? 'Open' : 'Accepted';
  const targetStatus = produced > 0 ? 'In Progress' : preProductionStatus;

  if (targetStatus !== line.Status) {
    const fields = { Status: targetStatus, UpdatedAt: now };
    if (line.Status === 'Completed') fields.CompletedAt = null;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', fields, idToken);
  }
}

function linesForBatch_(idToken, batchId) {
  const data = firebaseDbRequest_('jobOrderLines', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ LineID: id }, data[id]))
    .filter(l => l.ParentBatchID === batchId)
    .sort((a, b) => (a.LineNumber || 0) - (b.LineNumber || 0));
}

// Parent-grouped view — each batch with its lines nested, for creation
// and at-a-glance status.
function getJobOrderBatches(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'JOBORDERREQUEST', 'access', user.profile.role)) {
    throw new Error('You do not have access to Job Order Request.');
  }
  const data = firebaseDbRequest_('jobOrderBatches', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ BatchID: id }, data[id]))
    .filter(b => userCanAccessCompany_(user.profile, b.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;
  capped.forEach(b => {
    b.Lines = linesForBatch_(idToken, b.BatchID);
    b.Lines.forEach(l => { l.ProducedQuantity = computeJobOrderLineProducedQty_(idToken, l); });
  });
  return { entries: capped, total: all.length };
}

// Flat, cross-batch view of every line — the actual work queue,
// filterable by status/item regardless of which batch it came from.
// Per the confirmed requirement for a "full list" alongside the
// grouped one.
function getJobOrderLinesFlat(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'JOBORDERREQUEST', 'access', user.profile.role)) {
    throw new Error('You do not have access to Job Order Request.');
  }
  const batchData = firebaseDbRequest_('jobOrderBatches', 'get', null, idToken) || {};
  const lineData = firebaseDbRequest_('jobOrderLines', 'get', null, idToken) || {};
  const all = Object.keys(lineData)
    .map(id => Object.assign({ LineID: id }, lineData[id]))
    .filter(l => {
      const batch = batchData[l.ParentBatchID];
      return batch && userCanAccessCompany_(user.profile, batch.CompanyID);
    })
    .map(l => {
      const batch = batchData[l.ParentBatchID] || {};
      return Object.assign({}, l, {
        Origin: batch.Origin, CompanyID: batch.CompanyID, BatchNumber: batch.BatchNumber,
        ProducedQuantity: computeJobOrderLineProducedQty_(idToken, l)
      });
    })
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;
  return { entries: capped, total: all.length };
}

function saveDraftJobOrderBatch(idToken, header) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'JOBORDERREQUEST');

    const orgUnits = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
    const companyId = String(header.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const costCenterId = String(header.CostCenterID || '').trim();
    if (!costCenterId) throw new Error('Select a Cost Center.');
    if (!orgUnits[costCenterId] || orgUnits[costCenterId].Type !== 'CostCenter') throw new Error('Unknown Cost Center.');
    const origin = String(header.Origin || '').trim();
    if (origin !== 'Sales' && origin !== 'Production') throw new Error('Select Sales or Production as the origin.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const batchFields = {
      Origin: origin, CompanyID: companyId,
      DivisionID: String(header.DivisionID || '').trim(), BranchID: String(header.BranchID || '').trim(),
      CostCenterID: costCenterId, ProfitCenterID: String(header.ProfitCenterID || '').trim(),
      JODate: header.JODate || '', Description: String(header.Description || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    };

    let batchId = String(header.BatchID || '').trim();
    if (batchId) {
      const existing = firebaseDbRequest_('jobOrderBatches/' + batchId, 'get', null, idToken);
      if (!existing) throw new Error('Job Order batch not found.');
      if (existing.Status !== 'Draft') throw new Error('Only a Draft batch can be edited.');
      firebaseDbRequest_('jobOrderBatches/' + batchId, 'patch', batchFields, idToken);
    } else {
      batchId = 'JOB-' + Utilities.getUuid().split('-')[0].toUpperCase();
      firebaseDbRequest_('jobOrderBatches/' + batchId, 'put', Object.assign({}, batchFields, {
        BatchNumber: '', Status: 'Draft', RequestedBy: actor, CreatedAt: now, CreatedBy: actor
      }), idToken);
    }

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const itemByCode = {};
    Object.keys(itemsData).forEach(id => { itemByCode[itemsData[id].ItemCode] = Object.assign({ ItemID: id }, itemsData[id]); });
    const boms = firebaseDbRequest_('boms', 'get', null, idToken) || {};
    const itemIdsWithActiveBom = new Set(Object.values(boms).filter(b => b.Status === 'Active').map(b => b.ParentItemID));

    // Whole batch's line set is replaced each save — matches every
    // other grid-based module's convention (client sends the current
    // full set; whatever existed before and isn't in this payload is
    // removed). Safe here because a batch's lines are ALL still Draft
    // until the batch itself is submitted.
    const existingLines = linesForBatch_(idToken, batchId);
    const incomingLineIds = new Set();

    const payloadLines = (header.Lines || []).filter(l => String(l.ItemCode || '').trim());
    payloadLines.forEach((l, idx) => {
      const itemCode = String(l.ItemCode).trim();
      const item = itemByCode[itemCode];
      if (!item || item.Status !== 'Active') throw new Error('Line ' + (idx + 1) + ': unknown or inactive item.');
      if (item.Category !== 'FinishedGood' && item.Category !== 'SemiFinishedGood') {
        throw new Error('Line ' + (idx + 1) + ': only Finished Goods or Semi-Finished Goods can have a Job Order.');
      }
      if (!itemIdsWithActiveBom.has(item.ItemID)) {
        throw new Error('Line ' + (idx + 1) + ' (' + itemCode + '): no active BOM — a Job Order line needs a recipe to produce against.');
      }
      const orderedQuantity = Number(l.OrderedQuantity);
      if (!(orderedQuantity > 0)) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');
      const targetDate = l.TargetDate || '';
      if (origin === 'Sales' && !targetDate) throw new Error('Line ' + (idx + 1) + ': Target Date is required for a Sales-triggered line.');

      const links = (l.LinkedSalesOrderLines || []).map(link => ({
        SOID: String(link.SOID || '').trim(), SOLineID: String(link.SOLineID || '').trim(), SONumber: String(link.SONumber || '').trim()
      })).filter(link => link.SOID && link.SOLineID);

      const lineFields = {
        ParentBatchID: batchId, LineNumber: idx + 1, ItemCode: itemCode,
        EnteredUOMID: String(l.EnteredUOMID || item.UOMID || '').trim(),
        OrderedQuantity: orderedQuantity, TargetDate: targetDate,
        LinkedSalesOrderLines: links, UpdatedAt: now, UpdatedBy: actor
      };

      const lineId = String(l.LineID || '').trim();
      if (lineId) {
        incomingLineIds.add(lineId);
        firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', lineFields, idToken);
      } else {
        const newLineId = 'JOL-' + Utilities.getUuid().split('-')[0].toUpperCase();
        incomingLineIds.add(newLineId);
        firebaseDbRequest_('jobOrderLines/' + newLineId, 'put', Object.assign({}, lineFields, {
          SubJONumber: '', Status: 'Draft', CreatedAt: now, CreatedBy: actor
        }), idToken);
      }
    });

    existingLines.forEach(existingLine => {
      if (!incomingLineIds.has(existingLine.LineID)) {
        firebaseDbRequest_('jobOrderLines/' + existingLine.LineID, 'delete', null, idToken);
      }
    });

    return { success: true, batchId: batchId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// The fan-out — assigns the batch number, then walks every line in
// this batch assigning its sub-number (BatchNumber + '/' + 2-digit
// line number) and its origin-appropriate starting status. Every line
// starts independently from here; nothing about them stays linked to
// the others after this point except the shared number prefix and
// (for traceability) ParentBatchID.
function submitJobOrderBatch(idToken, batchId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderBatches/' + batchId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order batch not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft batch can be submitted.');

    const lines = linesForBatch_(idToken, batchId);
    if (!lines.length) throw new Error('Add at least one line before submitting.');

    const year = (new Date(existing.JODate)).getFullYear() || new Date().getFullYear();
    const batchNumber = generateVoucherNumber_(idToken, 'JOB', year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const startingStatus = existing.Origin === 'Sales' ? 'Pending Acceptance' : 'Open';

    lines.forEach(line => {
      const subJONumber = batchNumber + '/' + String(line.LineNumber).padStart(2, '0');
      firebaseDbRequest_('jobOrderLines/' + line.LineID, 'patch', {
        SubJONumber: subJONumber, Status: startingStatus, SubmittedAt: now, SubmittedBy: actor,
        UpdatedAt: now, UpdatedBy: actor
      }, idToken);
    });

    firebaseDbRequest_('jobOrderBatches/' + batchId, 'patch', {
      BatchNumber: batchNumber, Status: 'Submitted', SubmittedAt: now, SubmittedBy: actor,
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true, batchNumber: batchNumber };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function acceptJobOrderLine(idToken, lineId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    if (existing.Status !== 'Pending Acceptance') throw new Error('Only a line Pending Acceptance can be accepted.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Accepted', AcceptedAt: now, AcceptedBy: actor,
      AmendmentProposedQuantity: null, AmendmentProposedDate: null, AmendmentNote: null,
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function requestJobOrderLineAmendment(idToken, lineId, proposedQuantity, proposedDate, note) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    if (existing.Status !== 'Pending Acceptance') throw new Error('Only a line Pending Acceptance can have an amendment requested.');
    const qty = proposedQuantity === '' || proposedQuantity === undefined || proposedQuantity === null ? null : Number(proposedQuantity);
    if (qty !== null && !(qty > 0)) throw new Error('Proposed quantity must be greater than zero.');
    const noteText = String(note || '').trim();
    if (!noteText) throw new Error('Explain what you\'d like changed.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Amendment Requested', AmendmentProposedQuantity: qty, AmendmentProposedDate: proposedDate || null,
      AmendmentNote: noteText, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function reviseAndResubmitJobOrderLine(idToken, lineId, revisedQuantity, revisedDate) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    if (existing.Status !== 'Amendment Requested') throw new Error('Only a line with a pending amendment request can be revised.');
    const qty = Number(revisedQuantity);
    if (!(qty > 0)) throw new Error('Revised quantity must be greater than zero.');
    const date = String(revisedDate || '').trim();
    if (!date) throw new Error('Revised Target Date is required.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      OrderedQuantity: qty, TargetDate: date, Status: 'Pending Acceptance',
      AmendmentProposedQuantity: null, AmendmentProposedDate: null, AmendmentNote: null,
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function withdrawJobOrderLine(idToken, lineId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    if (existing.Status !== 'Pending Acceptance' && existing.Status !== 'Amendment Requested') {
      throw new Error('Only a not-yet-accepted line can be withdrawn — once Accepted, request a Stop instead.');
    }
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Cancelled', CancelledAt: now, CancelledBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function requestJobOrderLineStop(idToken, lineId, note) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    const batch = firebaseDbRequest_('jobOrderBatches/' + existing.ParentBatchID, 'get', null, idToken);
    if (!batch || batch.Origin !== 'Sales') throw new Error('Only a Sales-triggered line can have a stop requested.');
    if (existing.Status !== 'Accepted' && existing.Status !== 'In Progress') {
      throw new Error('A stop can only be requested once the line is Accepted or In Progress.');
    }
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Stop Requested', StopRequestedAt: now, StopRequestedBy: actor,
      StopRequestNote: String(note || '').trim(), UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function acceptJobOrderLineStop(idToken, lineId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    if (existing.Status !== 'Stop Requested') throw new Error('Only a line with a pending Stop Request can be closed this way.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Stopped', StoppedAt: now, StoppedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cancelDirectJobOrderLine(idToken, lineId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order line not found.');
    const batch = firebaseDbRequest_('jobOrderBatches/' + existing.ParentBatchID, 'get', null, idToken);
    if (!batch || batch.Origin !== 'Production') throw new Error('Only a Production-direct line can be self-cancelled this way — a Sales-triggered one needs a Stop request instead.');
    if (existing.Status !== 'Open' && existing.Status !== 'In Progress') {
      throw new Error('Only an Open or In Progress line can be cancelled.');
    }
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Cancelled', CancelledAt: now, CancelledBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteDraftJobOrderBatch(idToken, batchId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'JOBORDERREQUEST');
    const existing = firebaseDbRequest_('jobOrderBatches/' + batchId, 'get', null, idToken);
    if (!existing) throw new Error('Job Order batch not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft batch can be deleted.');
    linesForBatch_(idToken, batchId).forEach(line => {
      firebaseDbRequest_('jobOrderLines/' + line.LineID, 'delete', null, idToken);
    });
    firebaseDbRequest_('jobOrderBatches/' + batchId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Minimal reference read for Production Entry's Job Order picker — the
// user picks the PARENT BATCH (confirmed design: "only the main JO
// number need to select"); which specific line gets credited resolves
// server-side from the produced item, at save/post time.
function getEligibleJobOrderBatchesForProduction(idToken, companyId) {
  const user = requireUser_(idToken);
  const batchData = firebaseDbRequest_('jobOrderBatches', 'get', null, idToken) || {};
  const eligibleLineStatuses = ['Accepted', 'Open', 'In Progress', 'Stop Requested'];
  const result = [];
  Object.keys(batchData).forEach(id => {
    const batch = batchData[id];
    if (companyId && batch.CompanyID !== companyId) return;
    if (!userCanAccessCompany_(user.profile, batch.CompanyID)) return;
    const eligibleLines = linesForBatch_(idToken, id).filter(l => eligibleLineStatuses.indexOf(l.Status) !== -1);
    if (!eligibleLines.length) return;
    result.push({
      BatchID: id, BatchNumber: batch.BatchNumber || '(unsubmitted)', CompanyID: batch.CompanyID,
      Lines: eligibleLines.map(l => ({ LineID: l.LineID, ItemCode: l.ItemCode, Status: l.Status, OrderedQuantity: l.OrderedQuantity }))
    });
  });
  return result;
}

// Public wrapper around getSalesOrderLinesWithShortfall_ — the client
// calls this while building a Sales-triggered Job Order line, to offer
// a real picker of outstanding Sales Order demand for the chosen item
// rather than asking Sales to type a Sales Order number from memory.
function getSalesOrderLineShortfallOptions(idToken, itemCode, companyId) {
  requireUser_(idToken);
  if (!itemCode || !companyId) return [];
  return getSalesOrderLinesWithShortfall_(idToken, itemCode, companyId);
}

// ============================================================
// STOCK AVAILABILITY (Sales)
// ============================================================
// Confirmed design: Sales needs a simple window onto On-Hand, Reserved,
// and Free (Available) stock — no dedicated module ID, since this is a
// read-only report, not a transactional screen with its own draft/post
// lifecycle. Gated the same way other cross-cutting reports are: any
// signed-in user with company access can view it.
//
// Free stock CAN legitimately show negative — that's not a bug to
// guard against, it's the deliberate signal confirmed for the
// "damages/movement ate into reserved stock" case: rather than
// blocking a Stock Adjustment or Warehouse Movement that drops
// on-hand below what's reserved, this screen is where that gets
// surfaced, clearly, for Sales to act on (Release from a lower-
// priority order, or raise a new Job Order Request).

// One item+warehouse combination with any of the three figures
// nonzero — every combination that's ever had stock or ever been
// reserved, not the full cartesian product of every item against
// every warehouse (which would be mostly empty noise).
function getStockAvailabilityList(idToken, companyId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'STOCKAVAILABILITY', 'access', user.profile.role)) {
    throw new Error('You do not have access to Stock Availability.');
  }
  if (!companyId) throw new Error('Select a Company.');
  if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  // Restricted to sellable items — same definition as Sales Order's own
  // item picker (has a price assigned on any price list), not a
  // hardcoded item Category check. This screen exists so Sales can see
  // what's available to promise to customers; raw materials and WIP
  // that nobody's ever priced for sale would just be noise here.
  const sellableCodes = getSellableItemCodes_(idToken);
  const companyItemIds = new Set(Object.keys(itemsData).filter(id => itemsData[id].CompanyID === companyId && sellableCodes.has(itemsData[id].ItemCode)));

  const ledgerData = firebaseDbRequest_('stock/ledger', 'get', null, idToken) || {};
  const reservationsData = firebaseDbRequest_('stock/reservations', 'get', null, idToken) || {};

  // Key every combination by itemId|warehouseId so on-hand and
  // reserved figures for the SAME combo merge into one row, whichever
  // source (ledger or reservations) it was first seen in.
  const combos = {};
  Object.keys(ledgerData).forEach(itemId => {
    if (!companyItemIds.has(itemId)) return;
    const warehouses = ledgerData[itemId] || {};
    Object.keys(warehouses).forEach(warehouseId => {
      const key = itemId + '|' + warehouseId;
      combos[key] = combos[key] || { itemId: itemId, warehouseId: warehouseId, onHand: 0, reserved: 0 };
      combos[key].onHand = Number(warehouses[warehouseId].Quantity) || 0;
    });
  });
  Object.values(reservationsData).forEach(r => {
    if (r.Status !== 'Active' || !companyItemIds.has(r.ItemID)) return;
    const key = r.ItemID + '|' + r.WarehouseID;
    combos[key] = combos[key] || { itemId: r.ItemID, warehouseId: r.WarehouseID, onHand: 0, reserved: 0 };
    combos[key].reserved += Number(r.Quantity) || 0;
  });

  const orgUnitsData = firebaseDbRequest_('orgUnits', 'get', null, idToken) || {};
  return Object.values(combos)
    .filter(c => c.onHand !== 0 || c.reserved !== 0)
    .map(c => {
      const item = itemsData[c.itemId] || {};
      const warehouse = orgUnitsData[c.warehouseId] || {};
      return {
        ItemID: c.itemId, ItemCode: item.ItemCode || '', ItemName: item.ItemName || '',
        WarehouseID: c.warehouseId, WarehouseCode: warehouse.Code || '', WarehouseName: warehouse.Name || '',
        OnHand: c.onHand, Reserved: c.reserved, Available: c.onHand - c.reserved
      };
    })
    .sort((a, b) => a.ItemCode.localeCompare(b.ItemCode) || a.WarehouseCode.localeCompare(b.WarehouseCode));
}

// ============================================================
// INVENTORY VALUATION LIST
// ============================================================
// The cost-side counterpart to Price Listing, built the same way but
// deliberately simpler: cost doesn't have an equivalent to Local/Export
// customer classification driving multiple lists, so this is ONE flat
// list of item costs per company, not a set of named lists. Item
// prices are effective-dated versions, never overwritten in place —
// same principle as Price Listing and BOM recipe versions, and for the
// same reason: Production Entry needs to know what an item's cost WAS
// on the entry's own date, not just what it is today.
//
// Scoped to "any BOM item" — items eligible to actually be produced —
// reusing getEligibleJobOrderItems' own criteria (Finished Good or
// Semi-Finished Good with an active BOM) rather than duplicating that
// logic. This is deliberately a manually-maintained reference for now;
// confirmed future work is a Cost Sheet that computes this bottom-up
// from BOM component costs instead of a person typing it in — nothing
// here assumes that exists yet.
//
// Storage: /inventoryValuationLines/{id} = { CompanyID, ItemCode,
//   UnitCost, EffectiveFrom, Status ('Active'|'Inactive'), CreatedAt/By,
//   UpdatedAt/By }

function getInventoryValuationLines(idToken, companyId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'INVENTORYVALUATION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Inventory Valuation List.');
  }
  if (!companyId) throw new Error('Select a Company.');
  if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
  const data = firebaseDbRequest_('inventoryValuationLines', 'get', null, idToken) || {};
  return Object.keys(data)
    .map(id => Object.assign({ LineID: id }, data[id]))
    .filter(l => l.CompanyID === companyId)
    .sort((a, b) => (a.ItemCode || '').localeCompare(b.ItemCode || '') || (b.EffectiveFrom || '').localeCompare(a.EffectiveFrom || ''));
}

function saveInventoryValuationLine(idToken, lineData) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'INVENTORYVALUATION', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Inventory Valuation List.');
    }
    const companyId = String(lineData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');

    const itemCode = String(lineData.ItemCode || '').trim();
    if (!itemCode) throw new Error('Select an item.');
    // Same eligibility as a Job Order line — only items that can
    // actually be produced (Finished Good or Semi-Finished Good with
    // an active BOM) belong on a production cost list.
    const eligibleItems = getEligibleJobOrderItems(idToken);
    const eligible = eligibleItems.find(i => i.ItemCode === itemCode && i.CompanyID === companyId);
    if (!eligible) throw new Error('Item not found, inactive, or has no active BOM — only items eligible for a Job Order can have a valuation line.');

    const unitCost = Number(lineData.UnitCost);
    if (!(unitCost > 0)) throw new Error('Unit cost must be greater than zero.');
    const effectiveFrom = String(lineData.EffectiveFrom || '').trim();
    if (!effectiveFrom) throw new Error('Effective From date is required.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = { CompanyID: companyId, ItemCode: itemCode, UnitCost: unitCost, EffectiveFrom: effectiveFrom, UpdatedAt: now, UpdatedBy: actor };

    const lineId = String(lineData.LineID || '').trim();
    if (lineId) {
      const existing = firebaseDbRequest_('inventoryValuationLines/' + lineId, 'get', null, idToken);
      if (!existing) throw new Error('Valuation line not found.');
      firebaseDbRequest_('inventoryValuationLines/' + lineId, 'patch', fields, idToken);
      return { success: true, lineId: lineId };
    }

    const newId = 'IVL-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('inventoryValuationLines/' + newId, 'put', Object.assign({}, fields, {
      Status: 'Active', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, lineId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deactivateInventoryValuationLine(idToken, lineId) {
  try {
    const user = requireUser_(idToken);
    if (!moduleHasCapability_(idToken, 'INVENTORYVALUATION', 'write', user.profile.role)) {
      throw new Error('You do not have permission to modify Inventory Valuation List.');
    }
    const existing = firebaseDbRequest_('inventoryValuationLines/' + lineId, 'get', null, idToken);
    if (!existing) throw new Error('Valuation line not found.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('inventoryValuationLines/' + lineId, 'patch', { Status: 'Inactive', UpdatedAt: now, UpdatedBy: actor }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function groupValuationLinesByItem_(idToken, companyId) {
  const data = firebaseDbRequest_('inventoryValuationLines', 'get', null, idToken) || {};
  const grouped = {};
  Object.keys(data).forEach(id => {
    const line = data[id];
    if (line.CompanyID !== companyId || line.Status !== 'Active') return;
    if (!grouped[line.ItemCode]) grouped[line.ItemCode] = [];
    grouped[line.ItemCode].push(Object.assign({ LineID: id }, line));
  });
  return grouped;
}

// Public wrapper Production Entry calls when an item is selected, to
// pre-fill Unit Cost (which then stays editable — same reasoning as
// Sales Order's own Unit Price: only WHICH valuation applies is
// non-negotiable, not the figure on an individual entry).
function getItemCostForProduction(idToken, companyId, itemCode, date) {
  requireUser_(idToken);
  if (!companyId || !itemCode) return null;
  const linesByItem = groupValuationLinesByItem_(idToken, companyId);
  const match = getPriceEffectiveOnDate_(linesByItem, itemCode, date || new Date().toISOString().substring(0, 10));
  return match ? match.UnitCost : null;
}

// ============================================================
// PURCHASE ORDER
// ============================================================
// The module this whole approval-gate arc was built for. Confirmed
// design across several turns:
// - A line can either come from a requisition or be entered directly.
//   The original design required every PO to originate from a
//   requisition (PR/IPR exist specifically to authorize a purchase
//   before Procurement acts); that was confirmed reversed — direct
//   entry is now supported for emergency purchases, blanket orders,
//   and similar cases where a formal requisition trail isn't
//   practical. Mixing both kinds of line on the same PO is allowed. A
//   direct line's ItemCode/CategoryID is validated at save time,
//   since nothing upstream has already checked it the way a
//   requisition-sourced line was validated when that requisition was
//   itself created.
// - Requisitions eligible for a PO are no longer restricted to the
//   PO's own Cost Center. That restriction was confirmed reversed — it
//   was blocking a real, common case: the same items requested by
//   several different departments, which Procurement had no way to
//   see or combine into one PO at all. The PO's own CostCenterID
//   remains its own independent field (still what the approval gate
//   resolves against — one PO, one unambiguous scope, unchanged), it
//   just no longer has to match, or even be present on, every
//   requisition the PO happens to pull lines from.
// - Vendor is chosen AFTER requisitions are selected, not before —
//   this system has no vendor-item catalog to auto-detect a mismatch,
//   so Procurement needs to actually see what's being combined before
//   committing to who it's being bought from. If what's selected
//   genuinely needs two vendors, that becomes two POs; a PO staying a
//   single-vendor document was never in question, only when that
//   choice gets made.
// - A selected requisition is pulled in WHOLE — every line, not a
//   subset — and is immediately Closed once the PO submits, so it
//   can never be sourced into a second PO by mistake. If a
//   requisition mixes items that genuinely need different vendors,
//   it should have been raised as separate requisitions in the first
//   place; this build doesn't support splitting one after the fact.
// - Pricing is manually entered per line — no vendor price list
//   exists or has been discussed, so none is assumed here.
// - Approval is resolved through the generic engine: submitting
//   computes the PO's own Total, resolves the right scope key for
//   however PURCHASEORDER is currently configured in Approval
//   Configuration, and only enters PendingApproval if that
//   configuration actually requires it — an unconfigured or Disabled
//   gate lets a PO go straight to Approved. This applies identically
//   whether the PO is requisition-sourced or fully direct — a direct
//   PO skips the requisition trail, not the approval gate.
// - Rejection is not terminal — Procurement can revise (only the
//   lines/prices, never which requisitions were pulled in, and never
//   adding or removing lines of any kind) and resubmit, which creates
//   a fresh approval instance; the rejected one stays in history
//   exactly as it was decided.
// - Deliberately NOT built here: any link to GRN. That's confirmed,
//   separate follow-up work — GRN still has no PO reference at all.
//
// Storage: /purchaseOrders/{id} = { PONumber (blank until Submitted),
//   VendorID, CompanyID, DivisionID, BranchID, CostCenterID,
//   ProfitCenterID, PODate, Currency (locked from the vendor's own
//   DefaultCurrency — not independently editable, since it isn't a
//   judgment call the way a price is), SourceRequisitions: [{
//   RequisitionType ('PR'|'IPR'), RequisitionID, RequisitionNumber }],
//   Lines: [{ LineID, SourceRequisitionType, SourceRequisitionID,
//   SourceLineIndex (PR/IPR lines have no LineID of their own — array
//   position is the only stable reference back to the exact source
//   line), ItemCode (IPR-sourced only), CategoryID (PR-sourced only),
//   Description, Quantity, UOM, WarehouseID (IPR-sourced only, carried
//   over from the requisition line), UnitPrice, LineTotal }], Total,
//   Status ('Draft'|'PendingApproval'|'Approved'|'Rejected'|'Closed'|
//   'Cancelled'), ApprovalInstanceID, RejectionReason (a display
//   convenience snapshotting the latest rejecting level's own reason —
//   the full trail always lives in the approval instance itself, this
//   just avoids an extra round trip to show it inline), CreatedAt/By,
//   UpdatedAt/By, SubmittedAt/By, ApprovedAt, ClosedAt/By,
//   CancelledAt/By }

function getEligibleRequisitionsForPO(idToken, companyId) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PURCHASEORDER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Purchase Order.');
  }
  if (!companyId) return { pr: [], ipr: [] };

  // No longer filtered by Cost Center — confirmed fix for a real
  // processing gap: the same items were often requested by different
  // departments, and a same-Cost-Center-only rule meant Procurement
  // couldn't see or combine them into one PO at all. The PO's own
  // CostCenterID is an independent field the PO carries for its own
  // approval scope, not something that has to match — or even be
  // present on — every requisition it happens to pull lines from.
  const prData = firebaseDbRequest_('purchaseRequisitions', 'get', null, idToken) || {};
  const pr = Object.keys(prData)
    .map(id => Object.assign({ RequisitionID: id }, prData[id]))
    .filter(r => r.Status === 'Submitted' && r.CompanyID === companyId);

  const iprData = firebaseDbRequest_('inventoryPurchaseRequisitions', 'get', null, idToken) || {};
  const ipr = Object.keys(iprData)
    .map(id => Object.assign({ RequisitionID: id }, iprData[id]))
    .filter(r => r.Status === 'Submitted' && r.CompanyID === companyId);

  return { pr: pr, ipr: ipr };
}

function getPurchaseOrderEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PURCHASEORDER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Purchase Order.');
  }
  const data = firebaseDbRequest_('purchaseOrders', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ POID: id }, data[id]))
    .filter(po => userCanAccessCompany_(user.profile, po.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}

function saveDraftPurchaseOrder(idToken, poData) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'PURCHASEORDER');
    const companyId = String(poData.CompanyID || '').trim();
    if (!companyId) throw new Error('Select a Company.');
    if (!userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    const costCenterId = String(poData.CostCenterID || '').trim();
    if (!costCenterId) throw new Error('Select a Cost Center.');
    const vendorId = String(poData.VendorID || '').trim();
    if (!vendorId) throw new Error('Select a Vendor.');

    const vendorData = firebaseDbRequest_('vendors/' + vendorId, 'get', null, idToken);
    if (!vendorData || vendorData.Status !== 'Active') throw new Error('Unknown or inactive Vendor.');

    // Confirmed reversal of the original design: a PO no longer has to
    // originate from a requisition. A line either carries a
    // SourceRequisitionID (pulled in from a Submitted PR/IPR, already
    // validated when that requisition was itself created) or is
    // entered directly — and a direct line's ItemCode/CategoryID gets
    // validated HERE, since nothing upstream has checked it yet the
    // way a requisition-sourced line already was. Mixing both kinds of
    // line on the same PO is allowed — Procurement combining an
    // approved requisition item with one urgent, un-requisitioned item
    // is a normal, legitimate case, not an edge case to special-case
    // around.
    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const categoriesData = firebaseDbRequest_('requisitionCategories', 'get', null, idToken) || {};
    const lines = (poData.Lines || []).filter(l => l.ItemCode || l.CategoryID);
    if (!lines.length) throw new Error('Add at least one line — from a requisition, or entered directly.');
    lines.forEach((l, i) => {
      // Quantity is validated for every line regardless of source —
      // it's now freely editable even on a requisition-sourced line
      // (removing a line entirely, or adjusting its quantity, is a
      // confirmed capability), and unlike Unit Price, there's no
      // legitimate "not decided yet" reason for a zero, negative, or
      // non-numeric quantity to ever sit in a draft.
      if (!(Number(l.Quantity) > 0)) throw new Error('Line ' + (i + 1) + ': quantity must be greater than zero.');
      if (!l.SourceRequisitionID) {
        if (l.ItemCode) {
          const itemMatch = Object.keys(itemsData).find(id => itemsData[id].ItemCode === l.ItemCode && itemsData[id].Status === 'Active');
          if (!itemMatch) throw new Error('Line ' + (i + 1) + ': unknown or inactive item.');
        } else {
          const cat = categoriesData[l.CategoryID];
          if (!cat || cat.Status !== 'Active') throw new Error('Line ' + (i + 1) + ': unknown or inactive category.');
        }
      }
    });

    let total = 0;
    const cleanedLines = lines.map((l, i) => {
      const qty = Number(l.Quantity);
      const price = Number(l.UnitPrice) || 0;
      const lineTotal = qty * price;
      total += lineTotal;
      return {
        LineID: l.LineID || ('POL-' + i), SourceRequisitionType: l.SourceRequisitionID ? l.SourceRequisitionType : '',
        SourceRequisitionID: l.SourceRequisitionID || '', SourceLineIndex: l.SourceRequisitionID ? l.SourceLineIndex : null,
        ItemCode: l.ItemCode || '', CategoryID: l.CategoryID || '', Description: l.Description || '',
        Quantity: qty, UOM: l.UOM || '', WarehouseID: l.WarehouseID || '',
        UnitPrice: price, LineTotal: lineTotal
      };
    });

    // Distinct source requisitions referenced by the lines, for the
    // header's own traceability list and for closing them on submit —
    // a direct line (no SourceRequisitionID) simply contributes none,
    // rather than needing to be filtered out separately here.
    const sourceMap = {};
    cleanedLines.forEach(l => { if (l.SourceRequisitionID) sourceMap[l.SourceRequisitionType + '|' + l.SourceRequisitionID] = l; });
    const sourceRequisitions = Object.keys(sourceMap).map(key => {
      const l = sourceMap[key];
      const path = l.SourceRequisitionType === 'PR' ? 'purchaseRequisitions/' : 'inventoryPurchaseRequisitions/';
      const req = firebaseDbRequest_(path + l.SourceRequisitionID, 'get', null, idToken);
      const number = req ? (l.SourceRequisitionType === 'PR' ? req.PRNumber : req.IPRNumber) : '';
      return { RequisitionType: l.SourceRequisitionType, RequisitionID: l.SourceRequisitionID, RequisitionNumber: number };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = {
      CompanyID: companyId, DivisionID: poData.DivisionID || '', BranchID: poData.BranchID || '',
      CostCenterID: costCenterId, ProfitCenterID: poData.ProfitCenterID || '',
      VendorID: vendorId, PODate: poData.PODate || '', Currency: vendorData.DefaultCurrency || '',
      SourceRequisitions: sourceRequisitions, Lines: cleanedLines, Total: total,
      UpdatedAt: now, UpdatedBy: actor
    };

    const poId = String(poData.POID || '').trim();
    if (poId) {
      const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
      if (!existing) throw new Error('Purchase Order not found.');
      if (existing.Status !== 'Draft') throw new Error('Only a Draft Purchase Order can be edited this way.');
      firebaseDbRequest_('purchaseOrders/' + poId, 'patch', fields, idToken);
      return { success: true, poId: poId };
    }

    const newId = 'PO-' + Utilities.getUuid().split('-')[0].toUpperCase();
    firebaseDbRequest_('purchaseOrders/' + newId, 'put', Object.assign({}, fields, {
      PONumber: '', Status: 'Draft', CreatedAt: now, CreatedBy: actor
    }), idToken);
    return { success: true, poId: newId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Confirmed design: if the same item (or non-stock category) with the
// same Description appears on more than one line — most commonly
// because it was requested by two different Cost Centers via separate
// requisitions, now that a PO can combine those — those lines are
// combined into one at submit time, quantity summed. Draft editing
// itself is left untouched; Procurement still sees and can adjust
// each source line individually right up until they submit — only the
// final, submitted record consolidates them, never the draft in
// progress. Unit Price on a merged line becomes a quantity-weighted
// average of its contributing lines — the only choice that doesn't
// silently discard value, since the merged line's own total exactly
// equals what the separate lines would have summed to.
function mergeMatchingPOLines_(lines) {
  const merged = [];
  const indexByKey = {};
  (lines || []).forEach(l => {
    const key = (l.ItemCode || l.CategoryID) + '|' + l.Description;
    if (indexByKey.hasOwnProperty(key)) {
      const target = merged[indexByKey[key]];
      const combinedQty = Number(target.Quantity) + Number(l.Quantity);
      const combinedValue = (Number(target.Quantity) * Number(target.UnitPrice)) + (Number(l.Quantity) * Number(l.UnitPrice));
      target.Quantity = combinedQty;
      target.UnitPrice = combinedQty > 0 ? combinedValue / combinedQty : 0;
      target.LineTotal = combinedQty * target.UnitPrice;
    } else {
      indexByKey[key] = merged.length;
      const qty = Number(l.Quantity);
      const price = Number(l.UnitPrice);
      merged.push(Object.assign({}, l, { Quantity: qty, UnitPrice: price, LineTotal: qty * price }));
    }
  });
  // Re-sequence LineIDs to match the new, possibly shorter array —
  // the old ones were just array-position labels to begin with.
  return merged.map((l, i) => Object.assign({}, l, { LineID: 'POL-' + i }));
}

function submitPurchaseOrder(idToken, poId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (!existing) throw new Error('Purchase Order not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Purchase Order can be submitted.');
    if (!existing.Lines || !existing.Lines.length) throw new Error('Add at least one line before submitting.');
    if (existing.Lines.some(l => !(l.UnitPrice > 0))) throw new Error('Every line needs a Unit Price greater than zero.');

    const mergedLines = mergeMatchingPOLines_(existing.Lines);
    const mergedTotal = mergedLines.reduce((sum, l) => sum + l.LineTotal, 0);

    const year = (new Date(existing.PODate)).getFullYear() || new Date().getFullYear();
    const poNumber = generateVoucherNumber_(idToken, 'PO', year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'PURCHASEORDER', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'PURCHASEORDER', poId, poNumber, scopeKey, mergedTotal, user.uid);

    const fields = {
      Lines: mergedLines, Total: mergedTotal,
      PONumber: poNumber, SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
    };
    if (approval.required) {
      fields.Status = 'PendingApproval';
      fields.ApprovalInstanceID = approval.instanceId;
    } else {
      fields.Status = 'Approved';
      fields.ApprovedAt = now;
    }
    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', fields, idToken);

    // Every source requisition is fully consumed by this PO (all its
    // lines were pulled in whole) — close it now so it can't
    // accidentally be sourced into a second, different PO later.
    (existing.SourceRequisitions || []).forEach(src => {
      const path = src.RequisitionType === 'PR' ? 'purchaseRequisitions/' : 'inventoryPurchaseRequisitions/';
      firebaseDbRequest_(path + src.RequisitionID, 'patch', { Status: 'Closed', ClosedAt: now, ClosedBy: actor, UpdatedAt: now, UpdatedBy: actor }, idToken);
    });

    return { success: true, poNumber: poNumber, status: fields.Status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// The approve/reject action itself — wraps the generic engine, then
// syncs the PO's own Status from whatever the instance's resulting
// status actually is, so the PO document and its approval instance
// never drift out of sync with each other.
// The client never sees its own UID directly (idToken is opaque to
// it), so it can't compare against RequiredLevels itself — this tells
// it plainly which level, if any, the CURRENT user can decide for a
// specific PO right now, so the detail view knows whether to show
// Approve/Reject at all.
// Generic — works for ANY module's approval instance, not just
// Purchase Order. Takes the instance ID directly rather than a
// module-specific document ID, since every module's own client
// already has its document's ApprovalInstanceID field once it's
// fetched that document — no need to re-fetch it here just to read
// one field back out. This is what makes it reusable across every
// future retrofit (PR, IPR, and eventually JV, CBT, GRN, etc.)
// without a near-duplicate wrapper per module.
function getMyPendingApprovalLevel(idToken, approvalInstanceId) {
  const user = requireUser_(idToken);
  if (!approvalInstanceId) return null;
  const instance = getApprovalInstance_(idToken, approvalInstanceId);
  if (!instance || instance.Status !== 'Pending') return null;
  const decidedLevels = new Set((instance.Decisions || []).map(d => d.LevelNumber));
  const mine = (instance.RequiredLevels || []).find(l => l.ApproverUserID === user.uid && !decidedLevels.has(l.LevelNumber));
  return mine ? mine.LevelNumber : null;
}

// Generic decide-approval action — the part every module's own thin
// wrapper delegates to. collectionPath is the Firebase collection the
// document itself lives under (e.g. 'purchaseOrders',
// 'purchaseRequisitions'); approvedStatus is what the document's
// Status becomes once EVERY required level has approved — this
// varies by module (Purchase Order uses 'Approved'; Purchase
// Requisition and Inventory Purchase Requisition use 'Submitted',
// since that's already their own pre-existing "fully processed"
// terminal state, and reusing it means nothing downstream — like
// getEligibleRequisitionsForPO — needs to change at all). Throws on
// error; each module's own public wrapper does its own permission
// check and try/catch around this.
// backend: optional, defaults to RTDB (every existing caller — PO, PR,
// IPR, and every stock module — passes nothing here and is completely
// unaffected). Pass 'firestore' for a Firestore-backed document (JV,
// CBT); collectionPath then means a Firestore collection name, not an
// RTDB path.
// rejectedStatus: optional, defaults to 'Rejected' — the status a
// document falls back to if this decision resolves to Rejected. Most
// callers want the standard 'Rejected' (editable, resubmittable) state,
// but some approval flows aren't really "edit and resubmit" at all —
// e.g. reopening a Closed PO is a yes/no request with nothing to edit,
// so a rejection there should fall back to 'Closed', not a generic
// 'Rejected' state that implies an edit form exists to go with it.
function decideApprovalForDocument_(idToken, collectionPath, documentId, levelNumber, decision, reason, approvedStatus, backend, rejectedStatus) {
  const useFirestore = backend === 'firestore';
  const existing = useFirestore
    ? firestoreGet_(collectionPath, documentId)
    : firebaseDbRequest_(collectionPath + '/' + documentId, 'get', null, idToken);
  if (!existing) throw new Error('Document not found.');
  if (existing.Status !== 'PendingApproval') throw new Error('This document is not awaiting approval.');
  if (!existing.ApprovalInstanceID) throw new Error('No approval record found for this document.');

  const result = recordApprovalDecision(idToken, existing.ApprovalInstanceID, levelNumber, decision, reason);
  if (!result.success) throw new Error(result.error);

  const user = requireUser_(idToken);
  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const fields = { UpdatedAt: now, UpdatedBy: actor };
  if (result.status === 'Approved') {
    fields.Status = approvedStatus;
    if (approvedStatus === 'Approved') fields.ApprovedAt = now;
  } else if (result.status === 'Rejected') {
    fields.Status = rejectedStatus || 'Rejected';
    fields.RejectionReason = String(reason || '').trim();
  }
  // Still Pending (some required levels haven't decided yet) — the
  // document itself doesn't change status until the instance resolves.
  if (fields.Status) {
    if (useFirestore) firestoreUpdate_(collectionPath, documentId, fields);
    else firebaseDbRequest_(collectionPath + '/' + documentId, 'patch', fields, idToken);
  }
  return { status: result.status, selfApproved: result.selfApproved };
}

function decidePurchaseOrderApproval(idToken, poId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (existing && !userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const result = decideApprovalForDocument_(idToken, 'purchaseOrders', poId, levelNumber, decision, reason, 'Approved');
    return Object.assign({ success: true }, result);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// After a rejection, Procurement can adjust prices/quantities on the
// existing lines and resubmit — but never add, remove, or swap which
// requisitions were pulled in; that would mean re-running the whole
// sourcing decision, which is a new PO, not a revision of this one.
function reviseAndResubmitPurchaseOrder(idToken, poId, updatedLines) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (!existing) throw new Error('Purchase Order not found.');
    if (existing.Status !== 'Rejected') throw new Error('Only a Rejected Purchase Order can be revised.');

    const existingLineIds = new Set((existing.Lines || []).map(l => l.LineID));
    let total = 0;
    const cleanedLines = (updatedLines || []).map(l => {
      if (!existingLineIds.has(l.LineID)) throw new Error('Cannot add or remove lines during a revision — only prices and quantities.');
      const original = existing.Lines.find(orig => orig.LineID === l.LineID);
      const qty = Number(l.Quantity);
      const price = Number(l.UnitPrice) || 0;
      const lineTotal = qty * price;
      total += lineTotal;
      return Object.assign({}, original, { Quantity: qty, UnitPrice: price, LineTotal: lineTotal });
    });
    if (cleanedLines.length !== existing.Lines.length) throw new Error('Every original line must be present in a revision.');
    if (cleanedLines.some(l => !(l.UnitPrice > 0))) throw new Error('Every line needs a Unit Price greater than zero.');

    const year = (new Date(existing.PODate)).getFullYear() || new Date().getFullYear();
    const poNumber = generateVoucherNumber_(idToken, 'PO', year, existing.CompanyID);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'PURCHASEORDER', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'PURCHASEORDER', poId, poNumber, scopeKey, total, user.uid);

    const fields = {
      Lines: cleanedLines, Total: total, PONumber: poNumber,
      RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
    };
    if (approval.required) {
      fields.Status = 'PendingApproval'; fields.ApprovalInstanceID = approval.instanceId;
    } else {
      fields.Status = 'Approved'; fields.ApprovedAt = now;
    }
    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', fields, idToken);
    return { success: true, status: fields.Status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cancelPurchaseOrder(idToken, poId, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (!existing) throw new Error('Purchase Order not found.');
    if (existing.Status === 'Closed' || existing.Status === 'Cancelled') {
      throw new Error('This Purchase Order is already ' + existing.Status.toLowerCase() + '.');
    }
    // Any receipt at all — even partial — means goods have already
    // physically arrived (and possibly been invoiced) against this PO.
    // Cancelling it at that point would contradict what's already
    // happened; the GRN(s) need to be reversed first, which is itself
    // a deliberate, auditable action rather than something this
    // cancellation should silently imply.
    const hasReceipts = (existing.Lines || []).some(l => Number(l.ReceivedQuantity || 0) > 0);
    if (hasReceipts) {
      throw new Error('This Purchase Order has goods received against it and cannot be cancelled. Reverse the associated GRN(s) first.');
    }
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', {
      Status: 'Cancelled', CancelledAt: now, CancelledBy: actor, CancelReason: String(reason || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function closePurchaseOrder(idToken, poId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (!existing) throw new Error('Purchase Order not found.');
    if (existing.Status !== 'Approved') throw new Error('Only an Approved Purchase Order can be closed.');
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', {
      Status: 'Closed', ClosedAt: now, ClosedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Reopening a Closed PO requires the same approval treatment as an
// original submission — deliberately, not a unilateral one-click
// action, since a Closed PO was already treated as finished business.
// Uses the CURRENT, live PURCHASEORDER approval configuration — the
// exact same gate resolution submitPurchaseOrder itself uses, not a
// frozen snapshot of whatever the gate looked like when this PO was
// first approved. If no gate is currently configured at all, this
// behaves exactly like submitting a PO with no gate: reopens straight
// to Approved, same "no gate configured means no gate" rule every
// other approval-gated action in this system already follows.
//
// Reuses the same 'PendingApproval' status a fresh submission uses
// (the shared decideApprovalForDocument_ helper only recognizes that
// one awaiting-decision state) — ReopenRequested distinguishes this
// from an original submission for display purposes without needing a
// second status value.
function requestReopenPurchaseOrder(idToken, poId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (!existing) throw new Error('Purchase Order not found.');
    if (existing.Status !== 'Closed') throw new Error('Only a Closed Purchase Order can be reopened.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'PURCHASEORDER', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = beginApprovalInstance_(idToken, 'PURCHASEORDER', poId, existing.PONumber || '', scopeKey, existing.Total || 0, user.uid);

    const fields = { ReopenRequested: true, UpdatedAt: now, UpdatedBy: actor };
    if (approval.required) {
      fields.Status = 'PendingApproval';
      fields.ApprovalInstanceID = approval.instanceId;
    } else {
      fields.Status = 'Approved';
      fields.ApprovedAt = now;
      fields.ReopenRequested = false;
    }
    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', fields, idToken);
    return { success: true, status: fields.Status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// A rejected reopen request falls back to Closed, not the generic
// 'Rejected' state a fresh submission would use — there's no edit form
// for a reopen request, nothing to revise and resubmit, so 'Rejected'
// (which implies exactly that) would be misleading here.
function decidePurchaseOrderReopenApproval(idToken, poId, levelNumber, decision, reason) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (existing && !userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const result = decideApprovalForDocument_(idToken, 'purchaseOrders', poId, levelNumber, decision, reason, 'Approved', undefined, 'Closed');
    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', { ReopenRequested: false }, idToken);
    return Object.assign({ success: true }, result);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteDraftPurchaseOrder(idToken, poId) {
  try {
    const user = requireUser_(idToken);
    requireDraftAccess_(idToken, user, 'PURCHASEORDER');
    const existing = firebaseDbRequest_('purchaseOrders/' + poId, 'get', null, idToken);
    if (!existing) throw new Error('Purchase Order not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft Purchase Order can be deleted.');
    firebaseDbRequest_('purchaseOrders/' + poId, 'delete', null, idToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}