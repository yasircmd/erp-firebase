// The firm's rates sheet (docs/modules/FX_SHEET.md): its CSV read (a
// heading row in any order, quoted values, thousands commas, a cell not yet
// calculated said), and only a published Google Sheets CSV link accepted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, urlProblem } = require('../../src/fxSheet');

test('the CSV: Currency, Base, Rate in any order; quotes and commas; what can\'t be used said', () => {
  const r = parse('﻿Rate,Currency,Base\r\n3.6725,usd,AED\n"1,234.5678901",XAU,USD\n#N/A,EUR,AED\nLoading...,GBP,AED\n4.0,US,AED\n');
  assert.deepEqual(r.rates, [{ Code: 'USD', Base: 'AED', Rate: 3.6725 }, { Code: 'XAU', Base: 'USD', Rate: 1234.56789 }]);
  assert.equal(r.problems.length, 3);
  assert.match(r.problems[0], /EUR in AED: the rate "#N\/A" is not a number above 0/);
  assert.match(r.problems[2], /Row 6: Currency and Base are three-letter codes/);
  // Without a heading row: that order.
  assert.deepEqual(parse('USD,INR,84.1\n').rates, [{ Code: 'USD', Base: 'INR', Rate: 84.1 }]);
  assert.match(parse('Code,Value\nUSD,3.67\n').problems[0], /heading row needs the columns Currency, Base and Rate/);
  // A comma decimal is refused, never read as a thousands separator.
  const comma = parse('GBP,AED,"4,8"\nINR,AED,"1,000"\n');
  assert.deepEqual(comma.rates, [{ Code: 'INR', Base: 'AED', Rate: 1000 }]);
  assert.match(comma.problems[0], /GBP in AED: the rate "4,8" has a comma; the sheet must show decimals with a dot/);
});

test('only a sheet published to the web as CSV', () => {
  const ok = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vExample_Key-123/pub?gid=0&single=true&output=csv';
  assert.equal(urlProblem(ok), '');
  assert.equal(urlProblem(''), '', 'none: no sheet');
  ['https://docs.google.com/spreadsheets/d/1abc/edit#gid=0', 'http://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv',
    'https://example.com/rates.csv', 'https://docs.google.com.evil.example/spreadsheets/d/e/x/pub?output=csv',
    'https://docs.google.com/spreadsheets/d/e/x/pub?output=html', 'http://169.254.169.254/latest/meta-data']
    .forEach(u => assert.match(urlProblem(u), /published CSV link/, u));
});
