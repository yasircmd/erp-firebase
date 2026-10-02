// Opening Balances (owner, 2026-10-02; docs/modules/OPENING_BALANCES.md):
// the opening date and clearing account per company; GL, Stock and Open
// Invoices pasted, checked (issues by row and column) and posted against
// the clearing account; control accounts only through Stock and Open
// Invoices; opening documents usable like invoices (allocation, SOA,
// ageing); a batch reversed any time unless something already used it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });

const OD = '2025-12-31'; // opening date: the day before go-live
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const check = (kind, rows, uid) => call(uid || 'u-admin', 'checkOpeningBalances', { kind, companyId: 'C1', text: tsv(rows) });
const post = (kind, rows, uid) => call(uid || 'u-admin', 'postOpeningBalances', { kind, companyId: 'C1', text: tsv(rows) });
const setup = (uid, companyId) => call(uid || 'u-admin', 'getOpeningBalanceSetup', { companyId: companyId || 'C1' });
const settings = (openingDate, clearingAccountId) => call('u-admin', 'saveOpeningBalanceSettings', { companyId: 'C1', openingDate, clearingAccountId });
const reverse = batchId => call('u-admin', 'reverseOpeningBalanceBatch', { batchId });
const msgs = r => r.issues.map(i => (i.row ? 'R' + i.row : 'H') + (i.column ? ' ' + i.column : '') + ': ' + i.message);
const doc = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const ok = r => { assert.equal(r.success, true, JSON.stringify(r)); return r; };
const linesOf = e => e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]);

const GL_HEAD = ['Account', 'Debit', 'Credit', 'Description', 'Cost Center', 'Profit Center'];
const STOCK_HEAD = ['Item', 'Warehouse', 'Quantity', 'Unit Cost', 'Batch No', 'Expiry Date'];
const INV_HEAD = ['Party Type', 'Party', 'Document Type', 'Document No', 'Document Date', 'Due Date', 'Amount', 'Description'];

function fixture() {
  const f = baseFixture();
  f.coa['A-OBC'] = { AccountCode: '3900', AccountName: 'Opening Balance Clearing', AccountType: 'Equity', Status: 'Active', IsPostable: true };
  f.coa['A-EXP'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-FA'] = { AccountCode: '1500', AccountName: 'Machinery', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  f.vendors.V1.PaymentTermsDays = 30;
  f.customers = { CU1: { CustomerCode: 'CL-0001', CustomerName: 'Beta Trading', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 45 } };
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Resin', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS', BatchTracked: true };
  f.orgUnits.WHX = { Type: 'Warehouse', Code: 'WHX', Name: 'Other Co Store', Status: 'Active', CompanyID: 'C2' };
  return f;
}
async function ready() { await reset(fixture()); ok(await settings('31/12/2025', 'A-OBC')); }

test('Admin only; the setup lists the three kinds and Equity accounts for clearing; settings are checked', async () => {
  const f = fixture();
  f.permissions.OPENINGBALANCES.access = ['Admin'];
  await reset(f);
  await assert.rejects(setup('u-viewer'), /do not have access to Opening Balances/);
  const s = await setup();
  assert.deepEqual(s.kinds.map(k => k.key), ['GL', 'STOCK', 'INVOICES']);
  assert.deepEqual(s.kinds[2].columns.map(c => c.header), INV_HEAD);
  assert.deepEqual(s.clearingAccounts.map(a => a.Label), ['3000 — Capital', '3900 — Opening Balance Clearing']);
  assert.equal(s.settings, null);
  // Before the setup, a paste can't be checked.
  assert.deepEqual(msgs(await check('GL', [GL_HEAD, ['1000', '100', '', '', '', '']])), ['H Setup: Set this company\'s opening date and clearing account first (Setup, above).']);
  await assert.rejects(settings('2025-12-31', 'A-AP'), /Equity account/);
  await assert.rejects(settings('', 'A-OBC'), /opening date/);
  await assert.rejects(call('u-other', 'saveOpeningBalanceSettings', { companyId: 'C1', openingDate: OD, clearingAccountId: 'A-OBC' }), /do not have access to that company/);
  ok(await settings('31/12/2025', 'A-OBC'));
  assert.deepEqual((await setup()).settings, { OpeningDate: OD, ClearingAccountID: 'A-OBC', ClearingAccountLabel: '3900 — Opening Balance Clearing' });
});

