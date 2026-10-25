// Linked document flows (owner, 2026-10-24; docs/modules/LINKED_FLOWS.md,
// decisions Q287-Q289): for a document, the next steps it can be followed
// by (only while something is left, and only for a user who may open and
// create in the next module) and its chain before and after it, each
// marked openable or not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });
const links = (module, id, uid) => call(uid || 'u-admin', 'getDocumentLinks', { module, id });
const nexts = r => r.next.map(n => n.module + ':' + n.from.type + ':' + n.from.id);
const chain = r => r.chain.map(c => c.relation + ' ' + c.module + ' ' + c.number);

test.beforeEach(async () => {
  const f = baseFixture();
  const posted = (extra) => Object.assign({ Status: 'Posted', CompanyID: 'C1' }, extra);
  f.customers = { CU1: { CustomerCode: 'CL-1', CustomerName: 'Example Buyer', Status: 'Active' } };
  f.salesOrders = {
    SO1: { SONumber: 'SO-1', SODate: '2026-10-01', Status: 'Partially Reserved', CompanyID: 'C1', CustomerID: 'CU1',
      Lines: [{ LineID: 'L1', ItemCode: 'RM-001', OrderedQuantity: 5, DeliveredQuantity: 2 }] },
    SO2: { SONumber: 'SO-2', SODate: '2026-10-02', Status: 'Reserved', CompanyID: 'C1', CustomerID: 'CU1',
      Lines: [{ LineID: 'L1', ItemCode: 'RM-001', OrderedQuantity: 1, DeliveredQuantity: 1 }] }
  };
  f.stock = {
    reservations: { R1: { Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'L1', ItemID: 'I1', WarehouseID: 'WH1', Quantity: 3, CompanyID: 'C1' } },
    transactions: {
      DN1: posted({ TransactionType: 'DeliveryNote', TransactionNumber: 'DN-1', TransactionDate: '2026-10-03', CustomerID: 'CU1', MatchedToInvoiceID: 'CI1', Lines: [{ SourceSOID: 'SO1', ItemCode: 'RM-001', Quantity: 2 }] }),
      DN2: posted({ TransactionType: 'DeliveryNote', TransactionNumber: 'DN-2', TransactionDate: '2026-10-04', CustomerID: 'CU1', Lines: [{ SourceSOID: 'SO2', ItemCode: 'RM-001', Quantity: 1 }] }),
      GRN1: posted({ TransactionType: 'GRN', TransactionNumber: 'GRN-1', TransactionDate: '2026-10-05', VendorID: 'V1', MatchedToInvoiceID: 'VI1', Lines: [{ SourcePOID: 'PO1', ItemCode: 'RM-001', Quantity: 4 }] })
    }
  };
  f.customerInvoices = {
    CI1: posted({ TransactionNumber: 'CI-1', InvoiceDate: '2026-10-06', CustomerID: 'CU1', Total: 100, SourceDeliveryNotes: [{ DeliveryNoteID: 'DN1' }] }),
    CI2: posted({ TransactionNumber: 'CI-2', InvoiceDate: '2026-10-07', CustomerID: 'CU1', Total: 50 })
  };
  f.purchaseRequisitions = { PR1: { PRNumber: 'PR-1', PRDate: '2026-09-28', Status: 'Submitted', CompanyID: 'C1' } };
  f.purchaseOrders = { PO1: { PONumber: 'PO-1', PODate: '2026-09-30', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1',
    Requisitions: [{ RequisitionType: 'PR', RequisitionID: 'PR1', RequisitionNumber: 'PR-1' }],
    Lines: [{ LineID: 'P1', ItemCode: 'RM-001', Quantity: 10, ReceivedQuantity: 4, SourceRequisitionType: 'PR', SourceRequisitionID: 'PR1' }] } };
  f.vendorInvoices = { VI1: posted({ TransactionNumber: 'VI-1', InvoiceDate: '2026-10-08', VendorID: 'V1', Total: 200, SourceGRNs: [{ GRNID: 'GRN1' }] }) };
  // The Viewer may open Delivery Notes but not create one; and may not open Cash and Bank.
  f.permissions.DELIVERYNOTE.access.push('Viewer');
  f.permissions.CBT.access = ['Admin'];
  await reset(f);
  const je = (id, number, refs, extra) => firestore.doc('journalEntries/' + id).set(Object.assign({ JVNumber: number, JVDate: '2026-10-09', Status: 'Posted', CompanyID: 'C1',
    VoucherType: 'Bank Receipt', AllocatedRefs: refs.map(r => r[0]), AllocatedRefTypes: refs.map(r => r[0].split(':')[0]),
    Lines: [{ LineNo: 1, Credit: refs.reduce((t, r) => t + r[1], 0), PartyType: 'Customer', PartyID: 'CU1', Allocations: refs.map(r => ({ RefType: 'Against', RefID: r[0], Amount: r[1] })) }] }, extra));
  await je('JE1', 'BR-1', [['CustomerInvoice:CI1', 60]]);
  await je('JE2', 'BR-2', [['CustomerInvoice:CI2', 50]]);
  await je('JE3', 'BR-3', [['CustomerInvoice:CI1', 40]], { ReversedByJV: 'JE9' }); // reversed: settles nothing
});

