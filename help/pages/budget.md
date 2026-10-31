---
fingerprint: 0f2687e4efc69229
reviewed: 2026-10-31
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

The screen has five tabs: **Budgets**, **Forecasts**, **Budget vs
Actual**, **Cash forecast** and **Setup**. Choose the company at the top.

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

## Forecasts

A forecast is the year you now expect for the P&L: the actual figures
for the months so far, then your estimate of the months ahead. Forecasts
need no approval.

1. In **Forecasts**, choose the **Financial year** and the month the
   **Actuals to** run to (the month before this one is suggested), then
   select **New forecast**. The year needs an approved budget: the
   months ahead start from its Current version.
2. The forecast opens on the same grid as a budget. The actual months
   are shaded and can't be changed. Change the months ahead, or type a
   total in the **Year** column: what remains after the actuals is
   spread over the months ahead.
3. **Save draft** as you go, and **Finalise** when it is done. A final
   forecast is kept as it is.

Make a new forecast each month or quarter: the list shows each one's
revenue, costs and profit for the year, so you can see how the
expectation moved. Only one draft forecast of a year at a time.

> Example: with actuals to March, Sales of 1,000 a month so far and a
> year total of 15,000 typed, the nine months ahead get 1,333.33 each
> (the last month takes the rounding).

## Budget vs Actual

Choose an approved **Budget** (the Current one first), the month the
**Year to date** runs **through**, a final **Forecast** to show beside it
(the latest is suggested; **None** for none), and how to **Show** it: each budget
line, by account, by group or by class (the headings of the Chart of
Accounts). Select **Run**.

| Column | What it shows |
|---|---|
| Month budget, Month actual | The chosen month. |
| YTD budget, YTD actual | From the year's first month to the chosen month. |
| YTD variance, % | Actual less budget, and as a % of the budget. Green is better than budget (more revenue, less cost), red worse. |
| Year budget | The whole year. |
| Year forecast, Forecast less budget | With a forecast chosen: the year it expects, and how far that is from the budget (green better, red worse). |

- Lines are grouped as revenue, cost of sales and expenses, with their
  totals and the **Profit**, then the balance sheet.
- An actual with no budget line that fits shows as **not budgeted**.
- Select an actual to open its lines in the
  [General Ledger report](general-ledger.html).
- **Copy** copies the table for Excel.

## Cash forecast

The company's cash from today: its cash and bank balances now, then the
next 13 weeks and each month to the financial year's end, with the money
in, the money out and the balance at the end of each. Select **Run**.

What fills it, as **Setup** says:

- **Open items for the 13 weeks, then the budget** (to start);
- **Open items only**;
- **The budget only**.

| Open items | When they count |
|---|---|
| Customers' and vendors' open invoices | On their due date (the invoice date plus the party's payment terms), less credits not applied and cheques already in hand. |
| Post-dated cheques received or issued | On the cheque date. |
| Open Purchase Orders (approved, not yet received) | On the vendor's payment terms from the order's date. |
| Payroll | The last posted payroll's net pay, at each month's end. |
| Recurring entries with fixed amounts | Their cash and bank lines, on each date due. |

The budget counts as cash in the month it is budgeted: revenue in, costs
out; with balance-sheet lines as movements, an asset bought is cash out
and a loan drawn cash in. A month's amount is shared by its days between
the periods.

- Invoices already **overdue** are shown above the table and **not
  counted** in any week: select a total to see them.
- Select an amount to see the documents behind it.
- **Copy** copies the forecast for Excel.

> Example: with 4,000 in the bank, a vendor's bill of 1,000 due in five
> weeks and payroll of 2,500 at the month's end, the balance falls to
> 1,500 at the month's end and to 500 in week 5.

## The spending check

When a **Purchase Order** is submitted, or a **Vendor Invoice** with
direct lines is posted, each line is checked against the year's Current
budget: the budget line it counts against (an account and cost centre
with no budget line counts as a budget of zero), over the period set in
**Setup**, against what is already spent.

- **Spent** is the posted figures, and, if the company counts them, open
  Purchase Orders (approved, the quantity not yet received).
- A Purchase Order counts its lines at the vendor's prices; a Vendor
  Invoice only its direct lines (goods received were counted at the
  goods receipt). Requisitions have no prices and aren't checked.
- A year without an approved budget isn't checked.

What happens over budget depends on the company's setting:

| Setting | Over budget |
|---|---|
| Off | Nothing; Budget vs Actual still shows it. |
| Warn | The message says by how much, line by line. **OK** goes ahead; the overrun is kept on the document, and its approvers see it (on the document and on the phone's approval card). |
| Block | Refused. Someone with Budget's *override* right may go ahead, giving a reason, which is kept with the document. |

> Example: Rent for cost centre *CC1* has 1,000 a month. In March, with
> 2,700 spent and 200 on open orders, a Purchase Order of 300 is 200 over
> the year to date (3,000).

## Setup

**Setup** says, for the company, how the spending check works:

- **The spending check**: Off, Warn or Block (Warn to start).
- **Checked against the budget of**: the document's month, the year to
  date through its month (to start), or the whole year.
- **Counted as spent**: the posted figures only, or the posted figures
  and open Purchase Orders (to start).
- **The cash flow forecast comes from**: open items for the 13 weeks then
  the budget (to start), open items only, or the budget only.

And how balance-sheet lines are budgeted:

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
Setup; *override* goes ahead over budget where the spending check
blocks. Approving follows the approval levels.
