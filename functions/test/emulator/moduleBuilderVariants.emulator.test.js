// Module Builder, phase 4 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q481-Q488): variants of the five ERP documents, on the original's own code.
// A clerk with only the variant's rights makes, lists, opens and posts only the
// variant's documents (Q484, Q486), never the original's; the variant's own
// number series (Q482) and approvals (Q485); its extra fields checked and kept
// (Q483); someone with the original's rights sees every document; a variant
// named that isn't published is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.ok(r && r.success !== false, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error || (r.x && r.x.success === false), 'expected a refusal: ' + JSON.stringify(r.x)); return r.error || r.x.error; };
const D = new Date().toISOString().slice(0, 10);

const VARIANTS = {
  X_RINV: { id: 'X_RINV', label: 'Room Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'RINV' }, labels: { customer: 'Guest' }, hidden: ['division'],
    fields: [{ key: 'room', label: 'Room', type: 'text', required: true }, { key: 'nights', label: 'Nights', type: 'number' }] },
  X_UTIL: { id: 'X_UTIL', label: 'Utility Bill', kind: 'variant', base: 'VENDORINVOICE', numbering: { prefix: 'UTIL' } },
  X_ACCR: { id: 'X_ACCR', label: 'Accrual', kind: 'variant', base: 'JV', numbering: { prefix: 'ACR' } },
  X_EVO: { id: 'X_EVO', label: 'Event Order', kind: 'variant', base: 'SALESORDER', numbering: { prefix: 'EVO' } },
  X_TQ: { id: 'X_TQ', label: 'Tour Quote', kind: 'variant', base: 'QUOTATION', numbering: { prefix: 'TQ' } }
};

function fixture() {
  const f = baseFixture();
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Front Desk', AssignedCompanies: ['C1'] };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Example Guest LLC', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail' } };
  f.salesTypes = { ST1: { Name: 'Rooms', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Utilities', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.currencies = { CUR1: { Code: 'AED', Name: 'Dirham', Symbol: 'AED', IsDefault: true, Status: 'Active' } };
  // The clerk: each variant's rights, none of the originals'.
  Object.keys(VARIANTS).forEach(id => { f.permissions[id] = { access: ['Admin', 'Clerk'], draft: ['Admin', 'Clerk'], post: ['Admin', 'Clerk'], write: ['Admin', 'Clerk'], taxcode: ['Admin'] }; });
  return f;
}
async function publish(def) {
  const s = await call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }).catch(e => (/already exists/.test(e.message) ? call('u-admin', 'saveModuleDefinitionDraft', { definition: def }) : Promise.reject(e)));
  ok(s);
  return ok(await call('u-admin', 'publishModuleDefinition', { id: def.id }));
}
const ci = (uid, extra, variant) => call(uid, 'saveCustomerInvoiceDraft', Object.assign({ invoiceData: Object.assign({ InvoiceDate: D, Description: 'Stay', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
  SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 300, Description: 'Two nights', SalesTypeID: 'ST1' }] }, extra || {}) }, variant || {}));
const RINV = fields => ({ __variant: 'X_RINV', __variantFields: fields || { room: '101', nights: 2 } });

test('the builder: a variant checked and published; its prefix its own', async () => {
  await reset(fixture());
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: Object.assign({}, VARIANTS.X_RINV, { id: 'X_BAD', hidden: ['customer'] }) })), /Customer is required/);
  await publish(VARIANTS.X_RINV);
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: Object.assign({}, VARIANTS.X_UTIL, { numbering: { prefix: 'RINV' } }) })), /RINV is the variant Room Invoice's/);
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: Object.assign({}, VARIANTS.X_UTIL, { numbering: { prefix: 'PO' } }) })), /PO is Purchase Order's numbering/);
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { definition: Object.assign({}, VARIANTS.X_RINV, { numbering: { prefix: 'ROOM' } }) })), /keeps its numbering prefix/);
  const reg = await call('u-admin', 'getModuleRegistry', {});
  const list = Array.isArray(reg) ? reg : (reg.modules || reg.registry || []);
  assert.ok(list.some(m => (m.id || m.ModuleID) === 'X_RINV'), 'its own module');
});

