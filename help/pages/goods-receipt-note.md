---
title: Goods Receipt Note (GRN)
area: procurement
order: 6
modules: [GRN]
sources: [functions/src/grn.js, functions/src/stockMovement.js]
summary: Receive the purchased goods into stock and match the supplier receipt against the order.
reviewed: 2026-11-13
fingerprint: bee0a66f3fb7ac9b
---
## What it is for

**Goods Receipt Note (GRN)** records what actually arrived from the vendor. This is where the ERP turns a purchase order into real stock on hand.

## Before you start

- The purchase order is approved and open.
- The item, supplier and warehouse are valid.
- The company has the right stock account and GRN settings.

## Step by step

1. Open **Goods Receipt Note** and select the company.
2. Choose the supplier and the approved purchase order.
3. Enter the received quantities, item by item.
4. Check the warehouse, unit and any batch or expiry details.
5. Post the GRN. The stock ledger and item availability update with the receipt.


From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## Descriptions and cost centers

- **The description is optional.** Left blank, the entry saves *Goods receipt from PO-26-000123 (its purchase orders)*, and a blank line takes the item's name (a non-stock line, its category's) ([Working with screens](working-with-screens.html#descriptions-on-stock-entries)).
- **A warehouse's cost center.** When a warehouse has a default cost center ([Organizational Units](org-units.html)), choosing it on a line sets the line's cost center; you can still change it. A line saved with no cost center takes its warehouse's.

## What happens in the books

The GRN updates the stock ledger and the item value basis. It is also the document the supplier invoice will match against later.

## Rights

Users need access and post rights to receive stock against a purchase order.

## Questions and mistakes

- If the item does not appear, check the PO or item master.
- If the receipt is refused, the supplier or order details may be mismatched.
- A closed month will reject a GRN date in the closed period.
- **"select a Cost Center"**: a non-stock category posts to an account that
  needs one (its rule in the [Chart of Accounts](chart-of-accounts.html)).
