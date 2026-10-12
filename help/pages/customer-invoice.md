---
title: Customer Invoice
area: sales
order: 6
modules: [CUSTOMERINVOICE]
sources: [functions/src/partyLedger.js]
summary: Raise the customer bill and post the receivable to the company books against the delivered goods or services.
reviewed: 2026-10-12
fingerprint: f11c1d12f3b57cbb
---
## What it is for

**Customer Invoice** finalises the sale and posts the customer receivable. It matches the delivered goods or service to the sale and creates the finance entry for the receivable and income.

## Before you start

- The delivery note or sales order is complete.
- The customer account and sales type are valid.
- The invoice amount and taxes are ready for review.

## Step by step

1. Open **Customer Invoice** and select the company.
2. Choose the customer and the relevant delivery lines.
3. Review the items, quantities, amounts and tax before posting.
4. Save or post the invoice once the billing is confirmed.
5. Review the receivable impact in the ledger and statements.

## What happens in the books

The customer invoice creates the receivable and the sales revenue or tax entries. It usually represents the formal billing step that follows the delivery.

## Rights

Users need access and post rights for sales invoicing, plus approval if the company uses invoice approval.

## Questions and mistakes

- If the invoice is blocked, check the customer or sales type setup.
- If the amount differs from the order or delivery, recheck the price, taxes and quantity.
