# UX batch 4 (owner, 2026-11-13)

Status: **Wave A built 2026-11-13** (see *As built: Wave A*), decisions Q500–Q511. Waves B and C next.

## The owner's list

| # | Item | Module |
|---|---|---|
| 1 | One login for the ERP and the Employee Portal, a user with no ERP access (a rep too) sent to the portal | Sign-in, portal |
| 2 | A limit to the companies and users of a corporate | Client Management |
| 3 | Items in Firestore for very large catalogues (a supermarket) | Items |
| 4 | A default cost center for inventory transactions | Inventory |
| 5 | Help inside the Developer module (the Cloud Shell scripts too), renamed Client Management | Client Management |
| 6 | Roles & Permissions: the role header stays at the top on scrolling | Roles |
| 7 | The firm can turn a client's Data Reset off | Client Management |
| 8 | A 2–4 letter short code per module; typed in the search, Enter opens it | Menu |
| 9 | MIS Dashboard tile sizes (1, 2, 4 wide); a tall tile beside two normal ones | MIS Dashboard |
| 10 | Approve and Reject sometimes missing when an entry is opened from a task (seen on IPR); all approvals at the bottom of the entry | Approvals |
| 11 | Enter on a module's list opens a new entry | Shell |
| 12 | Esc goes back to Home, or to the report an entry was opened from | Shell |
| 13 | Is a description needed on inventory transactions? | Inventory |
| 14 | Audit logs | New module |
| 15 | The companies chosen on Home applied everywhere: tasks, MIS, imports, every other place | Shell, Home, MIS, import |
| 16 | Search clients in the Developer module | Client Management |

## What is there today (checked in the code)

- **1:** two pages, `index.html` (the ERP) and `ess.html` (the portal). An
  ERP user with a portal account opens the portal from **My Portal** in the
  user menu.
- **2:** no limit.
- **3:** the stock transactions moved to Firestore (TRANSACTIONS_FIRESTORE.md,
  T1); the item master did not. It is `items` in RTDB, read whole by many
  screens and functions. That whole read is what fails first for tens of
  thousands of items.
- **7:** Data Reset (DATARESET) is a normal module. The firm can already
  untick it in a client's modules, and the client's Admin can't switch it
  back. It just isn't obvious.
