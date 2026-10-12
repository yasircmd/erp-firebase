---
title: Retail Sales
area: sales
order: 8
modules: [RETAILSALES]
sources: [functions/src/retailSales.js]
summary: Process a retail transaction at the counter, settle the sale and print or record the receipt.
reviewed: 2026-10-12
fingerprint: 7222f83393b82685
---
## What it is for

**Retail Sales** is the point-of-sale flow for small sales at the counter. It handles item scanning, payment capture and the printed or electronic receipt when a customer buys directly.

## Before you start

- The store or counter setup is configured to the default tax and payment methods.
- The item master includes the retail items and price levels.
- Payment methods are assigned to the correct ledgers and posting rules.

## Step by step

1. Open **Retail Sales** and choose the relevant store or counter.
2. Scan or select each item and confirm its quantity and sales price.
3. Apply any discount or promotion where required.
4. Select the payment method and complete the sale.
5. Print the receipt or confirm the transaction is recorded.

## What happens in the books

The point-of-sale sale posts a trade sales entry, updates stock and records the payment type for settlement, tax and receipts.

## Rights

Counter users need access and post rights. Reporting and cashier controls may be restricted to managers or finance support.

## Questions and mistakes

- If the item cannot be sold, check the item status, barcode or price information.
- If payment is not accepted, review the payment methods and any company setup for the retail counter.
