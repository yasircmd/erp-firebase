// Customer credit control's pure rules (docs/modules/CREDIT_CONTROL.md, Q360-Q365).
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../src/creditCalc');

test('open orders and deliveries are valued at their prices; only deliveries not invoiced or reversed count', () => {
  assert.equal(K.openOrderValue({ Lines: [{ OrderedQuantity: 10, DeliveredQuantity: 4, UnitPrice: 50 }, { OrderedQuantity: 2, DeliveredQuantity: 3, UnitPrice: 9 }] }), 300);
  assert.equal(K.deliveryValue({ Lines: [{ Quantity: 4, UnitPrice: 50 }, { Quantity: 1, UnitPrice: 0.5 }] }), 200.5);
  const dn = x => Object.assign({ TransactionType: 'DeliveryNote', Status: 'Posted' }, x);
  assert.deepEqual([dn({}), dn({ MatchedToInvoiceID: 'I' }), dn({ ReversedByDeliveryNoteID: 'D' }), dn({ ReversalOfDeliveryNoteID: 'D' }), dn({ Status: 'Draft' })].map(K.uninvoiced),
    [true, false, false, false, false]);
});

test('exposure as the company counts it; overdue past the grace days; the limit, the hold and what is over', () => {
  const parts = { Receivable: 1000, Deliveries: 200, Orders: 300 };
  assert.equal(K.exposureOf(parts, 'ReceivableAndOrders'), 1500);
  assert.equal(K.exposureOf(parts, 'Receivable'), 1000);
  const aging = { Items: [{ Outstanding: 400, BaseOutstanding: 400, Age: 10 }, { Outstanding: 600, BaseOutstanding: 660, Age: 40 }, { Outstanding: -50, BaseOutstanding: -50, Age: 90 }] };
  assert.deepEqual([K.overdueOf(aging, 0).Amount, K.overdueOf(aging, 0).Days], [1060, 40]);
  assert.deepEqual([K.overdueOf(aging, 10).Amount, K.overdueOf(aging, 45).Amount], [660, 0]);
  assert.deepEqual([K.limitOf(''), K.limitOf(null), K.limitOf(0), K.limitOf('12.345'), K.limitOf(-1)], [null, null, 0, 12.35, null]);
  const row = { Exposure: 1500, Limit: 1200, Hold: false, Overdue: 0 };
  assert.deepEqual(K.standing(row, 0), { Flags: ['OverLimit'], After: 1500, Over: 300 });
  assert.deepEqual(K.standing(Object.assign({}, row, { Limit: 2000 }), 600), { Flags: ['OverLimit'], After: 2100, Over: 100 });
  assert.deepEqual(K.standing(Object.assign({}, row, { Limit: null, Hold: true, Overdue: 5 }), 0), { Flags: ['Hold', 'Overdue'], After: 1500, Over: 0 });
  assert.deepEqual(K.standing(Object.assign({}, row, { Limit: 0, Exposure: 0 }), 0).Flags, [], 'cash only: nothing owed, nothing over');
  const rows = K.sortRows([{ Name: 'A', Exposure: 9, Flags: [] }, { Name: 'B', Exposure: 1, Flags: ['Overdue'] }, { Name: 'C', Exposure: 1, Flags: ['OverLimit'] }, { Name: 'D', Exposure: 0, Flags: ['Hold'] }]);
  assert.deepEqual(rows.map(r => r.Name), ['D', 'C', 'B', 'A']);
});
