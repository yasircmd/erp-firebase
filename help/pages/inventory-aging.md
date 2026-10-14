---
title: Inventory Aging
area: inventory
order: 12
modules: [INVENTORYAGING]
sources: [functions/src/agingReports.js]
summary: Age stock on hand by FIFO receipt layers as at a date, with value or quantity buckets by warehouse/category.
reviewed: 2026-10-14
fingerprint: d2865e4845851c2f
---
## What it is for

**Inventory Aging** reconstructs stock on hand as at a date, then ages it by receipt layer using first-in-first-out (FIFO). It reports six age buckets and can show either value or quantity, by warehouse/category and item.

## Before you start

- Posted stock transactions, including warehouse movements and reversals, are available through the as-at date.
- The user has Inventory Aging access for the selected company.
- The report's buckets are fixed: 0–30, 31–60, 61–90, 91–180, 181–365, and over 365 days.

## Step by step

1. Select company and **As at** date. Optionally narrow to a warehouse and item category.
2. Choose whether to include items with no stock. Search by item after the report loads.
3. Run the report and review on-hand quantity/value by age bucket, last receipt, and last issue. Toggle **Show quantities, not values** to switch the bucket columns from value to quantity.
4. Click an item code to open it in the [Stock Ledger](stock-ledger.html), from its oldest receipt still on hand to the as-at date. If the report is for one warehouse, the ledger runs at once; for all warehouses, choose the warehouse there. **Back to Inventory Aging** returns.
5. Copy or print the filtered report. Use the as-at date and warehouse/category scope shown in the report when sharing totals.
6. Investigate any warning that issues exceed receipts on record; that excess has no receipt layer/date to age.

## What happens in the books

This is a read-only report and creates no journal. It replays posted stock in date order, consumes the oldest receipt layers first, and carries those layers' dates through warehouse transfers. Reversed documents drop out when the reversal is also dated on or before the as-at date. The ledger stores moving-average value rather than per-receipt cost, so bucket values are allocated in proportion to bucket quantities.

## Rights

INVENTORYAGING **access** controls viewing, limited by company access.

## Questions and mistakes

- **Age differs from purchase invoice date:** age follows posted stock receipt layers, not vendor invoice date.
- **Transfer did not reset the age:** this is intentional; warehouse transfers preserve the original receipt dates.
- **Aging total differs from Stock Valuation:** compare the same as-at date and scope; Stock Valuation is a current snapshot, while this report reconstructs historical stock.
- **Some quantity has no age:** the report flags quantity issued beyond receipt history; investigate missing/legacy stock movements.
- **Value is not the original batch price:** valuation uses moving-average cost and distributes it over FIFO age quantities.

## Related pages

[Stock Valuation](stock-valuation.html) · [Stock Ledger](stock-ledger.html) · [Batch Expiry](batch-expiry.html)
