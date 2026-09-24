// UOM, ITEMSUBCAT, ORGUNITS, COMPANYMASTER, CURRENCYCONFIG — through the
// same callables their screens use (legacy/callables.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

test('UOM: list seeds defaults; save, duplicate refused, deactivate/reactivate', async () => {
  const list = await call('u-admin', 'getUOMs');
  assert.deepEqual(list.map(u => u.Code).sort(), ['BOX', 'KG', 'LTR', 'MTR', 'PCS']);
  const r = await call('u-admin', 'saveUOM', { uomData: { Code: 'dz', Name: 'Dozen', AllowDecimals: false } });
  assert.equal(r.success, true);
  assert.equal((await val('uoms/' + r.uomId)).Code, 'DZ');
  const dup = await call('u-admin', 'saveUOM', { uomData: { Code: 'DZ', Name: 'Again' } });
  assert.deepEqual(dup, { success: false, error: 'UOM code "DZ" is already in use.' });
  assert.equal((await call('u-admin', 'deactivateUOM', { uomId: r.uomId })).success, true);
  assert.equal((await val('uoms/' + r.uomId)).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateUOM', { uomId: r.uomId })).success, true);
  assert.equal((await val('uoms/' + r.uomId)).Status, 'Active');
});

test('UOM: Viewer cannot modify', async () => {
  const r = await call('u-viewer', 'saveUOM', { uomData: { Code: 'XX', Name: 'x' } });
  assert.deepEqual(r, { success: false, error: 'You do not have permission to modify Unit of Measure.' });
});

test('Item Sub-Category: save under a valid parent; invalid parent refused', async () => {
  const bad = await call('u-admin', 'saveItemSubCategory', { data: { Name: 'Sheets', ParentCategory: 'Nope' } });
  assert.equal(bad.success, false);
  const r = await call('u-admin', 'saveItemSubCategory', { data: { Name: 'Sheets', ParentCategory: 'RawMaterial' } });
  assert.equal(r.success, true, JSON.stringify(r));
  const list = await call('u-admin', 'getItemSubCategories');
  assert.ok(list.some(s => s.Name === 'Sheets' && s.ParentCategory === 'RawMaterial'));
});

test('Org Units: warehouse + rack hierarchy rules, company access', async () => {
  const wh = await call('u-admin', 'saveOrgUnit', { unitData: { Type: 'Warehouse', Code: 'WH9', Name: 'Yard', CompanyID: 'C1' } });
  assert.equal(wh.success, true, JSON.stringify(wh));
  const rackNoParent = await call('u-admin', 'saveOrgUnit', { unitData: { Type: 'Rack', Code: 'R1', Name: 'Rack 1', CompanyID: 'C1' } });
  assert.equal(rackNoParent.success, false);
  assert.match(rackNoParent.error, /Rack must have a Warehouse/);
  const units = await call('u-admin', 'getOrgUnits');
  const whId = units.find(u => u.Code === 'WH9').UnitID;
  const rack = await call('u-admin', 'saveOrgUnit', { unitData: { Type: 'Rack', Code: 'R1', Name: 'Rack 1', CompanyID: 'C1', ParentUnitID: whId } });
  assert.equal(rack.success, true, JSON.stringify(rack));
  const dup = await call('u-admin', 'saveOrgUnit', { unitData: { Type: 'Warehouse', Code: 'WH9', Name: 'Dup', CompanyID: 'C1' } });
  assert.equal(dup.success, false);
  const foreign = await call('u-other', 'saveOrgUnit', { unitData: { Type: 'Warehouse', Code: 'WHX', Name: 'X', CompanyID: 'C1' } });
  assert.deepEqual(foreign, { success: false, error: 'You do not have access to that company.' });
});

test('Company Master: create with ref code; bad ref code and self-parent refused', async () => {
  const r = await call('u-admin', 'saveCompany', { companyData: { LegalName: 'Test Co Three', CompanyRefCode: '07', GrnClearingAccountID: 'A-CLR' } });
  assert.equal(r.success, true, JSON.stringify(r));
  const companies = await call('u-admin', 'getCompanies');
  const created = companies.find(c => c.LegalName === 'Test Co Three');
  assert.ok(created, 'listed');
  assert.equal(created.CompanyRefCode, '07');
  const badRef = await call('u-admin', 'saveCompany', { companyData: { LegalName: 'Bad', CompanyRefCode: '7' } });
  assert.match(badRef.error, /exactly 2 digits/);
  const clash = await call('u-admin', 'saveCompany', { companyData: { LegalName: 'Clash', CompanyRefCode: '01' } });
  assert.match(clash.error, /already used by Test Co One/);
  const self = await call('u-admin', 'saveCompany', { companyData: { CompanyID: 'C1', LegalName: 'Test Co One', CompanyRefCode: '01', ParentCompanyID: 'C1' } });
  assert.match(self.error, /cannot be its own parent/);
  const badAcct = await call('u-admin', 'saveCompany', { companyData: { LegalName: 'Bad Acct', CompanyRefCode: '08', GrnClearingAccountID: 'NOPE' } });
  assert.match(badAcct.error, /GRN Clearing Account must be an active, postable account/);
});

test('Currency: ISO code rule, single default', async () => {
  const bad = await call('u-admin', 'saveCurrency', { currencyData: { Code: 'DIRHAM', Name: 'x' } });
  assert.match(bad.error, /3-letter ISO code/);
  const aed = await call('u-admin', 'saveCurrency', { currencyData: { Code: 'aed', Name: 'UAE Dirham', Symbol: 'AED', IsDefault: true } });
  assert.equal(aed.success, true, JSON.stringify(aed));
  const usd = await call('u-admin', 'saveCurrency', { currencyData: { Code: 'USD', Name: 'US Dollar', Symbol: '$', IsDefault: true } });
  assert.equal(usd.success, true);
  const list = await call('u-admin', 'getCurrencies');
  assert.deepEqual(list.filter(c => c.IsDefault).map(c => c.Code), ['USD'], 'setting a new default clears the old one');
});

test('Chart of accounts read (used by Company Master account pickers)', async () => {
  const coa = await call('u-admin', 'getChartOfAccounts');
  assert.ok(coa.some(a => a.AccountCode === '2100'));
});
