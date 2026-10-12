---
title: Batch / Expiry Report
area: inventory
order: 13
modules: [BATCHEXPIRY]
sources: [functions/src/stockReports.js]
summary: Review batches and expiry dates to see which stock is close to expiry or needs action.
reviewed: 2026-10-12
fingerprint: f8cb915a648d7952
---
## What it is for

**Batch / Expiry Report** tracks stock by batch and expiry date so the warehouse can see what is near expiration.

## Before you start

- Batch or expiry tracking is set up for the item.
- The relevant date range or expiry threshold is known.

## Step by step

1. Open **Batch / Expiry Report**.
2. Choose the company, warehouse and item group.
3. Run the report and review the expiry dates and remaining stock.

## What happens in the books

This is a report only. It reads the batch and stock history and does not post to the ledger.

## Rights

View or report access is enough.

## Questions and mistakes

- If the report shows nothing, verify that the item is batch-tracked and that stock exists in the selected warehouse.