test('a Customer Invoice variant: the clerk\'s rights for one request, its documents only, its series, its fields', async () => {
  await reset(fixture());
  await publish(VARIANTS.X_RINV);
  // The clerk has no Customer Invoice rights of their own.
  assert.match(await refused(ci('u-clerk')), /permission/i);
  assert.match(await refused(ci('u-clerk', {}, { __variant: 'X_NOPE' })), /Unknown variant/);
  assert.match(await refused(ci('u-clerk', {}, RINV({ nights: 2 }))), /Room is required/, 'its extra fields are checked');
  const mine = ok(await ci('u-clerk', {}, RINV()));
  const base = ok(await ci('u-admin'));
  const m = await val('customerInvoices/' + mine.invoiceId);
  assert.deepEqual([m.Variant, m.VariantFields], ['X_RINV', { room: '101', nights: 2 }]);
  assert.equal((await val('customerInvoices/' + base.invoiceId)).Variant, undefined, 'the original\'s own invoice is not a variant\'s');
  // Lists: the clerk sees only Room Invoices; the original's screen sees both.
  const clerkList = await call('u-clerk', 'getCustomerInvoiceEntries', { limit: 'all', __variant: 'X_RINV' });
  assert.deepEqual(clerkList.entries.map(e => e.CustomerInvoiceID), [mine.invoiceId]);
  const all = await call('u-admin', 'getCustomerInvoiceEntries', { limit: 'all' });
  assert.deepEqual(all.entries.map(e => e.CustomerInvoiceID).sort(), [mine.invoiceId, base.invoiceId].sort());
  // The clerk can't post, change or delete the original's invoice through the variant.
  assert.match(await refused(call('u-clerk', 'postCustomerInvoice', { invoiceId: base.invoiceId, __variant: 'X_RINV' })), /not found|not a Room Invoice/i);
  assert.match(await refused(ci('u-clerk', { CustomerInvoiceID: base.invoiceId }, RINV())), /not found|not a Room Invoice/i);
  assert.match(await refused(call('u-clerk', 'deleteCustomerInvoiceDraft', { invoiceId: base.invoiceId, __variant: 'X_RINV' })), /not found|not a Room Invoice/i);
  assert.equal((await val('customerInvoices/' + base.invoiceId)).Status, 'Draft');
  // Posted in its own series; the original's keeps its own.
  const p = ok(await call('u-clerk', 'postCustomerInvoice', { invoiceId: mine.invoiceId, __variant: 'X_RINV' }));
  assert.match(p.invoiceNumber, /^RINV-/);
  const pb = ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: base.invoiceId }));
  assert.doesNotMatch(pb.invoiceNumber, /^RINV/);
  // A Room Invoice posted from the Customer Invoice screen (the original's rights, Q486) still takes its own series (Q482).
  const other = ok(await ci('u-clerk', {}, RINV({ room: '305' })));
  assert.match(ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: other.invoiceId })).invoiceNumber, /^RINV-/);
  // Kept with the original's: the customer's statement and ageing see both.
  const posted = await val('customerInvoices/' + mine.invoiceId);
  assert.deepEqual([posted.Status, posted.Variant, posted.VariantFields.room], ['Posted', 'X_RINV', '101']);
});

test('a variant\'s own approvals: its own Approval Configuration row, its tasks on the variant', async () => {
  await reset(fixture());
  await publish(VARIANTS.X_RINV);
  await rtdb.ref('approvalConfigurations/X_RINV').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/X_RINV/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-admin', ThresholdAmount: 0 }] });
  const s = ok(await ci('u-clerk', {}, RINV()));
  const p = ok(await call('u-clerk', 'postCustomerInvoice', { invoiceId: s.invoiceId, __variant: 'X_RINV' }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  if (p.status === 'PendingApproval') {
    const inst = (await firestore.collection('approvalInstances').doc(inv.ApprovalInstanceID).get()).data() || (await val('approvalInstances/' + inv.ApprovalInstanceID));
    assert.equal(inst.ModuleID, 'X_RINV');
    ok(await call('u-admin', 'decideCustomerInvoiceApproval', { invoiceId: s.invoiceId, levelNumber: 1, decision: 'Approved', reason: '', __variant: 'X_RINV' }));
    assert.equal((await val('customerInvoices/' + s.invoiceId)).Status, 'Posted');
  } else {
    assert.fail('expected the Room Invoice approvers to be asked: ' + JSON.stringify(p) + ' (check the approval configuration shape)');
  }
  // Posted from the Customer Invoice screen, a Room Invoice still asks the Room Invoice approvers (Q485).
  const s2 = ok(await ci('u-clerk', {}, RINV({ room: '306' })));
  assert.equal(ok(await call('u-approver', 'postCustomerInvoice', { invoiceId: s2.invoiceId })).status, 'PendingApproval');
  const inst2 = (await firestore.collection('approvalInstances').doc((await val('customerInvoices/' + s2.invoiceId)).ApprovalInstanceID).get()).data();
  assert.equal(inst2.ModuleID, 'X_RINV', 'its task opens the Room Invoice');
  // The original's approvals are untouched: a plain invoice posts straight away.
  const b = ok(await ci('u-admin'));
  assert.equal(ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: b.invoiceId })).status, 'Posted');
});