- **10:** each of 23 entry screens has its own approval banner, placed where
  that screen put it (the IPR's sits under the form), and each checks
  `getMyPendingApprovalLevel` itself after the entry has loaded. Opened from
  a task, the banner depends on that check finishing after the entry is
  drawn. That is the likely cause of "sometimes not loading"; to be
  confirmed by reproducing it.
- **13:** a description is required on the header and every line in GRN,
  Material Issue, Stock Adjustment, Warehouse Movement, Purchase Return and
  Sales Return (hand-written), and in Delivery Note, Physical Count,
  Production, Vendor Invoice and Customer Invoice (ported: changed through
  the legacy port's patches only).
- **15:** the company filter (decision 273) exists: the user picks, on Home,
  which companies the screens offer. The Home tasks, the MIS, Master Import
  and some lists don't apply it.

## The owner's decisions (2026-11-13)

| # | Question | Decision |
|---|---|---|
| Q500 | One login | **One page, routed:** everyone signs in on the ERP page. A user with no ERP access (an employee, or a rep with the portal only) goes straight to the portal; a user with both opens the ERP, with My Portal in the user menu as now. The portal's own address keeps working. |
| Q501 | Limits | **Refuse, Active only:** the firm sets the maximum companies and users per corporate (blank = no limit). Adding one more Active company or user is refused, with a message to contact the provider. Inactive ones don't count; nothing already there is switched off. |
| Q502 | Default cost center | **Per warehouse:** each warehouse (Org Units) has a default cost center, which an inventory entry takes when its warehouse is chosen, still changeable. |
| Q503 | Description | **Optional, filled in:** a blank header saves a default (for example "GRN from PO-26-000123", "Stock adjustment"); a blank line description takes the item's name. Journals, invoices and payments keep theirs required. |
| Q504 | Short codes | **Fixed by the firm:** one unique code per module in the registry (built modules from their id), the same in every corporate, shown beside the menu item and searchable. |
| Q505 | Tile sizes | **Width 1, 2 or 4; height normal or tall:** a tall tile (2 rows) sits beside two normal tiles stacked, so nothing is stretched. Defaults: key figure and gauge 1, top list 2, chart 2 tall. |
| Q506 | Esc and unsaved changes | **Ask first:** "Leave without saving?" (the in-app dialog). Esc in an open dialog, picker or search only closes that, as now. |
| Q507 | Help for the firm | **Inside Client Management only:** a Help tab there (Corporate 100), never the public Help, since it names the firm's tools: onboarding a client, the Cloud Shell commands, groups and packs, releases. |
| Q508 | Audit log: what | **Actions and changed fields:** every save, submit, approve or reject, post, reverse, delete and status change of documents and masters; users, roles and rights; settings; data reset. Who, when, which record, and for masters and settings each changed field (before → after). A document records the action and its key totals, not every line. |
| Q509 | Audit log: who, how long | **Admin, append-only, 7 years, cleared by Data Reset:** a new Audit Log module (Admin by default), filtered by user, module, record and date. No one can change or delete an entry; entries over 7 years old are removed. **Data Reset clears it too** (owner: reset is used only in development and testing). |
| Q510 | Large catalogues | **Design first, for everyone:** a design doc (ITEMS_FIRESTORE.md) on moving the items to Firestore for every corporate, with screens searching items on the server as you type instead of loading them all. Measured on a 50,000-item test catalogue first; its own decisions once written. |
| Q511 | Data Reset off | **Keep the module switch, make it obvious:** "Data reset: allowed / off" shown on the client's card, with its own toggle in Client Management. |

## The plan

Three waves, each its own PR and deploy. Each step follows the standing
rules: tests with a negative control, Help and What's new, docs and ROADMAP,
deploy set.

**Wave A: the shell and the screens (no data changes)**

- **11, 12:** the shell's keys, in one block in public/index.html:
  - **Enter** on a module's list (focus not in a field, no dialog open)
    presses its **New** button. Each screen's New button gets a common mark
    (`data-new`), checked by a unit test over the screens.
  - **Esc:** back to where the screen was opened from (a report, else Home),
    after "Leave without saving?" if the entry has unsaved changes (Q506).
    A screen says it has unsaved changes through one shell call;
    the entry screens get it (by SCREEN_EDITS for the ported ones).
- **6:** Roles & Permissions: the role header sticks to the top of its table
  when scrolled.
- **8:** short codes in moduleRegistry.js (`short`), unique, checked by a unit
  test; the menu search matches them, Enter on an exact code opens it; shown
  beside the menu item (Q504). A registry change: every function deploys.
- **9:** MIS Dashboard tiles get a width (1, 2, 4) and height (normal, tall),
  saved with the tile (misDashboard.js); the shell's MIS TILES grid uses
  dense rows so a tall tile sits beside two normal ones (Q505). Home shows
  the same.
- **10:** approvals at the bottom of every entry: one shell **APPROVAL BAR**
  block (approve or reject with a reason, the level, who decides next)
  that each of the 23 entry screens mounts at its foot. It waits for the
  entry to load before checking `getMyPendingApprovalLevel`, so it no
  longer misses. The IPR case is reproduced first, as a UI test that fails
  before the fix.
- **15:** the Home company filter applied to the Home tasks, MIS (reports,
  builder, dashboard), Master Import and every company list that doesn't
  take it yet. A unit test lists the screens with a company choice and
  checks each uses the shell's filtered list.
- **16, 5 (rename), 7:** Client Management:
  - the Developer module's label becomes **Client Management** (its id
    stays DEVELOPER, so rights and menus are unchanged);
  - a search over clients (id, name, group, status);
  - "Data reset: allowed / off" on each client, with its own toggle (Q511).

**Wave B: rules (server and data)**

- **1 (Q500):** sign-in on the ERP page; `completeLogin` says whether the
  user has ERP access, a portal account, or both; no ERP access goes to
  `/ess.html`, signed in (the same account, so no second sign-in). Reps
  too. ess.html unchanged for those who use it directly.
- **2 (Q501):** `MaxCompanies` and `MaxUsers` on the directory entry, set in
  Client Management; saving a new Active company or user (or making one
  Active again) refused at the limit, in companies.js and the user
  functions.
- **4 (Q502):** a warehouse's **Default cost center** (Org Units). GRN,
  Material Issue, Stock Adjustment, Warehouse Movement, Physical Count,
  Production and Delivery Note fill it in when the warehouse is chosen. The
  ported screens get it by SCREEN_EDITS; the server uses it when the entry
  sends none.
- **13 (Q503):** descriptions optional on the inventory transactions,
  filled in on the server. The ported ones (DN, Physical Count, Production)
  get it through legacy-port patches, recorded in MIGRATION.md as a
  behaviour change. Invoices, journals and payments unchanged.
- **5 (Help):** Client Management's Help tab (Q507). Kept in the code with
  the screen, never in public/help; it covers onboarding a client, the
  Cloud Shell commands (deploy, rules, release), groups, packs and
  releases.

**Wave C: the two designs**

- **14, audit log (Q508, Q509):** a design doc, AUDIT_LOG.md. Proposed:
  - one shared `audit.js` writer, called from the places every change
    already goes through (callable.js for the action, the stores and the
    master saves for the changes), so no module is missed;
  - stored per corporate in Firestore `auditLog` (append-only: no function
    updates or deletes an entry except the 7-year sweep and Data Reset);
  - a new **Audit Log** module, filtered by user, module, record and date,
    Copy to Excel.

  The doc comes to you before code, for what each module records and the
  cost (a write on every change).
- **3, large catalogues (Q510):** a design doc, ITEMS_FIRESTORE.md:
  - measure today's screens and functions on a 50,000-item test catalogue;
  - the move to Firestore, done like T1: the store, the readers, the
    pickers searching on the server;
  - its own owner questions.

## Order and effort

Wave A first: the most visible, and no data changes. Then Wave B, then the
two Wave C designs to you.

**Deploys:**

- Wave A deploys every function (the registry gains the short codes) with
  screens and Hosting.
- Wave B deploys every function (completeLogin, the company and user saves,
  the ported saves) with screens and Hosting.

## As built: Wave A (2026-11-13)

- **6, Roles:** the matrix scrolls in its own box (`#perm-scroll`, 75% of
  the window high, inline styles since the built CSS lacked the classes),
  its header row sticky. A SCREEN_EDIT in tools/legacy-port/generate.js.
- **8, short codes:** functions/src/moduleShortCodes.js (SHORT, `codeFor`),
  not a `short` field in moduleRegistry.js: a list beside the registry,
  checked against it by unit/moduleShortCodes. A built module (X_...) takes
  the first letters of its id, up to 4, unless taken. buildVisibleTreeList
  gives each menu item its `short`; the menu shows it and Enter on an exact
  code opens the module. The DEVELOPER label changed too (Client
  Management), so every function deploys.
- **9, tile sizes:** `w` (1, 2, 4) and `h` (1, 2) on each tile, cleaned in
  misDashboard.js (defaults by kind: key figure and gauge 1, top list 2,
  chart 2 tall); the MIS TILES grid packs densely (`grid-flow-row-dense`).
- **11, 12, keys:** the shell's SCREEN KEYS block. A screen with
  `hasUnsavedChanges()` answers for itself; any other counts as unsaved once
  a field of a form, entry, editor, detail, modal or line area is changed
  (not a search or filter box, nor `[data-no-dirty]`); a successful save,
  post, submit and so on clears it. Enter (focus on nothing in particular,
  nothing unsaved) presses `[data-new]` or the shown **New** button. Esc
  with a pop-up open is left to the pop-up (recorded before any screen's
  own Esc handler runs). **Departure:** no `data-new` mark added to every
  screen; the New button is found by its text, which every list screen
  has. ux4Keys.ui checks it.
- **10, approvals:** the shell's APPROVAL BAR block,
  `approvalBar.show(banner, { instanceId, rights })`, called by all 23 entry
  screens in place of their own `getMyPendingApprovalLevel` call.
  - **The IPR cause, reproduced:** the screens showed their banner only
    `&& canPost`, and `canPost` came from a rights call made in parallel
    with loading the list and the entry. Opened from a Home task, the
    entry could be drawn before the rights arrived, and the banner was then
    never shown. approvalBar waits for the module's rights itself (Post,
    which every decide function requires on the server), and drops an
    answer for an entry no longer on the screen. ui/approvalBar holds the
    rights answer back 2.5 seconds: before the fix the IPR's bar never came.
  - The banner moves to the end of its entry view, under the lines and
    totals and above the supporting documents.
  - A new callable, `getApprovalBarInfo`, gives the level and every
    level's approver, so the bar says *Level 1 of 2. Then: … (level 2).*
  - **Departure:** each screen keeps its own banner and decide call (23
    different decide functions with their own arguments). The shell owns
    when and where the bar shows, and its words.