test('GL: issues by row and column — control accounts, clearing, both sides, cost center, repeats', async () => {
  await ready();
  const c = await check('GL', [GL_HEAD,
    ['1000', '500', '', '', '', ''],
    ['Trade Payables', '', '200', '', '', ''],
    ['1200', '50', '', '', '', ''],
    ['1300', '50', '', '', '', ''],
    ['3900', '', '1', '', '', ''],
    ['9999', '1', '', '', '', ''],
    ['1100', '10', '10', '', '', ''],
    ['6100', '40', '', '', '', ''],
    ['cash', '', '5', '', '', ''],
    ['4000', '', '7', '', 'Nowhere', '']
  ]);
  assert.deepEqual(msgs(c), [
    'R2 Account: 2000 is a vendor\'s Trade Payables account — it comes from the Open Invoices tab.',
    'R3 Account: 1200 is a customer\'s Trade Receivables account — it comes from the Open Invoices tab.',
    'R4 Account: 1300 is an item\'s Inventory account — it comes from the Stock tab.',
    'R5 Account: 3900 is the Opening Balance Clearing account: the difference goes there by itself.',
    'R6 Account: No account "9999" for this company.',
    'R7 Debit: Enter a debit or a credit, not both.',
    'R8 Cost Center: 6100 (Expense) needs a Cost Center.',
    'R9 Account: 1000 is already on row 1: one row per account.',
    'R10 Cost Center: No cost center "Nowhere" for this company.'
  ]);
  // Posting checks again and posts nothing while there are issues.
  const r = await post('GL', [GL_HEAD, ['1000', '500', '', '', '', ''], ['3900', '', '1', '', '', '']]);
  assert.equal(r.success, false);
  assert.equal(r.issues.length, 1);
  assert.equal(await val('openingBalances/batches'), null);
});

test('GL: posts one entry on the opening date; the difference goes to clearing', async () => {
  await ready();
  const rows = [GL_HEAD,
    ['1000', '500', '', 'Cash in hand', '', ''],
    ['Machinery', '12,000.50', '', '', '', ''],
    ['3000', '', '10000', 'Share capital', '', ''],
    ['6100', '99.50', '', '', 'Workshop', '']];
  const c = await check('GL', rows);
  assert.deepEqual(msgs(c), []);
  assert.equal(c.summary, 'Debits 12600.00, credits 10000.00; 2600.00 to clearing (credit).');
  const r = ok(await post('GL', rows));
  assert.match(r.numbers[0], /^OB-25-01-\d{6}$/);
  const e = await doc((await val('openingBalances/batches/' + r.batchId)).JVIDs[0]);
  assert.equal(e.JVDate, OD);
  assert.equal(e.VoucherType, 'OpeningBalance');
  assert.equal(e.Status, 'Posted');
  assert.deepEqual(linesOf(e), [['1000', 500, 0], ['1500', 12000.5, 0], ['3000', 0, 10000], ['6100', 99.5, 0], ['3900', 0, 2600]]);
  assert.equal(e.Lines[0].Description, 'Cash in hand');
  assert.equal(e.Lines[1].Description, 'Opening balance');
  assert.equal(e.Lines[3].CostCenterID, 'CC1');
  const s = await setup();
  assert.equal(s.clearing.balance, -2600);
  assert.equal(s.clearing.GL, -2600);
  assert.deepEqual(s.batches.map(b => [b.Kind, b.Rows, b.Status]), [['GL', 4, 'Posted']]);
  // From JV it can't be reversed; and the setup is fixed while it is live.
  const jr = await call('u-admin', 'reverseJournalEntry', { jvId: (await val('openingBalances/batches/' + r.batchId)).JVIDs[0], reversalDate: OD });
  assert.match(jr.error, /posted by OpeningBalance — reverse it from that module/);
  await assert.rejects(settings('2026-03-31', 'A-OBC'), /reverse them before changing/);
});

