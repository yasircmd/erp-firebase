// Line tax on sales (docs/modules/TAX_ENGINE.md, part 2, Q314-Q318): a
// discount spread over the lines, GST split by the place of supply, prices
// inclusive of tax, rounding per line or per code on the document, reverse
// charge on a sale, a return's share, the GL lines per component.
//   node --test functions/test/unit/salesTax.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../../src/taxEngine');
const s = require('../../src/salesTax');

const ok = () => '';
const withAccounts = cfg => Object.assign(cfg, { Components: cfg.Components.map(c => Object.assign({}, c, { OutputAccountID: 'OUT-' + c.Code, InputAccountID: 'IN-' + c.Code })) });
const gst = () => withAccounts(t.validateConfig(Object.assign(t.preset('IN_GST'), { StateCode: '27' }), ok));
const vat = () => withAccounts(t.validateConfig(t.preset('AE_VAT'), ok));
const D = '2026-10-26';

test('apportion: in proportion, in cents, the last line takes the rest', () => {
  assert.deepEqual(s.apportion(10, [60, 40]), [6, 4]);
  assert.deepEqual(s.apportion(10, [1, 1, 1]), [3.33, 3.33, 3.34]);
  assert.deepEqual(s.apportion(0, [5, 5]), [0, 0]);
});

test('UAE VAT: standard and zero rated on one invoice; the discount spread before tax', () => {
  const r = s.computeTax(vat(), [{ Key: 'a', Code: 'SR', Amount: 600 }, { Key: 'b', Code: 'ZR', Amount: 400 }], { date: D, discount: 100, sale: true });
  assert.deepEqual(r.TaxLines.map(x => [x.Key, x.Taxable, x.Tax]), [['a', 540, 27], ['b', 360, 0]]);
  assert.deepEqual([r.TaxAmount, r.TaxAdded, r.TaxIncluded], [27, 27, 0]);
  assert.deepEqual(r.TaxComponents, [{ Component: 'VAT', Amount: 27, OutputAccountID: 'OUT-VAT', InputAccountID: 'IN-VAT' }]);
  assert.deepEqual(r.TaxSummary.map(x => [x.TaxCode, x.Taxable, x.Tax]), [['SR', 540, 27], ['ZR', 360, 0]]);
});

test('rounding: per code on the document (VAT) against per line (GST)', () => {
  const lines = [1, 2, 3].map(i => ({ Key: 'l' + i, Code: 'SR', Amount: 0.1 }));
  const doc = s.computeTax(vat(), lines, { date: D, sale: true });
  // 3 × 0.005: per line each rounds to 0.01 (0.03); on the document 0.015 rounds once.
  assert.equal(doc.TaxAmount, Math.round(0.015 * 100) / 100);
  assert.equal(Math.round(doc.TaxLines.reduce((a, x) => a + x.Tax, 0) * 100) / 100, doc.TaxAmount, 'the lines add up to the document\'s tax');
  const perLine = s.computeTax(Object.assign(vat(), { Rounding: 'line' }), lines, { date: D, sale: true });
  assert.equal(perLine.TaxAmount, 0.03);
});

test('India GST: CGST + SGST within the state, IGST to another, an SEZ or abroad; cess on top', () => {
  const line = [{ Key: 'a', Code: 'GST18', Amount: 1000 }];
  const intra = s.computeTax(gst(), line, { date: D, placeOfSupply: '27', sale: true });
  assert.deepEqual(intra.TaxLines[0].Components.map(x => [x.Component, x.Percent, x.Amount]), [['CGST', 9, 90], ['SGST', 9, 90]]);
  const inter = s.computeTax(gst(), line, { date: D, placeOfSupply: '29', sale: true });
  assert.deepEqual(inter.TaxLines[0].Components.map(x => [x.Component, x.Amount]), [['IGST', 180]]);
  const sez = s.computeTax(gst(), line, { date: D, placeOfSupply: '27', partyType: 'SEZ', sale: true });
  assert.deepEqual(sez.TaxComponents.map(x => x.Component), ['IGST']);
  // A union territory company: UTGST in place of SGST.
  const ut = s.computeTax(Object.assign(gst(), { StateCode: '04' }), line, { date: D, placeOfSupply: '04', sale: true });
  assert.deepEqual(ut.TaxComponents.map(x => x.Component), ['CGST', 'UTGST']);
  // The rate on the document's date (Q317): 12% before 22/09/2025.
  const old = s.computeTax(gst(), [{ Key: 'a', Code: 'GST12', Amount: 100 }], { date: '2025-09-01', placeOfSupply: '27', sale: true });
  assert.equal(old.TaxAmount, 12);
  const cfg = gst();
  cfg.Codes.find(c => c.Code === 'GST40').Rates[0].Cess = 1;
  assert.deepEqual(s.computeTax(cfg, [{ Key: 'a', Code: 'GST40', Amount: 100 }], { date: D, placeOfSupply: '29', sale: true }).TaxComponents.map(x => [x.Component, x.Amount]), [['IGST', 40], ['CESS', 1]]);
});

