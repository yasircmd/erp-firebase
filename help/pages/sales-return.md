---
title: Sales Return / Credit Note
area: sales
order: 7
modules: [SALESRETURN]
sources: [functions/src/salesReturn.js, functions/src/partyLedger.js]
summary: Record returns from customers, reverse the sale and create the credit note to the customer.
reviewed: 2026-10-16
fingerprint: 8a52d896828c076a
---
## What it is for

**Sales Return / Credit Note** handles returned stock or a customer-cancelled sale. It returns the inventory to stock and creates the document to reduce the customer's receivable.

## Before you start

- The original customer invoice or delivery is known.
- The customer and company details are valid.
- The option to return stock or reverse the sale is confirmed.

## Step by step

1. Open **Sales Return / Credit Note** and choose the company.
2. Select the customer and the original invoice or delivery line.
3. Enter the return quantity and the reason for the return.
4. Post the return. The stock ledger and receivable balance update accordingly.
5. Review the resulting credit note and any variance entries created.

## What happens in the books

The return reduces the customer receivable and may re-enter stock. It can also trigger a sales return variance if the value differs from the original invoice.

## Rights

Users need access and post rights; some companies require approval on returns as part of control.

## Questions and mistakes

- If the return is not allowed, the original invoice or delivery may already have been reversed or closed.
- If the value is not expected, check whether the return is using the original sale price or a revised cost basis.
