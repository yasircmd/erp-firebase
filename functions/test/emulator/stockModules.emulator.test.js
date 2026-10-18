// End-to-end test of the four ported stock modules AS THEIR SCREENS
// CALL THEM, against the real firebase-admin / firebase-functions
// packages running in the local emulators (not the stubs the earlier
// per-module tests used).
//
// Run (from the repo root):
//   firebase emulators:start --only database,firestore,functions --project erp1-8f4cd
//   node --test functions/test/emulator/
//
// Every callable is invoked over HTTP exactly the way httpsCallable
// does it ({ data } body, Bearer ID token). The functions emulator
// skips ID-token signature verification when the Auth emulator isn't
// running, so an unsigned token with the right claims is enough here.
//
// SAFETY: this file wipes the database it talks to. It refuses to run
// unless both Admin SDK clients are pointed at local emulators —
// Application Default Credentials are present in Cloud Shell, so a
// missing env var here would otherwise mean writing to production.
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
for (const v of ['FIREBASE_DATABASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[v])) throw new Error(v + ' must point at a local emulator, got ' + process.env[v]);
}

const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
// The moved transaction documents are in Firestore (src/movedPaths.js),
// read here by their RTDB paths. Loaded before this file's own app:
// firebaseAdmin.js makes the default app only when none exists yet.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
const movedPaths = require('../../src/movedPaths');

const PROJECT = 'erp1-8f4cd';
const FUNCTIONS_BASE = 'http://127.0.0.1:5001/' + PROJECT + '/us-central1/';
const app = admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' }, 'emulator-test');
const rtdb = app.database();
const val = async p => (movedPaths.isMoved(p) ? movedPaths.request(p, 'get') : (await rtdb.ref(p).get()).val());
const firestore = app.firestore();

function tokenFor(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: uid, user_id: uid,
    auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' }
  }) + '.';
}

// Returns the callable's result, or throws an Error carrying the
// HttpsError's message/status — the same thing the screen's
// withFailureHandler would receive.
async function call(uid, fn, data) {
  const res = await fetch(FUNCTIONS_BASE + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(uid) },
    body: JSON.stringify({ data: data === undefined ? null : data })
  });
  const body = await res.json();
  if (body.error) { const e = new Error(body.error.message); e.status = body.error.status; throw e; }
  return body.result;
}

const today = new Date().toISOString().substring(0, 10);
const ACCESS_ALL = ['Admin', 'Viewer'];
const perms = { access: ACCESS_ALL, draft: ['Admin'], post: ['Admin'] };

