#!/usr/bin/env node
// Mechanical port of Code.gs (Apps Script) to Cloud Functions.
//
//   node tools/legacy-port/generate.js <path-to-clasp-clone>
//
// Why mechanical: ~165 server functions (+ ~110 helpers, ~8,000 lines)
// remained after the hand-ported stock modules. Re-typing that much
// business logic by hand invites exactly the drift this migration is
// trying to avoid. Instead this keeps the original source VERBATIM
// (comments included) and changes only what must change to run on
// Node:
//
//  1. I/O primitives (firebaseDbRequest_, firestore*_, requireUser_,
//     firebaseAuthRequest_, LockService, Utilities) come from
//     functions/src/legacy/runtime.js, which reproduces their REST
//     semantics on the Admin SDK.
//  2. Helpers that already have hand-ported shared versions
//     (stock movement, GL writing, commit attempts, approvals,
//     reservations, permissions, tree/roles seeding) are routed to
//     those modules through thin adapters (MAPPED below), so there is
//     one implementation of each — including the ported improvements
//     (e.g. the atomic multi-path ledger write).
//  3. Async conversion: every function that (transitively) reaches I/O
//     becomes `async`, every call to one is `await`ed, and array
//     callbacks that became async (forEach/map/filter/...) are routed
//     through runtime.seq.* — strictly sequential, like the original.
//  4. Bug fixes are applied as documented source patches
//     (patches.js), never by editing the generated output.
//
// Outputs: functions/src/legacy/codegs.js, functions/src/legacy/callables.js
// (one callable per screen-called function; its data keys are the
// original function's own parameter names), and screens/<ID>.html
// for every module listed in modules.json (google.script.run → rpc).
'use strict';
const fs = require('fs');
const path = require('path');
const recast = require('recast');
const acornParser = require('recast/parsers/acorn');
const b = recast.types.builders;
const n = recast.types.namedTypes;

const GAS = path.resolve(process.argv[2] || '');
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO, 'functions/src/legacy');
const MODULES_OUT = path.join(REPO, 'screens');
const MODULES = require('./modules.json').modules;
// Modules whose screens are hand-maintained now: still scanned for the
// server calls they make, but their screens/<ID>.html is never
// overwritten.
const HAND_SCREENS = new Set(require('./modules.json').handScreens || []);
// codegs.js helpers that hand-written modules import (e.g. journal.js):
// always emitted, even if no generated screen reaches them any more.
const KEEP = require('./keep.json');
const PATCHES = require('./patches');

// ---- configuration ----
const RUNTIME_ASYNC = ['firebaseDbRequest_', 'firestoreGet_', 'firestoreSet_', 'firestoreUpdate_', 'firestoreAdd_',
  'firestoreDelete_', 'firestoreQuery_', 'firestoreCount_', 'requireUser_', 'firebaseAuthRequest_'];
// Replaced wholesale by runtime.js (never emitted).
const SHIMMED = new Set([...RUNTIME_ASYNC, 'firestoreRequest_', 'toFirestoreValue_', 'toFirestoreFields_', 'fromFirestoreValue_',
  'fromFirestoreFields_', 'fromFirestoreDocument_', 'throwIfFirestoreError_', 'buildFirestoreWhereClause_', 'getFirebaseApiKey_']);
