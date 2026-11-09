// Module Builder, phase 3 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q474-Q480): a built record to the books through the documents' own saves.
// The company's Setup (rights, checked); a lease's invoice made once (refused
// in another status, again while it is there, made again once deleted), linked
// both ways; a vendor invoice Submitted = posted; a journal with its party; an
// order's item lines delivering the stock; a subscription run (due records
// proposed, grouped per customer, next-due moved on, a refused record not
// stopping the rest, the run kept); the target document's rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const today = () => { const S = require('../../src/recurringSchedule'); return S.todayIn(S.TIME_ZONE); };

const LEASE = { id: 'X_LEASE', label: 'Lease', kind: 'document', numbering: { prefix: 'LS' },
  fields: [
    { key: 'tenant', label: 'Tenant', type: 'link', target: 'CUSTOMER', required: true },
    { key: 'rent', label: 'Rent', type: 'amount' },
    { key: 'agent', label: 'Agent', type: 'link', target: 'VENDOR' },
    { key: 'agentRef', label: 'Agent invoice no', type: 'text' },
    { key: 'commission', label: 'Commission', type: 'amount' }],
  statuses: [{ name: 'Draft' }, { name: 'Active' }, { name: 'Ended', final: true }],
  actions: [
    { key: 'invoice', label: 'Invoice rent', target: 'CUSTOMERINVOICE', statuses: ['Active'], party: 'tenant', amount: 'rent', description: 'Rent {number}' },
    { key: 'commission', label: 'Agent commission', target: 'VENDORINVOICE', statuses: ['Active'], party: 'agent', amount: 'commission', reference: 'agentRef', state: 'Submitted' },
    { key: 'accrue', label: 'Accrue rent', target: 'JV', statuses: ['Active'], party: 'tenant', partySide: 'debit', amount: 'rent' }] };
const ORDER = { id: 'X_ORDER', label: 'Room service', kind: 'document', numbering: { prefix: 'RS' },
  fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER', required: true }, { key: 'store', label: 'Store', type: 'link', target: 'WAREHOUSE' }],
  lines: { enabled: true, fields: [{ key: 'item', label: 'Item', type: 'link', target: 'ITEM' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'price', label: 'Price', type: 'amount' }] },
  statuses: [{ name: 'Open' }, { name: 'Served' }, { name: 'Void', final: true }],
  actions: [{ key: 'bill', label: 'Bill the guest', target: 'CUSTOMERINVOICE', statuses: ['Served'], party: 'guest', source: 'lines', kind: 'item', item: 'item', quantity: 'qty', price: 'price', warehouse: 'store', state: 'Submitted' }] };
const SUB = { id: 'X_SUB', label: 'Subscription', kind: 'master',
  fields: [
    { key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER', required: true },
    { key: 'plan', label: 'Plan', type: 'text' },
    { key: 'fee', label: 'Fee', type: 'amount' },
    { key: 'revenue', label: 'Revenue account', type: 'link', target: 'ACCOUNT' },
    { key: 'nextDue', label: 'Next due', type: 'date' },
    { key: 'every', label: 'Billed', type: 'choice', options: ['Monthly', 'Quarterly', 'Yearly'] }],
  actions: [{ key: 'bill', label: 'Bill subscriptions', target: 'CUSTOMERINVOICE', party: 'customer', amount: 'fee', account: 'revenue', description: '{plan} {period}',
    bulk: { enabled: true, nextDue: 'nextDue', periodField: 'every', group: 'party' } }] };

function fixture() {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Example Tenant LLC', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Sample Reader', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' },
    CU3: { CustomerCode: 'C003', CustomerName: 'Closed Account', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } } };
  ['X_LEASE', 'X_ORDER'].forEach(id => { f.permissions[id] = { access: ['Admin', 'Viewer'], write: ['Admin'], void: ['Admin'] }; });
  f.permissions.X_SUB = { access: ['Admin', 'Viewer'], write: ['Admin'] };
  return f;
}
async function publish(def) {
  const s = await call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }).catch(e => (/already exists/.test(e.message) ? call('u-admin', 'saveModuleDefinitionDraft', { definition: def }) : Promise.reject(e)));
  ok(s);
  return ok(await call('u-admin', 'publishModuleDefinition', { id: def.id }));
}
const save = (mod, record) => call('u-admin', 'saveBuiltRecord', { moduleId: mod, record });
const setup = (mod, actions, uid) => call(uid || 'u-admin', 'saveBuiltSetup', { moduleId: mod, companyId: 'C1', actions });
const run = (mod, id, action, uid) => call(uid || 'u-admin', 'runBuiltAction', { moduleId: mod, id, action });
const rec = async (mod, id) => (await call('u-admin', 'getBuiltRecord', { moduleId: mod, id })).record;

