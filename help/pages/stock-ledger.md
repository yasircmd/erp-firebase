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

**Stock Ledger** shows the movement history for each item, item by item, date by date. It is the main trace for stock activity in the ERP.

## Before you start

- The item is in stock and has transactions posted.
- The company and warehouse are known.

## Step by step

1. Open **Stock Ledger** and choose the company.
2. Select the item, date range and warehouse if required.
3. Run the report and open any transaction for detail.

## What happens in the books

This is a read-only report based on the stock ledger. It does not change stock on its own.

## Rights

Report access is normally sufficient.

## Questions and mistakes

- If the movement list is missing a transaction, check the date filter or whether the transaction was posted in another warehouse.
