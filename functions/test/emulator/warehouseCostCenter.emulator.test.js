// A warehouse's default cost center (owner, 2026-11-13; docs/modules/UX4.md
// item 4, Q502): set on the warehouse in Organizational Units (an active cost
// center of its company, or a shared one); the inventory screens take it
// when a line's warehouse is chosen (shell warehouseCostCenter, learnt from
// getActiveOrgUnits); a line saved with no cost center takes it on the
// server. A line's own cost center is kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  Object.assign(f.orgUnits, {
    CC2: { Type: 'CostCenter', Code: 'CC2', Name: 'Stores', Status: 'Active', CompanyID: 'C1' },
    CCX: { Type: 'CostCenter', Code: 'CCX', Name: 'Other company', Status: 'Active', CompanyID: 'C2' },
    CCOLD: { Type: 'CostCenter', Code: 'CCOLD', Name: 'Closed', Status: 'Inactive', CompanyID: 'C1' },
    CCS: { Type: 'CostCenter', Code: 'CCS', Name: 'Shared', Status: 'Active', CompanyID: '' }
  });
  return f;
}
test.after(async () => { await app.delete(); });
const unit = d => call('u-admin', 'saveOrgUnit', { unitData: Object.assign({ Type: 'Warehouse', Code: 'WH1', Name: 'Main Store', CompanyID: 'C1', Status: 'Active', UnitID: 'WH1' }, d) });
const err = r => (r && r.error) || '';

test('set on a warehouse: an active cost center of its company or a shared one; refused otherwise; screens get it', async () => {
  await reset(fixture());
  assert.equal((await unit({ DefaultCostCenterID: 'CC2' })).success, true);
  assert.equal((await val('orgUnits/WH1')).DefaultCostCenterID, 'CC2');
  assert.match(err(await unit({ DefaultCostCenterID: 'CCX' })), /belongs to another company/);
  assert.match(err(await unit({ DefaultCostCenterID: 'CCOLD' })), /not active/);
  assert.match(err(await unit({ DefaultCostCenterID: 'WH2' })), /Choose a cost center/);
  assert.equal((await unit({ DefaultCostCenterID: 'CCS' })).success, true, 'a shared one');
  assert.equal((await unit({ DefaultCostCenterID: 'CC2' })).success, true);
  const units = await call('u-admin', 'getActiveOrgUnits', {});
  assert.equal(units.find(u => u.UnitID === 'WH1').DefaultCostCenterID, 'CC2');
  assert.equal(units.find(u => u.UnitID === 'WH2').DefaultCostCenterID, '');
  assert.equal('DefaultCostCenterID' in units.find(u => u.UnitID === 'CC1'), false, 'only warehouses carry it');
});

test('a line saved with no cost center takes its warehouse\'s; one with its own keeps it (GRN, MI, SA, WM, Physical Count, Production)', async () => {
  await reset(fixture());
  await unit({ DefaultCostCenterID: 'CC2' });
  const line = o => Object.assign({ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, Description: 'x' }, o);
  const ids = {};
  ids.grn = (await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'd', CompanyID: 'C1', VendorID: 'V1',
    Lines: [line({ UnitCost: 4 }), line({ UnitCost: 4, CostCenterID: 'CC1' })] })).grnId;
  ids.mi = (await call('u-admin', 'saveMaterialIssueDraft', { TransactionDate: today, Description: 'd', CompanyID: 'C1', EntryType: 'Issue', CostCenterID: 'CC1',
    Lines: [line({}), line({ CostCenterID: 'CC1' })] })).miId;
  ids.sa = (await call('u-admin', 'saveStockAdjustmentDraft', { TransactionDate: today, Description: 'd', CompanyID: 'C1',
    Lines: [line({ AdjustmentDirection: 'Increase', UnitCost: 3 }), line({ AdjustmentDirection: 'Increase', UnitCost: 3, CostCenterID: 'CC1' })] })).adjId;
  ids.wm = (await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: today, Description: 'd', CompanyID: 'C1',
    Lines: [line({ WarehouseID: undefined, FromWarehouseID: 'WH1', ToWarehouseID: 'WH2' }), line({ WarehouseID: undefined, FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', CostCenterID: 'CC1' })] })).moveId;
  ids.pc = (await call('u-admin', 'savePhysicalCountDraft', { pcData: { TransactionDate: today, Description: 'd', CompanyID: 'C1',
    Lines: [line({ CountedQuantity: 3, SystemQuantity: 0 }), line({ CountedQuantity: 3, SystemQuantity: 0, CostCenterID: 'CC1' })] } })).pcId;
  const got = {};
  for (const [k, id] of Object.entries(ids)) {
    assert.ok(id, k + ' saved');
    got[k] = (await val('stock/transactions/' + id)).Lines.map(l => l.CostCenterID);
  }
  assert.deepEqual(got, { grn: ['CC2', 'CC1'], mi: ['CC2', 'CC1'], sa: ['CC2', 'CC1'], wm: ['CC2', 'CC1'], pc: ['CC2', 'CC1'] });
});
