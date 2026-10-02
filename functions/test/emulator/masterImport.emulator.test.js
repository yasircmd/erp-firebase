// Master Data Import (owner, 2026-10-02; docs/modules/MASTER_IMPORT.md),
// Part 1: paste from Excel, check every row (issues by row and column),
// import all or nothing through each master's own save, codes made by the
// system, references by code or exact name (also to a row above), the
// same name twice is an issue, and a failed import is undone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, PROJECT } = require('./_helpers');
// The undo test runs the import code in this process: it needs the default
// app, on the emulators (_helpers has set their hosts).
const admin = require('firebase-admin');
if (!admin.apps.some(a => a.name === '[DEFAULT]')) admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const mi = require('../../src/masterImport');

test.after(async () => { await app.delete(); await admin.app().delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const check = (master, rows, uid) => call(uid || 'u-admin', 'checkMasterImport', { master, text: tsv(rows) });
const run = (master, rows, uid) => call(uid || 'u-admin', 'runMasterImport', { master, text: tsv(rows) });
const list = async path => Object.values((await val(path)) || {});
const msgs = r => r.issues.map(i => (i.row ? 'R' + i.row : 'H') + (i.column ? ' ' + i.column : '') + ': ' + i.message);

function fixture() {
  const f = baseFixture();
  f.coa['A-AR'].Status = 'Active';
  f.customerClassifications = {
    CLS1: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' },
    CLS2: { Name: 'Export', IsExport: true, Status: 'Active', CompanyID: '' }
  };
  return f;
}
test.beforeEach(async () => { await reset(fixture()); });

test('the list, in import order, with each one\'s columns; a Viewer has no access', async () => {
  const specs = await call('u-admin', 'getMasterImportSpecs', {});
  assert.deepEqual(specs.map(s => s.key), ['COMPANY', 'ORGUNIT', 'ACCOUNT', 'CURRENCY', 'UOM', 'SUBCATEGORY', 'ITEM', 'VENDOR', 'CLASSIFICATION', 'CUSTOMER',
    'SALESTYPE', 'REQCATEGORY', 'FACLASS', 'FAASSET', 'BOM', 'VALUATION', 'PRICELIST', 'USER']);
  const item = specs.find(s => s.key === 'ITEM');
  assert.ok(!item.columns.some(c => /code/i.test(c.header) && c.header !== 'Item Code' && /^Item Code$/.test(c.header)), 'no item code column');
  assert.equal(item.columns.find(c => c.header === 'Category').values.join(), 'Raw Material,Semi Finished Good,Finished Good,Consumable,Scrap');
  const f = fixture();
  f.permissions.MASTERIMPORT.access = ['Admin'];
  await reset(f);
  await assert.rejects(call('u-viewer', 'getMasterImportSpecs', {}), /do not have access to Master Data Import/);
});

test('Chart of Accounts: a header and its children in one paste; codes made by the system', async () => {
  const rows = [
    ['Account Name', 'Account Type', 'Postable', 'Parent Account', 'Company'],
    ['Current Assets', 'Asset', 'No', '', ''],
    ['Petty Cash', 'asset', 'Yes', 'Current Assets', '01'],
    ['Bank - Main', 'Asset', 'y', 'current assets', 'Test Co One']
  ];
  const c = await check('ACCOUNT', rows);
  assert.deepEqual(msgs(c), []);
  assert.equal(c.rows.length, 3);
  const r = await run('ACCOUNT', rows);
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.created, 3);
  const coa = await list('coa');
  const header = coa.find(a => a.AccountName === 'Current Assets');
  const petty = coa.find(a => a.AccountName === 'Petty Cash');
  assert.match(header.AccountCode, /^1\d0000$/);
  assert.equal(header.IsPostable, false);
  assert.equal(petty.CompanyID, 'C1');
  assert.equal(petty.AccountCode.slice(0, 2), header.AccountCode.slice(0, 2), 'under its header');
  assert.equal((await val('masterImports')) && Object.values(await val('masterImports'))[0].Status, 'Imported');
});

test('issues are listed by row and column, and nothing is written', async () => {
  const rows = [
    ['Account Name', 'Account Type', 'Postable', 'Parent Account', 'Colour'],
    ['Cash', 'Asset', 'Yes', '', ''],                   // exists already
    ['Fuel', 'Expences', 'Yes', '', ''],                // bad type
    ['Rent', 'Expense', 'Maybe', 'Nowhere', ''],        // bad yes/no, parent not found
    ['Rent', 'Expense', 'Yes', '', ''],                 // same as row 3
    ['', 'Expense', 'Yes', '', '']                      // name missing
  ];
  const c = await check('ACCOUNT', rows);
  const m = msgs(c);
  assert.ok(m.includes('H Colour: Unknown column "Colour". Copy the headers again from this screen.'), m.join('\n'));
  assert.ok(m.includes('R1 Account Name: "Cash" already exists.'), m.join('\n'));
  assert.ok(m.some(x => /^R2 Account Type: "Expences" is not one of: Asset, Liability/.test(x)), m.join('\n'));
  assert.ok(m.includes('R3 Postable: Enter Yes or No.'));
  assert.ok(m.includes('R3 Parent Account: "Nowhere" not found (nor in a row above).'));
  assert.ok(m.includes('R4 Account Name: Same as row 3.'));
  assert.ok(m.includes('R5 Account Name: Account Name is required.'));
  const before = (await list('coa')).length;
  const r = await run('ACCOUNT', rows);
  assert.equal(r.success, false);
  assert.equal(r.created, 0);
  assert.equal((await list('coa')).length, before, 'nothing written');

  // An issue the master's own save would let through (a duplicate name):
  // the check alone must stop the import.
  const dup = await run('ACCOUNT', [['Account Name', 'Account Type', 'Postable'], ['Cash', 'Asset', 'Yes']]);
  assert.equal(dup.success, false);
  assert.deepEqual(msgs(dup), ['R1 Account Name: "Cash" already exists.']);
  assert.equal((await list('coa')).length, before, 'still nothing written');
});

test('Items: references by code or name; item codes made by the system; a company the user lacks is an issue', async () => {
  const sub = await run('SUBCATEGORY', [['Name', 'Parent Category'], ['Steel', 'Raw Material']]);
  assert.equal(sub.success, true, JSON.stringify(sub));
  const head = ['Item Name', 'Category', 'Sub-Category', 'UOM', 'Company', 'Default Warehouse', 'Inventory Account', 'Consumption Account', 'Reorder Level'];
  const rows = [head,
    ['Steel Sheet 2mm', 'Raw Material', 'Steel', 'PCS', '01', 'WH1', '1300', 'Material Consumption', '1,000'],
    ['Steel Sheet 3mm', 'RawMaterial', 'steel', 'pcs', 'Test Co One', 'Main Store', 'Inventory', '5100', '']];
  assert.deepEqual(msgs(await check('ITEM', rows)), []);
  const r = await run('ITEM', rows);
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual(r.codes, ['RM-000001', 'RM-000002']);
  const items = await list('items');
  const two = items.find(i => i.ItemName === 'Steel Sheet 2mm');
  assert.equal(two.ItemCode, 'RM-000001');
  assert.equal(two.UOMID, 'UOM-PCS'); assert.equal(two.InventoryAccountID, 'A-INV'); assert.equal(two.ConsumptionAccountID, 'A-CONS');
  assert.equal(two.DefaultWarehouseID, 'WH1'); assert.equal(two.CompanyID, 'C1'); assert.equal(two.ReorderLevel, 1000);
  assert.ok(two.SubCategoryID);

  const bad = await check('ITEM', [head,
    ['Rod', 'Raw Material', 'Pipes', 'BOX', '02', 'WH1', '1100', '1000', ''],
    ['Steel Sheet 2mm', 'Raw Material', '', 'PCS', '01', '', '1300', '5100', '']]);
  const m = msgs(bad);
  assert.ok(m.includes('R1 Sub-Category: "Pipes" not found.'), m.join('\n'));
  assert.ok(m.includes('R1 UOM: "BOX" not found.'));
  assert.ok(m.includes('R1 Company: You do not have access to that company.'));
  assert.ok(m.includes('R1 Consumption Account: Consumption Account must be Expense or COGS.'), m.join('\n'));
  assert.ok(m.includes('R2 Item Name: "Steel Sheet 2mm" already exists.'));
});

test('Organizational Units: a warehouse and its rack in one paste; codes and rack parents checked', async () => {
  const head = ['Type', 'Code', 'Name', 'Company', 'Parent'];
  const ok = await run('ORGUNIT', [head, ['Warehouse', 'WH9', 'North Store', '01', ''], ['Rack', 'R-01', 'Rack 1', '01', 'North Store']]);
  assert.equal(ok.success, true, JSON.stringify(ok));
  const units = await val('orgUnits');
  const wh = Object.keys(units).find(id => units[id].Code === 'WH9');
  assert.equal(Object.values(units).find(u => u.Code === 'R-01').ParentUnitID, wh);
  const m = msgs(await check('ORGUNIT', [head, ['Rack', 'R-02', 'Rack 2', '01', 'Workshop'], ['Cost Center', 'wh9', 'Other', '01', '']]));
  assert.ok(m.includes('R1 Parent: A Rack\'s parent must be a Warehouse.'), m.join('\n'));
  assert.ok(m.includes('R2 Code: Code "wh9" is already in use.'), m.join('\n'));
});

test('Vendors and Customers: codes made by the system; accounts, classification and country checked', async () => {
  const v = await run('VENDOR', [['Vendor Name', 'Category', 'Company', 'Classification', 'Trade Payables Account', 'Payment Terms (days)', 'Email'],
    ['Bolt Supplies', 'Raw Material Supplier', '01', 'Local', 'Trade Payables', '45', 'sales@bolt.example']]);
  assert.equal(v.success, true, JSON.stringify(v));
  assert.deepEqual(v.codes, ['VEN-000001']);
  const vendor = (await list('vendors')).find(x => x.VendorName === 'Bolt Supplies');
  assert.equal(vendor.TradePayablesAccountID, 'A-AP'); assert.equal(vendor.PaymentTermsDays, 45); assert.equal(vendor.Category, 'RawMaterialSupplier');

  const head = ['Customer Name', 'Company', 'Classification', 'Country', 'Trade Receivables Account', 'Email'];
  const m = msgs(await check('CUSTOMER', [head, ['Far East Co', '01', 'Export', '', '1200', 'bad-email'], ['Gulf Retail', '01', 'Local', '', '2000', '']]));
  assert.ok(m.includes('R1 Country: Enter the country of an export customer.'), m.join('\n'));
  assert.ok(m.includes('R1 Email: Enter a valid email address.'));
  assert.ok(m.includes('R2 Trade Receivables Account: Trade Receivables Account must be Asset.'), m.join('\n'));
  // Two accounts with one name: the name is not enough.
  await require('./_helpers').rtdb.ref('coa/A-AR2').set({ AccountCode: '1210', AccountName: 'Trade Receivables', AccountType: 'Asset', Status: 'Active', IsPostable: true });
  assert.deepEqual(msgs(await check('CUSTOMER', [head, ['Far East Co', '01', 'Export', 'Japan', 'Trade Receivables', '']])),
    ['R1 Trade Receivables Account: "Trade Receivables" matches more than one record; use its code.']);
  const c = await run('CUSTOMER', [head, ['Far East Co', '01', 'Export', 'Japan', '1200', '']]);
  assert.equal(c.success, true, JSON.stringify(c));
  assert.deepEqual(c.codes, ['CE-000001']);
});

test('Company, UOM and Currency: a parent above; typed codes unique; the Ref Code made by the system', async () => {
  const co = await run('COMPANY', [['Legal Name', 'Parent Company', 'City', 'Tax Type', 'Tax Number'],
    ['Holding LLC', '', 'Dubai', 'TRN', '1001'], ['Branch LLC', 'Holding LLC', 'Sharjah', '', '']]);
  assert.equal(co.success, true, JSON.stringify(co));
  const companies = await val('companies');
  const holding = Object.keys(companies).find(id => companies[id].LegalName === 'Holding LLC');
  const branch = Object.values(companies).find(c => c.LegalName === 'Branch LLC');
  assert.equal(branch.ParentCompanyID, holding);
  assert.match(companies[holding].CompanyRefCode, /^\d\d$/);
  assert.deepEqual(companies[holding].TaxNumbers, [{ Type: 'TRN', Number: '1001' }]);

  const u = msgs(await check('UOM', [['Code', 'Name', 'Allow Decimals', 'Decimal Places'], ['pcs', 'Pieces again', 'No', ''], ['KG', 'Kilogram', 'Yes', '9']]));
  assert.ok(u.includes('R1 Code: UOM code "PCS" is already in use.'), u.join('\n'));
  assert.ok(u.includes('R2 Decimal Places: Decimal places must be 0 to 6.'));
  const cur = msgs(await check('CURRENCY', [['Code', 'Name', 'Symbol'], ['DOLLAR', 'US Dollar', '$']]));
  assert.deepEqual(cur, ['R1 Code: A currency code is 3 letters (e.g. USD).']);
  assert.equal((await run('CURRENCY', [['Code', 'Name', 'Symbol'], ['USD', 'US Dollar', '$']])).success, true);
  assert.ok((await list('currencies')).some(c => c.Code === 'USD' && c.IsDefault === false));
});

test('importing needs the right to change that master', async () => {
  const f = fixture();
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Clerk', AssignedCompanies: ['C1'] };
  f.permissions.MASTERIMPORT.access.push('Clerk');
  await reset(f);
  const r = await run('UOM', [['Code', 'Name'], ['BOX', 'Box']], 'u-clerk');
  assert.equal(r.success, false);
  assert.match(r.issues[0].message, /You do not have permission to change Unit of Measure/);
  assert.equal((await list('uoms')).length, 1);
});

test('a save that fails during the import undoes the run: records removed, code counters put back', async () => {
  const user = { uid: 'u-admin', profile: (await val('users/u-admin')) };
  const good = { data: { ItemName: 'Bolt', Category: 'RawMaterial', UOMID: 'UOM-PCS', CompanyID: 'C1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS', ReorderLevel: '' } };
  const bad = { data: Object.assign({}, good.data, { ItemName: 'Nut', UOMID: 'NO-SUCH-UOM' }) };
  const res = await mi._importRows({ auth: { uid: 'u-admin', token: {} } }, user, 'ITEM', [good, bad]);
  assert.equal(res.failure.row, 2);
  assert.match(res.failure.message, /Unit of Measure not found/);
  assert.deepEqual((await list('items')).map(i => i.ItemName), ['Steel Sheet'], 'the imported item is removed again');
  assert.equal(await val('itemCounters/RM'), 0, 'its code number is given back');
});
