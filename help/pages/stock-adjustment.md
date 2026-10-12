---
title: Stock Adjustment
area: inventory
order: 6
modules: [STOCKADJUSTMENT]
sources: [functions/src/stockAdjustment.js]
summary: Correct the item quantity or value after a count, loss, damage or writing off stock.
reviewed: 2026-10-12
fingerprint: 63250ff9a51ae798
---
## What it is for

**Stock Adjustment** fixes differences between the recorded quantity and the actual stock on the floor.

## Before you start

- The reason for the adjustment is known and approved if needed.
- The warehouse and item are selected correctly.
- The date is in an open period.

## Step by step

1. Open **Stock Adjustment**.
2. Select the company, item and warehouse.
3. Enter the adjustment quantity and the reason.
4. Post the adjustment and check the updated item balance.

## What happens in the books

The adjustment changes the stock ledger and the item balance. It may also affect the value if the adjustment is treated as a cost-bearing stock correction.

## Rights

Users need access and post rights for adjustments.

## Questions and mistakes

- If the quantity is not allowed, check the system balance and whether the item is active.
- If the period is closed, move the adjustment to an open date or ask for a reopen.
