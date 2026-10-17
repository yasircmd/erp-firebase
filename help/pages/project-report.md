---
fingerprint: 21d681931823fd6f
reviewed: 2026-10-16
title: Project Report
area: finance
order: 13
modules: [PROJECTREPORT]
sources: [functions/src/projectReport.js, functions/src/projects.js]
summary: Each project's income, costs and result for a period, by account.
---
## What it is for

The **Project Report** shows, for a company and a period, what each project
earned and cost: its **Income** (revenue accounts), its **Costs** (expense
and cost-of-sales accounts) and the **Result**. Lines posted without a
project show under **No project**.

## Before you start

- The projects exist in [Organizational Units](org-units.html) (type
  **Project**).
- Entries carry their project: a Project on the journal or cash and bank
  line, or on the invoice.

## Step by step

1. Open **Project Report** and choose the **Company**.
2. Choose **From** and **To**, and a **Project** (or All, or No project).
3. Select **Run Report**. Each project shows its customer, dates, status,
   income, costs and result.
4. Select a project to see its accounts.
5. **Copy** to Excel, or **Print**.

## Good to know

- Only income and cost accounts count: a project's receivable or bank lines
  are not part of its result.
- The [GL Report](general-ledger.html), [Trial Balance](trial-balance.html)
  and Profit and Loss can also be filtered by project.
- For example: project PRJ-1 *Tower A* invoiced 500.00 and spent 100.00 on
  site labour, a result of 400.00.
