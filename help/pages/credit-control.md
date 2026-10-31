---
fingerprint: 21b186acb5f54c2d
reviewed: 2026-10-31
title: Credit Control
area: sales
order: 9
modules: [CREDITCONTROL]
sources: [functions/src/creditControl.js, functions/src/creditCalc.js, screens/CREDITCONTROL.html]
summary: Each customer's credit limit and credit hold in each company, and what it owes and has coming against them.
---
## What it is for

Credit Control keeps, for each company, a **credit limit** and, when
needed, a **credit hold** for each customer, and shows where each
customer stands: what it owes and has coming, against its limit, and
what is overdue.

The screen has two tabs: **Customers** and **Setup**. Choose the
company at the top. A customer shared by every company has a limit of
its own in each.

## Step by step

1. In **Setup**, choose what counts against the limit and the grace days,
   and select **Save**.
2. In **Customers**, type each customer's **Credit limit** and select
   **Save limit**.
3. Watch the **Standing**: put a customer **on hold** when it must buy no
   more on credit, and lift it when settled.

## The customers

Each customer of the company is listed, with:

| Column | What it shows |
|---|---|
| Credit limit | In the company's base currency. Blank: no limit. 0: cash only. |
| Receivable | What it owes: open invoices less credits not yet applied. Cheques in hand are still in it until they clear (shown under it). |
| Delivered, not invoiced | Posted Delivery Notes not yet invoiced, at their prices before tax. |
| Open orders | Confirmed Sales Orders' quantities not yet delivered, at their prices before tax. |
| Exposure | What counts against the limit, as **Setup** says. |
| Available | The limit less the exposure (red when over). |
| Overdue | Open invoices more than the **grace days** past their due date, and the oldest's days. |
| Standing | **On hold**, **Over the limit**, **Overdue**, or **Good**. |

Customers on hold come first, then those over their limit, then the
overdue, then the most exposed.

- Select a customer's name to see its open items, deliveries not yet
  invoiced and open orders.
- **Only those on hold, over their limit or overdue** narrows the list.
- **Copy** copies the list for Excel.

> Example: *Example Retail LLC* owes 1,000 (40 days overdue), has 200
> delivered not yet invoiced and 300 on an open order: its exposure is
> 1,500. With a limit of 1,200, it is 300 over.

## Setting a limit

Type the amount in **Credit limit** and select **Save limit** (or press
Enter). Clear it and save for no limit. Each change is kept in the
customer's history with who made it.

## A credit hold

**Put on hold** asks for the reason (a dispute, a returned cheque), which
is shown under the customer's name with who put it on. **Lift hold**
takes it off, with a note if you wish. A hold applies whatever the limit.

## Setup

- **The credit check**: Off (to start), Warn or Block. The check on
  confirming a Sales Order and posting a Customer Invoice comes in the
  next step; until then the setting is kept and the list shows each
  customer's standing.
- **Counted against the limit**: what the customer owes, deliveries not
  yet invoiced and open Sales Orders (to start); or what it owes only.
- **Overdue after**: the days past the due date before an invoice counts
  as overdue (0: any day late).

## Rights

In Roles & Permissions, **Credit Control**: *access* reads the list;
*write* sets limits; *hold* puts on and lifts holds; *setup* changes
Setup; *override* goes ahead where the credit check blocks (with the
check, next).
