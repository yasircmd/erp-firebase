// Module Builder, phase 6 (MODULE_BUILDER.md, Q493-Q499): a pack checked
// against its modules; every pack in the code valid, with made-up names and
// its Help page; an action made as a variant.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const B = require('../../src/builtDefinitions');
const P = require('../../src/builtPacks');

const ROOM = { id: 'X_TROOM', label: 'Room', kind: 'master', fields: [{ key: 'rate', label: 'Rate', type: 'amount' }] };
const STAY = { id: 'X_TSTAY', label: 'Stay', kind: 'document', numbering: { prefix: 'TS' },
  fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER' }, { key: 'room', label: 'Room', type: 'link', target: 'X_TROOM' }, { key: 'amount', label: 'Amount', type: 'amount' }],
  statuses: [{ name: 'Open' }, { name: 'Out' }], actions: [{ key: 'bill', label: 'Bill', target: 'CUSTOMERINVOICE', statuses: ['Out'], party: 'guest', amount: 'amount', variant: 'x_tinv', variantFields: { room: 'room' } }] };
const PACK = { id: 'p_test', label: 'Test', modules: ['X_TROOM', 'X_TSTAY'],
  reports: [{ key: 'byRoom', name: 'By room', dataset: 'x:X_TSTAY', spec: { view: 'group', groupBy: ['f_room'], measures: [{ field: 'f_amount', agg: 'sum' }] }, tile: 'chart' }],
  checklist: [{ key: 'books', kind: 'setup', module: 'X_TSTAY', text: 'Set the books.' }, { key: 'tax', kind: 'tax', text: 'Add the fee.' }] };

test('a pack: its modules its own, its menu, reports on its data sets, its checklist', () => {
  const defs = P.cleanDefinitions({ definitions: [ROOM, STAY] }, []);
  assert.deepEqual([defs[1].actions[0].variant, defs[1].actions[0].variantFields], ['X_TINV', { room: 'room' }]);
  const p = P.cleanPack(PACK, defs);
  assert.deepEqual([p.id, p.menu.folder, p.menu.items.map(i => [i.module, i.text]), p.reports[0].months, p.reports[0].tile], ['P_TEST', 'Test', [['X_TROOM', 'Room'], ['X_TSTAY', 'Stay']], 1, 'chart']);
  const no = (x, re) => assert.throws(() => P.cleanPack(Object.assign({}, PACK, x), defs), re);
  no({ id: 'HOTEL' }, /starts with P_/);
  no({ modules: ['X_TROOM', 'X_NONE'] }, /X_NONE is not one of its definitions/);
  no({ menu: { items: [{ module: 'X_TROOM' }, { module: 'X_TROOM' }] } }, /in its menu twice/);
  no({ reports: [Object.assign({}, PACK.reports[0], { dataset: 'gl' })] }, /"gl" is not a data set of the pack's modules/);
  no({ reports: [Object.assign({}, PACK.reports[0], { spec: { view: 'group', groupBy: ['f_none'], measures: [{ field: 'f_amount', agg: 'sum' }] } })] }, /Unknown field for grouping: f_none/);
  no({ checklist: [{ key: 'books', kind: 'setup', module: 'X_TROOM', text: 'x' }] }, /with actions/);
  no({ checklist: [{ key: 'a', kind: 'tax', text: 'x' }, { key: 'a', kind: 'manual', text: 'y' }] }, /same key/);
  no({ checklist: [{ key: 'a', kind: 'wish', text: 'x' }] }, /setup, tax, rights or manual/);
  assert.throws(() => B.cleanDefinition(Object.assign({}, STAY, { actions: [Object.assign({}, STAY.actions[0], { variantFields: { room: 'nothing' } })] }), ['X_TROOM']), /not a header field/);
});

test('the packs in the code: five, each valid with its modules, distinct ids and prefixes, a Help page each', () => {
  const all = P.catalogue();
  assert.deepEqual(all.map(e => e.pack.id), ['P_HOTEL', 'P_SUBS', 'P_REALTY', 'P_INVEST', 'P_CONSTR']);
  const ids = [], prefixes = [];
  all.forEach(e => {
    const defs = P.cleanDefinitions(e, []);
    const p = P.cleanPack(e.pack, defs);
    assert.deepEqual(defs.map(d => d.id).sort(), p.modules.slice().sort(), p.id + ': its definitions are its modules');
    defs.forEach(d => { ids.push(d.id); if (d.numbering) prefixes.push(d.numbering.prefix); });
    // An action's variant is one of the pack's.
    defs.flatMap(d => d.actions || []).filter(a => a.variant).forEach(a => assert.ok(defs.some(d => d.id === a.variant && d.kind === 'variant' && d.base === a.target), p.id + ': ' + a.variant));
    assert.ok(fs.existsSync(path.join(__dirname, '../../../help/pages', p.help + '.md')), p.id + ': its Help page ' + p.help);
  });
  assert.equal(new Set(ids).size, ids.length, 'module ids unique across packs');
  assert.equal(new Set(prefixes).size, prefixes.length, 'number prefixes unique across packs');
});
