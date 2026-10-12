---
title: Stock Availability
area: inventory
order: 8
modules: [STOCKAVAILABILITY]
sources: [functions/src/stockReports.js]
summary: See the stock currently available by item and warehouse, including what can still be issued.
reviewed: 2026-10-12
fingerprint: c163e5e48ecc89a5
---
## What it is for

**Stock Availability** shows how much stock is available now based on the current balances and reservation state.

## Before you start

- The company and warehouse are known.
- The item master and stock transactions are already posted.

## Step by step

1. Open **Stock Availability** and select the company and warehouse.
2. Choose the item or categories to review.
3. Run the report and check the quantity available for issue.

## What happens in the books

This is a report only. It reads the stock ledger and balances and does not change the books.

## Rights

Typically view or report access is enough.

## Questions and mistakes

- If the quantity is lower than expected, check recent receipts, issues or reserved stock.
