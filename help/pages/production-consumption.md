---
title: Production & Consumption Report
area: production
order: 4
modules: [PRODCONSUMPTION]
sources: []
summary: Report posted production output or net material consumption by date, category, and sub-category.
reviewed: 2026-10-12
fingerprint: 82300a2ffbcb7d7d
---
## What it is for

**Production & Consumption Report** has two report modes: **Production** totals finished output, while **Consumption** totals net component usage. Despite the module name, this screen does not enter or post material consumption; use Production and the stock movement documents to record activity.

## Before you start

- Production entries and stock movements for the selected period are posted.
- Item category/sub-category setup is correct if those filters will be used.
- The user has Production & Consumption report access for the selected company.

## Step by step

1. Open **Production & Consumption Report** and select either **Production** or **Consumption**.
2. Choose the company, date range, and optional item Category and Sub-Category filters.
3. Run the report. Review quantity and value by item, grouped with subtotals by category/sub-category and a grand total.
4. Copy the table to Excel or print it for a period review. Use [Material Variance](material-variance.html) when the question is expected BOM consumption versus actual consumption.
5. If a movement is wrong or missing, correct the source Production, Material Issue, Stock Adjustment, or Physical Count document; rerunning this report only rereads posted transactions.

## What happens in the books

This is a read-only report and does not change stock or post a journal. Production mode reports posted output; Consumption mode nets Material Issue, Stock Adjustment, and Physical Count movements, including reversals, for the date range.

## Rights

The Production & Consumption Report access right controls viewing. Posting rights belong to the source Production and inventory modules, not this report.

## Questions and mistakes

- **Consumption total differs from Material Issue:** Stock Adjustment and Physical Count movements are included too; check the net quantity for each item and date range.
- **Production and consumption do not reconcile:** production output and component consumption are separate movement types; use Material Variance for BOM standard versus actual usage.
- **Sub-Category filter is empty:** add and activate sub-categories under the item's fixed parent category, then assign them in Item Master.
- **Report is empty:** confirm the company/date range and that source transactions are Posted, not Draft, pending, or rejected.

## Related pages

[Production](production.html) · [Material Issue](material-issue.html) · [Stock Adjustment](stock-adjustment.html) · [Physical Count](physical-count.html) · [Material Variance](material-variance.html)
