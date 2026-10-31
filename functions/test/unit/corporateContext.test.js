// One request, one corporate (docs/modules/MULTI_CORPORATE.md §4, M1): what
// keeps every function inside its request's corporate.
// - Every callable goes through callable.js, which sets the corporate; the
//   one HTTP function (Google's Drive sign-in return) sets it from its link.
// - Only tests and tools work outside a request (useCorporateOutsideRequests).
// - The firm's own project (firebaseAdmin.firm) is reached only for what the
//   firm keeps: the directory and the screens release.
// - No module keeps data between requests (that would be shared between
//   corporates in one function instance), except the listed ones.
// - The handles refuse to work outside a corporate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const files = [];
(function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  });
})(SRC);
const rel = p => path.relative(SRC, p).split(path.sep).join('/');
const read = p => fs.readFileSync(p, 'utf8');
const INDEX = path.join(__dirname, '../../index.js');

test('every callable goes through callable.js; the one HTTP function sets its corporate', () => {
  const bad = [];
  files.concat(INDEX).forEach(p => {
    const s = read(p);
    const name = p === INDEX ? 'index.js' : rel(p);
    if (name !== 'callable.js' && /\bonCall\s*\(/.test(s)) bad.push(name + ': onCall');
    if (/require\('firebase-functions\/v2\/(?!https')/.test(s) || /require\('firebase-functions'\)/.test(s)) bad.push(name + ': a trigger that is not a callable');
    if (/\bonRequest\s*\(/.test(s) && name !== 'attachments.js') bad.push(name + ': onRequest');
  });
  assert.deepEqual(bad, []);
  const a = read(path.join(SRC, 'attachments.js'));
  const handler = a.slice(a.indexOf('exports.driveOAuthCallback = onRequest'));
  assert.match(handler.slice(0, handler.indexOf('\n});')), /runInCorporate\(corporate, /, 'driveOAuthCallback runs in its corporate');
});

test('only tests and tools work outside a request', () => {
  const callers = files.filter(p => /useCorporateOutsideRequests\s*\(/.test(read(p))).map(rel);
  assert.deepEqual(callers, ['firebaseAdmin.js'], 'defined there, called by no function');
});

test('the firm\'s own project is reached only for the directory and the screens release', () => {
  const users = files.filter(p => rel(p) !== 'firebaseAdmin.js' && /\bfirm\b[\s\S]{0,80}require\('\.\.?\/firebaseAdmin'\)|firebaseAdmin\.firm\b/.test(read(p))).map(rel).sort();
  // fxSheet.js: the firm's exchange-rates sheet link only (FX_SHEET.md, Q330); the rates it applies are the corporate's.
  assert.deepEqual(users, ['corporates.js', 'developer.js', 'fxSheet.js', 'getModuleFragment.js', 'support.js']);
});

test('no module keeps data between requests, except these', () => {
  const ALLOWED = {
    'firebaseAdmin.js': ['context', 'outsideRequests'], // the corporate itself
    'documentStorage.js': ['cachedTokens'], // the Drive access token, per corporate
    'getModuleFragment.js': ['cachedRelease', 'cache'], // the screens release: code, the firm's
    'numbering.js': ['KINDS'], // the document kinds, static
    'periodLock.js': ['consentStore', 'ADJUSTABLE_TYPES'], // per request; static
    'budgetConsent.js': ['store'], // per request (the budget consent, docs/modules/BUDGET.md B3)
    'developer.js': ['HOME_ONLY'], // static: the registry's Corporate-100-only modules
    'legacy/runtime.js': ['als'] // per request
  };
  const found = {};
  files.forEach(p => {
    const name = rel(p);
    if (name === 'legacy/codegs.js' || name === 'legacy/callables.js') return;
    read(p).split('\n').forEach(line => {
      const m = /^(?:let|var)\s+([A-Za-z_$][\w$]*)/.exec(line) || /^const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:Map|Set|WeakMap|AsyncLocalStorage)\b/.exec(line);
      if (m) (found[name] = found[name] || []).push(m[1]);
    });
  });
  assert.deepEqual(found, ALLOWED);
});

test('the generated port keeps no data between requests either', () => {
  // Top-level statements of codegs.js are function declarations, the helper
  // routing (const x = (...) => ...) and fixed tables (UPPER_CASE). A
  // top-level let/var, any other object, or a table the code changes would
  // be state shared between corporates.
  const s = read(path.join(SRC, 'legacy/codegs.js'));
  const lines = s.split('\n');
  assert.deepEqual(lines.filter(l => /^(?:let|var)\s/.test(l) || /^const\s+(?![A-Z][A-Z0-9_]*\s*=)[\w$]+\s*=\s*(?:\{|\[|new\s)/.test(l)), []);
  const tables = lines.map(l => /^const\s+([A-Z][A-Z0-9_]*)\s*=\s*(?:\{|\[)/.exec(l)).filter(Boolean).map(m => m[1]);
  assert.ok(tables.length >= 10, 'the tables found: ' + tables.length);
  const changed = tables.filter(t => new RegExp('\\b' + t + '(?:\\[[^\\]]*\\]|\\.[\\w$]+)*\\s*(?:=(?!=)|\\+=|-=)|\\b' + t + '(?:\\.[\\w$]+)*\\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|set|add|delete|clear)\\(|delete\\s+' + t + '\\b').test(s.replace(new RegExp('^const\\s+' + t + '\\s*=', 'm'), '')));
  assert.deepEqual(changed, [], 'a table the port changes');
});

test('the handles follow the corporate, and refuse to work outside one', async () => {
  const fa = require('../../src/firebaseAdmin');
  assert.throws(() => fa.rtdb.ref('x'), /No corporate for this request/);
  assert.throws(() => fa.firestore.collection('x'), /No corporate for this request/);
  assert.throws(() => fa.admin.auth(), /No corporate for this request/);
  assert.throws(() => fa.corporateId(), /No corporate for this request/);
  const entry = { ProjectID: 'erp-client-unit', DatabaseURL: 'https://erp-client-unit-default-rtdb.firebaseio.com' };
  const seen = await Promise.all([
    fa.runInCorporate({ id: '200', entry }, async () => {
      await new Promise(r => setTimeout(r, 20));
      return [fa.corporateId(), fa.rtdb.app.options.databaseURL, fa.firestore.collection('x').firestore.projectId, fa.admin.auth().app.options.projectId];
    }),
    fa.runInCorporate({ id: '100' }, async () => [fa.corporateId(), fa.rtdb.app.name, fa.admin.auth().app.name])
  ]);
  assert.deepEqual(seen[0], ['200', entry.DatabaseURL, 'erp-client-unit', 'erp-client-unit']);
  assert.deepEqual(seen[1], ['100', '[DEFAULT]', '[DEFAULT]']);
  assert.throws(() => fa.rtdb.ref('x'), /No corporate for this request/, 'still nothing outside');
  // The rest of the SDK is as it is.
  assert.equal(typeof fa.admin.firestore.FieldValue.serverTimestamp, 'function');
  await Promise.all(fa.admin.apps.map(a => a.delete()));
});
