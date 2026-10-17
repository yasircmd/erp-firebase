---
title: Trial Balance
area: finance
order: 12
modules: [TRIALBALANCE]
sources: [functions/src/trialBalance.js]
summary: Every account's opening balance, movements and closing balance for a period, with drill-down to the ledger.
reviewed: 2026-10-16
fingerprint: ca78810c67a24cb2
---
## What it is for

The Trial Balance lists every account with its **Opening** balance, the
period's **Transactions** (debit and credit) and its **Closing** balance.
Total debits equal total credits; it is the first check that the books are
complete.

## Step by step

1. Open **Trial Balance (TB)**.
2. Choose the **Company** and the period. **From** starts at the beginning
   of the company's financial year; change it as needed.
3. Narrow by **Division**, **Branch**, **Cost Center** or **Profit Center**
   if needed.
4. Select **Run Report**.
5. Select an account to open its [General Ledger](general-ledger.html)
   for the same period; **Back** returns here.
6. **Copy Table** to Excel, or **Print**.

### Before year-end closing

After a financial year is closed, its income and expense accounts are
zeroed into Retained Earnings by the year-end closing entry. Tick **Before
year-end closing** to see the closed year's income and expense balances as
they were.

## Good to know

- Anything dated before **From** is in the Opening column.
- **Project** shows only the lines of one project (or those with **No
  project**).
- See [Period Closing](period-closing.html) for the year-end entry.
