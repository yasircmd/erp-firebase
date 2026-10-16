---
title: Chart of Accounts
area: finance
order: 1
modules: [COA]
sources: [functions/src/coaUsage.js, functions/src/coaScheme.js, functions/src/coaRenumber.js]
summary: The list of accounts every entry posts to: heads and postable accounts, types, codes, and shared accounts.
reviewed: 2026-10-16
fingerprint: b488e1f1b83d4381
---
## What it is for

Every amount the ERP records lands on an account in the Chart of Accounts
(COA). The COA is a tree of six-digit codes, a level each:

| Level | Code | Example |
|---|---|---|
| Class: one per type, a heading | X00000 | 100000 Assets |
| Group: a heading under the class | XN0000 | 110000 Cash / Petty Cash |
| Sub-group (optional): under a group | XNM000 | 121000 Current accounts |
| Account: takes postings | XN0001–XN0999, XNM001–XNM999 | 110001 Petty cash |

The classes and the main groups (Cash, Bank, Receivables, Inventory,
Payables, Share Capital, Retained Earnings, Sales, Cost of Sales, Salaries
and others) are there from the start. An account that takes postings
always sits under a group or a sub-group, never straight under a class.

## Before you start

- You need the Chart of Accounts right for your role (Roles & Permissions).
- Decide which accounts are for one company and which are **shared** by
  all companies (for example a common expense list).

## Step by step

### Add an account

1. Open **Chart of Accounts** and select **Add Account**.
2. Choose the **Parent Account**:
   - for an account, its group or sub-group;
   - for a new group, the class (for example 100000 Assets);
   - for a sub-group, its group.
3. Enter the **Name** and choose the **Type**: Asset, Liability, Equity,
   Revenue, Cost of Goods Sold or Operating Expense. The normal balance
   (debit or credit) follows from the type.
4. Choose **Postable** if journal lines may post to it; leave it unticked
   for a header.
5. Choose the **Company**, or **Shared (All Companies)**.
6. For a heading, you can set the **Cash Flow Category** (Operating,
   Investing, Financing). The accounts beneath it follow it in the Cash
   Flow Statement.
7. For an Assets group or sub-group, set **Cash / Bank**: **Cash** makes
   its accounts cash accounts, and **Bank** makes them bank accounts. Cash
   and Bank Transactions, PDCs, Fixed Assets and payroll then offer them
   as the cash or bank side. 110000 Cash / Petty Cash and 120000 Bank
   Accounts come marked. Changing the mark changes it for every account
   under the group.
8. Select **Save Account**. The code is given automatically: the next
   free number under the parent.

### Find accounts

Filter by company, type, status, or "Postable only". Choosing a company
shows its own accounts **and** the shared ones; "Shared (All Companies)"
shows only shared ones. The list opens on **Active** accounts; choose
**All Statuses** or **Inactive** in the status filter to see retired ones.

### Move an account to another head

Change its Parent Account and save. The account gets the next code under
the new head, **only if it has never been used**. Once anything has posted
to it (or a document refers to it), the move is refused: create a new
account under the right head, move the balance with a
[journal entry](journal-entries.html), and set the old one Inactive.

### Renumber an account within its group

To give an account another code in the **same** group or sub-group (for
example 110001 to 110025, to match your old chart), select the
**Renumber** button on its row. The free codes of the group are shown;
enter the one you want and the reason.

Everything that shows the old code shows the new one from then on:
posted entries, drafts, invoices, cheques, recurring templates, orders
and requisitions. The account keeps its balance and history. Its row
says "formerly 110001", and the change is logged.

You can't renumber an account into another group, because its history
would move to another part of the financial statements. Headings are not
renumbered.

### Accounts to fix

If an account takes postings but is not under a group (it has no parent,
sits straight under a class, or has a heading's code), an **Accounts to
fix** box lists it above the chart. Edit each one and choose its group as
the parent. If it has already been used, it can't move: create a new
account under the group, move the balance with a
[journal entry](journal-entries.html), and set the old one Inactive.

### Retire an account

Set its Status to **Inactive**. It stays in the history and reports but
can't be used in new entries. It then leaves the list, which shows Active
accounts unless you change the status filter.

## Good to know

- Some accounts are **control accounts**, kept by their own screens: each
  vendor's payables and each customer's receivables account (in the Vendor
  and Customer masters), and each item's inventory account. Lines on a
  party's control account must name the party; see
  [Paying and allocating](payments-and-allocation.html).
- Cash and bank accounts are the accounts under a group marked **Cash**
  or **Bank**, whatever their code. Cash and Bank Transactions offers only
  those as the cash or bank side.
- Period Closing's default Retained Earnings account is the first account
  under 320000 Retained Earnings, until you choose another.
