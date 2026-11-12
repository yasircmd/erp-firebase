// Module Builder, phase 6 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q497): calculated fields, worked out on the server whatever the screen sends.
// A booking's nights, amount and tax; a master's; a contract's progress claims
// with their earlier claims (a cancelled one not counted, a later claim not
// changing an earlier one); a claim's invoice for its calculated amount on the
// record's own project, with retention moved off the customer by a journal;
// the line totals; Project as a link (closed ones not offered).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };

const ROOM = { id: 'X_ROOM', label: 'Room', kind: 'master', fields: [{ key: 'rate', label: 'Rate', type: 'amount' }, { key: 'weekly', label: 'Weekly', type: 'calc', op: 'product', of: ['rate', 'days'] }, { key: 'days', label: 'Days', type: 'number' }] };
const STAY = { id: 'X_STAY', label: 'Stay', kind: 'document', numbering: { prefix: 'ST' },
  fields: [{ key: 'arrive', label: 'Arrive', type: 'date' }, { key: 'leave', label: 'Leave', type: 'date' }, { key: 'rate', label: 'Rate', type: 'amount' },
    { key: 'nights', label: 'Nights', type: 'calc', op: 'days', of: ['arrive', 'leave'] },
    { key: 'amount', label: 'Amount', type: 'calc', op: 'product', of: ['nights', 'rate'] },
    { key: 'fee', label: 'Municipality fee', type: 'calc', op: 'percent', of: ['amount'], value: 7 }],
  statuses: [{ name: 'Booked' }, { name: 'Out' }, { name: 'Cancelled', final: true }] };
