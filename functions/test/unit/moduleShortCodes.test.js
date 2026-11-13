// Module short codes (owner, 2026-11-13; docs/modules/UX4.md item 8, Q504):
// every module of the registry has one, unique, 2 to 4 capital letters or
// digits; none left for a module that is gone; a built module's comes from its
// id unless taken; the menu carries it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULE_REGISTRY } = require('../../src/moduleRegistry');
const { SHORT, codeFor } = require('../../src/moduleShortCodes');

test('every module has its own code, 2 to 4 capitals or digits, none for a module that is gone', () => {
  const ids = MODULE_REGISTRY.filter(m => !m.built).map(m => m.id);
  assert.deepEqual(ids.filter(id => !SHORT[id]), [], 'a module without a code');
  assert.deepEqual(Object.keys(SHORT).filter(id => !ids.includes(id)), [], 'a code for a module not in the registry');
  const codes = Object.values(SHORT);
  assert.equal(new Set(codes).size, codes.length, 'codes are unique: ' + codes.filter((c, i) => codes.indexOf(c) !== i).join(', '));
  codes.forEach(c => assert.match(c, /^[A-Z][A-Z0-9]{1,3}$/, c));
});

test('a built module: the first letters of its id, unless taken', () => {
  assert.equal(codeFor('X_HBOOK'), 'HBOO');
  assert.equal(codeFor('X_COA_EXTRA'), 'COAE', 'letters and digits only, the _ dropped');
  assert.equal(codeFor('X_GRN'), '', 'GRN is the Goods Receipt\'s');
  assert.equal(codeFor('X_A'), '', 'too short');
  assert.equal(codeFor('JV'), 'JV');
  assert.equal(codeFor('NOPE'), '');
});

test('the menu carries each module\'s code', () => {
  const { buildVisibleTreeList } = require('../../src/tree');
  const list = buildVisibleTreeList({ F: { Text: 'Finance', ParentID: '', ModuleID: '', Order: 0, AllowedRoles: ['ADMIN'] }, N: { Text: 'Journal', ParentID: 'F', ModuleID: 'JV', Order: 0, AllowedRoles: ['ADMIN'] } }, 'ADMIN');
  assert.deepEqual(list.map(i => [i.text, i.short]), [['Finance', ''], ['Journal', 'JV']]);
});
