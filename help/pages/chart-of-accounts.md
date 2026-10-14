---
title: Chart of Accounts
area: finance
order: 1
modules: [COA]
sources: [functions/src/coaUsage.js]
summary: The list of accounts every entry posts to: heads and postable accounts, types, codes, and shared accounts.
reviewed: 2026-10-14
fingerprint: 4983cae5306941a5
---
## What it is for

Every amount the ERP records lands on an account in the Chart of Accounts
(COA). The COA is a tree: **header** accounts group others (for example
"Current Assets"), and **postable** accounts receive journal lines (for
example "Bank — Main Account").

## Before you start

- You need the Chart of Accounts right for your role (Roles & Permissions).
- Decide which accounts are for one company and which are **shared** by
  all companies (for example a common expense list).

## Step by step

### Add an account

1. Open **Chart of Accounts** and select **Add Account**.
2. Choose the **Parent Account** (the head it sits under). Choose "None" to
   start a new top-level group.
3. Enter the **Name** and choose the **Type**: Asset, Liability, Equity,
   Revenue, Cost of Goods Sold or Operating Expense. The normal balance
   (debit or credit) follows from the type.
4. Choose **Postable** if journal lines may post to it; leave it unticked
   for a header.
5. Choose the **Company**, or **Shared (All Companies)**.
6. For a header, you can set the **Cash Flow Category** (Operating,
   Investing, Financing); the accounts beneath it follow it in the Cash
   Flow Statement.
7. Select **Save Account**. The code is given automatically: the next
   number under the parent.

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
- Cash accounts have codes starting **10**, bank accounts **11**; Cash and
  Bank Transactions offers only those as the cash or bank side.
