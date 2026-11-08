# MIS: management reports and a customisable dashboard

Status: **design agreed** (owner, 2026-11-08, Q427-Q434); building in five phases (below).

## The request (owner, 2026-11-08)

"We need to develop a Management Information System (MIS) Reporting Module
that is fully customizable. Users should be able to select, configure, and
add the reports they require." The owner listed:

- Profit and Loss, Balance Sheet, Cash Flow;
- Accounts Receivable and Accounts Payable;
- Stock-in-Hand;
- Fast- and Slow-Moving Stock;
- Salesperson / Representative-wise Sales;
- Financial and Accounting Ratios;
- other operational and financial reports as required;
- a mobile view.

The **dashboard** shows key indicators: total sales, revenue, expenses, bank
balances, receivables, payables and stock value. **Charts** are available
wherever they fit. **Comparison** with previous periods, month over month
in particular, shows the absolute and % variation.

## What exists already (the MIS builds on it)

| Need | Today | Gap |
|---|---|---|
| P&L, Balance Sheet, Cash Flow | Their own screens (the ported code) | No month-on-month comparison, no chart, no dashboard tile |
| Receivables, payables | Customer / Vendor Aging, statements (agingReports.js, partyStatement.js) | Totals and top parties for a tile |
| Stock in hand | Stock Valuation, Inventory Valuation, Stock Availability | A total and a by-category view |
| Fast / slow moving | Inventory Aging (age of stock on hand) | Movement over a period (quantity sold / issued) |
| Sales by rep | Sales reps and their receipts (salesRep.js), CRM reports | Sales (invoiced) by rep, by month |
| Ratios | None | All |
| Bank balances | GL Report per account | One tile for every bank and cash account |
| Budget vs actual | Budget vs Actual (budget.js) | Could be a dashboard tile |
| Monthly GL figures | The journal-entry index by company and date (the Budget's) | Reused for every monthly figure |
| Charts | None in the app | A chart library |
| Phone layout | PHONE_VIEW.md: Home, approvals, 7 reports | The MIS screens join it |

## The proposal

### The parts

1. **A report catalogue.** It is a fixed list of report *types*, built and
   tested here:
   - P&L;
   - Balance Sheet;
   - Cash Flow;
   - AR and AP (aging buckets, top parties);
   - Stock in Hand (by category, by warehouse);
   - Fast / Slow / Non-moving stock;
   - Sales by Rep;
   - Sales by Customer, Item and Category;
   - Expenses by Account and Cost Centre;
   - Ratios;
   - Bank and Cash balances;
   - Budget vs Actual.

   Each type takes parameters: company, period, comparison, grouping,
   top N, and chart type.
2. **"My reports".** A user saves a report from the catalogue with their
   own parameters, under their own name. For example: "Monthly P&L, Trading
   company, vs last month, as a bar chart". New report types can be added
   later as the business asks for them ("other reports as required").
3. **The dashboard.** A grid of **tiles**, each a KPI (a figure with its
   change against the comparison period) or a small chart, picked from the
   same catalogue. Users add, remove and arrange tiles and choose each
   tile's period and comparison. A tile opens its full report.
4. **Comparison on every report and tile:** this month vs last month (the
   default), vs the same month last year, year-to-date vs last
   year-to-date, and vs budget where a budget exists. Each shows the
   absolute and % variation, coloured up or down by the measure's sense
   (expenses up is bad).
5. **Charts:** bar, line, pie / donut, and a trend line over 12 months,
   where the data fits. Every report can also be shown as a table.
   Copy to Excel and print, as elsewhere.
6. **Phone:** the dashboard as a single column of tiles, the reports as
   cards with a sheet for the filters, as PHONE_VIEW.md does today.

### How the figures are made

- **GL figures** (P&L, Balance Sheet, expenses, ratios, bank balances)
  come from posted journal entries by company and month, through the
  Budget's index. They are grouped by the chart of accounts' class and
  group (COA_NUMBERING.md):
  - 400000 revenue;
  - 500000 cost of sales;
  - 600000 expenses;
  - the asset and liability groups.

  So the MIS agrees with the Trial Balance by construction.
- **Operational figures** come from their own stores, read with equality
  queries:
  - sales from customer invoices and retail sales;
  - stock from the stock ledger;
  - movement from stock transactions;
  - AR and AP from the party ledger.
- **Ratios** need some accounts named as *current* and *non-current*
  (assets and liabilities), *inventory*, *cash*. That is a short MIS
  setup, the "ratio map", set once by Finance and seeded from the chart's
  groups (Q432).
- **Everything is computed when opened**, per tile, so the dashboard fills
  in as each tile arrives. No figures are stored, so they are never stale.
  If volume later makes a tile slow, monthly totals can be kept as each
  entry posts, and that is a later step.

### Rights and data

- A module `MIS` with three rights:
  - **access**: see the MIS;
  - **design**: create and save reports and one's own dashboard;
  - **publish**: make a dashboard the default for a role, as favourites
    per role do.

  A user sees only their companies' figures.
- Firestore:
  - `misReports/{id}`: a saved report (owner, type, parameters, name,
    shared or not);
  - `misDashboards/{uid or role}`: the tiles and their layout;
  - `misSetup/{companyId}`: the ratio map and the fast / slow
    thresholds.

## The owner's decisions (2026-11-08)

| # | Question | Decision |
|---|---|---|
| Q427 | "Fully customisable": how far | **The catalogue, saved reports and the tile dashboard, and also a free report builder.** |
| Q427b | The builder's sources | **Curated data sets**, not raw tables. Each is a vetted view with known fields, company access and signs applied, that the user can't get past: GL lines, sales invoice lines, purchase invoice lines, stock movements, stock on hand, party open items, retail sales, payroll by element. The user picks the fields, filters, grouping, totals (sum, count, average), sort, chart and comparison. |
| Q428 | Whose dashboard | **Each user their own; an admin publishes a default per role**; a user can reset to it. |
| Q429 | Comparisons | **All four:** previous month (the default), the same month last year, YTD vs last YTD, and vs budget where one exists; absolute and %. |
| Q430 | Charts | **Chart.js, shipped with the app** (Hosting), no CDN at run time; light and dark themes. |
| Q431 | Fast / slow moving | **By days of stock cover:** stock on hand ÷ average daily sales (or issues) over a period. Under 30 days is fast, over 90 days is slow, and stock with no movement is non-moving. The thresholds can be changed per company. |
| Q432 | Ratios | **A ratio map from the chart's groups**, seeded and editable by Finance. The starting set: current, quick, gross and net margin, debtor, creditor and stock days, debt-to-equity, return on assets. |
| Q433 | A rep's sales | **The rep named on each document:** a Sales Rep field on Customer Invoice, Sales Order and Retail Sale, carried from the order to its invoice. A rep's sales are their invoices less returns. This is a behaviour change to ported screens, recorded in each module's doc. |
| Q435 | (owner, 2026-11-08, revising Q433) Where a customer's rep is set | **In the Customer master only:** a Sales Rep field on the customer. Sales Invoice Configuration's Sales reps tab keeps each rep's own setup (code, manager, active) and shows the rep's customers read-only. |
| Q436 | The rep on a document | **Defaults from the customer and can be changed until the document is posted or confirmed;** after that it is fixed like every other field, so a reported month's figures don't move. |
| Q437 | Which documents carry it | **Quotation, Sales Order, Customer Invoice and Retail Sale.** It passes along the chain: quotation → order → delivery note → invoice → sales return keep the earlier document's rep. A Retail Sale has no customer default (one walk-in customer): the cashier picks the rep or leaves it blank. |
| Q438 | The customer's rep changed | **Documents already made keep their rep;** only new documents take the new one. |
| Q439 | (phase 2, 2026-11-08) Where the dashboard lives | **Its own MIS Dashboard screen; each user may choose to show it on Home too, off by default.** |
| Q440 | Who sets a role's default dashboard | **Users with the MIS publish right** (Admin and Finance Manager by default): "Make default for role…"; a user changes their own and can Reset to the role's. |
| Q441 | Tile kinds | **Key figure** (a number with its change and %), **Chart** (any report as bar or line), **Top list** (a report's top 5), **Gauge / ratio** (a ratio against a target band). |
| Q442 | How fresh | **Worked out when opened**, the same figures as MIS Reports; each tile loads on its own. |
| Q443 | (phase 3, 2026-11-08) Who sees a saved report | **The owner's own, or shared with chosen roles by a user with MIS publish;** those roles see it under "Shared with me", read-only. |
| Q444 | A saved report's month | **Chosen when saved:** "the latest month" (rolls forward) or a fixed month. |
| Q445 | The reports screen's layout | **The chart above the table,** the chart hideable; on a phone the chart, then the lines as cards. Copy to Excel and Print take the table. |
| Q446 | (phase 4, 2026-11-08) The builder's data sets | **Sales lines, purchase lines, GL lines and stock movements.** |
| Q447 | How far a user shapes a report | **Fields, filters, grouping (up to two), totals, sorting, and a pivot (rows × columns).** |
| Q448 | Who sees a data set's figures | **MIS access and the data set's own module** (Sales lines: Customer Invoice; Purchase lines: Vendor Invoice; GL lines: General Ledger; Stock movements: Stock Ledger), for the user's companies only. |
| Q449 | Where builder reports live | **In MIS Reports, saved as My reports:** shared, charted and usable on the dashboard like the catalogue's reports. |

Taken as the plain reading (say if any should differ): **Q434**, scheduled or
emailed reports, is not in the first release.

## Build plan (after the design is agreed)

Five phases, each its own PR and deploy:

1. **The engine:**
   - monthly GL buckets (the Budget's index) and store reads, with the
     comparison maths (four comparisons, absolute and %);
   - the catalogue's report types (P&L, Balance Sheet, Cash Flow, AR and
     AP, stock in hand, stock cover fast / slow / non-moving, sales by
     rep, customer, item and category, expenses, ratios, bank and cash,
     budget vs actual);
   - the MIS setup (ratio map, stock-cover thresholds);
   - the **Sales Rep field** on Customer Invoice, Sales Order and Retail
     Sale;
   - the module and rights (access, design, publish).

   Pure builders with unit tests, emulator tests, negative controls.
2. **The dashboard:** tiles (KPI with change, small chart), add, remove,
   arrange, period and comparison per tile, the role default and Reset;
   Chart.js in public/; the phone's single column.
3. **The reports screen:** the catalogue, parameters, table and chart, the
   comparison columns, "My reports" (save, rename, share with the role),
   Copy to Excel, print, the phone cards.
4. **The report builder:** the curated data sets (their fields, filters,
   grouping, totals), saved as "My reports" and usable as dashboard tiles.
5. **Help** (a new MIS area and pages), What's new, docs, and the last
   deploys.

## Phase 1c: the sales rep (decisions Q435-Q438, 2026-11-08)

- **Customer master:** a Sales Rep field (the company's active reps), saved
  as the existing `customers/{id}.SalesRepEmployeeID`, so the Employee
  Portal's "my customers" keeps working unchanged. The Sales reps tab in
  Sales Invoice Configuration stops assigning customers (`saveSalesRep`
  no longer takes a customer list) and shows each rep's customers
  read-only.
- **Documents:** `SalesRepEmployeeID` on Quotation, Sales Order, Delivery
  Note, Customer Invoice, Sales Return and Retail Sale. A new document
  takes the customer's rep; a document made from another takes that
  document's rep (quotation → order → delivery → invoice → return).
  Editable while a draft; the save refuses a rep who is not an active rep
  of the document's company; posting or confirming fixes it. A rep's own
  portal orders and quotations keep the rep who made them.
- **Reports:** MIS "Sales by rep" (invoices and retail sales less their
  returns, by the document's rep, with the four comparisons). Documents
  made before this have no rep; they show as "No rep".
- Behaviour changes to ported modules (Customer Master, Sales Order,
  Delivery Note, Customer Invoice), recorded in their docs.

## Fix: the MIS on a phone (2026-11-08)

The owner's request included "mobile view also". Phases 2-4 laid the
screens out for a phone (the report's lines as cards with their column
names, the tiles in one column), but MIS and MISDASHBOARD were not in the
shell's PHONE_SCREENS (PHONE_VIEW.md), so on a phone they opened at a
computer's width with its notice, and the cards never showed (the UI test
had set the phone class by hand). Both are in PHONE_SCREENS now;
ui/phoneView.ui.js opens the real screens at a phone's size: the phone's
width, nothing wider, the lines as cards, the tiles one per row (negative
control: without the two screens in the list, it fails). Hosting only.

## As built: phase 5, Help (2026-11-08)

The Help area "Management reports (MIS)" is written: **MIS Dashboard**
(mis-dashboard: the tiles, which dashboard one sees, editing, a role's
default, Show on Home), **MIS Reports** (mis-reports: the reports, the
comparisons, Copy and Print, My reports and sharing, the MIS setup) and
**Build a report** (mis-report-builder: the data sets and their rights, the
three ways to show them, filters, sorting, saving). What's new links them.
Getting started's "Your dashboard on Home" now follows "Home tasks" (the
Help UI test expects the pages' sections in that order; it had failed
since phase 2). The MIS module is complete; scheduled reports (Q434) were
left out of the first release.

Deploy: Hosting only (the Help).

## As built: phase 4, the report builder (2026-11-08)

Decisions Q446-Q449 (above), built as designed:

- **functions/src/misQuery.js**, the pure engine (unit/misQuery, 5 tests):
  filters (equals, not equals, contains for text; after / before / between
  for dates, months and numbers; text without case; a date "equal" to a
  month means that month), a list of up to 12 columns with totals, a
  grouping by one or two fields with up to four totals (total, count,
  average, lowest, highest; "(none)" for a blank), a pivot (rows × the 24
  busiest columns, with row and column totals), sorting by any column, up to
  500 rows; `asReportRows` turns a grouping or pivot into a chart's rows.
- **functions/src/misBuilder.js**, the data sets, each read by month for
  1-24 months ending at the report's month (at most 20,000 lines):
  - *Sales lines*: invoice lines (from delivery notes, item lines, direct
    lines), retail sales, sales and retail returns (negative); customer,
    rep, item, category, account, sales type, cost centre, project, quantity,
    amount.
  - *Purchase lines*: vendor invoice lines from their GRNs (stock and
    non-stock) and direct lines; vendor, item, category, account.
  - *GL lines*: each posted journal line: voucher type, account and its
    type, party, cost and profit centre, project, debit, credit, net.
  - *Stock movements*: each posted stock line as the Stock Ledger reads it
    (its Direction; a warehouse movement out of one, into the other);
    quantity and value signed (in +, out −).

  Amounts in the base currency, before tax, after each document's discount
  (shared over its lines); reversed documents and their reversals left out.
  `getMisDatasets` (only the data sets whose module the user may open:
  Customer Invoice, Vendor Invoice, General Ledger, Stock Ledger, Q448),
  `runMisBuilder`, `runSavedMisBuilder` (a saved built report as chart rows,
  for its owner and the roles it is shared with).
- **Saved:** `misReports` takes `Type: 'builder'` with `Builder: { dataset,
  months, spec }`, checked; shared and opened like the others.
- **Dashboard:** a tile's report may be `saved:<id>` (a chart or a top
  list), drawn by the shell's tiles through runSavedMisBuilder.
- **screens/MIS.html:** "Build a report…" in the report list: the data set,
  the months, Grouped / Pivot / List, the fields and totals, filters; a
  column header sorts; the chart (the first grouping by its first total)
  above the table; Copy, Print, Save as. **MISDASHBOARD.html:** "My built
  reports" in a chart or top-list tile's report list.
- Tests: unit `misQuery` (5); emulator `misBuilder` (the four data sets
  from real postings, the discount shared, the rights, a saved built report
  and its rows), `misDashboard` (+ a built report's tile kinds); UI `mis`
  7/7 (+ the builder: grouped over two months, sorted, filtered, pivoted,
  saved), `misDashboard` 5/5 (+ a built report as a chart and a top list).
  Negative controls caught: text filters with case; a pivot's cells
  ignoring its column; the data set's module not checked; the invoice
  discount not shared; the screen's view ignored.
- Deploy set `mis-builder`: 12 functions, --screens (MIS, MISDASHBOARD),
  then Hosting.

## As built: phase 3, the reports screen (2026-11-08)

Decisions Q443-Q445 (above), built as designed:

- **functions/src/misReports.js:** Firestore `misReports/{id}` `{ OwnerUID,
  OwnerName, Name, Type, CompanyID, Mode, Chart, Period: { kind:
  'latest'|'fixed', month }, SharedRoles }`. `getMyMisReports` (mine, and
  those shared with my role: two single-field queries), `saveMisReport`
  (MIS design; new, or the owner's change; at most 100 per user; the
  company the user's), `shareMisReport` (MIS publish; the owner's; known
  roles; [] private again), `deleteMisReport` (the owner). Only the owner
  changes, shares or deletes; the roles see it read-only. Data Reset clears
  them with "Numbering & Settings". No module change (part of MIS).
- **screens/MIS.html:** My reports (Mine / Shared with me), Save as… (name,
  opens on the latest month or this month kept), Save changes, Share (role
  ticks), Delete; the chart above the table (Bars / Line / No chart) through
  the shell's `misTiles.chart` (now shared with the dashboard's tiles);
  Copy (tab-separated for Excel; the shell formats its dates) and Print;
  on a phone each line a card with its column names.
- Tests: emulator `misReports` (saved, shared and read-only, fixed or
  latest, the owner's changes, the checks, the rights); UI `mis` 6/6 (+3:
  the chart and Copy, Save as / reopen / share / read-only, phone cards).
  Negative controls caught: anyone may change a report; the phone cards'
  column names dropped. (Copy's dates without the screen's own formatting:
  not caught, because the shell formats copied text itself.)
- Deploy set `mis-reports`: 7 functions, --screens (MIS), then Hosting.

## As built: phase 2, the dashboard (2026-11-08)

Decisions Q439-Q442 (above), built as designed:

- **Module `MISDASHBOARD`** (moduleRegistry.js; right: access, by default the
  roles with MIS access), its own tree node "MIS Dashboard" before MIS
  Reports, in the Help area "Management reports (MIS)" (unwritten until
  phase 5). A tile's figures need MIS access (runMisReport checks it);
  changing one's own tiles MIS **design**; a role's default MIS **publish**.
- **functions/src/misDashboard.js:** Firestore `misDashboards/{uid}`
  `{ Tiles, ShowOnHome }` and `misRoleDashboards/{role}` `{ Tiles }`.
  `getMisDashboard` (one's own, else the role's, else the starter set of
  seven tiles: sales, net profit, bank and cash, receivables, the 12-month
  trend, the largest receivables, the current ratio gauge), `getMisHomeChoice`
  (Home's one small call), `saveMisDashboard` (tiles and / or the Home
  choice), `resetMisDashboard` (one's own tiles removed, the Home choice
  kept), `saveMisRoleDashboard` (a role's default, or `tiles: null` to remove
  it). Each tile checked: kind (kpi, chart, top, gauge), a catalogue report,
  the figure for a key figure or gauge, a gauge's band (low under high), the
  comparison; at most 24; ids made unique. Data Reset clears both with
  "Numbering & Settings".
- **Chart.js 4.4.4** (MIT) in `public/vendor/chart-4.4.4.umd.js` with its
  licence, loaded only when a chart tile is drawn (Q430); the hosting guard
  (unit/hostingGuards) allows `public/vendor/` only versioned library files.
- **The shell's MIS TILES block** (`misTiles.render`, `misTiles.home`):
  draws the tiles on the screen and on Home; tiles asking the same report
  share one runMisReport call; chart labels go through the shell's date
  format (`window.formatDatesInText`, now exported), so months read Nov-2026
  on a canvas too; light and dark ink.
- **screens/MISDASHBOARD.html:** company, month, Show on Home, Edit (add a
  tile: kind, report, figure, comparison, chart style, good band, title;
  remove; move earlier / later), Save my dashboard, Reset, and for MIS
  publish "Make default" for a role / "Remove the role's default". The
  figure list loads from the chosen report; only the latest request fills
  it (a quick kind-then-report choice asked twice and the slower answer
  overwrote the choice: found by the UI test).
- **Home:** a hidden "My dashboard" block, shown only for a user who ticked
  Show on Home (getMisHomeChoice; nothing else is read otherwise).
- Tests: emulator `misDashboard` (the starter set, a role's default, one's
  own, Reset, the Home choice, the checks, the rights); UI `misDashboard` (4:
  the starter tiles from real postings with the chart's Mon-yyyy months,
  Edit and Save with a gauge, a role's default, Show on Home). Negative
  controls caught: anyone may set a role's default; chart labels not
  formatted; a screen file dropped in `public/vendor/`.
- Deploy set `mis-dashboard`: every function (moduleRegistry.js), --screens
  (MISDASHBOARD), then Hosting (the shell, Chart.js, Help). No rules change.

## As built: phase 1c, the sales rep (2026-11-08)

Decisions Q435-Q438 (above), built as designed:

- **docRep.js** (new): `checkRep` ('' or an active rep of the company: a
  customer of every company takes any active rep), `documentRep(given,
  companyId, { customerId, existing, source })` (a value sent is checked;
  none sent takes the draft's own rep, else the source document's, else the
  customer's, a default no longer valid dropped), `sourceRep`,
  `invoiceRepSource`, `customerRepField` (only when sent: an import leaves
  the rep), and the callable `getSalesRepChoices({ companyId, customerId })`
  (the company's active reps by name; the customer's rep).
- **Ported modules (patches `sales-rep (…)` in tools/legacy-port/patches.js,
  behaviour changes recorded here):** Customer Master's save
  (`SalesRepEmployeeID`, checked); Sales Order save (new and draft edit);
  Delivery Note save (its first order's rep); Customer Invoice save (its
  first Delivery Note's or order line's rep); the Delivery Notes offered to
  an invoice carry their rep. Customer Master's screen through SCREEN_EDITS.
- **Hand-written:** Quotation (quotations.js; the portal's rep is the rep),
  Sales Return (the invoice's rep), Retail Sale and its return
  (retailSales.js), the order lines offered to an invoice
  (invoiceStock.js), `saveSalesRep` no longer assigns customers
  (salesRep.js); screens SALESORDER, DELIVERYNOTE, CUSTOMERINVOICE,
  QUOTATION, RETAILSALES, SALESINVOICESETUP (the rep's customers read-only).
- **The shell:** `salesRepPicker.fill / forCustomer` (public/index.html,
  SALES REP block; the UI harness slices it).
- **MIS:** report type `salesByRep` (misData.salesByRep: invoices and retail
  sales before tax, less sales and retail returns, by each document's rep;
  "No rep" for documents without one).
- **Fixed in phase 1:** `runMisReport` turned "no row limit sent" into a
  limit of 1 (`Math.max(1, 0)`), so Expenses, Receivables, Payables and
  Sales by customer showed only their first row (their totals were right).
  Now 0 means each report's own default.
- Tests: emulator `salesRepDocs` (2: the chain, the checks, the report; the
  tab), `retailSales` (+1), `salesRep` and `repCollections` (set the rep in
  Customer Master now); UI `salesRepDocs` (2), `salesRepPortal` (the Customer
  Master field). Negative controls caught: another company's rep accepted;
  the draft's own rep ignored; returns added to a rep's sales, not taken
  off; the order's customer default removed (UI).
- Deploy set `mis-rep`: every function (the legacy port is regenerated:
  moduleRegistry-like reach), --screens, then Hosting (the shell, Help).

## As built: phase 1, the engine (2026-11-08)

The Sales Rep field (the rest of phase 1) follows as phase 1c, its own PR:
it changes ported screens (Sales Order, Customer Invoice, Retail Sale).

- **functions/src/misCalc.js**, the pure core (unit/misCalc.test.js):
  periods and the four comparisons (`prevMonth`, `lastYear`, `ytd` from
  the financial year's first month, `budget`); `variance` (the change,
  the % — none when the comparison is 0 — and whether it is good: more
  sales up, fewer expenses down); GL buckets by account and month from
  posted entries; the P&L and Balance Sheet groups by account type
  (postable accounts only; equity includes the profit not yet closed, so
  the check is 0); nine ratios from the ratio map; stock cover (days of
  cover = on hand ÷ the daily quantity moved: fast under 30 days, slow
  over 90, non-moving with stock and no movement).
- **functions/src/misData.js**, the readers, each an equality / range
  query: the company's posted journal entries by date (the Budget's
  index); the approved, current budget as GL buckets (natural sign turned
  to debit − credit); the parties' control accounts and items' inventory
  accounts (the ratio map's seed); the financial year's start (Period
  Closing's setting); stock on hand (the company's items); the quantity
  moved (Out lines of deliveries, invoices, retail sales, issues and
  production, less sales and retail returns; moves, adjustments and
  counts are not movement); sales by customer (posted invoices before
  tax, in base, less sales returns). Reversed documents and their
  reversals are left out.
- **functions/src/mis.js**, the module `MIS` (rights access, design,
  publish): `getMisCatalogue`, `runMisReport({ type, companyId, month,
  mode, top })`, `getMisSetup`, `saveMisSetup`. Report types: kpis,
  profitLoss, balanceSheet (no budget comparison), cashFlow (direct: each
  cash movement classed by its other side — operating, investing in fixed
  assets, financing in equity and loans), ratios, bankBalances, expenses,
  trend (12 months), receivables and payables (Aging's figures: top
  parties and the age buckets), salesByCustomer, stockInHand (by
  category, no comparison), stockCover. Every row: `{ key, label, level,
  current, compare, abs, pct, good }`.
- **The MIS setup** in Firestore `misSetup/{companyId}`: the ratio map
  (seeded from the chart until saved; only asset accounts on the asset
  side, liabilities on the other) and the stock-cover thresholds (fast
  under slow, 1-365 days). Saving needs the publish right. Data Reset
  clears it with "Numbering & Settings".
- **screens/MIS.html**, a plain first screen: report, company, month,
  comparison, Show; the table with the change and % coloured by whether
  it is good; the trend and stock cover in their own columns. The
  dashboard, charts and saved reports are phases 2 and 3.
- Tree: "MIS Reports" after Period-End Closing & Financial Statements.
  Help: a new area "Management reports (MIS)", unwritten until phase 5;
  a What's new entry.
- Tests: unit/misCalc (6), emulator/mis (every report type against real
  postings, the budget comparison, the setup's checks, access by company
  and right), ui/mis.ui.js (3). Negative controls caught: the unclosed
  profit dropped from equity; the variance sense flipped; the budget's
  natural sign not turned; the saved thresholds ignored; the good / bad
  colours swapped.
- Deploy set `mis-phase1`: every function (moduleRegistry.js), with
  --screens, then Hosting. No rules change.
