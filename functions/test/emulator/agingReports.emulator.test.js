// Aging Reports (docs/modules/AGING_REPORTS.md, decisions 118-121):
// Customer / Vendor Aging through getPartyAging (buckets by days overdue or
// by invoice age, unapplied credits apart, pending PDCs, the control-account
// check, each party agreeing with its Statement of Account) and Inventory
// Aging through getInventoryAging (first in first out by receipt date, a
// transfer keeping the stock's age, a reversed receipt dropping out, values
// matching the stock ledger), plus access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const err = async p => (await p.catch(e => e)).message;

function fixture() {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.vendors.V1.PaymentTermsDays = 30;
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Beta Supplies', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP', PaymentTermsDays: 60 };
  f.vendors.V9 = { VendorCode: 'V009', VendorName: 'C2 Vendor', Status: 'Active', CompanyID: 'C2', TradePayablesAccountID: 'A-AP' };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 15 } };
  return f;
}
async function bill(vendor, date, amount) {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: date, Description: 'Bill ' + amount, VendorRefNumber: 'B-' + amount, CompanyID: 'C1', VendorID: vendor, CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: amount, Description: 'Freight', CostCenterID: 'CC1' }] } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  return 'VendorInvoice:' + s.invoiceId;
}
async function cbt(type, date, party, amount, allocations) {
  const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: type, SelectedAccountCode: '1100', JVDate: date,
    Description: type, CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: party[0] === 'Vendor' ? '2000' : '1200', Amount: amount, Description: type, PartyType: party[0], PartyID: party[1], Allocations: allocations }] } }));
  return ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}
const aging = (partyType, asOf, basis, uid) => call(uid || 'u-admin', 'getPartyAging', { partyType, companyId: 'C1', asOf, basis });

test('vendor aging: by days overdue and by invoice age; unapplied credits apart; the GL check; each party as its SOA', async () => {
  await reset(fixture());
  const a = await bill('V1', '2026-01-10', 1000);
  await cbt('Bank Payment', '2026-02-01', ['Vendor', 'V1'], 600, [{ RefType: 'Against', RefID: a, Amount: 600 }]);
  await bill('V1', '2026-03-05', 400);
  await cbt('Bank Payment', '2026-03-20', ['Vendor', 'V1'], 150, []); // an advance, not matched
  await bill('V2', '2026-04-20', 300);
  await bill('V1', '2026-05-10', 999); // after the date: not counted

  const r = await aging('Vendor', '2026-04-30', 'due');
  assert.deepEqual(r.Buckets.map(b => b.key), ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus']);
  const v1 = r.Rows.find(x => x.PartyID === 'V1'), v2 = r.Rows.find(x => x.PartyID === 'V2');
  // V1: 400 left of the January bill (due 9 Feb, 80 days overdue), the March bill (due 4 Apr, 26 days), the 150 advance.
  assert.deepEqual(v1.Buckets, { notDue: 0, d1_30: 400, d31_60: 0, d61_90: 400, d90plus: 0 });
  assert.deepEqual([v1.Owed, v1.Unapplied, v1.Net, v1.OldestDays, v1.Terms], [800, 150, 650, 80, 30]);
  assert.deepEqual([v2.Buckets.notDue, v2.Net], [300, 300]);
  assert.ok(!r.Rows.some(x => x.PartyID === 'V9'), 'another company\'s vendor');
  assert.deepEqual([r.Totals.Owed, r.Totals.Unapplied, r.Totals.Net], [1100, 150, 950]);
  // The control account in the GL agrees: 1,000 + 400 + 300 − 600 − 150.
  assert.deepEqual([r.Control.status, r.Control.Accounts, r.Control.Balance, r.Control.Difference], ['ok', ['2000'], 950, 0]);

  // The same party in its Statement of Account at the same date.
  for (const row of [v1, v2]) {
    const soa = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: row.PartyID, companyId: 'C1', fromDate: '2026-01-01', toDate: '2026-04-30' });
    assert.equal(soa.OpenTotal, row.Net, row.Code + ': SOA open total');
    assert.equal(soa.Closing, row.Net, row.Code + ': SOA closing');
  }

  // By invoice age (decision 118): 110 and 56 days since the invoice; V2's 10.
  const inv = await aging('Vendor', '2026-04-30', 'invoice');
  assert.deepEqual(inv.Buckets.map(b => b.key), ['d0_30', 'd31_60', 'd61_90', 'd91_120', 'd120plus']);
  assert.deepEqual(inv.Rows.find(x => x.PartyID === 'V1').Buckets, { d0_30: 0, d31_60: 400, d61_90: 0, d91_120: 400, d120plus: 0 });
  assert.equal(inv.Rows.find(x => x.PartyID === 'V2').Buckets.d0_30, 300);
  assert.equal(inv.Totals.Net, r.Totals.Net, 'the same balance either way');

  // An earlier date: the March bill and the advance not yet there.
  const feb = await aging('Vendor', '2026-02-28', 'due');
  assert.deepEqual(feb.Rows.map(x => [x.PartyID, x.Buckets.d1_30, x.Net]), [['V1', 400, 400]]);
});

