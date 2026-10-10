// Dates show dd/mm/yyyy and periods Sep-2026 (owner, 2026-09-29; the DATE
// FORMAT block in public/index.html). The rule itself, sliced from the
// shell and run here, and a guard that no screen formats dates its own way
// (the Deploy workflow runs this file).
//   node --test functions/test/unit/dateFormat.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '../../..');
const shell = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
const block = shell.slice(shell.indexOf('// ---------- DATE FORMAT ----------'), shell.indexOf('// ---------- END DATE FORMAT ----------'));
// The pure part: the patterns, formatDatesInText and isoLocalDateTime.
const pure = block.slice(block.indexOf('const MONTH_NAMES'), block.indexOf('window.isoLocalDateTime = '));
const ctx = vm.createContext({});
vm.runInContext(pure + '\nthis.formatDatesInText = formatDatesInText; this.isoLocalDateTime = isoLocalDateTime;', ctx);
const f = ctx.formatDatesInText;

test('dates show dd/mm/yyyy, periods Sep-2026, times dd/mm/yyyy HH:MM', () => {
  assert.equal(f('2026-09-29'), '29/09/2026');
  assert.equal(f('2026-09'), 'Sep-2026');
  assert.equal(f('Period 2026-09 is closed; next open 2026-10-01.'), 'Period Sep-2026 is closed; next open 01/10/2026.');
  assert.equal(f('2026-09-20T08:03:11.512Z'), '20/09/2026 08:03');
  assert.equal(f('2026-09-20 14:05'), '20/09/2026 14:05');
  assert.equal(f('From 2026-01-01 to 2026-12-31'), 'From 01/01/2026 to 31/12/2026');
  assert.equal(f('(2026-02)'), '(Feb-2026)');
});

test('codes, numbers and other text are left alone', () => {
  for (const s of ['INV-2026-09-001', 'REF-2026-09-29', 'RM-2024-01', '2026-09-001', '1000-12', 'Account 1100-11', '12-2026',
    '20260929T120558Z-9fac02d', '2026-13-01', '2026-13', '2026-09-32', 'JO-26-1-1', 'FT-2026', '3026-09-01',
    '2026/09/29', 'abc2026-09-29', '2026-09-29x', 'No date here', '']) {
    assert.equal(f(s), s, s);
  }
  assert.equal(f(undefined), undefined);
});

test('isoLocalDateTime: local time as yyyy-mm-dd HH:MM (shown dd/mm/yyyy HH:MM)', () => {
  assert.equal(ctx.isoLocalDateTime(new Date(2026, 8, 5, 7, 4)), '2026-09-05 07:04');
  assert.equal(f(ctx.isoLocalDateTime(new Date(2026, 8, 5, 7, 4))), '05/09/2026 07:04');
  assert.equal(ctx.isoLocalDateTime('not a date'), '');
});

test('the shell applies it to the whole page, Excel copies and the copy box', () => {
  assert.match(block, /\.observe\(document\.body, \{ childList: true, subtree: true, characterData: true \}\)/);
  assert.match(block, /navigator\.clipboard\.writeText = text => writeText\(formatDatesInText\(text\)\)/);
  assert.match(block, /\/\^Copy this text\/\.test/);
});

test('no screen formats dates its own way (use yyyy-mm-dd, or window.isoLocalDateTime for a time)', () => {
  const own = /new Date\([^)]*\)\.toLocale\w*String|\.toLocaleDateString\(|\.toLocaleTimeString\(|Intl\.DateTimeFormat/;
  const files = [...fs.readdirSync(path.join(REPO, 'screens')).filter(n => n.endsWith('.html')).map(n => 'screens/' + n), 'public/index.html', 'public/ess.html'];
  const found = [];
  for (const file of files) {
    fs.readFileSync(path.join(REPO, file), 'utf8').split('\n').forEach((line, i) => { if (own.test(line)) found.push(file + ':' + (i + 1)); });
  }
  assert.deepEqual(found, []);
});
