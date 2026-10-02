// Master Data Import, Part 2 (owner, 2026-10-02; docs/modules/MASTER_IMPORT.md):
// Customer Classifications, Sales Types, Requisition Categories, Fixed
// Asset Classes and Master, BOM (a row per component), Inventory Valuation,
// Price Lists (a row per line; an existing list gets the lines added) and
// Users (one temporary password from the screen). Undo covers Firestore
// records, sign-in accounts and the asset-number counter.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const { app, call, reset, baseFixture, val, firestore, PROJECT } = require('./_helpers');
const admin = require('firebase-admin');
if (!admin.apps.some(a => a.name === '[DEFAULT]')) admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const mi = require('../../src/masterImport');

test.after(async () => { await app.delete(); await admin.app().delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const check = (master, rows, extra) => call('u-admin', 'checkMasterImport', Object.assign({ master, text: tsv(rows) }, extra || {}));
const run = (master, rows, extra) => call('u-admin', 'runMasterImport', Object.assign({ master, text: tsv(rows) }, extra || {}));
const list = async path => Object.values((await val(path)) || {});
const msgs = r => r.issues.map(i => (i.row ? 'R' + i.row : 'H') + (i.column ? ' ' + i.column : '') + ': ' + i.message);
const docs = async col => (await firestore.collection(col).get()).docs.map(d => Object.assign({ _id: d.id }, d.data()));

function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SALES': { AccountCode: '4100', AccountName: 'Trading Sales', AccountType: 'Revenue', Status: 'Active', IsPostable: true },
    'A-SRET': { AccountCode: '4900', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true },
    'A-STAT': { AccountCode: '6200', AccountName: 'Stationery', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  f.coa['A-AR'].Status = 'Active';
  f.currencies = { CUR1: { Code: 'AED', Name: 'UAE Dirham', Status: 'Active', IsDefault: true } };
  f.customerClassifications = { CLS1: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' }, CLS2: { Name: 'Export', IsExport: true, Status: 'Active', CompanyID: '' } };
  Object.assign(f.items, {
    FG1: { ItemCode: 'FG-000001', ItemName: 'Steel Cabinet', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' },
    FG2: { ItemCode: 'FG-000002', ItemName: 'Steel Shelf', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' },
    RM2: { ItemCode: 'RM-002', ItemName: 'Bolt', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' }
  });
  f.roles.Accountant = { Name: 'Accountant', Status: 'Active' };
  return f;
}
test.beforeEach(async () => {
  await reset(fixture());
  for (const col of ['faClasses', 'faAssets', 'faAccountDetermination']) for (const d of await docs(col)) await firestore.collection(col).doc(d._id).delete();
  await firestore.collection('faAccountDetermination').doc('DET1').set({ Code: 'VEH', Name: 'Vehicles', Status: 'Active', ByCompany: [] });
});

test('Customer Classifications, Sales Types (restricted to a new classification by name) and Requisition Categories', async () => {
  assert.equal((await run('CLASSIFICATION', [['Name', 'Export'], ['GCC', 'Yes']])).success, true);
  const st = await run('SALESTYPE', [['Name', 'Company', 'Sales Revenue Account', 'Sales Returns Account', 'Restricted to Classification'],
    ['Trading', '01', 'Trading Sales', '4900', 'GCC']]);
  assert.equal(st.success, true, JSON.stringify(st));
  const gcc = Object.entries(await val('customerClassifications')).find(([, c]) => c.Name === 'GCC');
  assert.equal(gcc[1].IsExport, true);
  const type = (await list('salesTypes')).find(t => t.Name === 'Trading');
  assert.deepEqual([type.GLAccountID, type.SalesReturnsAccountID, type.RestrictedToClassificationID], ['A-SALES', 'A-SRET', gcc[0]]);
  const bad = msgs(await check('REQCATEGORY', [['Name', 'Type', 'GL Account'], ['Laptops', 'Fixed Asset', '6200'], ['Paper', 'Direct Expense', '6200']]));
  assert.deepEqual(bad, ['R1 GL Account: GL Account must be Asset.']);
  assert.equal((await run('REQCATEGORY', [['Name', 'Type', 'GL Account'], ['Paper', 'Direct Expense', 'Stationery']])).success, true);
});

test('Fixed Asset Classes and Master: class by code, defaults, cost center, serial numbers, asset numbers by the system', async () => {
  const cls = await run('FACLASS', [['Code', 'Name', 'Kind', 'Default Method', 'Default Useful Life (months)', 'Account Determination'],
    ['VEH', 'Vehicles', 'Tangible', 'Straight Line', '60', 'VEH'], ['LND', 'Land', 'Land', '', '', 'Vehicles']]);
  assert.equal(cls.success, true, JSON.stringify(cls));
  const bad = msgs(await check('FACLASS', [['Code', 'Name', 'Kind', 'Default Method', 'Default Useful Life (months)', 'Account Determination'],
    ['veh', 'Cars', 'Tangible', 'Straight Line', '', 'VEH']]));
  assert.ok(bad.includes('R1 Code: Class code "VEH" is already in use.'), bad.join('\n'));
  assert.ok(bad.some(x => /^R1 Default Useful Life \(months\): Default: Useful life is required/.test(x)), bad.join('\n'));

  const head = ['Company', 'Class', 'Description', 'Serial Number', 'Purchase Date', 'Cost Center', 'Useful Life (months)'];
  const issues = msgs(await check('FAASSET', [head, ['01', 'VEH', 'Truck', 'SN-1', '31/02/2026', '', ''], ['01', 'Vehicles', 'Van', 'sn-1', '', 'CC1', '']]));
  assert.ok(issues.includes('R1 Purchase Date: "31/02/2026" is not a date (dd/mm/yyyy).'), issues.join('\n'));
  assert.ok(issues.includes('R1 Cost Center: Select a Cost Center: depreciation expense is posted to it.'));
  assert.ok(issues.includes('R2 Serial Number: Same serial number as row 1.'));
  const ok = await run('FAASSET', [head, ['01', 'VEH', 'Truck', 'SN-1', '15/01/2026', 'Workshop', ''], ['Test Co One', 'LND', 'Plot 7', '', '', '', '']]);
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.deepEqual(ok.codes, ['FA-01-000001', 'FA-01-000002']);
  const truck = (await docs('faAssets')).find(a => a.Description === 'Truck');
  assert.deepEqual([truck.Status, truck.CostCenterID, truck.PurchaseDate, truck.Areas.BOOK.Method, truck.Areas.BOOK.UsefulLifeMonths], ['Planned', 'CC1', '2026-01-15', 'SL', 60]);
});

test('BOM: a row per component, grouped by parent; one parent\'s columns must agree; an active BOM already there is an issue', async () => {
  const head = ['Parent Item', 'BOM Version', 'Component Item', 'Quantity', 'Scrap %'];
  const bad = msgs(await check('BOM', [head,
    ['FG-000001', '1.0', 'RM-001', '2', ''], ['FG-000001', '2.0', 'Bolt', '8', ''], ['Steel Shelf', '', 'FG-000001', '1', '120']]));
  assert.ok(bad.includes('R2 BOM Version: Differs from row 1, the first row of this BOM.'), bad.join('\n'));
  assert.ok(bad.includes('R3 Component Item: A component must be a Raw Material, Semi-Finished Good or Consumable.'), bad.join('\n'));
  assert.ok(bad.includes('R3 Scrap %: Scrap % must be from 0 to less than 100.'));
  const ok = await run('BOM', [head, ['FG-000001', '1.0', 'RM-001', '2', ''], ['FG-000001', '', 'Bolt', '8', '5'], ['Steel Shelf', '', 'RM-001', '3', '']]);
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.equal(ok.rows, 3);
  const boms = await list('boms');
  assert.equal(boms.length, 2);
  const cab = boms.find(b => b.ParentItemID === 'FG1');
  assert.deepEqual(cab.Components.map(c => [c.ComponentItemID, c.Quantity, c.ScrapPercent]), [['I1', 2, 0], ['RM2', 8, 5]]);
  assert.equal(cab.Status, 'Active');
  assert.deepEqual(msgs(await check('BOM', [head, ['FG-000002', '', 'Bolt', '1', '']])),
    ['R1 Parent Item: This item already has an active BOM; change it on the Bill of Materials screen.']);
});

test('Inventory Valuation: only producible items of the company; one line per item and date', async () => {
  await run('BOM', [['Parent Item', 'Component Item', 'Quantity'], ['FG-000001', 'RM-001', '2']]);
  const head = ['Company', 'Item', 'Unit Cost', 'Effective From'];
  const bad = msgs(await check('VALUATION', [head, ['01', 'FG-000002', '10', '01/01/2026'], ['01', 'Steel Cabinet', '0', '2026-01-01'], ['01', 'FG-000001', '12', '01/01/2026']]));
  assert.ok(bad.includes('R1 Item: Only an active Finished or Semi-Finished Good of this company with an active BOM can have a valuation line.'), bad.join('\n'));
  assert.ok(bad.includes('R2 Unit Cost: Unit cost must be greater than zero.'));
  assert.ok(bad.includes('R3 Item: Same item and date as row 2.'), bad.join('\n'));
  const ok = await run('VALUATION', [head, ['01', 'Steel Cabinet', '125.5', '01/01/2026']]);
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.deepEqual((await list('inventoryValuationLines')).map(l => [l.ItemCode, l.UnitCost, l.EffectiveFrom]), [['FG-000001', 125.5, '2026-01-01']]);
});

test('Price Lists: a new list with its lines; an existing list gets lines added; currency, mapping and duplicate lines checked', async () => {
  const head = ['Company', 'Price List', 'Currency', 'Classification Mapping', 'Item', 'Unit Price', 'Effective From'];
  const ok = await run('PRICELIST', [head, ['01', 'Retail 2026', 'AED', 'Local', 'FG-000001', '199', '01/01/2026'], ['01', 'Retail 2026', '', '', 'Steel Shelf', '99.5', '01/01/2026']]);
  assert.equal(ok.success, true, JSON.stringify(ok));
  const lists = await val('priceLists');
  const [listId, retail] = Object.entries(lists)[0];
  assert.deepEqual([retail.Name, retail.CurrencyID, retail.CustomerClassificationMapping], ['Retail 2026', 'CUR1', 'Local']);
  assert.deepEqual((await list('priceListLines')).map(l => [l.PriceListID, l.ItemCode, l.UnitPrice]).sort(), [[listId, 'FG-000001', 199], [listId, 'FG-000002', 99.5]]);

  const bad = msgs(await check('PRICELIST', [head,
    ['01', 'Retail 2026', '', '', 'FG-000001', '210', '01/01/2026'],     // existing list, same item and date
    ['01', 'Wholesale', '', 'Local', 'Bolt', '1', '01/01/2026']]));      // new list: no currency; Local taken
  assert.ok(bad.includes('R1 Item: This list already has this item from 2026-01-01.'), bad.join('\n'));
  assert.ok(bad.includes('R2 Currency: A new price list needs its currency.'));
  assert.ok(bad.includes('R2 Classification Mapping: "Retail 2026" is already mapped to Local for this company.'));
  const more = await run('PRICELIST', [head, ['01', 'retail 2026', '', '', 'FG-000001', '210', '01/07/2026']]);
  assert.equal(more.success, true, JSON.stringify(more));
  assert.equal(Object.keys(await val('priceLists')).length, 1, 'added to the existing list');
  assert.equal((await list('priceListLines')).length, 3);
});

test('Users: a temporary password is required; users get sign-ins, roles and companies; emails unique', async () => {
  const head = ['Username', 'Full Name', 'Email', 'Role', 'Companies'];
  const rows = [head, ['ali', 'Ali Hassan', 'ali@example.com', 'Accountant', '01'], ['sara', 'Sara Noor', 'sara@example.com', 'viewer', '']];
  assert.deepEqual(msgs(await check('USER', rows)), ['H Temporary password: Type a temporary password of at least 6 characters for these users.']);
  const bad = msgs(await check('USER', [head, ['admin', 'Again', 'ADMIN@test.local', 'Clerk', '01, 02']], { tempPassword: 'Temp#2026' }));
  assert.ok(bad.includes('R1 Username: "admin" already exists.'), bad.join('\n'));
  assert.ok(bad.includes('R1 Email: "ADMIN@test.local" already has a user.'));
  assert.ok(bad.includes('R1 Role: "Clerk" not found.'));
  assert.ok(bad.includes('R1 Companies: You do not have access to company Test Co Two.'), bad.join('\n'));
  const ok = await run('USER', rows, { tempPassword: 'Temp#2026' });
  assert.equal(ok.success, true, JSON.stringify(ok));
  const users = await val('users');
  const [aliId, ali] = Object.entries(users).find(([, u]) => u.username === 'ali');
  assert.deepEqual([ali.role, ali.status, ali.AssignedCompanies, ali.email], ['Accountant', 'Active', ['C1'], 'ali@example.com']);
  assert.equal((await admin.auth().getUserByEmail('ali@example.com')).uid, aliId, 'a sign-in account');
  const log = Object.values(await val('masterImports')).find(l => l.Master === 'USER');
  assert.ok(!JSON.stringify(log).includes('Temp#2026'), 'the password is not logged');
});

test('undo: a failed run removes users\' sign-ins and Firestore assets, and gives the asset number back', async () => {
  const user = { uid: 'u-admin', profile: await val('users/u-admin') };
  const request = { auth: { uid: 'u-admin', token: {} } };
  const u1 = { data: { username: 'temp1', fullName: 'Temp One', email: 'temp1@example.com', role: 'Accountant', assignedCompanies: [] } };
  const u2 = { data: { username: 'temp2', fullName: 'Temp Two', email: 'temp2@example.com', role: 'NO-SUCH-ROLE', assignedCompanies: [] } };
  const res = await mi._importRows(request, user, 'USER', [u1, u2], { tempPassword: 'Temp#2026' });
  assert.equal(res.failure.row, 2);
  assert.ok(!Object.values(await val('users')).some(u => u.username === 'temp1'), 'the user record is removed');
  await assert.rejects(admin.auth().getUserByEmail('temp1@example.com'), /no user record/i, 'and its sign-in');

  await run('FACLASS', [['Code', 'Name', 'Kind', 'Account Determination'], ['LND', 'Land', 'Land', 'VEH']]);
  const clsId = (await docs('faClasses'))[0]._id;
  const a1 = { data: { CompanyID: 'C1', ClassID: clsId, Description: 'Plot 1', Quantity: '' } };
  const a2 = { data: { CompanyID: 'C1', ClassID: 'NO-CLASS', Description: 'Plot 2', Quantity: '' } };
  const fa = await mi._importRows(request, user, 'FAASSET', [a1, a2]);
  assert.equal(fa.failure.row, 2);
  assert.deepEqual(await docs('faAssets'), [], 'the asset is removed');
  assert.equal(await val('fa/counters/asset/01'), 0, 'its number is given back');
});
