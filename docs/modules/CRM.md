# CRM: leads, opportunities, activities and quotations

Status: **design agreed** (owner, 2026-11-05: "Go on", the design and the defaults as proposed); C1 and C2 (quotations) live 2026-11-06; C3 (rep portal) built 2026-11-06.

## The owner's direction (2026-11-05)

"Now we need to develop CRM module." The scope and the main rules were
decided in three rounds of questions the same day (Q393-Q404 below).

## Today

The sales side already has what the CRM builds on:

- **Customer Master** (customers, their price list classification, credit
  limits through Credit Control, foreign currency).
- **Sales Order** with price lists, discounts and line tax codes
  (salesTax.js `computeTax`, `previewOrderTax`), the **Proforma** from an
  order (proforma.js), Create next / Linked documents (flows.js).
- **Numbering** (numbering.js) for document series.
- **Approval Configuration** (approvals.js, approvalRegistry.js) and
  **Home tasks** (homeTasks.js, followUps.js).
- **Sales reps in the Employee Portal** (SALES_REP_PORTAL.md: the Sales tab,
  orders and receipts from the phone, through `essPortal` actions).
- **Master Import** (masterImport.js) for bulk entry from Excel.

There is no record of prospects, of a pipeline, or of a quotation before
the order.

## The owner's decisions (2026-11-05)

| # | Decision |
|---|---|
| Q393 | **Scope:** the pipeline (Leads, Opportunities with stages and expected value, Activities) **and Quotations** in the first version. |
| Q394 | **Lead to customer:** a **Convert to Customer** button opens the Customer Master form filled from the lead; the normal customer rules and approval apply; the lead keeps a link to the customer. |
| Q395 | **Users:** office users in the ERP, and **sales reps in the Employee Portal**. |
| Q396 | **Visibility:** each lead / opportunity has an **owner**; owners see their own; sales managers and admins see all, per company; reassigning is a manager action. |
| Q397 | **Stages:** a default list (New 10 %, Qualified 25 %, Proposal 50 %, Negotiation 75 %, Won 100 %, Lost 0 %), **editable per company** in CRM Setup; Lost asks for a reason from a list. |
| Q398 | **Quotation like a Sales Order:** item lines with the price list, discount and tax codes, Valid until, its own series (QT-...), print / PDF in the shared print style, **revisions** kept, and **Create Sales Order** copying its lines. It posts nothing. |
| Q399 | **A quotation can go to a lead;** turning it into a Sales Order first asks to convert the lead to a customer. |
| Q400 | **Approval:** a new document type **Quotation** in Approval Configuration, off by default; when set, a quotation is approved before it is final. |
| Q401 | **Activities:** Call, Meeting, Email, Visit or Task with a due date, against a lead, opportunity or customer; open ones on the owner's **Home tasks** (and the rep's portal); overdue flagged; closing asks for the outcome and can schedule the next. |
| Q402 | **Reports:** Pipeline, Win / loss, Activities and **Lead sources**. |
| Q403 | **Leads:** a **duplicate warning** (phone, email or name matching a lead or a customer; saving still allowed) and **import from Excel** through Master Import. |
| Q404 | **Rep portal:** reps add and edit their leads, log and close activities, move their opportunities' stage, **and make quotations** from the phone. |

## Proposal

### The records

All in Firestore, each reached through one store (`crmStore.js`, on
docStore like the other transaction stores), read by equality queries
(company, owner, status), never a whole collection.

- **Lead** (`crmLeads`): company; name, organisation, phone, email,
  address, country; **source** (from a list in CRM Setup: website,
  referral, exhibition, walk-in, ...); owner; status (Open, Converted,
  Disqualified with a reason); the customer once converted.
- **Opportunity** (`crmOpportunities`): company; a lead **or** a
  customer; title; stage (and its probability); expected value and
  currency; expected close date; owner; Won / Lost (with the lost reason)
  and when; its quotations.
- **Activity** (`crmActivities`): type; subject; due date and time; the
  lead, opportunity or customer it is about; owner; status (Open, Done
  with the outcome, Cancelled).
