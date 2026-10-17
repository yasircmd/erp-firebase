---
title: Customer Invoice
area: sales
order: 6
modules: [CUSTOMERINVOICE]
sources: [functions/src/invoiceStock.js, functions/src/partyLedger.js, functions/src/eInvoicing.js]
summary: Raise the customer bill and post the receivable to the company books against the delivered goods or services.
reviewed: 2026-10-17
fingerprint: 403203eb44ae797e
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

### Selling from stock on the invoice

Where the company allows it (Sales Invoice Configuration → **Invoices may
deliver stock directly**), the invoice has **Item Lines**: goods it delivers
itself, without a separate Delivery Note.

- **Add Item**: type the item code, choose the warehouse and enter the
  quantity. The price comes from the customer's price list where the item is
  on it, and can be changed.
- **From Sales Order**: the customer's order lines still to deliver. Tick the
  lines and the quantities to invoice now; the item, warehouse and price are
  the order's. Whatever you don't invoice stays open on the order.
- Choose one **Sales Type** for the item lines.

When the invoice is posted, a **Delivery Note** is made and posted for its
item lines: the stock leaves at its average cost (with its cost of sales),
the order counts the quantities as delivered, and the invoice shows
"Delivered with Delivery Note …". If there isn't enough stock, the posting is
refused and nothing changes. **Print delivery slip** prints the items and
quantities, without prices, for the driver or the store. Reversing the
invoice also reverses its Delivery Note, so the stock comes back. A return is
made in Sales Return, as for any delivered invoice.

## A customer in a foreign currency

If the customer's **Default Currency** (Customer Master) is not the
default currency, its invoice is in that currency:

- the screen shows **Currency and rate**: the rate on the invoice date,
  from [Currency Configuration](currencies.html);
- you may type another rate (for example the bank's), with a reason;
- the total shows in the customer's currency, with its value in the
  default currency beside it;
- for now such an invoice takes **item lines and direct lines**. Delivery
  Notes made separately are priced in the default currency, so they can't
  be attached to it.

The books are in the default currency, at the invoice's rate; each line
keeps its foreign amount too. The printed invoice gives the total in the
customer's currency and, below it, the rate with the VAT and the total in
the default currency.

## Project

Once the company has projects, the invoice has a **Project** field: every
line the invoice posts carries it, for the
[Project Report](project-report.html).

## What happens in the books

The customer invoice creates the receivable and the sales revenue or tax entries. It usually represents the formal billing step that follows the delivery.

## E-invoice

If the company e-invoices (Sales Invoice Configuration), a posted invoice shows
its **E-invoice**: **Ready to send**, **Not ready** with what is
missing (for example the customer's address), or **Not e-invoiced** for a
customer without a TRN. **Download XML** gives the file; after fixing the
missing data, **Check again**. Nothing is sent until the company's ASP is
connected.

## Rights

Users need access and post rights for sales invoicing, plus approval if the company uses invoice approval.

## Questions and mistakes

- If the invoice is blocked, check the customer or sales type setup.
- **"No exchange rate for USD on or before …"**: enter a rate in Currency Configuration → Rates.
- **"The rate … differs from the USD rate on …: give the reason"**: say why you use another rate, or put the suggested one back.
- **"This company does not invoice stock directly"**: switch it on in Sales Invoice Configuration, or deliver with a Delivery Note.
- **"at most N can be invoiced now"**: an order line can be invoiced up to what is still to deliver and reserved for it.
- If the amount differs from the order or delivery, recheck the price, taxes and quantity.
