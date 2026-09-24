// Shared plumbing for the emulator suites. Same safety guard as
// stockModules.emulator.test.js: refuses to run unless both Admin SDK
// clients point at local emulators (these suites WIPE the database).
//
// Run suites one file at a time — they share one emulator database:
//   node --test --test-concurrency=1 functions/test/emulator/
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
for (const v of ['FIREBASE_DATABASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[v])) throw new Error(v + ' must point at a local emulator, got ' + process.env[v]);
}
const admin = require('firebase-admin');
const { MODULE_REGISTRY } = require('../../src/moduleRegistry');

const PROJECT = 'erp1-8f4cd';
const app = admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' }, 'suite-' + process.pid + '-' + Math.random());
const rtdb = app.database();
const firestore = app.firestore();

function tokenFor(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: uid, user_id: uid,
    auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' }
  }) + '.';
}

// Invokes a callable over HTTP exactly as httpsCallable does. Throws an
// Error carrying the HttpsError message/status on failure.
async function call(uid, fn, data) {
  const res = await fetch('http://127.0.0.1:5001/' + PROJECT + '/us-central1/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(uid) },
    body: JSON.stringify({ data: data === undefined ? null : data })
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (e) { throw new Error(fn + ': non-JSON response ' + res.status + ' ' + text.slice(0, 200)); }
  if (body.error) { const e = new Error(body.error.message); e.status = body.error.status; throw e; }
  return body.result;
}

// Every capability of every module granted to Admin; Viewer gets access only.
function allPermissions() {
  const p = {};
  MODULE_REGISTRY.forEach(m => {
    p[m.id] = {};
    m.capabilities.forEach(c => { p[m.id][c] = c === 'access' ? ['Admin', 'Viewer'] : ['Admin']; });
  });
  return p;
}

const today = new Date().toISOString().substring(0, 10);

// Base data every module suite starts from (extend per suite).
function baseFixture() {
  return {
    users: {
      'u-admin': { status: 'Active', role: 'Admin', username: 'admin', fullName: 'Admin User', email: 'admin@test.local', AssignedCompanies: ['C1'] },
      'u-approver': { status: 'Active', role: 'Admin', username: 'approver', fullName: 'Approver', AssignedCompanies: ['C1'] },
      'u-viewer': { status: 'Active', role: 'Viewer', username: 'viewer', fullName: 'Viewer', AssignedCompanies: ['C1'] },
      'u-other': { status: 'Active', role: 'Admin', username: 'other', fullName: 'Other Co', AssignedCompanies: ['C2'] }
    },
    roles: {
      Admin: { Name: 'Admin', Status: 'Active' },
      Viewer: { Name: 'Viewer', Status: 'Active' }
    },
    permissions: allPermissions(),
    companies: {
      C1: { Status: 'Active', LegalName: 'Test Co One', CompanyRefCode: '01', GrnClearingAccountID: 'A-CLR', CreatedAt: '2025-01-01' },
      C2: { Status: 'Active', LegalName: 'Test Co Two', CompanyRefCode: '02', GrnClearingAccountID: 'A-CLR', CreatedAt: '2025-01-02' }
    },
    coa: {
      'A-CASH': { AccountCode: '1000', AccountName: 'Cash', AccountType: 'Asset', SubCategory: 'Cash', Status: 'Active', IsPostable: true },
      'A-BANK': { AccountCode: '1100', AccountName: 'Bank', AccountType: 'Asset', SubCategory: 'Bank', Status: 'Active', IsPostable: true },
      'A-AR': { AccountCode: '1200', AccountName: 'Trade Receivables', AccountType: 'Asset', Status: 'Active', IsPostable: true },
      'A-INV': { AccountCode: '1300', AccountName: 'Inventory', AccountType: 'Asset', Status: 'Active', IsPostable: true },
      'A-VATIN': { AccountCode: '1400', AccountName: 'Input VAT', AccountType: 'Asset', Status: 'Active', IsPostable: true },
      'A-AP': { AccountCode: '2000', AccountName: 'Trade Payables', AccountType: 'Liability', Status: 'Active', IsPostable: true },
      'A-CLR': { AccountCode: '2100', AccountName: 'GRN Clearing', AccountType: 'Liability', Status: 'Active', IsPostable: true },
      'A-VATOUT': { AccountCode: '2200', AccountName: 'Output VAT', AccountType: 'Liability', Status: 'Active', IsPostable: true },
      'A-EQ': { AccountCode: '3000', AccountName: 'Capital', AccountType: 'Equity', Status: 'Active', IsPostable: true },
      'A-REV': { AccountCode: '4000', AccountName: 'Sales', AccountType: 'Revenue', Status: 'Active', IsPostable: true },
      'A-CONS': { AccountCode: '5100', AccountName: 'Material Consumption', AccountType: 'Expense', Status: 'Active', IsPostable: true },
      'A-COGS': { AccountCode: '5000', AccountName: 'Cost of Sales', AccountType: 'COGS', Status: 'Active', IsPostable: true }
    },
    uoms: { 'UOM-PCS': { Code: 'PCS', Name: 'Pieces', AllowDecimals: false, DecimalPlaces: 0, Status: 'Active' } },
    items: {
      I1: { ItemCode: 'RM-001', ItemName: 'Steel Sheet', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' }
    },
    orgUnits: {
      WH1: { Type: 'Warehouse', Code: 'WH1', Name: 'Main Store', Status: 'Active', CompanyID: 'C1' },
      WH2: { Type: 'Warehouse', Code: 'WH2', Name: 'Site Store', Status: 'Active', CompanyID: 'C1' },
      CC1: { Type: 'CostCenter', Code: 'CC1', Name: 'Workshop', Status: 'Active', CompanyID: 'C1' }
    },
    vendors: { V1: { VendorCode: 'V001', VendorName: 'Acme Metals', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP' } }
  };
}

async function reset(fixture) {
  await rtdb.ref('/').set(null);
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await rtdb.ref('/').set(fixture);
}

const val = async (p) => (await rtdb.ref(p).get()).val();

module.exports = { app, rtdb, firestore, call, tokenFor, reset, baseFixture, allPermissions, today, val, PROJECT };
