// Numbering (owner, 2026-10-09; docs/modules/NUMBERING.md, decisions 80-83):
// every document number and code from a format built of parts (prefix,
// company code yes/no, year none/2/4 digits, order, separator, digits); the
// defaults are today's numbers on today's counters; with the year in the
// format the number restarts each year, without the company code one
// sequence is shared; two types never give the same numbers; a customized
// number is never given twice; Data Reset and Master Import still put the
// counters back; the right to change it; the change log.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, PROJECT } = require('./_helpers');
// The numbering and Master Import code runs in this process too: it needs
// the default app, on the emulators (_helpers has set their hosts).
const admin = require('firebase-admin');
if (!admin.apps.some(a => a.name === '[DEFAULT]')) admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const N = require('../../src/numbering');
const mi = require('../../src/masterImport');

test.after(async () => { await app.delete(); await admin.app().delete(); });

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-BANK2'] = { AccountCode: '1101', AccountName: 'C2 Bank', AccountType: 'Asset', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.users['u-admin'].AssignedCompanies = ['C1', 'C2'];
  return f;
}
const opp = (o) => Object.assign({ AccountCode: '6000', Amount: '10', Description: 'Stationery', CostCenterID: 'CC1' }, o);
// A bank payment posted: its number.
async function bankPayment(companyId, date) {
  const d = await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: companyId === 'C2' ? '1101' : '1100',
    JVDate: date || D, Description: 'Voucher', CompanyID: companyId || 'C1', CostCenterID: 'CC1', OppositeLines: [opp()] } });
  assert.equal(d.success, true, d.error);
  const p = await call('u-admin', 'postJournalEntry', { jvId: d.jvId });
  assert.equal(p.success, true, p.error);
  return p.jvNumber;
}
const item = async (name) => {
  const r = await call('u-admin', 'saveItem', { itemData: { ItemName: name, Category: 'RawMaterial', UOMID: 'UOM-PCS', CompanyID: 'C1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' } });
  assert.equal(r.success, true, r.error);
  return r.itemCode;
};
const save = (kind, format, uid) => call(uid || 'u-admin', 'saveNumberingFormat', { kind, format });
const fmt = o => Object.assign({ Prefix: 'BP', Company: true, Year: 'YY', Order: 'YC', Sep: '-', Digits: 6 }, o);

test('the defaults are today\'s numbers, carrying on from today\'s counters', async () => {
  await reset(fixture());
  await rtdb.ref('gl/counters/BP/2026/01').set(41);
  await rtdb.ref('itemCounters/RM').set(7);
  assert.equal(await bankPayment(), 'BP-26-01-000042');
  assert.equal(await val('gl/counters/BP/2026/01'), 42, 'the same counter, as before');
  // Never below a number the other counter tree may have given.
  await rtdb.ref('stock/counters/voucher/BP/2026/01').set(60);
  assert.equal(await bankPayment(), 'BP-26-01-000061');
  assert.equal(await item('Bolt'), 'RM-000008');
  assert.equal(await N.employeeCode(), 'EMP-0001');
  assert.equal(await N.assetNumber('C2'), 'FA-02-000001');
  assert.equal(await N.hrNumber('LV', 2026), 'LV-2026-0001');
  assert.equal(await N.voucherNumber('GRN', 2026, 'C1'), 'GRN-26-01-000001');
  assert.equal(await val('stock/counters/voucher/GRN/2026/01'), 1);
  const g = await call('u-admin', 'getNumbering', {});
  const k = g.kinds.find(x => x.key === 'doc:BP');
  assert.deepEqual([k.label, k.sample, k.isDefault, g.canWrite], ['Bank Payment', 'BP-' + String(new Date().getUTCFullYear()).slice(-2) + '-01-000001', true, true]);
  assert.ok(g.kinds.length > 50);
  assert.deepEqual(g.kinds.filter(x => x.group === 'Master codes').map(x => x.key),
    ['item:RawMaterial', 'item:SemiFinishedGood', 'item:FinishedGood', 'item:Consumable', 'item:Scrap', 'vendor', 'customer:CL', 'customer:CE', 'employee', 'asset']);
  assert.equal(g.kinds.find(x => x.key === 'item:RawMaterial').company, false);
});

