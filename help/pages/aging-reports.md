---
title: Customer and Vendor Aging
area: finance
order: 10
modules: [CUSTOMERAGING, VENDORAGING]
sources: [functions/src/agingReports.js]
summary: How old each party's open balance is, in buckets, with advances and pending cheques shown apart.
reviewed: 2026-10-18
fingerprint: 139e3e0c448a71fa
---
## What it is for

Shows, for every customer (or vendor) with something open, how much is
not yet due and how much is overdue by 1–30, 31–60, 61–90 or more than 90
days — to chase collections or plan payments.

## Step by step

1. Open **Customer Aging** or **Vendor Aging**.
2. Choose the **Company** and the **As at** date (today by default).
3. Choose **Age by**:
   - **Days overdue** (from the due date): Not yet due, 1–30, 31–60,
     61–90, over 90;
   - **Days since the invoice date**: 0–30, 31–60, 61–90, 91–120, over
     120.
4. Select **Run**.
5. Each row is one party: payment terms, the buckets, **Owed**,
   **Unapplied credits** (advances and credits not matched to an
   invoice), **Net balance**, and **Pending PDCs** (shown, not deducted).
6. Select a row to see its open documents; **SOA** opens the party's
   [statement](statements-of-account.html).
7. **Copy** to Excel or **Print**.

## Good to know

- The report checks its total against the parties' accounts in the
  General Ledger at that date and says whether they agree.
- Each party's figures agree with its statement of account at the same
  date.
- A party in a **foreign currency** is shown in the default currency, each
  document at its own rate, so the totals and the GL check add up; its
  net balance in its own currency is shown under the net balance (for
  example USD 200.00). Open the row to see each document's rate.
