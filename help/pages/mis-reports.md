---
fingerprint: 377a9dad65bf83d9
reviewed: 2026-11-08
title: MIS Reports
area: mis
order: 2
modules: [MIS]
sources: [functions/src/mis.js, functions/src/misCalc.js, functions/src/misData.js, functions/src/misReports.js, screens/MIS.html]
summary: Management reports with their comparison, a chart above the table, Copy, Print, your saved reports and the MIS setup.
---
## What it is for

**MIS Reports** shows the management reports of a company for a month, each
compared with another period, as a chart above a table. Save the ones you use
in **My reports**, and share them.

## Before you start

- You need access to MIS Reports. Saving a report needs the MIS **design**
  right; sharing it, and the MIS setup, the **publish** right.

## The reports

To make your own report from the lines of sales, purchases, the GL or stock, see
[Build a report](mis-report-builder.html).

Profit and Loss, Balance Sheet, Cash Flow, financial ratios, bank and cash
balances, expenses by account, the 12-month trend, accounts receivable and
payable (with their ages), sales by customer, sales by rep, stock in hand,
and fast, slow and non-moving stock; and the key figures.

Sales by rep counts each document's own rep (set on the customer in
[Customer Master](customer-master.html#sales-rep), changeable on the document).

## The comparison

- **Previous month**, **the same month last year**, **year to date** (against
  the same months a year before), or **budget** (the approved budget).
- Each figure shows the change and its %, green when it is good, red when not.

## Step by step

1. Choose the report, the company, the month and the comparison; **Show**.
2. The chart: **Bars**, **Line** or **No chart**.
3. **Copy** puts the table on the clipboard for Excel; **Print** prints it.

On a phone each line is a card with its column names.

## My reports

- **Save as…**: a name, and whether it opens on **the latest month** (a
  monthly review) or keeps **this month** (for example the Sep-2026 file).
  It keeps the report, company, comparison and chart.
- Open it from **My reports**. **Save changes** and **Delete** are for your
  own reports.
- **Share** (MIS publish): tick the roles. Their users see it under **Shared
  with me**, read-only; they can **Save as…** their own copy.

## The MIS setup

The ratios use the **ratio map**: which accounts are current assets and
liabilities, cash, stock, receivables and payables. It starts from the chart
of accounts (cash and bank accounts, the customers' and vendors' control
accounts, the items' stock accounts); a finance manager can change it. Stock
cover uses the days of cover for fast (under 30 days) and slow (over 90
days) stock.

## Questions and mistakes

- **The Balance Sheet has no budget.** It compares with another period only.
- **A ratio shows —.** The ratio map has nothing for it yet (for example no
  current liabilities).