test('customer aging: an advance received only is an unapplied credit; pending PDCs shown, not deducted', async () => {
  await reset(fixture());
  await cbt('Bank Receipt', '2026-04-01', ['Customer', 'CU1'], 250, []);
  await rtdb.ref('pdcCheques/P1').set({ PartyType: 'Customer', PartyID: 'CU1', CompanyID: 'C1', Direction: 'Received', Status: 'Pending', TransactionDate: '2026-04-10',
    ChequeDate: '2026-05-15', ChequeNumber: '000123', TransactionNumber: 'PDCR-1', Amount: 500 });
  const r = await aging('Customer', '2026-04-30', 'due');
  assert.deepEqual(r.Rows.map(x => [x.PartyID, x.Owed, x.Unapplied, x.Net, x.PendingPdc]), [['CU1', 0, 250, -250, 500]]);
  const soa = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1', fromDate: '2026-01-01', toDate: '2026-04-30' });
  assert.equal(soa.Closing, -250);
  assert.equal(r.Control.status, 'ok');
});

test('access: the module right, the company, the inputs', async () => {
  await reset(fixture());
  assert.match(await err(call('u-admin', 'getPartyAging', { partyType: 'Supplier', companyId: 'C1' })), /Party type must be Customer or Vendor/);
  assert.match(await err(call('u-admin', 'getPartyAging', { partyType: 'Vendor', companyId: '' })), /Select a Company/);
  assert.match(await err(call('u-admin', 'getPartyAging', { partyType: 'Vendor', companyId: 'C1', asOf: '30/04/2026' })), /"as at" date/);
  assert.match(await err(call('u-other', 'getPartyAging', { partyType: 'Vendor', companyId: 'C1' })), /do not have access to that company/);
  assert.equal((await aging('Vendor', '2026-04-30', 'due', 'u-viewer')).Rows.length, 0, 'a Viewer reads it');
  await rtdb.ref('permissions/VENDORAGING/access').set(['Admin']);
  assert.match(await err(aging('Vendor', '2026-04-30', 'due', 'u-viewer')), /do not have access to Vendor Aging/);
  assert.equal((await aging('Customer', '2026-04-30', 'due', 'u-viewer')).Rows.length, 0, 'its own right');
  await rtdb.ref('permissions/INVENTORYAGING/access').set(['Admin']);
  assert.match(await err(call('u-viewer', 'getInventoryAging', { companyId: 'C1' })), /do not have access to Inventory Aging/);
});

