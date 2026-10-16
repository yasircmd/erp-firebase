// The end-of-service statement's amount in words and length of service
// (docs/modules/EOS_STATEMENT.md).
//   node --test functions/test/unit/eosStatement.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { amountInWords, serviceLength } = require('../../src/eosStatement');

test('the amount in words, in the currency given, the hundredths as a fraction', () => {
  assert.equal(amountInWords(12345.5, 'AED'), 'AED Twelve Thousand Three Hundred Forty-Five and 50/100 only');
  assert.equal(amountInWords(1000000, 'USD'), 'USD One Million only');
  assert.equal(amountInWords(219011.07, 'QAR'), 'QAR Two Hundred Nineteen Thousand Eleven and 07/100 only');
  assert.equal(amountInWords(0, ''), 'Zero only');
  assert.equal(amountInWords(-90.1, 'AED'), 'AED Ninety and 10/100 only');
});

test('service in whole years, months and days, both ends counted', () => {
  const s = (a, b) => Object.values(serviceLength(a, b));
  assert.deepEqual(s('2021-03-15', '2026-09-14'), [5, 6, 0]);
  assert.deepEqual(s('2024-01-01', '2026-08-31'), [2, 8, 0]);
  assert.deepEqual(s('2023-02-28', '2026-10-15'), [3, 7, 18]);
  assert.deepEqual(s('2024-01-31', '2024-03-30'), [0, 2, 0]);
  assert.deepEqual(s('2025-06-10', '2025-06-10'), [0, 0, 1]);
  assert.deepEqual(s('2025-06-10', '2025-06-09'), [0, 0, 0]);
});
