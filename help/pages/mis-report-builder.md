---
fingerprint: 12ea2ff6bf4b9f93
reviewed: 2026-11-14
title: Build a report
area: mis
order: 3
modules: []
sources: [functions/src/misBuilder.js, functions/src/builtMis.js, functions/src/misQuery.js, screens/MIS.html]
summary: Your own report from sales, purchase, GL or stock lines, or a built module's records: filtered, grouped with totals, as a pivot or a list; saved and shared.
---
## What it is for

**Build a report** makes a report the catalogue does not have, from the lines
of a data set: for example sales by rep and month, purchases by vendor, or
stock movements by warehouse.

## Before you start

- MIS Reports access, and the data set's own module:
  - **Sales lines**: Customer Invoice;
  - **Purchase lines**: Vendor Invoice;
  - **GL lines**: General Ledger;
  - **Stock movements**: Stock Ledger;
  - a **built module**: that module.

## The data sets

- **Sales lines:** each invoice line, retail sale, and sales or retail return
  (returns negative): customer, rep, item, category, account, sales type,
  cost center, project, quantity, amount.
- **Purchase lines:** each vendor invoice line: vendor, item, category,
  account, cost center, project, quantity, amount.
- **GL lines:** each posted journal line: voucher type, account and its type,
  party, cost and profit center, project, debit, credit, and debit − credit.
- **Stock movements:** each stock line as the
  [Stock Ledger](stock-ledger.html) shows it: type, in or out, item,
  category, warehouse, quantity and value (in +, out −).

Sales lines and Purchase lines also have a **Variant** column (for example
*Room Invoice*, blank for an ordinary invoice) and each variant's extra
fields (for example *Room Invoice · Room*), so a variant's revenue can be
shown on its own.

### Built modules

Under **Built modules** in the data set list, each of your
[built modules](built-modules.html) is a data set of its own:

- **A master** (for example Rooms): one row per record, as it is today,
  whatever months are chosen: its code, name, whether it is switched off,
  and its fields.
- **A document** (for example Stays): one row per document dated in the
  months chosen: its number, date, month, status, fields, and the totals of
  its lines.
- **A document with lines** is also a second data set (for example
  *Stay – rooms*): one row per line, the document's own fields repeated on
  each.

A field that links to another built master brings that master's fields too,
for example a stay's room brings *Room · Room type*, so bookings can be
grouped by room type. A calculated field (for example *Nights* or *Net due*)
is a number like any amount. Long text fields are not in reports.

Amounts are in the base currency, before tax, after each document's discount.
In GL lines a discount is its own line, so an invoice's revenue there is the
full amount.

## Step by step

1. In MIS Reports, choose **Build a report…** in the report list.
2. Choose the data set and the months (1 to 24, ending at the month chosen).
3. Choose how to show it:
   - **Grouped with totals:** group by one field, then optionally a second
     (for example rep, then month), with one or two totals (total, count of
     lines, average, lowest, highest).
   - **Pivot:** rows (for example customer), columns (for example month)
     and the figure. At most the 24 busiest columns show.
   - **A list of lines:** tick the columns.
4. **Add a filter** as needed: a field, then *is*, *is not*, *contains*,
   *after / over*, *before / under* or *between*, and the value. For a date,
   *is* 2026-11 means that month.
5. **Show**. Click a column's heading to sort by it.
6. **Save as…** keeps it in My reports; share it and put it on the
   [MIS Dashboard](mis-dashboard.html) as a chart or a top list.

## Questions and mistakes

- **Too many lines.** Choose fewer months or add a filter.
- **A built module is missing from the list.** It is not published yet, it
  is a variant (its documents are in Sales or Purchase lines), or you do not
  have its access right.
- **"is not a number: count it instead".** Totals need a number field; for
  any other field choose *Count of lines*.
