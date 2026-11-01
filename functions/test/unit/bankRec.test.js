// Bank reconciliation's pure rules (docs/modules/RECONCILIATION.md, Q367-Q368).
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../src/bankRecCalc');

test('a pasted statement: dates in any of the usual forms, debit and credit columns or one signed amount; a header and bad rows set apart', () => {
  const { rows, bad } = K.parseStatement([
    'Date\tDescription\tReference\tDebit\tCredit',
    '03/10/2026\tCHQ 100045 Example Supplies\t100045\t1,250.00\t',
    '2026-10-05\tTransfer in\tINV-7\t\t3,000',
    '07-10-2026\tBank charges\t\t(15)',
    '',
    'not a date\tx\ty\t1\t',
    '08/10/2026\tNothing\t\t\t'
  ].join('\n'));
  assert.deepEqual(rows.map(r => [r.Date, r.Debit, r.Credit, r.Reference]), [['2026-10-03', 1250, 0, '100045'], ['2026-10-05', 0, 3000, 'INV-7'], ['2026-10-07', 15, 0, '']]);
  assert.deepEqual(bad, [6, 7]);
  assert.equal(K.stAmount(rows[0]), -1250, 'a withdrawal is money out');
  assert.equal(K.glAmount({ Debit: 0, Credit: 1250 }), -1250);
  assert.equal(K.glAmount({ Debit: 3672.5, FcDebit: 1000 }, true), 1000, 'a foreign-currency account in its own currency');
});

test('suggestions: the same amount within a week, a reference found first, then the closer date; each line once', () => {
  const gl = [
    { Key: 'a:0', Date: '2026-10-02', Amount: -1250, Reference: '', Number: 'CBT-1', Cheque: '100045' },
    { Key: 'b:0', Date: '2026-10-03', Amount: -1250, Reference: '', Number: 'CBT-2', Cheque: '' },
    { Key: 'c:0', Date: '2026-10-05', Amount: 3000, Reference: 'INV-7', Number: 'JV-9', Cheque: '' },
    { Key: 'd:0', Date: '2026-09-01', Amount: 500, Reference: '', Number: 'CBT-3', Cheque: '' }
  ];
  const st = [
    { LineID: 's1', Date: '2026-10-04', Description: 'CHQ 100045', Reference: '', Debit: 1250, Credit: 0 },
    { LineID: 's2', Date: '2026-10-06', Description: 'Transfer', Reference: 'INV-7', Debit: 0, Credit: 3000 },
    { LineID: 's3', Date: '2026-10-20', Description: 'Deposit', Reference: '', Debit: 0, Credit: 500 }
  ];
  const s = K.suggest(gl, st);
  assert.deepEqual(s.map(m => [m.GL[0], m.ST[0], m.ByReference]), [['c:0', 's2', true], ['a:0', 's1', true]],
    'the cheque number wins over the closer date; a deposit seven weeks off is not suggested');
});

test('a match must balance: one to many, and an entry against its reversal; the report', () => {
  const glByKey = { 'a:0': { Key: 'a:0', Amount: -400 }, 'b:0': { Key: 'b:0', Amount: -600 }, 'r:0': { Key: 'r:0', Amount: 600 } };
  const stById = { s1: { LineID: 's1', Debit: 1000, Credit: 0 } };
  assert.equal(K.checkMatch({ GL: ['a:0', 'b:0'], ST: ['s1'] }, glByKey, stById), '');
  assert.match(K.checkMatch({ GL: ['a:0'], ST: ['s1'] }, glByKey, stById), /differ/);
  assert.equal(K.checkMatch({ GL: ['b:0', 'r:0'], ST: [] }, glByKey, stById), '', 'an entry and its reversal');
  assert.match(K.checkMatch({ GL: ['zz:0'], ST: [] }, glByKey, stById), /not one of this account/);
  const lines = [
    { Key: 'o:0', Date: '2026-09-30', Amount: 10000 }, // opening, cleared last month (not passed here)
    { Key: 'p:0', Date: '2026-10-10', Amount: -2000 }, // presented
    { Key: 'q:0', Date: '2026-10-28', Amount: -700 }, // not yet presented
    { Key: 'd:0', Date: '2026-10-31', Amount: 900 }, // not yet credited
    { Key: 'n:0', Date: '2026-11-02', Amount: -50 } // next month: left out
  ];
  const r = K.report(lines, new Set(['o:0', 'p:0']), 7300, '2026-10-31');
  assert.deepEqual([r.GLBalance, r.PaymentsNotPresented, r.DepositsNotCredited, r.PerBank, r.Difference], [8200, 700, 900, 8000, -700]);
  assert.deepEqual(r.Uncleared, ['q:0', 'd:0']);
  assert.equal(K.report(lines, new Set(), null, '2026-10-31').Difference, null, 'no statement balance typed: no difference');
});
