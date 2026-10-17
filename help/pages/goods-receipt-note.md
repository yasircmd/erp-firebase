---
title: Goods Receipt Note (GRN)
area: procurement
order: 6
modules: [GRN]
sources: [functions/src/grn.js, functions/src/stockMovement.js]
summary: Receive the purchased goods into stock and match the supplier receipt against the order.
reviewed: 2026-10-17
fingerprint: 1c17a028c58c1bd3
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
