// The tax reports' builders (docs/modules/TAX_ENGINE.md, part 5), on rows
// made from hand-built documents: the UAE's VAT 201 boxes, India's GSTR-1
// sheets and GSTR-3B tables, a reversal counted minus on its own date.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/taxReports');

const line = (Key, TaxCode, Category, Percent, Taxable, comps, extra) => Object.assign({
  Key, TaxCode, Category, Percent, Taxable, Tax: Math.round(comps.reduce((s, c) => s + c[2], 0) * 100) / 100,
  Components: comps.map(([Component, P, Amount, Recoverable]) => ({ Component, Percent: P, Amount, Recoverable: Recoverable == null ? Amount : Recoverable, NonRecoverable: Recoverable == null ? 0 : Math.round((Amount - Recoverable) * 100) / 100 }))
}, extra || {});
const doc = (id, date, lines, extra) => Object.assign({ _id: id, TransactionNumber: id, InvoiceDate: date, TransactionDate: date, Total: lines.reduce((s, l) => s + l.Taxable + l.Tax, 0), TaxLines: lines }, extra || {});
const rows = (kind, d, party, extra) => R.rowsOf(kind, d, (extra || {}).source || null, party || {}, Object.assign({ rate: 1, quantities: {} }, extra || {}));

test('monthsOf: the months a period touches', () => {
  assert.deepEqual(R.monthsOf('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.throws(() => R.monthsOf('2020-01-01', '2026-01-01'), /three years/);
});

test('UAE VAT 201: supplies by emirate, zero rated, exempt, reverse charge and imports, expenses, the net payable', () => {
  const cfg = { Regime: 'AE_VAT', StateCode: 'SHJ' };
  const vat = (base, rec) => [['VAT', 5, base * 0.05, rec]];
  const all = [].concat(
    rows('CustomerInvoice', doc('CI1', '2026-10-05', [line('a', 'SR', 'STANDARD', 5, 1000, vat(1000)), line('b', 'ZR', 'ZERO', 0, 500, []), line('c', 'EX', 'EXEMPT', 0, 300, [])], { PlaceOfSupply: 'DXB' })),
    rows('RetailSale', doc('RS1', '2026-10-06', [line('line#1', 'SR', 'STANDARD', 5, 200, vat(200))])),
    rows('SalesReturn', doc('SR1', '2026-10-07', [line('a', 'SR', 'STANDARD', 5, 100, vat(100))], { PlaceOfSupply: 'DXB' })),
    rows('VendorInvoice', doc('VI1', '2026-10-08', [line('direct#1', 'SR', 'STANDARD', 5, 400, vat(400)), line('direct#2', 'SRB', 'STANDARD', 5, 100, vat(100, 0))])),
    rows('VendorInvoice', doc('VI2', '2026-10-09', [line('G1#1', 'RC', 'REVERSE_CHARGE', 5, 1000, vat(1000), { Reverse: true, Kind: 'grn' })]), { type: 'Overseas' }),
    rows('VendorInvoice', doc('VI3', '2026-10-10', [line('direct#1', 'RC', 'REVERSE_CHARGE', 5, 200, vat(200), { Reverse: true, Kind: 'direct' })]), { type: 'Registered' })
  );
  const b = R.vat201(all, cfg);
  const pick = n => [b[n].Amount, b[n].Vat];
  assert.deepEqual(pick('1b'), [900, 45], 'Dubai: the invoice less its credit note');
  assert.deepEqual(pick('1c'), [200, 10], 'Sharjah: the counter sale, the company\'s own emirate');
  assert.deepEqual(pick('1a'), [0, 0]);
  assert.deepEqual([pick('4'), pick('5')], [[500, 0], [300, 0]]);
  assert.deepEqual([pick('3'), pick('6')], [[200, 10], [1000, 50]], 'imported goods apart from the other reverse charge');
  assert.deepEqual(pick('8'), [3100, 115]);
  assert.deepEqual([pick('9'), pick('10'), pick('11')], [[500, 20], [1200, 60], [1700, 80]], 'the blocked code\'s VAT not recoverable');
  assert.deepEqual([b['12'].Vat, b['13'].Vat, b['14'].Vat], [115, 80, 35]);
  assert.deepEqual(b['1b'].docs.sort(), ['CustomerInvoice:CI1', 'SalesReturn:SR1']);
  const s = R.summary(all);
  assert.deepEqual([s.sales.Tax, s.purchases.Reverse, s.due, s.reclaimed, s.net], [55, 60, 115, 80, 35], "the summary agrees with box 14");
});

test('a reversal counts minus, with the figures of what it reverses, on its own date', () => {
  const orig = doc('CI1', '2026-09-30', [line('a', 'SR', 'STANDARD', 5, 1000, [['VAT', 5, 50]])], { PlaceOfSupply: 'DXB' });
  const rev = { _id: 'CINVD-1', TransactionNumber: 'CI1-R', InvoiceDate: '2026-10-02', ReversalOfInvoiceID: 'CI1', Total: 1050 };
  const r = R.rowsOf('CustomerInvoice', rev, orig, {}, { rate: 1, quantities: {} });
  assert.deepEqual(r.map(x => [x.Date, x.Taxable, x.Tax, x.Note, x.Reversal, x.OrigNumber]), [['2026-10-02', -1000, -50, true, true, 'CI1']]);
  // A foreign-currency invoice in the base currency, at its rate.
  const fc = R.rowsOf('CustomerInvoice', Object.assign({}, orig, { CurrencyCode: 'USD', ExchangeRate: 3.6725 }), null, {}, { rate: 1, quantities: {} });
  assert.deepEqual([fc[0].Taxable, fc[0].Tax], [3672.5, 183.63]);
});

test('India GSTR-1: B2B, B2CL over the limit, B2CS by state and rate, exports, credit notes, nil rated, HSN; GSTR-3B', () => {
  const cfg = { Regime: 'IN_GST', StateCode: '27', B2CLLimit: 100000 };
  const intra = (base, p) => [['CGST', p / 2, base * p / 200], ['SGST', p / 2, base * p / 200]];
  const igst = (base, p, rec) => [['IGST', p, base * p / 100, rec]];
  const reg = { id: 'CU1', name: 'Example Traders', type: 'Registered', gstin: '27ABCDE1234F1Z0', state: '27' };
  const q = (k, n) => ({ quantities: { [k]: { Qty: n, UQC: 'NOS' } } });
  const all = [].concat(
    rows('CustomerInvoice', doc('INV-1', '2026-10-05', [line('item#1', 'GST18', 'STANDARD', 18, 10000, intra(10000, 18), { HSNCode: '7208' })], { PlaceOfSupply: '27' }), reg, q('item#1', 10)),
    rows('CustomerInvoice', doc('INV-2', '2026-10-06', [line('item#1', 'GST18', 'STANDARD', 18, 150000, igst(150000, 18), { HSNCode: '7208' })], { PlaceOfSupply: '29' }), { type: 'Unregistered', state: '29' }, q('item#1', 100)),
    rows('RetailSale', doc('RS-1', '2026-10-07', [line('line#1', 'GST5', 'STANDARD', 5, 1000, intra(1000, 5), { HSNCode: '7318' }), line('line#2', 'NIL', 'NIL', 0, 200, [])], { PlaceOfSupply: '27' }), { type: 'Consumer' }, q('line#1', 4)),
    rows('CustomerInvoice', doc('INV-3', '2026-10-08', [line('item#1', 'ZERO', 'ZERO', 0, 5000, [], { HSNCode: '7208' })]), { type: 'Overseas' }),
    rows('SalesReturn', doc('CN-1', '2026-10-09', [line('item#1', 'GST18', 'STANDARD', 18, 1000, intra(1000, 18), { HSNCode: '7208' })], { PlaceOfSupply: '27', SourceInvoiceNumber: 'INV-1' }), reg, q('item#1', 1)),
    rows('VendorInvoice', doc('VI-1', '2026-10-10', [line('G1#1', 'GST18', 'STANDARD', 18, 2000, intra(2000, 18), { Kind: 'grn' }), line('direct#1', 'GST18B', 'STANDARD', 18, 500, [['CGST', 9, 45, 0], ['SGST', 9, 45, 0]], { Kind: 'direct' })]), { type: 'Registered' }),
    rows('VendorInvoice', doc('VI-2', '2026-10-11', [line('direct#1', 'RCM18', 'REVERSE_CHARGE', 18, 1000, igst(1000, 18), { Kind: 'direct', Reverse: true })]), { type: 'Overseas' })
  );
  const g = R.gstr1(all, cfg);
  assert.deepEqual(g.b2b.map(x => [x.GSTIN, x.Invoice, x.Rate, x.Taxable, x.POS, x.Type]), [['27ABCDE1234F1Z0', 'INV-1', 18, 10000, '27-Maharashtra', 'Regular B2B']]);
  assert.deepEqual(g.b2cl.map(x => [x.Invoice, x.Value, x.POS, x.Rate, x.Taxable]), [['INV-2', 177000, '29-Karnataka', 18, 150000]]);
  assert.deepEqual(g.b2cs.map(x => [x.POS, x.Rate, x.Taxable]), [['27-Maharashtra', 5, 1000]]);
  assert.deepEqual(g.exp.map(x => [x.ExportType, x.Invoice, x.Rate, x.Taxable]), [['WOPAY', 'INV-3', 0, 5000]]);
  assert.deepEqual(g.cdnr.map(x => [x.GSTIN, x.Note, x.NoteType, x.Rate, x.Taxable, x.Value]), [['27ABCDE1234F1Z0', 'CN-1', 'C', 18, 1000, 1180]]);
  assert.deepEqual(g.exemp[3].Nil, 200, 'nil rated, intra-state, unregistered');
  assert.deepEqual(g.hsnB2B.map(x => [x.HSN, x.Rate, x.Qty, x.Taxable, x.Cgst]), [['7208', 18, 9, 9000, 810]], 'the credit note reduces B2B\'s HSN');
  assert.deepEqual(g.hsnB2C.map(x => [x.HSN, x.Rate, x.Qty, x.Taxable]), [['', 0, 0, 200], ['7208', 0, 0, 5000], ['7208', 18, 100, 150000], ['7318', 5, 4, 1000]]);
  assert.deepEqual(g.docs.map(x => [x.Nature, x.From, x.To, x.Total]).sort(), [['Credit Note', 'CN-1', 'CN-1', 1], ['Invoices for outward supply', 'INV-1', 'INV-3', 3], ['Invoices for outward supply', 'RS-1', 'RS-1', 1]]);

  const b = R.gstr3b(all, cfg);
  assert.deepEqual([b.t31.a.Taxable, b.t31.a.Igst, b.t31.a.Cgst, b.t31.a.Sgst], [160000, 27000, 835, 835], '3.1(a) net of the credit note');
  assert.deepEqual([b.t31.b.Taxable, b.t31.c.Taxable, b.t31.d.Taxable, b.t31.d.Igst], [5000, 200, 1000, 180]);
  assert.deepEqual(b.t32.map(x => [x.POS, x.Taxable, x.Igst]), [['29-Karnataka', 150000, 27000]]);
  assert.deepEqual([b.t4.a[2].Igst, b.t4.a[5].Cgst, b.t4.b[1].Cgst, b.t4.net.Cgst, b.t4.net.Igst], [180, 225, 45, 180, 180]);
  assert.deepEqual(b.t61.map(x => [x.Tax, x.Payable, x.ReverseCharge, x.Credit, x.Cash]),
    [['Integrated tax', 27000, 180, 180, 27000], ['Central tax', 835, 0, 180, 655], ['State/UT tax', 835, 0, 180, 655], ['Cess', 0, 0, 0, 0]]);
});
