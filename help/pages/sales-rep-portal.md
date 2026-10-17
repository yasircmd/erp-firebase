---
fingerprint: 339b6fb864fa90d8
reviewed: 2026-10-16
title: Sales reps in the Employee Portal
area: sales
order: 20
sources: [functions/src/salesRep.js, public/ess.html]
summary: Sales reps see their customers, send orders and record collections from the Employee Portal on their phone.
---
## What it is for

A sales rep uses the **Employee Portal** on their phone. Its **Sales** tab
shows the rep's customers with each one's balance and overdue amount, and
lets the rep send an **order** and record a **collection**. Nothing the rep
does posts by itself: the office confirms orders and posts collections in
the ERP, with every check the ERP makes.

## Before you start

- The rep is an employee with portal access (Employees → portal), and has
  a cost center on their employee record.
- In [Sales Invoice Configuration](sales-invoice-setup.html) → **Sales
  reps**, the office adds the rep, their customers and, for cash
  collections, the rep's cash account. A **Sales manager** sees all the
  company's customers.
- The customers have a price list (Price Listing, by their classification).

## Step by step

1. Open the portal and the **Sales** tab.
2. **New order** on a customer: choose items (at the customer's price list
   price; the stock free to sell is shown), quantities and the warehouse,
   then **Send the order to the office**. It is a draft Sales Order the
   office confirms; the stock is reserved then.
3. **Collect** on a customer: choose **Cash** or **Cheque** and the amount.
   A cheque takes its number, date, bank and a photo. Cash becomes a draft
   Cash Receipt to the rep's cash account, a cheque a draft PDC Received;
   the office posts them.
4. **My orders and collections** shows each one's status: *With the
   office* until it is confirmed or posted.

## Good to know

- The portal needs a connection: nothing is kept on the phone.
- Prices come from the price list only; the rep can't change them.
- For example: Sam Seller sends an order of 2 × RM-001 at 60.00 for
  *Corner Shop*; the office confirms it in Sales Order.
