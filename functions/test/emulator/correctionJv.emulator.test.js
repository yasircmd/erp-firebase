// Correction JV (owner, 2026-11-07; docs/modules/CORRECTION_JV.md,
// Q415-Q418): a posted entry's lines reclassified by a new CJV entry (the
// old coding out, the new in, a line split if wanted), the original
// untouched; party, control and fixed-asset lines not corrected; inventory
// and tax lines keep their account; a line corrected once; the original's
// reversal refused until its correction is reversed (a JV's and a
// document's).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-10-10';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const entry = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const lineRows = e => e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.CostCenterID || '']);

function fixture() {
  const f = baseFixture();
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  return f;
}
async function postedJv(lines, description) {
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: description || 'Workshop supplies', CompanyID: 'C1', Lines: lines } }));
  const p = ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  return { jvId: s.jvId, number: p.jvNumber };
}
const saveCjv = (originalId, corrections, extra) => call('u-admin', 'saveCorrectionJvDraft', Object.assign({ originalId, date: D, corrections }, extra || {}));

test('a line reclassified and split by a CJV: the old coding out, the new in; the original untouched; numbered CJV', async () => {
  await reset(fixture());
  const o = await postedJv([{ AccountCode: '5100', Debit: 100, Description: 'Paint', CostCenterID: 'CC1' }, { AccountCode: '1000', Credit: 100, Description: 'Paid' }]);
  const found = await call('u-admin', 'getEntryForCorrection', { companyId: 'C1', voucherNumber: o.number });
  assert.equal(found.entry._id, o.jvId);
  assert.deepEqual(found.lines.map(l => l.Correctable), [true, true]);

  const s = ok(await saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '5000', CostCenterID: 'CC1', Amount: 60 }, { AccountCode: '5100', CostCenterID: 'CC2', Amount: 40 }] }]));
  const draft = await entry(s.cjvId);
  assert.equal(draft.VoucherType, 'CJV');
  assert.equal(draft.Status, 'Draft');
  assert.equal(draft.CorrectionOfJV, o.jvId);
  assert.deepEqual(lineRows(draft), [['5100', 0, 100, 'CC1'], ['5000', 60, 0, 'CC1'], ['5100', 40, 0, 'CC2']]);
  const p = ok(await call('u-admin', 'postJournalEntry', { jvId: s.cjvId }));
  assert.match(p.jvNumber, /^CJV/);
  assert.equal((await entry(s.cjvId)).Status, 'Posted');
  assert.deepEqual(lineRows(await entry(o.jvId)), [['5100', 100, 0, 'CC1'], ['1000', 0, 100, '']], 'the original is not changed');

  const list = await call('u-admin', 'getCorrectionJvs', {});
  assert.deepEqual(list.rows.map(r => [r.JVNumber, r.CorrectionOfNumber, r.Status]), [[p.jvNumber, o.number, 'Posted']]);
  // The line is now corrected: offered no more, and a second CJV on it refused.
  const again = await call('u-admin', 'getEntryForCorrection', { jvId: o.jvId });
  assert.equal(again.lines[0].Correctable, false);
  assert.match(again.lines[0].Why, /Already corrected by CJV/);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '5000', Amount: 100 }] }])), /already corrected by CJV/);
  ok(await saveCjv(o.jvId, [{ LineIndex: 1, Parts: [{ AccountCode: '1100', Amount: 100 }] }]), 'its other line still can be');
});

