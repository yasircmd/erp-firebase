// The module baseline (src/moduleBaseline.js; docs/modules/MULTI_CORPORATE.md,
// M4, decision 259) is frozen: a module added to the registry after it is
// off for every client corporate until the firm provides it. Adding a new
// module to the baseline would switch it on for every client at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('crypto');
const { BASELINE_MODULES } = require('../../src/moduleBaseline');
const { MODULE_REGISTRY } = require('../../src/moduleRegistry');

test('the baseline is frozen as it was set (2026-10-23)', () => {
  assert.equal(BASELINE_MODULES.length, 89);
  const print = createHash('sha256').update(JSON.stringify(BASELINE_MODULES)).digest('hex').slice(0, 16);
  assert.equal(print, '841425255468f724', 'moduleBaseline.js changed: a new module goes in the registry only, never the baseline');
  assert.ok(Object.isFrozen(BASELINE_MODULES));
});

test('every baseline module is in the registry (none renamed away)', () => {
  const ids = new Set(MODULE_REGISTRY.map(m => m.id));
  assert.deepEqual(BASELINE_MODULES.filter(id => !ids.has(id)), []);
});
