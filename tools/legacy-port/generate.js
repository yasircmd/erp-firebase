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
  generateAccountCode_: ['coaScheme', 'generateCode', 'pure'], // docs/modules/COA_NUMBERING.md
  isCashOrBankAccount_: ['coaScheme', 'isCashOrBank', 'pure'], // by the Cash / Bank mark, not the code
  checkItemCategory_: ['itemCategories', 'checkForItem', 'dropCtx'], // docs/modules/ITEM_CATEGORIES_CUSTOM.md (called only from patches)
  validItemCategoryParent_: ['itemCategories', 'validParent', 'dropCtx'],
  customItemCode_: ['numbering', 'customItemCode', 'dropCtx'],
  invoiceCurrencyFields_: ['fx', 'invoiceFields', 'dropCtx'], // docs/modules/MULTI_CURRENCY.md (called only from patches)
  documentBaseLines_: ['fx', 'documentBaseLines', 'pure'],
  assertPartyCurrencyKept_: ['fx', 'assertPartyCurrencyKept', 'dropCtx'],
  accountCurrency_: ['fx', 'accountCurrency', 'dropCtx'], // decision 217 (patch bank-currency)
  ledgerFcBalances_: ['fx', 'ledgerFcBalances', 'pure'],
  projectFields_: ['projects', 'projectFields', 'dropCtx'], // docs/modules/PROJECTS_DIMENSIONS.md (patch projects)
  cleanDimensionRules_: ['dimensionRules', 'cleanRules', 'pure'],
  needsCostCenter_: ['dimensionRules', 'needsCostCenter', 'dropCtx'],
  linesWithProject_: ['projects', 'linesWithProject', 'pure'],
  recordEInvoice_: ['eInvoicing', 'recordEInvoice', 'dropCtx'], // docs/modules/E_INVOICING.md
  generateVendorCode_: ['numbering', 'vendorCode', 'dropCtx'],
  generateCustomerCode_: ['numbering', 'customerCode', 'dropCtx'],
  generateStockTransactionRef_: ['glWriting', 'generateStockTransactionRef', 'dropCtx'],
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
  assertPeriodOpen_: ['periodLock', 'assertOpen', 'dropCtx'], // docs/modules/PERIOD_CLOSING.md (called only from patches)
  cleanInvoiceItemLines_: ['invoiceStock', 'cleanItemLines', 'dropCtx'], // docs/modules/DIRECT_SALES_INVOICE.md (called only from patches)
  // docs/modules/TRANSACTIONS_FIRESTORE.md, T1b (called only from patches stock-posting-atomic-*)
  postStock_: ['stockPosting', 'postStock', 'dropCtx'],
  stockPostedFields_: ['stockPosting', 'postedFields', 'pure'],
  applyStockUpdate_: ['stockStore', 'applyUpdate', 'pure'],
  queryStockTx_: ['stockStore', 'queryTx', 'dropCtx'], // T1c (called only from patches stock-queries-*)
  // T2 (called only from patches sales-posting-atomic-* and sales-queries-*)
  planDelivery_: ['salesPosting', 'planDelivery', 'actor'],
  salesPlanWriter_: ['salesPosting', 'planWriter', 'pure'],
  invoicePostedWriter_: ['salesPosting', 'invoicePostedWriter', 'pure'],
  invoiceReversalWriter_: ['salesPosting', 'invoiceReversalWriter', 'pure'],
  markStockTxs_: ['salesPosting', 'markDocs', 'pure'],
  getStockTxs_: ['stockStore', 'getTxs', 'dropCtx'],
  queryMovedAny_: ['movedPaths', 'whereAny', 'dropCtx'],
  getMovedMany_: ['movedPaths', 'getMany', 'dropCtx'],
  sortedDocs_: ['docStore', 'sorted', 'pure'],
  // T4 (called only from patches job-posting-atomic-*)
  planProduction_: ['productionPosting', 'planProduction', 'actor'],
  productionPlanWriter_: ['productionPosting', 'planWriter', 'pure']
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
  approvals: '../approvals', reservations: '../reservations',
  tree: '../tree', roles: '../roles', masterData: '../masterData', moduleRegistry: '../moduleRegistry',
  treeSeedNodes: '../treeSeedNodes', approvalRegistry: '../approvalRegistry',
  listPaging: '../listPaging', // used by name (__listPaging.) in patches
  prVisibility: '../prVisibility',
  coaUsage: '../coaUsage',
  stockPosting: '../stockPosting',
  stockStore: '../stockStore',
  salesPosting: '../salesPosting', movedPaths: '../movedPaths', docStore: '../docStore', // T2
  productionPosting: '../productionPosting', // T4
  entitlements: '../entitlements', // MULTI_CORPORATE.md M2
  lineClubbing: '../lineClubbing',
  numbering: '../numbering',
  periodLock: '../periodLock',
  customerPhone: '../customerPhone', // used by name (__customerPhone.) in patches
  invoiceStock: '../invoiceStock',
  coaScheme: '../coaScheme', // used by name (__coaScheme.) in patches
  itemCategories: '../itemCategories',
  fx: '../fx',
  projects: '../projects',
  dimensionRules: '../dimensionRules',
  eInvoicing: '../eInvoicing'
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
  // Organizational Units: the Location type (owner, 2026-10-14; patch
  // org-unit-location): in the type filter, the form and the labels.
  { mod: 'ORGUNITS', from: '      <option value="ProfitCenter">Profit Center</option>\n    </select>',
    to: '      <option value="ProfitCenter">Profit Center</option>\n      <option value="Location">Location</option>\n    </select>' },
  { mod: 'ORGUNITS', from: '          <option value="ProfitCenter">Profit Center</option>\n        </select>',
    to: '          <option value="ProfitCenter">Profit Center</option>\n          <option value="Location">Location</option>\n        </select>' },
  { mod: 'ORGUNITS', from: "CostCenter: 'Cost Center', ProfitCenter: 'Profit Center' };",
    to: "CostCenter: 'Cost Center', ProfitCenter: 'Profit Center', Location: 'Location' };" },
  // Item Sub-Category: shared or one company's, and opened from Item Master's
  // "New…" with Back (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md).
  { mod: 'ITEMSUBCAT', from: "<button id=\"isc-add-btn\" class=\"hidden bg-blue-600",
    to: "<button id=\"isc-back-btn\" class=\"hidden bg-slate-800 hover:bg-slate-700 text-xs px-4 py-2 rounded-lg border border-slate-700\"><i class=\"fa-solid fa-arrow-left\"></i> <span id=\"isc-back-label\">Back</span></button>\n    <button id=\"isc-add-btn\" class=\"hidden bg-blue-600" },
  { mod: 'ITEMSUBCAT', from: "<th class=\"py-3 px-4\">Parent Category</th>",
    to: "<th class=\"py-3 px-4\">Parent Category</th><th class=\"py-3 px-4\">Company</th>" },
  { mod: 'ITEMSUBCAT', from: "<tr><td colspan=\"4\" class=\"py-6 text-center text-slate-500\">No sub-categories configured yet.</td></tr>",
    to: "<tr><td colspan=\"5\" class=\"py-6 text-center text-slate-500\">No sub-categories configured yet.</td></tr>" },
  { mod: 'ITEMSUBCAT', from: "        <td class=\"py-3 px-4 text-xs text-slate-400\">${escapeHtml(CATEGORY_LABELS[s.ParentCategory] || s.ParentCategory)}</td>",
    to: "        <td class=\"py-3 px-4 text-xs text-slate-400\">${escapeHtml(CATEGORY_LABELS[s.ParentCategory] || s.ParentCategory)}</td>\n        <td class=\"py-3 px-4 text-xs\">${s.CompanyID ? '<span class=\"text-amber-400\">' + escapeHtml(companyLabel(s.CompanyID)) + '</span>' : '<span class=\"text-slate-500\">All Companies</span>'}</td>" },
  { mod: 'ITEMSUBCAT', from: "      <div><label class=\"block text-xs font-medium text-slate-300 mb-1\">Name</label>",
    to: "      <div><label class=\"block text-xs font-medium text-slate-300 mb-1\">Company</label><select id=\"isc-form-company\" class=\"w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm\"><option value=\"\">All Companies \u2014 shared</option></select></div>\n      <div><label class=\"block text-xs font-medium text-slate-300 mb-1\">Name</label>" },
  { mod: 'ITEMSUBCAT', from: "      document.getElementById('isc-form-status').value = s.Status;\n    } else {\n      document.getElementById('isc-modal-title').textContent = 'Add Sub-Category';\n      document.getElementById('isc-form-id').value = '';\n    }",
    to: "      document.getElementById('isc-form-status').value = s.Status;\n      document.getElementById('isc-form-company').value = s.CompanyID || '';\n    } else {\n      document.getElementById('isc-modal-title').textContent = 'Add Sub-Category';\n      document.getElementById('isc-form-id').value = '';\n      // Opened from Item Master's \"New\u2026\": its category and company.\n      if (prefill) { document.getElementById('isc-form-category').value = prefill.NewFor || ''; document.getElementById('isc-form-company').value = prefill.CompanyID || ''; prefill = null; }\n    }" },
  { mod: 'ITEMSUBCAT', from: "      Status: document.getElementById('isc-form-status').value\n    };",
    to: "      Status: document.getElementById('isc-form-status').value,\n      CompanyID: document.getElementById('isc-form-company').value\n    };" },
  { mod: 'ITEMSUBCAT', from: "  let subCategories = [];\n",
    to: "  let subCategories = [];\n  // Shared or one company's (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md).\n  let companies = [], prefill = null, returnChain = [];\n  const companyLabel = id => { const c = companies.find(x => x.CompanyID === id); return c ? (c.CompanyRefCode ? c.CompanyRefCode + ' - ' : '') + c.LegalName : id; };\n" },
  { mod: 'ITEMSUBCAT', from: "    document.getElementById('app-title').innerHTML = '<i class=\"fa-solid fa-tags\"></i> Item Sub-Category';\n    fetchAndRender();",
    to: "    document.getElementById('app-title').innerHTML = '<i class=\"fa-solid fa-tags\"></i> Item Sub-Category';\n    // From Item Master's \"New\u2026\" (owner, 2026-10-14): the Add form, and Back.\n    returnChain = window.__pendingReturnChain || []; window.__pendingReturnChain = [];\n    const params = window.__pendingModuleParams || null; window.__pendingModuleParams = null;\n    if (returnChain.length) {\n      const target = returnChain[returnChain.length - 1];\n      document.getElementById('isc-back-label').textContent = 'Back to ' + (target.label || target.moduleId);\n      document.getElementById('isc-back-btn').classList.remove('hidden');\n      document.getElementById('isc-back-btn').addEventListener('click', () => { const chain = returnChain.slice(); const t = chain.pop(); openModule(t.moduleId, t.params, chain); });\n    }\n    rpc.withSuccessHandler(list => {\n      companies = list || [];\n      document.getElementById('isc-form-company').innerHTML = '<option value=\"\">All Companies \u2014 shared</option>' + companies.map(c => '<option value=\"' + escapeHtml(c.CompanyID) + '\">' + escapeHtml(companyLabel(c.CompanyID)) + '</option>').join('');\n      renderTable();\n      if (params && params.NewFor && canWrite) { prefill = params; openModal(); }\n    }).withFailureHandler(() => {}).getActiveCompanies();\n    fetchAndRender();" },
  // User Management: a leaver's access (owner, 2026-10-14; leaverAccess.js):
  // the status shows its last day, or that it has ended.
  { mod: 'USERMGMT', from: '<td class="py-3 px-4 text-xs">${escapeHtml(u.status)}</td>',
    to: '<td class="py-3 px-4 text-xs">${escapeHtml(u.status)}${u.accessUntil ? `<div class="um-access text-[11px] ${u.accessUntil < new Date().toISOString().slice(0, 10) ? \'text-red-400\' : \'text-amber-400\'}">${u.accessUntil < new Date().toISOString().slice(0, 10) ? \'Access ended \' : \'Leaving: access until \'}${escapeHtml(u.accessUntil)}</div>` : \'\'}</td>' },
  // User Management: Last Login is now recorded at sign-in (session.js,
  // completeLogin) as a UTC timestamp; shown in local time, dd/mm/yyyy HH:MM.
  { mod: 'USERMGMT', from: '${escapeHtml(u.lastLogin)}',
    to: "${escapeHtml(u.lastLogin && u.lastLogin !== 'Never' ? (isoLocalDateTime(u.lastLogin) || u.lastLogin) : 'Never')}" },,
  // COA numbering (owner, 2026-10-16; docs/modules/COA_NUMBERING.md,
  // decisions 197-210): a class per type, groups under it, accounts under
  // a group; a group marked Cash or Bank; Renumber within the heading;
  // the accounts to fix.
  { mod: 'COA', from: '<option value="">None — creates a new top-level sub-category</option></select>',
    to: '<option value="">None — the class (one per type, already there)</option></select>' },
  { mod: 'COA', from: "select.innerHTML = '<option value=\"\">None — creates a new top-level sub-category</option>';",
    to: "select.innerHTML = '<option value=\"\">None — the class (one per type, already there)</option>';" },
  { mod: 'COA', from: 'Pick a header to create an account under it, or pick a sub-parent (shown indented) to create one under that instead. Leave blank to create a new top-level sub-category (e.g. "Bank Accounts") under the selected type.',
    to: 'A class (e.g. 100000 Assets) holds groups; a group (e.g. 110000 Cash) holds accounts and, optionally, sub-groups (shown indented). An account that takes postings always goes under a group or a sub-group, never straight under the class.' },
  { mod: 'COA', from: 'Leave unchecked for a header, or for a sub-parent grouping (e.g. "Accrued & Clearing Liabilities") under a header — only one level of sub-parent is supported.',
    to: 'Leave unchecked for a heading: a group under the class, or a sub-group under a group (one level of sub-group).' },
  { mod: 'COA', from: '      <div id="coa-cashflowcategory-inherited"',
    to: `      <div id="coa-cashbank-field" class="hidden">
        <label class="block text-xs font-medium text-slate-300 mb-1">Cash / Bank</label>
        <select id="coa-form-cashbank" class="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm"><option value="">Neither</option><option value="Cash">Cash: its accounts are cash accounts</option><option value="Bank">Bank: its accounts are bank accounts</option></select>
        <p class="text-xs text-slate-500 mt-1">The accounts under this group are the cash (or bank) accounts that Cash and Bank Transactions, PDCs, Fixed Assets and payroll offer.</p>
      </div>
      <div id="coa-cashflowcategory-inherited"` },
  { mod: 'COA', from: "      document.getElementById('coa-form-cashflowcategory').value = a.CashFlowCategory || '';\n",
    to: "      document.getElementById('coa-form-cashflowcategory').value = a.CashFlowCategory || '';\n      document.getElementById('coa-form-cashbank').value = a.OwnCashBank || '';\n" },
  { mod: 'COA', from: "      CashFlowCategory: document.getElementById('coa-form-cashflowcategory').value,\n",
    to: "      CashFlowCategory: document.getElementById('coa-form-cashflowcategory').value,\n      CashBank: document.getElementById('coa-cashbank-field').classList.contains('hidden') ? '' : document.getElementById('coa-form-cashbank').value,\n" },
  { mod: 'COA', from: "    updateCashFlowCategoryVisibility();\n    document.getElementById('coa-modal').classList.remove('hidden');",
    to: "    updateCashFlowCategoryVisibility();\n    updateCashBankVisibility();\n    document.getElementById('coa-modal').classList.remove('hidden');" },
  { mod: 'COA', from: "  function closeModal() { document.getElementById('coa-modal').classList.add('hidden'); }",
    to: `  // Cash / Bank: on an Assets heading that has a parent (a group or sub-group).
  function updateCashBankVisibility() {
    const show = !document.getElementById('coa-form-postable').checked && document.getElementById('coa-form-type').value === 'Asset' && Boolean(document.getElementById('coa-form-parent').value);
    document.getElementById('coa-cashbank-field').classList.toggle('hidden', !show);
  }

  // Renumber (docs/modules/COA_NUMBERING.md, decision 198): another free code of the account's own heading.
  async function renumber(a) {
    rpc.withSuccessHandler(async r => {
      if (!r.codes.length) { appAlert(r.heading.AccountCode + ' ' + r.heading.AccountName + ' has no free code.'); return; }
      const to = await appPrompt('Renumber ' + r.accountCode + ' ' + r.accountName + ' within ' + r.heading.AccountCode + ' ' + r.heading.AccountName + '.\\n\\nFree codes: ' + r.codes[0] + ' to ' + r.codes[r.codes.length - 1] +
        (r.codes.length < 999 ? ' (some taken)' : '') + '. Every posting, draft and document that shows ' + r.accountCode + ' will show the new code. New code:', r.codes[0]);
      if (to === null) return;
      const reason = await appPrompt('The reason for renumbering ' + r.accountCode + ' to ' + to.trim() + ':', '');
      if (reason === null) return;
      rpc.withSuccessHandler(res => { fetchAndRender(); loadAccountsToFix(); appAlert('Renumbered: ' + res.from + ' is now ' + res.to + '.'); })
        .withFailureHandler(err => appAlert(err.message || 'Unable to renumber the account.'))
        .renumberAccount({ accountId: a.AccountID, newCode: to.trim(), reason: reason });
    }).withFailureHandler(err => appAlert(err.message || 'Unable to renumber the account.')).getAccountRenumberCodes({ accountId: a.AccountID });
  }

  // Accounts that take postings but are not under a group (decision 201).
  function loadAccountsToFix() {
    rpc.withSuccessHandler(r => {
      const list = (r && r.accounts) || [];
      document.getElementById('coa-fix').classList.toggle('hidden', !list.length);
      document.getElementById('coa-fix-list').innerHTML = list.map(x => '<li><span class="font-mono">' + escapeHtml(x.AccountCode) + '</span> ' + escapeHtml(x.AccountName) + ': ' + escapeHtml(x.Problem) + '</li>').join('');
    }).withFailureHandler(() => {}).getCoaAccountsToFix({});
  }

  function closeModal() { document.getElementById('coa-modal').classList.add('hidden'); }` },
  { mod: 'COA', from: "    document.getElementById('coa-form-parent').addEventListener('change', updateCashFlowCategoryVisibility);\n",
    to: "    document.getElementById('coa-form-parent').addEventListener('change', updateCashFlowCategoryVisibility);\n    ['coa-form-parent', 'coa-form-postable', 'coa-form-type'].forEach(id => document.getElementById(id).addEventListener('change', updateCashBankVisibility));\n    loadAccountsToFix();\n" },
  { mod: 'COA', from: "        if (result.success) { closeModal(); fetchAndRender(); if (result.codeChangedFrom)",
    to: "        if (result.success) { closeModal(); fetchAndRender(); loadAccountsToFix(); if (result.codeChangedFrom)" },
  { mod: 'COA', from: '  <div class="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">\n    <div class="overflow-x-auto">',
    to: `  <div id="coa-fix" class="hidden bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm">
    <div class="font-semibold text-amber-300 mb-1"><i class="fa-solid fa-triangle-exclamation"></i> Accounts to fix</div>
    <p class="text-xs text-slate-400 mb-2">These take postings but are not under a group. Edit each: choose its group as the parent (a used account can't move: create a new account under the group, move the balance with a JV and deactivate this one).</p>
    <ul id="coa-fix-list" class="text-xs text-slate-300 space-y-0.5"></ul>
  </div>

  <div class="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
    <div class="overflow-x-auto">` },
  { mod: 'COA', from: '        <td class="py-3 px-4 text-slate-200">${escapeHtml(a.AccountName)}</td>',
    to: '        <td class="py-3 px-4 text-slate-200">${escapeHtml(a.AccountName)}${a.OwnCashBank ? \' <span class="ml-1 text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">\' + escapeHtml(a.OwnCashBank) + \'</span>\' : \'\'}</td>' },
  // The former codes of a renumbered account: off the list, in its details
  // only (owner, 2026-10-24, decision 267), so an old code on a printed
  // report can still be traced.
  { mod: 'COA', from: '        Account code: <span id="coa-code-value" class="font-mono text-slate-200"></span>',
    to: '        Account code: <span id="coa-code-value" class="font-mono text-slate-200"></span><span id="coa-code-former" class="text-slate-500"></span>' },
  { mod: 'COA', from: "      document.getElementById('coa-code-value').textContent = a.AccountCode;\n",
    to: "      document.getElementById('coa-code-value').textContent = a.AccountCode;\n      document.getElementById('coa-code-former').textContent = (a.FormerCodes || []).length ? ' · formerly ' + a.FormerCodes.map(f => f.Code + (f.Until ? ' (until ' + String(f.Until).substring(0, 10) + ')' : '')).join(', ') : '';\n" },
  { mod: 'COA', from: "        ? `<button class=\"coa-edit text-slate-400 hover:text-blue-400 p-1\" title=\"Edit\"><i class=\"fa-solid fa-pen-to-square\"></i></button>",
    to: "        ? `${a.IsPostable === true ? '<button class=\"coa-renumber text-slate-400 hover:text-blue-400 p-1\" title=\"Renumber within its heading\"><i class=\"fa-solid fa-arrow-down-1-9\"></i></button>' : ''}<button class=\"coa-edit text-slate-400 hover:text-blue-400 p-1\" title=\"Edit\"><i class=\"fa-solid fa-pen-to-square\"></i></button>" },
  { mod: 'COA', from: "        row.querySelector('.coa-edit').addEventListener('click', () => openModal(a.AccountID));\n",
    to: "        row.querySelector('.coa-edit').addEventListener('click', () => openModal(a.AccountID));\n        const rn = row.querySelector('.coa-renumber');\n        if (rn) rn.addEventListener('click', () => renumber(a));\n" },
  { mod: 'COA', from: "/000$/.test(String(a.AccountCode || '')) // header (…0000) OR sub-parent (…1000, …2000, etc.)",
    to: "/000$/.test(String(a.AccountCode || '')) // class (X00000), group (XN0000) or sub-group (XNM000)" },
  { mod: 'COA', from: "        const isSubParent = /^\\d{2}[1-9]000$/.test(String(a.AccountCode || ''));\n        opt.textContent = (isSubParent ? '— ' : '') + a.AccountCode + ' — ' + a.AccountName;",
    to: "        const level = /^\\d00000$/.test(String(a.AccountCode || '')) ? 0 : /^\\d{2}0000$/.test(String(a.AccountCode || '')) ? 1 : 2;\n        opt.textContent = ['', '— ', '—— '][level] + a.AccountCode + ' — ' + a.AccountName;" },
  // Item categories of your own (owner, 2026-10-16; docs/modules/
  // ITEM_CATEGORIES_CUSTOM.md): a sub-category may sit under one (X-<id>).
  { mod: 'ITEMSUBCAT', from: "  function fetchAndRender() {\n    rpc",
    to: `  // The categories of your own, after the five (their key X-<id>).
  function loadOwnCategories() {
    rpc.withSuccessHandler(r => {
      const sel = document.getElementById('isc-form-category');
      sel.querySelectorAll('option[data-custom]').forEach(o => o.remove());
      ((r && r.categories) || []).forEach(c => {
        CATEGORY_LABELS[c.Key] = c.Name;
        const opt = document.createElement('option'); opt.value = c.Key; opt.dataset.custom = '1'; opt.textContent = c.Name + ' (like ' + (CATEGORY_LABELS[c.BaseCategory] || c.BaseCategory) + ')';
        sel.appendChild(opt);
      });
      if (sel.dataset.want) sel.value = sel.dataset.want;
      renderTable();
    }).withFailureHandler(() => {}).getItemCategories({});
  }

  function fetchAndRender() {
    loadOwnCategories();
    rpc` },
  { mod: 'ITEMSUBCAT', from: "document.getElementById('isc-form-category').value = prefill.NewFor || '';",
    to: "document.getElementById('isc-form-category').value = prefill.NewFor || ''; document.getElementById('isc-form-category').dataset.want = prefill.NewFor || '';" },
  // Exchange rates by effective date (owner, 2026-10-16; docs/modules/
  // MULTI_CURRENCY.md): a Rates panel for each currency but the default.
  { mod: 'CURRENCYCONFIG', from: '<div id="cc-modal" ',
    to: `<div id="cc-rates" class="hidden fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
  <div class="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl space-y-4">
    <div class="flex items-center justify-between border-b border-slate-700 pb-3"><h3 id="cc-rates-title" class="text-lg font-bold">Rates</h3><button id="cc-rates-close" class="text-slate-400 hover:text-slate-200"><i class="fa-solid fa-xmark"></i></button></div>
    <p class="text-xs text-slate-400">1 <span id="cc-rates-code"></span> = the rate in <span id="cc-rates-base"></span>, from its date until a later rate. A document keeps the rate it was made with; to correct one, enter the right rate from the same date.</p>
    <div id="cc-rates-form" class="hidden flex flex-wrap items-end gap-2">
      <div><label class="block text-xs text-slate-300 mb-1">From</label><input id="cc-rate-date" type="date" class="bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-sm"></div>
      <div><label class="block text-xs text-slate-300 mb-1">Rate</label><input id="cc-rate-value" inputmode="decimal" class="w-32 bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-sm"></div>
      <div class="flex-1 min-w-[8rem]"><label class="block text-xs text-slate-300 mb-1">Note</label><input id="cc-rate-note" maxlength="200" class="w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-sm"></div>
      <button id="cc-rate-save" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded-lg">Add rate</button>
    </div>
    <p id="cc-rate-error" class="hidden text-xs text-red-400"></p>
    <div class="max-h-80 overflow-y-auto"><table class="w-full text-left text-sm"><thead><tr class="text-xs text-slate-400 uppercase border-b border-slate-700"><th class="py-1 pr-3">From</th><th class="py-1 pr-3 text-right">Rate</th><th class="py-1 pr-3">Note</th><th class="py-1">Entered by</th></tr></thead><tbody id="cc-rates-body" class="divide-y divide-slate-700"></tbody></table></div>
  </div>
</div>

<div id="cc-modal" ` },
  { mod: 'CURRENCYCONFIG', from: "        <td class=\"py-3 px-4 text-right\">${actions}</td>`;",
    to: "        <td class=\"py-3 px-4 text-right\">${c.IsDefault ? '' : '<button class=\"cc-rates-btn text-slate-400 hover:text-blue-400 p-1 text-xs\" title=\"Exchange rates\"><i class=\"fa-solid fa-chart-line\"></i> Rates</button>'}${actions}</td>`;\n      if (!c.IsDefault) row.querySelector('.cc-rates-btn').addEventListener('click', () => openRates(c.Code));" },
  { mod: 'CURRENCYCONFIG', from: "  function closeModal() { document.getElementById('cc-modal').classList.add('hidden'); }",
    to: `  function closeModal() { document.getElementById('cc-modal').classList.add('hidden'); }

  // ---------- Rates (docs/modules/MULTI_CURRENCY.md) ----------
  let ratesCode = '';
  function openRates(code) {
    ratesCode = code;
    document.getElementById('cc-rate-error').classList.add('hidden');
    rpc.withSuccessHandler(r => {
      document.getElementById('cc-rates-title').textContent = 'Rates: ' + code;
      document.getElementById('cc-rates-code').textContent = code;
      document.getElementById('cc-rates-base').textContent = r.base.Code || 'the default currency';
      document.getElementById('cc-rates-form').classList.toggle('hidden', !r.canEnter);
      document.getElementById('cc-rates-body').innerHTML = ((r.rates || {})[code] || []).map(x => '<tr><td class="py-1 pr-3">' + escapeHtml(x.EffectiveDate) + '</td><td class="py-1 pr-3 text-right font-mono">' + escapeHtml(x.Rate) +
        '</td><td class="py-1 pr-3 text-xs text-slate-400">' + escapeHtml(x.Note || '') + '</td><td class="py-1 text-xs text-slate-400">' + escapeHtml(x.ByName || '') + '</td></tr>').join('') ||
        '<tr><td colspan="4" class="py-3 text-center text-slate-500 text-xs">No rates yet.</td></tr>';
      document.getElementById('cc-rates').classList.remove('hidden');
    }).withFailureHandler(err => appAlert(err.message || 'Unable to load the rates.')).getExchangeRates({});
  }
  function saveRate() {
    const error = document.getElementById('cc-rate-error');
    error.classList.add('hidden');
    rpc.withSuccessHandler(() => { document.getElementById('cc-rate-value').value = ''; document.getElementById('cc-rate-note').value = ''; openRates(ratesCode); })
      .withFailureHandler(err => { error.textContent = err.message || 'Unable to save the rate.'; error.classList.remove('hidden'); })
      .saveExchangeRate({ code: ratesCode, effectiveDate: document.getElementById('cc-rate-date').value, rate: document.getElementById('cc-rate-value').value, note: document.getElementById('cc-rate-note').value });
  }` },
  { mod: 'CURRENCYCONFIG', from: "    document.getElementById('cc-form').addEventListener('submit', saveCurrency);\n",
    to: "    document.getElementById('cc-form').addEventListener('submit', saveCurrency);\n    document.getElementById('cc-rates-close').addEventListener('click', () => document.getElementById('cc-rates').classList.add('hidden'));\n    document.getElementById('cc-rate-save').addEventListener('click', saveRate);\n" },
  { mod: 'CURRENCYCONFIG', from: '<div id="cc-rates" ',
    to: `<div id="cc-fx" class="hidden max-w-5xl mx-auto mt-6 bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
  <div class="text-sm font-semibold">Exchange Gain / Loss account</div>
  <p class="text-xs text-slate-400">When a payment settles a foreign-currency invoice at another rate, the difference posts to this account (a Revenue or Expense account), on the cost center of the payment line or, if it has none, the one chosen here.</p>
  <div id="cc-fx-rows" class="space-y-2"></div>
</div>
<div id="cc-rates" ` },
  { mod: 'CURRENCYCONFIG', from: "  // ---------- Rates (docs/modules/MULTI_CURRENCY.md) ----------",
    to: `  // ---------- Exchange Gain / Loss account per company ----------
  function loadFx() {
    rpc.withSuccessHandler(r => {
      const box = document.getElementById('cc-fx-rows');
      box.innerHTML = (r.companies || []).map(c => '<div class="flex flex-wrap items-center gap-2 text-sm" data-co="' + escapeHtml(c.CompanyID) + '"><span class="w-48 truncate">' + escapeHtml(c.LegalName) + '</span>' +
        '<select class="cc-fx-acc bg-slate-900 border border-slate-700 rounded py-1 px-2 text-sm"' + (r.canWrite ? '' : ' disabled') + '><option value="">Not set</option>' + c.Accounts.map(a => '<option value="' + escapeHtml(a.AccountID) + '"' + (a.AccountID === c.GainLossAccountID ? ' selected' : '') + '>' + escapeHtml(a.AccountCode + ' — ' + a.AccountName) + '</option>').join('') + '</select>' +
        '<select class="cc-fx-cc bg-slate-900 border border-slate-700 rounded py-1 px-2 text-sm"' + (r.canWrite ? '' : ' disabled') + '><option value="">No default cost center</option>' + c.CostCenters.map(u => '<option value="' + escapeHtml(u.UnitID) + '"' + (u.UnitID === c.CostCenterID ? ' selected' : '') + '>' + escapeHtml(u.Code + ' — ' + u.Name) + '</option>').join('') + '</select>' +
        (r.canWrite ? '<button class="cc-fx-save bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded">Save</button>' : '') + '<span class="cc-fx-note text-xs text-emerald-400"></span></div>').join('');
      document.getElementById('cc-fx').classList.toggle('hidden', !(r.companies || []).length);
      box.querySelectorAll('.cc-fx-save').forEach(b => b.addEventListener('click', () => {
        const row = b.closest('[data-co]');
        rpc.withSuccessHandler(() => { row.querySelector('.cc-fx-note').textContent = 'Saved.'; })
          .withFailureHandler(err => appAlert(err.message || 'Unable to save.'))
          .saveFxSettings({ companyId: row.dataset.co, gainLossAccountId: row.querySelector('.cc-fx-acc').value, costCenterId: row.querySelector('.cc-fx-cc').value });
      }));
    }).withFailureHandler(() => {}).getFxSettings({});
  }

  // ---------- Rates (docs/modules/MULTI_CURRENCY.md) ----------` },
  { mod: 'CURRENCYCONFIG', from: "    document.getElementById('cc-rate-save').addEventListener('click', saveRate);\n",
    to: "    document.getElementById('cc-rate-save').addEventListener('click', saveRate);\n    loadFx();\n" },
  // COA: a cash or bank account may carry a currency of its own (owner,
  // 2026-10-16; docs/modules/MULTI_CURRENCY.md, decision 217).
  { mod: 'COA', from: '      <div id="coa-cashflowcategory-inherited" class="hidden',
    to: `      <div id="coa-currency-field" class="hidden">
        <label class="block text-xs font-medium text-slate-300 mb-1">Currency</label>
        <select id="coa-form-currency" class="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm"><option value="">Base currency</option></select>
        <p class="text-xs text-slate-500 mt-1">A cash or bank account in a foreign currency: its Cash and Bank Transactions are entered in it, at the rate of their date. It can't change once the account has postings.</p>
      </div>
      <div id="coa-cashflowcategory-inherited" class="hidden` },
  { mod: 'COA', from: "      document.getElementById('coa-form-cashbank').value = a.OwnCashBank || '';\n",
    to: "      document.getElementById('coa-form-cashbank').value = a.OwnCashBank || '';\n      document.getElementById('coa-form-currency').value = a.Currency || '';\n" },
  { mod: 'COA', from: "      populateParentOptions('', null);\n",
    to: "      populateParentOptions('', null);\n      document.getElementById('coa-form-currency').value = '';\n" },
  { mod: 'COA', from: "    document.getElementById('coa-cashbank-field').classList.toggle('hidden', !show);\n",
    to: "    document.getElementById('coa-cashbank-field').classList.toggle('hidden', !show);\n    const parent = accounts.find(x => x.AccountID === document.getElementById('coa-form-parent').value);\n    document.getElementById('coa-currency-field').classList.toggle('hidden', !(document.getElementById('coa-form-postable').checked && parent && parent.CashBank)); // a cash or bank account's currency\n" },
  { mod: 'COA', from: "      CashBank: document.getElementById('coa-cashbank-field').classList.contains('hidden') ? '' : document.getElementById('coa-form-cashbank').value,\n",
    to: "      CashBank: document.getElementById('coa-cashbank-field').classList.contains('hidden') ? '' : document.getElementById('coa-form-cashbank').value,\n      Currency: document.getElementById('coa-currency-field').classList.contains('hidden') ? '' : document.getElementById('coa-form-currency').value,\n" },
  { mod: 'COA', from: "    loadAccountsToFix();\n",
    to: `    loadAccountsToFix();
    // The foreign currencies a cash or bank account may be in (decision 217).
    rpc.withSuccessHandler(base => rpc.withSuccessHandler(list => {
      const sel = document.getElementById('coa-form-currency');
      (list || []).filter(c => !base || c.Code !== base.Code).forEach(c => { const o = document.createElement('option'); o.value = c.Code; o.textContent = c.Code + ' — ' + c.Name; sel.appendChild(o); });
    }).withFailureHandler(() => {}).getActiveCurrencies()).withFailureHandler(() => {}).getDefaultCurrency();
` },
  { mod: 'COA', from: '<td class="py-3 px-4 text-slate-200">${escapeHtml(a.AccountName)}',
    to: '<td class="py-3 px-4 text-slate-200">${escapeHtml(a.AccountName)}${a.Currency ? \' <span class="coa-currency ml-1 text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">\' + escapeHtml(a.Currency) + \'</span>\' : \'\'}' },
  // Organizational Units: the Project type (owner, 2026-10-16; patch projects;
  // docs/modules/PROJECTS_DIMENSIONS.md, decision 221): a customer, start and
  // end dates, and Closed (no new postings).
  { mod: 'ORGUNITS', from: '      <option value="Location">Location</option>\n    </select>',
    to: '      <option value="Location">Location</option>\n      <option value="Project">Project</option>\n    </select>' },
  { mod: 'ORGUNITS', from: '          <option value="Location">Location</option>\n        </select>',
    to: '          <option value="Location">Location</option>\n          <option value="Project">Project</option>\n        </select>' },
  { mod: 'ORGUNITS', from: "ProfitCenter: 'Profit Center', Location: 'Location' };",
    to: "ProfitCenter: 'Profit Center', Location: 'Location', Project: 'Project' };" },
  { mod: 'ORGUNITS', from: '<option value="">All Statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select>',
    to: '<option value="">All Statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option><option value="Closed">Closed</option></select>' },
  { mod: 'ORGUNITS', from: '<option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>\n      <div id="ou-form-error"',
    to: `<option value="Active">Active</option><option value="Inactive">Inactive</option><option value="Closed" id="ou-status-closed" class="hidden">Closed: takes no new postings</option></select></div>
      <div id="ou-project-fields" class="hidden space-y-3">
        <div><label class="block text-xs font-medium text-slate-300 mb-1">Customer <span class="text-slate-500">(optional)</span></label><select id="ou-form-customer" class="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm"><option value="">None</option></select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block text-xs font-medium text-slate-300 mb-1">Start date</label><input type="date" id="ou-form-start" class="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm"></div>
          <div><label class="block text-xs font-medium text-slate-300 mb-1">End date</label><input type="date" id="ou-form-end" class="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm"></div>
        </div>
      </div>
      <div id="ou-form-error"` },
  { mod: 'ORGUNITS', from: "      document.getElementById('ou-form-status').value = u.Status;\n",
    to: "      document.getElementById('ou-form-status').value = u.Status;\n      document.getElementById('ou-form-customer').value = u.CustomerID || '';\n      document.getElementById('ou-form-start').value = u.StartDate || '';\n      document.getElementById('ou-form-end').value = u.EndDate || '';\n" },
  { mod: 'ORGUNITS', from: "    document.getElementById('ou-modal').classList.remove('hidden');\n  }",
    to: "    showProjectFields();\n    document.getElementById('ou-modal').classList.remove('hidden');\n  }\n\n  // A project's own fields (docs/modules/PROJECTS_DIMENSIONS.md).\n  function showProjectFields() {\n    const project = document.getElementById('ou-form-type').value === 'Project';\n    document.getElementById('ou-project-fields').classList.toggle('hidden', !project);\n    document.getElementById('ou-status-closed').classList.toggle('hidden', !project);\n  }" },
  { mod: 'ORGUNITS', from: "      Status: document.getElementById('ou-form-status').value\n    };",
    to: "      Status: document.getElementById('ou-form-status').value,\n      CustomerID: document.getElementById('ou-form-customer').value,\n      StartDate: document.getElementById('ou-form-start').value,\n      EndDate: document.getElementById('ou-form-end').value\n    };" },
  { mod: 'ORGUNITS', from: "    document.getElementById('ou-form-type').addEventListener('change', () => populateParentOptions(document.getElementById('ou-form-id').value || null));\n",
    to: `    document.getElementById('ou-form-type').addEventListener('change', () => populateParentOptions(document.getElementById('ou-form-id').value || null));
    document.getElementById('ou-form-type').addEventListener('change', showProjectFields);
    rpc.withSuccessHandler(list => {
      const sel = document.getElementById('ou-form-customer');
      (list || []).sort((a, b) => String(a.CustomerName).localeCompare(String(b.CustomerName))).forEach(c => { const o = document.createElement('option'); o.value = c.CustomerID; o.textContent = c.CustomerCode + ' — ' + c.CustomerName; sel.appendChild(o); });
    }).withFailureHandler(() => {}).getActiveCustomers();
` },
  // COA: which accounts need a cost center, profit center or project (owner,
  // 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, decisions 219-220): set
  // on a heading, followed by its accounts; an account may differ.
  { mod: 'COA', from: '      <div id="coa-currency-field" class="hidden">',
    to: `      <div id="coa-dims-field" class="space-y-1">
        <label class="block text-xs font-medium text-slate-300">Lines need <span class="text-slate-500">(blank: as the heading above)</span></label>
        <div class="grid grid-cols-3 gap-2">
          ${['CostCenter:Cost center', 'ProfitCenter:Profit center', 'Project:Project'].map(x => { const [k, l] = x.split(':'); return '<div><span class="block text-[11px] text-slate-400">' + l + '</span><select id="coa-dim-' + k + '" data-dim="' + k + '" class="coa-dim w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-xs"><option value="">As the heading</option><option value="Required">Required</option><option value="Optional">Optional</option><option value="NotUsed">Not used</option></select><span id="coa-dim-' + k + '-hint" class="block text-[10px] text-slate-500"></span></div>'; }).join('')}
        </div>
      </div>
      <div id="coa-currency-field" class="hidden">` },
  { mod: 'COA', from: "      document.getElementById('coa-form-currency').value = a.Currency || '';\n",
    to: "      document.getElementById('coa-form-currency').value = a.Currency || '';\n      ['CostCenter', 'ProfitCenter', 'Project'].forEach(k => { document.getElementById('coa-dim-' + k).value = (a.DimensionRules && a.DimensionRules[k]) || ''; });\n" },
  { mod: 'COA', from: "      document.getElementById('coa-form-currency').value = '';\n",
    to: "      document.getElementById('coa-form-currency').value = '';\n      document.querySelectorAll('.coa-dim').forEach(el => { el.value = ''; });\n" },
  { mod: 'COA', from: "      Currency: document.getElementById('coa-currency-field').classList.contains('hidden') ? '' : document.getElementById('coa-form-currency').value,\n",
    to: "      Currency: document.getElementById('coa-currency-field').classList.contains('hidden') ? '' : document.getElementById('coa-form-currency').value,\n      DimensionRules: { CostCenter: document.getElementById('coa-dim-CostCenter').value, ProfitCenter: document.getElementById('coa-dim-ProfitCenter').value, Project: document.getElementById('coa-dim-Project').value },\n" },
  { mod: 'COA', from: "    document.getElementById('coa-currency-field').classList.toggle('hidden', !(document.getElementById('coa-form-postable').checked && parent && parent.CashBank)); // a cash or bank account's currency\n",
    to: `    document.getElementById('coa-currency-field').classList.toggle('hidden', !(document.getElementById('coa-form-postable').checked && parent && parent.CashBank)); // a cash or bank account's currency
    updateDimHints();
  }

  // What a blank dimension rule follows: the nearest heading's, else
  // today's rule (an Expense, Revenue or COGS account needs a cost center).
  function updateDimHints() {
    const type = document.getElementById('coa-form-type').value;
    const byId = id => accounts.find(x => x.AccountID === id);
    ['CostCenter', 'ProfitCenter', 'Project'].forEach(k => {
      let a = byId(document.getElementById('coa-form-parent').value), hops = 0, rule = '', from = '';
      while (a && hops++ < 50 && !rule) { rule = (a.DimensionRules && a.DimensionRules[k]) || ''; from = a.AccountCode; a = byId(a.ParentAccountID); }
      if (!rule) { rule = k === 'CostCenter' && ['Expense', 'Revenue', 'COGS'].includes(type) ? 'Required' : 'Optional'; from = ''; }
      const label = { Required: 'required', Optional: 'optional', NotUsed: 'not used' }[rule];
      document.getElementById('coa-dim-' + k + '-hint').textContent = document.getElementById('coa-dim-' + k).value ? '' : 'Now: ' + label + (from ? ' (from ' + from + ')' : ' (the default)');
    });
` },
  { mod: 'COA', from: "    loadAccountsToFix();\n",
    to: "    loadAccountsToFix();\n    document.querySelectorAll('.coa-dim').forEach(el => el.addEventListener('change', updateDimHints));\n" }
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
