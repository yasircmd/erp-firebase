---
title: Physical Count
area: inventory
order: 7
modules: [PHYSICALCOUNT]
sources: [functions/src/stockAdjustment.js]
summary: Count stock physically and post the difference between the counted quantity and the system balance.
reviewed: 2026-10-12
fingerprint: a3467a3352c31b87
---
## What it is for

**Physical Count** is the count process used to check the actual stock in a warehouse against the ERP balance.

## Before you start

- The count date and warehouse are selected.
- The count team knows what lines are being counted.
- The system is expected to be in an open period for the count date.

## Step by step

1. Open **Physical Count** and choose the warehouse and company.
2. Enter the counted quantities for each item.
3. Review the difference between the counted quantity and the system quantity.
4. Post the count difference if it is accepted.

## What happens in the books

The count posts the variance as an inventory movement, correcting the stock ledger and the warehouse balance.

## Rights

Users need access and post rights to perform and close a count.

## Questions and mistakes

- A large variance should be reviewed before posting.
- If a count is refused, the period or item status may not be open for change.
