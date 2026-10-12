---
title: Inventory
area: inventory
order: 1
modules: [ITEMMASTER, UOM, ITEMSUBCAT, MATERIALISSUE, WAREHOUSEMOVEMENT, STOCKADJUSTMENT, PHYSICALCOUNT, STOCKAVAILABILITY, STOCKLEDGER, STOCKVALUATION, INVENTORYVALUATION, INVENTORYAGING, BATCHEXPIRY, REORDER]
sources: [functions/src/materialIssue.js, functions/src/stockAdjustment.js, functions/src/stockMovement.js, functions/src/stockReports.js]
summary: Maintain items, track stock movement, count inventory, and review what is on hand and what is valued.
reviewed: 2026-10-12
fingerprint: c5d412a4682e9195
---
## What it is for

Inventory is the record of what a company owns, holds and moves through the
warehouse. It covers the item master, units and categories, stock receipts,
issues, transfers, adjustments, counts and the reports that answer day-to-day
questions about availability and value.

In practice, the inventory process keeps three things aligned: the item record,
the warehouse balance and the stock ledger. A business can only act on stock
when the movement is posted, the quantity is available and the cost basis is
still valid.

## Before you start

- Confirm the company has the inventory and stock accounts set in the
  [Chart of Accounts](chart-of-accounts.html).
- Set the item categories and units in **Item Sub Category** and **UOM**.
  These rules are the basis for stock movement and reporting.
- If the company uses multiple warehouses or branches, verify each item is
  mapped to the right stock location and cost behavior.
- Review the company period status before posting movement in a month. A
  closed month cannot accept new stock entries for a date in it.
- If the warehouse is doing physical counts, plan the count before posting the
  adjustment so the variance is understood.

## Step by step

### 1. Set up the item master

Open **Item Master** and enter the core setup for each item:

- the item code and name;
- the category and unit of measure;
- the stock account and any stock-control definitions;
- the reorder level and the cost or control information your company uses.

An item is not usable in stock transactions until it has the basic master
setup. After that, it can be purchased, issued, transferred, counted and
reported on.

### 2. Define the units and categories

Use **UOM** to define the units the business uses, such as carton, piece,
box or pack, and how quantities convert between them. Use **Item Sub
Category** to group items into product families or departments for analysis,
reporting and stock control.

The reason this matters is that the ERP does not treat every stock line as a
simple "one unit" record; the item may be held in one unit and reported in
another, and the system keeps it consistent.

### 3. Receive stock and establish the cost basis

Stock normally enters through **Goods Receipt Note (GRN)** from a purchase
order. When it is posted, the ERP updates:

- the stock on hand for the warehouse;
- the stock ledger for the item and movement;
- the item cost basis and value used in valuations and reports.

This is the point where the inventory balance becomes real in the system.

### 4. Issue or move stock

Use **Material Issue** to issue stock to a department or operating process.
Use **Warehouse Movement** to transfer stock between warehouses or locations.

Both actions create a stock movement, reduce or move the quantity and keep the
ledger in sync. If the movement uses a warehouse or cost center, the ERP also
tracks those details in the movement history.

### 5. Adjust or count stock

Open **Stock Adjustment** when a value or quantity has to be corrected after
an error, loss, write-off or special handling. Open **Physical Count** when a
full count is done and the actual stock must be brought into line with the
system.

The count or adjustment is then posted as a movement against the item and the
selected warehouse. The stock ledger shows what was counted, what was
expected, and the resulting adjustment.

### 6. Review the reports

The inventory reports answer the routine questions operations need to ask:

- **Stock Availability**: what is available now;
- **Stock Ledger**: what moved, in what quantity and when;
- **Stock Valuation**: total value by item;
- **Inventory Valuation**: period or warehouse value;
- **Inventory Aging**: older stock and age buckets;
- **Batch / Expiry**: items near expiry or in a given batch;
- **Reorder / Low Stock**: items below their target level.

The reports all use the same underlying stock records, so they stay consistent
with the transaction history.

## What happens in the books

- Every stock movement posts to the stock ledger and creates a stock
  transaction with the item, quantity, warehouse and cost reference.
- Material issues, movements and counts alter the on-hand quantity and the
  value as the business consumes, moves or corrects stock.
- Stock adjustments generally happen when there is a difference between the
  system record and the physical reality.
- Inventory valuations will reflect the latest cost and movement history for
  the item, so they are only as good as the transactions that have been
  posted.
- When a period is closed, the ERP will refuse a stock movement dated in that
  month so the books remain locked and consistent.

## Good to know

- The system tracks both **quantity** and **value**. A stock movement can
  change the quantity without necessarily changing the value in the same way,
  depending on the item cost basis and the movement type.
- Batch and expiry tracking can be important for items with shelf life,
  special handling or regulatory control. Those reports only work when the
  item has the right tracking setup.
- A negative stock result is not allowed in the normal flow. The system will
  only accept a movement if the available stock supports it.
- Inventory is driven by the transaction history: if the warehouse records are
  wrong, the reports and valuation will also be wrong until the issue is
  corrected.

## Rights

Inventory rights are normally managed in Roles & Permissions:

- **Access** to open the screen;
- **Write** to maintain item or stock setup;
- **Post** to create stock movements, adjustments or counts;
- **Report** to access stock and valuation views.

The exact rights depend on the user role, company and operational setup.

## Questions and mistakes

- If a stock issue is refused, check the item status, warehouse selection and
  the current available balance. The system will not issue more than is
  available.
- If a count does not match the ledgers, review the warehouse transactions and
  the date before posting the adjustment.
- If a report looks empty or unexpected, check whether the item has the
  relevant stock tracking and whether the chosen warehouse or date range is
  correct.
- A movement dated in a closed month will be refused until the period is
  reopened or the date is moved to an open month.

## Related pages

- [Procurement](procurement.html)
- [Chart of Accounts](chart-of-accounts.html)
- [Approvals](approvals.html)
- [Working with screens](working-with-screens.html)