test('Stock: issues (company, batch, repeats); posts the ledger at the given cost, Dr Inventory, Cr clearing', async () => {
  await ready();
  const c = await check('STOCK', [STOCK_HEAD,
    ['RM-001', 'WH1', '10', '15', '', ''],
    ['RM-002', 'WH1', '5', '4', '', ''],
    ['RM-001', 'WHX', '1', '1', '', ''],
    ['Steel Sheet', 'Main Store', '2', '15', '', ''],
    ['RM-001', 'WH2', '0', '-1', '', '31/02/2026']
  ]);
  assert.deepEqual(msgs(c), [
    'R2 Batch No: RM-002 is batch-tracked: enter its batch number (a row per batch).',
    'R3 Warehouse: No warehouse or rack "WHX" for this company.',
    'R4 Item: Same item, warehouse and batch as row 1.',
    'R5 Expiry Date: "31/02/2026" is not a date (dd/mm/yyyy).',
    'R5 Quantity: Quantity must be greater than zero.',
    'R5 Unit Cost: Unit cost must be greater than zero.'
  ]);
  const rows = [STOCK_HEAD,
    ['RM-001', 'WH1', '10', '15.5', '', ''],
    ['RM-002', 'WH1', '5', '4', 'B-1', '30/06/2026'],
    ['RM-002', 'WH1', '3', '6', 'B-2', ''],
    ['RM-001', 'WH2', '2', '20', '', '']];
  assert.equal((await check('STOCK', rows)).summary, 'Stock value 233.00.');
  const r = ok(await post('STOCK', rows));
  assert.match(r.numbers[0], /^OS-25-01-\d{6}$/);
  const l1 = await val('stock/ledger/I1/WH1');
  assert.deepEqual([l1.Quantity, l1.AvgCost, l1.TotalValue], [10, 15.5, 155]);
  const l2 = await val('stock/ledger/I2/WH1');
  assert.deepEqual([l2.Quantity, l2.AvgCost, l2.TotalValue], [8, 4.75, 38]);
  const batch = await val('openingBalances/batches/' + r.batchId);
  const tx = await val('stock/transactions/' + batch.StockTransactionID);
  assert.deepEqual([tx.TransactionType, tx.Status, tx.TransactionDate, tx.TransactionNumber], ['OpeningStock', 'Posted', OD, r.numbers[0]]);
  assert.deepEqual(tx.Lines.map(l => [l.ItemCode, l.BatchNumber, l.ExpiryDate, l.Direction]), [['RM-001', '', '', 'In'], ['RM-002', 'B-1', '2026-06-30', 'In'], ['RM-002', 'B-2', '', 'In'], ['RM-001', '', '', 'In']]);
  const e = await doc(tx.LinkedJVID);
  // Same account and description ("Opening stock"): one Inventory line
  // (docs/modules/LINE_CLUBBING.md).
  assert.deepEqual(linesOf(e), [['1300', 233, 0], ['3900', 0, 233]]);
  assert.equal((await setup()).clearing.STOCK, -233);
});

