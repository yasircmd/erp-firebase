# Data Reset: every module's data (UX round 2, item 9; owner 2026-10-24)

Status: **built** (2026-10-24; decisions 283-286 made, below). Deploy set
`ux2-data-reset`.

Data Reset (a ported module, Code.gs `DATA_RESET_CATEGORIES`) clears whole
categories, or chosen records of one, for an Admin, after typing DELETE.
It was written before HR, payroll and most later modules, so it covers 18
categories and leaves most of today's data out.

## What it covers today, and what is missing

Found by running every emulator suite and recording each RTDB key and
Firestore collection the suites leave behind (2026-10-24: 660 tests, 0
failures), then checking against the categories.

**Covered (18):** GL Journal Entries; Stock Transactions & Ledger; Vendor
Invoices; Customer Invoices; Opening Balance Batches; BOMs; PDCs; Fixed
Assets and their configuration; Recurring Journals; Items; Item
Sub-Categories; UOMs; Chart of Accounts; Companies; Org Units; Sales
Types; Customer Classifications.

**Missing:**

| Area | Stores |
|---|---|
| Sales | Sales Orders, stock reservations, e-invoices |
| Purchasing | Purchase Requisitions, Inventory PRs, Purchase Orders |
| Production | Job Orders (batches and lines) |
| Approvals | approval records (the Approval Tracker's history) |
| Parties and prices | Vendors, Customers (and their counters), Price Lists and lines, Inventory Valuation lines, Requisition Categories |
| Items | Item Categories, Item Barcodes (and their counter) |
| Currencies | Currencies, exchange rates |
| Documents | supporting-document links, company documents |
| HR | employees, their compensation, history and documents; Employee Portal accounts; employee changes; leave (requests, adjustments, accruals, openings, months, year closes) |
| Payroll | runs and payslips, inputs (earnings and deductions), interim batches, final settlements, loans, provision claims and openings |
| Requests | employee requests (queries, claims, loan requests) and their messages |
| Logs | COA renumber log, master import log, period closing state |
| Setup | HR Setup (grades, designations, fields, document types, leave types, working calendars, schedules, leaving reasons), Payroll Setup (pay elements, accounting, payment formats, loan and accrual types, reimbursement categories, request handlers), Approval Configuration, numbering formats, invoice, e-invoice, barcode, retail and FX settings |

**Never offered (as today):** users, roles, permissions, the menu tree, the
users' own preferences (theme) and
favourites; the firm's own stores (the corporate directory, groups, notes,
Support, screen releases, document storage connection, system flags).

Two technical points:
- Firestore keeps sub-collections when a document is deleted (payslips
  under a payroll run, messages under a request). Clearing uses a
  recursive delete, so nothing is left behind.
- Stock reservations moved to Firestore (T2) and are cleared by no
  category today.

## The plan

- New categories, in three groups: **Transactions**, **Master data**, and
  a new **Setup** group (decision 285). Each clears its numbering counters,
  so numbers start again (as Items does today).
- Single-record delete for the new transaction categories, as today's.
- **Dependencies (decision 284).** Each master names the transaction
  categories that use it (for example Employees: payroll, leave, changes,
  requests, settlements; Customers: Sales Orders, Customer Invoices). Today
  this is only a warning in the description.
- **Corporates kept apart (item 37).** Data Reset runs in the signed-in
  corporate's own project (M1), so a reset in Corporate 100 cannot touch a
  client's data. A test proves it both ways.
- A unit check keeps the list complete: every store the functions write is
  in a category or in the "never offered" list, so a new module can't be
  forgotten again.

## Built

- `functions/src/dataReset.js`: the 29 new categories, their dependencies
  (`USED_BY`), clearing (recursive for Firestore), counting, single-record
  delete, the Employee Portal sign-ins and the files. The ported Data Reset
  hands those categories to it, and checks the dependencies for all 47
  (patches `data-reset-all-modules`, through `MAPPED` adapters). Stock
  reservations went with no category: they go with Stock Transactions now.
  The COA renumber log goes with the Chart of Accounts.
- **Behavior change to the ported module (284):** clearing a master that is
  still in use was allowed with a warning in its description. It is now
  refused, before anything is deleted. A master that others use has no
  single-record delete.
- The screen (SCREEN_EDITS): a Setup group, and Browse only where offered.
- Counts: a category's `count` names the stores that hold its records (an
  employee, not their sign-in).
- Tests:
  - emulator/dataResetAll (the counts, the refusal, Employees with
    sign-ins, files, single records, Setup, and the two corporates kept
    apart);
  - unit/dataResetCoverage (every store the functions name is in a
    category or never offered);
  - ui/dataReset.

## Decisions (owner, 2026-10-24)

- **283: yes.** The Employee Portal sign-ins are deleted. An ERP user's
  sign-in is never deleted, even if a portal record names it.
- **284: refuse.**
- **285: offered,** in a Setup group.
- **286: links and files.** The files go to the document storage's trash:
  Google Drive keeps them there for 30 days. That is the safer form of the
  same decision; a permanent delete stays possible if wanted. Refused
  while the storage is not connected. This is the one exception to
  ATTACHMENTS.md decision 3 (removed files are never deleted).

## The questions, as they were put

- **283.** Clearing Employees: also delete their **Employee Portal
  sign-ins** (their accounts in the corporate's Authentication)?
  Recommendation: yes. Otherwise sign-ins remain for employees who no
  longer exist.
- **284.** A master with transactions still using it (Employees with
  payroll runs, Customers with invoices): **refuse** unless those are
  cleared too (in the same reset or before), or **warn** as today?
  Recommendation: refuse. A half reset leaves screens showing "not found"
  everywhere.
- **285.** The **Setup** categories (HR Setup, Payroll Setup, Approval
  Configuration, settings): offered in a Setup group, or never?
  Recommendation: offered, so a corporate can start completely fresh.
  Like every category, they start unticked.
- **286.** Supporting documents: clearing removes the ERP's **links** to
  the files. Should it also delete the **files**? Recommendation: links
  only. The files are in the corporate's own Google Drive or storage, and
  deleting a client's files is better done by them.
