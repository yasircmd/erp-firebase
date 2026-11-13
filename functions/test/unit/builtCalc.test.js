// Module Builder, phase 6 (MODULE_BUILDER.md, Q497): calculated fields. Their
// definition checks (what each works on, in order, no loops), their values
// (a booking's nights and amount, a claim's lines, totals, retention), and
// what earlier documents add (a contract's earlier claims).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/builtDefinitions');
const C = require('../../src/builtCalc');

const STAY = {
  id: 'X_STAY', label: 'Stay', kind: 'document', numbering: { prefix: 'ST' },
  fields: [{ key: 'arrive', label: 'Arrive', type: 'date' }, { key: 'leave', label: 'Leave', type: 'date' }, { key: 'rate', label: 'Rate', type: 'amount' },
    { key: 'nights', label: 'Nights', type: 'calc', op: 'days', of: ['arrive', 'leave'] },
    { key: 'amount', label: 'Amount', type: 'calc', op: 'product', of: ['nights', 'rate'] },
    { key: 'tax', label: 'Tax', type: 'calc', op: 'percent', of: ['amount'], value: 7 }]
};
const CLAIM = {
  id: 'X_CLAIM', label: 'Claim', kind: 'document', numbering: { prefix: 'PC' },
  fields: [{ key: 'contract', label: 'Contract', type: 'link', target: 'X_CONTRACT' }, { key: 'retPct', label: 'Retention %', type: 'number' },
    { key: 'thisClaim', label: 'This claim', type: 'calc', op: 'sum', of: ['t:thisAmount', 't:zero'] },
    { key: 'retention', label: 'Retention', type: 'calc', op: 'percent', of: ['thisClaim', 'retPct'] },
    { key: 'net', label: 'Net', type: 'calc', op: 'difference', of: ['thisClaim', 'retention'] },
    { key: 'claimedBefore', label: 'Claimed before', type: 'calc', op: 'previous', of: ['t:thisAmount'], by: 'contract', skip: ['Cancelled'] }],
  lines: { enabled: true, label: 'Work', fields: [{ key: 'ref', label: 'BOQ ref', type: 'text' }, { key: 'qty', label: 'Qty to date', type: 'number' }, { key: 'rate', label: 'Rate', type: 'amount' },
    { key: 'toDate', label: 'To date', type: 'calc', op: 'product', of: ['qty', 'rate'] },
    { key: 'before', label: 'Before', type: 'calc', op: 'previous', of: ['thisAmount'], by: 'contract', match: 'ref', skip: ['Cancelled'] },
    { key: 'thisAmount', label: 'This claim', type: 'calc', op: 'difference', of: ['toDate', 'before'] },
    { key: 'zero', label: 'Zero', type: 'number' }] },
  statuses: [{ name: 'Draft' }, { name: 'Certified' }, { name: 'Cancelled', final: true }]
};

