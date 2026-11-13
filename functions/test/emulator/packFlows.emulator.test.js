// Module Builder, phase 6 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q494, Q499): the five packs, each published from the code and run through
// its flow to the books. Hotel: nights and charges worked out, no double
// booking, check-out to a Room Invoice. Subscriptions: fees worked out, the
// run grouped per customer. Real estate: no unit let twice, the rent run as
// Lease Invoices. Investments: the expected income, a sale's cost and gain
// journaled. Construction: claims less earlier claims per BOQ item, the gross
// invoiced on the project, retention and advance recovery journaled off the
// customer, a subcontractor's claim to a vendor invoice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.ok(r && r.success === true, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const today = () => { const S = require('../../src/recurringSchedule'); return S.todayIn(S.TIME_ZONE); };

function fixture() {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Example Guest LLC', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Sample Tenant Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  Object.assign(f.coa, {
    'A-RET': { AccountCode: '1250', AccountName: 'Retention receivable', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-ADV': { AccountCode: '2150', AccountName: 'Advances received', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-INV': { AccountCode: '1500', AccountName: 'Investments', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-GAIN': { AccountCode: '4800', AccountName: 'Gain on investments', AccountType: 'Revenue', Status: 'Active', IsPostable: true } });
  f.orgUnits.P1 = { Type: 'Project', Code: 'PJ-01', Name: 'Tower A', Status: 'Active', CompanyID: 'C1' };
  return f;
}
// A pack's modules get Admin's rights (the helper's fixture gives every registered one a Viewer's).
async function publishPack(id) {
  const r = ok(await call('u-admin', 'publishModulePack', { id }));
  const { rtdb } = require('./_helpers');
  const all = (await call('u-admin', 'getModulePacks', {})).packs.find(p => p.id === id).modules;
  for (const m of all) await rtdb.ref('permissions/' + m.id).set(m.kind === 'variant' ? { access: ['Admin'], draft: ['Admin'], post: ['Admin'], taxcode: ['Admin'] } : { access: ['Admin'], write: ['Admin'], void: ['Admin'] });
  return r;
}
const save = (mod, record) => call('u-admin', 'saveBuiltRecord', { moduleId: mod, record }).then(ok).then(r => r.id);
const rec = async (mod, id) => (await call('u-admin', 'getBuiltRecord', { moduleId: mod, id })).record;
const status = (mod, id, s) => call('u-admin', 'setBuiltStatus', { moduleId: mod, id, status: s }).then(ok);
const setup = (mod, actions) => call('u-admin', 'saveBuiltSetup', { moduleId: mod, companyId: 'C1', actions }).then(ok);
const act = (mod, id, action) => call('u-admin', 'runBuiltAction', { moduleId: mod, id, action }).then(ok).then(r => r.made);
const jvLines = async id => (await firestore.collection('journalEntries').doc(id).get()).data().Lines.map(l => [l.AccountCode, Number(l.Debit), Number(l.Credit), l.PartyID || '']);

test('the catalogue: five packs, each checked and publishable', async () => {
  await reset(fixture());
  const list = (await call('u-admin', 'getModulePacks', {})).packs;
  assert.deepEqual(list.map(p => [p.id, p.problem, p.version, p.changed]), [['P_HOTEL', '', 0, true], ['P_SUBS', '', 0, true], ['P_REALTY', '', 0, true], ['P_INVEST', '', 0, true], ['P_CONSTR', '', 0, true]]);
  for (const p of list) assert.equal((await publishPack(p.id)).version, 1);
  assert.ok((await call('u-admin', 'getModulePacks', {})).packs.every(p => p.version === 1 && !p.changed));
});

test('Hotel: a booking\'s nights and charges; no room booked twice; check-out to a Room Invoice', async () => {
  await reset(fixture());
  await publishPack('P_HOTEL');
  const room = await save('X_HROOM', { CompanyID: 'C1', Code: '101', Name: 'Garden', Fields: { roomType: 'Double', rate: 450 } });
  const b = await save('X_HBOOK', { CompanyID: 'C1', Date: today(), Fields: { guest: 'CU1', room, arrive: '2026-12-01', depart: '2026-12-04', rate: 450 } });
  assert.deepEqual([(await rec('X_HBOOK', b)).Fields.nights, (await rec('X_HBOOK', b)).Fields.amount], [3, 1350]);
  assert.match(await refused(save('X_HBOOK', { CompanyID: 'C1', Date: today(), Fields: { guest: 'CU1', room, arrive: '2026-12-03', depart: '2026-12-05', rate: 450 } })), /already held by HB-/);
  await status('X_HBOOK', b, 'Checked in');
  await status('X_HBOOK', b, 'Checked out');
  await setup('X_HBOOK', { invoice: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' } });
  const made = await act('X_HBOOK', b, 'invoice');
  const inv = await val('customerInvoices/' + made.id);
  assert.deepEqual([inv.Variant, inv.VariantLabel, inv.VariantFields.room, inv.VariantFields.nights, inv.Total, inv.CustomerID], ['X_HRINV', 'Room Invoice', '101 · Garden', 3, 1350, 'CU1']);
});

test('Subscriptions: each fee worked out; the run, one invoice per customer', async () => {
  await reset(fixture());
  await publishPack('P_SUBS');
  const gold = await save('X_SPLAN', { CompanyID: 'C1', Code: 'GOLD', Name: 'Gold support', Fields: { price: 120, billed: 'Monthly' } });
  const d = today(), due = d.slice(0, 8) + '01';
  const sub = (code, cust, qty) => save('X_SUBSCR', { CompanyID: 'C1', Code: code, Name: 'Sub ' + code, Fields: { customer: cust, plan: gold, quantity: qty, price: 120, every: 'Monthly', nextDue: due } });
  const s1 = await sub('S1', 'CU1', 2), s2 = await sub('S2', 'CU1', 1), s3 = await sub('S3', 'CU2', 3);
  assert.equal((await rec('X_SUBSCR', s3)).Fields.fee, 360);
  await setup('X_SUBSCR', { bill: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' } });
  const out = ok(await call('u-admin', 'runBuiltBulk', { moduleId: 'X_SUBSCR', action: 'bill', companyId: 'C1', date: d, ids: [s1, s2, s3] }));
  const totals = [];
  for (const m of out.made) totals.push((await val('customerInvoices/' + m.id)).Total);
  assert.deepEqual(totals.sort((a, b) => a - b), [360, 360], 'CU1: 240 + 120; CU2: 360');
});

test('Real estate: no unit let twice; the rent run as Lease Invoices', async () => {
  await reset(fixture());
  await publishPack('P_REALTY');
  const prop = await save('X_RPROP', { CompanyID: 'C1', Code: 'P1', Name: 'Harbour View', Fields: { use: 'Residential' } });
  const unit = await save('X_RUNIT', { CompanyID: 'C1', Code: 'HV-101', Name: 'Unit 101', Fields: { property: prop, unitType: '1 bedroom', rent: 5000 } });
  const d = today(), due = d.slice(0, 8) + '01';
  const lease = await save('X_RLEASE', { CompanyID: 'C1', Date: d, Fields: { tenant: 'CU2', unit, starts: '2026-01-01', ends: '2026-12-31', rent: 5000, every: 'Monthly', nextDue: due } });
  assert.equal((await rec('X_RLEASE', lease)).Fields.term, 364);
  await status('X_RLEASE', lease, 'Active');
  const other = await save('X_RLEASE', { CompanyID: 'C1', Date: d, Fields: { tenant: 'CU1', unit, starts: '2026-06-01', ends: '2027-05-31', rent: 5200, every: 'Monthly', nextDue: due } });
  assert.match(await refused(status('X_RLEASE', other, 'Active')), /already held by LSE-/);
  await setup('X_RLEASE', { rent: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' } });
  const out = ok(await call('u-admin', 'runBuiltBulk', { moduleId: 'X_RLEASE', action: 'rent', companyId: 'C1', date: d, ids: [lease] }));
  const inv = await val('customerInvoices/' + out.made[0].id);
  assert.deepEqual([inv.Variant, inv.VariantFields.unit, inv.Total, inv.CustomerID], ['X_RLINV', 'HV-101 · Unit 101', 5000, 'CU2']);
});

test('Investments: the expected income; a sale\'s cost and gain journaled, a loss of nothing refused', async () => {
  await reset(fixture());
  await publishPack('P_INVEST');
  const i = await save('X_IINV', { CompanyID: 'C1', Code: 'FD-1', Name: 'Example term deposit', Fields: { instrument: 'Deposit', cost: 100000, rate: 4.5 } });
  assert.equal((await rec('X_IINV', i)).Fields.income, 4500);
  const s = await save('X_ISELL', { CompanyID: 'C1', Date: today(), Fields: { investment: i, proceeds: 104000, cost: 100000 } });
  assert.deepEqual([(await rec('X_ISELL', s)).Fields.gain, (await rec('X_ISELL', s)).Fields.loss], [4000, -4000]);
  await status('X_ISELL', s, 'Confirmed');
  await setup('X_ISELL', { cost: { DebitAccountCode: '1000', CreditAccountCode: '1500', CostCenterID: 'CC1' }, gain: { DebitAccountCode: '1000', CreditAccountCode: '4800', CostCenterID: 'CC1' } });
  assert.deepEqual(await jvLines((await act('X_ISELL', s, 'cost')).id), [['1000', 100000, 0, ''], ['1500', 0, 100000, '']]);
  assert.deepEqual(await jvLines((await act('X_ISELL', s, 'gain')).id), [['1000', 4000, 0, ''], ['4800', 0, 4000, '']]);
  assert.match(await refused(act('X_ISELL', s, 'loss')), /below zero|account/);
});

test('Construction: claims less earlier claims per BOQ item; the gross invoiced on the project; retention and advance journaled; a subcontractor\'s claim', async () => {
  await reset(fixture());
  await publishPack('P_CONSTR');
  const k = await save('X_CCONTR', { CompanyID: 'C1', Code: 'K-1', Name: 'Tower A shell', Fields: { customer: 'CU1', project: 'P1', value: 100000, retPct: 10, advPct: 5 } });
  const boq = async (code, qty, rate) => save('X_CBOQ', { CompanyID: 'C1', Code: code, Name: 'Item ' + code, Fields: { contract: k, qty, rate } });
  const a1 = await boq('A1', 100, 50), a2 = await boq('A2', 10, 400);
  assert.equal((await rec('X_CBOQ', a2)).Fields.amount, 4000);
  const claim = (date, lines, extra) => save('X_CCLAIM', { CompanyID: 'C1', Date: date, Fields: Object.assign({ contract: k, customer: 'CU1', project: 'P1', retPct: 10, advPct: 5 }, extra || {}), Lines: lines });
  await claim('2026-09-30', [{ boq: a1, qtyToDate: 40, rate: 50 }]);
  const c2 = await claim('2026-10-31', [{ boq: a1, qtyToDate: 70, rate: 50 }, { boq: a2, qtyToDate: 2, rate: 400 }], { variations: 200 });
  const two = await rec('X_CCLAIM', c2);
  assert.deepEqual(two.Lines.map(l => [l.valueToDate, l.before, l.thisAmount]), [[3500, 2000, 1500], [800, 0, 800]]);
  assert.deepEqual([two.Fields.thisClaim, two.Fields.retention, two.Fields.recovered, two.Fields.net, two.Fields.claimedBefore, two.Fields.toDate], [2500, 250, 125, 2125, 2000, 4500]);
  await status('X_CCLAIM', c2, 'Certified');
  await setup('X_CCLAIM', { invoice: { SalesTypeID: 'ST1', AccountCode: '4000', CostCenterID: 'CC1' }, retain: { DebitAccountCode: '1250', CostCenterID: 'CC1' }, recover: { DebitAccountCode: '2150', CostCenterID: 'CC1' } });
  const inv = await val('customerInvoices/' + (await act('X_CCLAIM', c2, 'invoice')).id);
  assert.deepEqual([inv.Total, inv.ProjectID, inv.CustomerID], [2500, 'P1', 'CU1']);
  assert.deepEqual(await jvLines((await act('X_CCLAIM', c2, 'retain')).id), [['1250', 250, 0, ''], ['1200', 0, 250, 'CU1']]);
  assert.deepEqual(await jvLines((await act('X_CCLAIM', c2, 'recover')).id), [['2150', 125, 0, ''], ['1200', 0, 125, 'CU1']]);
  // A subcontractor's claim to a vendor invoice on the project, its retention held.
  const sub = await save('X_CSUB', { CompanyID: 'C1', Code: 'SUB-1', Name: 'Example Scaffolding', Fields: { vendor: 'V1', project: 'P1', value: 20000, retPct: 5 } });
  const sc = await save('X_CSCLAIM', { CompanyID: 'C1', Date: today(), Fields: { subcontract: sub, vendor: 'V1', project: 'P1', vendorRef: 'INV-77', amount: 6000, retPct: 5 } });
  assert.deepEqual([(await rec('X_CSCLAIM', sc)).Fields.retention, (await rec('X_CSCLAIM', sc)).Fields.net], [300, 5700]);
  await status('X_CSCLAIM', sc, 'Certified');
  await setup('X_CSCLAIM', { invoice: { AccountCode: '5100', CostCenterID: 'CC1' }, retain: { CreditAccountCode: '1250', CostCenterID: 'CC1' } });
  const vi = await val('vendorInvoices/' + (await act('X_CSCLAIM', sc, 'invoice')).id);
  assert.deepEqual([vi.Total, vi.ProjectID, vi.VendorID, vi.VendorRefNumber], [6000, 'P1', 'V1', 'INV-77']);
});