const FIXTURE = {
  users: {
    'u-admin': { status: 'Active', role: 'Admin', username: 'admin', fullName: 'Admin User', AssignedCompanies: ['C1'] },
    'u-approver': { status: 'Active', role: 'Admin', username: 'approver', fullName: 'Approver', AssignedCompanies: ['C1'] },
    'u-viewer': { status: 'Active', role: 'Viewer', username: 'viewer', fullName: 'Viewer', AssignedCompanies: ['C1'] },
    'u-other': { status: 'Active', role: 'Admin', username: 'other', fullName: 'Other Co', AssignedCompanies: ['C2'] }
  },
  permissions: { STOCKADJUSTMENT: perms, MATERIALISSUE: perms, GRN: perms, WAREHOUSEMOVEMENT: perms, JV: perms },
  companies: {
    C1: { Status: 'Active', LegalName: 'Test Co One', CompanyRefCode: '01', GrnClearingAccountID: 'A-CLR', CreatedAt: '2025-01-01' },
    C2: { Status: 'Active', LegalName: 'Test Co Two', CompanyRefCode: '02', GrnClearingAccountID: 'A-CLR', CreatedAt: '2025-01-02' }
  },
  coa: {
    'A-INV': { AccountCode: '1300', AccountName: 'Inventory', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-CLR': { AccountCode: '2100', AccountName: 'GRN Clearing', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-CONS': { AccountCode: '5100', AccountName: 'Material Consumption', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  },
  uoms: { 'UOM-PCS': { Code: 'PCS', Name: 'Pieces', AllowDecimals: false, DecimalPlaces: 0, Status: 'Active' } },
  items: {
    I1: { ItemCode: 'RM-001', ItemName: 'Steel Sheet', Category: 'Raw', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' },
    I2: { ItemCode: 'RM-900', ItemName: 'Other Co Item', Category: 'Raw', Status: 'Active', CompanyID: 'C2', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' },
    I3: { ItemCode: 'RM-OLD', ItemName: 'Retired', Category: 'Raw', Status: 'Inactive', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' }
  },
  orgUnits: {
    WH1: { Type: 'Warehouse', Code: 'WH1', Name: 'Main Store', Status: 'Active', CompanyID: 'C1' },
    WH2: { Type: 'Warehouse', Code: 'WH2', Name: 'Site Store', Status: 'Active', CompanyID: 'C1' },
    CC1: { Type: 'CostCenter', Code: 'CC1', Name: 'Workshop', Status: 'Active', CompanyID: 'C1' },
    WHX: { Type: 'Warehouse', Code: 'WHX', Name: 'Other Co Store', Status: 'Active', CompanyID: 'C2' }
  },
  vendors: {
    V1: { VendorCode: 'V001', VendorName: 'Acme Metals', Status: 'Active', CompanyID: 'C1' },
    V2: { VendorCode: 'V900', VendorName: 'Other Co Vendor', Status: 'Active', CompanyID: 'C2' }
  }
};

// Quantity/cost only — ledger nodes also carry an UpdatedAt stamp.
function balance(l) { return { Quantity: l.Quantity, AvgCost: l.AvgCost, TotalValue: l.TotalValue }; }
async function ledger(itemId, wh) {
  return balance((await val('stock/ledger/' + itemId + '/' + wh)) || { Quantity: 0, AvgCost: 0, TotalValue: 0 });
}

const state = {};

test.before(async () => {
  await rtdb.ref('/').set(null);
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await rtdb.ref('/').set(FIXTURE);
});
test.after(async () => { await app.delete(); });

// ---------- master data / helpers ----------

test('getModulePermissionsForUser: Admin can draft+post, Viewer neither', async () => {
  assert.deepEqual(await call('u-admin', 'getModulePermissionsForUser', { moduleId: 'grn' }), { canDraft: true, canPost: true });
  assert.deepEqual(await call('u-viewer', 'getModulePermissionsForUser', { moduleId: 'GRN' }), { canDraft: false, canPost: false });
  // JV / CBT also say whether the user may re-match (docs/modules/UX_TIER3.md G).
  // (this suite's fixture gives no JV / CBT rights; the rematch suite covers the right itself)
  assert.deepEqual(Object.keys(await call('u-admin', 'getModulePermissionsForUser', { moduleId: 'cbt' })), ['canDraft', 'canPost', 'canRematch']);
  assert.deepEqual(await call('u-viewer', 'getModulePermissionsForUser', { moduleId: 'JV' }), { canDraft: false, canPost: false, canRematch: false });
});

test('getActiveItems: only Active items in the caller\'s companies', async () => {
  const items = await call('u-admin', 'getActiveItems');
  assert.deepEqual(items.map(i => i.ItemID), ['I1']);
  assert.equal(items[0].InventoryAccountID, 'A-INV');
  assert.equal(items[0].BatchTracked, false);
  assert.deepEqual((await call('u-other', 'getActiveItems')).map(i => i.ItemID), ['I2']);
});

test('getActiveOrgUnits / getActiveVendors: company-filtered', async () => {
  assert.deepEqual((await call('u-admin', 'getActiveOrgUnits')).map(u => u.UnitID).sort(), ['CC1', 'WH1', 'WH2']);
  assert.deepEqual((await call('u-admin', 'getActiveVendors')).map(v => v.VendorID), ['V1']);
});

test('getActiveUOMs: seeds the 4 missing defaults once, never duplicates', async () => {
  const first = await call('u-admin', 'getActiveUOMs');
  assert.deepEqual(first.map(u => u.Code).sort(), ['BOX', 'KG', 'LTR', 'MTR', 'PCS']);
  const second = await call('u-admin', 'getActiveUOMs');
  assert.equal(second.length, 5);
  assert.equal(Object.keys((await rtdb.ref('uoms').get()).val()).length, 5);
  assert.equal(first.find(u => u.Code === 'KG').DecimalPlaces, 3);
});

test('unauthenticated or unknown users are rejected', async () => {
  await assert.rejects(call('u-nobody', 'getActiveItems'), /inactive or not configured/);
});

// ---------- GRN: establishes stock ----------

test('GRN: save + post returns success:true and creates stock + GL', async () => {
  const save = await call('u-admin', 'saveGrnDraft', {
    TransactionDate: today, Description: 'Steel receipt', Reference: 'DN-1', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 10, UnitCost: 5, Description: 'Steel sheets' }]
  });
  assert.equal(save.success, true);
  const post = await call('u-admin', 'postGrn', { grnId: save.grnId });
  assert.equal(post.success, true);
  assert.equal(post.status, 'Posted');
  state.grnId = save.grnId;
  state.grnJv = (await val('stock/transactions/' + save.grnId)).LinkedJVID;
  assert.ok(state.grnJv, 'GRN has a LinkedJVID');
  assert.deepEqual(await ledger('I1', 'WH1'), { Quantity: 10, AvgCost: 5, TotalValue: 50 });
});

test('getGrnEntries lists the posted GRN', async () => {
  const r = await call('u-admin', 'getGrnEntries', { limit: 100 });
  assert.equal(r.total, 1);
  assert.equal(r.entries[0].GRNID, state.grnId);
});

test('getStockLedgerEntryPublic: returns the balance; zeros when none', async () => {
  assert.deepEqual(balance(await call('u-admin', 'getStockLedgerEntryPublic', { itemId: 'I1', warehouseId: 'WH1' })), { Quantity: 10, AvgCost: 5, TotalValue: 50 });
  assert.deepEqual(await call('u-admin', 'getStockLedgerEntryPublic', { itemId: 'I1', warehouseId: 'WH2' }), { Quantity: 0, AvgCost: 0, TotalValue: 0 });
  await assert.rejects(call('u-admin', 'getStockLedgerEntryPublic', { itemId: 'I1' }), /Item and warehouse are required/);
});

test('getJournalEntryDetail: balanced lines with account names; blocked for other company', async () => {
  const jv = await call('u-admin', 'getJournalEntryDetail', { jvId: state.grnJv });
  assert.equal(jv.TotalDebit, 50);
  assert.equal(jv.TotalCredit, 50);
  assert.deepEqual(jv.Lines.map(l => [l.AccountCode, l.AccountName, l.Debit, l.Credit]).sort(),
    [['1300', 'Inventory', 50, 0], ['2100', 'GRN Clearing', 0, 50]]);
  await assert.rejects(call('u-other', 'getJournalEntryDetail', { jvId: state.grnJv }), /do not have access to that company/);
  await assert.rejects(call('u-admin', 'getJournalEntryDetail', { jvId: 'NOPE' }), /Journal entry not found/);
});

test('updatePostedDescription: poster can edit; Viewer and blank are refused, GL untouched', async () => {
  const doc = () => firestore.collection('journalEntries').doc(state.grnJv).get().then(d => d.data());
  const denied = await call('u-viewer', 'updatePostedDescription', { jvId: state.grnJv, description: 'hacked' });
  assert.deepEqual(denied, { success: false, error: 'You do not have permission to post or reverse entries in GRN.' });
  const blank = await call('u-admin', 'updatePostedDescription', { jvId: state.grnJv, description: '   ' });
  assert.equal(blank.success, false);
  assert.equal((await doc()).Description, 'Steel receipt');

  assert.deepEqual(await call('u-admin', 'updatePostedDescription', { jvId: state.grnJv, description: 'Steel receipt (corrected)' }), { success: true });
  const after = await doc();
  assert.equal(after.Description, 'Steel receipt (corrected)');
  assert.equal(after.TotalDebit, 50, 'amounts untouched');
  assert.equal(after.UpdatedBy, 'admin');
});

// ---------- Material Issue, Stock Adjustment, Warehouse Movement ----------

test('Material Issue: issue 3 → WH1 7', async () => {
  const save = await call('u-admin', 'saveMaterialIssueDraft', {
    TransactionDate: today, Description: 'Issue to workshop', CompanyID: 'C1', EntryType: 'Issue', CostCenterID: 'CC1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 3, Description: 'Cutting', CostCenterID: 'CC1' }]
  });
  assert.equal(save.success, true);
  const post = await call('u-admin', 'postMaterialIssue', { miId: save.miId });
  assert.equal(post.success, true);
  state.miId = save.miId;
  assert.equal((await ledger('I1', 'WH1')).Quantity, 7);
});

test('Stock Adjustment: decrease 1 → WH1 6', async () => {
  const save = await call('u-admin', 'saveStockAdjustmentDraft', {
    TransactionDate: today, Description: 'Damaged sheet', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', AdjustmentDirection: 'Decrease', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, Description: 'Damaged', CostCenterID: 'CC1' }]
  });
  assert.equal(save.success, true);
  const post = await call('u-admin', 'postStockAdjustment', { adjId: save.adjId });
  assert.equal(post.success, true);
  state.adjId = save.adjId;
  assert.equal((await ledger('I1', 'WH1')).Quantity, 6);
});

test('Warehouse Movement: move 2 WH1→WH2', async () => {
  const save = await call('u-admin', 'saveWarehouseMovementDraft', {
    TransactionDate: today, Description: 'To site', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, Description: 'Transfer' }]
  });
  assert.equal(save.success, true);
  const post = await call('u-admin', 'postWarehouseMovement', { moveId: save.moveId });
  assert.equal(post.success, true);
  state.moveId = save.moveId;
  assert.equal((await ledger('I1', 'WH1')).Quantity, 4);
  assert.deepEqual(await ledger('I1', 'WH2'), { Quantity: 2, AvgCost: 5, TotalValue: 10 });
});

// ---------- approval flow ----------

test('approval: pending banner level only for the assigned approver; approve posts it', async () => {
  await rtdb.ref('approvalConfigurations/STOCKADJUSTMENT').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/STOCKADJUSTMENT/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });

  const save = await call('u-admin', 'saveStockAdjustmentDraft', {
    TransactionDate: today, Description: 'Found sheet', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', AdjustmentDirection: 'Increase', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, Description: 'Found', CostCenterID: 'CC1' }]
  });
  const post = await call('u-admin', 'postStockAdjustment', { adjId: save.adjId });
  assert.deepEqual(post, { success: true, status: 'PendingApproval' });
  const instanceId = (await val('stock/transactions/' + save.adjId)).ApprovalInstanceID;

  assert.equal(await call('u-approver', 'getMyPendingApprovalLevel', { approvalInstanceId: instanceId }), 1);
  assert.equal(await call('u-admin', 'getMyPendingApprovalLevel', { approvalInstanceId: instanceId }), null);
  assert.equal(await call('u-approver', 'getMyPendingApprovalLevel', {}), null);
  assert.equal((await ledger('I1', 'WH1')).Quantity, 4, 'nothing moves before approval');

  const decided = await call('u-approver', 'decideStockAdjustmentApproval', { adjId: save.adjId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(decided.success, true);
  assert.equal(decided.status, 'Approved');
  assert.equal((await ledger('I1', 'WH1')).Quantity, 5);
  assert.equal(await call('u-approver', 'getMyPendingApprovalLevel', { approvalInstanceId: instanceId }), null);
  state.adj2Id = save.adjId;

  await rtdb.ref('approvalConfigurations/STOCKADJUSTMENT').set(null);
});

// ---------- reversals, newest first ----------

test('reverse Warehouse Movement: BOTH sides restored (live-bug regression)', async () => {
  const r = await call('u-admin', 'reverseWarehouseMovement', { moveId: state.moveId, reversalDate: today });
  assert.equal(r.success, true);
  assert.equal((await ledger('I1', 'WH1')).Quantity, 7);
  assert.equal((await ledger('I1', 'WH2')).Quantity, 0);
});

test('reverse both Stock Adjustments and the Material Issue', async () => {
  assert.equal((await call('u-admin', 'reverseStockAdjustment', { adjId: state.adj2Id, reversalDate: today })).success, true);
  assert.equal((await ledger('I1', 'WH1')).Quantity, 6);
  assert.equal((await call('u-admin', 'reverseStockAdjustment', { adjId: state.adjId, reversalDate: today })).success, true);
  assert.equal((await ledger('I1', 'WH1')).Quantity, 7);
  assert.equal((await call('u-admin', 'reverseMaterialIssue', { miId: state.miId, reversalDate: today })).success, true);
  assert.equal((await ledger('I1', 'WH1')).Quantity, 10);
});

test('reverse GRN: stock back to zero', async () => {
  assert.equal((await call('u-admin', 'reverseGrn', { grnId: state.grnId, reversalDate: today })).success, true);
  assert.equal((await ledger('I1', 'WH1')).Quantity, 0);
});

test('delete draft: save then delete removes it', async () => {
  const save = await call('u-admin', 'saveMaterialIssueDraft', {
    TransactionDate: today, Description: 'Scratch', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, Description: 'x', CostCenterID: 'CC1' }]
  });
  assert.deepEqual(await call('u-admin', 'deleteMaterialIssueDraft', { miId: save.miId }), { success: true });
  assert.equal((await val('stock/transactions/' + save.miId)), null);
});