test('calculated fields in a definition: what each works on, before it, by type; money or not; no loops', () => {
  const s = B.cleanDefinition(STAY, []);
  assert.deepEqual(s.fields.slice(3).map(f => [f.key, f.op, f.money]), [['nights', 'days', false], ['amount', 'product', true], ['tax', 'percent', true]]);
  assert.equal(s.fields[5].value, 7);
  const no = (d, re) => assert.throws(() => B.cleanDefinition(d, ['X_CONTRACT']), re);
  const withField = (def, i, x) => Object.assign({}, def, { fields: def.fields.map((f, j) => (j === i ? Object.assign({}, f, x) : f)) });
  no(withField(STAY, 4, { of: ['tax', 'rate'] }), /"tax" is not a field before it/);
  no(withField(STAY, 4, { of: ['amount', 'rate'] }), /"amount" is not a field before it/);
  no(withField(STAY, 3, { of: ['arrive', 'rate'] }), /two date fields/);
  no(withField(STAY, 4, { of: ['arrive', 'rate'] }), /works on number, amount or calculated/);
  no(withField(STAY, 4, { op: 'square' }), /choose what it works out/);
  no(withField(STAY, 4, { of: ['rate'] }), /2 to 5 fields/);
  no(withField(STAY, 5, { value: '' }), /give the percentage/);
  no(withField(STAY, 4, { of: ['t:rate', 'rate'] }), /not a field before it/);
  const c = B.cleanDefinition(CLAIM, ['X_CONTRACT']);
  assert.deepEqual(c.lines.fields.filter(f => f.type === 'calc').map(f => [f.key, f.money]), [['toDate', true], ['before', true], ['thisAmount', true]]);
  assert.deepEqual(c.fields.filter(f => f.type === 'calc').map(f => [f.key, f.money]), [['thisClaim', true], ['retention', true], ['net', true], ['claimedBefore', true]]);
  const withLine = (i, x) => Object.assign({}, CLAIM, { lines: Object.assign({}, CLAIM.lines, { fields: CLAIM.lines.fields.map((f, j) => (j === i ? Object.assign({}, f, x) : f)) }) });
  no(withLine(3, { of: ['qty', 'h:retention'] }), /h:<header field>/, 'a line uses only a header field that is not calculated');
  assert.doesNotThrow(() => B.cleanDefinition(withLine(3, { of: ['qty', 'h:retPct'] }), ['X_CONTRACT']));
  no(withLine(4, { match: 'toDate' }), /matches a line/);
  no(withLine(4, { by: 'retPct' }), /totals by a link field/);
  no(withLine(4, { skip: ['Gone'] }), /"Gone" is not one of its statuses/);
  no(Object.assign({}, STAY, { kind: 'master', numbering: undefined, fields: STAY.fields.concat([{ key: 'p', label: 'P', type: 'calc', op: 'previous', of: ['rate'], by: 'rate' }]) }), /for a document/);
  // An action's amount may be a calculated field; its project a link to projects.
  const withAct = Object.assign({}, CLAIM, { fields: CLAIM.fields.concat([{ key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER' }, { key: 'project', label: 'Project', type: 'link', target: 'PROJECT' }]),
    actions: [{ key: 'invoice', label: 'Invoice', target: 'CUSTOMERINVOICE', statuses: ['Certified'], party: 'customer', amount: 'thisClaim', project: 'project' }] });
  assert.deepEqual([B.cleanDefinition(withAct, ['X_CONTRACT']).actions[0].amount, B.cleanDefinition(withAct, ['X_CONTRACT']).actions[0].project], ['thisClaim', 'project']);
  no(Object.assign({}, withAct, { actions: [Object.assign({}, withAct.actions[0], { project: 'customer' })] }), /link field \(of the header\) to projects/);
  // A variant's extra fields are never calculated.
  assert.throws(() => B.cleanDefinition({ id: 'X_VAR', label: 'V', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'VAR' }, fields: [{ key: 'a', label: 'A', type: 'calc', op: 'sum', of: ['b', 'c'] }] }, []), /choose its type/);
});

test('values: a booking\'s nights, amount and tax; a claim\'s lines, totals, retention and net, with what earlier claims add', () => {
  const s = B.cleanDefinition(STAY, []);
  const v = C.apply(s, { arrive: '2026-11-10', leave: '2026-11-13', rate: 333.33 }, [], null).fields;
  assert.deepEqual([v.nights, v.amount, v.tax], [3, 999.99, 70]);
  assert.deepEqual(C.apply(s, { arrive: '', leave: '2026-11-13', rate: 100 }, [], null).fields.amount, 0, 'no dates, no nights');
  const c = B.cleanDefinition(CLAIM, ['X_CONTRACT']);
  const lines = [{ ref: 'A1', qty: 10, rate: 50 }, { ref: 'A2', qty: 4, rate: 25.5 }, { ref: 'A3', qty: 0, rate: 9 }];
  const prev = { head: { claimedBefore: 300 }, lines: { before: { A1: 300 } } };
  const r = C.apply(c, { contract: { id: 'K1' }, retPct: 10 }, lines, prev);
  assert.deepEqual(r.lines.map(l => [l.toDate, l.before, l.thisAmount]), [[500, 300, 200], [102, 0, 102], [0, 0, 0]]);
  assert.deepEqual([r.totals.toDate, r.totals.thisAmount, r.fields.thisClaim, r.fields.retention, r.fields.net, r.fields.claimedBefore], [602, 302, 302, 30.2, 271.8, 300]);
});

test('earlier documents: the same contract, earlier by date then by when made, a skipped status not counted, lines by their match', () => {
  const c = B.cleanDefinition(CLAIM, ['X_CONTRACT']);
  const rec = (id, date, made, status, contract, lines, thisAmount) => ({ RecordID: id, Date: date, CreatedAt: made, Status: status, Fields: { contract: { id: contract } }, Lines: lines, Totals: { thisAmount } });
  const all = [
    rec('P1', '2026-09-30', 'a', 'Certified', 'K1', [{ ref: 'A1', thisAmount: 100 }, { ref: 'A2', thisAmount: 40 }], 140),
    rec('P2', '2026-10-31', 'b', 'Certified', 'K1', [{ ref: 'A1', thisAmount: 200 }], 200),
    rec('P3', '2026-10-31', 'c', 'Cancelled', 'K1', [{ ref: 'A1', thisAmount: 999 }], 999),
    rec('P4', '2026-10-31', 'd', 'Draft', 'K2', [{ ref: 'A1', thisAmount: 777 }], 777),
    rec('P5', '2026-12-31', 'e', 'Draft', 'K1', [{ ref: 'A1', thisAmount: 555 }], 555)
  ];
  const me = { RecordID: 'NEW', Date: '2026-11-30', CreatedAt: '', Fields: { contract: { id: 'K1' } } };
  assert.deepEqual(C.previousFrom(c, me, all), { head: { claimedBefore: 340 }, lines: { before: { A1: 300, A2: 40 } } });
  // The same day: made earlier counts, made later does not; itself never.
  assert.deepEqual(C.previousFrom(c, { RecordID: 'P2', Date: '2026-10-31', CreatedAt: 'b', Fields: { contract: { id: 'K1' } } }, all).head.claimedBefore, 140);
  assert.deepEqual(C.previousFrom(c, { RecordID: 'X', Date: '2026-10-31', CreatedAt: 'a0', Fields: { contract: { id: 'K1' } } }, all).head.claimedBefore, 140);
  assert.deepEqual(C.previousFrom(c, Object.assign({}, me, { Fields: {} }), all).head.claimedBefore, 0, 'no contract, nothing before');
});
