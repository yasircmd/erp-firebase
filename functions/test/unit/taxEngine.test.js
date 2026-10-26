// The tax engine (docs/modules/TAX_ENGINE.md, Q311-Q322): the presets, a
// configuration checked, rates by date, GST's split by the place of supply,
// GSTIN / TRN / HSN checks, a party's and an item's tax fields.
//   node --test functions/test/unit/taxEngine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../../src/taxEngine');

const ok = () => '';
const gst = () => t.validateConfig(Object.assign(t.preset('IN_GST'), { StateCode: '27' }), ok);
const vat = () => t.validateConfig(t.preset('AE_VAT'), ok);

test('presets: UAE VAT and India GST validate as they come; the regime needs its state', () => {
  assert.deepEqual(vat().Codes.map(c => c.Code), ['SR', 'ZR', 'EX', 'OS', 'RC']);
  assert.throws(() => t.validateConfig(t.preset('IN_GST'), ok), /company's GST state/);
  const g = gst();
  assert.deepEqual(g.Components.map(c => c.Code), ['CGST', 'SGST', 'UTGST', 'IGST', 'CESS']);
  assert.deepEqual(g.Codes.filter(c => !c.Active).map(c => c.Code), ['GST12', 'GST28'], 'the slabs before 22/09/2025 kept, inactive');
  assert.equal(g.Rounding, 'line', 'GST rounds per line, VAT per document (Q315)');
  assert.equal(vat().Rounding, 'document');
  assert.throws(() => t.preset('XX'), /Choose UAE VAT, India GST/);
});

test('checks: components fixed by the regime, codes unique, rates dated, categories by regime, accounts', () => {
  const v = t.preset('AE_VAT');
  assert.throws(() => t.validateConfig(Object.assign({}, v, { Components: [] }), ok), /components are VAT/);
  assert.throws(() => t.validateConfig(Object.assign({}, v, { Codes: v.Codes.concat([v.Codes[0]]) }), ok), /SR: appears twice/);
  assert.throws(() => t.validateConfig(Object.assign({}, v, { Codes: [Object.assign({}, v.Codes[0], { Rates: [{ From: '2018-02-30', Percent: 5 }] })] }), ok), /date it applies from/);
  assert.throws(() => t.validateConfig(Object.assign({}, v, { Codes: [Object.assign({}, v.Codes[0], { Category: 'NIL' })] }), ok), /a GST category/);
  assert.throws(() => t.validateConfig(Object.assign({}, v, { Codes: [] }), ok), /at least one tax code/);
  assert.throws(() => t.validateConfig(Object.assign({}, v, { Components: [{ Code: 'VAT', OutputAccountID: 'A-X' }] }), () => 'not postable'), /VAT output account: not postable/);
  // A zero-rated code never carries a rate, whatever is typed.
  const z = t.validateConfig(Object.assign({}, v, { Codes: [Object.assign({}, v.Codes[1], { Rates: [{ From: '2018-01-01', Percent: 9 }] })] }), ok);
  assert.equal(z.Codes[0].Rates[0].Percent, 0);
});

test('rates by date: the row in force on the document\'s date; none before the first', () => {
  const c = { Rates: [{ From: '2017-07-01', Percent: 12 }, { From: '2025-09-22', Percent: 5 }] };
  assert.equal(t.rateOn(c, '2025-09-21').Percent, 12);
  assert.equal(t.rateOn(c, '2025-09-22').Percent, 5);
  assert.equal(t.rateOn(c, '2017-06-30'), null);
  const cfg = Object.assign(vat(), {});
  cfg.Codes[0].Rates.push({ From: '2030-01-01', Percent: 7 });
  assert.deepEqual(t.componentsOf(cfg, 'SR', '2030-01-01'), [{ Component: 'VAT', Percent: 7 }]);
  assert.throws(() => t.componentsOf(cfg, 'SR', '2017-12-31'), /no rate on 2017-12-31/);
  assert.throws(() => t.componentsOf(cfg, 'NOPE', '2026-01-01'), /not set up for this company/);
  assert.deepEqual(t.componentsOf(cfg, 'ZR', '2026-01-01'), [], 'zero-rated: no tax');
});

test('GST: CGST + SGST within the state, IGST across, to an SEZ or abroad; UTGST in a union territory; cess', () => {
  const g = gst();
  assert.deepEqual(t.componentsOf(g, 'GST18', '2026-01-01', { placeOfSupply: '27' }), [{ Component: 'CGST', Percent: 9 }, { Component: 'SGST', Percent: 9 }]);
  assert.deepEqual(t.componentsOf(g, 'GST18', '2026-01-01', { placeOfSupply: '29' }), [{ Component: 'IGST', Percent: 18 }]);
  assert.deepEqual(t.componentsOf(g, 'GST18', '2026-01-01', { placeOfSupply: '27', partyType: 'SEZ' }), [{ Component: 'IGST', Percent: 18 }]);
  assert.deepEqual(t.componentsOf(g, 'GST5', '2026-01-01', { placeOfSupply: '' }), [{ Component: 'IGST', Percent: 5 }], 'no state: abroad');
  const ut = t.validateConfig(Object.assign(t.preset('IN_GST'), { StateCode: '04' }), ok);
  assert.deepEqual(t.componentsOf(ut, 'GST18', '2026-01-01', { placeOfSupply: '04' }).map(x => x.Component), ['CGST', 'UTGST']);
  const withCess = t.validateConfig(Object.assign(t.preset('IN_GST'), { StateCode: '27', Codes: [{ Code: 'GST28C', Name: 'GST 28% + cess', Category: 'STANDARD', Rates: [{ From: '2017-07-01', Percent: 28, Cess: 12 }] }] }), ok);
  assert.deepEqual(t.componentsOf(withCess, 'GST28C', '2020-01-01', { placeOfSupply: '29' }), [{ Component: 'IGST', Percent: 28 }, { Component: 'CESS', Percent: 12 }]);
  assert.throws(() => t.validateConfig(Object.assign(t.preset('AE_VAT'), { Codes: [{ Code: 'X', Category: 'STANDARD', Rates: [{ From: '2018-01-01', Percent: 5, Cess: 1 }] }] }), ok), /cess is for GST only/);
});

test('an own regime: its components, each rate row\'s parts making the rate', () => {
  const own = t.validateConfig({ Regime: 'OWN', Name: 'State sales tax', Components: [{ Code: 'STATE' }, { Code: 'CITY' }],
    Codes: [{ Code: 'STD', Category: 'STANDARD', Rates: [{ From: '2026-01-01', Parts: { STATE: 6, CITY: 1.5 } }] }] }, ok);
  assert.equal(own.Codes[0].Rates[0].Percent, 7.5);
  assert.deepEqual(t.componentsOf(own, 'STD', '2026-06-01'), [{ Component: 'STATE', Percent: 6 }, { Component: 'CITY', Percent: 1.5 }]);
  assert.throws(() => t.validateConfig({ Regime: 'OWN', Components: [{ Code: 'STATE' }], Codes: [{ Code: 'STD', Category: 'STANDARD', Rates: [{ From: '2026-01-01', Parts: { COUNTY: 1 } }] }] }, ok), /COUNTY is not one of the components/);
});

test('GSTIN: format, state code, check character; a party\'s tax fields; UAE TRN', () => {
  assert.equal(t.gstinProblem('27ABCDE1234F1Z0'), '');
  assert.match(t.gstinProblem('27ABCDE1234F1Z1'), /fails its check character/);
  assert.match(t.gstinProblem('99ABCDE1234F1Z0'), /not a GST state code/);
  assert.match(t.gstinProblem('27ABCDE1234F1'), /15 characters/);
  assert.deepEqual(t.partyTaxFields({ TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: ' 27abcde1234f1z0 ' }),
    { TaxRegistrationNumber: '27ABCDE1234F1Z0', TaxRegistrationType: 'Registered', TaxState: '27', City: '', PostalCode: '' }, 'upper-cased, no spaces');
  assert.throws(() => t.partyTaxFields({ TaxRegistrationType: 'Registered', TaxState: '29', TaxRegistrationNumber: '27ABCDE1234F1Z0' }), /of state 27 \(Maharashtra\), not the state chosen/);
  assert.throws(() => t.partyTaxFields({ TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: '' }), /needs its GSTIN/);
  assert.deepEqual(t.partyTaxFields({ TaxRegistrationType: 'Unregistered', TaxState: '27' }).TaxRegistrationNumber, '', 'unregistered: no GSTIN needed');
  assert.throws(() => t.partyTaxFields({ TaxRegistrationType: 'Registered', TaxState: 'DXB', TaxRegistrationNumber: '12345' }), /UAE TRN is 15 digits starting 100/);
  assert.equal(t.partyTaxFields({ TaxRegistrationType: 'Registered', TaxState: 'DXB', TaxRegistrationNumber: '100000000000003' }).TaxState, 'DXB');
  assert.deepEqual(t.partyTaxFields({}), { TaxRegistrationNumber: '', TaxRegistrationType: '', TaxState: '', City: '', PostalCode: '' }, 'nothing given: as before');
  // The city and PIN an e-invoice needs: an Indian PIN is 6 digits, not starting 0.
  assert.deepEqual(t.partyTaxFields({ TaxState: '27', City: ' Pune ', PostalCode: '411 001' }).PostalCode, '411001');
  assert.throws(() => t.partyTaxFields({ TaxState: '27', PostalCode: '011001' }), /Indian PIN code is 6 digits/);
  assert.equal(t.partyTaxFields({ TaxState: 'DXB', PostalCode: 'PO 1234' }).PostalCode, 'PO1234', 'elsewhere: as typed');
  assert.equal(t.partyTaxFields({ TaxRegistrationNumber: 'any text' }).TaxRegistrationNumber, 'any text', 'no rule to check by: kept as typed');
  assert.throws(() => t.partyTaxFields({ TaxRegistrationType: 'Friendly' }), /registration type/);
  assert.throws(() => t.partyTaxFields({ TaxState: 'ZZ' }), /state or emirate from the list/);
});

test('an item\'s tax code and HSN / SAC', () => {
  assert.deepEqual(t.itemTaxFields({ TaxCode: 'gst18', HSNCode: '84713010' }), { TaxCode: 'GST18', HSNCode: '84713010' });
  assert.equal(t.itemTaxFields({ HSNCode: '998314' }).HSNCode, '998314', 'a SAC');
  assert.throws(() => t.itemTaxFields({ HSNCode: '12345' }), /4, 6 or 8 digits/);
  assert.throws(() => t.itemTaxFields({ TaxCode: 'GST 18' }), /up to 12 letters/);
  assert.deepEqual(t.itemTaxFields({}), { TaxCode: '', HSNCode: '' });
});