test('the checks: parts total the line, something changes, no party line, inventory keeps its account, nothing moved to inventory', async () => {
  await reset(fixture());
  const o = await postedJv([{ AccountCode: '5100', Debit: 100, Description: 'Paint', CostCenterID: 'CC1' }, { AccountCode: '1300', Debit: 30, Description: 'Stock', CostCenterID: 'CC1' },
    { AccountCode: '2000', Credit: 130, Description: 'Owed', PartyType: 'Vendor', PartyID: 'V1' }]);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '5000', Amount: 60 }] }])), /parts total 60.00, the line is 100.00/);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '5100', CostCenterID: 'CC1', Amount: 100 }] }])), /same as before/);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 2, Parts: [{ AccountCode: '2100', Amount: 130 }] }])), /vendor's or sales rep's line is not corrected/);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 1, Parts: [{ AccountCode: '5100', CostCenterID: 'CC1', Amount: 30 }] }])), /1300 is an inventory account: only its cost centre/);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '1300', Amount: 100 }] }])), /1300 is an inventory account: nothing is moved to it/);
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '2000', Amount: 100 }] }])), /control account: nothing is moved to it/);
  const found = await call('u-admin', 'getEntryForCorrection', { jvId: o.jvId });
  assert.deepEqual(found.lines.map(l => [l.Correctable, l.AccountFixed]), [[true, false], [true, true], [false, false]]);
  ok(await saveCjv(o.jvId, [{ LineIndex: 1, Parts: [{ AccountCode: '1300', CostCenterID: 'CC2', Amount: 30 }] }]), 'inventory: its cost centre may change');
  assert.match(await err(call('u-viewer', 'saveCorrectionJvDraft', { originalId: o.jvId, date: D, corrections: [{ LineIndex: 0, Parts: [{ AccountCode: '5000', Amount: 100 }] }] })), /permission/);
  assert.match(await err(call('u-other', 'getEntryForCorrection', { jvId: o.jvId })), /access to that company/);
});

test('a corrected JV is reversed only after its CJV; the CJV reverses like a JV', async () => {
  await reset(fixture());
  const o = await postedJv([{ AccountCode: '5100', Debit: 80, Description: 'Paint', CostCenterID: 'CC1' }, { AccountCode: '1000', Credit: 80, Description: 'Paid' }]);
  const s = ok(await saveCjv(o.jvId, [{ LineIndex: 0, Parts: [{ AccountCode: '5100', CostCenterID: 'CC2', Amount: 80 }] }]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.cjvId }));
  const cjv = await entry(s.cjvId);
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: o.jvId, reversalDate: D })), new RegExp('corrected by ' + cjv.JVNumber + ': reverse the correction first'));
  const r = ok(await call('u-admin', 'reverseJournalEntry', { jvId: s.cjvId, reversalDate: D }));
  assert.match(r.jvNumber, /^CJV/);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: o.jvId, reversalDate: D }));
  assert.match(await err(saveCjv(o.jvId, [{ LineIndex: 1, Parts: [{ AccountCode: '1100', Amount: 80 }] }])), /has been reversed/);
});

test('a document\'s entry: a Delivery Note corrected, its reversal refused until the CJV is reversed', async () => {
  const f = fixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 30, TotalValue: 1500 } } } };
  await reset(f);
  const so = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 5, UnitPrice: 50 }] } }));
  ok(await call('u-admin', 'confirmSalesOrder', { soId: so.soId }));
  const lineId = (await val('salesOrders/' + so.soId)).Lines[0].LineID;
  const dn = ok(await call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ SourceSOID: so.soId, SourceSOLineID: lineId, Quantity: 2, Description: 'Ship' }] } }));
  ok(await call('u-admin', 'postDeliveryNote', { dnId: dn.dnId }));
  const jvId = (await val('stock/transactions/' + dn.dnId)).LinkedJVID;
  const found = await call('u-admin', 'getEntryForCorrection', { jvId });
  const cogs = found.lines.find(l => l.AccountCode === '5000');
  assert.equal(cogs.Correctable, true, 'the cost of sales line');
  assert.equal(found.lines.find(l => l.AccountCode === '1300').AccountFixed, true, 'the inventory line keeps its account');
  const s = ok(await saveCjv(jvId, [{ LineIndex: cogs.LineIndex, Parts: [{ AccountCode: '5000', CostCenterID: 'CC2', Amount: cogs.Debit }] }]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.cjvId }));
  assert.match(await err(call('u-admin', 'reverseDeliveryNote', { dnId: dn.dnId, reversalDate: D })), /reverse the correction first/);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: s.cjvId, reversalDate: D }));
  ok(await call('u-admin', 'reverseDeliveryNote', { dnId: dn.dnId, reversalDate: D }));
});
