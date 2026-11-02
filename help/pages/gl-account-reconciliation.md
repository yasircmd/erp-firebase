---
fingerprint: ae71e3360112159a
reviewed: 2026-11-02
title: GL Account Reconciliation
area: finance
order: 5.6
modules: [GLREC]
sources: [functions/src/glRec.js, screens/GLREC.html]
summary: Explain the balance of each balance-sheet account the company reconciles monthly, by matching its lines or by a schedule, approved and locked month by month.
---
## What it is for

Some accounts should hold only what is still open: GRN Clearing (goods
received, not yet billed), suspense, advances, accruals, prepayments.
Each month their balance is explained item by item, and approved, so
anything stuck or wrong is found while it is fresh.

The screen has three tabs: **The month**, **Reconcile** and **Setup**.
Choose the company and the month at the top.

## Step by step

1. In **Setup**, tick the accounts reconciled each month and choose how
   (for those with the *setup* right):
   - **Match lines**: for clearing and suspense accounts. Lines that
     offset each other are matched; what stays unmatched is the balance.
   - **Schedule**: for accruals and prepayments. A list of items that
     make up the balance.

   Bank accounts are reconciled in [Bank Reconciliation](bank-reconciliation.html).
2. **The month** shows each listed account and bank account with its
   status for the month. Select an account to reconcile it.
3. Reconcile it:
   - **Match lines**: tick lines that offset each other (a GRN and its
     bill, an advance and its settlement). The selection shows when they
     net to nothing. Then select **Match the lines selected**. **Match 1 ✕**
     undoes a match.
   - **Schedule**: **Add an item** for each part of the balance (a debit
     as a positive amount, a credit as negative), with a reference if you
     wish, then **Save the schedule**. Attach the support (a statement, a
     calculation) under **Supporting documents**.
4. When the **Difference** is 0.00, select **Submit**. It goes to the
   approvers set in Approval Configuration for **GL Account
   Reconciliation** (with none set, it is approved at once). Once
   approved, the month is **locked**.

> Example: *Example Trading LLC*'s GRN Clearing has a credit balance of
> 300.00. A GRN of 500.00 is matched with its bill. The GRN of 300.00
> still waiting for its bill is the balance, and it carries into next
> month until its bill comes.

## Locking and reopening

- A month can be submitted only when its difference is nothing and the
  account's previous month is approved: the months go in order.
- Someone with the *reopen* right can **Reopen** a locked month, giving a
  reason (kept in its **History**). Only the latest locked month of an
  account can be reopened.
- A rejected month shows the reason; change it and submit again.
- **Period Closing** checks that each listed account has its month
  approved ([Period Closing](period-closing.html)).

## Rights

In Roles & Permissions, **GL Account Reconciliation**: *access* reads;
*prepare* matches lines, keeps the schedule and notes, submits and
deletes a draft; *reopen* reopens a locked month; *setup* chooses the
accounts and their methods. Approving follows the approval levels.