- **15, the company filter:**
  - Home tasks: each task now carries its document's `CompanyID` (pending
    approvals and rejected submissions from the document, follow-ups,
    PDCs due, clearances, employee requests; drafts had it). The shell
    keeps each list as it came and draws only the chosen companies' (a task
    with no company always shows), again when the choice changes.
  - My dashboard on Home, the MIS Dashboard and MIS Reports (with the
    builder) list only the chosen companies.
  - Every company dropdown, whatever its id (one is a company dropdown when
    an option is one of the user's companies), hides the companies not
    chosen. A dropdown with no blank option that starts on a company not
    chosen moves to the first chosen one, once, when its options are new,
    and only after the screen's own calls have all answered: its change
    listener reloads what depends on the company, which a screen still
    loading isn't ready for (found on Quotations and the MIS Dashboard).
  - Master Import: a row (new or update) for one of the user's companies
    not chosen is an issue, *… is not among the companies chosen on Home*.
    Blank (all companies) is unaffected. `chosenCompanyTest` in
    companies.js.
  - **Departure:** the filter is still not a right. Task emails list every
    company's tasks, since they are not a screen.
  - ui/singleCompany checks every screen that asks getActiveCompanies with
    the second company chosen: the first is never offered or selected.
- **16, 5, 7, Client Management:** the label, the search (id, name, group,
  project, status) and the Data reset column with its own toggle
  (`saveDeveloperDataReset`, which switches the DATARESET module off or
  back on for the client).
