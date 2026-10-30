---
title: Reorder / Low Stock Report
area: inventory
order: 14
modules: [REORDER]
sources: [functions/src/stockReports.js]
summary: Identify items below their reorder level and see any recommended purchase shortfall.
reviewed: 2026-10-30
fingerprint: 3d08c65b76e18b41
---
## What it is for

**Reorder / Low Stock Report** shows which items need replenishment because they are below their reorder level or have a shortage against the target value.

## Before you start

- The item reorder levels are set correctly in Item Master.
- The company uses a warehouse or stock range that matches the operational flow.

## Step by step

1. Open **Reorder / Low Stock Report**.
2. Choose the company and the warehouse or stock range.
3. Run the report and review the items that need action.

## What happens in the books

This report is for planning and purchasing. It does not create or post stock entries by itself.

## Rights

Read or report access is normally sufficient.

## Questions and mistakes

- If the report shows no low stock, check whether reorder levels were set and whether the current stock figures are up to date.
- If the stock is low but no order is created, confirm the operational process for raising the purchase request or PO.