const CONTRACT = { id: 'X_CONTRACT', label: 'Contract', kind: 'master', fields: [{ key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER' }, { key: 'project', label: 'Project', type: 'link', target: 'PROJECT' }] };
const CLAIM = { id: 'X_CLAIM', label: 'Progress claim', kind: 'document', numbering: { prefix: 'PC' },
  fields: [{ key: 'contract', label: 'Contract', type: 'link', target: 'X_CONTRACT', required: true }, { key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER', required: true },
    { key: 'project', label: 'Project', type: 'link', target: 'PROJECT' }, { key: 'retPct', label: 'Retention %', type: 'number' },
    { key: 'thisClaim', label: 'This claim', type: 'calc', op: 'sum', of: ['t:thisAmount', 't:extra'] },
    { key: 'retention', label: 'Retention', type: 'calc', op: 'percent', of: ['thisClaim', 'retPct'] },
    { key: 'claimedBefore', label: 'Claimed before', type: 'calc', op: 'previous', of: ['thisClaim'], by: 'contract', skip: ['Cancelled'] }],
  lines: { enabled: true, label: 'Work', fields: [{ key: 'ref', label: 'BOQ ref', type: 'text' }, { key: 'qty', label: 'Qty to date', type: 'number' }, { key: 'rate', label: 'Rate', type: 'amount' },
    { key: 'toDate', label: 'To date', type: 'calc', op: 'product', of: ['qty', 'rate'] },
    { key: 'before', label: 'Claimed before', type: 'calc', op: 'previous', of: ['thisAmount'], by: 'contract', match: 'ref', skip: ['Cancelled'] },
    { key: 'thisAmount', label: 'This claim', type: 'calc', op: 'difference', of: ['toDate', 'before'] },
    { key: 'extra', label: 'Extra', type: 'number' }] },
  statuses: [{ name: 'Draft' }, { name: 'Certified' }, { name: 'Cancelled', final: true }],
  actions: [
    { key: 'invoice', label: 'Invoice the claim', target: 'CUSTOMERINVOICE', statuses: ['Certified'], party: 'customer', amount: 'thisClaim', project: 'project', description: 'Claim {number}' },
    { key: 'retain', label: 'Hold retention', target: 'JV', statuses: ['Certified'], party: 'customer', partySide: 'credit', amount: 'retention', project: 'project' }] };

function fixture() {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Example Developer LLC', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Contract revenue', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.coa['A-RET'] = { AccountCode: '1250', AccountName: 'Retention receivable', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  f.orgUnits.P1 = { Type: 'Project', Code: 'PJ-01', Name: 'Tower A', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.P9 = { Type: 'Project', Code: 'PJ-09', Name: 'Old site', Status: 'Closed', CompanyID: 'C1' };
  ['X_ROOM', 'X_CONTRACT'].forEach(id => { f.permissions[id] = { access: ['Admin'], write: ['Admin'] }; });
  ['X_STAY', 'X_CLAIM'].forEach(id => { f.permissions[id] = { access: ['Admin'], write: ['Admin'], void: ['Admin'] }; });
  return f;
}
async function publish(def) {
  ok(await call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }));
  return ok(await call('u-admin', 'publishModuleDefinition', { id: def.id }));
}
const save = (mod, record) => call('u-admin', 'saveBuiltRecord', { moduleId: mod, record }).then(ok);
const rec = async (mod, id) => (await call('u-admin', 'getBuiltRecord', { moduleId: mod, id })).record;

test('a booking\'s and a master\'s calculated fields, worked out on the server whatever is sent', async () => {
  await reset(fixture());
  // A master's calc names a field after it: refused (only fields before it).
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { definition: ROOM, isNew: true })), /"days" is not a field before it/);
  await publish(Object.assign({}, ROOM, { fields: [ROOM.fields[0], ROOM.fields[2], ROOM.fields[1]] }));
  const r = (await save('X_ROOM', { CompanyID: 'C1', Code: '101', Name: 'Garden', Fields: { rate: 250, days: 7, weekly: 1 } })).id;
  assert.equal((await rec('X_ROOM', r)).Fields.weekly, 1750, 'the sent value is ignored');
  await publish(STAY);
  const s = (await save('X_STAY', { CompanyID: 'C1', Date: '2026-11-10', Fields: { arrive: '2026-11-10', leave: '2026-11-14', rate: 333.335, nights: 99, amount: 1 } })).id;
  const v = (await rec('X_STAY', s)).Fields;
  assert.deepEqual([v.nights, v.rate, v.amount, v.fee], [4, 333.34, 1333.36, 93.34]);
});

test('progress claims: lines to date less earlier claims, retention; a cancelled claim not counted; invoiced on its own project with retention journaled', async () => {
  await reset(fixture());
  await publish(CONTRACT);
  // Project links: open projects of the company only.
  const pj = await call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_CONTRACT', target: 'PROJECT', companyId: 'C1' });
  assert.deepEqual(pj.options.map(o => o.id), ['P1']);
  await publish(CLAIM);
  const k = (await save('X_CONTRACT', { CompanyID: 'C1', Code: 'K-1', Name: 'Tower A shell', Fields: { customer: 'CU1', project: 'P1' } })).id;
  const claim = (date, lines, extra) => save('X_CLAIM', { CompanyID: 'C1', Date: date, Fields: Object.assign({ contract: k, customer: 'CU1', project: 'P1', retPct: 10 }, extra || {}), Lines: lines });
  const c1 = (await claim('2026-09-30', [{ ref: 'A1', qty: 10, rate: 50 }, { ref: 'A2', qty: 2, rate: 100 }])).id;
  const bad = (await claim('2026-10-15', [{ ref: 'A1', qty: 99, rate: 50 }])).id;
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_CLAIM', id: bad, status: 'Cancelled' }));
  const c2 = (await claim('2026-10-31', [{ ref: 'A1', qty: 16, rate: 50 }, { ref: 'A2', qty: 2, rate: 100 }, { ref: 'A3', qty: 1, rate: 75, extra: 25 }])).id;
  const one = await rec('X_CLAIM', c1), two = await rec('X_CLAIM', c2);
  assert.deepEqual([one.Fields.thisClaim, one.Fields.retention, one.Fields.claimedBefore], [700, 70, 0]);
  assert.deepEqual(two.Lines.map(l => [l.ref, l.toDate, l.before, l.thisAmount]), [['A1', 800, 500, 300], ['A2', 200, 200, 0], ['A3', 75, 0, 75]]);
  assert.deepEqual([two.Totals.thisAmount, two.Fields.thisClaim, two.Fields.retention, two.Fields.claimedBefore], [375, 400, 40, 700], 'the cancelled claim is not counted');
  // Saving the first again: a later claim doesn't count as before it.
  await save('X_CLAIM', { RecordID: c1, Date: one.Date, Fields: one.Fields, Lines: one.Lines });
  assert.equal((await rec('X_CLAIM', c1)).Fields.claimedBefore, 0);

  // To the books: the claim's calculated amount, on the record's project; retention off the customer.
  ok(await call('u-admin', 'saveBuiltSetup', { moduleId: 'X_CLAIM', companyId: 'C1', actions: { invoice: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' }, retain: { DebitAccountCode: '1250', CostCenterID: 'CC1' } } }));
  const s = await call('u-admin', 'getBuiltSetup', { moduleId: 'X_CLAIM', companyId: 'C1' });
  assert.deepEqual(s.needs.map(n => [n.key, n.fields.join('/')]), [['invoice', 'SalesTypeID/AccountCode/CostCenterID/ProfitCenterID'], ['retain', 'DebitAccountCode/CostCenterID/ProfitCenterID']], 'the project comes from the record');
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_CLAIM', id: c2, status: 'Certified' }));
  const inv = await val('customerInvoices/' + ok(await call('u-admin', 'runBuiltAction', { moduleId: 'X_CLAIM', id: c2, action: 'invoice' })).made.id);
  assert.deepEqual([inv.Total, inv.ProjectID, inv.DirectLines[0].Amount, inv.DirectLines[0].ProjectID], [400, 'P1', 400, 'P1']);
  const jvMade = ok(await call('u-admin', 'runBuiltAction', { moduleId: 'X_CLAIM', id: c2, action: 'retain' })).made;
  const jv = (await firestore.collection('journalEntries').doc(jvMade.id).get()).data();
  assert.deepEqual(jv.Lines.map(l => [l.AccountCode, Number(l.Debit), Number(l.Credit), l.PartyID || '', l.ProjectID || '']), [['1250', 40, 0, '', 'P1'], ['1200', 0, 40, 'CU1', 'P1']]);
});
