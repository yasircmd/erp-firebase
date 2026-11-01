---
fingerprint: d6945fee26e1a81c
reviewed: 2026-11-01
title: Bank Reconciliation
area: finance
order: 5.5
modules: [BANKREC]
sources: [functions/src/bankRec.js, functions/src/bankRecCalc.js, screens/BANKREC.html]
summary: Match a bank account's entries in the ERP with the bank's statement, month by month, and see what is still to clear.
---
## What it is for

A bank reconciliation shows that the bank account in the ERP agrees with
the bank's statement for a month. Most differences are timing: cheques
paid but not yet presented, deposits made but not yet credited. Those are
listed, and once they are accounted for the difference must be nothing.

## Step by step

1. Choose the **Company**, the **Bank account** (an account marked *Bank*
   in the Chart of Accounts) and the **Month**, then select **Open**.
2. Type the statement's **Opening** and **Closing balance** and select
   **Save the balances**. The last reconciled month's closing balance is
   shown for reference.
3. **Paste the statement from Excel** (optional): copy the month's rows
   (date, description, reference, withdrawal, deposit, or one amount,
   negative for a withdrawal) and select **Add the rows**. Rows that
   can't be read (no date, or no amount) are listed.
4. **Accept the suggestions**: lines with the same amount within a week
   are paired. A reference or cheque number found in the statement's text
   comes first.
5. Match the rest by hand. Tick the ERP's lines and the statement's lines
   that go together, then select **Match the lines selected**. The totals
   shown must agree. Several ERP lines can match one bank line, and the
   other way round. An entry and its reversal can be matched together
   without any bank line.
6. Without a pasted statement, tick the ERP's lines the bank shows and
   select **Mark the GL lines selected cleared**.
7. Watch the **Reconciliation** panel until the **Difference** is 0.00.

To undo a match or a cleared mark, select it (**Match 2 ✕**, **Cleared
✕**). **Only what is not yet cleared** hides what is done.

> Example: *Example Trading LLC*'s bank shows 2,750.00 at the month's end.
> The ERP shows 2,050.00, and a cheque of 700.00 written on the 30th is not
> yet presented, so the balance per the bank is 2,750.00 and the
> difference is nothing.

## The report

| Line | What it is |
|---|---|
| Balance per the ERP | The bank account's balance in the ERP at the month's end. |
| add: payments not yet presented | Payments in the ERP not yet cleared. |
| less: deposits not yet credited | Deposits in the ERP not yet cleared. |
| Balance per the bank | What the statement should show. |
| The statement's closing balance | As typed. |
| Difference | Must be 0.00 when the month is reconciled. |

**Copy** copies the report and what is not yet cleared for Excel.

## From month to month

A line cleared in a month doesn't appear again in later months. What is
still not cleared carries into the next month. A bank account in a
foreign currency is reconciled in its own currency.

## Rights

In Roles & Permissions, **Bank Reconciliation**: *access* reads; *prepare*
types the balances, pastes the statement, matches and marks lines
cleared, and deletes a draft; *reopen* is for reopening a locked month.
