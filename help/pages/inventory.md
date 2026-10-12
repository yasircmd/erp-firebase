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

Inventory keeps the warehouse record: what items exist, what each item costs,
where stock is located, how much is on hand, and what each movement affects.
This area covers item setup, stock transactions, adjustments, counts and the
standard stock reports.

## Before you start

- Make sure the company has its inventory accounts and stock control setup in
  the [Chart of Accounts](chart-of-accounts.html).
- Check the item categories and units of measure in **Item Sub Category** and
  **UOM** before you create items.
- If your company uses multiple warehouses or locations, confirm which cost
  and stock rules apply before postings.

## Step by step

### 1. Create the item master

Open **Item Master** and enter the item details:

- the item code and name;
- the category and unit of measure;
- the stock account and item cost details;
- the re-order level and other stock controls when required.

The item then becomes available to purchase, issue, transfer and report on
through the stock module.

### 2. Set up units and categories

Use **UOM** to define units such as cartons, boxes or pieces, and how
quantities convert between them. Use **Item Sub Category** to group items by
type or department for reporting and stock control.

### 3. Receive stock and build the cost basis

Stock normally enters through **Goods Receipt Note (GRN)** from a purchase
order. Once a receipt is posted, the item's stock ledger gets the quantity and
cost basis, and the warehouse balance changes.

### 4. Issue or move stock

Use **Material Issue** to issue stock to a department or production process.
Use **Warehouse Movement** to transfer stock between warehouses or locations.
Both actions create a stock movement, adjust the balances and keep the stock
ledger in sync.

### 5. Adjust or count stock

Open **Stock Adjustment** if stock must be corrected after a count or a
write-off. Open **Physical Count** when a full check is done, and then post the
count difference. The system records the difference against the inventory
balance and the stock ledger.

### 6. Review stock and valuation

Use the stock reports to answer day-to-day questions:

- **Stock Availability**: what is available now;
- **Stock Ledger**: what moved and when;
- **Stock Valuation**: total stock value by item;
- **Inventory Valuation**: valuation by warehouse and period;
- **Inventory Aging**: older stock and age buckets;
- **Batch / Expiry**: goods near expiry;
- **Reorder / Low Stock**: items below their target level.

## What happens in the books

- Every stock movement posts to the stock ledger and creates a stock
  transaction with the item, quantity, warehouse and cost.
- Material issues, adjustments and movements affect on-hand quantity and, in
  some cases, the value carried in inventory.
- A physical count creates an adjustment when the counted quantity differs
  from the system balance.
- Cost and value reports rely on the same stock ledger, so they reflect the
  latest approved movement and valuation.

## Rights

Inventory rights are usually managed in Roles & Permissions, with a mix of:

- **Access** to open the screen;
- **Write** to change item or stock records;
- **Post** to post counts, adjustments or warehouse issues;
- **Report** access for stock and valuation views.

## Questions and mistakes

- If the system refuses a stock issue, check that the item is active,
  available in the selected warehouse and not reserved beyond the available
  balance.
- If a count does not match the system total, review the transaction list and
  the warehouse before posting the adjustment.
- A batch report or expiry report only works for items that carry batch or
  expiry tracking. Check the item setup first.
- If a period is closed, the stock movement or adjustment cannot be posted in
  that month without the approved exception process.

## Related pages

- [Procurement](procurement.html)
- [Chart of Accounts](chart-of-accounts.html)
- [Approvals](approvals.html)
