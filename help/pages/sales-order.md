---
title: Sales Order
area: sales
order: 4
modules: [SALESORDER]
sources: [functions/src/partyLedger.js, functions/src/proforma.js, functions/src/salesTax.js, functions/src/salesOrderClose.js]
summary: Record the customer order before delivery and invoicing, with the right pricing and quantities.
reviewed: 2026-11-14
fingerprint: 0cb649b35151aae2
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

## Project

Once the company has projects, the order has a **Project** field after
Profit Center. Only the company's own and shared projects that are open
are offered. The order's Delivery Notes and invoices will take its project
(the next step of this work).

## Sales rep

The order has a **Sales Rep** field. It takes the customer's rep (from [Customer Master](customer-master.html#sales-rep)) when you choose the customer, or the quotation's when the order is made from one; its Delivery Notes and invoices take it in turn. You can change
it, or choose **No rep**, while the order is a draft; once it is confirmed it
stays as it is. Only the company's active sales reps are offered. MIS Reports
→ **Sales by rep** counts each document's own rep.

## Delivered, remaining and the order's status

A confirmed order shows, for each line, what is **Reserved**, **Delivered**
and **Remaining**, with the line's own status (Not Started, Partial, Fully
Delivered). Delivery Notes, and invoices that deliver stock themselves,
update them when they are posted.

The order's status:

- **Reserved** or **Partially Reserved**: confirmed, with quantity still to
  deliver (all of it reserved, or not all).
- **Delivered**: every line is fully delivered. It is set on its own; if a
  Delivery Note is reversed, the order goes back to Reserved and the
  returned quantity is reserved again.
- **Closed**: closed before everything was delivered (below).
- **Cancelled**.

**Claim** reserves stock only for what is still to deliver.

## Closing an order

When the customer will not take the rest (for example, 6 of 10 were
delivered and the other 4 are no longer wanted), close the order instead of
leaving it open:

1. Open the order and click **Close Sales Order**.
2. Give a reason (required) and confirm.

What is left is no longer expected: its reserved stock is released, and no
more Delivery Notes or invoices can be made from the order. What was
delivered stays as it is. The order shows *Closed*, with the date, who
closed it and why. A fully delivered order is Delivered already and has
nothing to close.

To take it up again, open it and click **Reopen**, with a reason. It goes
back to Partially Reserved (Delivered if everything was delivered); its
reserved stock is not restored, so use **Claim** to reserve again.

Closing and reopening need the Sales Order **post** right (the same as
confirming or cancelling an order).

## The credit check

Where the company checks credit ([Credit Control](credit-control.html#the-credit-check)),
**Confirm** checks the customer first. On credit hold, the order is
refused. Over its limit or overdue, you see why: with a warning, **OK**
goes ahead (kept on the order and shown at its top); where it blocks,
someone with the right to override may go ahead with a reason.

## Proforma Invoice

**Proforma Invoice** (at the top of a saved order) prints, with the company's
[bank details](chart-of-accounts.html#bank-details) set to print, the order for the
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

## Estimated tax

For a company with a [Tax Configuration](tax-configuration.html), the
grid shows below its total the **Estimated tax** and the **Total with tax**:
what the invoice will charge, by each item's tax code at its rate on the
order date and, under India GST, CGST + SGST or IGST by the customer's
state. It is an estimate: nothing is posted, and the invoice works out the
tax again when it is made. Each line's components are rounded as the
invoice rounds them.
With a [price list](price-listing.html) whose prices include tax, the tax
shown is the part included in the prices, and nothing is added.
The [Proforma Invoice](#proforma-invoice) prints the same estimate, by tax
code, and the total with tax.

An item without a tax code is named in place of the estimate: give it one
in [Item Master](item-master.html).

## What happens in the books

A sales order is a commercial document, not a financial journal. The accounting entry is created later when a delivery or invoice is posted.

## Variants

Your provider may give you a variant of this screen under its own name, for example a
*Event Order*. It opens this same screen with its own name, labels and extra fields,
numbers its documents in its own series, and has its own rights and approvals.
Its documents are sales orders like any other: they show in this list marked with the
variant's name, and every report includes them. See
[Built modules](built-modules.html#variants).

## Rights

Sales staff need access and draft rights; approval rights are used where the company requires higher approval.

## Questions and mistakes

- If a line is missing, check whether the customer or item was entered correctly.
- If an order cannot be posted, verify the customer status and the item stock status or price basis.
