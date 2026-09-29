// My Drafts in Home Tasks (docs/modules/DRAFT_TASKS.md, owner 2026-09-28):
// every document still in Draft, shown only to its last updater
// (UpdatedBy, else CreatedBy), until it is submitted, posted or deleted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, today } = require('./_helpers');

test.after(async () => { await app.delete(); });

const mine = async uid => (await call(uid, 'getMyDraftsForUser', {}))
  .map(d => d.ModuleID + ':' + d.DocumentID).sort();

// A draft in every source, all last saved by "admin".
function fixture() {
  const f = baseFixture();
  const d = (extra, n) => Object.assign({ Status: 'Draft', CompanyID: 'C1', Description: 'Draft', CreatedBy: 'someone',
    UpdatedBy: 'admin', UpdatedAt: '2026-09-20T00:00:' + String(n).padStart(2, '0') }, extra);
  f.stock = { transactions: {
    S1: d({ TransactionType: 'GRN' }, 1), S2: d({ TransactionType: 'MaterialIssue' }, 2), S3: d({ TransactionType: 'Production' }, 3),
    S4: d({ TransactionType: 'WarehouseMovement' }, 4), S5: d({ TransactionType: 'StockAdjustment' }, 5), S6: d({ TransactionType: 'PhysicalCount' }, 6),
    S7: d({ TransactionType: 'DeliveryNote' }, 7), S8: d({ TransactionType: 'PurchaseReturn' }, 8), S9: d({ TransactionType: 'SalesReturn' }, 9),
    // Not drafts, or not admin's: never shown.
    X1: d({ TransactionType: 'GRN', Status: 'Posted' }, 10), X2: d({ TransactionType: 'GRN', Status: 'Rejected' }, 11),
    X3: d({ TransactionType: 'GRN', Status: 'PendingApproval' }, 12), X4: d({ TransactionType: 'GRN', UpdatedBy: 'approver', CreatedBy: 'admin' }, 13),
    X5: d({ TransactionType: 'GRN', CompanyID: 'C2' }, 14)
  } };
  f.purchaseRequisitions = { PR1: d({}, 15) };
  f.inventoryPurchaseRequisitions = { IPR1: d({}, 16) };
  f.purchaseOrders = { PO1: d({}, 17) };
  f.salesOrders = { SO1: d({}, 18) };
  f.jobOrderBatches = { JOB1: d({}, 19) };
  f.vendorInvoices = { VI1: d({}, 20) };
  f.customerInvoices = { CI1: d({}, 21) };
  // Only CreatedBy (never updated since): the creator is the last updater.
  f.pdcCheques = { PDCR: d({ Direction: 'Received', UpdatedBy: '', CreatedBy: 'admin' }, 22), PDCI: d({ Direction: 'Issued' }, 23) };
  f.recurringJournals = { RJ1: d({}, 24), RJ2: d({ Status: 'Active' }, 25) };
  return { f, d };
}

test('every source lists its drafts under the right module; posted, rejected, pending, another user\'s and another company\'s are left out', async () => {
  const { f, d } = fixture();
  await reset(f);
  await firestore.collection('journalEntries').doc('JE1').set(d({ VoucherType: 'Journal Voucher' }, 26));
  await firestore.collection('journalEntries').doc('JE2').set(d({ VoucherType: 'Bank Payment' }, 27));
  await firestore.collection('journalEntries').doc('JE3').set(d({ VoucherType: 'Journal Voucher', Status: 'Posted' }, 28));
  for (const [id, m] of [['FA1', 'FAACQ'], ['FA2', 'FAADDDEP'], ['FA3', 'FARETIRE'], ['FA4', 'FAAUC']]) {
    await firestore.collection('faPostings').doc(id).set(d({ ModuleID: m }, 0));
  }

  const list = await call('u-admin', 'getMyDraftsForUser', {});
  assert.deepEqual(list.map(x => x.ModuleID + ':' + x.DocumentID).sort(), [
    'CBT:JE2', 'CUSTOMERINVOICE:CI1', 'DELIVERYNOTE:S7', 'FAACQ:FA1', 'FAADDDEP:FA2', 'FAAUC:FA4', 'FARETIRE:FA3',
    'GRN:S1', 'INVENTORYPURCHASEREQUISITION:IPR1', 'JOBORDERREQUEST:JOB1', 'JV:JE1', 'MATERIALISSUE:S2', 'PDCISSUED:PDCI',
    'PDCRECEIVED:PDCR', 'PHYSICALCOUNT:S6', 'PRODUCTION:S3', 'PURCHASEORDER:PO1', 'PURCHASEREQUISITION:PR1', 'PURCHASERETURN:S8',
    'RECURRINGJV:RJ1', 'SALESORDER:SO1', 'SALESRETURN:S9', 'STOCKADJUSTMENT:S5', 'VENDORINVOICE:VI1', 'WAREHOUSEMOVEMENT:S4'
  ]);
  // Newest save first; labels from the module registry.
  assert.deepEqual(list.slice(0, 2).map(x => x.DocumentID), ['JE2', 'JE1']);
  assert.equal(list.find(x => x.DocumentID === 'S1').ModuleLabel, 'Goods Receipt (GRN)');

  assert.deepEqual(await mine('u-approver'), ['GRN:X4'], 'the last updater, not the creator');
  assert.deepEqual(await mine('u-other'), [], 'u-other is "other", and C2\'s draft was saved by admin');
});

test('a module the user can no longer open drops out of their drafts', async () => {
  const { f } = fixture();
  f.permissions.GRN.access = ['Viewer'];
  f.permissions.PURCHASEORDER.access = [];
  await reset(f);
  const list = await mine('u-admin');
  assert.ok(!list.some(x => x.startsWith('GRN:') || x.startsWith('PURCHASEORDER:')), list.join(' '));
  assert.ok(list.includes('MATERIALISSUE:S2'));
});

test('real saves: another user\'s edit moves the task to them; posting or deleting removes it', async () => {
  await reset(baseFixture());
  const grn = extra => Object.assign({ TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, UnitCost: 5, Description: 'x' }] }, extra || {});
  const g = await call('u-admin', 'saveGrnDraft', grn());
  assert.equal(g.success, true, g.error);
  const jv = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: today, Description: 'JV', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 1, Description: 'a' }, { AccountCode: '1100', Credit: 1, Description: 'b' }] } });
  assert.equal(jv.success, true, jv.error);
  assert.deepEqual(await mine('u-admin'), ['GRN:' + g.grnId, 'JV:' + jv.jvId]);
  assert.deepEqual(await mine('u-approver'), []);

  assert.equal((await call('u-approver', 'saveGrnDraft', grn({ GRNID: g.grnId, Description: 'Edited' }))).success, true);
  assert.deepEqual(await mine('u-admin'), ['JV:' + jv.jvId], 'no longer admin\'s task');
  const theirs = await call('u-approver', 'getMyDraftsForUser', {});
  assert.deepEqual(theirs.map(x => [x.ModuleID, x.DocumentID, x.Description, x.DocumentDate]), [['GRN', g.grnId, 'Edited', today]]);

  assert.equal((await call('u-approver', 'postGrn', { grnId: g.grnId })).success, true);
  assert.deepEqual(await mine('u-approver'), [], 'posted');
  assert.equal((await call('u-admin', 'deleteJournalDraft', { jvId: jv.jvId })).success, true);
  assert.deepEqual(await mine('u-admin'), [], 'deleted');
});
