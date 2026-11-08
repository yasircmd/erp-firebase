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