test('the owner\'s example BP-01-26-00001: prefix, company then year, 5 digits; restarts by year; per company; reset to default carries on', async () => {
  await reset(fixture());
  await rtdb.ref('gl/counters/BP/2026/01').set(3);
  const r = await save('doc:BP', fmt({ Order: 'CY', Digits: 5 }));
  assert.deepEqual([r.success, r.sample], [true, 'BP-01-' + String(new Date().getUTCFullYear()).slice(-2) + '-00001']);
  assert.equal(await bankPayment(), 'BP-01-26-00001');
  assert.equal(await bankPayment(), 'BP-01-26-00002');
  assert.equal(await bankPayment('C2'), 'BP-02-26-00001', 'each company its own sequence');
  assert.equal(await bankPayment('C1', '2027-01-05'), 'BP-01-27-00001', 'a new year starts again');
  assert.equal(await val('gl/counters/BP/2026/01'), 3, 'the default\'s counter untouched');
  // Prefix "10", no company code, no year: one sequence for all companies, never restarting.
  await save('doc:BP', fmt({ Prefix: '10', Company: false, Year: '', Digits: 5 }));
  assert.equal(await bankPayment('C1'), '10-00001');
  assert.equal(await bankPayment('C2'), '10-00002');
  assert.equal(await bankPayment('C1', '2027-02-01'), '10-00003');
  // No separator, 4-digit year.
  await save('doc:BP', fmt({ Prefix: 'PAY', Company: false, Year: 'YYYY', Sep: '', Digits: 4 }));
  assert.equal(await bankPayment(), 'PAY20260001');
  // Back to the default: it carries on from its own counter.
  assert.equal((await call('u-admin', 'saveNumberingFormat', { kind: 'doc:BP', reset: true })).success, true);
  assert.equal(await bankPayment(), 'BP-26-01-000004');
  assert.equal(await val('numbering/formats/doc:BP'), null);
  // Other types are unaffected.
  assert.match(await N.voucherNumber('CR', 2026, 'C1'), /^CR-26-01-\d{6}$/);
  // The change log: who, from, to.
  const log = (await call('u-admin', 'getNumbering', {})).log;
  assert.equal(log.length, 4);
  assert.deepEqual(log.map(x => x.Kind), ['doc:BP', 'doc:BP', 'doc:BP', 'doc:BP']);
  assert.ok(log.every(x => x.By === 'admin'));
});

test('codes: items, vendors, employees, HR documents customized; restart only with the year in the format', async () => {
  await reset(fixture());
  await save('item:RawMaterial', fmt({ Prefix: 'RAW', Company: false, Year: '', Digits: 4 }));
  assert.deepEqual([await item('Bolt'), await item('Nut')], ['RAW-0001', 'RAW-0002']);
  await save('employee', fmt({ Prefix: 'E', Company: false, Year: 'YY', Sep: '/', Digits: 3 }));
  assert.equal(await N.employeeCode(), 'E/' + String(new Date().getUTCFullYear()).slice(-2) + '/001');
  await save('hr:LV', fmt({ Prefix: 'LEAVE', Company: false, Year: 'YYYY', Digits: 3 }));
  assert.deepEqual([await N.hrNumber('LV', 2026), await N.hrNumber('LV', 2026), await N.hrNumber('LV', 2027)], ['LEAVE-2026-001', 'LEAVE-2026-002', 'LEAVE-2027-001']);
  await save('vendor', fmt({ Prefix: 'SUP', Company: false, Year: '', Digits: 5 }));
  const v = await call('u-admin', 'saveVendor', { vendorData: { VendorName: 'Gulf Steel Trading', Category: 'RawMaterialSupplier', CompanyID: 'C1',
    Classification: 'Local', TradePayablesAccountID: 'A-AP', PaymentTermsDays: 30 } });
  assert.equal(v.vendorCode, 'SUP-00001', JSON.stringify(v));
  // The asset number may carry the company code; an item may not.
  await save('asset', fmt({ Prefix: 'AST', Company: true, Year: '', Digits: 4 }));
  assert.equal(await N.assetNumber('C1'), 'AST-01-0001');
  await assert.rejects(save('item:Scrap', fmt({ Prefix: 'SC', Company: true, Year: '' })), /belongs to no single company/);
});

