// Line tax on purchases (docs/modules/TAX_ENGINE.md, part 3, Q316, Q323):
// each code's recoverable %, reverse charge (the vendor charges nothing),
// a return's share of the reclaimed and not reclaimed parts.
//   node --test functions/test/unit/purchaseTax.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../../src/taxEngine');
const s = require('../../src/salesTax');
const p = require('../../src/purchaseTax');

const ok = () => '';
function gst() {
  const c = t.validateConfig(Object.assign(t.preset('IN_GST'), { StateCode: '27' }), ok);
  c.Codes.push({ Code: 'HALF', Name: 'Half reclaimed', Category: 'STANDARD', RecoverablePercent: 50, Active: true, Rates: [{ From: '2025-09-22', Percent: 18 }] });
  c.Components.forEach(x => { x.OutputAccountID = 'OUT-' + x.Code; x.InputAccountID = 'IN-' + x.Code; });
  return c;
}
const tax = (cfg, lines, place) => p.splitRecoverable(cfg, s.computeTax(cfg, lines, { date: '2026-10-26', placeOfSupply: place || '27', sale: false }));

test('the recoverable part per code; what the vendor charges; reverse charge charged by none', () => {
  const r = tax(gst(), [{ Key: 'a', Code: 'GST18', Amount: 100 }, { Key: 'b', Code: 'HALF', Amount: 100 }, { Key: 'c', Code: 'RCM18', Amount: 100 }]);
  assert.deepEqual(r.TaxLines.map(x => [x.Key, x.Tax, x.Recoverable, x.NonRecoverable, x.Reverse]), [['a', 18, 18, 0, false], ['b', 18, 9, 9, false], ['c', 18, 18, 0, true]]);
  assert.deepEqual([r.TaxAmount, r.TaxAdded, r.TaxReverse, r.TaxRecoverable], [54, 36, 18, 45]);
  assert.deepEqual(r.TaxComponents.map(c => [c.Component, c.Amount, c.Recoverable, c.NonRecoverable, c.Reverse]), [['CGST', 27, 22.5, 4.5, 9], ['SGST', 27, 22.5, 4.5, 9]]);
});

test('a return\'s share: amounts, reclaimed and not reclaimed parts scaled; the GL lines', () => {
  const inv = tax(gst(), [{ Key: 'a', Code: 'HALF', Amount: 200 }, { Key: 'c', Code: 'RCM18', Amount: 100 }], '29');
  const r = p.returnShare(inv, { a: 0.5, c: 1 });
  assert.deepEqual([r.TaxAmount, r.TaxAdded, r.TaxReverse, r.TaxRecoverable, r.TaxNonRecoverable], [36, 18, 18, 27, 9]);
  const coa = { 'IN-IGST': { AccountCode: '1451', IsPostable: true }, 'OUT-IGST': { AccountCode: '2251', IsPostable: true } };
  assert.deepEqual(p.returnGl(r, coa, {}).map(l => [l.AccountCode, l.Debit, l.Credit]), [['1451', 0, 27], ['2251', 18, 0]]);
  assert.throws(() => p.returnGl(r, {}, {}), /IGST input tax account is not set/);
});
