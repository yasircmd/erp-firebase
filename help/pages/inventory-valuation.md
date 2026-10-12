---
title: Inventory Valuation
area: inventory
order: 11
modules: [INVENTORYVALUATION]
sources: []
summary: Maintain effective-dated production unit costs for Job Order finished and semi-finished items; this is not the stock-on-hand valuation report.
reviewed: 2026-10-12
fingerprint: 1fd1deceb0d0abd8
---
## What it is for

Despite its name, **Inventory Valuation List** is not the report of stock on hand. It is the production standard-cost list: an effective-dated unit cost for each Finished Good or Semi-Finished Good that has an active Bill of Materials and can be selected for a Job Order.

Production uses the cost effective on the production date when it values output. Keep historical cost rows rather than overwriting a cost that applied to an earlier production period. For warehouse quantities and inventory value, use [Stock Valuation](stock-valuation.html) instead.

## Before you start

- The company, eligible item, approved cost basis, and effective date are known.
- The item is active and eligible for a Job Order: a Finished Good or Semi-Finished Good with an active BOM.
- The user has Inventory Valuation access to view the list and write permission to maintain costs.

## Step by step

### Add a production unit cost

1. Open **Inventory Valuation List** and select the company. The list and item picker are company-specific.
2. Select the eligible production item, enter a unit cost greater than zero, and choose the date from which that cost applies.
3. Add the cost and confirm that the new row appears with the intended item, amount, effective date, and Active status.
4. For a cost change, add a new effective-dated row. Do not replace a past amount when the new cost is meant to apply only from a later date.

### Retire a cost

Deactivate a cost that should no longer be selected for future use. Check production dates and existing Job Orders before retiring it; past production should continue to use the cost version effective on its date.

## What happens in the books

Maintaining a cost row does not post a journal and does not change the quantity or value of existing warehouse stock. It supplies a production cost input. Production and its reports use the effective cost when calculating the finished output and related production costs.

## Rights

Inventory Valuation **access** allows viewing the company's cost list; **write** allows adding, editing, or deactivating lines. Company access is enforced.

## Questions and mistakes

- **Item is not selectable:** confirm it is active, is a Finished Good or Semi-Finished Good, and has an active BOM.
- **This is not the stock-on-hand value I need:** use Stock Valuation or Inventory Aging for warehouse stock value; this screen holds unit costs used for production.
- **A production order used the old amount:** compare its production date with each cost row's Effective From date. The cost is chosen by effective date, not by which row was entered last.
- **A cost cannot be added:** choose the selected company's eligible item, enter a positive unit cost, and supply an effective date.
- **Historical production costs appear changed:** keep prior effective-dated rows active for the dates they cover; add a new row for a later change instead of editing the historical amount.

## Related pages

[Bill of Materials](bill-of-materials.html) · [Production](production.html) · [Material Variance](material-variance.html) · [Stock Valuation](stock-valuation.html)