- **Quotation** (`quotations`): number (QT series, per company, through
  numbering.js), revision; company; customer **or** lead; the opportunity
  (optional); date, Valid until; currency; the dimensions; item lines as
  a Sales Order's (item, warehouse optional, quantity, price from the
  customer's price list, discount, tax code); totals and tax (salesTax.js
  `computeTax`, as the Sales Order); status Draft, Pending approval,
  Approved / Sent, Accepted (became an order), Rejected, Expired; the
  Sales Order made from it.

### The rules

- **Visibility (Q396):** a user sees the records they own; a user whose
  role has the new **CRM Manager** right sees every record of their
  companies, and alone can reassign. The rep portal shows the rep's own.
  Enforced on the server, in every read.
- **Stages (Q397):** CRM Setup per company: stages (name, probability,
  order; Won and Lost fixed at the end), lost reasons, lead sources,
  activity types. Moving an opportunity to Won asks for its quotation /
  order when there is one; to Lost, for the reason.
- **Duplicates (Q403):** saving a lead compares the normalised phone,
  email and name with the company's leads and customers, and warns with
  the matches (Save anyway / Open the match).
- **Convert (Q394, Q399):** Convert to Customer opens Customer Master
  pre-filled (name, contact, phone, email, address); once the customer is
  saved, the lead is Converted and linked, and its open opportunities and
  quotations move to the customer. Create Sales Order from a lead's
  quotation asks for this first.
- **Quotation (Q398, Q400):**
  - Revise makes Rev 2 (the earlier stays, read-only); only the latest
    revision can become an order.
  - Approval, when configured: Submit → approve / reject (Home tasks, the
    approval card on a phone), like the other documents.
  - Create Sales Order (flows.js CreateFrom) copies the lines, price and
    tax codes; the quotation becomes Accepted and links both ways; the
    opportunity can be marked Won at the same time.
  - Past Valid until, an open quotation shows Expired; it can be revised.
- **Activities on Home (Q401):** an open activity due today or overdue is
  a Home task of its owner (overdue in amber); done asks for the outcome
  and offers "Schedule the next".

### The screens

- **CRM** (one module, tabs): **Leads**, **Opportunities** (a list and a
  stage board: columns by stage, drag to move), **Activities** (mine /
  all, by due date), each with its entry form in the entry layout.
- **Quotation**: list and entry, in the entry layout, printed in the shared
  print style.
- **CRM Setup**: stages, lost reasons, lead sources, activity types.
- **CRM Reports** (Q402): Pipeline (by stage, owner, expected close
  month; total and weighted value), Win / loss (by period, owner, lost
  reason; win rate), Activities (done / overdue by owner and type), Lead
  sources (leads, conversions and won value by source).
- **Employee Portal, Sales tab (Q404):** My leads, My opportunities (move
  the stage), My activities (log, close, schedule the next), Quotations
  (make, submit, view, share the PDF).
- **Master Import:** Leads.

### Defaults I propose (say if any should differ)

- A quotation is **valid 30 days** by default (changeable per company in
  CRM Setup).
- A quotation's currency follows the customer's (as a Sales Order); for a
  lead, the company's base currency, changeable.
- Quotation numbers: **QT-yy-mm-nnnnnn**, as the other series.
- The CRM rights: **CRM** (use) and **CRM Manager** (see all, reassign,
  setup); **Quotation** as its own module for the role matrix.

## Step C3: the rep portal (owner, 2026-11-06)

Two more decisions, asked before building C3:

| # | Decision |
|---|---|
| Q405 | **A rep's quotation price:** the price list's price is fixed on the phone; the rep may give a **discount per line**. Approval Configuration's Quotation levels catch large discounts, as in the ERP. |
| Q406 | **A rep orders from the phone:** an approved quotation becomes a **draft Sales Order** like a portal order today (the quotation's net prices, the rep's cost center); the office confirms it in Sales Order. The quotation becomes Accepted. |

Defaults taken from what is already agreed (say if any should differ):

- A rep owns what they create (`E:<employee>`), and sees their own leads,
  opportunities, activities and quotations; a rep who is a **sales manager**
  (Sales reps, IsManager) sees the company's, as with customers (decision
  230). The office's CRM Manager sees the reps' records as before.
- A rep quotes their own customers (the customers they serve) and their own
  leads; the price list is the customer's (or, for a lead, the chosen
  classification's).
