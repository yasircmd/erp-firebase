// Module Builder, phase 3 (MODULE_BUILDER.md, Q474-Q480): an action checked in
// its definition; the target document's draft built from a record (account
// lines, item lines, a journal with a party, a grouped run); a bulk run's
// periods, due records and groups.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/builtDefinitions');
const A = require('../../src/builtActions');

const SUB = {
  id: 'X_SUB', label: 'Subscription', kind: 'master',
  fields: [
    { key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER' },
    { key: 'plan', label: 'Plan', type: 'text' },
    { key: 'fee', label: 'Fee', type: 'amount' },
    { key: 'revenue', label: 'Revenue account', type: 'link', target: 'ACCOUNT' },
    { key: 'nextDue', label: 'Next due', type: 'date' },
    { key: 'every', label: 'Billed', type: 'choice', options: ['Monthly', 'Yearly'] }
  ],
  actions: [{ key: 'bill', label: 'Bill', target: 'CUSTOMERINVOICE', party: 'customer', amount: 'fee', account: 'revenue', description: 'Subscription {plan} {period}',
    bulk: { enabled: true, nextDue: 'nextDue', periodField: 'every', group: 'party' } }]
};
const STAY = {
  id: 'X_STAY', label: 'Stay', kind: 'document', numbering: { prefix: 'ST' },
  fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER' }, { key: 'store', label: 'Store', type: 'link', target: 'WAREHOUSE' }],
  lines: { enabled: true, fields: [{ key: 'item', label: 'Item', type: 'link', target: 'ITEM' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'price', label: 'Price', type: 'amount' }, { key: 'what', label: 'What', type: 'text' }] },
  statuses: [{ name: 'Open' }, { name: 'Checked out' }, { name: 'Cancelled', final: true }],
  actions: [
    { key: 'invoice', label: 'Invoice', target: 'CUSTOMERINVOICE', statuses: ['Checked out'], party: 'guest', source: 'lines', kind: 'item', item: 'item', quantity: 'qty', price: 'price', warehouse: 'store', lineText: 'what', state: 'Submitted' },
    { key: 'accrue', label: 'Accrue', target: 'JV', statuses: ['Open'], party: 'guest', partySide: 'debit', source: 'lines', amount: 'price' }
  ]
};

test('an action in its definition: what it creates, its fields by type, its statuses, a run\'s period', () => {
  const s = B.cleanDefinition(SUB, []);
  assert.deepEqual([s.actions[0].target, s.actions[0].state, s.actions[0].kind, s.actions[0].bulk.group, s.actions[0].bulk.periodField], ['CUSTOMERINVOICE', 'Draft', 'account', 'party', 'every']);
  const st = B.cleanDefinition(STAY, []);
  assert.deepEqual([st.actions[0].state, st.actions[0].warehouse, st.actions[1].partySide, st.actions[1].debitAccount], ['Submitted', 'store', 'debit', '']);
  const act = (x, base) => Object.assign({}, base || SUB, { actions: [Object.assign({}, (base || SUB).actions[0], x)] });
  const no = (d, re) => assert.throws(() => B.cleanDefinition(d, []), re);
  no(act({ target: 'GRN' }), /what it creates/);
  no(act({ party: 'plan' }), /customer is a link/);
  no(act({ target: 'VENDORINVOICE' }), /vendor is a link/);
  no(act({ amount: 'plan' }), /amount is a number/);
  no(act({ account: 'customer' }), /account is a link field to accounts/);
  no(act({ kind: 'item', target: 'JV' }), /item lines are for a customer invoice/);
  no(act({ bulk: { enabled: true, nextDue: 'nextDue' } }), /choose its period/);
  no(act({ bulk: { enabled: true, nextDue: 'nextDue', periodField: 'plan' } }), /period is a choice field/);
  no(Object.assign({}, SUB, { fields: SUB.fields.map(f => (f.key === 'every' ? Object.assign({}, f, { options: ['Weekly'] }) : f)) }), /"Weekly" is not/);
  no(act({ statuses: [] }, STAY), /statuses it may be used in/);
  no(act({ statuses: ['Gone'] }, STAY), /not one of its statuses/);
  no(Object.assign({}, SUB, { companyScoped: false }), /belong to a company/);
  no(Object.assign({}, SUB, { actions: [SUB.actions[0], SUB.actions[0]] }), /used twice/);
});

test('a run\'s dates: a period on, the day kept where the month has it', () => {
  assert.equal(A.addMonths('2026-01-15', 1), '2026-02-15');
  assert.equal(A.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(A.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(A.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(A.addMonths('2026-12-01', 12), '2027-12-01');
  assert.equal(A.render('Rent {number} {plan} {period} {missing}', { Number: 'ST-26-000001', Fields: { plan: 'Gold' } }, '2026-11-01'), 'Rent ST-26-000001 Gold 2026-11');
});

test('a customer invoice from records: account lines from a field, the Setup\'s sales type; grouped per customer; zero lines dropped', () => {
  const def = B.cleanDefinition(SUB, []), a = def.actions[0];
  const rec = (id, cust, fee, due) => ({ RecordID: id, Code: id, CompanyID: 'C1', Fields: { customer: { id: cust, label: cust }, plan: 'Gold', fee, revenue: { id: 'acc1', label: '4100' }, nextDue: due, every: 'Monthly' } });
  const ctx = { date: '2026-11-09', accounts: { acc1: '4100' }, dueOf: r => r.Fields.nextDue };
  const one = A.buildTargetDraft(def, a, [rec('S1', 'cu1', 100, '2026-11-01')], { SalesTypeID: 'st1', CostCenterID: 'cc1' }, ctx);
  assert.deepEqual([one.CustomerID, one.InvoiceDate, one.Description, one.CostCenterID], ['cu1', '2026-11-09', 'Subscription Gold 2026-11', 'cc1']);
  assert.deepEqual(one.DirectLines, [{ AccountCode: '4100', Description: 'Subscription Gold 2026-11', Amount: 100, CostCenterID: '', ProfitCenterID: '', ProjectID: '', SalesTypeID: 'st1' }]);
  const groups = A.groupsOf(a, [rec('S1', 'cu1', 100), rec('S2', 'cu2', 50), rec('S3', 'cu1', 0)]);
  assert.deepEqual(groups.map(g => g.map(r => r.RecordID)), [['S1', 'S3'], ['S2']]);
  const g = A.buildTargetDraft(def, a, groups[0].map(r => Object.assign(r, { Fields: Object.assign(r.Fields, { nextDue: '2026-11-01' }) })), { SalesTypeID: 'st1' }, ctx);
  assert.deepEqual([g.Description, g.DirectLines.length], ['Bill 2026-11-09', 1], 'the zero line is dropped');
  assert.throws(() => A.buildTargetDraft(def, a, [rec('S4', 'cu1', 100)], {}, ctx), /Set the Sales Type/);
  assert.throws(() => A.buildTargetDraft(def, a, [rec('S5', 'cu1', 0)], { SalesTypeID: 'st1' }, ctx), /nothing to invoice/);
  assert.throws(() => A.buildTargetDraft(def, a, [rec('S6', 'cu1', -5)], { SalesTypeID: 'st1' }, ctx), /below zero/);
  assert.throws(() => A.buildTargetDraft(def, a, [rec('S7', '', 10)].map(r => Object.assign(r, { Fields: Object.assign(r.Fields, { customer: null }) })), { SalesTypeID: 'st1' }, ctx), /choose its customer/);
});

test('item lines from a document\'s lines; a journal with its party on the debit side', () => {
  const def = B.cleanDefinition(STAY, []);
  const rec = { RecordID: 'R1', Number: 'ST-26-000001', CompanyID: 'C1', Status: 'Checked out', Fields: { guest: { id: 'cu1', label: 'A' }, store: { id: 'wh1', label: 'Main' } },
    Lines: [{ item: { id: 'i1', label: 'Tea' }, qty: 2, price: 5, what: 'Tea' }, { item: { id: 'i2', label: 'Cake' }, qty: 0, price: 9, what: 'Cake' }] };
  const ci = A.buildTargetDraft(def, def.actions[0], [rec], { SalesTypeID: 'st1' }, { date: '2026-11-09', items: { i1: 'TEA', i2: 'CAKE' } });
  assert.deepEqual([ci.ItemSalesTypeID, ci.DirectLines.length], ['st1', 0]);
  assert.deepEqual(ci.ItemLines, [{ ItemCode: 'TEA', WarehouseID: 'wh1', Quantity: 2, UnitPrice: 5, CostCenterID: '' }]);
  const jv = A.buildTargetDraft(def, def.actions[1], [rec], { CreditAccountCode: '4200' }, { date: '2026-11-09', partyAccounts: { cu1: '1200' } });
  assert.deepEqual(jv.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyType || '', l.PartyID || '']), [['1200', 5, 0, 'Customer', 'cu1'], ['4200', 0, 5, '', ''], ['1200', 9, 0, 'Customer', 'cu1'], ['4200', 0, 9, '', '']]);
  assert.deepEqual([jv.JVDate, jv.Reference], ['2026-11-09', 'ST-26-000001']);
  assert.throws(() => A.buildTargetDraft(def, def.actions[1], [rec], {}, { date: '2026-11-09', partyAccounts: { cu1: '1200' } }), /no credit account/);
  assert.equal(A.notRunnable(def, def.actions[0], rec), '');
  assert.match(A.notRunnable(def, def.actions[1], rec), /Checked out \(the action is for Open\)/);
});

test('a run: the records due on its date, with a period', () => {
  const a = B.cleanDefinition(SUB, []).actions[0];
  const r = (due, every) => ({ Fields: { nextDue: due, every } });
  assert.equal(A.dueOn(a, r('2026-11-01', 'Monthly'), '2026-11-09').why, '');
  assert.equal(A.dueOn(a, r('2026-11-09', 'Monthly'), '2026-11-09').why, '', 'due on the day');
  assert.match(A.dueOn(a, r('2026-11-10', 'Monthly'), '2026-11-09').why, /due 2026-11-10/);
  assert.match(A.dueOn(a, r('', 'Monthly'), '2026-11-09').why, /no next-due/);
  assert.match(A.dueOn(a, r('2026-11-01', null), '2026-11-09').why, /no period/);
  assert.equal(A.monthsOf(a, r('2026-11-01', 'Yearly')), 12);
  assert.deepEqual(A.needsOf(a), ['SalesTypeID', 'CostCenterID', 'ProfitCenterID', 'ProjectID'], 'the account comes from the record');
});
