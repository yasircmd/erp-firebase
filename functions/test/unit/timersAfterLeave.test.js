// A screen's timer can fire after the user has left the screen, when its
// elements are gone: `setTimeout(() => { $('x').innerHTML = … })` then throws
// a page error (found by the stock reports' UI check, 2026-10-12, after Copy).
// A timer looks its element up and checks it, or keeps the element it already
// has (`btn`), which is harmless once detached.
//   node --test functions/test/unit/timersAfterLeave.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const screens = fs.readdirSync(path.join(REPO, 'screens')).filter(f => f.endsWith('.html')).map(f => 'screens/' + f);

// A timer whose callback starts by using an element it looks up by id.
const UNGUARDED = /setTimeout\(\s*(?:\(\)\s*=>|function\s*\(\)\s*)\s*\{?\s*(?:\$|document\.getElementById)\(\s*['"][^'"]+['"]\s*\)\s*\./;
const find = (text, file) => text.split('\n').flatMap((l, i) => UNGUARDED.test(l) ? [file + ':' + (i + 1)] : []);

test('no screen\'s timer uses an element it looks up without checking it is still there', () => {
  assert.ok(screens.length > 50, 'found the screens');
  const found = screens.flatMap(f => find(fs.readFileSync(path.join(REPO, f), 'utf8'), f));
  assert.deepEqual(found, [], "write setTimeout(() => { const b = $('id'); if (b) … })");
});

test('the detector finds the unguarded forms and passes the guarded ones', () => {
  const hits = s => find(s, 'X').length;
  assert.equal(hits("setTimeout(() => { $('a-copy').innerHTML = 'Copy'; }, 2000);"), 1);
  assert.equal(hits("setTimeout(() => $('fac-ok').classList.add('hidden'), 3000);"), 1);
  assert.equal(hits("setTimeout(function () { document.getElementById(\"x\").focus(); }, 50);"), 1);
  assert.equal(hits("setTimeout(() => { const b = $('a-copy'); if (b) b.innerHTML = 'Copy'; }, 2000);"), 0);
  assert.equal(hits("setTimeout(() => { btn.innerHTML = original; }, 2000);"), 0);
});
