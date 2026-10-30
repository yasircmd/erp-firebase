---
fingerprint: 2f4b94674a6757ed
reviewed: 2026-10-30
title: Budget
area: finance
order: 17
modules: [BUDGET]
sources: [functions/src/budget.js, functions/src/budgetCalc.js, screens/BUDGET.html]
summary: Each company's budget for its financial year, by account and month, optionally per cost centre or project; approved, revised, and compared with the actual figures.
---
## What it is for

A budget is the plan for one company's financial year: how much revenue,
cost of sales and each expense you expect, month by month, and, if you
wish, how balance-sheet accounts should move (a loan repaid, assets
bought). **Budget vs Actual** then compares the plan with what was
posted.

The screen has three tabs: **Budgets**, **Budget vs Actual** and
**Setup**. Choose the company at the top.

## Amounts and signs

Amounts are in the base currency. Each account is typed in its natural
sign: revenue, liabilities and equity as positive amounts when they grow
on the credit side; costs and assets as positive amounts when they grow
on the debit side. So a budget reads as people think of it: sales
120,000, rent 24,000. A negative amount means the other way (for
example a loan repaid: −2,000 a month).

## Step by step

1. In **Budgets**, choose the **Financial year** and select **New budget
   or revision**. The year starts as the company's is set in Period
   Closing → Setup (January or April).
2. Add lines:
   - **Add line**: an account and, if you wish, a cost centre and a
     project. A line without one is the company's: it counts everything
     of that account not budgeted more finely. An account that doesn't
     use cost centres or projects can't have them on its line.
   - **Start from** last year's actuals or last year's budget, changed
     by a %, and **Fill**: the lines are replaced. With **By cost centre
     and project**, last year's lines keep their cost centres and
     projects; without it, one line per account. Last year's actuals
     give the P&L accounts only.
   - **Paste from Excel**: paste rows into the box (the account code,
     the cost centre code or blank, the project code or blank, then the
     twelve months or one year total) and select **Add the rows**. Rows
     it can't read are listed.
3. Type the amounts in the month columns, or a total in the **Year**
   column: it is spread evenly over the months, or like last year's
   actuals when **Spread a year total like last year** is ticked.
4. The foot shows revenue, costs and the profit for each month.
5. **Save draft** as you go. **Submit** sends it for approval.

> Example: for *Example Trading LLC*, Rent with cost centre *CC1 Workshop*,
> a year total of 12,000 spreads as 1,000 a month.

## Approval, the Original and revisions

A budget is approved as Approval Configuration sets for **Budget**. The
amount the levels are judged by is the year's budgeted costs (cost of
sales and expenses). With no approval set, **Submit** approves it at
once. The approver sees it in Home tasks, opens it and selects
**Approve**, or **Reject** with a reason; on a phone, the approval card
does the same ([Approvals](approvals.html)). A rejected budget can be
changed and submitted again, or deleted.

The first approved budget of a year is its **Original**. To change it
later in the year, select **New budget or revision** for the same year:
a **Revision** starts from the Current budget. Once approved, it becomes
the **Current** one; the Original and earlier revisions stay, approved,
to compare with. Only one version of a year can be in preparation or
waiting for approval at a time.

## Budget vs Actual

Choose an approved **Budget** (the Current one first), the month the
**Year to date** runs **through**, and how to **Show** it: each budget
line, by account, by group or by class (the headings of the Chart of
Accounts). Select **Run**.

| Column | What it shows |
|---|---|
| Month budget, Month actual | The chosen month. |
| YTD budget, YTD actual | From the year's first month to the chosen month. |
| YTD variance, % | Actual less budget, and as a % of the budget. Green is better than budget (more revenue, less cost), red worse. |
| Year budget | The whole year. |

- Lines are grouped as revenue, cost of sales and expenses, with their
  totals and the **Profit**, then the balance sheet.
- An actual with no budget line that fits shows as **not budgeted**.
- Select an actual to open its lines in the
  [General Ledger report](general-ledger.html).
- **Copy** copies the table for Excel.

## Setup

**Setup** says, for the company, how balance-sheet lines are budgeted:

- **Monthly movements**: the change each month. The budgeted balance is
  the actual balance when the year began plus the movements, so the plan
  always starts from reality.
- **Month-end closing balances**: the balance expected at each month's
  end, compared with the actual balance then.

A budget keeps the method it was made with: a change applies to the next
budget of a year, and a revision follows its Original.

## Rights

In Roles & Permissions, **Budget**: *access* reads budgets and Budget vs
Actual; *write* prepares, submits and deletes drafts; *setup* changes
Setup. Approving follows the approval levels.
