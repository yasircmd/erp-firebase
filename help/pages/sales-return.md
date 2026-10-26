---
title: Sales Return / Credit Note
area: sales
order: 7
modules: [SALESRETURN]
sources: [functions/src/salesReturn.js, functions/src/partyLedger.js, functions/src/eInvoicing.js, functions/src/salesTax.js]
summary: Record returns from customers, reverse the sale and create the credit note to the customer.
reviewed: 2026-10-26
fingerprint: 8098d7245a0f18f5
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

For a customer in a foreign currency, the credit note is in its currency
at the **invoice's** rate, not the rate on the return date, so it takes back
exactly what the invoice booked; the stock comes back at its cost in the
default currency.

An invoice taxed by line ([Tax Configuration](tax-configuration.html)):
each returned line takes back its share of that line's tax, by quantity, at
the codes and rates the invoice was posted with. Each component goes back
to the account the invoice credited, and the Tax line shows **by line**.
A line whose price included tax takes back its tax from within the price.

## E-invoice

If the company e-invoices (Sales Invoice Configuration), a posted return shows
its **E-invoice** (a credit note): **Ready to send**, **Not ready** with what is
missing (for example the customer's address), or **Not e-invoiced** for a
customer without a TRN. **Download XML** gives the file; after fixing the
missing data, **Check again**. Nothing is sent until the company's ASP is
connected. Under India GST it is the IRP's JSON instead (**Download JSON
(IRP)**), for a registered business, an SEZ or a customer abroad: see
[Sales Invoice Configuration](sales-invoice-setup.html).

## Rights

Users need access and post rights; some companies require approval on returns as part of control.

## Questions and mistakes

- If the return is not allowed, the original invoice or delivery may already have been reversed or closed.
- If the value is not expected, check whether the return is using the original sale price or a revised cost basis.
