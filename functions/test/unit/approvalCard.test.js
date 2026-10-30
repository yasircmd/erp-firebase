// The approval card's logic (docs/modules/PHONE_VIEW.md, Q336): each
// module's decide function exists and takes the id the card sends; an
// invoice's reversal and a PO's reopening use their own functions; a Job
// Order line is the lowest undecided level's only; a document in short
// from the fields the modules use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../../src/approvalCard');

const SRC = path.join(__dirname, '../../src');
const allSource = [SRC, path.join(SRC, 'legacy')].flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(d, f), 'utf8'))).join('\n');

test('every decide function named exists, and reads the id the card sends', () => {
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-card';
  const index = require('../../index.js');
  const fns = new Set(Object.values(C.DECIDE).map(d => d.fn).concat(['decideCustomerInvoiceReversalApproval', 'decideVendorInvoiceReversalApproval', 'decidePurchaseOrderReopenApproval']));
  fns.forEach(fn => assert.equal(typeof index[fn], 'function', fn + ' is a deployed function'));
  for (const [mod, d] of Object.entries(C.DECIDE)) {
    if (d.positional) continue;
    // The id is read by name where the function is defined (exports.fn = ... d.<id> / { <id> }).
    const at = allSource.search(new RegExp('\\b' + d.fn + '\\b\\s*[:=]'));
    assert.ok(at >= 0, mod + ': ' + d.fn + ' defined');
    assert.match(allSource.slice(at, at + 3000), new RegExp('\\b' + d.id + '\\b'), mod + ': ' + d.fn + ' reads ' + d.id);
  }
});

test('the reversal of an invoice and a PO\'s reopening decide through their own functions; a richer decision has none', () => {
  assert.equal(C.decideOf('CUSTOMERINVOICE', { Status: 'PendingApproval' }).fn, 'decideCustomerInvoiceApproval');
  assert.equal(C.decideOf('CUSTOMERINVOICE', { Status: 'PendingReversalApproval' }).fn, 'decideCustomerInvoiceReversalApproval');
  assert.equal(C.decideOf('VENDORINVOICE', { Status: 'PendingReversalApproval' }).fn, 'decideVendorInvoiceReversalApproval');
  assert.equal(C.decideOf('PURCHASEORDER', { ReopenRequested: true }).fn, 'decidePurchaseOrderReopenApproval');
  assert.deepEqual(['JOBORDERREQUEST', 'REIMBURSEMENT', 'LEAVE_ABSENCE'].map(m => C.decideOf(m, {})), [null, null, null]);
});

test('my level: any undecided one of mine; a Job Order line only at the lowest undecided level', () => {
  const inst = (mod, decided) => ({ ModuleID: mod, RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'a' }, { LevelNumber: 2, ApproverUserID: 'b' }], Decisions: decided.map(n => ({ LevelNumber: n })) });
  assert.equal(C.myLevel(inst('GRN', []), 'b'), 2);
  assert.equal(C.myLevel(inst('JOBORDERREQUEST', []), 'b'), null, 'level 1 first');
  assert.equal(C.myLevel(inst('JOBORDERREQUEST', [1]), 'b'), 2);
  assert.equal(C.myLevel(inst('GRN', [2]), 'b'), null, 'decided');
});

test('a document in short: date, party, lines (journal debit less credit), more lines counted, the approval\'s amount when the document has none', () => {
  const lines = Array.from({ length: 17 }, (_, i) => ({ AccountName: 'Account ' + i, Debit: i ? 0 : 100, Credit: i ? 5 : 0 }));
  const s = C.summarize({ Amount: 80 }, { JVDate: '2026-10-05', Description: 'Accruals', Lines: lines, Status: 'PendingApproval' }, {});
  assert.deepEqual([s.Date, s.Description, s.Amount, s.Lines.length, s.MoreLines, s.Lines[0].Amount, s.Lines[1].Amount], ['2026-10-05', 'Accruals', 80, 15, 2, 100, -5]);
  const g = C.summarize({}, { TransactionDate: '2026-10-07', VendorID: 'V1', Lines: [{ ItemCode: 'RM-001', Quantity: 3, TotalValue: 60 }], Total: 60, CurrencyCode: 'USD' }, { V1: 'Example Supplies' });
  assert.deepEqual([g.Party, g.Amount, g.Currency, g.Lines[0]], ['Example Supplies', 60, 'USD', { Text: 'RM-001', Quantity: 3, Amount: 60 }]);
});
