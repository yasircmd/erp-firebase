---
fingerprint: 8f61bb73fd289494
reviewed: 2026-11-12
title: Built modules
area: admin
order: 20
summary: Modules your provider built for your business (rooms, bookings, investments, subscriptions …): their lists, records, documents, statuses and approvals.
sources: [screens/BUILT.html, functions/src/builtModules.js, functions/src/builtActions.js, functions/src/builtMis.js]
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

A built module never posts to the accounts by itself: when it has
**actions**, it makes a Customer Invoice, Vendor Invoice or Journal Entry
that the accounts take as usual (see [To the books](#to-the-books)).

## Step by step

1. Open the module from the menu. The list shows its records, newest first
   for documents. Use **Find** to search, **Status** to filter, **Copy** to
   paste the list into Excel.
2. **New** opens an empty record. Choose the **company** first when it asks:
   the choices of a linked field (a customer, an item, an employee, a room …)
   are that company's.
3. Fill in the fields. A field marked **\*** is required. A **link** field is
   a list to choose from (a customer, an item, a project, a room …);
   something switched off or a closed project is no longer offered. A
   **calculated** field (greyed, for example *Nights* or *Amount*) is worked
   out as you type and again when you save: see
   [Calculated fields](#calculated-fields).
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

## Board and calendar

Some built modules have tabs above their list:

- **Board** (on master data, for example Rooms): one column per state, each
  record as a card in its state on the day chosen (today at first; use the
  arrows or the date). A record's state comes from the documents that book
  it that day (for example *Booked* or *Occupied*), else it is **Free**. A
  state set by hand (for example *Cleaning* or *Out of order*) wins: choose
  it on the card, or *none* to clear it. A card's document opens from it.
- **Calendar** (on a document, for example Bookings): the records booked
  (rooms, vehicles, units) as rows and 14 days as columns, each document a
  bar from its start to its end in its state's colour. The arrows move a
  week; **Today** comes back. Select a bar to open its document. Only
  documents in a status that holds the record show (not a draft or a
  cancelled one).

**No double booking.** A document can't hold a record another document
already holds for overlapping days: saving or moving it to such a status
is refused, naming the other document, for example *101 · Garden room is
already held by BK-26-000004 from 20/11/2026 to 22/11/2026*. Whether the end
date is the day the record is free again (a hotel: a guest may arrive on
another's departure day) or its last day in use (a rental) is set for each
module.

## Calculated fields

Some fields are worked out for you, from the record's other fields:

- **a × b**, for example a line's *Amount* = *Qty* × *Rate*, or a booking's
  *Room charges* = *Nights* × *Rate*;
- **a sum** or **a − b**, for example *Net due* = *This claim* − *Retention*;
- **a percentage**, for example *Retention* = 10 % of *This claim*;
- **days between two dates**, for example *Nights* from *Arrival* to
  *Departure*;
- **earlier documents' total**, for example a progress claim's *Claimed
  before*: the same field added up over the earlier documents of the same
  contract (by date, then by when they were made), a cancelled one not
  counted. On a line it adds up the earlier documents' lines of the same
  item, so a line's *This claim* is its value to date less what was claimed
  before.

You can't type in them; amounts are rounded to 2 places. They are kept with
the record when it is saved, and add up into the totals and the reports like
any amount. An earlier document changed later doesn't change the documents
after it until they are saved again.

## To the books

A built module may have **actions** that make a document in the accounts
from a record, for example *Invoice rent* on a lease, *Bill the guest* on a
room-service order, or *Agent commission* as a vendor invoice. Each action
makes one **Customer Invoice**, **Vendor Invoice** or **Journal Entry**:

1. Open the record. In the **To the books** panel, its action buttons show
   when the record may use them (for a document, in the statuses the action
   is for).
2. Select the action and confirm. The document is made through its own
   screen's checks (your rights on it, an active customer or vendor, postable
   accounts, the sales type, tax, the period), as a **draft** to check and
   post on its screen, or **submitted**: posted, or sent to its approvers
   where [Approval Configuration](approval-configuration.html) sets them.
   Item lines on a customer invoice deliver the stock, as the invoice's own
   item lines do (the company must allow invoices to deliver stock).
3. The panel lists what was made; select a number to open it. The document's
   **Linked documents** show the record it came from.

An action may make its invoice as a [variant](#variants), for example a
booking's check-out makes a *Room Invoice*, with its own numbers and the
room and nights in its extra fields. It may take the **project** from the
record (a contract's project), else from the module's Setup.

An action makes its document **once**. Doing it again is refused while that
document is still there and not reversed; delete the draft or reverse the
posted document first.

**Runs** (subscriptions, rent, fees). An action may be a run: each record has
a **next-due** date and a **period** (Monthly, Quarterly, Half-yearly or
Yearly). On the **Runs** tab, choose the run and the date, then **Propose**:
every record due on or before that date is listed, ticked. Untick any, then
**Run the ticked**. One document is made per customer (a line for each of
their records) or per record, as the module is set. Each record's next-due
date then moves on by its period, so nothing is billed twice. A record that
is refused (for example an inactive customer) stays due and doesn't stop the
others. **Past runs** lists who ran what, what was made and what was refused,
with the reason. A record behind by several periods is billed one period a
run; run again for the next.

**Setup** (the tab). The accounts, sales type, cost centre, profit centre,
project and warehouse an action uses when the record itself doesn't give
them, set for each company. Changing it needs the right to change the module
and to post the documents it makes.

## Variants

A **variant** is one of the ERP's own documents under another name, made for
your business: for example a *Room Invoice* (a Customer Invoice), a *Utility
Bill* (a Vendor Invoice), an *Event Order* (a Sales Order), a *Tour Quote* (a
Quotation) or an *Accrual* (a Journal Entry). It has its own menu entry and
opens the original's own screen, with:

- its own name on the screen and on the print (a tax invoice keeps its own
  heading, with the variant's name under it);
- some of the original's fields renamed (for example *Guest* for Customer), a
  few hidden, and defaults on a new document;
- its own **extra fields** in a panel under the header (for example Room and
  Nights), kept with each document and printed under the header;
- its own **numbers** (for example RINV-26-01-000001), its own **rights** in
  Roles & Permissions and its own row in
  [Approval Configuration](approval-configuration.html).

Everything else is the original's: the same checks, posting and reports. A
Room Invoice is a customer invoice in the books, the customer's statement,
ageing and the tax returns. Someone with only the variant's rights sees and
opens only the variant's documents; someone with the original's rights sees
all of them on the original's screen, each marked with its variant's name.

## Packs

Your provider may give you a **pack**: a set of built modules for your
business, for example *Hotel* or *Construction*, switched on together with
a menu folder, starter reports and a setup checklist. See
[Packs](packs.html).

## In reports

Each built module is a data set in [Build a report](mis-report-builder.html#built-modules)
(MIS Reports): a master's records, a document's documents by month and, for
a document with lines, its lines. A link to another built master brings that
master's fields, for example bookings by room type. A variant's documents
are in Sales or Purchase lines, with a Variant column and the variant's
extra fields. Saved reports from them can go on the
[MIS Dashboard](mis-dashboard.html).

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
- **An action button is missing:** the record is not in a status the action
  is for, it is waiting for approval, it was already done (once), or you
  don't have the right to create (or, for a submitted one, post) that kind
  of document.
- **"no account … set it in the module's Setup":** the record gives no
  account and the company's Setup has none for that action: set it on the
  Setup tab.
