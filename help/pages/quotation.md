---
fingerprint: d1f09127abec621c
reviewed: 2026-11-06
title: Quotations
area: crm
order: 2
modules: [QUOTATION]
sources: [functions/src/quotations.js, screens/QUOTATION.html]
summary: Price offers to customers and leads, with discounts and tax, approval, revisions, the print and Create Sales Order.
---
## What it is for

A quotation is the price you offer a customer, or a lead who is not a
customer yet, before they order. It has item lines like a Sales Order's:
the price from the customer's price list, a discount, and the items' tax.
It posts nothing. When the customer accepts, **Create Sales Order** turns
it into a draft order.

Choose the company at the top. The list shows the open quotations; choose
another **Status** to see the rest.

## Step by step

1. Select **New Quotation** and choose the **Customer or lead**. For a
   lead, choose the **Classification** whose price list applies.
2. Check the **Date** and **Valid until** (the CRM Setup's number of days
   on, 30 by default) and, if you like, the **Opportunity** it is for.
3. Add the lines: type or choose the item; its price comes from the price
   list (or type it). Enter the **Qty** and any **Disc %**.
4. Write the **Terms and notes** to print, and select **Save**. The
   quotation gets its number and the tax is worked out.
5. Select **Submit**. Where Approval Configuration has levels for
   Quotation, it waits for approval; otherwise it is **Approved** at once.
6. **Print** it (or save it as a PDF) and send it to the customer.
7. When the customer accepts, select **Create Sales Order**.

## Prices, discount and tax

- The price list is the customer's (by their classification), or for a
  lead the classification you choose. Its currency is the quotation's.
- **Disc %** takes the discount off the unit price; **Amount** is the net
  price times the quantity.
- The tax is the same as a Sales Order's, by each item's tax code (see
  [Tax Configuration](tax-configuration.html)). It shows once you save.

## Statuses

- **Draft**: being prepared; it can be changed or, if it was never
  submitted or revised, deleted.
- **Pending approval**, then **Approved** or **Rejected** (with the
  approver's reason). A rejected quotation can be changed and submitted
  again.
- **Expired**: past Valid until and not ordered. Revise it to offer it
  again.
- **Revised**: a later revision replaces it. It stays, read-only.
- **Accepted**: a Sales Order was made from it.

## Revisions

**Revise** (on an approved, rejected or expired quotation) makes the next
revision: the same number with **Rev 2**, **Rev 3** and so on, a draft with
today's date and a new Valid until. The earlier one is kept, marked
Revised. Only the latest revision can become an order.

## Create Sales Order

On an approved quotation, **Create Sales Order** asks for the **cost
center** and the **warehouse**, and, if the quotation is for an
opportunity, whether to mark the opportunity **Won**. It saves a draft
[Sales Order](sales-order.html) with the lines at their net prices and opens
it; check and confirm it there. The quotation becomes **Accepted** and
shows the order.

A quotation for a lead asks you to convert the lead first: it opens the lead
in [CRM](crm.html), where **Convert to Customer** makes it a customer and
moves its quotations to the customer.

## From the rep's phone

Sales reps make quotes for their own customers and leads in the Employee
Portal (see [Sales reps](sales-rep-portal.html#leads-pipeline-activities-and-quotes)).
The price is the price list's; the rep can give a discount per line. They
appear here with the rep as owner, and are approved the same way. When the
customer accepts, the rep sends a draft Sales Order from the phone, which
the office confirms in Sales Order.

## From CRM

An opportunity or a lead in [CRM](crm.html) has **New Quotation**, which opens
a new quotation for it, the customer or lead and the opportunity already
chosen.

## Who can do what

The **Quotation** rights in Roles: **access** sees the company's quotations
and prints them; **write** makes, submits, revises and orders them.
Approving is the approval levels' (see
[Approval Configuration](approval-configuration.html)).

## Common messages

- **"Only a draft or rejected quotation can be changed."** Revise it
  instead.
- **"This quotation has expired."** Change Valid until, or revise it.
- **"Convert the lead to a customer first."** See Create Sales Order above.
- **"Save the quotation first."** Print and Submit use what is saved.
