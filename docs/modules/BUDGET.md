# Budget and forecast (new module)

Status: **decisions made** (owner, 2026-10-30), Q338–Q345 below; the
design as revised for them is under "Agreed". Requested 2026-10-30:
"Prepare a Budget and forecast module first, then customer credit
control".

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

## Agreed (the owner's decisions, 2026-10-30)

| # | Decision |
|---|---|
| Q338 | **The P&L and the balance sheet** are budgeted. |
| Q339 | **By account, optionally per cost centre and / or project**; a line without one is the company's. |
| Q340 | **The approved Original kept; Revisions approved on top**, both reportable; spending is held to the latest revision. |
| Q341 | **Both forecasts:** the rolling P&L forecast and a cash flow forecast. |
| Q342 | **A per-company setting** in Budget Setup: reports only, warn, or block. |
| Q343 | **A per-company setting:** project budgets within each year only, or also a life-of-project budget. |
| Q344 | **A per-company setting:** balance-sheet lines entered as monthly movements, or as month-end closing balances. |
| Q345 | **A per-company setting:** the cash flow forecast from open items and the budget, open items only, or the budget only. |
| Q346 | **Forecasts need no approval** (owner, 2026-10-31): a dated estimate saved by someone with the write right; finalised, it is kept as it is. |
| Q347 | **A forecast's months ahead start from the Current budget** (owner, 2026-10-31); each line can be changed by hand. |
| Q348 | **What counts as spent, a per-company setting** (owner, 2026-10-31): the posted actuals only; the actuals and open Purchase Orders (approved, not yet invoiced: committed); or those and approved requisitions not yet ordered. Starts at actuals and open POs. |
| Q349 | **An account (and cost centre) with no budget line is checked as budget zero** (owner, 2026-10-31): unbudgeted spending is flagged like an overrun. |
| Q350 | **The period checked, a per-company setting** (owner, 2026-10-31): the month, the year to date or the whole year. Starts at the year to date. |
| Q351 | **No approved budget for the year: no check** (owner, 2026-10-31). |
| Q352 | **Requisitions are not checked** (owner, 2026-10-31): they have no prices; the check runs on Purchase Orders and Vendor Invoices' direct lines, and Q348's setting offers actuals only, or actuals and open POs. |
| Q353 | **Overdue invoices, separate and not counted** (owner, 2026-10-31): shown as their own lines (receivables and payables), not in any week. |
| Q354 | **An open invoice is expected on its due date** (owner, 2026-10-31): the invoice date plus the party's payment terms. |
| Q355 | **Open items, then the budget** (owner, 2026-10-31): with "open items + budget", the 13 weeks from open items, the months after from the budget. |
| Q356 | **Payroll: the last posted run's net pay, repeated** (owner, 2026-10-31) at each month's end.
| Q357 | **A project's life budget is by account, for its whole life** (owner, 2026-10-31): one amount per P&L account, no months, no cost centres; compared with all the project's actuals to date. |
| Q358 | **Approved and revised as a year's budget** (owner, 2026-10-31): the Budget approval levels, an Original and Revisions, one in preparation at a time. |
| Q359 | **Checked by the spending check, as the company's setting** (owner, 2026-10-31): a document line carrying the project is also checked against what is left of its life budget, with the same Off / Warn / Block. |

**Budget Setup** (per company, in the Budget module, a setup right): the
four settings above, each starting at the recommended option:

| Setting | Options | Starts at |
|---|---|---|
| Spending check (Q342) | Off (reports only) · Warn · Block | Warn |
| Project budgets (Q343) | Within each year · Also life of project | Within each year |
| Balance-sheet lines (Q344) | Monthly movements · Closing balances | Monthly movements |
| Cash flow forecast (Q345) | Open items + budget · Open items only · Budget only | Open items + budget |

What the settings mean in use:

