// Order and Proforma tax estimates (docs/modules/TAX_ENGINE.md, part 4),
// India GST on company C1 (27): previewOrderTax works out what the invoice
// would charge, by each item's code and the party's state, and posts
// nothing; a price list with tax included takes the tax out; an item without
// a code is named; a company without a Tax Configuration shows none; the
// order's access right and the company are checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');
const engine = require('../../src/taxEngine');

test.after(async () => { await app.delete(); });
const D = '2026-10-20';

async function ready(withConfig) {
  const f = baseFixture();
  Object.assign(f.items.I1, { TaxCode: 'GST18', HSNCode: '7208' });
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', TaxCode: 'GST5' };
  f.items.I3 = { ItemCode: 'FG-003', ItemName: 'Hinge', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Example Traders', Status: 'Active', CompanyID: 'C1', TaxRegistrationType: 'Registered', TaxState: '27' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Sample Stores', Status: 'Active', CompanyID: 'C1', TaxRegistrationType: 'Unregistered', TaxState: '29' }
  };
  Object.assign(f.vendors.V1, { TaxRegistrationType: 'Registered', TaxState: '29' });
  f.priceLists = { PL1: { Name: 'Retail (incl. tax)', CompanyID: 'C1', Status: 'Active', PricesIncludeTax: true } };
  await reset(f);
  if (!withConfig) return;
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-VATOUT'; c.InputAccountID = 'A-VATIN'; });
  const r = await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg });
  assert.equal(r.success, true, r.error);
}
const preview = (data, uid) => call(uid || 'u-admin', 'previewOrderTax', Object.assign({ kind: 'sale', CompanyID: 'C1', Date: D }, data));
const comps = r => r.tax.TaxComponents.map(c => c.Component + ' ' + c.Amount).join(', ');

test('a Sales Order: each item\'s rate on top of the price, CGST + SGST in the state, IGST outside it; nothing posted', async () => {
  await ready(true);
  const lines = [{ ItemCode: 'RM-001', Amount: 200 }, { ItemCode: 'FG-002', Amount: 100 }, { ItemCode: '', Amount: 0 }];
  const local = await preview({ PartyID: 'CU1', Lines: lines });
  assert.equal(local.configured, true, local.problem);
  assert.deepEqual([local.inclusive, local.tax.TaxAmount, local.tax.TaxAdded, local.tax.TaxIncluded], [false, 41, 41, 0]);
  assert.equal(comps(local), 'CGST 20.5, SGST 20.5');
  assert.deepEqual(local.tax.TaxSummary.map(s => [s.TaxCode, s.Percent, s.Taxable, s.Tax]), [['GST18', 18, 200, 36], ['GST5', 5, 100, 5]]);
  const away = await preview({ PartyID: 'CU2', Lines: lines });
  assert.equal(comps(away), 'IGST 41');
  assert.equal(await val('journalEntries'), null, 'an estimate posts nothing');
});

test('a price list with tax included: the tax taken out of the price, nothing added', async () => {
  await ready(true);
  const r = await preview({ PartyID: 'CU1', PriceListID: 'PL1', Lines: [{ ItemCode: 'RM-001', Amount: 118 }] });
  assert.deepEqual([r.inclusive, r.tax.TaxAmount, r.tax.TaxAdded, r.tax.TaxIncluded], [true, 18, 0, 18]);
});

test('a Purchase Order: the vendor\'s state decides, the estimate of what it will charge', async () => {
  await ready(true);
  const r = await preview({ kind: 'purchase', PartyID: 'V1', Lines: [{ ItemCode: 'RM-001', Amount: 500 }] });
  assert.deepEqual([r.tax.TaxAmount, comps(r)], [90, 'IGST 90']);
});

test('an item without a code is named; no Tax Configuration, no estimate; the access right and the company checked', async () => {
  await ready(true);
  const r = await preview({ PartyID: 'CU1', Lines: [{ ItemCode: 'FG-003', Amount: 10 }] });
  assert.deepEqual([r.configured, r.problem], [true, 'FG-003 has no tax code: give it one in Item Master.']);
  const other = await preview({ PartyID: 'CU1', Lines: [{ ItemCode: 'RM-001', Amount: 10 }] }, 'u-other').catch(e => ({ error: e.message }));
  assert.match(other.error, /do not have access to that company/);
  await ready(false);
  assert.deepEqual(await preview({ PartyID: 'CU1', Lines: [{ ItemCode: 'RM-001', Amount: 10 }] }), { configured: false });
});