test('sales: what is left is offered; the chain both ways; a receipt for what is still open', async () => {
  let r = await links('SALESORDER', 'SO1');
  assert.deepEqual(nexts(r), ['DELIVERYNOTE:SalesOrder:SO1'], 'stock reserved for 3 still to deliver; no direct invoice: the company setting is off');
  assert.deepEqual(chain(r), ['after DELIVERYNOTE DN-1', 'after CUSTOMERINVOICE CI-1']);
  assert.deepEqual(nexts(await links('SALESORDER', 'SO2')), [], 'all delivered');
  r = await links('DELIVERYNOTE', 'DN1');
  assert.deepEqual([nexts(r), chain(r)], [[], ['before SALESORDER SO-1', 'after CUSTOMERINVOICE CI-1']], 'already invoiced');
  assert.deepEqual(nexts(await links('DELIVERYNOTE', 'DN2')), ['CUSTOMERINVOICE:DeliveryNote:DN2']);
  r = await links('CUSTOMERINVOICE', 'CI1');
  assert.deepEqual(nexts(r), ['CBT:CustomerInvoice:CI1', 'PDCRECEIVED:CustomerInvoice:CI1']);
  assert.deepEqual([r.outstanding, r.next[0].from.amount, r.next[0].from.voucherType], [40, 40, 'Bank Receipt'], 'the reversed receipt counts for nothing');
  assert.deepEqual(chain(r), ['before SALESORDER SO-1', 'before DELIVERYNOTE DN-1', 'after CBT BR-1']);
  assert.deepEqual(nexts(await links('CUSTOMERINVOICE', 'CI2')), [], 'paid');
  // The receipt: the invoice it settles.
  assert.deepEqual(chain(await links('CBT', 'JE1')), ['before CUSTOMERINVOICE CI-1']);
});

test('the direct invoice from an order, where the company allows it', async () => {
  await call('u-admin', 'saveInvoiceStockSettings', { companyId: 'C1', directStock: true });
  assert.deepEqual(nexts(await links('SALESORDER', 'SO1')), ['DELIVERYNOTE:SalesOrder:SO1', 'CUSTOMERINVOICE:SalesOrder:SO1']);
});

test('purchasing: requisition → order → receipt → invoice → payment', async () => {
  assert.deepEqual(nexts(await links('PURCHASEREQUISITION', 'PR1')), ['PURCHASEORDER:PR:PR1']);
  assert.deepEqual(chain(await links('PURCHASEREQUISITION', 'PR1')), ['after PURCHASEORDER PO-1']);
  let r = await links('PURCHASEORDER', 'PO1');
  assert.deepEqual(nexts(r), ['GRN:PurchaseOrder:PO1'], '6 still to receive');
  assert.deepEqual(chain(r), ['before PURCHASEREQUISITION PR-1', 'after GRN GRN-1', 'after VENDORINVOICE VI-1']);
  r = await links('GRN', 'GRN1');
  assert.deepEqual([nexts(r), chain(r)], [[], ['before PURCHASEORDER PO-1', 'after VENDORINVOICE VI-1']], 'already invoiced');
  r = await links('VENDORINVOICE', 'VI1');
  assert.deepEqual(nexts(r), ['CBT:VendorInvoice:VI1', 'PDCISSUED:VendorInvoice:VI1']);
  assert.equal(r.next[0].from.voucherType, 'Bank Payment');
  assert.deepEqual(chain(r), ['before PURCHASEORDER PO-1', 'before GRN GRN-1']);
});

test('rights: a next step only for who may open and create in it; the chain marked openable or not; another company refused', async () => {
  let r = await links('SALESORDER', 'SO1', 'u-viewer');
  assert.deepEqual(nexts(r), [], 'the Viewer may not create a Delivery Note');
  assert.deepEqual(r.chain.map(c => [c.module, c.canOpen]), [['DELIVERYNOTE', true], ['CUSTOMERINVOICE', true]]);
  r = await links('CUSTOMERINVOICE', 'CI1', 'u-viewer');
  assert.equal(r.chain.find(c => c.module === 'CBT').canOpen, false, 'no access to Cash and Bank');
  await assert.rejects(links('SALESORDER', 'NOPE'), /Sales Order not found/);
  await assert.rejects(links('STOCKLEDGER', 'X'), /No linked documents/);
  await assert.rejects(links('CUSTOMERINVOICE', 'CI1', 'u-other'), /access to that company/);
});
