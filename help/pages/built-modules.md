---
fingerprint: 7b5a8df7f6c20648
reviewed: 2026-11-09
title: Built modules
area: admin
order: 20
summary: Modules your provider built for your business (rooms, bookings, investments, subscriptions …): their lists, records, documents, statuses and approvals.
sources: [screens/BUILT.html, functions/src/builtModules.js]
---
## What they are

Some modules in your menu are **built modules**: your ERP provider made them
for your kind of business from settings, for example *Rooms* and *Bookings*
for a hotel, *Investments* for an investment company, *Properties* and
*Leases* for real estate. They work like the rest of the ERP and all look
alike, so this page covers every one of them.

There are two kinds:

- **Master data**: a list of records, each with a **Code** and a **Name** and
  the module's own fields (for example a room's type and rate).
- **Documents**: numbered documents (for example *BK-26-000001*), each with a
  **Date**, its fields, often a table of **lines** with totals, and a
  **status** (for example Draft, Confirmed, Checked out).

A built module never posts to the accounts by itself.

## Step by step

1. Open the module from the menu. The list shows its records, newest first
   for documents. Use **Find** to search, **Status** to filter, **Copy** to
   paste the list into Excel.
2. **New** opens an empty record. Choose the **company** first when it asks:
   the choices of a linked field (a customer, an item, an employee, a room …)
   are that company's.
3. Fill in the fields. A field marked **\*** is required. A **link** field is
   a list to choose from; something switched off is no longer offered.
4. On a document, add its **lines** with **Add line**; number and amount
   columns are totalled at the bottom.
5. **Save**. A new document gets its number when first saved.
6. Move a document on with the **→ status** buttons. A status may need
   **approval** first: the document then waits, shows *Waiting for approval*,
   and the approvers see it in their [Home tasks](getting-started.html#home-tasks)
   (with Approve and Reject on the document). A rejection keeps the document
   where it was, with the reason, until it is corrected and sent again.
7. **Delete** removes a document while it is still in its first status (its
   number is not used again). A master record is switched **off**, never
   deleted, since documents may name it.
8. **Print** prints the record or the document with its lines.

## Rights

Each built module has its own rights in Roles & Permissions: **access** to
open it, **write** to add and change records and move documents on, and for
documents **void** to move one to a final status (for example Cancelled).
Approvals are set in [Approval Configuration](approval-configuration.html),
under the module's name.

## Questions and mistakes

- **A status button is missing:** a final status needs the **void** right; a
  document waiting for approval has none until it is decided.
- **Save is missing:** the document's status no longer allows changes (only
  the statuses set so allow them, the first one always).
- **A choice is missing from a list:** it belongs to another company, or it
  was switched off.
