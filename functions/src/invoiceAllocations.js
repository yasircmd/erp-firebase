// Vendor/Customer Invoice callables that bill-wise allocation touches
// (docs/modules/PARTY_PAYMENTS.md). Each wraps the generated function of
// the same name in legacy/codegs.js, which stays unchanged (the
// generator's keep list, tools/legacy-port/keep.json, keeps emitting it):
//   - the list gains Outstanding, PaymentStatus and DueDate per invoice
//   - a reversal (request, or an Approve of a pending reversal) is refused
//     while a live JV/CBT entry allocates against the invoice. The check
//     runs under the global lock, which the wrapped function re-enters,
//     so no allocation can be posted between the check and the reversal.
//   - it's also refused while a posted Purchase/Sales Return is raised
//     against the invoice (docs/modules/PURCHASE_RETURN.md): the goods and
//     the note would otherwise outlive the bill they came from.
'use strict';
const { onCallWithMessages } = require('./callable');
const { run, LockService } = require('./legacy/runtime');
const L = require('./legacy/codegs');
const { assertInvoiceHasNoAllocations, annotateInvoiceOutstanding } = require('./partyLedger');
const { hasLiveReturns } = require('./returns');

function withEntries(invoiceType, fn) {
  return async (ctx, limit) => {
    const result = await fn(ctx, limit);
    await annotateInvoiceOutstanding(invoiceType, result.entries);
    return result;
  };
}

// The generated functions report failure as { success: false, error },
// so these do too.
function guardedReversal(invoiceType, fn, isDecision) {
  return async (ctx, invoiceId, ...rest) => {
    const lock = LockService.getScriptLock();
    await lock.waitLock(10000);
    try {
      const approving = !isDecision || rest[1] === 'Approved';
      if (approving) {
        if (await hasLiveReturns(invoiceType, invoiceId)) {
          return { success: false, error: 'This invoice has a posted return (debit/credit note) against it — reverse that first.' };
        }
        try { await assertInvoiceHasNoAllocations(invoiceType, invoiceId); }
        catch (err) { return { success: false, error: err.message }; }
      }
      return await fn(ctx, invoiceId, ...rest);
    } finally {
      await lock.releaseLock();
    }
  };
}

const opts = { region: 'us-central1' };
function callable(fn, names) {
  return onCallWithMessages(opts, (request) => {
    const d = request.data || {};
    const a = Array.isArray(d.__positional) ? d.__positional : names.map(k => d[k]);
    return run(request, (ctx) => fn(ctx, ...a));
  });
}

exports.getVendorInvoiceEntries = callable(withEntries('VendorInvoice', L.getVendorInvoiceEntries), ['limit']);
exports.getCustomerInvoiceEntries = callable(withEntries('CustomerInvoice', L.getCustomerInvoiceEntries), ['limit']);
exports.requestReverseVendorInvoice = callable(
  guardedReversal('VendorInvoice', L.requestReverseVendorInvoice, false), ['invoiceId', 'reversalDate']);
exports.decideVendorInvoiceReversalApproval = callable(
  guardedReversal('VendorInvoice', L.decideVendorInvoiceReversalApproval, true), ['invoiceId', 'levelNumber', 'decision', 'reason']);
exports.requestReverseCustomerInvoice = callable(
  guardedReversal('CustomerInvoice', L.requestReverseCustomerInvoice, false), ['invoiceId', 'reversalDate']);
exports.decideCustomerInvoiceReversalApproval = callable(
  guardedReversal('CustomerInvoice', L.decideCustomerInvoiceReversalApproval, true), ['invoiceId', 'levelNumber', 'decision', 'reason']);