test('the Setup: the books per company, checked; the right to set it; the new links (accounts, warehouses)', async () => {
  await reset(fixture());
  await publish(LEASE);
  const s = await call('u-admin', 'getBuiltSetup', { moduleId: 'X_LEASE', companyId: 'C1' });
  assert.deepEqual(s.needs.map(n => [n.key, n.fields.join('/')]), [
    ['invoice', 'SalesTypeID/AccountCode/CostCenterID/ProfitCenterID/ProjectID'], ['commission', 'AccountCode/CostCenterID/ProfitCenterID/ProjectID'],
    ['accrue', 'CreditAccountCode/CostCenterID/ProfitCenterID/ProjectID']]);
  assert.equal(s.canEdit, true);
  assert.ok(s.options.accounts.some(a => a.id === '4000') && s.options.salesTypes.some(x => x.id === 'ST1') && s.options.costCenters.some(x => x.id === 'CC1'));
  assert.match(await refused(setup('X_LEASE', { invoice: { AccountCode: '9999' } })), /9999 is not a postable account/);
  assert.match(await refused(setup('X_LEASE', { invoice: { SalesTypeID: 'NOPE' } })), /active sales type/);
  assert.match(await refused(setup('X_LEASE', { invoice: { CostCenterID: 'WH1' } })), /company's cost centers/);
  assert.match(await refused(setup('X_LEASE', {}, 'u-viewer')), /right to change Lease|write/);
  ok(await setup('X_LEASE', { invoice: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1', Junk: 'x' }, commission: { AccountCode: '5100', CostCenterID: 'CC1' }, accrue: { CreditAccountCode: '4000', CostCenterID: 'CC1' } }));
  assert.deepEqual((await call('u-admin', 'getBuiltSetup', { moduleId: 'X_LEASE', companyId: 'C1' })).setup.invoice, { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' });
  await publish(SUB);
  const acc = await call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_SUB', target: 'ACCOUNT', companyId: 'C1' });
  assert.ok(acc.options.some(o => o.id === 'A-REV' && /4000/.test(o.label)));
  await publish(ORDER);
  const wh = await call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_ORDER', target: 'WAREHOUSE', companyId: 'C1' });
  assert.ok(wh.options.some(o => o.id === 'WH1') && !wh.options.some(o => o.id === 'CC1'));
});

test('a lease\'s actions: an invoice once, linked both ways; a vendor invoice posted; a journal with its party', async () => {
  await reset(fixture());
  await publish(LEASE);
  const id = ok(await save('X_LEASE', { CompanyID: 'C1', Date: today(), Fields: { tenant: 'CU1', rent: 1200, agent: 'V1', agentRef: 'AG-77', commission: 60 } })).id;
  assert.match(await refused(run('X_LEASE', id, 'invoice')), /it is Draft \(the action is for Active\)/);
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_LEASE', id, status: 'Active' }));
  assert.match(await refused(run('X_LEASE', id, 'invoice')), /no account: choose one on the record, or set it in the module's Setup/);
  ok(await setup('X_LEASE', { invoice: { AccountCode: '4000' } }));
  assert.match(await refused(run('X_LEASE', id, 'invoice')), /Set the Sales Type for "Invoice rent"/);
  assert.deepEqual((await call('u-admin', 'getBuiltRecord', { moduleId: 'X_LEASE', id })).created, [], 'nothing made, nothing held');
  ok(await setup('X_LEASE', { invoice: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' }, commission: { AccountCode: '5100', CostCenterID: 'CC1' }, accrue: { CreditAccountCode: '4000', CostCenterID: 'CC1' } }));
  assert.match(await refused(run('X_LEASE', id, 'invoice', 'u-viewer')), /right to change Lease|write/);

  const made = ok(await run('X_LEASE', id, 'invoice')).made;
  assert.deepEqual([made.module, made.status], ['CUSTOMERINVOICE', 'Draft']);
  const inv = await val('customerInvoices/' + made.id);
  assert.deepEqual([inv.Status, inv.CustomerID, inv.Description, inv.Total, inv.DirectLines[0].AccountCode, inv.DirectLines[0].SalesTypeID, inv.CostCenterID],
    ['Draft', 'CU1', 'Rent ' + (await rec('X_LEASE', id)).Number, 1200, '4000', 'ST1', 'CC1']);
  assert.deepEqual(inv.BuiltSource.ModuleID, 'X_LEASE');
  assert.match(await refused(run('X_LEASE', id, 'invoice')), /already done: Customer Invoice/, 'once (Q477)');
  const links = await call('u-admin', 'getDocumentLinks', { module: 'CUSTOMERINVOICE', id: made.id });
  assert.ok(links.chain.some(c => c.module === 'X_LEASE' && c.id === id && c.relation === 'before' && c.canOpen), JSON.stringify(links.chain));
  let r = await call('u-admin', 'getBuiltRecord', { moduleId: 'X_LEASE', id });
  assert.deepEqual(r.created.map(c => [c.action, c.module, c.live]), [['invoice', 'CUSTOMERINVOICE', true]]);
  // The draft deleted: it may be made again.
  ok(await call('u-admin', 'deleteCustomerInvoiceDraft', { invoiceId: made.id }));
  const again = ok(await run('X_LEASE', id, 'invoice')).made;
  assert.notEqual(again.id, made.id);

  // Submitted = the document's own Post (Q479): posted, with its number.
  const vi = ok(await run('X_LEASE', id, 'commission')).made;
  assert.equal(vi.status, 'Posted', JSON.stringify(vi));
  assert.ok(vi.number);
  const v = await val('vendorInvoices/' + vi.id);
  assert.deepEqual([v.Status, v.VendorID, v.VendorRefNumber, v.Total, v.DirectLines[0].AccountCode], ['Posted', 'V1', 'AG-77', 60, '5100']);

  // A journal: the tenant's receivable debited (its party), the rent credited.
  const jv = ok(await run('X_LEASE', id, 'accrue')).made;
  const e = (await firestore.collection('journalEntries').doc(jv.id).get()).data();
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']), [['1200', 1200, 0, 'CU1'], ['4000', 0, 1200, '']]);
  assert.equal(e.BuiltSource.Records[0].id, id);
  r = await call('u-admin', 'getBuiltRecord', { moduleId: 'X_LEASE', id });
  assert.deepEqual(r.created.filter(c => c.live).map(c => c.action).sort(), ['accrue', 'commission', 'invoice']);
  assert.match(r.record.History.map(h => h.What).join(' | '), /Agent commission: Vendor Invoice/);
});

test('item lines: an order billed and posted delivers its stock; the target document\'s own checks and rights apply', async () => {
  const f = fixture();
  await reset(f);
  await publish(ORDER);
  const id = ok(await save('X_ORDER', { CompanyID: 'C1', Date: today(), Fields: { guest: 'CU1', store: 'WH1' }, Lines: [{ item: 'I1', qty: 3, price: 50 }] })).id;
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_ORDER', id, status: 'Served' }));
  ok(await setup('X_ORDER', { bill: { SalesTypeID: 'ST1', CostCenterID: 'CC1' } }));
  // The invoice's own rule: the company must allow invoices to deliver stock.
  assert.match(await refused(run('X_ORDER', id, 'bill')), /does not invoice stock directly/);
  assert.deepEqual((await call('u-admin', 'getBuiltRecord', { moduleId: 'X_ORDER', id })).created, [], 'nothing left behind');
  ok(await call('u-admin', 'saveInvoiceStockSettings', { companyId: 'C1', directStock: true }));
  const made = ok(await run('X_ORDER', id, 'bill')).made;
  assert.equal(made.status, 'Posted', JSON.stringify(made));
  const inv = await val('customerInvoices/' + made.id);
  assert.deepEqual([inv.ItemLines[0].ItemCode, inv.ItemLines[0].Quantity, inv.Total, Boolean(inv.AutoDeliveryNoteID)], ['RM-001', 3, 150, true]);
  assert.equal(((await val('stock/ledger/I1/WH1')) || {}).Quantity, 27);

  // Without the Customer Invoice's draft right, the action is refused.
  f.permissions.CUSTOMERINVOICE = Object.assign({}, f.permissions.CUSTOMERINVOICE, { draft: ['Viewer'] });
  await reset(f);
  await publish(ORDER);
  const id2 = ok(await save('X_ORDER', { CompanyID: 'C1', Date: today(), Fields: { guest: 'CU1', store: 'WH1' }, Lines: [{ item: 'I1', qty: 1, price: 50 }] })).id;
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_ORDER', id: id2, status: 'Served' }));
  assert.match(await refused(run('X_ORDER', id2, 'bill')), /right to create a Customer Invoice \(draft\)/);
});

test('a subscription run: the due proposed, grouped per customer, next-due moved on, a refusal not stopping the rest, the run kept', async () => {
  await reset(fixture());
  await publish(SUB);
  ok(await setup('X_SUB', { bill: { SalesTypeID: 'ST1', CostCenterID: 'CC1' } }));
  const d = today();
  const sub = (code, cust, fee, due, every) => save('X_SUB', { CompanyID: 'C1', Code: code, Name: 'Sub ' + code, Fields: { customer: cust, plan: 'Plan ' + code, fee, revenue: 'A-REV', nextDue: due, every } }).then(ok).then(x => x.id);
  const past = d.slice(0, 8) + '01';
  const s1 = await sub('S1', 'CU1', 100, past, 'Monthly');
  const s2 = await sub('S2', 'CU1', 40, past, 'Yearly');
  const s3 = await sub('S3', 'CU2', 75, past, 'Quarterly');
  const s4 = await sub('S4', 'CU3', 20, past, 'Monthly');
  await sub('S5', 'CU2', 10, '2099-01-01', 'Monthly'); // not due
  await sub('S6', 'CU2', 10, past, null); // no period
  const pre = await call('u-admin', 'previewBuiltRun', { moduleId: 'X_SUB', action: 'bill', companyId: 'C1', date: d });
  assert.deepEqual(pre.records.map(r => r.number), ['S1', 'S2', 'S3', 'S4']);
  assert.deepEqual([pre.group, pre.records[0].party, pre.records[0].amount, pre.records[0].period], ['party', 'C001 · Example Tenant LLC', 100, 'Monthly']);
  // CU3 is switched off after the proposal: its subscription is refused, the others are made.
  await require('./_helpers').rtdb.ref('customers/CU3/Status').set('Inactive');
  const out = ok(await call('u-admin', 'runBuiltBulk', { moduleId: 'X_SUB', action: 'bill', companyId: 'C1', date: d, ids: [s1, s2, s3, s4] }));
  assert.deepEqual(out.made.map(m => m.records.join('+')).sort(), ['S1+S2', 'S3']);
  assert.deepEqual(out.refused.map(x => [x.records.join('+'), /inactive Customer/.test(x.reason)]), [['S4', true]]);
  const inv = await val('customerInvoices/' + out.made.find(m => m.records.length === 2).id);
  assert.deepEqual([inv.CustomerID, inv.Total, inv.DirectLines.map(l => l.Description)], ['CU1', 140, ['Plan S1 ' + past.slice(0, 7), 'Plan S2 ' + past.slice(0, 7)]]);
  const A = require('../../src/builtActions');
  assert.equal((await rec('X_SUB', s1)).Fields.nextDue, A.addMonths(past, 1));
  assert.equal((await rec('X_SUB', s2)).Fields.nextDue, A.addMonths(past, 12));
  assert.equal((await rec('X_SUB', s3)).Fields.nextDue, A.addMonths(past, 3));
  assert.equal((await rec('X_SUB', s4)).Fields.nextDue, past, 'a refused record stays due');
  // Billed once: the next run no longer proposes them.
  const pre2 = await call('u-admin', 'previewBuiltRun', { moduleId: 'X_SUB', action: 'bill', companyId: 'C1', date: d });
  assert.deepEqual(pre2.records.map(r => r.number), A.addMonths(past, 1) <= d ? ['S1', 'S4'] : ['S4']);
  const runs = (await call('u-admin', 'getBuiltRuns', { moduleId: 'X_SUB' })).runs;
  assert.deepEqual([runs.length, runs[0].Made.length, runs[0].Refused.length, runs[0].By], [1, 2, 1, 'admin']);
  assert.match(await refused(call('u-admin', 'runBuiltBulk', { moduleId: 'X_SUB', action: 'bill', companyId: 'C1', date: d, ids: [] })), /Tick the records/);
  assert.match(await refused(call('u-viewer', 'runBuiltBulk', { moduleId: 'X_SUB', action: 'bill', companyId: 'C1', date: d, ids: [s4] })), /right to change Subscription|write/);
});
