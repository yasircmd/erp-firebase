---
title: Delivery Note
area: sales
order: 5
modules: [DELIVERYNOTE]
sources: [functions/src/stockMovement.js]
summary: Deliver the ordered goods and record the stock movement out of the warehouse to the customer.
reviewed: 2026-11-13
fingerprint: b156a32ec4cce30d
---
## What it is for

**Delivery Note** records the movement of stock out of the company to the customer. It is the link between the sales order and the customer invoice.

## Before you start

- The sales order and customer records are complete.
- The item and warehouse stock are available.
- The delivery date is in an open period.

## Step by step

1. Open **Delivery Note** and choose the company and customer.
2. Select the sales order or inventory lines to deliver.
3. Check the item, quantity, warehouse and delivery date.
4. Post the note. The stock ledger reduces the item quantity and records the issue to a customer.
5. Until a posted customer invoice includes it, the delivery is a Home task for the **Invoicing** team set in [Approval Configuration](approval-configuration.html) (or, with no team, for you). The list's invoicing column shows it as **Pending invoice**.

A Delivery Note can also be made by a [Customer Invoice](customer-invoice.html) with item lines, where the company invoices stock directly: it is posted with the invoice, already matched to it, and reversed with it.


From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## Project

Once the company has projects, the Delivery Note has a **Project** field,
after Profit Center. Ticking a Sales Order's line fills it in with the
order's project when it has none yet; you can change it. Every line the
Delivery Note posts (stock and cost of sales) carries it, and its reversal
too, even after the project is closed.

## Sales rep

The Delivery Note has a **Sales Rep** field. It takes the rep of the first Sales Order you pick lines from, else the customer's; the invoice made from it takes it in turn. You can change
it, or choose **No rep**, while the Delivery Note is a draft; once it is posted it
stays as it is. Only the company's active sales reps are offered. MIS Reports
→ **Sales by rep** counts each document's own rep.

## What happens in the books

The delivery note updates stock movement and supports the later customer invoice. It usually does not create the final trade receivable posting by itself, unless the system is designed to do so.

## Rights

Users need access and post rights for customer delivery processing.

## Questions and mistakes

- If delivery is refused, check the stock availability and delivery date.
- Mismatched customer or order lines usually mean the sales order or warehouse selection was wrong.
