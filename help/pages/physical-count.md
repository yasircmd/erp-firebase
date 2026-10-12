---
title: Physical Count
area: inventory
order: 7
modules: [PHYSICALCOUNT]
sources: []
summary: Count stock physically and post the difference between the counted quantity and the system balance.
reviewed: 2026-10-12
fingerprint: 6369d9a8d879e034
---
## What it is for

**Physical / Cycle Count** records counted quantities for item/location lines, compares them with system quantities, and posts only the resulting differences. It supports Draft, approval, posting, GL review, and reversal like other stock documents.

## Before you start

- Define the count date, company, warehouse/rack coverage, and responsible count team.
- Confirm the item, UOM, batch number where applicable, and item Write-off account.
- The date is in an open period; Approval Configuration is set if variances require approval.
- Decide whether the count sheet is a full snapshot or only selected items; system quantity is shown as a reference, not a replacement for the physical count.

## Step by step

1. Create a Physical Count and select company, date, description, optional reference, and dimensions.
2. Add each counted item/location line by scanning/searching or pasting from Excel. Enter **Counted Quantity**, not the variance. Use the correct UOM and batch details.
3. Compare the count with the displayed System Qty and review the calculated variance for every line. Exact-match lines are allowed and have no GL impact.
4. Save as Draft, investigate material differences, then post. If approval is configured, the count remains pending and does not adjust stock until approved; rejected counts can be edited and resubmitted.
5. After posting, review the GL Impact and Stock Ledger. Reverse a posted count with a reason if it was wrong. A reversal entry cannot itself be reversed; enter a new count to correct that situation.

## What happens in the books

For each line, the system converts counted quantity to the item's base UOM and compares it with the ledger quantity. A positive variance increases inventory; a negative variance decreases it. The offset is the item's Write-off account (or Consumption fallback). Exact matches post no GL entry. Increases inherit current average cost; decreases remove stock at its current cost. The count records the movement and GL impact for audit.

## Rights

PHYSICALCOUNT **access** controls viewing, **draft** creates/edits/deletes Draft or Rejected counts, and **post** submits/posts, approves/rejects where assigned, and reverses. Company access and period locks apply.

## Questions and mistakes

- **Variance looks wrong:** confirm whether the entered value is counted quantity, the unit conversion, warehouse/rack, and batch.
- **No GL entry for the count:** if all counted quantities match system quantities, no variance journal is created.
- **Decrease is refused:** check available quantity and other stock movements dated in the same period.
- **Increase is refused at zero stock:** current average cost is required; establish cost with a GRN or Production before increasing through a count.
- **A reversal of a reversal is unavailable:** this is intentional; post a new count to correct stock instead.
- **Count cannot post:** check date/period lock, approval status, item account mapping, and whether the document is Draft or Rejected.

## Related pages

[Stock Adjustment](stock-adjustment.html) · [Stock Ledger](stock-ledger.html) · [Stock Valuation](stock-valuation.html) · [Approvals](approvals.html)