- Approving stays in the ERP (Home, the approval card): a rep submits.
- The rest is the ERP's rules, run on the server the same way: the duplicate
  warning, stages and Lost reasons, Done with the next activity. Convert to
  Customer stays in the ERP (Customer Master's rules and accounts).
- The quotation PDF is shared from the phone as a receipt is (the share sheet,
  or a download).

## Step C4: reports and import (owner, 2026-11-06)

Four more decisions, asked before building C4:

| # | Decision |
|---|---|
| Q407 | **Currencies in the reports:** the Pipeline and Win / loss totals are in the company's **base currency at the latest rate** in Currency Master; each line still shows its own currency and amount. |
| Q408 | **Who sees the reports:** a **Reports tab in CRM**, the same visibility as the records: a user sees their own; a CRM Manager sees every owner of their companies, with an owner filter. |
| Q409 | **Duplicates on import:** the check lists a row matching a lead or customer (phone, email or name) as a **warning**; such rows are skipped unless the user ticks **Import matches too**. |
| Q410 | **Owner on import:** an optional **Owner** column (a user ID or a sales rep's employee code); empty is the person importing; only a CRM Manager may name someone else. |

## Build plan

Each step its own PR, tested and deployed before the next:

1. **C1 Pipeline:** CRM Setup, Leads (duplicate check), Opportunities
   (list and stage board), Activities with Home tasks; visibility; Convert
   to Customer.
2. **C2 Quotations:** the Quotation document (lines, tax, revisions,
   print), Approval Configuration's Quotation type, Create Sales Order,
   the lead-to-customer step on order.
3. **C3 Rep portal:** the CRM pages in the portal's Sales tab, quotations
   included.
4. **C4 Reports and import:** the four reports; Leads in Master Import.

Help: a CRM area in help/areas.json with a page per screen, written with
each step; What's new at each release.

## As built: step C1, the pipeline (2026-11-06)

- **functions/src/crm.js** (Firestore `crmSetup`, `crmLeads`,
  `crmOpportunities`, `crmActivities`; equality queries by company or by
  owner only):
  - **Owners** are keys: `U:<uid>` (an ERP user) or `E:<employeeId>` (a
    sales rep, for the portal in C3). A user's own keys are theirs and the
    employee linked to them (`employees.UserUID`). Owners offered: the
    company's users with the CRM write right and its active sales reps.
  - **Rights** (moduleRegistry `CRM`): access (see one's own), write (create
    and change), manage (the CRM Manager: every record of one's companies,
    reassign, Setup). Defaults: Admin and Finance Manager all, Accountant
    access and write, Viewer access.
  - `getCrm` (the screen's data), `saveCrmSetup`, `saveLead` (the
    duplicate check, Q403: phone on its last 9 digits as Customer Master,
    email, name; `{ success: false, duplicates }` until saved with force),
    `disqualifyLead`, `convertLead` (after Customer Master's own
    `saveCustomer`: the lead Converted and linked; its opportunities and
    activities moved to the customer, in one batch), `saveOpportunity`,
    `setOpportunityStage` (Lost needs a listed reason; Won / Lost close it),
    `saveActivity`, `closeActivity` (Done needs the outcome; can create the
    next activity), `reassignCrm`, `getCrmActivitiesDueForUser` (Home).
- **screens/CRM.html**: the tabs Leads, Opportunities (Board, with drag and
  drop between stages, and List; total and weighted value), Activities
  (mine / all for a manager), Setup (a manager's); each record's entry in
  the entry layout; the Lost, Done and Convert dialogs.
- **Home** (public/index.html): the block **CRM Activities Due** (the user's
  own, today or overdue in amber), counted in Tasks, opening the activity.
- **Menu:** Customer Experience & CRM Solutions → Lead & Opportunity
  Management → CRM. **Data Reset:** CRM records (transactional) and CRM Setup.
- **Help:** a CRM area with its page; Getting started (Home tasks), Data
  Reset and What's new.
- **Tests:** emulator/crm (6: setup and its defaults; leads and the
  duplicate warning; visibility, the manager and the Viewer; opportunities
  through the stages; activities on Home and done with the next; Convert to
  Customer), ui/crm (6), ui/home (the CRM block). Negative controls, each
  caught and restored: everyone seeing the company's records (the
  visibility test fails); no duplicate found (the lead test fails); the
  board's drop not moving the stage (the UI board test fails).
- **Results:** full emulator regression all passed but essPortal "who is
  away today" (date-dependent, fails on main too); the Data Reset counts
  updated for the two new categories; unit 224/224; UI crm 6/6, home 19/19,
  dataReset, rolesMatrix, developer, smoke 123/123, singleCompany 58/58,
  help, oneTitle.
- **Deploy:** `crm-c1` (every function: moduleRegistry.js), with screens,
  then Hosting.

## As built: step C2, quotations (2026-11-06)

- **functions/src/quotations.js** (Firestore `quotations`, read by company,
  or by lead on Convert):
  - **Rights** (moduleRegistry `QUOTATION`): access (the company's
    quotations, print), write (make, submit, revise, order). Defaults: Admin,
    Finance Manager and Accountant both, Viewer access. Unlike the CRM
    records, a quotation has no owner filter: everyone with access sees the
    company's (a document, like a Sales Order).
  - `getQuotations` (the list, with Expired worked out against today, and the
    customers, open leads, open opportunities and classifications),
    `getQuotationPriceList` (the customer's classification's, or the chosen
    one for a lead: the company's active price list mapped to it),
    `saveQuotation` (a draft or a rejected one; the lines priced: net price =
    unit price less the discount, rounded; the tax by `salesTax.orderTax`,
    the Sales Order's estimate, now shared; the **QT** number from
    numbering.js on the first save, under the global lock; format
    QT-yy-<company code>-000001 like the other document series),
    `deleteQuotationDraft` (a first draft only), `submitQuotation`
    (Approval Configuration's **Quotation** type, the amount its total; no
    levels: Approved at once; an expired one refused), `decideQuotationApproval`
    (Home and the phone's approval card), `reviseQuotation` (approved,
    rejected or expired: the next revision, the same number, Rev n+1, dated
    today with a new Valid until; the earlier one Revised, read-only),
    `markQuotationOrdered` (after the Sales Order's own save from the screen:
    the order must be this quotation's company and customer; Accepted and
    linked; the opportunity Won when asked; a lead's refused until converted).
  - `crm.convertLead` also moves the lead's quotations to the customer
    (`FromLeadID` kept), in the same batch.
- **screens/QUOTATION.html**: the list (open / each status), the entry in the
  entry layout (customer or lead, classification for a lead, dates,
  opportunity; lines with the price list's price on choosing the item, the
  discount and the amount; totals with the tax after Save), Submit, Revise,
  Delete, Print (the shared print style, sent outside: no ERP title bar),
  **Create Sales Order** (cost center and warehouse asked; a draft Sales Order
  through `saveDraftSalesOrder` at the net prices, then opened). A lead's
  quotation offers to open the lead in CRM to convert it.
- **CRM screen:** New Quotation on an opportunity and on a lead; CRM opens a
  lead given `OpenLeadId`.
- **Approval Configuration:** the Quotation type (off until set); the approval
  card decides through `decideQuotationApproval`.
- **Menu:** Sales & Distribution → Pre-Sales Activities → Quotations (the tree's existing
  node, now the module). **Numbering:** the QT series. **Data Reset:**
  quotations with the CRM records.
- **Help:** the Quotations page (CRM area); CRM, Numbering, Data Reset and
  What's new updated.
- **Tests:** emulator/quotations (5: number, discount, VAT, price list and
  the checks; submit without levels and Revise; with levels, Home, the card,
  reject and resubmit; a lead's quotation through Convert to the order and
  the opportunity Won; expired), ui/quotation (6). Negative controls, each
  caught and restored: Create Sales Order at the list price instead of the
  net (the UI order test fails); the order's customer not checked (the lead
  test fails); Convert not moving quotations (the lead test fails). The UI
  test also found a real race, fixed: an item chosen while the price list was
  still loading got no price; the price now waits for the list.
- **Results:** full emulator regression all passed but essPortal "who is
  away today" (date-dependent, fails on main too); unit 224/224; UI quotation
  6/6, crm 6/6, home 19/19, dataReset, rolesMatrix, developer, smoke 123/123,
  singleCompany 58/58, help 7/7, oneTitle 9/9, approvalRouting 4/4,
  entryLayoutWave 39/40 (PDC Issued's header 248 px over its 235 px limit;
  the same on main, PDC Received too: not this change).
- **Deploy:** `crm-c2` (every function: moduleRegistry.js), with screens,
  then Hosting.

## As built: step C3, the rep portal (2026-11-06)

- **The rep as the one acting.** crm.js and quotations.js keep each callable's
  work as a core taking the person acting (`callable(name, core)`): an ERP
  user (`requireUser`), or a sales rep through the portal (`crm.portalUser`:
  `{ uid, portal: { empId, companyId, manager, actor, submitter } }`). With a
  rep, the same rules run, plus:
  - owner key `E:<employee>` for what the rep adds (whatever owner is asked);
    the rep sees their own, a **sales manager** (Sales reps → IsManager) the
    company's; the company is always the rep's (set on the server);
  - opportunities, activities and quotes only for the customers the rep
    serves (`customers.SalesRepEmployeeID`) and their own leads and
    opportunities;
  - a quote's price is the price list's on its date, whatever the phone sends;
    an item not on the list is refused; the discount is the rep's (Q405);
  - the approval's submitter is the rep's ERP user when they signed in with
    one (self-approval still seen), else the rep's name;
  - not from the portal: Convert to Customer, CRM Setup, reassigning, deciding
    an approval (each refused, "Not from the portal").
- **essPortal actions:** `crm` (the rep's open leads, opportunities, activities
  and quotations, the setup, their customers, the warehouses), `crmRun` and
  `quoteRun` (`{ what, data }`: saveLead, disqualifyLead, saveOpportunity,
  setOpportunityStage, saveActivity, closeActivity; saveQuotation,
  submitQuotation, reviseQuotation, deleteQuotationDraft), `quoteItems` (the
  price list's items at their price), `quoteOrder` (Q406: an approved,
  unexpired quote for a customer becomes a draft Sales Order through
  `salesRep.writeRepOrder`, the portal order's own write: the rep's cost
  center, the chosen warehouse, the quote's net prices; then the quote is
  Accepted and its opportunity Won).
- **public/ess.html**, Sales tab: chips Customers / Leads / Pipeline /
  Activities / Quotes; a lead form (the duplicate warning, Disqualify, New
  opportunity, New quote); the pipeline by stage (the stage changed on the
  card, Lost asking the reason); activities by due date (Done with the
  outcome and the next a week later); quotes (the price list's items, a
  discount per line, Save, Submit, Share / Download the PDF made on the
  phone, Revise, the warehouse and Send the order). The receipt's hand-made
  PDF writer is shared (`pdfOf`).
- **Help:** Sales reps in the Employee Portal (a section on the CRM pages),
  CRM, Quotations, What's new.
- **Tests:** emulator/crmPortal (5: leads, visibility and the duplicate
  warning; opportunities and activities for the rep's own; the price fixed,
  the discount the rep's, only their customers; approval in the ERP and the
  order from the phone; a lead's quote, Revise, a rep no longer a rep);
  ui/crmPortal (4). unit/approvalCard reads a decide function defined by
  `callable('name', ...)` too. Negative controls, each caught and restored:
  the phone's price kept (2 tests fail); every rep seeing the company's
  records (3 fail); the quote form's redraw resetting the customer (the UI
  quote test fails). The UI test also found two real faults, fixed: the
  quote form lost the chosen customer when a line was added, and an order
  from a quote had no warehouse to deliver from.
- **Results:** full emulator regression all passed but essPortal "who is
  away today" (date-dependent, fails on main too); unit 224/224; UI crmPortal
  4/4, salesRepPortal 8/8, essRequests, essClaims, crm 6/6, quotation 6/6,
  home 19/19, help 7/7, smoke 123/123; essPortal UI 2 failures that fail the
  same on main (date-dependent: the Team badge).
- **Deploy:** `crm-c3` (26 functions; no new function, no screens), then
  Hosting.

## As built: step C4, reports and lead import (2026-11-06)

- **Reports (Q402, Q407, Q408).** `getCrmReports` (crm.js) returns the four
  reports for a company from the records the user may see (`visible`, the
  same rule as the lists: their own; a CRM Manager the company's, with an
  owner filter that is ignored for anyone else). The figures are worked out
  by `crmReports`, a pure function (unit/crmReports):
  - **Pipeline:** the open opportunities today, by stage (the setup's order,
    empty stages shown), owner and expected close month (no date last);
    total and weighted (value × the stage's probability).
  - **Win / loss:** won or lost with `ClosedAt` in the period, by month and
    owner, with the win rate by count (won ÷ won + lost); the lost by reason.
  - **Activities:** by owner and type: done with `DoneAt` in the period,
    open, and of those overdue (due before today).
  - **Lead sources:** leads created in the period by source ("Not given"
    for none), converted, conversion %, and the won value of the
    opportunities from them (`LeadID`, or `FromLeadID` after Convert).
  - **Currency (Q407):** each value to the base currency (Currency
    Configuration's default) at `exchangeRates.rateOn(code, today)`, the
    latest rate. A currency with no rate is listed (`missingRates`), its
    lines keep their own currency and amount, and it is left out of the
    totals; the screen names it above the reports.
  - The screen: a **Reports** tab in CRM (From / To, the start of the year
    to today at first; Owner for a manager; Show), nine tables with a total
    row, each with **Copy to Excel** (the shell's `gridClipboard`).
- **Lead import (Q403, Q409, Q410).** Master Import's `LEAD` master, "CRM
  Leads" (last in the order; listed only for a user with CRM access): the
  columns Company, Organisation, Contact Name, Phone, Email, Source, Owner,
  Country, Address, Notes. `leadRules` checks what New Lead checks (a name
  or organisation; a phone or email; the source from the company's CRM
  Setup, matched ignoring case and written as Setup writes it), and the
  Owner: a user ID (username) or a sales rep's employee no., one who can own
  CRM records in the company (`ownersOf`); someone other than oneself only
  for a CRM Manager. Each row is saved through `saveLead` (crm.js
  `saveLeadFor`, with `force`: the matches were shown at the check).
  - **Matches:** a row matching a lead or customer of the company
    (`duplicateMatcher`, loaded once per company for the whole paste; the
    same phone / email / name rule as the form), or a row above it in the
    paste, is a **warning**, not an issue. Without **Import matches too** the
    row is left out (`skip`), and the result says how many; with it, every
    row imports. Warnings never hold the import back; the screen's amber
    list shows them, and ticking or unticking checks the paste again. A
    paste whose every row would be left out cannot be imported.
  - Master Import's other masters are unchanged (warnings are LEAD only).
- **Tests:** emulator crmReports 5/5 (the latest rate, not the older one,
  and EUR with no rate left out; the other company never; a user's own, the
  owner filter ignored for them, a manager's filter; the form's checks, the
  Owner by user ID and employee no. and the manager-only rule; matches left
  out, in the paste too, then imported with the box; the Viewer refused and
  CRM Leads not listed without CRM access); unit crmReports 4/4; UI
  crmReports 4/4. Negative controls, each caught and restored: the rate on
  an older date (reports test 1 fails); the owner filter for anyone (test
  2); matches never left out (import test 4); anyone naming another owner
  (import test 3); the screen not showing the warnings (UI test 4).
- **Results:** unit 228/228; emulator crm 6/6, crmPortal 5/5, quotations
  5/5, masterImport 9/9 (its list of masters now ends with CRM Leads),
  masterImport2 7/7, masterImportItemTax 2/2, masterImportUpdate 5/5,
  masterImportUpdate2 6/6, essPortal 7/8 ("who is away today",
  date-dependent, fails on main too); UI crm 6/6, crmPortal 4/4, quotation
  6/6, masterImport 5/5 (the same list), masterImportUpdate 4/4,
  masterImportItemCode 2/2, smoke 123/123, oneTitle 9/9, rolesMatrix 2/2,
  help 7/7.
- **Deploy:** `crm-c4` (24 functions: the closure of crm.js and
  masterImport.js; one new callable, getCrmReports), with screens, then
  Hosting (the Help). No rules or index change.