test('Open Invoices: a document per row with its own number, dates and due date; paid like an invoice; SOA ageing', async () => {
  await ready();
  const bad = await check('INVOICES', [INV_HEAD,
    ['Vendor', 'V001', 'Invoice', 'INV-1', '01/01/2026', '', '100', ''],
    ['Supplier', 'V001', 'Bill', '', '01/12/2025', '', '0', ''],
    ['Customer', 'Nobody', 'Invoice', 'X', '01/12/2025', '01/11/2025', '5', '']
  ]);
  assert.deepEqual(msgs(bad), [
    'R1 Document Date: The document date is after the opening date (2025-12-31).',
    'R2 Party Type: "Supplier" is not one of: Vendor, Customer.',
    'R2 Document Type: "Bill" is not one of: Invoice, Advance.',
    'R2 Document No: Document No is required.',
    'R2 Amount: Amount must be greater than zero.',
    'R3 Party: No customer "Nobody" for this company.',
    'R3 Due Date: The due date is before the document date.'
  ]);
  const rows = [INV_HEAD,
    ['Vendor', 'V001', 'Invoice', 'INV-7781', '15/11/2025', '', '4500', ''],
    ['Vendor', 'Acme Metals', 'Invoice', 'INV-7790', '20/12/2025', '15/01/2026', '1000', 'Spares'],
    ['Vendor', 'V001', 'Advance', 'ADV-3', '10/12/2025', '', '300', ''],
    ['Customer', 'CL-0001', 'Invoice', 'S-100', '01/10/2025', '', '2500', '']];
  assert.deepEqual(msgs(await check('INVOICES', rows.concat([['Vendor', 'V001', 'Invoice', 'inv-7781', '15/11/2025', '', '1', '']]))),
    ['R5 Document No: Document inv-7781 of Acme Metals is already on row 1.']);
  const r = ok(await post('INVOICES', rows));
  assert.equal(r.numbers.length, 2, 'one entry per party');
  const batch = await val('openingBalances/batches/' + r.batchId);
  const ve = await doc(batch.JVIDs[0]);
  assert.deepEqual(linesOf(ve), [['2000', 0, 4500], ['2000', 0, 1000], ['2000', 300, 0], ['3900', 5200, 0]]);
  assert.deepEqual(ve.PartyKeys, ['Vendor:V1']);
  const ce = await doc(batch.JVIDs[1]);
  assert.deepEqual(linesOf(ce), [['1200', 2500, 0], ['3900', 0, 2500]]);
  assert.equal((await setup()).clearing.INVOICES, 2700);

  // Open items: the document's own number and dates; due date from the terms when blank.
  const items = await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' });
  assert.deepEqual(items.map(i => [i.Number, i.Date, i.DueDate, i.Side, i.Outstanding]), [
    ['INV-7781', '2025-11-15', '2025-12-15', 'Cr', 4500], ['ADV-3', '2025-12-10', '2026-01-09', 'Dr', 300], ['INV-7790', '2025-12-20', '2026-01-15', 'Cr', 1000]]);
  // A payment settles one like any invoice.
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: '2026-01-05', Description: 'Pay', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: 4000, Description: 'Pay', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: items[0].RefID, Amount: 4000 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  const paid = await doc(s.jvId);
  assert.equal(paid.Lines[1].Allocations[0].RefNumber, 'INV-7781');
  // SOA: opening documents in the ageing, by their own due dates.
  const soa = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1', fromDate: '2025-01-01', toDate: '2026-01-31' });
  assert.deepEqual(soa.OpenItems.map(i => [i.Number, i.Type, i.DueDate, i.Outstanding]), [
    ['INV-7781', 'Opening invoice', '2025-12-15', 500], ['ADV-3', 'Opening advance', '2026-01-09', -300], ['INV-7790', 'Opening invoice', '2026-01-15', 1000]]);
  assert.equal(soa.Rows[0].Type, 'Opening Balance');
  // The same document again is an issue; the batch can't be reversed while paid.
  assert.deepEqual(msgs(await check('INVOICES', [INV_HEAD, ['Vendor', 'V001', 'Invoice', 'INV-7790', '20/12/2025', '', '1', '']])),
    ['R1 Document No: Document INV-7790 of Acme Metals is already in an opening batch.']);
  await assert.rejects(reverse(r.batchId), /has been settled by/);
});