- **Spending check:**
  - It applies to Purchase Requisitions, Purchase Orders and Vendor
    Invoices, by account and, where budgeted, cost centre or project,
    for the month, the year to date or the year (a setting too, starting
    at year to date).
  - Open POs count as committed.
  - **Warn** shows the overrun to the user and to the approvers (on the
    approval card too).
  - **Block** refuses the document over budget. A user with a new
    "override budget" right may go ahead, giving a reason, and the
    reason is kept.
- **A budget keeps the method it was made with.** A setting can change
  at any time, but a budget already made keeps its own (stored on it),
  so approved figures never change meaning; the next budget or revision
  uses the new setting.
- **Closing balances (Q344):** a balance-sheet line is entered as the
  balance expected at each month-end; the report compares it with the
  actual balance. **Movements:** the expected change each month; the
  budgeted balance is the actual opening plus the movements.
- **Life-of-project (Q343):** a project then has a budget of its own
  (per account, for its whole life, revised like a yearly budget),
  compared with all its actuals since it started, as well as its lines
  in each year's budget.
- **The cash flow forecast (Q345):** by week for the next 13 weeks and
  by month to the year's end, from today's bank and cash balances:
  - **open items:** customer and vendor invoices by due date, post-dated
    cheques by date, open orders, payroll and recurring journals;
  - **the budget:** the budgeted P&L and balance-sheet movements turned
    into cash, for what open items don't yet cover;
  - "open items + budget" uses both: the open items first, the budget
    for the rest.

## Build plan

- **B1:** Budget Setup; budgets for the P&L and the balance sheet
  (grid, Excel paste, copy from last year, spread; movements or closing
  balances), Original and Revisions, approval; the Firestore index;
  Budget vs Actual.
- **B2:** the rolling P&L forecast (methods, saved snapshots), Budget /
  Forecast / Actual in the report.
- **B3:** the spending check (off, warn or block, per company) on PR, PO
  and Vendor Invoice, with the override right.
- **B4:** the cash flow forecast.
- **B5:** life-of-project budgets.

Then customer credit control (owner, 2026-10-30), its own design.

Each step with tests, Help (a new page in Finance), What's new.

## The questions as asked

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q338 | **What is budgeted?** | (a) the P&L: revenue, cost of sales, expenses; (b) the P&L and the balance sheet (capital spending, loans, cash) | **(a)** first: it is what a budget is mostly read for; capital spending can follow as its own step. |
| Q339 | **How detailed?** | (a) by account per company; (b) by account, optionally per cost centre and / or project | **(b)**: managers are held to their cost centre; a line without one is the company's. It also gives the deferred project budget (decision 224). |
| Q340 | **Changing an approved budget** | (a) edit it, approved again; (b) Original kept, Revisions approved on top, both reportable | **(b)**: the Original stays for "against plan"; the latest revision is what spending is held to. |
| Q341 | **What "forecast" means** | (a) a rolling P&L forecast: actuals to date + the months ahead, re-estimated (by hand, from the budget, run rate or last year); (b) a cash flow forecast from open invoices, PDCs and payroll; (c) both | **(a)** now; (b) is a different tool (cash, not profit) and deserves its own design. |
| Q342 | **Spending against the budget** | (a) reports only; (b) a warning on PR / PO / Vendor Invoice over budget (approvers see it); (c) a block over budget | **(b)**, as a later step (B3), counting open POs as committed: it informs without stopping urgent buying, as the reimbursement limit does. |
| Q343 | **Multi-year projects** | (a) project budgets inside each financial year only; (b) a project's own budget for its whole life too | **(a)** now: one model; a life-of-project budget later if needed. |
| Q344 | **Balance-sheet lines** (asked after Q338 (b)) | (a) monthly movements, the balance = actual opening + movements; (b) month-end closing balances | **(a)**: the balance always starts from reality. |
| Q345 | **The cash flow forecast's sources** (asked after Q341 (c)) | (a) open items + the budget; (b) open items only; (c) the budget only | **(a)**: open items for the near term, the budget beyond them. |

## As built: step B1 (2026-10-30)

