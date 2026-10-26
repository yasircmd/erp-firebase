---
title: Data Reset
area: admin
order: 12
modules: [DATARESET]
sources: [functions/src/dataReset.js, functions/src/documentStorage.js]
summary: Clear test data module by module, or rebuild the stock balances, before going live.
reviewed: 2026-10-26
fingerprint: d00e1db0b9e44d0d
---
## What it is for

**Data Reset** deletes data, for a fresh start while setting up: the test
entries made while learning the ERP, or the masters and setup to enter
again. It deletes for good: there is no undo. Never use it on live records.

It works in your corporate only: a reset never touches another corporate's
data.

## Before you start

- You are signed in with the **ADMIN** role: no other role can open it.
- You know which categories to clear. Nothing is ticked for you.
- To clear supporting documents, the document storage is connected
  (Document Storage).

## The categories

- **Transactional data:** what accumulates from use. GL entries; stock
  transactions with the stock balances and reservations; vendor and
  customer invoices; PDCs; fixed assets; recurring journals; opening
  balances; Sales Orders; Purchase Requisitions and Orders; Job Orders;
  approval records; e-invoices; employee changes; leave; payroll runs and
  payslips; final settlements; payroll loans; employee requests;
  supporting documents; company documents; period closing; the logs.
- **Master data:** items and their categories, sub-categories, units and
  barcodes; the chart of accounts; companies; org units; sales types;
  customer classifications; BOMs; vendors; customers; price lists; the
  inventory valuation list; requisition categories; currencies and
  exchange rates; shareholders; employees.
- **Setup:** HR Setup, Payroll Setup (with the employee request types),
  Approval Configuration, and the numbering formats and settings (with the
  Rep Cash Clearing account).

**Sales Rep Receipts** (a transaction) are the receipts the reps gave from
the Employee Portal; each rep's numbers restart. Their GL entries and
cheques are cleared with the GL and PDCs.

Users, roles, permissions and the menu are never offered.

## Step by step

1. Open **Data Reset**. Each category shows how many records it has.
2. To delete a whole category, tick it. To delete some records only, use
   **Browse & select…** on its row (where offered).
3. Type **DELETE** and confirm.

## What it refuses, and what goes with a category

- **A master still in use is refused.** For example, Employees while
  payroll runs exist, or Customers while invoices exist. The message names
  what still uses it and how many records it has. Tick those too, or clear
  them first. Nothing is deleted until the whole selection may go.
- A master that others use is cleared whole, never one record at a time.
- Clearing a category restarts its numbering (for example, employee
  numbers or vendor codes).
- **Employees** also removes their Employee Portal sign-ins, but never an
  ERP user's own sign-in.
- **Supporting Documents** also moves the files to the document storage's
  trash. Google Drive keeps them there for 30 days.
- A payroll run goes with its payslips, and a Sales Order with its
  reservations.

## Recalculate Stock Ledger

After deleting single stock transactions, the stock balances may no
longer match them. **Recalculate Stock Ledger** rebuilds the balances from
the posted transactions that remain.

## Rights

Only the **ADMIN** role, whatever Roles & Permissions say.

## Questions and mistakes

- **"… is still used by …":** clear what it names first, or with it.
- **"… not connected":** connect the document storage in Document Storage,
  then clear Supporting Documents again.
- **Deleted the wrong thing:** there is no undo. Enter the data again, or
  restore from your own backup.
