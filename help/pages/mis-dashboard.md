---
fingerprint: e3bdfc6d52fe2e65
reviewed: 2026-11-08
title: MIS Dashboard
area: mis
order: 1
modules: [MISDASHBOARD]
sources: [functions/src/misDashboard.js, screens/MISDASHBOARD.html]
summary: Your tiles of key figures, charts, top lists and gauges, worked out when you open it; your own, or your role's.
---
## What it is for

The **MIS Dashboard** shows the figures you watch most, as tiles, for the
company and month you choose. Each tile is worked out when you open the
dashboard, from the same reports as [MIS Reports](mis-reports.html), so it is
always up to date.

## Before you start

- You need access to the MIS Dashboard, and to MIS Reports for the figures.
- To change your own tiles you need the MIS **design** right; to set a
  role's dashboard, the MIS **publish** right (Admin and Finance Manager by
  default).

## The tiles

- **Key figure:** one figure, for example *Sales 12,400.00*, with its change
  against the comparison and the %, green when the change is good (more
  sales, fewer expenses) and red when not.
- **Chart:** a report as bars or a line, for example the 12-month trend.
  Months read Nov-2026.
- **Top list:** the five largest lines of a report, for example the largest
  receivables.
- **Gauge:** a figure against the good band you set, for example a current
  ratio between 1.00 and 2.00. Inside the band it shows green, outside amber.
  "No figure for this period" means the report has nothing to measure yet
  (for a current ratio: no current liabilities in the
  [MIS setup](mis-reports.html#the-mis-setup)).

## Which dashboard you see

1. Your own, once you have saved one.
2. Otherwise your role's, if someone set one for it.
3. Otherwise the starter dashboard: sales, net profit, bank and cash,
   receivables, the 12-month trend, the largest receivables and the current
   ratio.

## Step by step

1. Open **MIS Dashboard** and choose the company and the month.
2. **Edit** to change the tiles: choose the tile, the report, the figure (for
   a key figure or gauge), the comparison, the chart style or the good band,
   and a title, then **Add tile**. Remove a tile with ×, move it with the
   arrows.
3. **Save my dashboard**. **Reset** removes your own tiles and shows your
   role's dashboard again.
4. To set a role's dashboard (MIS publish): while editing, choose the role and
   **Make default**. Its users who have not made their own see it.
   **Remove the role's default** takes it away.

A report you built and saved ([Build a report](mis-report-builder.html)) can be
a chart or a top list: choose it under **My built reports**.

## Show on Home

Tick **Show on Home** to see your tiles at the top of Home too, with their
company and **Open MIS Dashboard**. It is your own choice and off until you
tick it.

## Questions and mistakes

- **A tile says it cannot load.** You may not have access to MIS Reports, or
  the report does not fit the comparison (the Balance Sheet has no budget).
- **Charts could not load.** Reload the page; the charts come with the app.
