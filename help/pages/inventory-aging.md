---
title: Inventory Aging
area: inventory
order: 12
modules: [INVENTORYAGING]
sources: [functions/src/stockReports.js]
summary: Look at older stock by age buckets so slow-moving inventory can be reviewed and managed.
reviewed: 2026-10-12
fingerprint: 8ab411cb5df282ce
---
## What it is for

**Inventory Aging** groups stock by how long it has been in inventory. It helps identify slow-moving or aged stock.

## Before you start

- The item master and stock history are complete.
- The company decides which age buckets are meaningful for the operation.

## Step by step

1. Open **Inventory Aging** and choose the company.
2. Select the warehouse or item group as needed.
3. Run the report and review the aging buckets.

## What happens in the books

This is a reporting view only. It reads stock age and quantity, and does not post to the books.

## Rights

View or report access is usually enough.

## Questions and mistakes

- If an item looks unusually old, check for any receipt or movement that has not been posted correctly.