test('a price inclusive of tax: the tax taken out of it, nothing added to the total', () => {
  const r = s.computeTax(gst(), [{ Key: 'a', Code: 'GST18', Amount: 118, Inclusive: true }, { Key: 'b', Code: 'GST5', Amount: 100 }], { date: D, placeOfSupply: '27', sale: true });
  assert.deepEqual(r.TaxLines.map(x => [x.Taxable, x.Tax, x.Inclusive]), [[100, 18, true], [100, 5, false]]);
  assert.deepEqual([r.TaxAmount, r.TaxAdded, r.TaxIncluded], [23, 5, 18]);
});

test('reverse charge on a sale charges nothing (the buyer accounts for it); a code not set up refused', () => {
  const r = s.computeTax(vat(), [{ Key: 'a', Code: 'RC', Amount: 500 }], { date: D, sale: true });
  assert.deepEqual([r.TaxAmount, r.TaxLines[0].Category], [0, 'REVERSE_CHARGE']);
  assert.throws(() => s.computeTax(vat(), [{ Key: 'a', Code: 'GST18', Amount: 1 }], { date: D, sale: true }), /GST18 is not set up/);
});

test('a return\'s share: each line by its fraction, at the invoice\'s accounts; the GL lines per component', () => {
  const inv = s.computeTax(gst(), [{ Key: 'a', Code: 'GST18', Amount: 1000 }, { Key: 'b', Code: 'GST5', Amount: 200 }], { date: D, placeOfSupply: '27', sale: true });
  inv.TaxComponents.forEach(c => { c.OutputAccountID = 'POSTED-' + c.Component; }); // the accounts when it posted, not today's
  const half = s.shareOf(inv, { a: 0.5 });
  assert.deepEqual(half.TaxLines.map(x => [x.Key, x.Taxable, x.Tax]), [['a', 500, 90]]);
  assert.deepEqual(half.TaxComponents.map(x => [x.Component, x.Amount, x.OutputAccountID]), [['CGST', 45, 'POSTED-CGST'], ['SGST', 45, 'POSTED-SGST']]);
  const coa = { 'POSTED-CGST': { AccountCode: '2211', IsPostable: true }, 'POSTED-SGST': { AccountCode: '2212', IsPostable: true } };
  const credit = s.componentGlLines(half, coa, { description: 'x' });
  assert.deepEqual(credit.map(l => [l.AccountCode, l.Debit, l.Credit]), [['2211', 0, 45], ['2212', 0, 45]]);
  const debit = s.componentGlLines(half, coa, { reverse: true });
  assert.deepEqual(debit.map(l => [l.Debit, l.Credit]), [[45, 0], [45, 0]]);
  assert.throws(() => s.componentGlLines(half, {}, {}), /CGST output tax account is not set/);
});

test('the tax an inclusive delivery holds: by its Delivery Note, an invoice\'s own item lines as item#n', () => {
  const doc = { AutoDeliveryNoteID: 'DN2', TaxLines: [
    { Key: 'DN1#1', Inclusive: true, Tax: 18 }, { Key: 'DN1#2', Inclusive: false, Tax: 5 }, { Key: 'item#1', Inclusive: true, Tax: 9 }, { Key: 'DN10#1', Inclusive: true, Tax: 1 }
  ] };
  assert.equal(s.includedTaxOf(doc, 'DN1'), 18, 'DN10 is not DN1');
  assert.equal(s.includedTaxOf(doc, 'DN2'), 9);
  assert.equal(s.includedTaxOf({}, 'DN1'), 0);
});
