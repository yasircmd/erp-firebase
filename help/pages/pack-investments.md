---
fingerprint: cbcb59c9b94b1520
reviewed: 2026-11-12
title: Investments pack
area: packs
order: 5
modules: []
sources: [functions/src/packs/investments.js]
summary: The investments held with their expected income; purchases, sales, income and revaluations, each journaled through the Journal Entry.
---
## What it is for

The **Investments** [pack](packs.html) keeps the investments the company
holds and puts their movements in the accounts. Its screens are in the
**Investments** folder.

| Screen | What it holds | To the books |
|---|---|---|
| **Investments** | Each investment: its instrument, counterparty, dates, cost and expected return; the *Expected income a year* is worked out. | — |
| **Purchases** | An investment bought: the amount paid. | A journal: the investment account, the bank. |
| **Sales** | An investment sold: the proceeds and its cost; the *Gain* or *Loss* is worked out. | A journal at cost, then one for the gain (or one for the loss). |
| **Income received** | Interest, a dividend or rent received. | A journal: the bank, the income account. |
| **Revaluations** | The value before and now; the *Increase* or *Decrease* is worked out. | A journal up, or one down, against the revaluation reserve. |

## Step by step

1. Add the **Investments** you hold.
2. Make the document (for example a **Sale**), then **Confirmed**.
3. In its **To the books** panel, make its journal(s). On a sale, make *sold
   at cost*, then *Gain* or *Loss*, whichever it is: the other is refused (its
   amount is not above zero).
4. Post the journals in [Journal Entry](journal-entries.html).

## Before you start

- Each document's **Setup**: the accounts for each of its journals (the
  investment account, the bank, the income, gain, loss and revaluation
  reserve accounts).

## Reports

The pack adds *Holdings by instrument*, *Income received by investment* and
*Investments by maturity* to your [MIS reports](mis-report-builder.html).
