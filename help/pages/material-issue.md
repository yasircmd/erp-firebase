---
title: Material Issue
area: inventory
order: 4
modules: [MATERIALISSUE]
sources: [functions/src/materialIssue.js, functions/src/stockMovement.js]
summary: Issue stock to a department or process and keep the warehouse quantity and cost records aligned.
reviewed: 2026-10-17
fingerprint: e2ef35864533cfe0
---
## What it is for

**Material Issue** records a stock **Issue** or a deliberate **Return** to a warehouse. It captures where material went/returned, the quantity, reason, and accounting dimensions; it does not automatically relieve components when a Production Entry is posted.

## Before you start

- The company, active item, warehouse, UOM, quantity, description, and date are known.
- For an Issue, sufficient stock is available at that warehouse; the posting cost comes from current average cost.
- For a Return, verify that the stock is physically coming back. Return cost is the current average cost, not necessarily the cost of the original issue.
- The item's Consumption account is valid; the transaction date is in an open period and approvals are configured if needed.

## Step by step

1. Open Material Issue and select **Issue** or **Return** deliberately. Issue is the default; Return is not inferred from a positive quantity.
2. Set the company, date, description, optional reference, and division/branch/cost/profit center dimensions.
3. Add lines by scanning/searching or pasting from Excel. Choose item, warehouse, description, base or configured alternate UOM, positive quantity, and optional batch reference and line cost/profit center.
4. Review the available quantity reference. Save as Draft if more review is needed; post only after checking direction and line detail.
5. If approval is configured, posting submits the document; stock and GL change only after approval. Rejected documents can be edited and resubmitted.
6. After posting, inspect GL Impact and the Stock Ledger. Reverse an incorrect posted entry through the reversal action with a reason; don't edit posted lines.

## What happens in the books

An **Issue** moves stock Out at current average cost, debits the item's Consumption account, and credits Inventory. A **Return** moves stock In at current average cost, debits Inventory, and credits Consumption. The line movement and GL are posted together; a reversal mirrors the original entry.

## Rights

MATERIALISSUE **access** controls viewing, **draft** creates/edits/deletes Draft or Rejected documents, and **post** submits/posts, approves/rejects where assigned, and reverses. Approval Configuration and company access apply.

## Questions and mistakes

- **Issue cannot post:** check available quantity at that warehouse, active reservations, item status, and the selected UOM conversion.
- **Return cannot post:** returns add stock but still need a positive current average cost; if stock is zero, establish a cost basis with GRN or Production first.
- **Return amount differs from original issue:** returns use current WAC and are not linked to a specific original issue.
- **Batch number is blank:** Material Issue stores a batch reference but does not require one even for batch-tracked items; follow the company's traceability procedure.
- **Approval is pending:** no inventory or GL posting occurs until approval completes.
- **Consumption account is invalid:** correct the item account in Item Master before posting.

## Related pages

[Production](production.html) · [Stock Availability](stock-availability.html) · [Stock Ledger](stock-ledger.html) · [Approvals](approvals.html)
