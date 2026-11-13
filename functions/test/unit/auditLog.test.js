// The audit log (docs/modules/AUDIT_LOG.md, step 1): append-only through one
// writer, and how a request is read as an action, a module and a record.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const audit = require('../../src/audit');

const SRC = path.join(__dirname, '../../src');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);

test('only audit.js writes the audit log (append-only through one writer)', () => {
  const writers = files(SRC).filter(f => !f.endsWith(path.sep + 'audit.js'))
    .filter(f => /['"`]auditLog['"`]/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(SRC, f));
  assert.deepEqual(writers, []);
  const src = fs.readFileSync(path.join(SRC, 'audit.js'), 'utf8');
  assert.ok(!/\.update\(|\.delete\(/.test(src), 'audit.js never updates or deletes an entry');
});

test('the action of a request, from its name; reads and sign-in are not actions (QA1)', () => {
  const cases = {
    saveGrnDraft: 'save', postGrn: 'post', submitPurchaseOrder: 'submit', reverseVendorInvoice: 'reverse',
    deleteDraftPurchaseOrder: 'delete', cancelSalesOrder: 'cancel', closeInventoryPurchaseRequisition: 'close',
    saveDeveloperLimits: 'save', runMasterImport: 'run', getActiveCompanies: null, getMyPendingApprovalLevel: null,
    listThings: null, completeLogin: null, corporateSignIn: null, essPortal: null, testDeveloperCorporate: null
  };
  Object.entries(cases).forEach(([fn, want]) => assert.equal(audit.actionOf(fn, {}), want, fn));
  assert.equal(audit.actionOf('decidePurchaseOrderApproval', { decision: 'Approved' }), 'approve');
  assert.equal(audit.actionOf('decidePurchaseOrderApproval', { decision: 'Rejected' }), 'reject');
  assert.equal(audit.actionOf('decideJournalApproval', { __positional: ['J1', 1, 'Rejected', 'no'] }), 'reject');
});

test('the module: the longest module id or alias in the name', () => {
  assert.equal(audit.moduleOf('decideInventoryPurchaseRequisitionApproval'), 'INVENTORYPURCHASEREQUISITION');
  assert.equal(audit.moduleOf('submitPurchaseRequisition'), 'PURCHASEREQUISITION');
  assert.equal(audit.moduleOf('postGrn'), 'GRN');
  assert.equal(audit.moduleOf('saveJournalDraft'), 'JV');
  assert.equal(audit.moduleOf('saveFirebaseUser'), 'USERMGMT');
  assert.equal(audit.moduleOf('somethingElse'), '');
});

test('the record: a new document\'s id from the answer, else the one sent; dimensions are not records', () => {
  assert.equal(audit.recordIdOf({ CompanyID: 'C1' }, { success: true, grnId: 'GRND-1' }), 'GRND-1');
  assert.equal(audit.recordIdOf({ poId: 'PO-9', companyId: 'C1' }, { success: true }), 'PO-9');
  assert.equal(audit.recordIdOf({ __positional: ['IPR-3', 1, 'Approved'] }, {}), 'IPR-3');
  assert.equal(audit.recordIdOf({ header: { CompanyID: 'C1', IPRID: 'IPR-4' } }, {}), 'IPR-4');
  assert.equal(audit.recordIdOf({ CompanyID: 'C1', CostCenterID: 'CC1' }, { success: true }), '');
});

test('refusals kept for rights and limits only (QA4); other failures are not recorded', () => {
  assert.match(audit.refusalOf({ code: 'permission-denied', message: 'You do not have permission to change GRN.' }), /permission/);
  assert.match(audit.refusalOf(null, { success: false, error: 'Your subscription allows 3 active users, and all are in use.' }), /subscription/);
  assert.equal(audit.refusalOf(null, { success: false, error: 'Transaction date is required.' }), '');
  assert.equal(audit.refusalOf(null, { success: true }), null);
});

test('a document: created, deleted or a status change, with its number and total; an edit with the same status adds nothing', () => {
  const draft = { Status: 'Draft', TransactionNumber: '', GrandTotal: 120, CurrencyCode: 'AED', CompanyID: 'C1' };
  const posted = Object.assign({}, draft, { Status: 'Posted', TransactionNumber: 'GRN-26-000001' });
  assert.deepEqual(audit.documentEntry('stock transaction', 'G1', null, draft).Action, 'create');
  const e = audit.documentEntry('stock transaction', 'G1', draft, posted);
  assert.deepEqual([e.Action, e.RecordLabel, e.Totals.Status, e.Totals.Amount, e.Totals.Currency], ['status', 'GRN-26-000001', 'Draft → Posted', 120, 'AED']);
  assert.equal(audit.documentEntry('stock transaction', 'G1', posted, null).Action, 'delete');
  assert.equal(audit.documentEntry('stock transaction', 'G1', draft, Object.assign({}, draft, { Description: 'x' })), null);
});