test('Reversal: GL and Open Invoices mirror back; stock comes out unless used; clearing back to zero', async () => {
  await ready();
  const gl = ok(await post('GL', [GL_HEAD, ['1000', '500', '', '', '', ''], ['3000', '', '200', '', '', '']]));
  const st = ok(await post('STOCK', [STOCK_HEAD, ['RM-001', 'WH1', '10', '15', '', '']]));
  const inv = ok(await post('INVOICES', [INV_HEAD, ['Customer', 'CL-0001', 'Invoice', 'S-1', '01/12/2025', '', '700', '']]));
  // GL 300 Dr net -> clearing Cr 300; stock 150 -> Cr; customer 700 -> Cr. Together the books balance.
  assert.equal((await setup()).clearing.balance, -1150);

  const rg = ok(await reverse(gl.batchId));
  assert.match(rg.reversalNumbers[0], /^OB-25-01-/);
  const b = await val('openingBalances/batches/' + gl.batchId);
  assert.equal(b.Status, 'Reversed');
  const orig = await doc(b.JVIDs[0]), rev = await doc(b.ReversalJVIDs[0]);
  assert.equal(orig.ReversedByJV, b.ReversalJVIDs[0]);
  assert.deepEqual(linesOf(rev), linesOf(orig).map(([a, d, c]) => [a, c, d]));
  assert.equal(rev.JVDate, OD);
  await assert.rejects(reverse(gl.batchId), /already been reversed/);

  ok(await reverse(inv.batchId));
  assert.deepEqual(await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' }), []);

  // Stock used since the opening (here: 6 of the 10 gone) can't be taken back.
  const { rtdb } = require('./_helpers');
  await rtdb.ref('stock/ledger/I1/WH1').update({ Quantity: 4, TotalValue: 60 });
  await assert.rejects(reverse(st.batchId), /cannot be taken back: insufficient stock for RM-001 at this warehouse — available 4, requested 10\. Reverse what used it first/);
  assert.equal((await val('openingBalances/batches/' + st.batchId)).Status, 'Posted');
  await rtdb.ref('stock/ledger/I1/WH1').update({ Quantity: 10, TotalValue: 150 });
  ok(await reverse(st.batchId));
  const ledger = await val('stock/ledger/I1/WH1');
  assert.deepEqual([ledger.Quantity, ledger.TotalValue], [0, 0]);
  const sb = await val('openingBalances/batches/' + st.batchId);
  const rtx = await val('stock/transactions/' + sb.StockReversalID);
  assert.deepEqual([rtx.TransactionType, rtx.Status, rtx.Lines[0].Direction], ['OpeningStock', 'Posted', 'Out']);
  assert.equal((await val('stock/transactions/' + sb.StockTransactionID)).ReversedByTransaction, sb.StockReversalID);

  const s = await setup();
  assert.equal(s.clearing.balance, 0);
  assert.equal(s.liveBatches, 0);
  // Everything reversed: the setup may change again.
  ok(await settings('2026-03-31', 'A-OBC'));
});

test('another company\'s user can\'t post or reverse here', async () => {
  await ready();
  const r = await post('GL', [GL_HEAD, ['1000', '1', '', '', '', '']], 'u-other');
  assert.deepEqual(msgs(r), ['H Company: You do not have access to that company.']);
  const g = ok(await post('GL', [GL_HEAD, ['1000', '1', '', '', '', '']]));
  await assert.rejects(call('u-other', 'reverseOpeningBalanceBatch', { batchId: g.batchId }), /do not have access to that company/);
});

test('a reversed stock batch leaves the cost as if never posted; the ledger rebuild (Data Reset) replays it exactly', async () => {
  const f = fixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  await reset(f);
  ok(await settings(OD, 'A-OBC'));
  ok(await post('STOCK', [STOCK_HEAD, ['RM-001', 'WH1', '10', '15', '', ''], ['RM-001', 'WH2', '4', '9.25', '', '']]));
  const second = ok(await post('STOCK', [STOCK_HEAD, ['RM-001', 'WH1', '5', '18', '', '']]));
  ok(await reverse(second.batchId));
  const live = await val('stock/ledger');
  const r = await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' });
  assert.equal(r.success, true, r.error);
  const rebuilt = await val('stock/ledger');
  const pick = l => Object.fromEntries(Object.entries(l).map(([i, w]) => [i, Object.fromEntries(Object.entries(w).map(([k, v]) => [k, [v.Quantity, v.AvgCost, v.TotalValue]]))]));
  assert.deepEqual(pick(rebuilt), pick(live));
  assert.deepEqual(pick(live), { I1: { WH1: [10, 15, 150], WH2: [4, 9.25, 37] } });
  // Taken back at its own cost (18, not the average 16): as if never posted.
  assert.equal((await setup()).clearing.balance, -187);
});
