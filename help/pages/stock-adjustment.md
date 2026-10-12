---
title: Stock Adjustment
area: inventory
order: 6
modules: [STOCKADJUSTMENT]
sources: [functions/src/stockAdjustment.js]
summary: Correct the item quantity or value after a count, loss, damage or writing off stock.
reviewed: 2026-10-12
fingerprint: 63250ff9a51ae798
---
## What it is for

**Stock Adjustment** is a controlled inventory transaction for increasing or decreasing a warehouse/rack quantity when a documented correction is needed. It carries a date, reason, reference, dimensions, and lines, and may require approval before stock and accounting are changed.

## Before you start

- The physical count, damage/loss, write-off, or other adjustment reason is documented.
- The item and warehouse/rack are active for the company; batch-tracked items have batch details.
- The item's Write-off account (or configured Consumption fallback) is valid for posting.
- The transaction date is in an open period, and Approval Configuration is set if this adjustment type is gated.

## Step by step

1. Open Stock Adjustment and create a document. Select company, date, description, optional reference, and default division/branch/cost/profit-center dimensions.
2. Add each item line by scanning/searching or pasting from Excel. Choose **Increase** or **Decrease**, warehouse/rack, line description, UOM, quantity, batch number where required, and line cost/profit center where applicable.
3. Check the available quantity shown for reference. An increase inherits the item's current average cost; it cannot establish an initial cost when the item has zero current stock. Use a GRN or Production Entry to establish cost first.
4. Save as Draft if needed. Post the document when the lines, direction, quantities, batches, date, reference, and reason have been checked.
5. If Approval Configuration applies, posting submits it for approval. The approver approves or rejects; rejected documents can be corrected and posted again. Approved/postable documents update inventory and GL.
6. Review the posted document's GL Impact and the Stock Ledger. Reverse a posted adjustment through its reversal action with a reason; do not edit its posted lines.

## What happens in the books

An Increase adds inventory at current average cost; a Decrease removes it at the applicable stock cost. The inventory account is offset against the item's Write-off account (or Consumption account fallback): decreases debit the offset and credit inventory; increases debit inventory and credit the offset. The document creates stock transactions and a GL journal. An increase can also allocate newly available stock to open Sales Order shortfalls.

## Rights

STOCKADJUSTMENT **access** controls viewing, **draft** creates/edits/deletes Draft or Rejected documents, and **post** submits/posts, approves/rejects where assigned, and reverses. Approval levels are controlled through Approval Configuration; company access applies.

## Questions and mistakes

- **Increase cannot post:** this item has zero stock and therefore no average cost to inherit; establish stock/cost with GRN or Production first.
- **Line is rejected:** confirm the item, warehouse/rack, UOM conversion, positive quantity, required description, and batch number for batch-tracked items.
- **Decrease exceeds stock:** check the item's available quantity in that warehouse and any other posted movements before changing the count.
- **Approval is pending:** no stock or GL change occurs until approval.
- **GL offset account is missing:** set the item's Write-off or Consumption account in Item Master.
- **Period is closed:** use an allowed open date or follow the Period Closing reopen/adjustment process; do not backdate into a locked month.

## Related pages

[Item Master](item-master.html) · [Stock Ledger](stock-ledger.html) · [Physical Count](physical-count.html) · [Goods Receipt Note](goods-receipt-note.html) · [Approvals](approvals.html)
