// Master Data Import, Part 3b (owner, 2026-10-05; docs/modules/MASTER_IMPORT.md,
// decisions 12-14): "Update existing" for the other masters with a code:
// Company, Organizational Units, Chart of Accounts, Currencies, UOM, Items,
// Vendors, Customers, Fixed Asset Classes and Master, Users. Each row is saved
// through the master's own save with the record's id; the columns its code
// is built from (and those postings depend on) are refused; Copy current
// records pastes back unchanged for every one of them; a save that fails puts
// back the rows saved before it.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const { app, call, reset, baseFixture, val, firestore, PROJECT } = require('./_helpers');
const admin = require('firebase-admin');
if (!admin.apps.some(a => a.name === '[DEFAULT]')) admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const mi = require('../../src/masterImport');

test.after(async () => { await app.delete(); await admin.app().delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const check = (master, rows, uid) => call(uid || 'u-admin', 'checkMasterImport', { master, mode: 'update', text: tsv(rows) });
const run = (master, rows, uid) => call(uid || 'u-admin', 'runMasterImport', { master, mode: 'update', text: tsv(rows) });
const add = (master, rows) => call('u-admin', 'runMasterImport', { master, text: tsv(rows) });
const msgs = r => r.issues.map(i => (i.row ? 'R' + i.row : 'H') + (i.column ? ' ' + i.column : '') + ': ' + i.message);
const UPDATABLE = ['COMPANY', 'ORGUNIT', 'ACCOUNT', 'CURRENCY', 'UOM', 'ITEM', 'VENDOR', 'CUSTOMER', 'FACLASS', 'FAASSET', 'USER', 'EMPLOYEE'];
let ASSET = '';

test.before(async () => {
  const f = baseFixture();
  f.companies.C1.TaxNumbers = [{ Type: 'TRN', Number: '100111' }, { Type: 'Excise', Number: 'EX-9' }];
  f.currencies = { 'CUR-USD': { Code: 'USD', Name: 'US Dollar', Symbol: '$', Status: 'Active' } };
  f.customerClassifications = { CL1: { Name: 'Local', IsExport: false, Status: 'Active' } };
  f.customers = { K1: { CustomerCode: 'CL-0001', CustomerName: 'Gulf Retail', Category: 'Retailer', Classification: 'CL1', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 30, Status: 'Active' } };
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Copper Wire', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.users['u-approver'].status = 'Inactive';
  f.vendors.V1.Classification = 'Local';
  f.users['u-admin'].AssignedCompanies = ['C1', 'C2'];
  f.coa['A-FA'] = { AccountCode: '1500', AccountName: 'Equipment', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  await reset(f);
  await firestore.collection('faAccountDetermination').doc('DET1').set({ Code: 'EQD', Name: 'Equipment accounts', Status: 'Active', ByCompany: [] });
  const cls = await add('FACLASS', [['Code', 'Name', 'Kind', 'Default Method', 'Default Useful Life (months)', 'Account Determination'], ['EQ', 'Equipment', 'Tangible', 'Straight Line', '60', 'EQD']]);
  assert.equal(cls.success, true, JSON.stringify(cls.issues));
  const asset = await add('FAASSET', [['Company', 'Class', 'Description', 'Cost Center'], ['01', 'EQ', 'Lathe', 'CC1']]);
  assert.equal(asset.success, true, JSON.stringify(asset.issues));
  ASSET = asset.codes[0];
});

test('the specs: every master with a code can be updated; those without one, and the versioned ones, can\'t (decisions 12-13)', async () => {
  const specs = await call('u-admin', 'getMasterImportSpecs', {});
  assert.deepEqual(specs.filter(s => s.update).map(s => s.key).sort(), UPDATABLE.slice().sort());
  const key = k => specs.find(s => s.key === k).update.key;
  assert.deepEqual(['COMPANY', 'ACCOUNT', 'ITEM', 'VENDOR', 'CUSTOMER', 'FAASSET', 'USER'].map(key), ['Ref Code', 'Account Code', 'Item Code', 'Vendor Code', 'Customer Code', 'Asset No.', 'Username']);
  for (const k of ['SUBCATEGORY', 'CLASSIFICATION', 'SALESTYPE', 'REQCATEGORY', 'BOM', 'VALUATION', 'PRICELIST']) {
    assert.match(msgs(await check(k, [['Name'], ['x']])).join(), /can't be updated by import yet/, k);
  }
});

test('Copy current records pastes back unchanged, for every master', async () => {
  for (const k of UPDATABLE) {
    const r = await call('u-admin', 'getMasterImportRecords', { master: k });
    if (!r.count) continue;
    const c = await check(k, r.text.split('\n').map(l => l.split('\t')));
    assert.deepEqual(c.issues, [], k + ': ' + JSON.stringify(c.issues));
    assert.ok(c.changes.every(x => !x.length), k + ': ' + JSON.stringify(c.changes.filter(x => x.length)));
  }
});

test('the locked columns are refused, with the reason', async () => {
  const cases = [['COMPANY', 'Ref Code', '01', 'Tax Number'], ['ORGUNIT', 'Code', 'WH1', 'Type'], ['ACCOUNT', 'Account Code', '1000', 'Account Type'],
    ['ACCOUNT', 'Account Code', '1000', 'Parent Account'], ['ACCOUNT', 'Account Code', '1000', 'Postable'], ['ITEM', 'Item Code', 'RM-001', 'Category'],
    ['VENDOR', 'Vendor Code', 'V001', 'Company'], ['CUSTOMER', 'Customer Code', 'CL-0001', 'Company'], ['FACLASS', 'Code', 'EQ', 'Kind'],
    ['FAASSET', 'Asset No.', ASSET, 'Class'], ['USER', 'Username', 'viewer', 'Email'], ['UOM', 'Code', 'PCS', 'Code']];
  for (const [k, key, code, col] of cases) {
    const r = await check(k, [[key, col], [code, 'x']]);
    // The key's own column (UOM "Code") is the key, never a second column.
    if (col === key) { assert.match(msgs(r).join(), /appears twice/, k); continue; }
    assert.match(msgs(r).join(), new RegExp('H ' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': .* can\'t be changed here'), k + ' ' + col);
  }
});

test('updated through each master\'s own save: only the pasted columns; the rest kept (a company\'s tax numbers, a user\'s status)', async () => {
  const ok = async (k, rows, n) => { const r = await run(k, rows); assert.deepEqual(r, { success: true, rows: rows.length - 1, updated: n }, k + ' ' + JSON.stringify(r)); };
  await ok('COMPANY', [['Ref Code', 'City'], ['01', 'Dubai']], 1);
  assert.deepEqual([(await val('companies/C1')).City, (await val('companies/C1')).TaxNumbers.length, (await val('companies/C1')).LegalName], ['Dubai', 2, 'Test Co One']);
  await ok('ORGUNIT', [['Code', 'Name'], ['WH2', 'Site Store B']], 1);
  assert.equal((await val('orgUnits/WH2')).Name, 'Site Store B');
  await ok('ACCOUNT', [['Account Code', 'Account Name'], ['1000', 'Petty Cash']], 1);
  assert.deepEqual([(await val('coa/A-CASH')).AccountName, (await val('coa/A-CASH')).AccountType, (await val('coa/A-CASH')).AccountCode], ['Petty Cash', 'Asset', '1000']);
  await ok('CURRENCY', [['Code', 'Name'], ['USD', 'United States Dollar']], 1);
  assert.equal((await val('currencies/CUR-USD')).Name, 'United States Dollar');
  await ok('UOM', [['Code', 'Name'], ['PCS', 'Pieces (each)']], 1);
  await ok('ITEM', [['Item Code', 'Default Warehouse', 'Reorder Level'], ['RM-001', 'WH1', '25'], ['RM-002', '', '']], 1);
  const i1 = await val('items/I1');
  assert.deepEqual([i1.DefaultWarehouseID, Number(i1.ReorderLevel), i1.ItemName, i1.ItemCode, i1.Category], ['WH1', 25, 'Steel Sheet', 'RM-001', 'RawMaterial']);
  await ok('VENDOR', [['Vendor Code', 'Payment Terms (days)', 'Phone'], ['V001', '45', '+971 4 111']], 1);
  assert.deepEqual([Number((await val('vendors/V1')).PaymentTermsDays), (await val('vendors/V1')).Phone, (await val('vendors/V1')).VendorName], [45, '+971 4 111', 'Acme Metals']);
  await ok('CUSTOMER', [['Customer Code', 'Contact Person'], ['CL-0001', 'Sara']], 1);
  assert.deepEqual([(await val('customers/K1')).ContactPerson, (await val('customers/K1')).CustomerName], ['Sara', 'Gulf Retail']);
  await ok('FACLASS', [['Code', 'Name'], ['EQ', 'Plant and Equipment']], 1);
  const cls = (await firestore.collection('faClasses').get()).docs.map(d => d.data()).find(c => c.Code === 'EQ');
  assert.deepEqual([cls.Name, cls.Kind], ['Plant and Equipment', 'Tangible']);
  await ok('FAASSET', [['Asset No.', 'Description', 'Notes'], [ASSET, 'Lathe, CNC', 'Bay 2']], 1);
  const a = (await firestore.collection('faAssets').get()).docs.map(d => d.data()).find(x => x.AssetNumber === ASSET);
  assert.deepEqual([a.Description, a.Notes, a.Status], ['Lathe, CNC', 'Bay 2', 'Planned']);
  await ok('USER', [['Username', 'Full Name', 'Companies'], ['approver', 'Approver One', '01, 02']], 1);
  const v = await val('users/u-approver');
  assert.deepEqual([v.fullName, v.AssignedCompanies, v.status, v.role], ['Approver One', ['C1', 'C2'], 'Inactive', 'Admin']);
});

test('rights and access: the master\'s own right; a record of another company; a user can\'t be given a company the importer lacks', async () => {
  assert.match(msgs(await check('ITEM', [['Item Code', 'Reorder Level'], ['RM-001', '5']], 'u-viewer')).join(), /permission to change Items/);
  assert.match(msgs(await check('USER', [['Username', 'Companies'], ['approver', '01, 03']])).join(), /"03" not found/);
  // u-other (company 02 only): may add 02 to the viewer (who keeps 01), but not give itself 01.
  const lim = await check('USER', [['Username', 'Companies'], ['viewer', '01, 02']], 'u-other');
  assert.deepEqual(lim.issues, [], JSON.stringify(lim.issues));
  assert.match(msgs(await check('USER', [['Username', 'Companies'], ['other', '01, 02']], 'u-other')).join(), /You do not have access to company Test Co One/);
});

test('a save that fails during the update puts back the rows saved before it', async () => {
  const user = { uid: 'u-admin', profile: await val('users/u-admin') };
  const res = await mi._updateRows({ auth: { uid: 'u-admin', token: {} } }, user, 'ITEM', [
    { id: 'I2', row: 1, set: { ItemName: 'Copper Wire 2mm' } }, { id: 'I1', row: 2, set: { UOMID: 'NO-SUCH-UOM' } }]);
  assert.equal(res.failure.row, 2);
  assert.match(res.failure.message, /Unit of Measure not found/);
  assert.equal((await val('items/I2')).ItemName, 'Copper Wire', 'the first row is put back');
});
