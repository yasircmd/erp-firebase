---
title: Batch / Expiry Report
area: inventory
order: 13
modules: [BATCHEXPIRY]
sources: [functions/src/stockReports.js]
summary: Review batches and expiry dates to see which stock is close to expiry or needs action.
reviewed: 2026-10-18
fingerprint: 66385403dd3ecc53
---
## What it is for

**Expiry / Batch Report** reconstructs remaining stock by item, warehouse, and batch as at a selected date. It flags expired, soon-to-expire, unexpired, and batches without an expiry date, and supports a trace to the Stock Ledger.

## Before you start

- Posted movements through the as-at date include the batch/expiry details needed for the items being reviewed.
- The company, as-at date, and expiry warning window are known. The default window is 90 days.
- The user has BATCHEXPIRY access to the company.

## Step by step

1. Select company, **As at** date, **Expiring within** days, and whether to include only batch-tracked items.
2. Optionally filter by warehouse and fixed item category, then run the report.
3. Search by item or batch and filter statuses: Expired, Expiring, both, OK, or No expiry date. Review received date, expiry date, days to expiry, remaining quantity, and value.
4. Use the summary totals to prioritize expired/soon-expiring stock. Copy or print the filtered result for action.
5. Select a row to open Stock Ledger for that item/warehouse from its receipt date through the as-at date; Back returns to the report.

## What happens in the books

This is a read-only report; it does not post, reserve, or change a batch. It rebuilds batch layers from posted stock movements: issues take a named batch first, otherwise the earliest-expiring batch first (FEFO); warehouse transfers carry the batch's receipt/expiry data. Values use the item's moving-average warehouse cost distributed across batch quantities, not an independent cost per batch.

## Rights

BATCHEXPIRY **access** controls report viewing, subject to company access.

## Questions and mistakes

- **Batch is missing:** check the selected as-at date, warehouse/category filters, and whether posted receipts recorded its batch number.
- **No expiry date:** some inbound movements carry a batch without an expiry; a later receipt of that same batch can supply the previously recorded expiry.
- **Remaining quantity seems wrong:** verify named-batch issues, FEFO issues without a batch, reversals, and transfers in the Stock Ledger.
- **Value differs from the original receipt price:** this report allocates current item/warehouse moving-average value across the remaining batch layers.
- **Item is not batch-tracked:** clear **Batch-tracked items only** to include it where its movements contain batch details.

## Related pages

[Stock Ledger](stock-ledger.html) · [Inventory Aging](inventory-aging.html) · [Item Master](item-master.html) · [Warehouse Movement](warehouse-movement.html)
