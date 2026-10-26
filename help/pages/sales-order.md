---
title: Sales Order
area: sales
order: 4
modules: [SALESORDER]
sources: [functions/src/partyLedger.js, functions/src/proforma.js]
summary: Record the customer order before delivery and invoicing, with the right pricing and quantities.
reviewed: 2026-10-26
fingerprint: ab0dda01a309d335
---
## What it is for

**Sales Order** captures the customer's commitment to buy goods or services. It formalises the item, quantity, price and delivery plan before stock leaves the warehouse.

## Before you start

- The customer and pricing are in place.
- The item and stock basis are valid.
- The delivery date and warehouse are known.

## Step by step

1. Open **Sales Order** and choose the customer and company.
2. Add the item lines, quantity and requested price.
3. Confirm the delivery schedule and any discounts.

To enter many lines at once, fill them in Excel: **Copy Table** copies the
lines with their headings (Item Code, Warehouse, Quantity, Unit Price), also
on an empty grid. Copy the rows from Excel and click **Paste from Excel** (or
click into a cell of the grid and press Ctrl+V); the headings row is skipped.
Where the order has a price list and the item is on it, the price list's
price is used; otherwise the pasted price. If a row has an item code or
warehouse that isn't found, a quantity that isn't a number above zero or a price that isn't a number,
nothing is pasted and the message names the rows to fix.
4. Save or submit for approval if the company requires it.
5. Use the order to create the delivery note or invoice when the goods are ready.

## Proforma Invoice

**Proforma Invoice** (at the top of a saved order) prints the order for the
customer, or saves it as a PDF from the print dialog, for example for an
advance payment or a letter of credit. It posts nothing and is not a tax
invoice.

- It has its own number, from the **PI** series in
  [Numbering](numbering.html), for example *PI-26-01-000004*. The number is
  given the first time the proforma is printed and kept with the order, so
  every reprint shows the same one.
- It prints what is saved: save your changes first.
- A draft order (not yet confirmed) prints marked **DRAFT**. A cancelled
  order has no proforma.


From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## What happens in the books

A sales order is a commercial document, not a financial journal. The accounting entry is created later when a delivery or invoice is posted.

## Rights

Sales staff need access and draft rights; approval rights are used where the company requires higher approval.

## Questions and mistakes

- If a line is missing, check whether the customer or item was entered correctly.
- If an order cannot be posted, verify the customer status and the item stock status or price basis.
