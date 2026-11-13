---
fingerprint: b69a632c01836fce
reviewed: 2026-11-12
title: Subscriptions pack
area: packs
order: 3
modules: []
sources: [functions/src/packs/subscriptions.js]
summary: Plans and customers' subscriptions, their fees worked out, billed in one run with one invoice per customer.
---
## What it is for

The **Subscriptions** [pack](packs.html) bills customers who pay for a plan
every month, quarter, half-year or year. Its screens are in the
**Subscriptions** folder.

| Screen | What it holds |
|---|---|
| **Plans** | What you sell by subscription and its price per period. |
| **Subscriptions** | A customer's subscription: the plan, the quantity and price, the **Fee per period** (quantity × price, worked out), how often it is billed and its **Next due** date. |

## Step by step

1. Add your **Plans**.
2. Add each customer's **Subscriptions**, with their next due date.
3. On the Subscriptions **Runs** tab, choose the date and **Propose**: every
   subscription due by then is listed, ticked.
4. **Run the ticked**: one invoice per customer, a line for each of their
   subscriptions, as a draft. Each subscription's next due date moves on by
   its period, so nothing is billed twice.

## Before you start

- The Subscriptions **Setup**: the sales type and the revenue account.
- The revenue's tax code in [Tax Configuration](tax-configuration.html).

## Reports

The pack adds *Recurring fees by plan*, *Recurring fees by customer* and
*Subscriptions by next due date* to your [MIS reports](mis-report-builder.html).
