---
title: Production Entry
area: production
order: 3
modules: [PRODUCTION]
sources: [functions/src/stockMovement.js]
summary: Record produced output into stock and post its assigned inventory/consumption accounting; component issue remains separate.
reviewed: 2026-10-30
fingerprint: dbf381063c5e22c9
---
## What it is for

**Production Entry** records finished output entering stock. It can optionally link to a submitted Job Order batch so produced quantities fulfil its matching lines. It does not consume BOM components; record actual component issues separately in Material Issue.

## Before you start

- The output item, warehouse, positive quantity, unit cost, and applicable batch/expiry information are confirmed.
- Item Master has a valid Consumption account; the item and UOM are active and belong to the selected company.
- If linking a Job Order, the batch is Submitted, belongs to the same company, and its matching line is eligible for production progress.
- The posting date is open and Production approval is configured if required.

## Step by step

1. Open Production Entry and create a document. Choose company, date, description, optional reference, dimensions, and optional submitted Job Order batch.
2. Add each produced item, warehouse, description, UOM, quantity, positive unit cost, batch/expiry when relevant, and cost/profit center. The cost can be entered or populated from the effective production unit-cost list.
3. Review line totals and output quantities. Check that the Job Order is still Submitted and has eligible lines for the output item; at posting the system matches by item code and updates the corresponding line progress.
4. Save as Draft and post. If approval is configured, the entry remains pending and stock/GL/job progress do not change until final approval. A rejected entry is editable and can be resubmitted.
5. After posting, check the finished item's warehouse balance, GL Impact, Job Order progress if linked, and any Sales Order shortfalls allocated from newly available stock. Reverse with a reason if the output entry is wrong.

## What happens in the books

Each production line posts an inbound stock movement at its entered unit cost and a GL journal: debit inventory and credit the item's Consumption account. The line quantity/value are stored for stock reports. Components are not relieved from the BOM automatically; Material Issue posts their actual consumption separately. Reversal cancels the output and corresponding GL impact.

## Rights

PRODUCTION **access** controls viewing; **draft** creates/edits/deletes Draft or Rejected entries; **post** submits/posts, approves/rejects where assigned, and reverses. Company access applies.

## Questions and mistakes

- **Expected components were not deducted:** Production records output only. Enter actual component use in Material Issue.
- **A posted entry's Job Order shows "no longer open for production":** its lines are complete (often by this very entry). It stays linked; it is only no longer offered for new entries.
- **Job Order progress did not update:** check the selected batch and eligible matching item lines; progress updates only after the production commit succeeds.
- **Cost/account error:** use a positive unit cost, verify the item's Consumption account, and ensure the inventory account is configured.
- **Batch-tracked output rejected:** enter a batch number and valid expiry where the item requires it.
- **Approval is pending:** no stock, GL, Job Order progress, or order allocation changes until approved.
- **Output does not appear in availability:** check company, warehouse, posted status, and any later reversal.

## Related pages

[Bill of Materials](bill-of-materials.html) · [Material Issue](material-issue.html) · [Job Order Request](job-order-request.html) · [Inventory Valuation List](inventory-valuation.html) · [Material Variance](material-variance.html)