// ---------- the screens themselves ----------

test('getModuleFragment serves all four ported screens, with no google.script.run left', async () => {
  // Screens come from the active release (screenRelease suite); the wipe above removed any.
  const screenRelease = require('../../../tools/screen-release');
  const { MODULE_REGISTRY } = require('../../src/moduleRegistry');
  await screenRelease.releaseScreens(firestore, { screens: screenRelease.loadScreens(), registryIds: MODULE_REGISTRY.map(m => m.id), commit: 'stock-' + Date.now() });
  for (const id of ['STOCKADJUSTMENT', 'MATERIALISSUE', 'GRN', 'WAREHOUSEMOVEMENT']) {
    const r = await call('u-admin', 'getModuleFragment', { moduleId: id });
    assert.ok(r.html.length > 10000, id + ' html served');
    assert.ok(!r.html.includes('google.script.run'), id + ' fully converted');
    assert.equal(r.canWrite, false, id + ': these modules have no "write" capability, same as the registry');
  }
});

// ---------- the user sees WHY a call failed (not a bare "INTERNAL") ----------

test('blocked GRN reversal reports the insufficient-stock reason', async () => {
  const g = await call('u-admin', 'saveGrnDraft', {
    TransactionDate: today, Description: 'Small receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 5, UnitCost: 5, Description: 'x' }]
  });
  await call('u-admin', 'postGrn', { grnId: g.grnId });
  const m = await call('u-admin', 'saveMaterialIssueDraft', {
    TransactionDate: today, Description: 'Consume most', CompanyID: 'C1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 4, Description: 'x', CostCenterID: 'CC1' }]
  });
  await call('u-admin', 'postMaterialIssue', { miId: m.miId });
  await assert.rejects(call('u-admin', 'reverseGrn', { grnId: g.grnId, reversalDate: today }),
    e => /insufficient stock for RM-001/.test(e.message) && e.status === 'FAILED_PRECONDITION');
  assert.equal((await ledger('I1', 'WH1')).Quantity, 1, 'nothing moved');
});

test('permission failures report the reason', async () => {
  await assert.rejects(call('u-viewer', 'saveGrnDraft', { TransactionDate: today, Description: 'x', CompanyID: 'C1', VendorID: 'V1', Lines: [] }),
    /do not have permission to create or edit entries in GRN/);
});