Live 2026-10-31 (PR #192; runs #247 rules and the index, #248 every function and the screens, #249 Hosting).

- **Server** (hand-written): `functions/src/budgetCalc.js` (pure: the
  year's months and label, natural signs, which budget line an actual
  line counts against, budget against actual, year to date, favourable,
  seeds, spreading) and `functions/src/budget.js` (the callables).
- **Data** (Firestore):
  - `budgets/{BUD-…}`: one version of a company's year. Fields:
    CompanyID, YearStart (yyyy-mm), YearLabel ("FY 2026",
    "FY 2026-27"), Version (0 the Original), Number ("Budget FY 2026
    Revision 1"), Status (Draft, Rejected, PendingApproval, Approved),
    Current, BalanceSheetMethod, Lines, Total (the approval amount),
    Notes and History. Each line holds AccountID, a snapshot of the
    account's code, name and type, CostCenterID, ProjectID and
    Amounts[12].
  - At most 5,000 lines. Each account, cost centre and project
    combination appears once.
  - `budgetSetup/{CompanyID}`: `BalanceSheet` ('Movements' by default,
    or 'Closing').
- **Signs:** amounts are in the account's natural sign: credit-side
  growth (revenue, liabilities, equity) and debit-side growth (costs,
  assets) are both typed as positive.
- **Which budget line an actual counts against:** the most specific line
  of its account that fits, in this order: cost centre and project, then
  cost centre, then project, then the account's company line. Anything
  else is "not budgeted". The year-end closing entry and earlier years
  are left out of the P&L.
- **Balance-sheet actuals** count only when the budget has balance-sheet
  lines; a P&L budget doesn't list the balance sheet as not budgeted.
  With balance-sheet lines, the report also reads the years before, for
  the opening balance:
  - movements: `BudgetBalance` = the actual opening + the budgeted
    movements;
  - closing balances: the actual balance at each month-end against the
    budgeted one, with the year to date being the month's balance, not
    a sum.
- **Versions and approval:**
  - `createBudget` makes the Original, or a Revision copied from the
    Current version (keeping its method). It is refused while another
    version of that year is open.
  - `submitBudget` sends it through Approval Configuration ("Budget";
    the amount is the year's budgeted costs). With no levels, it is
    approved at once.
  - Once approved, a version becomes Current, and the previous Current
    loses the flag but stays approved.
  - `decideBudgetApproval` works from the screen (Approve and Reject,
    for the approver's level; `getBudget` returns `MyLevel`) and from
    the phone's approval card (`approvalCard.DECIDE.BUDGET`).
- **Actuals by index:** `journalEntries` are queried by CompanyID and
  JVDate (a new composite index in firestore.indexes.json, so it is
  deployed with the rules first). Posted entries only; reports never
  read the whole corporate.
- **Screen** `screens/BUDGET.html` (hand-written):
  - **Budgets:** the list; one budget on a grid with accounts down and
    months across. You can add a line, fill from last year (actuals or
    budget, ± %, by cost centre or not), paste rows from Excel into a
    box on the screen, or type a year total, which is spread evenly or
    like last year's actuals.
  - The grid's foot shows revenue, costs and profit.
  - Save, Submit, Delete, Approve and Reject; the History.
  - **Budget vs Actual:** a version, the month, and the level (each
    line, account, group or class, from the chart's headings). Columns:
    month, YTD, variance and %, year. Variances are coloured, with
    totals per type and the profit. An actual opens the GL Report; Copy
    copies for Excel.
  - **Setup.**
- **The module:** `BUDGET` with rights access, write and setup; a tree
  node under Financial Accounting; the Help page help/pages/budget.md
  (Finance). Data Reset has a "Budgets" category (transactional) and
  "Budget Setup" (setup); the chart of accounts and org units can't be
  cleared while budgets use them.
- **Not in B1, as planned:** forecasts (B2), the spending check (B3), the
  cash flow forecast (B4), and life-of-project budgets (B5). Their Setup
  options come with their steps.
- **Tests:**
  - unit/budget (9);
  - emulator/budget (2): the whole life, refusals, the approval card;
  - ui/budget (4).
  - Negative controls, each caught and restored:
    - the previous Current kept;
    - the company line matched first;
    - the colours inverted.
- **Deploy:** "database rules" first (the index), then
  `tools/deploy-sets/budget-b1.txt` (every function, `--screens`), then
  "hosting".

## As built: step B2, forecasts (2026-10-31)

Live 2026-10-31 (PR #193; runs #250 the functions and the screens, #251 Hosting).

- **Data:** Firestore `budgetForecasts/{FC-…}`. Fields: CompanyID,
  YearStart, YearLabel, Sequence (1, 2, … per year), Number ("Forecast 2
  FY 2026 (actuals to 2026-07)"), BudgetID (the Current budget it started
  from), ActualsThrough (yyyy-mm, or '' for none), Status (Draft or
  Final), Lines (the P&L only, as a budget's), Notes and History.
- **Making one:** `createForecast` needs the year's Current approved
  budget. Its lines are `budgetCalc.forecastStart` over compare()'s P&L
  rows:
  - every budget line, and every P&L actual that isn't budgeted;
  - the actuals through ActualsThrough, then the budget (Q347).
  
  ActualsThrough defaults to the month before this one, kept within the
  year. Only one draft per year at a time.
- **Changing one:**
  - `saveForecastDraft` checks the lines as a budget's are, and P&L
    accounts only.
  - `budgetCalc.lockActuals` keeps the actual months exactly as the
    forecast was made, whatever is sent; a line with actuals can't be
    removed, only its months ahead set to 0.
  - `finaliseForecast` makes it Final and kept; no approval (Q346).
  - `deleteForecastDraft` deletes a draft.
- **The report:** `getBudgetVsActual` with `forecastId` (one of the same
  company and year). `budgetCalc.attachForecast` gives each row its
  Forecast[12] and YearForecast; a forecast line no row has comes as a
  row of its own. The report lists the year's final forecasts.
- **Screen:**
  - **Forecasts tab:** the list, with each forecast's year revenue, costs
    and profit, to show how the expectation moved; New forecast with the
    year and "Actuals to".
  - **The budget's grid:** the actual months are shaded and read-only; a
    Year total spreads what remains over the months ahead; Save draft,
    Finalise, Delete. Last year's seed, the spread pattern and Submit are
    the budget's only.
  - **Budget vs Actual:** a Forecast choice (the latest final suggested),
    with Year forecast and Forecast less budget columns (coloured as the
    variance), in the totals, the profit and Copy.
- **Data Reset:** the Budgets category clears forecasts too.
- **Tests:**
  - unit/budget, +3 (12 in all);
  - emulator/budget, +1 (3): refusals, the actuals locked, finalised,
    sequence, the report column;
  - ui/budget, +1 (5).
  - Negative controls, each caught and restored:
    - the actuals not locked on save;
    - the actual months typed on the screen.
- **Deploy:** `tools/deploy-sets/budget-b2.txt` (19 functions,
  `--screens`), then "hosting". No rules change.

## As built: step B3, the spending check (2026-10-31)

Live 2026-10-31 (PR #194; runs #252 every function and the screens, #253 Hosting).

- **Where it runs:**
  - `submitPurchaseOrder`, after its lines are merged and before its
    number is taken (patches `budget-check-po` and
    `budget-check-po-record`);
  - `postVendorInvoice`, before approval or posting (patch
    `budget-check-vi`).
  
  Both call `budgetCheckDocument_`, MAPPED to `budgetCheck.checkDocument`.
  Requisitions are not checked (Q352).
- **What is counted (`budgetCheck.js`):**
  - **A PO's lines:** a category line to the category's GL account, an
    item line to the item's inventory account. The PO's cost centre is
    used (PO lines have none), with no project. Amounts are in the base
    currency at the rate on the PO's date; with no base currency set, as
    they are.
  - **A Vendor Invoice's direct lines:** by account code, with the line's
    cost centre or the header's, the header's project, and its exchange
    rate. Its GRN part was counted at the GRN.
  - **Open POs (Committed = ActualsAndPOs):** approved, dated in the
    year; each line's quantity not yet received.
- **The comparison:** `budgetCalc.overruns` lines each up against the
  Current budget:
  - each line counts against its budget line (lineFor); no line means a
    budget of zero (Q349);
  - the window is the month, the year to date, or the year (Q350);
  - Budget is set against Spent (actuals), plus Committed, plus this
    document;
  - P&L accounts are always checked; balance-sheet accounts only where
    the budget has balance-sheet lines as movements;
  - only debits (spending) count.
  
  No approved budget for the year means no check (Q351).
- **Over budget:**
  - **Warn:** refused with the marker "Over budget (warning)" until the
    request carries `budgetConsent: { go: true }`.
  - **Block:** "Over budget (blocked; you may override with a reason)"
    for a user with Budget's new `override` right (Admin and Finance
    Manager to start), who goes ahead with `{ go, reason }`; for anyone
    else, "Over budget (blocked)".
  - The consent rides with the request (callable.js →
    `runWithBudgetConsent`), as the period lock's does.
  - The record (Mode, Period, the budget, Findings, Text, By, At, and
    Accepted or Overridden with its Reason) is kept on the document as
    `BudgetCheck`. Nothing is taken before the check (a PO gets its
    number after).
- **Screens:**
  - **PURCHASEORDER and VENDORINVOICE** (hand screens): `budgetGoAhead`
    asks "OK to go ahead" (warn) or for a reason (block), then resends;
    an "Over budget" banner shows on the document.
  - **The approval card** (`approvalCard.summarize` `Budget`) shows it.
  - **Budget → Setup:** the spending check, the period, and what counts
    as spent.
- **Not checked:** a PO revised after approval
  (`reviseAndResubmitPurchaseOrder`), Inventory Purchase Requisitions,
  and requisitions in general (Q352).
- **Tests:**
  - unit/budget, +1 (13): the periods, committed, budget zero, credits,
    the balance sheet;
  - emulator/budgetCheck (1): no budget; warn and go ahead with no PO
    number taken; block, no reason, override with a reason; without the
    right; actuals only; an invoice's direct line; off;
  - ui/budget, +1 (6): the PO screen's warning answered.
  - Negative controls, each caught and restored:
    - open POs never committed;
    - the screen not recognising the warning.
- **Deploy:** `tools/deploy-sets/budget-b3.txt` (every function,
  `--screens`), then "hosting".

## As built: step B4, the cash flow forecast (2026-10-31)

Live 2026-10-31 (PR #195; runs #254 every function and the screens, #255 Hosting).

- **Server:** `functions/src/cashForecast.js` (`getCashForecast`, the
  Budget module's access right) with the pure parts in `budgetCalc`:
  `cashBuckets`, `netPartyItems`, `budgetCash` and `cashForecast`.
- **The periods:** as at today (Asia/Dubai), 13 weeks from today, then the
  months (the first perhaps part of one) to the financial year's end
  (Period Closing's year start).
- **The opening:** the balance of the accounts marked Cash or Bank (COA
  CashBank), from the company's posted entries to today.
- **Open items (Q354, Q356):**
  - **Customers' and vendors' open invoices**, from the aging's
    partyAging (each item's due date and base outstanding). Each party's
    credits not applied, and its pending cheques, are taken off its
    oldest invoices.
  - **Pending PDCs**, on their cheque dates.
  - **Approved POs:** the value not yet received (at the rate today), due
    on the vendor's payment terms from the later of the PO date and today.
  - **Payroll:** the last posted run's net pay at each month's end.
  - **Active recurring journals with fixed amounts:** their cash and bank
    lines on each date due. Spread and period templates are left out,
    since their runs vary.
- **The budget as cash:** the Current budget's lines.
  - Revenue, liabilities and equity count as cash in; costs and assets
    as cash out.
  - The cash and bank accounts themselves are left out, and so are
    balance-sheet lines budgeted as closing balances.
  - A month's amount is shared by its days between the periods.
- **Modes (Budget Setup's CashForecast; Q345, Q355):**
  - OpenItemsAndBudget (to start): open items in the weeks, the budget in
    the months;
  - OpenItems: open items in every period;
  - Budget: the budget in every period.
  
  With no approved budget where one is used, the screen says so
  (`needsBudget`).
- **Overdue (Q353):** items dated before today are shown apart (receivable
  and payable, with their documents) and not counted.
- **Screen:** a **Cash forecast** tab.
  - It shows the cash and bank today, money in and out by row with
    totals, the net, and the balance at each period's end (negative in
    red), with the overdue totals above.
  - An amount opens its documents. Copy copies for Excel.
  - Setup gains the forecast's source.
- **Also:** the budget consent moved to `budgetConsent.js` (nothing
  required), so callable.js no longer depends on the budget's code. Later
  budget changes reach only the budget's functions, the PO and invoice
  submit, and Data Reset.
- **Tests:**
  - unit/budget, +4 (17): the periods, netting, the budget as cash, the
    modes and overdue;
  - emulator/cashForecast (1): the bank today, a bill on its due date, an
    overdue one apart, a cheque, payroll at month ends, open items then
    the budget, a missing budget said;
  - ui/budget, +1 (7).
  - Negative controls, each caught and restored:
    - cheques left out;
    - the balance row showing the net.
- **Deploy:** `tools/deploy-sets/budget-b4.txt` (every function, once,
  for callable.js; `--screens`), then "hosting".

## As built: step B5, life-of-project budgets (2026-10-31)

Live 2026-10-31 (PR #196; runs #256 functions and screens, #257 Hosting).

- **Setting (Q343):** Budget Setup's `ProjectBudgets`: `WithinYear` (to
  start) or `LifeOfProject`. Only with the second can a project budget be
  created.
- **Data:** a `budgets` document with `Kind: 'Project'`, `ProjectID`,
  `ProjectLabel`, `YearStart: ''`; each line's `Amounts` is one amount
  (the whole life), its `ProjectID` the project's, no cost centre.
  Numbered "Project budget <code> Original" / "Revision n"; a scope is
  `'P:' + ProjectID`, so Original, revisions, Current and one-in-progress
  work as a year's do (Q358).
- **Server (`budget.js`):** `createBudget` with `projectId` (an Active
  org unit of Type Project; a revision starts from the Current one);
  `saveBudgetDraft` takes P&L accounts only, one amount each;
  `getBudgetVsActual` refuses a project budget; `getProjectBudgetReport`
  (access right) gives per account the budget, the actual to date (every
  posted line carrying the project), what is left and the % used, with
  revenue, costs and the margin. Pure parts: `budgetCalc.projectLife`,
  `projectOverruns`.
- **The spending check (Q359):** `budgetCheck.checkDocument` also checks
  each project a document's lines carry against its Current approved life
  budget (all actuals to the document's date); the message names it "for
  the life of project …", and the record keeps `ProjectBudgets`. A PO
  carries no project on its lines, so in practice it is a Vendor
  Invoice's direct lines that are checked.
- **Screen:** Budgets has "Or a project's whole life" (shown with the
  setting); the grid for a project has one "Whole life" column and no
  cost-centre or project selects; Budget vs Actual lists project budgets
  and shows their report; Setup has the setting.
- **Tests:** unit/budget +1 (18): the life rows and overruns;
  emulator/projectBudget (1): refused without the setting, P&L only, one
  amount, approved, the report, an invoice warned against the life
  budget, a revision; ui/budget +1 (8). Negative controls, each caught
  and restored: the life actuals counting other projects' lines (unit); the check ignoring
  the life budget (emulator).
- **Deploy:** `tools/deploy-sets/budget-b5.txt` (the budget's functions
  and the PO / invoice submit and post, 20; `--screens`), then "hosting".
  No rules or index change.
