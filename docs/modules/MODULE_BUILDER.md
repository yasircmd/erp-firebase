# Module Builder: modules made from settings, for any business

Status: **phase 1 built 2026-11-09** (decisions Q461-Q469; the owner's go-ahead
the same day). See *As built: phase 1* below.

## The request (owner, 2026-11-09)

"Now I want to express one of my biggest idea - a module builder
* A module to build transaction or report
* It can duplicate any existing module to amend some details or remove, change
  name, etc without changing the original
* Some examples:
1. Hotel & restaurant - room, table booking, current status of room,
   invoicing adding tourism or entertainment tax with gross or without gross,
   etc
2. Investment company - to track all their investments
3. Subscription - invoice bulkly to a large customers
4. Same like - real estate, hospital, school, logistics, constructions, etc"

## The owner's decisions (2026-11-09)

| # | Question | Decision |
|---|---|---|
| Q461 | Who builds | **The firm**, in Corporate 100, and offers what it builds to client corporates as modules (groups and entitlements, MULTI_CORPORATE.md M2/M4). A client can't change a built module, so can't break its own books with one. |
| Q462 | The accounts | **Only through the existing documents.** A built document *creates* a Customer Invoice, Vendor Invoice or Journal, which then goes through its own tax, approval, period lock and posting; the builder never posts to the GL itself. |
| Q463 | "Duplicate a module" | **A variant on the original:** a named copy (for example *Room Invoice* of Customer Invoice) with its own name, numbering, labels, hidden or extra fields and defaults, running on the original's own logic, so every fix to the original reaches it. Not a copy of the code. |
| Q465 | Phase 1's field types | **The basics:** text, long text, number, amount (with currency), date, date and time, yes/no, a choice list. Links to ERP records (customer, item, another built master), formulas and file fields come later. |
| Q466 | Line tables | **One** per document (header fields only is also allowed). |
| Q467 | Changing a published module | **A new version for every corporate at once**, like a screens release: added fields appear; a removed field stays readable on old records. |
| Q468 | The status board | **Phase 2, with the calendar** (and the double-booking check). |
| Q469 | Links in phase 1 | **Yes** (owner, 2026-11-09, on the go-ahead): a link field to a customer, vendor, item, employee, company, or another built master (a booking's Room). |
| Q464 | What comes first | **The builder core:** custom masters and documents (fields, lines, numbering, statuses, approvals, attachments, print, rights, lists) and a status board; then the link to the invoice; then variants. |

## What the examples need, in the builder's terms

| Example | Masters | Documents | Board / calendar | To the books (Q462) |
|---|---|---|---|---|
| Hotel & restaurant | Rooms (type, rate, floor), tables | Booking, check-in, check-out, table order | Room status (free, booked, occupied, cleaning); bookings by date | Check-out creates a Customer Invoice; tourism and entertainment tax are components in Tax Configuration ("with gross or without gross" = a compound component) |
| Investment company | Investments (instrument, counterparty, dates, rate) | Buy, sell, income received, revaluation | Holdings by status | Each creates a Journal or a Vendor/Customer Invoice |
| Subscription | Plans; a customer's subscriptions | A billing run (all subscriptions due) | Due this month | The run creates one Customer Invoice per customer (an engine of its own, phase 3) |
| Real estate, school, hospital, logistics, construction | Properties and units; students; patients; vehicles; sites | Lease, enrolment, admission, trip, site report | Units let or vacant; beds; vehicles out | Invoices for rent, fees, charges |

## The proposal

### How it is built (the parts)

- **Definitions are the firm's.** A built module is a *definition*: its id
  (always `X_<NAME>`, so it can never collide with a coded module), its label,
  kind (master or document), fields, line table, numbering, statuses and
  their order, who may do what, its list's columns, its print layout. Kept in
  the firm's own Firestore (`moduleDefinitions/{id}`, with numbered published
  versions), like the screens release: code-like, the firm's. Each
  corporate's data stays in that corporate (`builtRecords/{id}/...`).
- **One runtime, not generated code.** One screen (`BUILT.html`) and one set of
  functions (`builtModules.js`: list, get, save, change status, delete a
  draft, print) run every built module from its definition. A fix to the
  runtime fixes every built module at once; a new built module needs no
  deploy, only publishing (and switching it on for a corporate).
