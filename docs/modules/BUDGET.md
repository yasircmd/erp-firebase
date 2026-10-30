# Budget and forecast (new module)

Status: **draft, questions open** (owner, 2026-10-30: "Prepare a Budget
and forecast module first, then customer credit control"). Q338–Q343
below are the owner's decisions; nothing is built until they are made.

## Today

- **Nothing budgets.** No budget or forecast code or data exists. The
  menu has placeholder nodes only ("Cost Center Planning & Budgeting",
  "Project Budgeting", "Predictive Forecasting Engines" …, treeSeedNodes.js).
  A project budget was deferred (PROJECTS_DIMENSIONS.md, decision 224).
- **What a budget would stand on:**
  - **Accounts:** one chart per corporate (RTDB `coa`), an account shared
    by every company or kept to one. Types Revenue (4), COGS (5),
    Expense (6) make the P&L; Asset, Liability, Equity the balance sheet.
    Headings (class, group, sub-group) total their accounts.
  - **Dimensions:** every GL line can carry a cost centre, profit centre
    and project (orgUnits), as each account's dimension rules require.
  - **Actuals:** posted GL entries (Firestore `journalEntries`, lines
    inside, amounts in the base currency). The year-end closing entry is
    left out of the P&L.
  - **The financial year:** per company, January–December or
    April–March (Period Closing → Setup); periods are yyyy-mm.
- **Reading actuals today is slow at scale:** the reports read every
  posted entry of the corporate and filter in memory. A report comparing
  12 months against a budget, per account and cost centre, needs a read
  by company and date range.
- **No spending checks:** a Purchase Requisition or Purchase Order is
  checked only by the approval thresholds. The nearest precedent is the
  reimbursement monthly limit, which flags an over-limit claim to the
  approver without blocking it.

## Proposed

1. **A budget** is, per company and financial year, an amount per
   account per month, in the base currency:
   - optionally per cost centre and / or project (a line without one is
     the whole company's);
   - entered on a grid (accounts down, months across, totals both ways),
     pasted from Excel, or started from **last year's actuals or budget
     ± a %**, an annual amount **spread evenly or by last year's
     pattern**;
   - totals by heading (group, class) as the Chart of Accounts nests
     them, so a budget can be read at any level.
2. **Versions and approval:** a budget is drafted, submitted and approved
   through Approval Configuration (a new "Budget" kind, levels by amount
   as today). The approved one is **Original**; a change later in the
   year is a **Revision** (approved again), the Original kept for
   comparison.
3. **Budget vs Actual** (the report): for a company and year, by account
   or heading, optionally by cost centre or project:
   - month, year to date and full year: budget, actual, variance and %;
   - **favourable / unfavourable** coloured by type (more revenue is
     good, more expense is not);
   - each actual opens its GL lines; copy to Excel; print.
4. **A forecast** (Q341): the expected full year, refreshed as the year
   goes on:
   - **closed months are actual**, the months ahead are the forecast;
   - the months ahead start from the budget, the run rate (the average of
     the last N months) or last year's same months, and can be changed
     by hand;
   - each forecast is saved with its date (e.g. "Forecast Jul-2026"),
     so the report shows Budget, Forecast and Actual side by side and how
     the forecast moved.
5. **Reading actuals fast:** a Firestore index on journal entries by
   company, status and date, so the report reads only that company's
   year. (No totals are stored; nothing changes in posting.)
6. **Rights:** Budget access, prepare (write), and report; approving
   through the approval levels.
7. **Later, by decision (Q342):** a warning, or a block, when a
   Purchase Requisition, Purchase Order or Vendor Invoice would take an
   account (and cost centre) over its budget, counting open orders as
   committed.

## Build plan (once agreed)

- **B1:** budgets (grid, Excel paste, copy from last year, spread),
  versions, approval; the Firestore index; Budget vs Actual.
- **B2:** forecasts (methods, saved snapshots), Budget / Forecast /
  Actual in the report.
- **B3 (if chosen in Q342):** the spending check on PR, PO and Vendor
  Invoice.

Each step with tests, Help (a new page in Finance), What's new.

## The questions

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q338 | **What is budgeted?** | (a) the P&L: revenue, cost of sales, expenses; (b) the P&L and the balance sheet (capital spending, loans, cash) | **(a)** first: it is what a budget is mostly read for; capital spending can follow as its own step. |
| Q339 | **How detailed?** | (a) by account per company; (b) by account, optionally per cost centre and / or project | **(b)**: managers are held to their cost centre; a line without one is the company's. It also gives the deferred project budget (decision 224). |
| Q340 | **Changing an approved budget** | (a) edit it, approved again; (b) Original kept, Revisions approved on top, both reportable | **(b)**: the Original stays for "against plan"; the latest revision is what spending is held to. |
| Q341 | **What "forecast" means** | (a) a rolling P&L forecast: actuals to date + the months ahead, re-estimated (by hand, from the budget, run rate or last year); (b) a cash flow forecast from open invoices, PDCs and payroll; (c) both | **(a)** now; (b) is a different tool (cash, not profit) and deserves its own design. |
| Q342 | **Spending against the budget** | (a) reports only; (b) a warning on PR / PO / Vendor Invoice over budget (approvers see it); (c) a block over budget | **(b)**, as a later step (B3), counting open POs as committed: it informs without stopping urgent buying, as the reimbursement limit does. |
| Q343 | **Multi-year projects** | (a) project budgets inside each financial year only; (b) a project's own budget for its whole life too | **(a)** now: one model; a life-of-project budget later if needed. |