// Original helper -> shared ported implementation. kind: 'dropCtx' (same args minus idToken),
// 'pure' (identical signature), 'actor' (shared takes actor = username||uid instead of idToken).
const MAPPED = {
  moduleHasCapability_: ['auth', 'moduleHasCapability', 'dropCtx'],
  ensurePermissionsSeeded_: ['auth', 'ensurePermissionsSeeded', 'dropCtx'],
  userCanAccessCompany_: ['glWriting', 'userCanAccessCompany', 'pure'],
  getUserAssignedCompanies_: ['companies', 'getUserAssignedCompanies', 'pure'],
  computeStockMovement_: ['stockMovement', 'computeStockMovement', 'dropCtx'],
  getStockLedgerEntry_: ['stockMovement', 'getStockLedgerEntry', 'dropCtx'],
  stockLedgerPath_: ['stockMovement', 'stockLedgerPath', 'pure'],
  commitStockLedgerUpdates_: ['stockMovement', 'commitStockLedgerUpdates', 'dropCtx'],
  writeStockGlEntry_: ['glWriting', 'writeStockGlEntry', 'dropCtx'],
  validateAndNormalizeLines_: ['glWriting', 'validateAndNormalizeLines', 'pure'],
  parseAmountServer_: ['glWriting', 'parseAmountServer', 'pure'],
  getCompanyRefCode_: ['glWriting', 'getCompanyRefCode', 'dropCtx'],
  generateStockVoucherNumber_: ['glWriting', 'generateStockVoucherNumber', 'dropCtx'],
  // new development: docs/modules/NUMBERING.md (every number from its format)
  generateVoucherNumber_: ['numbering', 'voucherNumber', 'dropCtx'],
  generateItemCode_: ['numbering', 'itemCode', 'dropCtx'],
  generateVendorCode_: ['numbering', 'vendorCode', 'dropCtx'],
  generateCustomerCode_: ['numbering', 'customerCode', 'dropCtx'],
  generateStockTransactionRef_: ['glWriting', 'generateStockTransactionRef', 'dropCtx'],
  beginCommitAttempt_: ['commitAttempt', 'beginCommitAttempt', 'dropCtx'],
  abandonCommitAttempt_: ['commitAttempt', 'abandonCommitAttempt', 'dropCtx'],
  finalizeCommitAttempt_: ['commitAttempt', 'finalizeCommitAttempt', 'dropCtx'],
  resolveRequiredApprovalLevels_: ['approvals', 'resolveRequiredApprovalLevels', 'dropCtx'],
  resolveApprovalScopeKeyForDocument_: ['approvals', 'resolveApprovalScopeKeyForDocument', 'dropCtx'],
  beginApprovalInstance_: ['approvals', 'beginApprovalInstance', 'dropCtx'],
  ensureCbtSplit_: ['approvals', 'ensureCbtSplit', 'dropCtx'], // new development: docs/modules/APPROVAL_ROUTING.md
  createStockReservation_: ['reservations', 'createStockReservation', 'actor'],
  getReservationsForSource_: ['reservations', 'getReservationsForSource', 'dropCtx'],
  refreshSalesOrderReservationStatus_: ['reservations', 'refreshSalesOrderReservationStatus', 'dropCtx'],
  allocateAvailableStockToShortfalls_: ['reservations', 'allocateAvailableStockToShortfalls', 'actor'],
  ensureTreeSeeded_: ['tree', 'ensureTreeSeeded', 'dropCtx'],
  ensureRolesSeeded_: ['roles', 'ensureRolesSeeded', 'dropCtx'],
  moduleIdForEntry_: ['masterData', 'moduleIdForEntry', 'pure'],
  // new development: docs/modules/PR_VISIBILITY.md (called only from patches)
  prVisibilityFor_: ['prVisibility', 'visibilityFor', 'dropCtx'],
  canSeePurchaseRequisition_: ['prVisibility', 'canSeeRequisition', 'dropCtx'],
  findAccountUsage_: ['coaUsage', 'findAccountUsage', 'dropCtx'], // docs/modules/COA_RECODE.md
  clubStockLines_: ['lineClubbing', 'clubStockLines', 'pure'], // docs/modules/LINE_CLUBBING.md
  assertPeriodOpen_: ['periodLock', 'assertOpen', 'dropCtx'] // docs/modules/PERIOD_CLOSING.md (called only from patches)
};
// Constants taken from the already-extracted shared modules (verbatim copies there).
const IMPORTED_CONSTS = {
  MODULE_REGISTRY: 'moduleRegistry', DEFAULT_PERMISSIONS: 'moduleRegistry', DEFAULT_ROLES: 'roles',
  TREE_SEED_NODES: 'treeSeedNodes', APPROVAL_GATEABLE_MODULES: 'approvalRegistry',
  FIRESTORE_JOURNAL_ENTRIES_COLLECTION: 'glWriting', STOCK_TRANSACTION_PREFIXES: 'glWriting',
  COST_CENTER_REQUIRED_TYPES: 'glWriting', DEFAULT_UOMS: 'masterData'
};
const DROPPED_CONSTS = new Set(['FIREBASE_URL', 'FIRESTORE_BASE_URL', 'FIRESTORE_PROJECT_ID']);
const SHARED_PATHS = {
  auth: '../auth', glWriting: '../glWriting', companies: '../companies', stockMovement: '../stockMovement',
  commitAttempt: '../commitAttempt', approvals: '../approvals', reservations: '../reservations',
  tree: '../tree', roles: '../roles', masterData: '../masterData', moduleRegistry: '../moduleRegistry',
  treeSeedNodes: '../treeSeedNodes', approvalRegistry: '../approvalRegistry',
  listPaging: '../listPaging', // used by name (__listPaging.) in patches
  prVisibility: '../prVisibility',
  coaUsage: '../coaUsage',
  lineClubbing: '../lineClubbing',
  numbering: '../numbering',
  periodLock: '../periodLock'
};
const COMBINATORS = new Set(['forEach', 'map', 'filter', 'find', 'findIndex', 'some', 'every', 'flatMap', 'reduce']);
const LOCK_METHODS = new Set(['waitLock', 'releaseLock', 'tryLock']);
// Functions exported by hand-written modules (never generated as callables).
const HAND_EXPORTS = new Set([...fs.readFileSync(path.join(REPO, 'functions/index.js'), 'utf8').matchAll(/^exports\.(\w+)\s*=/gm)].map(m => m[1]));

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ---- load + patch source ----
let code = fs.readFileSync(path.join(GAS, 'Code.js'), 'utf8');
for (const p of PATCHES) {
  if (!code.includes(p.find)) throw new Error('Patch "' + p.id + '" no longer matches Code.gs — review it.');
  if (code.split(p.find).length !== 2) throw new Error('Patch "' + p.id + '" matches more than once.');
  code = code.replace(p.find, p.replace);
}
const ast = recast.parse(code, { parser: { parse: (src) => acornParser.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true }) } });
const program = ast.program;
const fnNodes = {}; const constNodes = {}; const order = [];
program.body.forEach((node, idx) => {
  if (n.FunctionDeclaration.check(node)) { fnNodes[node.id.name] = node; order.push(node.id.name); }
  else if (n.VariableDeclaration.check(node)) node.declarations.forEach(d => { if (n.Identifier.check(d.id)) { constNodes[d.id.name] = node; order.push(d.id.name); } });
});

