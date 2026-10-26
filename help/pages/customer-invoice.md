---
title: Customer Invoice
area: sales
order: 6
modules: [CUSTOMERINVOICE]
sources: [functions/src/invoiceStock.js, functions/src/partyLedger.js, functions/src/eInvoicing.js, functions/src/salesTax.js]
summary: Raise the customer bill and post the receivable to the company books against the delivered goods or services.
reviewed: 2026-10-26
fingerprint: 332233fc8caa283b
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

## Tax by line

Where the company has a [Tax Configuration](tax-configuration.html) (UAE VAT,
India GST or a tax of its own), the invoice has no **Tax %**. Each line is
taxed by its own **tax code** instead:

- a delivered or item line takes its **item's** code (Item Master); a direct
  line, its **Sales Type's** default code (Sales Invoice Configuration), as
  does an item without a code;
- the rate is the code's rate on the **invoice date**;
- the **discount** is spread over the lines in proportion before tax;
- the **Tax** box lists each line: its taxable value, code, rate, the
  components (for example CGST 9 % and SGST 9 %) and the tax, and a summary
  by code. The total adds the tax.

To give a line another code, choose it in the line's **Tax code**. That
needs Customer Invoice's **change tax code** right (Admin and Finance
Manager by default); without it the codes are shown, not changed.

**Place of supply** (India GST): the customer's state from Customer Master.
Change it when the goods go to another state (a ship-to address). Within the
company's own state the tax is CGST + SGST (UTGST in a union territory); to
another state, an SEZ or abroad, IGST. Under UAE VAT, the emirate is kept
for the VAT return.

**Prices that include tax**: a line delivered against a Sales Order on a
price list marked **Prices include tax** (Price Listing) holds its tax: the
tax is taken out of the price and nothing is added to the total. Its
revenue is the price less that tax.

Posting credits each component to its own output account (Tax
Configuration), and records the codes as used, so they can no longer be
removed there. The printed invoice shows each line's rate and tax (with the
HSN / SAC code under GST), a summary by code with each component, and the
place of supply. A posted invoice keeps the codes and rates it was posted
with, whatever changes later.

For example: *Example Traders*, a registered customer in the company's own
state, is invoiced 10 steel sheets at 50.00 (GST 18 %) and freight of
100.00 (GST 5 %), with 60.00 off. The taxable values are 450.00 and 90.00;
CGST and SGST are 42.75 each; the total is 625.50.

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
customer's currency. With VAT, it also gives, below it, the rate with the
VAT and the total in the default currency, as VAT rules require. With no
VAT (an export, for example), it shows nothing in the default currency.

## Project

Once the company has projects, the invoice has a **Project** field: every
line the invoice posts carries it, for the
[Project Report](project-report.html).


From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## What happens in the books

The customer invoice creates the receivable and the sales revenue or tax entries. It usually represents the formal billing step that follows the delivery.

## E-invoice

If the company e-invoices (Sales Invoice Configuration), a posted invoice shows
its **E-invoice**: **Ready to send**, **Not ready** with what is
missing (for example the customer's address), or **Not e-invoiced** for a
customer without a TRN. **Download XML** gives the file; after fixing the
missing data, **Check again**. Nothing is sent until the company's ASP is
connected. Under India GST it is the IRP's JSON instead (**Download JSON
(IRP)**), for a registered business, an SEZ or a customer abroad: see
[Sales Invoice Configuration](sales-invoice-setup.html).

## Rights

Users need access and post rights for sales invoicing, plus approval if the company uses invoice approval.

## Questions and mistakes

- If the invoice is blocked, check the customer or sales type setup.
- **"No exchange rate for USD on or before …"**: enter a rate in Currency Configuration → Rates.
- **"The rate … differs from the USD rate on …: give the reason"**: say why you use another rate, or put the suggested one back.
- **"This company does not invoice stock directly"**: switch it on in Sales Invoice Configuration, or deliver with a Delivery Note.
- **"at most N can be invoiced now"**: an order line can be invoiced up to what is still to deliver and reserved for it.
- If the amount differs from the order or delivery, recheck the price, taxes and quantity.
