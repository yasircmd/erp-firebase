// The approval card on a phone (owner, 2026-10-30; docs/modules/
// PHONE_VIEW.md, Q336). New development, hand-written, pure: no reads.
//
// For an approval waiting on a user, the card shows the document in short
// (number, type, date, party, amount, its lines, who submitted, the
// decisions so far) and decides it through the module's OWN decide
// function, with that function's own checks: the card adds no way of
// approving that the full screen doesn't have.

// Each module's decide function and the name of its document's id there
// (the screens call them the same way). positional: the ported modules'
// (id, level, decision, reason). A module not here (a Job Order line, a
// reimbursement claim, an absence) has a richer decision than approve /
// reject: its card offers "Open the full document" only.
const DECIDE = {
  PURCHASEREQUISITION: { fn: 'decidePurchaseRequisitionApproval', id: 'prId' },
  INVENTORYPURCHASEREQUISITION: { fn: 'decideInventoryPurchaseRequisitionApproval', id: 'iprId' },
  JV: { fn: 'decideJournalEntryApproval', id: 'jvId' },
  CBT: { fn: 'decideJournalEntryApproval', id: 'jvId' },
  GRN: { fn: 'decideGrnApproval', id: 'grnId' },
  MATERIALISSUE: { fn: 'decideMaterialIssueApproval', id: 'miId' },
  PRODUCTION: { fn: 'decideProductionApproval', id: 'prodId' },
  STOCKADJUSTMENT: { fn: 'decideStockAdjustmentApproval', id: 'adjId' },
  WAREHOUSEMOVEMENT: { fn: 'decideWarehouseMovementApproval', id: 'moveId' },
  PHYSICALCOUNT: { fn: 'decidePhysicalCountApproval', id: 'pcId' },
  DELIVERYNOTE: { fn: 'decideDeliveryNoteApproval', id: 'dnId' },
  PURCHASERETURN: { fn: 'decidePurchaseReturnApproval', id: 'returnId' },
  SALESRETURN: { fn: 'decideSalesReturnApproval', id: 'returnId' },
  PDCRECEIVED: { fn: 'decidePdcApproval', id: 'pdcId' },
  PDCISSUED: { fn: 'decidePdcApproval', id: 'pdcId' },
  FAACQ: { fn: 'decideFaPostingApproval', id: 'postingId' },
  FAADDDEP: { fn: 'decideFaPostingApproval', id: 'postingId' },
  FARETIRE: { fn: 'decideFaPostingApproval', id: 'postingId' },
  FAAUC: { fn: 'decideFaPostingApproval', id: 'postingId' },
  RECURRINGJV: { fn: 'decideRecurringJournalApproval', id: 'templateId' },
  EMPCHANGE: { fn: 'decideEmployeeChangeApproval', id: 'changeId' },
  LEAVE: { fn: 'decideLeaveApproval', id: 'leaveId' },
  PAYROLL: { fn: 'decidePayrollApproval', id: 'runId' },
  PAYROLLLOAN: { fn: 'decideLoanApproval', id: 'loanId' },
  PAYROLLFS: { fn: 'decideSettlementApproval', id: 'settlementId' },
  PAYROLLIP: { fn: 'decideInterimApproval', id: 'interimId' },
  PURCHASEORDER: { fn: 'decidePurchaseOrderApproval', positional: true },
  VENDORINVOICE: { fn: 'decideVendorInvoiceApproval', positional: true },
  CUSTOMERINVOICE: { fn: 'decideCustomerInvoiceApproval', positional: true }
};

// The decide call for an approval, or null (open the full document). A
// reversal of an invoice and a PO's reopening have their own functions,
// told by the document's state, as their screens tell them.
function decideOf(moduleId, doc) {
  const d = DECIDE[moduleId];
  if (!d) return null;
  const s = doc || {};
  if ((moduleId === 'CUSTOMERINVOICE' || moduleId === 'VENDORINVOICE') && s.Status === 'PendingReversalApproval') {
    return Object.assign({}, d, { fn: moduleId === 'CUSTOMERINVOICE' ? 'decideCustomerInvoiceReversalApproval' : 'decideVendorInvoiceReversalApproval' });
  }
  if (moduleId === 'PURCHASEORDER' && s.ReopenRequested) return Object.assign({}, d, { fn: 'decidePurchaseOrderReopenApproval' });
  return Object.assign({}, d);
}

// The undecided level of this approval that is the user's, or null (the
// rule Home's task list uses: a Job Order line acts level by level).
function myLevel(inst, uid) {
  const decided = new Set((inst.Decisions || []).map(d => d.LevelNumber));
  const open = (inst.RequiredLevels || []).filter(l => !decided.has(l.LevelNumber)).sort((a, b) => a.LevelNumber - b.LevelNumber);
  const mine = inst.ModuleID === 'JOBORDERREQUEST' ? open.slice(0, 1) : open;
  const hit = mine.find(l => l.ApproverUserID === uid);
  return hit ? hit.LevelNumber : null;
}

const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const first = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return ''; };
const AMOUNT_FIELDS = ['Total', 'NetPay', 'TotalNet', 'Amount', 'LoanAmount', 'Days'];
const listOf = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter(Boolean);

// A document in short, whatever its module: its date, party, description
// and up to 15 lines (what, quantity, amount), from the fields the
// modules use; what a module doesn't have stays empty.
function summarize(inst, doc, names) {
  const d = doc || {};
  const n = names || {};
  const date = String(first(d, ['InvoiceDate', 'TransactionDate', 'PODate', 'PRDate', 'IPRDate', 'JVDate', 'Date', 'ChequeDate', 'EffectiveDate', 'StartDate', 'FromDate', 'RequestDate', 'Period', 'Month'])).slice(0, 10);
  const partyId = first(d, ['CustomerID', 'VendorID', 'EmployeeID', 'PartyID']);
  const party = n[partyId] || first(d, ['CustomerName', 'VendorName', 'EmployeeName', 'PartyName', 'PayeeName', 'DrawerName']) || '';
  const lines = [].concat(listOf(d.Lines), listOf(d.ItemLines), listOf(d.DirectLines), listOf(d.NonStockLines))
    .slice(0, 15).map(l => {
      const debit = num(l.Debit), credit = num(l.Credit);
      return {
        Text: String(first(l, ['ItemName', 'ItemCode', 'Description', 'AccountName', 'AccountCode', 'Category', 'Type', 'Name']) || '').slice(0, 80),
        Quantity: num(first(l, ['Quantity', 'OrderedQuantity', 'Days'])),
        Amount: debit || credit ? Math.round(((debit || 0) - (credit || 0)) * 100) / 100 : num(first(l, ['Amount', 'LineTotal', 'TotalValue', 'Total', 'Value']))
      };
    });
  const lineCount = [].concat(listOf(d.Lines), listOf(d.ItemLines), listOf(d.DirectLines), listOf(d.NonStockLines)).length;
  return {
    Date: date, Party: party, Description: String(first(d, ['Description', 'Notes', 'Reason', 'Remarks', 'Purpose'])).slice(0, 300),
    // In the document's own currency (Currency below); the approval's own amount when the document has none.
    Amount: num(first(d, AMOUNT_FIELDS)) !== null ? num(first(d, AMOUNT_FIELDS)) : num(inst.Amount),
    // A PO keeps its currency as Currency.
    Currency: d.CurrencyCode || d.Currency || '', Status: d.Status || '', Lines: lines, MoreLines: Math.max(0, lineCount - lines.length)
  };
}

module.exports = { DECIDE, decideOf, myLevel, summarize };