test('Vendor Invoice, Journal, Sales Order and Quotation variants: their own documents and series', async () => {
  await reset(fixture());
  for (const id of ['X_UTIL', 'X_ACCR', 'X_EVO', 'X_TQ']) await publish(VARIANTS[id]);
  // Vendor Invoice.
  const vi = ok(await call('u-clerk', 'saveVendorInvoiceDraft', { __variant: 'X_UTIL', invoiceData: { InvoiceDate: D, Description: 'Power', VendorRefNumber: 'DEWA-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6000', Amount: 80, Description: 'Power', CostCenterID: 'CC1' }] } }));
  assert.equal((await val('vendorInvoices/' + vi.invoiceId)).Variant, 'X_UTIL');
  assert.match(ok(await call('u-clerk', 'postVendorInvoice', { invoiceId: vi.invoiceId, __variant: 'X_UTIL' })).invoiceNumber || '', /^UTIL-/);
  assert.deepEqual((await call('u-clerk', 'getVendorInvoiceEntries', { limit: 'all', __variant: 'X_UTIL' })).entries.map(e => e.VendorInvoiceID), [vi.invoiceId]);
  // Journal Entry.
  const L = (code, dr, cr, o) => Object.assign({ AccountCode: code, Debit: dr, Credit: cr, Description: 'Accrual' }, o);
  const jvData = { JVDate: D, Description: 'Month-end accrual', Reference: 'A1', CompanyID: 'C1', CurrencyCode: 'AED', Lines: [L('6000', 50, 0, { CostCenterID: 'CC1' }), L('3000', 0, 50)] };
  const jv = ok(await call('u-clerk', 'saveJournalDraft', { __variant: 'X_ACCR', jvData }));
  const plain = ok(await call('u-admin', 'saveJournalDraft', { jvData }));
  assert.equal((await firestore.collection('journalEntries').doc(jv.jvId).get()).data().Variant, 'X_ACCR');
  assert.match(await refused(call('u-clerk', 'postJournalEntry', { jvId: plain.jvId, __variant: 'X_ACCR' })), /not found|not a/i);
  assert.match(ok(await call('u-clerk', 'postJournalEntry', { jvId: jv.jvId, __variant: 'X_ACCR' })).jvNumber, /^ACR-/);
  const jl = await call('u-clerk', 'getJournalEntries', { limit: 100, __variant: 'X_ACCR' });
  const rows = jl.entries || jl.rows || jl.items || jl;
  assert.ok(Array.isArray(rows) && rows.every(r => (r.JVID || r._id || r.id) !== plain.jvId) && rows.some(r => (r.JVID || r._id || r.id) === jv.jvId), JSON.stringify(jl).slice(0, 300));
  // Sales Order: the order is the variant's; the clerk lists only theirs.
  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 10, AvgCost: 5, TotalValue: 50 });
  const so = ok(await call('u-clerk', 'saveDraftSalesOrder', { __variant: 'X_EVO', header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 1, UnitPrice: 12 }] } }));
  const soId = so.soId || so.salesOrderId || so.id;
  assert.equal((await val('salesOrders/' + soId)).Variant, 'X_EVO');
  const sol = await call('u-clerk', 'getSalesOrderEntries', { __variant: 'X_EVO' });
  assert.deepEqual((sol.entries || []).map(e => e.SalesOrderID || e.SOID), [soId]);
  // Quotation: numbered in its own series.
  const q = ok(await call('u-clerk', 'saveQuotation', { __variant: 'X_TQ', quotation: { CompanyID: 'C1', CustomerID: 'CU1', QuoteDate: D, ValidUntil: D, Lines: [{ ItemCode: 'RM-001', Quantity: 1, UnitPrice: 5 }] } }));
  assert.match(q.number, /^TQ-/);
  assert.equal((await firestore.collection('quotations').doc(q.quotationId).get()).data().Variant, 'X_TQ');
});