- **A built module is a real module.** It appears in the module registry at
  run time (the code's registry plus the published definitions), so Roles &
  Permissions, Tree Management, entitlements (on for a corporate or a group),
  Home's tasks, the approval engine (approvals.js), attachments, numbering
  and Help work for it as for any module. Its rights: access, write, and per
  definition approve / void.
- **The builder screen** (Corporate 100, the firm's right only): define,
  preview with sample data, publish a version, see which corporates use it.
  A published version is never changed in place: a new version is published
  (adding fields is safe; removing or retyping one keeps the old data, read
  only).
- **Data safety.** All reads and writes through the functions (rules stay
  deny-all), one corporate per request (M1), equality queries by indexed
  fields, the global lock for numbering, as everywhere.

### Phases (each usable on its own)

1. **Builder core:** masters and documents with their fields, one line table,
   numbering, statuses, attachments, print, rights, lists with search and
   Excel copy; the approval engine for a document type that wants it.
2. **Boards and calendars:** a status board (cards by status: rooms free,
   occupied, cleaning) and a calendar of documents by date (bookings), with
   a clash check (a room booked twice for the same night refused).
3. **To the books (Q462):** a document's action creates a Customer Invoice,
   Vendor Invoice or Journal from mapped fields and lines (draft or
   submitted), linked both ways (Document Links); the bulk run (subscriptions:
   every record due, one invoice each).
4. **Variants (Q463):** of the hand-written documents first (Customer
   Invoice, Sales Order, Quotation, Vendor Invoice, JV): their own name,
   numbering series, labels, hidden fields, extra fields (kept with the
   document) and defaults.
5. **Reports:** each built module as an MIS builder data set (MIS.md phase 4),
   so its reports, pivots and dashboard tiles are made as for sales or stock.
6. **Packs:** the firm's first real modules made with it (Hotel & restaurant,
   Subscription billing, Investments, ...), each a group of definitions
   switched on together.

### What it will not do (and why)

- **Post to the GL itself** (Q462): the books stay with the proven documents.
- **Run code a definition supplies** (formulas are a small fixed set: sums,
  products, days between two dates, a percentage; no scripts): a definition
  is data, so it can't break the system or another corporate.
- **Copy a ported module's code** (Q463).

### Phase 1 in detail (Q465-Q468)

- **The builder** (a new module, BUILDER, Corporate 100 only, like the
  Developer screen): a list of definitions; one definition's editor: label,
  kind (master or document), fields (name, label, type, required, a choice
  list's options, its default), the line table (on or off, its fields of the
  same types; number and amount lines total into the header), numbering
  (prefix, yearly or not), statuses (an ordered list, e.g. Draft, Confirmed,
  Done, Cancelled; which one is the start, which are final) and whether a
  status needs approval (Approval Configuration, as any module), the list's
  columns, the print's title; **Preview** (the screen as a user sees it);
  **Publish** (a new version, Q467), and the corporates it is on.
- **The runtime** (BUILT.html, builtModules.js): a list (search, filter by
  status, paging, Excel copy), the document (header, the line grid with
  paste from Excel, totals), Save as draft, the status buttons the definition
  allows, attachments, Print (the shell's print with the company's letter
  head), Delete a draft; dates shown dd/mm/yyyy, amounts as everywhere, the
  in-app dialogs, the phone layout for lists and documents.
- **Rights:** each built module's access and write in Roles & Permissions;
  approvals through Approval Configuration; Home's tasks show its approvals
  and drafts.
- **Not in phase 1:** links to other records (so a booking's room is a choice
  list for now), formulas beyond line totals, the board and calendar,
  creating invoices, variants, reports in the MIS builder.

## As built: phase 1 (2026-11-09)

As designed (Q461-Q469), with these points:

- **The registry, at run time.** `builtDefinitions.js` keeps the published
  definitions in this instance and, before each call (callable.js), brings
  the code's own MODULE_REGISTRY, DEFAULT_PERMISSIONS, Approval
  Configuration's list (APPROVAL_GATEABLE_MODULES) and the approvals' storage
  map (APPROVAL_MODULE_STORAGE_) up to date **in place**, at most every
  30 seconds; the ported code (Roles & Permissions, Tree Management, Approval
  Configuration) then sees a built module with no change of its own. Each
  function is its own instance, so a module just published can be unknown
  to another for up to 30 s; a lookup that misses reads again at once
  (`publishedDef`, getModuleFragment). A coded module's id can never be
  taken (`X_` ids only, and refused if the code has it). Its rights: access
  and write (masters), and void (documents: to a final status); default
  ADMIN, set in Roles & Permissions.
- **The builder** (BUILDER, homeOnly, internal: access, write, publish):
  `moduleBuilder.js` and screens/BUILDER.html. A draft is checked as it
  would be published; **Publish** writes the next version (versions kept in
  `moduleDefinitions/{id}/versions/{n}`) and is at once every corporate's
  (Q467). A new version may not change the kind, retype a published field,
  or relink one (its records keep their values); a never-published draft may
  be deleted, a published module never (switch it off for a corporate in
  the Developer screen). **Preview**: a published module is invisible to a
  client corporate until switched on for it, so the firm publishes and tries
  it in Corporate 100 first (a separate preview of an unpublished draft is
  not built).
- **The runtime**: `builtModules.js` and screens/BUILT.html, served by
  getModuleFragment for any `X_` module with its id. Masters: Code (unique
  in the company), Name, their fields, switched on or off (never deleted).
  Documents: a number PREFIX-YY-000001 (`builtCounters`, a transaction), the
  Date, their fields, one line table (blank lines dropped; number and amount
  columns totalled), the statuses: any other status from a non-final one;
  only an editable status (the first always) allows changes; a final one
  needs void; one marked "needs approval" goes through
  beginApprovalInstance (Approval Configuration, the document's first amount
  total as the amount) and waits as PendingStatus until decided
  (decideBuiltApproval → recordApprovalDecision); a rejection keeps the
  status, marked ApprovalRejected (Home's rejected items show it:
  homeTasks.awaitsResubmission). Delete only in the first status. Links: the
  record's company's active customers, vendors, items, employees, companies
  (the user's) or the built master's active records; the label is the
  ERP's, never the caller's. Print: the record or document with its lines.
  Copy: the list for Excel. Dates as yyyy-mm-dd for the shell to show.
- **Help**: one page, *Built modules* (Administration), for every built
  module; Help's `?m=X_...` opens it (tools/help/lib.js). The builder is
  internal (no Help, like Developer).
- **Not in phase 1** (as decided, or found while building): formulas beyond
  the line totals, file fields, the board and calendar (phase 2), invoices
  from a document (phase 3), variants (phase 4), MIS data sets (phase 5);
  also pasting lines from Excel, the phone layout's cards, and the phone
  approval card for built documents (Home opens the document, with Approve
  and Reject on it); Data Reset does not offer built records yet.
- **Tests**: unit/moduleBuilder (a definition's checks; the registry joined
  in place and a module no longer published taken out; values by type, a
  link only from its choices with the ERP's label, totals, the statuses);
  emulator/moduleBuilder (the builder's rights, checks, drafts, versions, a
  retyped field refused, a published module never deleted; masters: codes,
  choices, required, rights, the company; documents: link choices per
  company, totals, numbering, approval through Approval Configuration to
  the approver's Home tasks and back, editable statuses, void, a rejection
  in the submitter's rejected items, delete only a Draft, a switched-off
  master not offered); ui/moduleBuilder (a master defined and published in
  the builder; a room saved, a stay with a guest and rooms on its lines,
  totals, numbered, Confirmed); ui/help (?m=X_ROOM). Negative controls, each
  caught then restored: stale built modules left in the registry; a link
  taking any id; the lines' totals wrong. Found by the tests while
  building: a required text field accepted spaces (fixed); a module just
  published unknown to another instance (the re-read on a miss).

### Setting it up (after the deploy)

1. Corporate 100: link **Module Builder** in the menu (Tree Management).
2. Build and publish a module; give its rights (Roles & Permissions) and a
   menu item (Tree Management); try it.
3. A client corporate: switch the module on for it (Developer screen: its
   modules, or its group's); its Admin then gives the rights and the menu
   item (or the firm's tree for it).

## Open questions for the owner

None for phase 1. Phase 2 (boards and calendars) is designed with the owner first.
