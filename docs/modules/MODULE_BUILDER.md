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

## Phase 2: boards and calendars (built 2026-11-09)

### The owner's decisions (2026-11-09)

| # | Question | Decision |
|---|---|---|
| Q470 | A board's state of a record | **Both:** worked out from the documents that cover the day (a room in a Confirmed booking is Booked, in a Checked-in one Occupied), and a choice field on the master set by hand (Cleaning, Out of order) that wins when set. |
| Q471 | The calendar | **A timeline by resource:** rows are the linked masters (rooms, vehicles, units), columns days, each document a bar from its start to its end. |
| Q472 | Two documents on one resource for overlapping dates | **Refused**, naming the clashing document, for the statuses marked as holding the resource. |
| Q473 | Where they appear | **Tabs in the module's own screen:** List, Board, Calendar, as the firm enables them. |

### The proposal (the firm's choices, per module, in the builder)

- **A document's schedule** (optional): its **resource**, a link field to a
  built master (in the header, one resource; or in the lines, one per line,
  e.g. a booking's rooms); its **start** and **end** date fields; whether the
  end is the day it is **free again** (a hotel's departure: 20-22 is two
  nights, and another may arrive on the 22nd) or the **last day used** (a
  rental: 20-22 is three days); and the statuses that **hold** the resource,
  each with the **state** it shows on the board (Confirmed → Booked,
  Checked in → Occupied). A document in any other status (a Draft, a
  Cancelled one) holds nothing.
- **The clash check (Q472)**: on Save while in a holding status, on moving
  into one, and on the approval that makes it one, every other document
  holding the same resource (of any module scheduling that master) whose
  dates overlap refuses it: "Room 101 is booked by BK-26-000004 from
  20/11/2026 to 22/11/2026." Done under the global lock (lock.js), so two
  people can't book the same room at the same moment.
- **A master's board (Q470)** (optional): one column per state; its states
  are the holding ones' states, the hand-set field's options, and **Free**.
  A record's state on the day chosen (today by default): its hand-set field
  if set, else the state of a document holding it that day, else Free. A
  card shows its code and name, and the document (its number and first list
  column, e.g. the guest) with a link to it; the hand-set field changes
  from the card (write right).
- **A document's calendar (Q471)**: the resource's records as rows (the
  company's, active), 14 days from the day chosen (back and forward by a
  week, Today), each document holding a resource as a bar in its state's
  colour from its start to its end, its number on it; a click opens it.
  Documents in other statuses don't show. A day with no document is empty
  (a click on it starts a new document for that resource and date: not in
  phase 2).
- **Tabs (Q473)**: List always; Board on a master with a board; Calendar on
  a document with a schedule.
- **What a schedule may not change once published**: the fields it names
  keep their types (as any published field).

### Build

1. builtDefinitions.js: the schedule and board settings, checked;
   builtModules.js: the clash check, getBuiltBoard, getBuiltCalendar,
   setBuiltBoardState (the hand-set field from a card).
2. BUILT.html: the tabs, the board, the timeline; BUILDER.html: the settings.
3. Tests with negative controls, Help, What's new, docs, the deploy set
   (the builder's and the runtime's functions; the registry part of
   builtDefinitions.js is unchanged), PR.

### As built: phase 2 (2026-11-09)

As designed (Q470-Q473), with these points:

- **Settings** (builtDefinitions.js `cleanSchedule`, `cleanBoard`; the builder's
  Board and Schedule sections): the resource a link to a built master (header
  or lines); start and end header date fields, two different ones; the end
  "free again" (default) or "last day used"; at least one holding status, each
  with its state (letters, up to 20). A board's hand-set field is a choice
  field.
- **The clash check** (builtModules.js `findClash`): every published document
  module scheduling the same master, same company, a holding status,
  overlapping days [start, end) and a shared resource. On Save of a document
  in a holding status, on a move into one (also before sending it for
  approval), and before an approver approves it into one (nothing recorded on
  a clash); a first status that holds (unusual) is checked on its first Save.
  Under the global lock. A holding document needs both dates, the end after
  the start (or on it, for "last day used").
- **The board** (`getBuiltBoard`, `setBuiltBoardState`): columns in order: the
  holding states of every module scheduling this master, then the hand-set
  field's options, then Free; a card's document is the one holding it that
  day, with its number and its first list column (the guest).
- **The calendar** (`getBuiltCalendar`): 14 days (up to 62), rows the
  master's active records of the company, bars per resource. BUILT.html
  draws the bars as table cells spanning their days.
- **A version just published** is used by the runtime's calls at once: they
  read the definitions fresh (`publishedDef(id, true)`), found by the UI test
  (a board published a moment before didn't show). The registry part for
  every other call keeps its 30 s.
- **Tests**: unit/moduleBuilder (a hotel's departure day free, a rental's last
  day used, overlaps, resources, holding states, the settings' checks);
  emulator/moduleBuilderSchedule (the settings refused; a room held twice
  refused naming the other booking; arriving on a departure day allowed; two
  rooms with one taken refused; dates the wrong way round refused; an edit of
  a holding booking checked again; cancelling frees it; the board's states by
  day and a hand-set state winning and cleared; the calendar's rows and bars);
  ui/moduleBuilder (the builder sets a board; the Board tab; the Calendar tab's
  bar of two nights opening its booking). Negative controls, each caught then
  restored: a departure day counted as taken (overlaps with <=); a rental's
  last day not counted; the clash check returning nothing.

## Phase 3: to the books and bulk runs (design 2026-11-09)

### The owner's decisions (2026-11-09)

| # | Question | Decision |
|---|---|---|
| Q474 | The state of the document a built record creates | **Set per module:** each action is Draft or Submitted, as the firm sets it. |
| Q475 | Which records a bulk run takes | **Both:** the run proposes the records due (a next-due date and a period), and the user can untick any before running. |
| Q476 | How a bulk run groups | **Set per module:** one invoice per customer (a line per record) or one per record, as the firm sets it. |
| Q477 | One record, the same document twice | **Once, unless cancelled:** an action creates its document once; a second try is refused while the first exists and isn't cancelled or reversed. A deposit and a final invoice are two actions. |
| Q478 | Item lines | **Item lines too:** a Customer Invoice action may have item lines (an item, a warehouse, quantity, price) that deliver the stock, as the invoice's own item lines do (the company must allow invoices to deliver stock). A Vendor Invoice takes stock in only through a GRN, so its lines stay account lines; a Journal has none. |
| Q479 | "Submitted" | **The same as the document's Post button:** it posts, or goes to its approvers where Approval Configuration gates that document. It needs the post right too. |
| Q480 | Build | **Yes**, as designed. |

### The proposal (the firm's choices, per action, in the builder)

- **An action** ("Create invoice", "Bill rent", "Accrue income") on a master
  or document, up to 5 each. Its target: **Customer Invoice**, **Vendor
  Invoice** or **Journal**.
- **Through the existing functions, never around them (Q462).** The action
  builds the target's draft and saves it with that document's own save
  function (saveCustomerInvoiceDraft, saveVendorInvoiceDraft,
  saveJournalDraft), as the user who runs it. So every check that document
  has applies: the user's rights on it, the company, an active customer or
  vendor, a postable account, the Sales Type and its classification, tax
  codes, projects, the period lock. The record gives the values; the books'
  rules don't change.
- **The mapping**, all set in the builder and checked on Publish:
  - the party: a link field to Customers (CI) or Vendors (VI); a Journal
    takes none, or a party link for a party line;
  - the date: a date field, or the day the action runs;
  - the description: fixed text with the record's fields in it
    ("Rent {Unit} {Period}");
  - the lines, either one line from a header amount field, or one per row of
    the record's line table;
  - each line's account (fixed, or a link field to the chart of accounts),
    amount (a number field or a line's total), its own description, Sales
    Type (CI: fixed per action), tax code (fixed, or none), and cost centre,
    profit centre and project (fixed, or from the record);
  - a Journal: a debit account and a credit account per line (one may come
    from the party).
- **Lines (Q478)**: account lines (rent, fees, room nights, commission,
  interest) on all three; on a Customer Invoice also item lines (an item
  link, a warehouse link, quantity, price), which deliver the stock as the
  invoice's own item lines do. New link targets for this: Warehouse and
  Account (the chart of accounts' postable accounts).
- **The state (Q474, Q479)**: Draft, or Submitted, which is the document's
  own Post: it posts, or waits for its approvers.
- **Linked both ways**: the record keeps the created document's id and
  number per action, and the document keeps the record's (CreateFrom), so
  Document Links shows the chain in both screens.
- **Once (Q477)**: the action is refused while its document exists and isn't
  cancelled or reversed (a deleted draft, a reversed invoice or a reversed
  journal frees it).
- **A bulk run (Q475, Q476)** on a master or a document with a run action: the
  module gets a **next-due date** field and a **period** (monthly, quarterly,
  half-yearly, yearly). "Run" on the list asks for a run date, proposes every
  active record due on or before it, ticked; the user unticks any and runs.
  Grouping is per action: one document per customer (a line per record), or
  one per record. After the document is created, each record's next-due date
  moves forward one period, in the same step, so nothing is billed twice. A
  run is kept (who, when, the records, the documents made, any refused, with
  the reason), and a refused record (an inactive customer) doesn't stop the
  rest.
- **Rights**: the action needs the module's write right and the target
  document's access and draft rights (Submitted also its post right).

### Build

- builtDefinitions.js: cleanActions (the mapping's checks on Publish: a
  field of the right type, an account that exists isn't checked until run).
- builtActions.js: buildTargetDraft (pure, unit-tested), runBuiltAction,
  previewBuiltRun, runBuiltBulk, getBuiltRuns; the CreateFrom link and the
  "once" check; the next-due step.
- flows.js: built records as a CreateFrom source of CI, VI and JV.
- BUILDER.html: an Actions section; BUILT.html: action buttons on a record,
  the Run dialog on the list, the Runs tab.
- Tests: unit (the mapping, dates by period, grouping), emulator (each
  target, refused checks from the target's own save, once, Submitted with
  and without approval, a bulk run's grouping and next-due, a refused
  record), ui (an action, a run). Help, What's new, docs, deploy set.

### As built: phase 3 (2026-11-09)

As designed (Q474-Q480), with these points:

- **The firm's definition, the corporate's books.** A definition is the same
  for every corporate (Q461, Q467), so it can't name an account, a sales
  type, a cost centre or a warehouse: those are corporate ids. An action maps
  the record's fields (a link field to Accounts, Items or Warehouses, new
  link targets); what no field gives comes from the module's **Setup** tab,
  per company (builtSetup/{X_ID}_{company}): the account (or a journal's
  debit and credit accounts), the sales type (a customer invoice), the
  warehouse (item lines), and the cost centre, profit centre and project.
  Changing the Setup needs the module's write right and the post right of
  every document type its actions make. A module with actions must belong
  to a company (the books are a company's).
- **builtActions.js** builds the target's draft (buildTargetDraft, pure) and
  saves it with saveCustomerInvoiceDraft, saveVendorInvoiceDraft or
  journal.saveJournalFor (new: the JV screen's own save and post for a
  request), as the user. Submitted then calls that document's own post
  (postCustomerInvoice, postVendorInvoice, journal.postJournalFor): posted,
  or PendingApproval; a post refused leaves the draft, made and linked, with
  the reason. Tax comes from the item's or the sales type's tax code, as on
  the invoice's own lines.
- **Lines**: one from the record's header, or one per row of its lines; a
  zero amount (or quantity) is left out, a negative one refused. A journal
  line pair per amount: the party (a customer or vendor link) on its side,
  on the party's own receivable or payable account, as the JV screen
  requires.
- **Linked both ways**: the record's Created list ({ Action, Module, ID,
  Due }) and History; the document's BuiltSource ({ ModuleID, Label,
  Records }), which getDocumentLinks (flows.js) lists under Comes from. A
  built document that made a live document can't be deleted.
- **Once (Q477)**: a non-run action is refused while its document exists
  and isn't reversed (a deleted draft or a reversal frees it). A record is
  claimed (Claim, 10 minutes) while its document is made, so two runs or two
  clicks never make two.
- **Runs (Q475, Q476)**: previewBuiltRun proposes the records due on or
  before the date (on, or in the action's statuses; a next-due date; a
  period); runBuiltBulk makes one document per party or per record, moves
  each record's next-due date on by its period in the same step as recording
  what was made, and keeps the run (builtRuns: made, refused with the
  reason). A refused group is released and stays due. The day is kept where
  the month has it (31 Jan + 1 month = 28 or 29 Feb, after which the 28th
  stays: a known limit, kept simple). The record's own action button on a
  run action bills its current period now.
- **Screens**: BUILDER.html, an Actions section (a card each: what it
  creates, as draft or submitted, the statuses, the party, date, reference,
  description with {number} {name} {period} {field}, the lines, the
  accounts, a run's next-due, period and grouping). BUILT.html: a **To the
  books** panel on a record (its action buttons and what was made, each
  opening its document), the **Runs** tab (propose, untick, run; past runs)
  and the **Setup** tab.
- **Tests**: unit/builtActions (an action's checks; dates by period; the
  description; a customer invoice's lines and grouping; item lines; a
  journal with its party; due records); emulator/moduleBuilderActions (the
  Setup and its rights, the new links; a lease's invoice once, linked both
  ways, made again after its draft is deleted; a vendor invoice Submitted =
  posted; a journal with its party; an order's item lines posted and the
  stock delivered; the invoice's own stock rule and draft right; a
  subscription run grouped per customer, next-due moved on, an inactive
  customer refused without stopping the rest, the run kept); ui/moduleBuilder
  (an action set in the builder; the Setup tab; a record's action button; a
  run from the Runs tab). Negative controls, each caught then restored: the
  month end not kept (addMonths); grouping per party ignored; the once check
  removed (the second invoice made).
- **Deploy set** `module-builder-p3`: the builder's and the runtime's
  callables, the six new ones, getDocumentLinks, saveJournalDraft and
  postJournalEntry's module (journal.js), with screens, then Hosting (Help).

## Phase 4: variants (design 2026-11-12)

### The owner's decisions (2026-11-12)

| # | Question | Decision |
|---|---|---|
| Q481 | Which documents | **All five at once:** Customer Invoice, Vendor Invoice, Sales Order, Quotation, Journal Entry. |
| Q482 | A variant's numbers | **Its own series** (for example RINV-26-000001), apart from the original's; set in Numbering like any document type. |
| Q483 | Where its documents are kept | **With the original's:** a Room Invoice is a Customer Invoice marked with its variant, so every report, ageing, statement, tax return, e-invoice and allocation includes it. Lists filter by variant. |
| Q484 | Its rights | **Its own module:** its own access, draft and post rights, menu entry (and approvals, see Q485); its documents post exactly as the original's. |
| Q485 | Its approvals | **Its own:** its own row in Approval Configuration, with its own approvers and limits; none set, its documents post without approval. |
| Q486 | Who sees its documents | **Variant users see only theirs:** with only the variant's rights, only that variant's documents are listed and opened. With the original's rights, every document, the variant's included, on the original's screen too. |
| Q487 | Its extra fields on the print | **Yes:** with their labels under the header details, under the variant's own title. |
| Q488 | Build | **Yes**, all five, in steps. |

### The proposal

- **A variant is a definition** in the builder (kind *variant*, id X_..., the
  firm's, Q461): its original (one of the five), its name, its numbering
  prefix, its labels (a fixed list of the original screen's fields for each
  of the five), the fields it hides (only fields the original doesn't
  require), its extra fields (the builder's field types; kept on the document
  as VariantFields, shown in their own panel), and its defaults (for the same
  fixed list). It never has code of its own (Q463): the original's screen
  and functions run it, so every fix to the original reaches it.
- **Its own module (Q484)**: X_... in the registry with the original's
  capabilities (access, draft, post, and the original's others such as
  taxcode), its own menu entry. The shell serves the original's screen for
  it, with the variant's settings.
- **Rights for one request**: a call from a variant's screen carries the
  variant's id. callable.js checks it is a published variant of that
  original; for that request only, the original's rights are the
  variant's. Someone with Room Invoice rights alone can make and post Room
  Invoices through the invoice's own code, and nothing else: a call without
  the variant, or for a document of another variant, is checked as before.
- **Kept with the original's (Q483)**: the document has Variant (the id) and
  VariantFields. Saving keeps the variant it was made in; a document is
  opened, changed and posted only in its own variant's screen (or the
  original's, see Q486).
- **Its own series (Q482)**: when the original numbers a document (on
  posting, or on saving a Sales Order or Quotation), a variant's document
  takes the variant's prefix, through numbering.js, so it has its own
  format in Numbering and never takes the original's numbers.
- **The screens**: the five get stable hooks (data-variant-key) on the
  fields a variant may relabel, hide or default; a shell block applies the
  variant's settings, draws its extra fields, and the print uses its name
  and its extra fields (Q487).
- **Lists and reports**: the original's list gains a Variant column and
  filter; reports, ageing, tax returns and statements are unchanged (they
  already include every document of the original).

### Build (in steps)

1. **Core**: the variant definition (checks, the fixed lists per original),
   the registry (its module, its approvals row), the per-request rights in
   callable.js and auth.js, numbering's variant series.
2. **The five documents**: each keeps Variant and VariantFields on save,
   numbers by the variant, asks the variant's approvals (Q485), and lists or
   opens only the variant's documents for a variant-only user (Q486); the
   ported four through legacy-port patches, Quotation in quotations.js.
3. **Screens**: the hooks on the five, the shell's variant block, the print
   (Q487), the builder's variant editor, the Variant column and filter.
4. **Tests** (each document: rights for one request, a variant-only user
   refused the original's other documents, its own series, its own
   approvals, extra fields kept and printed), negative controls, Help, What's
   new, docs, deploy set (a change to the registry and to callable.js: every
   function).

### As built: phase 4 (2026-11-12)

As designed (Q481-Q488), with these points:

- **One request in one variant, decided at the centre.** callable.js reads
  data.__variant, checks it is a published variant and runs the handler
  inside it (variantContext.js, per request). Four central places then
  answer for the variant, only for its original's module and only in that
  request: auth.moduleHasCapability (the variant's rights, Q484),
  numbering.voucherNumber (its own series, Q482),
  approvals.beginApprovalInstance and resolveApprovalScopeKeyForDocument (its
  own Approval Configuration row; the instance's module is the variant, so
  its Home tasks open the variant, Q485). Nothing in the generated legacy
  code changes.
- **A variant's document from the original's screen.** Someone with the
  original's rights posting a Room Invoice on the Customer Invoice screen
  (Q486): when the request opens a variant's document by its id
  (variantDocuments.noteRead), the request notes its variant, so the
  document still takes the variant's series and approvers (seriesFor); the
  rights stay the user's own. The phone approval card decides a variant's
  approval through its original's decide function, naming the variant.
- **Its documents (variantDocuments.js, Q483, Q486).** In a variant's request,
  on its original's own store only: a document opened by its id is the
  variant's or none; the whole store read for its list is the variant's
  documents; a document written is marked Variant and VariantLabel, with the
  extra fields sent (VariantFields, checked by their types, a link from its
  choices for the document's company). Queries are never narrowed, so the
  credit check, a party's open items, ageing and statements see every
  document. Wired in movedPaths.js (Customer Invoice, Vendor Invoice, Sales
  Order), journal.js (Journal Entry) and quotations.js (Quotation, now
  numbered through voucherNumber, the same default series).
- **The definition** (builtDefinitions.cleanVariant, variantSpec.js): one of
  the five originals, a prefix of its own (refused when it is another
  document type's or another variant's; kept once published), labels,
  hidden fields (never one the original requires) and defaults for a fixed
  list of each original's fields, extra fields of the builder's types (not a
  company link). Its registry entry: the original's capabilities, storage,
  and an approvals row where the original has one (a Sales Order has none,
  so neither has its variant).
- **The screens.** getModuleFragment serves the original's screen with
  window.__variant. The shell's VARIANTS block: the title, the labels, the
  hidden fields, the defaults on a new document, the extra fields' panel
  under the header, the print (the variant's name and extra fields under
  the original's own heading: a tax invoice stays one), and the rpc naming
  the variant on every call and sending the extra fields with a save. The
  five screens call variantForm.open when they show a document, and mark a
  variant's document with its name on the original's list (a badge: the
  "filter" of the design is the list's Find box, which matches it).
  BUILDER.html: a variant editor (its original, the field changes, the
  extra fields in Fields).
- **Tests**: unit/builtVariants (the definition's checks; the registry
  entry; the request's variant only for its original); emulator/
  moduleBuilderVariants (the builder's checks and prefixes; a clerk with only
  the Room Invoice's rights makes, lists, posts only Room Invoices, refused
  the original's, numbered RINV-; its own approvers; Vendor Invoice, Journal,
  Sales Order and Quotation variants: their own documents and series);
  ui/moduleBuilderVariants (the Room Invoice on the invoice screen: title,
  label, hidden field, extra fields saved from the screen, its list, the
  print; the invoice screen's badge; the builder's variant editor).
  Negative controls, each caught then restored: a required field hidden
  (unit); the variant's rights not used (emulator, 3 tests fail); the
  document guard off (2 fail); the series not swapped (2 fail).
- **Deploy set** `module-builder-p4`: every function (callable.js, auth.js),
  with screens, then Hosting (public/index.html, the Help).

## Open questions for the owner

None: phase 2 Q470-Q473, phase 3 Q474-Q480 and phase 4 Q481-Q488 decided.
