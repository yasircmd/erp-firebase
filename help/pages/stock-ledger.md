---
title: Stock Ledger
area: inventory
order: 9
modules: [STOCKLEDGER]
sources: [functions/src/stockMovement.js]
summary: Review the full stock movement history for items and warehouses, by date and transaction.
reviewed: 2026-10-12
fingerprint: 04f71a654dc06e93
---
## What it is for

**Stock Ledger Report** is the transaction-level history for one item at one warehouse or rack. It shows the opening balance before the selected range, every movement in the range, the running quantity/value, and the closing balance.

## Before you start

- The item, specific warehouse/rack, and date range are known.
- The source transactions are posted. Reversed transactions appear according to their reversal history and the report's date range.
- The user has Stock Ledger access to the selected company.

## Step by step

1. Select company, item, Warehouse/Rack, and From/To dates. This report requires one item and one location; use Stock Valuation for a multi-item snapshot.
2. Run the report. Review the opening quantity/value, movement date, voucher number/type, description, In/Out quantities, running balance, average cost, and value.
3. Click a voucher number to open the source transaction. Use Back to return to this report with the same filters.
4. Copy the table or print it for reconciliation. Compare the closing balance with the stock ledger/valuation at the end of the range.

## What happens in the books

The report is read-only. It does not change stock or create a journal. Transactions before the From date are folded into the opening balance; transactions after To are excluded. Movement order follows the order that originally determined moving-average cost, rather than sorting solely by the displayed date.

## Rights

STOCKLEDGER **access** controls viewing, subject to company access. Opening a source voucher additionally requires rights to that transaction module.

## Questions and mistakes

- **Transaction is missing:** check company, item, selected warehouse/rack, From/To range, and Posted status.
- **Opening balance is not zero:** it includes all qualifying stock history before the selected start date.
- **Destination warehouse misses an inbound transfer:** confirm the movement posted and that the destination location, not the source, is selected.
- **Balance differs from a date-sorted reconstruction:** moving-average cost follows original posting order; later-dated entries posted earlier can affect WAC sequence.
- **Voucher cannot open:** the report can show movement history while the source module still enforces its own access and company permissions.

## Related pages

[Stock Availability](stock-availability.html) · [Stock Valuation](stock-valuation.html) · [Inventory Aging](inventory-aging.html) · [Warehouse Movement](warehouse-movement.html)
