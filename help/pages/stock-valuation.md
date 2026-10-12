---
title: Stock Valuation
area: inventory
order: 10
modules: [STOCKVALUATION]
sources: []
summary: Report current on-hand quantity and moving-average value by item/location, with optional rack consolidation.
reviewed: 2026-10-12
fingerprint: 16c6751152f66a04
---
## What it is for

**Stock Valuation Report** is a current snapshot of posted stock ledger quantity and value by item/location. It derives average cost as total ledger value divided by quantity and can show warehouse totals with their racks combined or each rack separately.

## Before you start

- Stock movements have been posted and the stock ledger reflects the period you intend to review.
- The user has Stock Valuation access to the selected company.
- Know whether reviewers need rack-level locations or warehouse totals.

## Step by step

1. Open Stock Valuation Report and choose the company.
2. Optionally filter by one of the fixed item categories.
3. Leave **Combine racks into their warehouse** checked for one total per warehouse, including its racks. Uncheck it to list each warehouse and rack separately.
4. Run the report. Review quantity, average cost, and total value by item and location, then check the grand total. Copy the table to Excel or print it for reconciliation.
5. Compare differences with the Stock Ledger and source receipts/issues/adjustments. This report is not date-filtered; use [Inventory Aging](inventory-aging.html) for an as-at date.

## What happens in the books

The report is read-only and does not post. It sums the current stock ledger quantities and values; Average Cost is Total Value ÷ Quantity. It is a current snapshot, not a historical as-at valuation.

## Rights

STOCKVALUATION **access** controls viewing, subject to company access.

## Questions and mistakes

- **Rack value appears under the warehouse:** rack consolidation is enabled; turn it off for separate location rows.
- **Quantity/value is zero or absent:** zero-quantity locations are omitted. Check the current stock ledger and posted transactions.
- **Average cost differs from a receipt price:** it is a moving-average ledger cost, not the most recent purchase price.
- **Need historical value:** this report shows the current ledger; use Inventory Aging for an as-at date and its age buckets.

## Related pages

[Stock Ledger](stock-ledger.html) · [Inventory Aging](inventory-aging.html) · [Inventory Valuation List](inventory-valuation.html)