function identifiersIn(node) {
  const s = new Set();
  recast.visit(node, { visitIdentifier(p) { s.add(p.node.name); this.traverse(p); } });
  return s;
}

// ---- entries: token-first server calls in the enabled modules' screens ----
const TERNARY_CALL = /\[([^[\]]*?\?\s*['"](\w+)['"]\s*:\s*['"](\w+)['"]\s*)\]\(\s*(?:token|idToken)\b\s*(?:,([\s\S]*?))?\)(\s*;)/g;
const screenCalls = {}; // module -> [fn]
const dynamicTargets = {}; // module -> [fn] called via [var](token, ...)
const entries = new Set();
for (const mod of MODULES) {
  const html = fs.readFileSync(path.join(GAS, mod + '.html'), 'utf8');
  const names = new Set([...html.matchAll(/\.(\w+)\(\s*(token|idToken)\b/g)].map(m => m[1]));
  // Dynamic calls — google.script.run...[fnVar](token, ...) — name their
  // targets as string literals elsewhere in the screen.
  if (/\[\s*\w+\s*\]\(\s*(token|idToken)\b/.test(html)) {
    const dyn = [...html.matchAll(/['"](\w+)['"]/g)].map(m => m[1])
      .filter(x => fnNodes[x] && fnNodes[x].params[0] && /^(idToken|token)$/.test(fnNodes[x].params[0].name || ''));
    dynamicTargets[mod] = [...new Set(dyn)];
    dyn.forEach(x => names.add(x));
  }
  // Conditional calls — ...[cond ? 'fnA' : 'fnB'](token, ...) — name
  // both targets inline.
  for (const m of html.matchAll(TERNARY_CALL)) { names.add(m[2]); names.add(m[3]); }
  screenCalls[mod] = [...names];
  names.forEach(fn => { if (!HAND_EXPORTS.has(fn)) entries.add(fn); });
}
for (const e of entries) if (!fnNodes[e]) throw new Error('Screen calls ' + e + ' but Code.gs has no such function.');

// ---- closure ----
const fnSet = new Set(); const constSet = new Set();
for (const k of KEEP) if (!fnNodes[k]) throw new Error('keep.json names ' + k + ' but Code.gs has no such function.');
const stack = [...entries, ...KEEP];
while (stack.length) {
  const k = stack.pop();
  if (fnSet.has(k) || constSet.has(k) || SHIMMED.has(k) || DROPPED_CONSTS.has(k)) continue;
  if (MAPPED[k] || IMPORTED_CONSTS[k]) { (MAPPED[k] ? fnSet : constSet).add(k); continue; }
  // MAPPED too: a patch may call a shared helper Code.gs never defined.
  if (fnNodes[k]) { fnSet.add(k); identifiersIn(fnNodes[k]).forEach(r => { if (fnNodes[r] || constNodes[r] || MAPPED[r]) stack.push(r); }); }
  else if (constNodes[k]) { constSet.add(k); identifiersIn(constNodes[k]).forEach(r => { if (fnNodes[r] || constNodes[r]) stack.push(r); }); }
}
const emitted = order.filter(k => fnSet.has(k) && !MAPPED[k]);

// ---- async conversion ----
const asyncNames = new Set([...RUNTIME_ASYNC, ...Object.keys(MAPPED).filter(k => MAPPED[k][2] !== 'pure')]);
function isFn(node) { return n.Function.check(node); }
function enclosingFn(p) { let q = p.parent; while (q && !isFn(q.node)) q = q.parent; return q; }
function isSeqCall(node) {
  return n.CallExpression.check(node) && n.MemberExpression.check(node.callee) &&
    n.Identifier.check(node.callee.object) && node.callee.object.name === 'seq';
}

// Nested named helpers (function x() {...} declared inside a ported
// function) that become async: calls to them inside that same function
// get awaited too. Scoped per enclosing top-level function.
const localAsync = {}; // top-level name -> Set of nested async function names
let changed = true; let rounds = 0;
while (changed) {
  changed = false; rounds++;
  if (rounds > 50) throw new Error('async conversion did not converge');
  for (const name of emitted) {
    const root = fnNodes[name];
    recast.visit(root, {
      visitCallExpression(p) {
        this.traverse(p);
        const c = p.node.callee;
        const isAsyncCall = (n.Identifier.check(c) && (asyncNames.has(c.name) || (localAsync[name] && localAsync[name].has(c.name)))) ||
          (n.MemberExpression.check(c) && !c.computed && LOCK_METHODS.has(c.property.name));
        if (isAsyncCall && !n.AwaitExpression.check(p.parent.node)) { p.replace(b.awaitExpression(p.node)); changed = true; }
      },
      visitAwaitExpression(p) {
        this.traverse(p);
        const f = enclosingFn(p);
        if (!f) return;
        if (!f.node.async) { f.node.async = true; changed = true; }
        if (f.node === root) { if (!asyncNames.has(name)) { asyncNames.add(name); changed = true; } return; }
        // Nested function became async — its caller must cope.
        if (n.FunctionDeclaration.check(f.node) && f.node.id) {
          localAsync[name] = localAsync[name] || new Set();
          if (!localAsync[name].has(f.node.id.name)) { localAsync[name].add(f.node.id.name); changed = true; }
          return;
        }
        const call = f.parent && f.parent.node;
        if (n.CallExpression.check(call) && call.arguments[0] === f.node && n.MemberExpression.check(call.callee) &&
            !call.callee.computed && COMBINATORS.has(call.callee.property.name)) {
          const combinator = call.callee.property.name;
          const replacement = b.awaitExpression(b.callExpression(
            b.memberExpression(b.identifier('seq'), b.identifier(combinator)),
            [call.callee.object, ...call.arguments]));
          f.parent.replace(replacement); changed = true;
        } else if (!isSeqCall(call) &&
            // Already wrapped earlier in this same pass: the path's parent is now the
            // `await seq.x(arr, cb)` that replaced the original combinator call.
            !(n.AwaitExpression.check(call) && isSeqCall(call.argument) && call.argument.arguments.includes(f.node))) {
          warn(name + ': async callback in unsupported position (line ' + (f.node.loc ? f.node.loc.start.line : '?') + ')');
        }
      }
    });
  }
}
// Async functions referenced as values (not called) can't be awaited automatically.
for (const name of emitted) {
  recast.visit(fnNodes[name], {
    visitIdentifier(p) {
      const nm = p.node.name;
      if (asyncNames.has(nm) && nm !== name) {
        const par = p.parent.node;
        const isCallee = n.CallExpression.check(par) && par.callee === p.node;
        const isDeclName = isFn(par) && par.id === p.node;
        const isProp = n.MemberExpression.check(par) && par.property === p.node && !par.computed;
        const isKey = n.Property.check(par) && par.key === p.node && !par.computed;
        if (!isCallee && !isDeclName && !isProp && !isKey) warn(name + ': async function ' + nm + ' used as a value');
      }
      this.traverse(p);
    }
  });
}

// ---- emit codegs.js ----
const pr = (node) => recast.print(node).code;
const usedShared = new Set();
Object.keys(MAPPED).filter(k => fnSet.has(k)).forEach(k => usedShared.add(MAPPED[k][0]));
[...constSet].filter(k => IMPORTED_CONSTS[k]).forEach(k => usedShared.add(IMPORTED_CONSTS[k]));
Object.keys(SHARED_PATHS).filter(k => code.includes('__' + k + '.')).forEach(k => usedShared.add(k));
let out = '';
out += '// GENERATED by tools/legacy-port/generate.js from the Apps Script Code.gs.\n';
out += '// Do not edit by hand: bug fixes go in tools/legacy-port/patches.js, then\n';
out += '// regenerate. Original comments are kept verbatim below; wherever they\n';
out += '// mention UrlFetchApp/REST/LockService, the runtime.js shim now provides\n';
out += '// the same behavior on the Admin SDK.\n';
out += '/* eslint-disable */\n\'use strict\';\n';
out += 'const { firebaseDbRequest_, firestoreGet_, firestoreSet_, firestoreUpdate_, firestoreAdd_, firestoreDelete_, firestoreQuery_, firestoreCount_, requireUser_, firebaseAuthRequest_, LockService, Utilities, seq } = require(\'./runtime\');\n';
for (const s of [...usedShared].sort()) out += 'const __' + s + ' = require(\'' + SHARED_PATHS[s] + '\');\n';
out += '\n// ---- helpers routed to the hand-ported shared modules ----\n';
for (const k of Object.keys(MAPPED).filter(k => fnSet.has(k))) {
  const [mod, fn, kind] = MAPPED[k];
  if (kind === 'pure') out += 'const ' + k + ' = (...a) => __' + mod + '.' + fn + '(...a);\n';
  else if (kind === 'dropCtx') out += 'const ' + k + ' = (idToken, ...a) => __' + mod + '.' + fn + '(...a);\n';
  else if (kind === 'actor') out += 'const ' + k + ' = async (idToken, ...a) => { const u = await requireUser_(idToken); return __' + mod + '.' + fn + '(u.profile.username || u.uid, ...a); };\n';
}
out += '\n// ---- constants ----\n';
for (const k of order.filter(k => constSet.has(k))) {
  if (IMPORTED_CONSTS[k]) out += 'const { ' + k + ' } = __' + IMPORTED_CONSTS[k] + ';\n';
}
const emittedConstNodes = new Set();
for (const k of order.filter(k => constSet.has(k) && !IMPORTED_CONSTS[k])) {
  const node = constNodes[k];
  if (emittedConstNodes.has(node)) continue; emittedConstNodes.add(node);
  out += pr(node) + '\n\n';
}
out += '// ---- functions ----\n';
for (const k of emitted) out += pr(fnNodes[k]) + '\n\n';
out += 'module.exports = {\n  ' + emitted.join(',\n  ') + '\n};\n';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'codegs.js'), out);

// ---- emit callables.js ----
function paramNames(fnNode) {
  return fnNode.params.slice(1).map(pn => {
    if (n.Identifier.check(pn)) return pn.name;
    if (n.AssignmentPattern.check(pn) && n.Identifier.check(pn.left)) return pn.left.name;
    throw new Error('Unsupported parameter shape in ' + fnNode.id.name);
  });
}
const argMap = {}; // fn -> [names]
let cal = '// GENERATED by tools/legacy-port/generate.js — one callable per Code.gs\n';
cal += '// function a ported screen calls. request.data keys = the original\n';
cal += '// function\'s own parameter names (after idToken), in order.\n';
cal += '\'use strict\';\nconst { onCallWithMessages } = require(\'../callable\');\nconst { run } = require(\'./runtime\');\nconst L = require(\'./codegs\');\n\nconst opts = { region: \'us-central1\' };\n\n';
for (const e of [...entries].sort()) {
  const first = fnNodes[e].params[0];
  if (!first || !n.Identifier.check(first) || !/^(idToken|token)$/.test(first.name)) throw new Error(e + ': first parameter is not idToken');
  const names = paramNames(fnNodes[e]); argMap[e] = names;
  const named = '[' + names.map(x => 'd.' + x).join(', ') + ']';
  cal += 'exports.' + e + ' = onCallWithMessages(opts, (request) => {\n  const d = request.data || {};\n  const a = Array.isArray(d.__positional) ? d.__positional : ' + named + ';\n  return run(request, (ctx) => L.' + e + '(ctx, ...a));\n});\n';
}
fs.writeFileSync(path.join(OUT_DIR, 'callables.js'), cal);

// ---- screens ----
const { toAppDialogs } = require('./appDialogs');
const { toListPaging } = require('./listPaging');
const { toCompactForms } = require('./compactForms');
const { toGridClipboard } = require('./gridClipboard');
// Exact-text edits to generated screens (each fails the run if its text is
// no longer there). Keep this short: prefer a rule in the shell.
const SCREEN_EDITS = [
  // Icons Font Awesome 6.0.0 (the version the shell loads) has; the newer
  // ones showed blank (owner, 2026-10-11; functions/test/unit/iconsExist.test.js).
  { mod: 'STOCKVALUATION', from: 'fa-sack-dollar text-blue-500">', to: 'fa-coins text-blue-500">' },
  { mod: 'STOCKVALUATION', from: 'fa-sack-dollar">', to: 'fa-coins">' },
  { mod: 'VENDORMASTER', from: 'fa-truck-field text-blue-500">', to: 'fa-truck text-blue-500">' },
  { mod: 'VENDORMASTER', from: 'fa-truck-field">', to: 'fa-truck">' },
  // COA: a company's list includes the shared accounts (owner, 2026-10-02):
  // they apply to it too, and a one-company user's list opens on their
  // company (the shell's single-company default), which hid them all.
  { mod: 'COA', from: "if (companyFilter && companyFilter !== '__shared__' && a.CompanyID !== companyFilter) return false;",
    to: "if (companyFilter && companyFilter !== '__shared__' && a.CompanyID && a.CompanyID !== companyFilter) return false; // shared accounts show under every company" },
  // COA: tell the user when moving an account to another head gave it a new
  // code (docs/modules/COA_RECODE.md).
  { mod: 'COA', from: "if (result.success) { closeModal(); fetchAndRender(); }",
    to: "if (result.success) { closeModal(); fetchAndRender(); if (result.codeChangedFrom) appAlert('Moved to the new head: code ' + result.codeChangedFrom + ' is now ' + result.accountCode + '.'); }" },
  // (Approval Tracker's time format, 2026-09-29, moved into the screen when it became hand-maintained.)
  // "Documents (n)" on each row: that party's Company Documents (owner,
  // 2026-10-03; docs/modules/COMPANY_DOCUMENTS.md, decision 5).
  { mod: 'VENDORMASTER', from: "window.initModule = function (idToken, writeAllowed) {\n",
    to: "window.initModule = function (idToken, writeAllowed) {\n    supportingDocs.partyDocs({ list: 'ven-table-body', partyType: 'Vendor', from: { moduleId: 'VENDORMASTER', label: 'Vendor Master' } }); // its Company Documents\n" },
  { mod: 'VENDORMASTER', from: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40';",
    to: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40'; row.dataset.partyId = v.VendorID; row.dataset.partyName = v.VendorName;" },
  { mod: 'CUSTOMERMASTER', from: "window.initModule = function (idToken, writeAllowed) {\n",
    to: "window.initModule = function (idToken, writeAllowed) {\n    supportingDocs.partyDocs({ list: 'cus-table-body', partyType: 'Customer', from: { moduleId: 'CUSTOMERMASTER', label: 'Customer Master' } }); // its Company Documents\n" },
  { mod: 'CUSTOMERMASTER', from: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40';",
    to: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40'; row.dataset.partyId = v.CustomerID; row.dataset.partyName = v.CustomerName;" },
  // Supporting documents at the bottom of the entry, and the paperclip in
  // the list (owner, 2026-10-03; docs/modules/ATTACHMENTS.md).
  { mod: 'PHYSICALCOUNT', from: "window.initModule = function (idToken) {\n",
    to: "window.initModule = function (idToken) {\n    supportingDocs.mount({ module: 'PHYSICALCOUNT', view: 'pc-entry-view', id: () => currentCount && currentCount.CountID, list: 'pc-table-body' }); // supporting documents (docs/modules/ATTACHMENTS.md)\n" },
  { mod: 'PHYSICALCOUNT', from: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40';",
    to: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40'; row.dataset.docId = e.CountID;" },
  { mod: 'PRODUCTION', from: "window.initModule = function (idToken) {\n",
    to: "window.initModule = function (idToken) {\n    supportingDocs.mount({ module: 'PRODUCTION', view: 'prd-entry-view', id: () => currentProd && currentProd.ProductionID, list: 'prd-table-body' }); // supporting documents (docs/modules/ATTACHMENTS.md)\n" },
  { mod: 'PRODUCTION', from: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40';",
    to: "const row = document.createElement('tr'); row.className = 'hover:bg-slate-800/40'; row.dataset.docId = e.ProductionID;" },
  // Roles & Permissions: one column per role (owner, 2026-10-03: with 12
  // roles the names and checkboxes, all in one cell, wrapped onto a second
  // line under the wrong roles). The table scrolls sideways when wide.
  { mod: 'ROLES', from: '<th id="perm-role-headers" class="py-3 px-4"></th>',
    to: '<th id="perm-role-headers" class="hidden"></th>' },
  { mod: 'ROLES', from: "headerRow.innerHTML = roles.sort((a, b) => a.Name.localeCompare(b.Name)).map(r => `<span class=\"inline-block w-20 text-center\">${escapeHtml(r.Name)}</span>`).join('');",
    to: "headerRow.parentNode.querySelectorAll('.perm-role-th').forEach(n => n.remove()); // one column per role\n    headerRow.insertAdjacentHTML('afterend', roles.sort((a, b) => a.Name.localeCompare(b.Name)).map(r => `<th class=\"perm-role-th py-3 px-2 text-center align-bottom\" style=\"min-width:5.5rem;max-width:8rem;overflow-wrap:anywhere\">${escapeHtml(r.Name)}</th>`).join(''));" },
  { mod: 'ROLES', from: "return `<span class=\"inline-block w-20 text-center\"><input type=\"checkbox\" data-module=\"${mod.id}\" data-cap=\"${cap}\" data-role=\"${r.RoleID}\" ${checked ? 'checked' : ''} class=\"w-4 h-4\"></span>`;",
    to: "return `<td class=\"py-2 px-2 text-center\"><input type=\"checkbox\" data-module=\"${mod.id}\" data-cap=\"${cap}\" data-role=\"${r.RoleID}\" ${checked ? 'checked' : ''} class=\"w-4 h-4\" title=\"${escapeHtml(r.Name)}\"></td>`;" },
  { mod: 'ROLES', from: '<td class="py-2 px-4 text-xs text-slate-400 capitalize">${escapeHtml(cap)}</td><td class="py-2 px-4">${checks}</td>',
    to: '<td class="py-2 px-4 text-xs text-slate-400 capitalize">${escapeHtml(cap)}</td>${checks}' },
  // COA: the list opens on Active accounts (owner, 2026-10-14); All
  // Statuses or Inactive is still one choice away.
  { mod: 'COA', from: '<select id="coa-status-filter" class="bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-300"><option value="">All Statuses</option><option value="Active">Active</option>',
    to: '<select id="coa-status-filter" class="bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-300"><option value="">All Statuses</option><option value="Active" selected>Active</option>' },
  // User Management: Add New User after an Edit saved over the edited user
  // (bug, 2026-10-14). form.reset() leaves a hidden input's value, so the
  // edited user's id stayed in um-form-id and the save patched that user.
  { mod: 'USERMGMT', from: "document.getElementById('um-modal-title').textContent = 'Add New User';",
    to: "document.getElementById('um-modal-title').textContent = 'Add New User';\n      document.getElementById('um-form-id').value = ''; // reset() keeps a hidden input's value" },
  // User Management: Last Login is now recorded at sign-in (session.js,
  // completeLogin) as a UTC timestamp; shown in local time, dd/mm/yyyy HH:MM.
  { mod: 'USERMGMT', from: '${escapeHtml(u.lastLogin)}',
    to: "${escapeHtml(u.lastLogin && u.lastLogin !== 'Never' ? (isoLocalDateTime(u.lastLogin) || u.lastLogin) : 'Never')}" },
];
const HAND_ARGS = require('./hand-args.json'); // arg names for hand-ported callables the new screens call
function splitTopLevel(s) {
  const outArr = []; let depth = 0, cur = '', quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { cur += c; if (c === quote && s[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { outArr.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) outArr.push(cur.trim());
  return outArr;
}
for (const mod of MODULES.filter(m => !HAND_SCREENS.has(m))) {
  let s = fs.readFileSync(path.join(GAS, mod + '.html'), 'utf8');
  const chains = (s.match(/google\.script\.run\s*[.[]/g) || []).length; // (ignores mentions in comments)
  let converted = 0;
  s = s.replace(/\.(\w+)\(\s*(token|idToken)\b\s*(?:,([\s\S]*?))?\)(\s*;)/g, (m, fn, _t, rest, tail) => {
    const names = argMap[fn] || HAND_ARGS[fn];
    if (!names) throw new Error(mod + ': no argument names for ' + fn + ' (add it to hand-args.json)');
    const args = rest ? splitTopLevel(rest) : [];
    if (args.length > names.length) throw new Error(mod + ': ' + fn + ' called with ' + args.length + ' args, expects ' + names.length);
    converted++;
    if (!args.length) return '.' + fn + '()' + tail;
    return '.' + fn + '({ ' + args.map((a, i) => names[i] + ': ' + a).join(', ') + ' })' + tail;
  });
  s = s.replace(/\[\s*(\w+)\s*\]\(\s*(token|idToken)\b\s*(?:,([\s\S]*?))?\)(\s*;)/g, (m, v, _t, rest, tail) => {
    // Targets may have different parameter names, so dynamic calls pass
    // their arguments positionally; every generated callable accepts
    // { __positional: [...] } as well as named keys.
    const cands = dynamicTargets[mod] || [];
    if (!cands.length) throw new Error(mod + ': dynamic call [' + v + '] with no resolvable targets');
    const handTargets = cands.filter(c => !argMap[c]);
    if (handTargets.length) throw new Error(mod + ': dynamic call [' + v + '] may reach hand-ported ' + handTargets.join(',') + ' (no __positional support there)');
    const args = rest ? splitTopLevel(rest) : [];
    converted++;
    return '[' + v + ']({ __positional: [' + args.join(', ') + '] })' + tail;
  });
  s = s.replace(TERNARY_CALL, (m, expr, a, b, rest, tail) => {
    // Either target may have different parameter names: pass positionally.
    for (const fn of [a, b]) if (!argMap[fn]) throw new Error(mod + ': conditional call may reach hand-ported ' + fn + ' (no __positional support there)');
    converted++;
    return '[' + expr + ']({ __positional: [' + (rest ? splitTopLevel(rest).join(', ') : '') + '] })' + tail;
  });
  s = s.replace(/google\.script\.run/g, 'rpc');
  if (converted !== chains) throw new Error(mod + ': ' + chains + ' google.script.run chains but ' + converted + ' converted — inspect by hand');
  s = toAppDialogs(s, mod).html; // confirm() / prompt() → the shell's in-app dialogs
  s = toListPaging(s, mod); // Gmail-style list paging (docs/modules/LIST_PAGING.md)
  s = toCompactForms(s, mod); // compact Add / Edit forms on the master screens (docs/modules/COMPACT_FORMS.md)
  s = toGridClipboard(s, mod); // Copy with column headings, paste skips them (docs/modules/LINE_GRIDS.md)
  for (const e of SCREEN_EDITS.filter(e => e.mod === mod)) {
    if (s.split(e.from).length !== 2) throw new Error(mod + ': screen edit not found exactly once: ' + e.from);
    s = s.replace(e.from, () => e.to);
  }
  fs.writeFileSync(path.join(MODULES_OUT, mod + '.html'), s);
}

console.log('modules:', MODULES.length, '| callables:', entries.size, '| functions emitted:', emitted.length,
  '| mapped:', Object.keys(MAPPED).filter(k => fnSet.has(k)).length, '| consts:', constSet.size, '| patches:', PATCHES.length);
if (warnings.length) { console.log('WARNINGS:\n  ' + [...new Set(warnings)].join('\n  ')); process.exitCode = 2; }
