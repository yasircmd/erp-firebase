// Tax Configuration (docs/modules/TAX_ENGINE.md, part 1; Q311-Q322): a
// company's regime from a preset, its accounts and codes checked and kept,
// the rights; a customer's and vendor's registration type, state and tax
// number (a GSTIN checked against its state); an item's tax code and HSN /
// SAC, through their own saves (patches tax-party-*, tax-item).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = async p => { const r = await p.then(x => x, e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };

test.before(async () => {
  const f = baseFixture();
  f.coa['A-VATOUT2'] = { AccountCode: '2210', AccountName: 'Output VAT (other)', AccountType: 'Liability', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  await reset(f);
});

test('Tax Configuration: start from a preset; saved with its accounts; the rights and the company', async () => {
  const r = await call('u-admin', 'getTaxConfig', { companyId: 'C1' });
  assert.equal(r.config, null, 'nothing set yet');
  assert.deepEqual(r.presets.map(p => p.Regime), ['AE_VAT', 'IN_GST', 'OWN']);
  assert.equal(r.canWrite, true);
  const vat = r.presets.find(p => p.Regime === 'AE_VAT').config;
  vat.StateCode = 'DXB';
  vat.Components[0].OutputAccountID = 'A-VATOUT'; vat.Components[0].InputAccountID = 'A-VATIN';
  const save = (config, uid, co) => call(uid || 'u-admin', 'saveTaxConfig', { companyId: co || 'C1', config });
  assert.match(await err(save(vat, 'u-viewer')), /permission to change Tax Configuration/);
  assert.match(await err(save(vat, 'u-other', 'C1')), /access to that company/);
  assert.match(await err(save(Object.assign({}, vat, { Components: [Object.assign({}, vat.Components[0], { OutputAccountID: 'A-VATOUT2' })] }))), /VAT output account: 2210 belongs to another company/);
  assert.match(await err(save(Object.assign({}, vat, { Codes: [] }))), /at least one tax code/);
  ok(await save(vat));
  const stored = (await firestore.collection('taxConfig').doc('C1').get()).data();
  assert.deepEqual([stored.Regime, stored.StateCode, stored.Rounding, stored.Components[0].OutputAccountID, stored.Codes.map(c => c.Code).join(',')], ['AE_VAT', 'DXB', 'document', 'A-VATOUT', 'SR,ZR,EX,OS,RC']);
  const back = await call('u-viewer', 'getTaxConfig', { companyId: 'C1' });
  assert.deepEqual([back.config.Regime, back.canWrite], ['AE_VAT', false], 'access sees it, without setup');
  // A rate change is a new row: the old one stays for documents dated before.
  stored.Codes[0].Rates.push({ From: '2030-01-01', Percent: 7.5 });
  ok(await save(stored));
  assert.deepEqual((await firestore.collection('taxConfig').doc('C1').get()).data().Codes[0].Rates.map(x => [x.From, x.Percent]), [['2018-01-01', 5], ['2030-01-01', 7.5]]);
  // India GST: the company's GST state is needed.
  const gst = r.presets.find(p => p.Regime === 'IN_GST').config;
  assert.match(await err(save(gst, 'u-other', 'C2')), /company's GST state/);
  ok(await save(Object.assign({}, gst, { StateCode: '27' }), 'u-other', 'C2'));
});

test('a code documents use stays: made inactive, not removed; the regime then fixed', async () => {
  // Part 2 on, posting records the codes used; here as it will be.
  await firestore.collection('taxCodeUse').doc('C1').set({ SR: true });
  const cfg = (await firestore.collection('taxConfig').doc('C1').get()).data();
  assert.match(await err(call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: Object.assign({}, cfg, { Codes: cfg.Codes.filter(c => c.Code !== 'SR') }) })), /SR is used by documents: make it inactive/);
  cfg.Codes[0].Active = false;
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
  const gst = (await call('u-admin', 'getTaxConfig', { companyId: 'C1' })).presets.find(p => p.Regime === 'IN_GST').config;
  assert.match(await err(call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: Object.assign(gst, { StateCode: '27' }) })), /regime can no longer change/);
});

test('a customer and a vendor: registration type, state, tax number checked (GSTIN against its state); kept on a later save', async () => {
  const cust = (extra) => call('u-other', 'saveCustomer', { customerData: Object.assign({ CustomerName: 'Example Traders', Category: 'Retailer', Classification: 'Local', CompanyID: 'C2',
    TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 30 }, extra) });
  assert.match(await err(cust({ TaxRegistrationType: 'Registered', TaxState: '29', TaxRegistrationNumber: '27ABCDE1234F1Z0' })), /of state 27 \(Maharashtra\), not the state chosen/);
  assert.match(await err(cust({ TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: '27ABCDE1234F1Z1' })), /fails its check character/);
  ok(await cust({ TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: '27abcde1234f1z0' }));
  const rec = Object.values(await val('customers')).find(x => x.CustomerName === 'Example Traders');
  assert.deepEqual([rec.TaxRegistrationType, rec.TaxState, rec.TaxRegistrationNumber], ['Registered', '27', '27ABCDE1234F1Z0']);
  const vend = (extra) => call('u-admin', 'saveVendor', { vendorData: Object.assign({ VendorName: 'Sample Supplies', Category: 'RawMaterialSupplier', Classification: 'Local', CompanyID: 'C1',
    TradePayablesAccountID: 'A-AP', PaymentTermsDays: 30 }, extra) });
  assert.match(await err(vend({ TaxRegistrationType: 'Registered', TaxState: 'DXB', TaxRegistrationNumber: '123' })), /UAE TRN is 15 digits starting 100/);
  ok(await vend({ TaxRegistrationType: 'Registered', TaxState: 'DXB', TaxRegistrationNumber: '100000000000003' }));
  const v = Object.values(await val('vendors')).find(x => x.VendorName === 'Sample Supplies');
  assert.deepEqual([v.TaxRegistrationType, v.TaxState], ['Registered', 'DXB']);
  // A party saved without the new fields (the form before them, an import): as before.
  ok(await vend({ VendorName: 'Plain Vendor', TaxRegistrationNumber: 'free text' }));
  assert.equal(Object.values(await val('vendors')).find(x => x.VendorName === 'Plain Vendor').TaxRegistrationNumber, 'free text');
});

test('an item: its tax code and HSN / SAC checked and stored', async () => {
  const item = (extra) => call('u-admin', 'saveItem', { itemData: Object.assign({ ItemName: 'Sample Widget', Category: 'RawMaterial', UOMID: 'UOM-PCS', DefaultWarehouseID: 'WH1', InventoryAccountID: 'A-INV',
    ConsumptionAccountID: 'A-CONS', CompanyID: 'C1' }, extra) });
  assert.match(await err(item({ HSNCode: '12345' })), /4, 6 or 8 digits/);
  assert.match(await err(item({ TaxCode: 'GST 18' })), /up to 12 letters/);
  ok(await item({ TaxCode: 'gst18', HSNCode: '84713010' }));
  const it = Object.values(await val('items')).find(x => x.ItemName === 'Sample Widget');
  assert.deepEqual([it.TaxCode, it.HSNCode], ['GST18', '84713010']);
});
