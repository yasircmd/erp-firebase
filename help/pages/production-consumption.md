---
title: Production Consumption
area: production
order: 4
modules: [PRODCONSUMPTION]
sources: [functions/src/stockMovement.js]
summary: Record the raw materials consumed during production and keep the BOM and stock movement aligned.
reviewed: 2026-10-12
fingerprint: 6bf53132aeb6efe4
---
## What it is for

**Production Consumption** records the materials used when a job-order is processed. It matches the actual material usage against the planned BOM.

## Before you start

- The production job is active and the BOM is set.
- The item stocks are available in the selected warehouse.
- The production date and job order are confirmed.

## Step by step

1. Open **Production Consumption** and select the active job order.
2. Enter the materials used and quantities consumed.
3. Review the production variance against the planned required materials.
4. Post the consumption and confirm stock balances adjust correctly.

## What happens in the books

Production consumption reduces the stock ledger and records the material cost used in the production process.

## Rights

Production planners and stock or finance users with posting rights usually perform this task.

## Questions and mistakes

- If the stock balance is too high or low after posting, check whether the BOM quantities and warehouse lines were correct.