test('checks: the right, the parts, and no two types giving the same numbers (now, by default, or before)', async () => {
  await reset(fixture());
  await assert.rejects(save('doc:BP', fmt({ Prefix: 'X' }), 'u-viewer'), /permission to change the numbering/);
  await assert.rejects(save('doc:BP', fmt({ Prefix: 'B-P' })), /1 to 10 letters or digits/);
  await assert.rejects(save('doc:BP', fmt({ Prefix: '' })), /1 to 10 letters or digits/);
  await assert.rejects(save('doc:BP', fmt({ Digits: 2 })), /3 to 10 digits/);
  await assert.rejects(save('doc:BP', fmt({ Sep: '.' })), /separator/);
  await assert.rejects(save('doc:BP', fmt({ Year: 'Y' })), /year/);
  await assert.rejects(save('doc:NOPE', fmt({})), /Unknown numbering type/);
  // Another type's default (its numbers already exist): Cash Receipt's CR-26-01-.
  await assert.rejects(save('doc:BP', fmt({ Prefix: 'CR' })), /same numbers as Cash Receipt/);
  // Another type's current format.
  await save('doc:CP', fmt({ Prefix: 'OUT', Company: false }));
  await assert.rejects(save('doc:BP', fmt({ Prefix: 'OUT', Company: false, Digits: 4 })), /same numbers as Cash Payment/);
  // A shape another type had before, even after it changed again.
  await save('doc:CP', fmt({ Prefix: 'OUT2', Company: false }));
  await assert.rejects(save('doc:BP', fmt({ Prefix: 'OUT', Company: false })), /same numbers as Cash Payment/);
  // Cash Payment's own default shape, though it has moved away from it: its CP- numbers exist.
  await assert.rejects(save('doc:BP', fmt({ Prefix: 'CP' })), /same numbers as Cash Payment/);
  // Saving the same again changes nothing and logs nothing.
  const before = (await call('u-admin', 'getNumbering', {})).log.length;
  assert.equal((await save('doc:CP', fmt({ Prefix: 'OUT2', Company: false }))).unchanged, true);
  assert.equal((await call('u-admin', 'getNumbering', {})).log.length, before);
});

test('a customized number is never given twice; Data Reset restarts it; Master Import gives its number back', async () => {
  await reset(fixture());
  await save('item:RawMaterial', fmt({ Prefix: 'RAW', Company: false, Year: '', Digits: 4 }));
  // A number already given (e.g. by an earlier format with the same text) is skipped.
  await rtdb.ref('itemCounters/_issued/RAW-0001|').set(true);
  assert.equal(await item('Bolt'), 'RAW-0002');
  assert.equal(await N.counterPathOfCode('RAW-0002'), 'itemCounters/_fmt/RAW-|');
  assert.equal(await N.counterPathOfCode('BP-26-01-000004'), 'gl/counters/BP/2026/01');
  assert.equal(await N.counterPathOfCode('LV-2026-0003'), 'hrCounters/LV-2026');
  assert.equal(await N.counterPathOfCode('FA-02-000009'), 'fa/counters/asset/02');
  // A failed import gives the customized code back.
  const user = { uid: 'u-admin', profile: (await val('users/u-admin')) };
  const good = { data: { ItemName: 'Washer', Category: 'RawMaterial', UOMID: 'UOM-PCS', CompanyID: 'C1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS', ReorderLevel: '' } };
  const bad = { data: Object.assign({}, good.data, { ItemName: 'Nut', UOMID: 'NO-SUCH-UOM' }) };
  const res = await mi._importRows({ auth: { uid: 'u-admin', token: {} } }, user, 'ITEM', [good, bad]);
  assert.equal(res.failure.row, 2);
  assert.equal(await val('itemCounters/_fmt/RAW-|'), 2, 'the number RAW-0003 is given back');
  assert.equal(await item('Washer'), 'RAW-0003');
  // Data Reset of the items clears the customized counter too: numbering starts again.
  assert.equal((await call('u-root', 'clearDataCategories', { categoryKeys: ['items'], confirmPhrase: 'DELETE' })).success, true);
  assert.equal(await val('itemCounters'), null);
  assert.equal(await item('Bolt'), 'RAW-0001');
});