test('inventory aging: first in first out by receipt date; a transfer keeps the age; a reversed receipt drops out; values as the stock ledger', async () => {
  const f = fixture();
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' };
  const ln = (item, wh, dir, qty, cost, extra) => Object.assign({ ItemID: item, WarehouseID: wh, Direction: dir, Quantity: qty, UnitCost: cost, TotalValue: qty * cost }, extra || {});
  const tx = (type, date, lines, extra) => Object.assign({ TransactionType: type, Status: 'Posted', CompanyID: 'C1', TransactionDate: date, PostedAt: date + 'T08:00:00Z', Lines: lines }, extra || {});
  f.stock = {
    transactions: {
      G0: tx('GRN', '2025-03-01', [ln('I2', 'WH1', 'In', 4, 5)]),
      G1: tx('GRN', '2025-09-01', [ln('I1', 'WH1', 'In', 10, 10)]),
      G2: tx('GRN', '2026-03-01', [ln('I1', 'WH1', 'In', 10, 12)]),
      M1: tx('MaterialIssue', '2026-04-10', [ln('I1', 'WH1', 'Out', 12, 11)]),
      W1: tx('WarehouseMovement', '2026-04-15', [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', Quantity: 3, UnitCost: 11, TotalValue: 33 }]),
      G3: tx('GRN', '2026-04-20', [ln('I1', 'WH1', 'In', 5, 14)], { ReversedByGRN: 'R3' }),
      R3: tx('GRN', '2026-04-25', [ln('I1', 'WH1', 'Out', 5, 14)], { ReversalOfGRN: 'G3' }),
      D1: tx('GRN', '2026-04-28', [ln('I1', 'WH1', 'In', 1, 11)], { Status: 'Draft' }), // not posted
      X1: tx('GRN', '2026-04-01', [ln('I1', 'WH1', 'In', 9, 9)], { CompanyID: 'C2' }) // another company
    },
    ledger: { I1: { WH1: { Quantity: 5, AvgCost: 11, TotalValue: 55 }, WH2: { Quantity: 3, AvgCost: 11, TotalValue: 33 } }, I2: { WH1: { Quantity: 4, AvgCost: 5, TotalValue: 20 } } }
  };
  await reset(f);
  const inv = (asOf, extra) => call('u-admin', 'getInventoryAging', Object.assign({ companyId: 'C1', asOf }, extra || {}));

  const r = await inv('2026-04-30');
  assert.deepEqual(r.Buckets.map(b => b.key), ['d0_30', 'd31_60', 'd61_90', 'd91_180', 'd181_365', 'd365plus']);
  const i1 = r.Rows.find(x => x.ItemID === 'I1'), i2 = r.Rows.find(x => x.ItemID === 'I2');
  // I1: the issue took the September 10 and 2 of March's; 8 left of March's (60 days), 3 of them moved to WH2; the reversed April receipt drops out.
  assert.deepEqual([i1.Qty, i1.Value, i1.QtyBuckets.d31_60, i1.Buckets.d31_60, i1.LastIn, i1.LastOut], [8, 88, 8, 88, '2026-03-01', '2026-04-10']);
  assert.deepEqual([i2.Qty, i2.Value, i2.QtyBuckets.d365plus, i2.Buckets.d365plus], [4, 20, 4, 20]);
  assert.deepEqual([r.Totals.Value, r.Totals.Buckets.d31_60, r.Totals.Buckets.d365plus], [108, 88, 20]);
  // As the stock ledger: the value on hand today.
  const ledger = (await rtdb.ref('stock/ledger').get()).val();
  const ledgerValue = Object.values(ledger).flatMap(w => Object.values(w)).reduce((s, l) => s + l.TotalValue, 0);
  assert.equal((await inv(new Date().toISOString().slice(0, 10))).Totals.Value, ledgerValue);

  // One warehouse: WH2 holds the 3 moved, still dated 1 March.
  const wh2 = await inv('2026-04-30', { warehouseId: 'WH2' });
  assert.deepEqual(wh2.Rows.map(x => [x.ItemID, x.Qty, x.Value, x.QtyBuckets.d31_60]), [['I1', 3, 33, 3]]);
  // Before the reversal: the April receipt counts (2 days old).
  const apr22 = await inv('2026-04-22');
  const a1 = apr22.Rows.find(x => x.ItemID === 'I1');
  assert.deepEqual([a1.Qty, a1.QtyBuckets.d0_30, a1.QtyBuckets.d31_60], [13, 5, 8]);
  // By category; and items with no stock only when asked.
  assert.deepEqual((await inv('2026-04-30', { category: 'FinishedGood' })).Rows.map(x => x.ItemID), ['I2']);
  assert.deepEqual((await inv('2025-01-01')).Rows, []);
  assert.deepEqual(r.Warehouses.map(w => w.ID), ['WH1', 'WH2']);
});
