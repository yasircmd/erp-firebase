# Roadmap

New development after the migration. Keep this file current: update a
module's status after every finished step, then commit and push, so a
fresh session can continue from GitHub.

**Status values:** `not started` → `design` (doc being written) →
`design agreed` (owner has decided the open questions) → `building` →
`tested` (emulator suite, negative control, smoke) → `deployed` (logged in
[DEPLOY_LOG.md](DEPLOY_LOG.md)).

## Waiting to go live (the owner's deploys and setup)

Waiting to deploy: **`employee-portal`** (Employee Portal step 1,
[EMPLOYEE_PORTAL.md](modules/EMPLOYEE_PORTAL.md#as-built--step-1-2026-10-10)):
`tools/deploy-sets/employee-portal.txt` with `--screens` (EMPLOYEES, LEAVE),
then the **hosting** task (public/index.html and the new public/ess.html).
Then in the app: Roles & Permissions → Employees → tick **portal** for the
HR roles; line managers set on the employees (and ERP users linked for My
Portal); Employees → Portal access → switch on and print the welcome slips.

Then **`employee-portal-2`** (step 2, [As built](modules/EMPLOYEE_PORTAL.md#as-built--step-2-2026-10-10)):
`tools/deploy-sets/employee-portal-2.txt` with `--screens` (EMPREQUESTS,
PAYROLLSETUP), then the **hosting** task again. In the app: link a menu node
to "Employee Requests", set its rights (access, handle, setup), name the
handlers (Employee Requests → Handlers), set the loan types' request limits
(Payroll Setup → Loans).

Then **`employee-portal-3`** (step 3, [As built](modules/EMPLOYEE_PORTAL.md#as-built--step-3-2026-10-10)):
`tools/deploy-sets/employee-portal-3.txt` with `--screens` (EMPREQUESTS,
PAYROLLSETUP), then the **hosting** task again. In the app: the
reimbursement categories (Payroll Setup → Reimbursements), Approval
Configuration → "Reimbursement claim", Employee Requests access for the claim
approvers, and a handler for the category "Reimbursement" if wanted. All
three steps can go in one session: the three sets in order, then one Hosting
deploy.

Went live 2026-10-05 – 2026-10-10 (runs #95–#116, [DEPLOY_LOG.md](DEPLOY_LOG.md)):
`master-import-3b`, `payroll-5c`, `payroll-6`, `gl-references`,
`retail-sales`, `payroll-7a`, `payroll-7b`, `payroll-7c`,
`item-barcodes`, `item-barcodes-2`, `item-barcodes-3`, `retail-returns`,
`numbering`, `gl-views`. Still to do in the app, if not done yet:
- Interim Payroll (5c): link a menu node, set its rights (draft, pay),
  and if wanted Approval Configuration → "Interim payroll";
- Payroll step 6: each company's "Leave deductions in the GL" (Payroll
  Setup → Payroll Accounting);
- Payroll step 7a: if wanted, each company's cut-off day (Payroll Setup
  → Payroll Accounting); employees linked to their ERP user and line
  manager for the leave tasks;
- Earnings & Deductions (7b): link a menu node and set its rights; a
  draft run calculated before 7b shows "changed": recalculate it;
- Provisions (7c): link a menu node and give it access (inside,
  Payroll's rights apply);
- Retail Sales (runs #99–#109): link a menu node to "Retail Sales",
  set its rights (access, post, write, report) and each company's Retail
  Sales → Setup (the defaults, which create the Retail Customer, and the
  payment methods with their ledgers). The company needs its Discount
  Given and Output Tax accounts (Company Master), the items their Sales
  COGS accounts;
- item barcodes: add the products' barcodes in Item Master or Master
  Data Import → Item Barcodes. Next (later): barcode labels for items
  without one (ITEM_BARCODES.md, decision 67).

`master-import-3a` went live on 2026-10-05 (run #94).

Payroll steps 4–5b went live on 2026-10-05 (runs #89–#93,
[DEPLOY_LOG.md](DEPLOY_LOG.md)), after the Leave Register and steps 0–3
on 2026-10-04. Still to do in the app before the first payroll:

- link menu nodes to Leave Register, Leave Reports, Payroll, Payroll
  Setup, Loans & Advances and Final Settlements (any not linked yet);
- set the rights in Roles & Permissions: Payroll Setup (access,
  write), Payroll (draft, post, pay), Loans & Advances (draft, pay),
  Final Settlements (draft, post, pay);
- in Payroll Setup → Payroll, each company's daily rate, Salaries
  Payable and Recoverable from employees, and each element's GL
  account, including the three system deductions;
- in Payroll Setup → Payment Files, each company's bank file (from the
  UAE WPS SIF); on employees, the WPS person ID and bank routing code;
- in Payroll Setup → Loans, the loan types and their receivable;
- the provision GL accounts; in Payroll Setup → Provisions, each
  company's gratuity and leave salary, and the accruals; then import
  the opening provisions (Master Data Import → Opening provisions);
- pay elements for notice pay (an earning, and a deduction for short
  notice) with their GL accounts;
- the approvals wanted (Leave, Absence, Payroll run, Loan / advance,
  Final settlement).

## Modules in development

| # | Module | Design doc | Status | Notes |
|---|---|---|---|---|
| 0 | Party Payments & Bill-wise Allocation (JV, CBT) | [PARTY_PAYMENTS.md](modules/PARTY_PAYMENTS.md) | deployed | Live 2026-09-25 ([DEPLOY_LOG.md](DEPLOY_LOG.md)). |
| 1 | Purchase Return / Debit Note | [PURCHASE_RETURN.md](modules/PURCHASE_RETURN.md) | deployed | Live 2026-09-25 ([DEPLOY_LOG.md](DEPLOY_LOG.md)). To do in the app: link it in Tree Management, set the Purchase Return Variance Account where needed. Cost-center fix for the variance line live 2026-09-26 (PR #6). |
| 2 | Sales Return / Credit Note | [SALES_RETURN.md](modules/SALES_RETURN.md) | deployed | Live 2026-09-25. To do in the app: link it in Tree Management. Change 2026-09-26: Sales Returns Account per Sales Type (Sales Invoice Configuration), replacing the company field; live 2026-09-26 (PR #7). To do in the app: set it on every Sales Type. |
| 3 | Vendor SOA | [VENDOR_SOA.md](modules/VENDOR_SOA.md) | deployed | Live 2026-09-25. To do in the app: link it in Tree Management. Merged into `main` 2026-09-26 (PR #5). |
| 4 | Customer SOA | [CUSTOMER_SOA.md](modules/CUSTOMER_SOA.md) | deployed | Live 2026-09-25 with #3. To do in the app: link it in Tree Management. |
| 5 | PDC Received and PDC Issued | [PDC.md](modules/PDC.md) | deployed | Live 2026-09-26: functions, screens and Hosting ([DEPLOY_LOG.md](DEPLOY_LOG.md)), plus the follow-up fixes (approving from Home Tasks; no "if they bounce" lines in the SOA). To do in the app: set both PDC clearing accounts in Company Master, and link the "PDC Received" / "PDC Issued" tree nodes to `PDCRECEIVED` / `PDCISSUED`. Merged into `main` 2026-09-26 (PR #9). |
| 7 | Recurring Journal Entries | [RECURRING_JOURNAL.md](modules/RECURRING_JOURNAL.md) | deployed | Design agreed 2026-09-27 (owner: runs posted by hand with "Post Due Runs" and a Home task, no scheduler; "today" in Asia/Dubai; fixed and spread-a-total amounts; the other proposals as written). Built and tested 2026-09-27 on branch `worktree-recurring-journal-entries` (unit 13, emulator 5, UI 5, Home, smoke, negative control). Live 2026-09-27 ([DEPLOY_LOG.md](DEPLOY_LOG.md), two passes). To do in the app: link the existing tree node under FI to `RECURRINGJV` in Tree Management. Change 2026-09-27 (owner): "Spread by service period" (partial first/last month by days in that month: 12,000 for 16 Sep – 15 Sep → 500, 1,000 × 11, 500), live 2026-09-27 (release `20260927T101610Z-477bf33`). Merged into `main` 2026-09-27 (PR #14). |
| 6 | Fixed Assets (Asset Accounting, FI-AA) | [FIXED_ASSETS.md](modules/FIXED_ASSETS.md) | phase 1 + retirement deployed | Design agreed 2026-09-26 (owner: purchases through the existing Fixed Asset Clearing Account; separate configuration; period lock, department, location and employee reserved; additional depreciation). Phase 1 live 2026-09-26 ([DEPLOY_LOG.md](DEPLOY_LOG.md)): Fixed Asset Configuration, Asset Master, Asset Capitalization (incl. take-over), Depreciation Run, Additional Depreciation, Asset Register ([As built](modules/FIXED_ASSETS.md#as-built--phase-1-2026-09-26)). Menu entries renamed by the owner 2026-09-26: Fixed Asset Configuration, Fixed Asset Master, Fixed Asset Capitalization, Depreciation Run, Additional Depreciation, Fixed Asset Register; the labels in the system now match. To do in the app: set up the clearing account, account determination and classes. Phase 2: **Fixed Asset Retirement** (sale, scrap) live 2026-09-26 with the renamed labels ([As built](modules/FIXED_ASSETS.md#as-built--phase-2-retirement-2026-09-26), [DEPLOY_LOG.md](DEPLOY_LOG.md)); to do in the app: a *Fixed Asset Retirement* node (FARETIRE), Gain/Loss on Disposal in the account determinations. **Capital Work in Progress** (FAAUC, the design's Assets under Construction; owner 2026-09-28, [decisions and As built](modules/FIXED_ASSETS.md#as-built--capital-work-in-progress-2026-09-28)): **live 2026-09-28** (PR #25, Deploy run #11); in the app: link a *Capital Work in Progress* menu node (FAAUC) and set up an AuC class with an AuC account in account determination. Next: Asset Transfer, then Reconciliation and Dashboard. |
| 8 | Direct Retail Sales | [RETAIL_SALES.md](modules/RETAIL_SALES.md) | deployed | Requested and agreed 2026-10-09 (decisions 52–55: the Retail Customer pays in full, an existing customer may leave a balance on account; tax-inclusive prices; Promotion Code as a payment method; a whole sale reversed, partial returns later). Built and tested 2026-10-09: counter with split payments mapped to ledgers, one GL entry with the stock (prefix RS, TXN-), register and cash-up, printed invoice (its Discount column only when a line has a discount, owner 2026-10-09), reversal. Owner 2026-10-09: counter users see only the sales they billed, a role right "report" for everyone's (Admin, Finance Manager by default); Copy to Excel; a payment-wise report. Owner 2026-10-09: Clear asks first once anything is entered; the products' own barcodes scanned (ITEM_BARCODES.md). Live 2026-10-09 (runs #109, #110). Owner 2026-10-09 (decisions 76-79): partial returns found by the invoice number (a barcode on the receipt), refund the original way (promotion reversed, card or QR as cash), an open on-account balance reduced first, a "return" right and a return period; built and tested 2026-10-09; live 2026-10-09 (run #113). Next: managed promotion codes. |
| 9 | Numbering (document numbers and codes) | [NUMBERING.md](modules/NUMBERING.md) | deployed | Requested and agreed 2026-10-09 (decisions 80-83: documents, master codes and HR documents customizable, not the audit references; one format for all companies; a format built of prefix, company code, year and digits, the restart following from the year; codes always automatic, account codes unchanged). Built and tested 2026-10-09; defaults are today's numbers on today's counters. Live 2026-10-10 (runs #114, #115). In the app: link a menu node to "Numbering" and set its rights; customize formats as wanted. |
| 10 | GL views (Listing, cost centers, GL impact, payroll GL) | [GL_VIEWS.md](modules/GL_VIEWS.md) | deployed | Requested and agreed 2026-10-10 (decisions 84-87: pick several accounts, a header bringing in its children; one list by date with account and cost center, no balances; payroll GL impact from approval; GL Report's right). Built and tested 2026-10-10; live 2026-10-10 (run #116). |
| 11 | Employee Self-Service Portal | [EMPLOYEE_PORTAL.md](modules/EMPLOYEE_PORTAL.md) | steps 1–3 tested | Requested 2026-10-10; agreed (decisions 88-95: one default-password rule, the owner's: name's first 4 letters + the code's last 4 digits; ERP users through My Portal; leave to the line manager, then Approval Configuration; queries in a new Employee Requests screen; reimbursements paid with the next payroll, approved by the manager then Approval Configuration; HR switches access on). Step 1 built and tested 2026-10-10 ([As built](modules/EMPLOYEE_PORTAL.md#as-built--step-1-2026-10-10)): sign-in by code with the forced change, Home, leave (apply, track, withdraw / cancel, balances), the manager's Team requests, payslips (view, PDF), portal access in Employees with welcome slips, My Portal in the ERP. Deploy set `employee-portal` with `--screens`, then Hosting. Step 2 built and tested 2026-10-10 ([As built](modules/EMPLOYEE_PORTAL.md#as-built--step-2-2026-10-10)): payroll queries and advance / loan requests in the portal, the ERP's Employee Requests screen with handlers per company and category, internal notes, files, loan type limits, Home tasks (decisions 96–105). Deploy set `employee-portal-2`. Step 3 built and tested 2026-10-10 ([As built](modules/EMPLOYEE_PORTAL.md#as-built--step-3-2026-10-10)): reimbursement categories (each with its own pay element), expense claims with receipts, the manager then Approval Configuration "Reimbursement claim" with part approval and the monthly-limit flag, Earnings & Deductions entries for the payroll month, Paid once the run is posted; leave documents uploaded from the portal (decisions 93, 94, 106–109). Deploy set `employee-portal-3`. The portal's agreed scope is complete. |

**Order:** #0 first (the owner's priority, and the SOAs need it). Then the returns, which the SOAs report on, and
the SOAs last because they only read.

### #0 — tying payments to a party (decided)

An SOA lists a vendor's or customer's invoices, notes and payments.
Invoices carry `VendorID`/`CustomerID`, but payments and receipts are
posted through CBT, whose lines store only a GL account. No payment is
linked to a party, and nothing tracks what's paid or outstanding on an
invoice. Each vendor and customer does have its own
`TradePayablesAccountID`/`TradeReceivablesAccountID`. Options:

- **A. Tag CBT lines with a party:** an optional Vendor/Customer on CBT
  lines that hit payables or receivables. Small CBT change; works with
  shared or per-party accounts.
- **B. Per-party GL accounts:** the SOA reads the GL by the party's own
  account. No code change, but correct only if no two parties share an
  account.
- **C. New Vendor Payment / Customer Receipt modules** with allocation
  against invoices (outstanding tracking). Most complete; effectively two
  more modules.

Decision (owner, 2026-09-25): **A plus allocation.** JV and CBT lines are tagged with the vendor or customer, as a New Ref (for example an advance) or Against Ref (offsetting posted bills). Design: [PARTY_PAYMENTS.md](modules/PARTY_PAYMENTS.md).

## Follow-ups from new development

- [x] **GL references: STK- on finance journals** (owner, 2026-10-06;
  [GL_REFERENCES.md](modules/GL_REFERENCES.md), decisions 49–51).
  Fixed Assets, PDC, Recurring Journal, Opening balances (GL and open
  invoices) and Vendor / Customer Invoices took the stock audit
  sequence STK- because they post through the shared stock path. They
  now take TXN-, shared with Journal Vouchers and Cash & Bank; stock
  keeps STK-, payroll PRL-; entries already posted keep their
  reference. The GL report's link for opening balance journals went to
  Journal Vouchers ("not found"); it now opens Opening Balances on the
  batch. Built and tested 2026-10-09: `glReferences` suite (4) and UI
  check (2), negative controls caught. To go live: "functions set"
  `gl-references` with the screens.

- [x] **Roles & Permissions with many roles** (owner, 2026-10-03): with 12
  roles the permission grid wrapped (all role names in one header cell,
  all checkboxes in one cell per row), so columns 10–12 dropped onto a
  second line under the wrong roles. Now one column per role, scrolling
  sideways when wide; a checkbox's tooltip names its role. A change to a
  ported screen, made in tools/legacy-port/generate.js (SCREEN_EDITS,
  `ROLES`). Test: `rolesMatrix.ui.js` (12 roles); negative control (the
  checkboxes back in one cell) caught. Live 2026-10-03 (PR #70, Deploy
  run #78).

- [x] **Job Order acceptance through Approval Configuration** (owner,
  2026-09-28; [JOB_ORDER_ACCEPTANCE.md](modules/JOB_ORDER_ACCEPTANCE.md)).
  Pending Acceptance and Stop Requested lines now go to the Job Order
  Request approvers, levels in order.
  - They show in the approver's Home tasks, which open the line itself.
  - Only the current level's approver can act.
  - An amendment request becomes the submitter's task.

  Approval Configuration's Job Order entry did nothing before (also in
  Apps Script). **Live 2026-09-28** (PR #21; Deploy run #7, release
  `20260928T143614Z-9c1de3d`); the owner tested it.
- [x] **GRN: a posted or pending GRN showed its whole PO in the picker**
  (owner, 2026-09-28). The picker re-appeared after the screen hid it,
  listing every line of the PO. Fixed in `screens/GRN.html`:
  - Posted and Pending Approval GRNs show only the PO lines they took,
    ticked and locked.
  - Draft and Rejected GRNs show every line, as before.
  - Fully received lines still show until the PO is closed (owner).

  UI check in `stockModules.ui.js`; its negative control was caught.
  **Live 2026-09-28** (PR #22; Deploy run #8, release
  `20260928T153508Z-f75f256`).
- [x] **GRN: non-stock lines** (owner, 2026-09-28;
  [GRN_NON_STOCK.md](modules/GRN_NON_STOCK.md)). Dr the category
  account · Cr GRN Clearing, from PO category lines or entered directly.
  **Live 2026-09-28** (PR #23; Deploy run #9, release
  `20260928T170924Z-ce7496b`).
  - For Fixed Asset categories to reach Fixed Assets, the category must
    point at the Fixed Asset Clearing Account. That account must then be
    Asset-type, since Procurement Setup requires Asset for a Fixed Asset
    category.
- [x] **Invoicing state on the GRN and Delivery Note lists** (owner,
  2026-09-28). Each posted, unreversed GRN / Delivery Note shows one of:
  - **Invoiced**: the posted Vendor / Customer Invoice's number, which
    opens it;
  - **On draft invoice**: an unposted invoice (draft, awaiting approval
    or rejected) lists it;
  - **Pending invoice**.

  Drafts, reversed notes and reversal entries show nothing.
  - An "Invoice" filter finds each state and shows the count and value of
    the rows. Choosing it loads all entries, not just the latest 100.
  - Reversing the invoice makes the note Pending again. The state comes
    from `MatchedToInvoiceID`, which invoice posting and reversal already
    maintain.
  - **Code:** GRN in `grn.js`. Delivery Note is a documented patch
    (`delivery-note-invoice-state`), and its screen is now hand-maintained
    (`handScreens`).
  - **Tests:** `invoiceState` emulator suite 2/2; UI
    `invoiceState.ui.js` 2/2. Negative controls, each caught: GRN never
    Invoiced; DN draft invoices ignored; GRN filter not applied; the
    invoice link also opening the row.
  - **Live 2026-09-29** (PR #28; Deploy run #13, release
    `20260929T042254Z-ae7cbe1`); the owner tested it.
- [x] **My Drafts in Home Tasks** (owner, 2026-09-28;
  [DRAFT_TASKS.md](modules/DRAFT_TASKS.md)). Every draft (all transaction
  modules and Recurring Journal templates) is a Home task until it's
  submitted, posted or deleted, shown only to its last updater. Rejected
  documents stay in the Rejected block.
  - **Code:** `getMyDraftsForUser` in `homeTasks.js`; a My Drafts block in
    `public/index.html`. Purchase Order and Sales Order now open an entry
    from a task (both now hand-maintained); Job Order Request opens a
    draft batch. GRN now waits for its permissions before opening a
    task's entry: a draft could open without Save / Post.
  - **Found, not fixed:** most other task-opened screens have that same
    race (details in the module doc). Say if they should all be fixed.
  - **Hosting deploys** now have a Deploy workflow task, "hosting"
    (`tools/deploy-hosting.sh`, tested by `tools/test-deploy-hosting.sh`).
  - **Tests:** `draftTasks` emulator suite 3/3; UI `draftTasks.ui.js`
    7/7; `home.ui.js` gains a My Drafts check.
  - **Live 2026-09-29** (PR #29): functions (run #15), Hosting (run #16)
    and screens (runs #17 and #18). The owner tested it.
- [x] **Approval routing: CBT by voucher type, and follow-up teams**
  (owner, 2026-09-29; [APPROVAL_ROUTING.md](modules/APPROVAL_ROUTING.md)).
  **Live 2026-09-29** (PR #30; Deploy runs #20 and #21, release
  `20260929T080311Z-e114c8b`). The follow-up teams are set in Approval
  Configuration.
- [x] **CBT Fund Transfer** (owner, 2026-09-29;
  [APPROVAL_ROUTING.md](modules/APPROVAL_ROUTING.md), addendum). A fifth
  CBT type for moving money between the company's own cash and bank
  accounts: one From account, one To account, numbered `FT-…`.
  - It has its own approval entry, copied once from Bank Payment.
  - **Live 2026-09-29** (PR #31; Deploy run #22, release
    `20260929T092926Z-03f421e`).
- [x] **Report links restyled** (owner, 2026-09-29). The drill-through
  links in GL, TB, P&L, Balance Sheet, Cash Flow and Stock Ledger were
  dotted-underlined. They are now blue, underlined only on hover (GL
  drafts stay amber).
  - Balance Sheet, Cash Flow, P&L and Stock Ledger are now hand-maintained
    screens (`handScreens`), like GL and TB.
  - `trialBalance.ui.js` checks the TB and GL link styles; both negative
    controls (dotted again) were caught. Smoke passes for all six.
  - **Live 2026-09-29** (PR #33; Deploy run #23, release
    `20260929T102829Z-833c3b7`).
- [x] **Print for Credit and Debit Notes** (owner, 2026-09-29). Sales and
  Purchase Returns had no print. A posted return now prints as a Credit /
  Debit Note ("Tax …" when it carries tax), in the Sales Invoice's format.
  - Details are in [SALES_RETURN.md](modules/SALES_RETURN.md) and
    [PURCHASE_RETURN.md](modules/PURCHASE_RETURN.md) → Print.
  - Screens only, no server change.
  - `salesReturn.ui.js` and `purchaseReturn.ui.js` check the print. Three
    negative controls were caught: the note titled as an invoice, the form
    printed too, and no Print button.
  - **Live 2026-09-29** (PR #34; Deploy run #24, release
    `20260929T112255Z-11a985f`).
- [x] **Fixed Assets: additional depreciation in the latest posted month**
  (owner, 2026-09-29; [FIXED_ASSETS.md](modules/FIXED_ASSETS.md) →
  Additional depreciation).
  - It was refused for any month whose depreciation run was already
    posted. It may now be dated in the latest posted month (older months
    stay closed).
  - **Two safeguards:**
    - the amount cap counts that month's run, which is dated at month
      end;
    - the run can't be reversed while a later posting on its assets is
      live.
  - **Tests:** the `fixedAssets` suite has a new test for this (11 pass);
    the three negative controls were caught; `fixedAssets.ui.js` 9/9.
  - **Live 2026-09-29** (PR #35; Deploy run #25, release
    `20260929T115154Z-d96ab86`).
- [x] **TB and Balance Sheet: say nothing when balanced, red when not**
  (owner, 2026-09-29).
  - The green "Debit and Credit totals match" / "Balanced — …" notes are
    gone. A mismatch shows the note in red; in the TB the totals that
    differ turn red too.
  - The Cash Flow Statement keeps its reconciliation note.
  - `trialBalance.ui.js` checks both: nothing when matched, and the
    report's answer altered to force a mismatch. Three negative controls
    were caught.
  - **Live 2026-09-29** (PR #36; Deploy run #26, release
    `20260929T120558Z-9fac02d`).
- [x] **No browser popups: messages, confirmations and questions in the
  app** (owner, 2026-09-29; [APP_DIALOGS.md](modules/APP_DIALOGS.md)).
  **Live 2026-09-29** (PR #37; Deploy runs #29 hosting and #30 screens,
  release `20260929T144327Z-b3542c0`).
  - One themed dialog in the shell. Every `alert()` goes to it, and the
    110 `confirm()` / `prompt()` calls in 49 screens and the shell now
    await `appConfirm` / `appPrompt`. `generate.js` converts generated
    screens itself.
  - **In future:** a guard test, run by the Deploy workflow before any
    deploy, refuses a browser `confirm` / `prompt`. CLAUDE.md has the
    rule.
  - **Fixed on the way:** Cancel on Cancel PO's reason question no longer
    cancels the PO.
  - **Tests:**
    - `noBrowserDialogs` unit tests (4) and `appDialogs.ui.js` (3);
    - 16 UI checks now answer the in-app dialog;
    - five negative controls, each caught.
- [ ] **PAUSED (owner, 2026-09-29): "Loading…", not "No … found", while
  a module opens** ([MODULE_LOADING.md](modules/MODULE_LOADING.md): how
  to bring it back).
  - 34 of 60 screens showed their empty message ("No transactions
    found.") for a few seconds while their list was still loading. They
    drew the list before its data had arrived.
  - **One rule in the shell** now covers every screen, present and
    future:
    - while a module's first server calls are pending, an empty-state
      message reads "Loading…";
    - once they finish, a list that is really empty shows its message.
  - **Tests:**
    - `moduleLoading.ui.js` (4) and `shellLoading` unit tests (2);
    - a check across every screen: 0 of 60 now (34 before), nothing left
      showing "Loading…".
  - Not live. Its negative controls are still to do.
- [x] **Line grids: compact, room for the name, no empty line once
  posted** (owner, 2026-09-29; [LINE_GRIDS.md](modules/LINE_GRIDS.md)).
  **Live 2026-09-29** (PR #38; Deploy run #32, hosting).
  - One rule in the shell for every entry screen's line grid
    (`…-grid-body`): less padding in cells, fields and headers; the Item
    / Account Name column at least 13rem.
  - Once an entry is read-only, the empty row a grid keeps for typing is
    hidden.
  - **Every list and report too** (owner, same day): all tables in module
    screens have tighter rows and columns. On screen only; the Trial
    Balance / GL keep their own tighter grid.
  - **Tests:** `lineGrids.ui.js` (3). Six negative controls were caught:
    - the empty line never hidden;
    - hidden in drafts too;
    - no name width;
    - no compact tables;
    - the table rule winning inside grids;
    - Trial Balance not excluded.
- [x] **Copyright line on the login page and Home only** (owner,
  2026-09-29). **Live 2026-09-29** (PR #39; Deploy run #33, hosting).
  - "© Yasir AV. All rights reserved." was a bar at the bottom of every
    page; it now hides while a module is open.
  - Test: `home.ui.js` gains a check (Home, inside a module, back, signing
    out). Both negative controls were caught.
- [x] **JV list: room for JV Number, Txn Ref and Date** (owner,
  2026-09-29). **Live 2026-09-29** (PR #40; Deploy run #34, release
  `20260929T161919Z-859e66f`).
  - The three columns stay on one line; Description takes 2/5 of the
    width and wraps.
  - `lineGrids.ui.js` checks it (headers and rows). The negative control
    (Date allowed to wrap) was caught. The JV smoke check passes.
- [x] **Dates dd/mm/yyyy everywhere, periods Sep-2026** (owner,
  2026-09-29; [DATE_FORMAT.md](modules/DATE_FORMAT.md)). **Live
  2026-09-29** (PR #41; Deploy runs #37 hosting and #38 screens, release
  `20260929T164350Z-1b7c39e`). Four UI checks that expected the old
  format on screen were updated after it (PR #42).
  - **The owner's decisions:**
    - dd/mm/yyyy;
    - entry fields keep the browser picker;
    - Excel copies are dd/mm/yyyy;
    - periods show as Sep-2026.
  - One rule in the shell formats every date shown, printed, alerted or
    copied. Storage is unchanged.
  - The Approval Tracker's US-style times were fixed, through a
    generator screen edit.
  - **In future:** a guard in the Deploy workflow, and a CLAUDE.md rule.
  - **Tests:** `dateFormat` unit (5) and UI (2). Seven negative controls
    were caught.
- [x] **Approval delegation from the Approval Tracker** (owner, 2026-09-29;
  [APPROVAL_DELEGATION.md](modules/APPROVAL_DELEGATION.md)). **Live
  2026-09-29** (PR #43; Deploy runs #40 functions, #41 screens).
  - An Admin (any pending approval) or an approver (their own) hands an
    undecided level to another active user with access to the module
    and company, with a reason: one approval, or all of an absent
    approver's.
  - Recorded on the approval; Approval Configuration is unchanged.
  - **Tests:** the `approvalDelegation` suite (6); eight negative
    controls were caught:
    - an approver moving anyone's;
    - no module check;
    - no company check;
    - someone on another level;
    - no reason;
    - a decided level;
    - Job Order company not from the batch;
    - an approver moving another's all.
  - `approvalDelegation.ui.js` (2); its negative control (Delegate shown
    on others' levels) was caught. The Approval Tracker and Approval
    Configuration suites, the Tracker smoke check and the Approval
    Routing UI checks all pass.
  - **To go live:** Deploy → "functions set", set `approval-delegation`,
    with screens. Done: run #40 deployed the functions without the
    screens; run #41 ("screens only") released them.
- [x] **BOM: the parent item's current name after a rename** (owner,
  2026-09-29; bug). **Live 2026-09-29** (PR #42; Deploy run #39).
  - A BOM stored its parent's code and name as saved, and the list showed
    that copy.
  - `getBoms` now returns the parent's current code and name (patch
    `bom-current-parent-name`). The stored copy is kept, and used only if
    the item is gone. Components already showed the current item.
  - Not changed: Data Reset's record list still labels a BOM with its
    stored name.
  - **Test:** a new `bom` emulator test (6 pass); the negative control
    (fix removed) was caught.
  - **To go live:** Deploy → "functions set", set
    `bom-current-parent-name` (getBoms only; no screens).
- [ ] **Found while building it, not fixed:**
  - **Approvals elsewhere aren't sequential.** For every module except
    Job Order, all levels see the task at once and may decide in any
    order; the document is approved once all have. Say if they should go
    in order too.
  - **Cancelling a document leaves its approval open.** Purchase
    Requisition is one example, and likely others: cancel doesn't close
    its pending approval, so approvers keep a Home task for a cancelled
    document (Home only checks that the document exists). Job Order
    withdraw now closes it.
  - **Purchase Order's Home task still opens the list,** not the order
    (`OpenEntryId` gap).
- [ ] **Master Data Import from Excel** (owner, 2026-10-02;
  [MASTER_IMPORT.md](modules/MASTER_IMPORT.md)). **Part 1 live
  2026-10-02** (PR #47; Deploy run #46). **Part 2 live**
  (PR #48; functions in Deploy run #47, the screen in run #48).
  - **Part 3a live 2026-10-05** (PR #85; Deploy run #94): **update
    existing Employees** (owner's request: set 40 line managers at once;
    decisions 8-11 agreed). Rows "Update existing": the key is the
    Employee No.; only the pasted columns change; a blank keeps, `-`
    clears; job and organization columns are refused (Employee Change);
    managers checked across the paste; each change in the history; all or
    nothing. **Copy current records** gives the sheet to edit and paste
    back. Tests: `masterImportUpdate` suite (5), `masterImportUpdate.ui.js`
    (4). To go live: "functions set" `master-import-3a` with the screens.
  - **Part 3b built and tested 2026-10-05**, not yet live: Update existing
    for every master with a code (Company, Org Units, COA, Currencies, UOM,
    Items, Vendors, Customers, Fixed Asset Classes and Master, Users), each
    through its own save; locked columns as agreed (decisions 12-14).
    Masters without a code and the versioned ones (BOM, Valuation, Price
    Lists) have no update option. Tests: `masterImportUpdate2` suite (6).
    To go live: "functions set" `master-import-3b` (after `-3a`).
  - **Fix, 2026-10-02:** the item account rules now match Item Master's
    save. Consumption is any postable account; Write-off is Expense or
    COGS. Two negative controls caught. Live (PR #49; Deploy run #49).
  - **Part 2:** Customer Classifications, Sales Types, Requisition
    Categories, Fixed Asset Classes and Master, BOM (a row per
    component), Inventory Valuation, Price Lists (a row per line; an
    existing list gets lines added), Users (a temporary password typed on
    the screen).
  - **Code changes:** the Fixed Asset class and asset saves are shared
    functions now; patches `import-bom-id` and `import-user-id`.
  - **Tests:** the `masterImport2` suite (7), and `masterImport.ui.js`
    (5).
  - **Negative controls caught: ten.**
    - one BOM's columns not compared;
    - an active BOM overwritten;
    - always a new price list;
    - no temporary password check;
    - duplicate email;
    - no sign-in undo;
    - no asset-number counter;
    - no valuation eligibility;
    - duplicate serial;
    - bad dates accepted.
  - **To go live:** Deploy → "functions set", set `master-import-2`,
    with screens.
  - **How it works:** choose a master, copy its headers, fill in Excel,
    paste, check (issues by row and column), import all or nothing.
  - **The rules:**
    - each row goes through the master's own save, so the rules are the
      same as by hand;
    - codes the system makes are never in the sheet;
    - references by code or exact name, also to a row above;
    - the same name twice is an issue;
    - a failed import is undone, counters included.
  - **Part 1:** Company, Org Units, COA, UOM, Item Sub-Category, Items,
    Vendors, Customers, Currencies.
  - **Part 2 next:** Fixed Asset Classes and Master, BOM, Inventory
    Valuation, Price Lists, Users (one temporary password on screen),
    Requisition Categories, Classifications and Sales Types.
  - **Later, its own design:** opening balances (GL, stock, open
    invoices).
  - **Tests:** the `masterImport` suite (9) and `masterImport.ui.js` (4).
  - **Negative controls caught: eight.**
    - duplicate names allowed;
    - importing despite issues (first missed: the undo hid it, so a
      test was added where only the check objects);
    - no same-paste references;
    - no undo;
    - no write-right check;
    - no company check;
    - in the UI, Import enabled despite issues, and a stale check.
  - **To go live:** Deploy → "functions set", set `master-import-1`,
    with screens. Then link a menu node to Master Data Import.
- [x] **Purchase Requisition: who sees which** (owner, 2026-10-02;
  [PR_VISIBILITY.md](modules/PR_VISIBILITY.md)). **Live 2026-10-02** (PR
  #46; Deploy run #45).
  - **Who sees a requisition:**
    - the person who raised it;
    - its approvers, from when it waits on them and afterwards
      (delegated levels included);
    - the Procurement follow-up team for its scope, once it is no longer
      a draft (a draft stays with whoever drafted it);
    - Admins.
    - Everyone else sees none.
  - **Every requisition action** follows the same rule, so nothing can be
    opened or acted on by its id. Delete gains the company check it
    lacked.
  - **Not included:** Inventory Purchase Requisition (owner: Sales only).
  - **Tests:**
    - the `prVisibility` suite (3); `purchaseRequisition` updated (its
      Viewer now sees none);
    - purchaseOrder, draftTasks, approvalDelegation, approvalTracker and
      approvalRouting suites pass;
    - UI: requisitions, draft tasks, approval routing, delegation, and
      the smoke check of the four screens.
  - **Negative controls caught: seven.** No raiser rule, no approver
    rule, team ignoring scope, no Admin rule, no delegated-from approver,
    cancel unchecked, and drafts shown to the team.
  - **To go live:** Deploy → "functions set", set `pr-visibility`. No
    screens.
- [x] **HR: Payroll** (owner, 2026-10-04; [HR_PAYROLL.md](modules/HR_PAYROLL.md)).
  The owner's points: a daily-rate method per company (÷30, ÷ month days,
  ×12÷365/366); each element linked to GL with the employee's cost
  center, lines clubbed as inventory; overtime fixed or by hours
  (base ÷ days ÷ hours × weightage); work schedules (any weekend, six-day
  weeks) per employee. **Design agreed 2026-10-04:**
  - schedules effective-dated;
  - one daily-rate method per company (overtime may override);
  - GL mapping for the group with company overrides;
  - no profit center;
  - overtime entered or pasted per run;
  - a WPS SIF file and a bank list;
  - advances and loans now;
  - monthly gratuity and leave-salary provisions;
  - a negative net carried to the next month;
  - automatic back pay;
  - approval through Approval Configuration.

  Six build steps.
  - **Step 0 built and tested 2026-10-04**, live 2026-10-04: work schedules
    (HR Setup tab; the company's hours a day; an employee's schedule by
    date, set on the record or import, changed by a Transfer, fixed by
    Correct; leave counted by the schedule in force each day). Tests:
    `hrSchedules` suite (4), `hrSchedules.ui.js` (3). To go live:
    "functions set" `payroll-0` with the screens.
  - **Step 1 built and tested 2026-10-04**, live 2026-10-04: payroll setup
    (HR Setup → Payroll: each company's daily-rate method with a worked
    example, and its Salaries Payable; each element's GL account, the
    group's with company overrides, prorated and in gross; overtime
    elements by amount or by hours, base ÷ days ÷ hours × weightage, with
    a worked example). Tests: `payrollSetup` suite (5),
    `payrollSetup.ui.js` (4). To go live: "functions set" `payroll-1`
    with the screens, then fill the tab in the app.
  - **Step 2 built and tested 2026-10-04**, live 2026-10-04: the payroll run
    (new Payroll screen and module; one run per company and month after
    the leave is locked; part months by deducting the days not employed;
    leave on its own deduction lines, Unpaid leave, Absence and
    Reduced-pay leave, which are system elements with a GL account;
    earlier months' leave adjusted at their rate; overtime hours at the
    schedule's hours; inputs typed or pasted from Excel; the register,
    payslips and warnings; recalculate, delete). Decisions 12–15 agreed.
    Tests: `payrollCalc.test.js` (8), `payrollRun` suite (6),
    `payrollRun.ui.js` (4). To go live: "functions set" `payroll-2` with
    the screens; link the menu node; give the system deductions their
    GL account.
  - **Step 3 built and tested 2026-10-04**, live 2026-10-04: submit through
    Approval Configuration; the final approval posts at once (one journal
    a run, dated the month's end, clubbed by cost center, net to Salaries
    Payable); a negative net paid as 0, carried to Recoverable from
    employees and brought forward next month; automatic back pay
    ("arrears" lines) for posted months after a later pay change;
    printed payslips with leave balances and the year to date; reversal
    of the latest posted run back to draft; the leave of a submitted run
    stays locked. Decisions 16–19 agreed. Tests: `payrollCalc.test.js`
    (10), `payrollPost` suite (5), `payrollPost.ui.js` (4). To go live:
    "functions set" `payroll-3` with the screens; set Recoverable from
    employees; the approval if wanted; the "post" right.
  - **Step 4 built and tested 2026-10-04**, live 2026-10-05, with the owner's
    request: a new **Payroll Setup** module (Pay Elements and Payroll
    moved from HR Setup, plus **Payment Files**, each company's bank file
    built field by field, delimited or fixed width, from a UAE WPS SIF
    starter, with a preview); the employee's WPS person ID and bank
    routing code; paying a posted run: the file, the bank list, Mark paid
    in one journal (bank, and cash or cheque for those without an IBAN)
    on the payment date, reversing the payment. Decisions 20–23 agreed.
    Tests: `payrollFiles.test.js` (5), `payrollPayment` suite (4),
    `payrollPayment.ui.js` (3). To go live: "functions set" `payroll-4`
    with the screens; the menu node; the rights; each company's bank
    file.
  - **Step 4b built and tested 2026-10-04**, live 2026-10-05: advances and
    loans (loan types with their receivable in Payroll Setup; a new
    Loans & Advances module: draft, approval, payout from Payroll, the
    schedule with skipped months and instalment changes, early
    repayments; recovered by each run, oldest first, never past the net;
    balances on the payslip and the employee record). Decisions 24–27
    agreed. Also fixed: draft payroll runs now show in My Drafts. Tests:
    `payrollCalc.test.js` (11), `payrollLoans` suite (5),
    `payrollLoans.ui.js` (3). To go live: "functions set" `payroll-4b`
    with the screens (after `payroll-4`).
  - **Step 5a built and tested 2026-10-05**, live 2026-10-05: provisions
    (the owner's points 1-3; decisions 28-35 agreed). Payroll Setup →
    Provisions: per company, gratuity by slabs (the UAE rule to start:
    none under 1 year, 21 then 30 days a year, × 12 ÷ 365, capped at 2
    years; from day one or after the first year) and leave salary (basic
    or gross); accruals (air ticket, education…) fixed or a % of pay, by
    grade with employee exceptions. Each run provides the change in each
    employee's liability, posted with its journal; an accrual is used by
    a run input (paid with the salary) or a claim (PPR journal); Payroll →
    Provisions shows the balances. An employee's own annual leave (days a
    year, calendar or working days) on the leave card. Opening provisions
    through the Master Data Import. Tests: `payrollCalc.test.js` (13),
    `payrollProvisions` suite (5), `hrLeave` suite (8),
    `payrollProvisions.ui.js` (4). To go live: "functions set"
    `payroll-5a` with the screens (after `payroll-4b`).
  - **Step 5b built and tested 2026-10-05**, live 2026-10-05: the final
    settlement (decisions 36-39 agreed). A new Final Settlements module:
    for an employee on notice or who has left, worked out on the leaving
    date (gratuity, the leave balance paid or a negative one deducted,
    accruals paid at leaving or lapsed, notice pay on the gross, other
    lines, every loan); amounts changed by hand with a reason; submitted
    once the leaving month's run is posted; approved and posted (each
    provision used, the difference to expense; the net payable, or owed
    on Recoverable from employees); paid as a run is (bank file, Mark
    paid); reversed. Claims, loan payouts and repayments, and the run's
    reversal wait for it. Tests: `payrollSettlement` suite (4),
    `payrollSettlement.ui.js` (4). To go live: "functions set"
    `payroll-5b` with the screens (after `payroll-5a`).
  - **Step 5c built and tested 2026-10-06** (decisions 40-43 agreed):
    interim payroll. The final settlement now pays everything at once:
    the salary of the months no posted run paid (the leaving month
    always; an earlier month unless left to its run), worked out by the
    run's own calculation with that month's leave and inputs, and the
    accruals' share; the run leaves the employee out. Submitted from the
    leaving date, with the employee's leave decided; their leave is then
    frozen. A new Interim Payroll module: batches of posted settlements
    and approved loans and advances, approved through Approval
    Configuration, one bank file, Mark paid (each item its own journal,
    all or nothing), the payment reversed whole; an item in a batch is
    paid only there. Tests: `payrollInterim` suite (4),
    `payrollSettlement` suite (4, updated), `payrollInterim.ui.js` (3),
    `payrollSettlement.ui.js` (4, updated). To go live: "functions set"
    `payroll-5c` with the screens (after `payroll-5b`).
  - **Step 6 built and tested 2026-10-06** (the owner's points of
    2026-10-06; decisions 44-48 agreed):
    - a missing supporting document (e.g. a sick leave certificate) no
      longer blocks: the approver confirms accepting the leave without
      it, and it is highlighted until a file is attached;
    - Payroll Setup's "Payroll" tab is now "Payroll Accounting";
    - leave deductions can post pro rata on the earnings, per company;
    - payroll journals are referenced PRL- and open from the GL in their
      own module. Also fixed: Journal Vouchers could reverse them;
    - the payment plan: each employee or item is paid one way from one
      account, and the groups are paid and reversed on their own.

    Tests:
    - `payrollStep6` suite (3);
    - `payrollPayment` (4) and `payrollInterim` (4), rewritten for the
      plan;
    - `payrollStep6.ui.js` (3); `payrollPayment.ui.js` and
      `payrollInterim.ui.js` rewritten.

    To go live: "functions set" `payroll-6` with the screens.
  - **Payroll is complete** (steps 0-6).
- [x] **HR: Attendance and Leave Register** (owner, 2026-10-03;
  [HR_LEAVE.md](modules/HR_LEAVE.md)), before Payroll. HR records leave
  now (self-service later); leave types configurable; leave pay by type
  and grade (basic only, full, %, unpaid, with day bands for sick leave).
  **Design agreed 2026-10-03:** leave plus absences (no time
  attendance); approval through Approval Configuration; calendar year,
  monthly accrual; carry forward to a cap, the rest lapses; the excess
  over the balance split off as Unpaid; one set of rules for the group;
  return confirmed for marked types; day count per leave type;
  back-dated entries into a locked month carried as adjustments. Four
  build steps.
  - **Step 1 built and tested 2026-10-03**, live 2026-10-04: HR Setup →
    Leave Types (nine to start; settings; entitlement by grade level and
    service with a carry-forward cap; leave pay rules by grade level and
    day band, overlaps refused, gaps warned) and Working Calendar
    (weekend and holidays per company). Tests: `hrLeaveSetup` suite (4),
    `hrLeaveSetup.ui.js` (5); nine negative controls caught. To go live:
    "functions set" `hr-leave-1` with the screens.
  - **Step 2 built and tested 2026-10-04**, live 2026-10-04: the Leave
    Register (entry with days, pay split and balance as typed; the
    excess over the balance split off as unpaid; approval; cancel; the
    return, early or late), the Leave card on the employee (balances,
    adjustments), and the Leave Opening Balances import. Tests: `hrLeave`
    suite (7), `hrLeave.ui.js` (5); eleven negative controls caught. To
    go live: "functions set" `hr-leave-2` with the screens; link the menu
    node; set up its approvals; import the opening balances.
  - **Step 3 built and tested 2026-10-04**, live 2026-10-04 (decisions
    10-13): absences (their own approval entry, always unpaid); unpaid
    days stop accrual; Month close (lock in order after the month ends,
    the summary for payroll, accrual posted at the grade then, reopen the
    latest with a reason; back-dated leave paid in the next open month,
    reversals after a lock); the year close (carry to the cap, the rest
    lapses). Tests: `hrLeaveClose` suite (5), `hrLeaveClose.ui.js` (4);
    twelve negative controls caught. To go live: "functions set"
    `hr-leave-3` with the screens; tick "lock" and "reopen" in Roles &
    Permissions.
  - **Step 4 built and tested 2026-10-04**, live 2026-10-04: Leave Reports
    (balances on a date, the register for a period, absences, who is away
    in a month; Copy to Excel) and the Home blocks On Leave Today and Leave
    Returns to Record. Tests: `hrLeaveReports` suite (4),
    `hrLeaveReports.ui.js` (4), `leaveHomeBlocks.test.js` (3); ten
    negative controls caught. To go live: "functions set" `hr-leave-4`
    with the screens, then "hosting"; link the menu node.
  - **The Attendance and Leave Register is complete.** **Next:** Payroll
    design (docs/modules/HR_PAYROLL.md), the owner's questions first.
- [x] **HR: Employee Records** (owner, 2026-10-03;
  [HR_EMPLOYEES.md](modules/HR_EMPLOYEES.md)). **Design agreed
  2026-10-03:** group employee numbers, group grades with company pay
  bands, cost center as department, flexi fields, employee documents with
  a 60-day expiry reminder, Pay Elements built now (first piece of
  Payroll), effective-dated compensation, line manager with Replace
  manager, Employee Changes (promotion, increment, transfer) through
  Approval Configuration with full history, and an Employees import. Five
  build steps; Payroll designed afterwards.
  - **Owner, revised:** a separate Employees "sensitive" right for pay,
    bank details and documents.
  - **Step 1 built and tested 2026-10-03**, live 2026-10-03:
    - HR Setup (grades with company pay bands, designations, extra fields,
      document types);
    - Employees (record, extra fields, line manager, Replace manager,
      Correct, history);
    - an Employees sheet in Master Data Import.

    Tests: `hrEmployees` suite (6), `hrEmployees.ui.js` (5); five negative
    controls caught. To go live: Deploy "functions set" `hr-employees-1`
    with the screens; link the two menu nodes.
  - **Step 2 built and tested 2026-10-03**, live 2026-10-03: employee
    documents on the record (sensitive right), files in Drive, renew,
    remove, and the Home task "Employee Documents Expiring or Expired"
    (60 days). Tests: `hrDocuments` suite (3), `hrEmployees.ui.js` (6); four
    negative controls caught. To go live: "functions set"
    `hr-employees-2`, then "hosting", then the screens.
  - **Step 3 built and tested 2026-10-03**, live 2026-10-03: Pay Elements in
    HR Setup; Compensation on the employee record (monthly amounts, agreed
    bonus / commission terms, band warning, versions, Set and Correct).
    Tests: `hrPay` suite (4), `hrEmployees.ui.js` (7); four negative
    controls caught. To go live: "functions set" `hr-employees-3` with the
    screens.
  - **Step 4 built and tested 2026-10-03**, live 2026-10-03: Employee Changes
    (promotion, increment, transfer) with approvals through Approval
    Configuration (amount = monthly increase), applied from the effective
    date (future job changes on their date), history on the employee.
    Tests: `hrChanges` suite (5), `hrChanges.ui.js` (2); six negative
    controls caught. To go live: "functions set" `hr-employees-4` with the
    screens; link the menu node; set up its approvals.
  - **Step 5 built and tested 2026-10-03**, live 2026-10-03: the Org chart
    on the Employees list (who reports to whom, company filter, expand /
    collapse, opens the record and back). Screen only, built from the
    existing list. Tests: `hrEmployees.ui.js` (8); five negative controls
    caught. To go live: a "screens only" run.
  - **Live 2026-10-03:** step 1 in Deploy runs #67–#68, steps 2–5 in
    runs #73–#77 (docs/DEPLOY_LOG.md).
  - **Employee Records complete.** **Next:** Payroll design
    (docs/modules/HR_PAYROLL.md), the owner's questions first.
- [x] **Company Documents: legal documents, contracts, licences** (owner,
  2026-10-03; [COMPANY_DOCUMENTS.md](modules/COMPANY_DOCUMENTS.md)).
  **Design agreed 2026-10-03:** a register of documents per company
  (category, reference, party, dates, files in Drive), its own
  permission, a 30-day expiry Home task, vendor / customer documents
  in the same register and shown on their masters. **Live 2026-10-03**
  (PR #63; Deploy runs #64–#66); menu node linked and tested by the owner.
  - **What:** the Company Documents screen (records with their files,
    renew, remove, categories), Documents (n) on Company / Vendor /
    Customer Master, and the Home task "Company Documents Expiring or
    Expired".
  - **Tests:** `companyDocuments` suite (6), `companyDocs.ui.js` (8);
    four negative controls caught.
- [x] **Supporting documents on entries** (owner, 2026-10-03;
  [ATTACHMENTS.md](modules/ATTACHMENTS.md)). **Live 2026-10-03** (PR #60;
  Deploy runs #60–#62; menu node linked). **In use 2026-10-03:** the
  owner set up Google Cloud, connected Google Drive and tested; the
  "ERP Documents" folder was moved into a project folder (safe: the ERP
  works by folder id). **Fix
  2026-10-03** (owner: the section stayed dark in light mode): it used two
  slate classes the light theme doesn't recolour; now mapped ones, and
  `supportingDocsTheme.test.js` checks the section and Document Storage.
  Hosting only; live 2026-10-03 (PR #61; Deploy run #63).
  - **Decided:** Google Drive (for now the owner's own Drive, connected
    once by Admin; Workspace later); anyone who can open the entry;
    removal by the uploader before posting, Admin after (to a Removed
    folder, never deleted); all 27 entry modules.
  - **What:** a Supporting documents section below every entry (add
    several files or drop them, open, remove), a paperclip with the count
    in the lists, and an Admin screen, **Document Storage** (connect
    Google Drive, test, the folder link). Folders: company / year /
    voucher type / number.
  - **Tests:** `attachments` suite (5), `supportingDocs.ui.js` (9); four
    negative controls caught.
- [x] **Stock Ledger: Back from an entry keeps the report's filters** (owner,
  2026-10-03). **Live 2026-10-03** (PR #58; Deploy run #59).
  - **Bug:** opening an entry from a Stock Ledger row and coming Back reset
    the report (no company, item, location or dates): the screen saved no
    filters in its return chain (`params: null`). GL Report did; Stock
    Ledger was the only drill-through with the gap.
  - **Fix:** the filters of the last run go in the return chain; on Back they
    are put back once the lists load, and the report runs again.
  - **Tests:** `stockLedgerBack.ui.js` (1): run, open the GRN, Back: same
    filters, report shown. Negative control (`params: null`) caught. Smoke
    123/123.
- [x] **One GL line per identical posting; Stock Ledger rows the same** (owner,
  2026-10-02; [LINE_CLUBBING.md](modules/LINE_CLUBBING.md)). **Live
  2026-10-02** (PR #57; Deploy run #58).
  - **What:** system-posted entries club lines with the same account, side,
    cost center, profit center and description; anything different stays
    separate (owner's rule). The Stock Ledger report clubs a document's
    rows of an item the same way. Manual JV / CBT unchanged.
  - **Tests:** `lineClubbing` suite (3); three negative controls caught.
    Full regression: emulator 334, one expectation updated (opening stock
    lines now one GL line), smoke and UI green apart from the known
    environment-only home failures.
- [x] **Copy / Paste with column headings on every entry grid** (owner,
  2026-10-02; [LINE_GRIDS.md](modules/LINE_GRIDS.md)). **Live 2026-10-02**
  (PR #55; Deploy run #57).
  - **What:** Copy Table always puts the headings on top (an empty grid
    copies just the headings instead of "Nothing to copy yet."); Paste
    skips a headings row. JV, CBT, GRN, Material Issue, Warehouse
    Movement, Stock Adjustment, Physical Count, Production, BOM, Delivery
    Note (copy only).
  - **Tests:** `gridClipboard.ui.js` (11); two negative controls caught.
- [x] **Vendor and Customer SOA: compact view** (owner, 2026-10-02). **Live
  2026-10-02** (PR #54; Deploy run #56).
  - **What:** on screen only, the printout unchanged: tighter rows and
    sections, amounts in a smaller font, every column but the
    description on one line, smaller ageing tiles. Rows go from 2.5 to
    about 1.4 rem.
  - **How:** an `@media screen` block in VENDORSOA.html (CUSTOMERSOA.html
    is built from it by `tools/build-soa-screens.js`).
  - **Tests:** `partyStatement.ui.js` (5): amount font 0.72rem, tight
    padding, one line, row ≤ 24 px; in print media none of it applies.
    Negative control (the block removed) caught.
- [x] **COA: a new code when an account moves to another head** (owner,
  2026-10-02; [COA_RECODE.md](modules/COA_RECODE.md)). **Live
  2026-10-02** (PRs #52 and #53; Deploy runs #54 and #55).
  - **What:** an account moved to the right head gets the next code
    there, only if it has never been used (owner: "only if never used").
    Used: refused, with where it was used and the fix (new account, JV
    the balance, deactivate the old).
  - **Also:** choosing a company in the COA list shows its own and the
    shared accounts (owner); a one-company user's list no longer hides
    the shared ones.
  - **Tests:** `coaRecode` suite (5), `coaRecode.ui.js` (4); five negative
    controls caught.
- [x] **Compact lists and forms: Item, Vendor and Customer Master** (owner,
  2026-10-02; [COMPACT_FORMS.md](modules/COMPACT_FORMS.md)). Forms **live
  2026-10-02** (PR #50; Deploy runs #50–#52). The list fix (one line per
  row) is **live** too (PR #51; Deploy run #53).
  - **What:** the Add / Edit form, "reducing space like CBT": tighter
    fields, gaps and sections; long help notes on one line (full text on
    hover or click). Item form 31 % shorter, Vendor / Customer 25 %.
  - **How:** a generator transform, `tools/legacy-port/compactForms.js`
    (a style block scoped to each screen's form). Screens only.
  - **Lists too** (owner's follow-up): a list row is one line (code,
    company, actions no longer wrap; headers on one line); narrow screens
    scroll sideways.
  - **Tests:** `compactForms.ui.js` (13); three negative controls caught;
    smoke and single-company UI checks pass.
- [x] **Opening balances** (owner, 2026-10-02;
  [OPENING_BALANCES.md](modules/OPENING_BALANCES.md)). **Live
  2026-10-02** (PR #50; Deploy runs #50–#52). Design agreed 2026-10-02 (all seven decisions as proposed).
  - **What:** a new Admin screen. Per company: opening date and clearing
    account; then GL, Stock and Open Invoices pasted from Excel, checked
    and posted against the clearing account, which is zero once all
    three agree. Control accounts come only from Stock and Open
    Invoices. Opening documents behave as invoices (allocation, SOA,
    ageing). A batch reverses any time unless used; stock reverses at
    its own cost.
  - **Tests:** the `openingBalances` suite (8) and `openingBalances.ui.js`
    (4); four negative controls caught.
  - **In the app:** link a menu node to Opening Balances.
- [x] **Deploy warns when screens weren't released** (owner, 2026-10-02).
  - **Why:** runs #40 and #43 deployed functions with the screens box
    unticked, and the owner saw no change.
  - **What it does:** a "functions set" run now ends by comparing
    `screens/` on main with the live release
    (`tools/release-screens.sh compare`, new). If they differ, the run
    shows a **"Screens not released"** warning on its page and summary,
    listing the screens, with the fix: a "screens only" run.
  - Nothing is stopped or undone.
  - **Tests:** two new `screenRelease` tests (12 pass); two negative
    controls caught. The workflow step's shell was dry-run for all three
    outcomes (differs, matches, check failed).
  - **Goes live with the merge;** the workflow needs no deploy.
- [x] **PDC advance (New Ref), checked** (owner question, 2026-10-02).
  Already supported in both PDC Received and PDC Issued: whatever isn't
  allocated against invoices is kept as one New Ref, and so is the whole
  cheque when nothing is allocated. Nothing to change.
- [x] **Gmail-style list paging and server-side search** (owner,
  2026-10-02; [LIST_PAGING.md](modules/LIST_PAGING.md)). **Live
  2026-10-02** (PR #44; Deploy runs #42 hosting, #43 functions, #44
  screens).
  - **The owner's decisions:** "Load next 100" adds below; all nine
    document lists (JV, CBT, GRN, Material Issue, Warehouse Movement,
    Stock Adjustment, Production, Physical Count, Purchase Order); "Load
    all" removed.
  - **Search and filters run on the server** over every entry the user
    can see, 100 matches at a time. A report's drill-down fetches its one
    entry instead of the whole list.
  - **Fixed on the way:**
    - JV / CBT "Load all" stopped at 1,000 entries without saying so;
    - a search found nothing older than the loaded 100.
  - **One shared piece of code:** `functions/src/listPaging.js` (server)
    and the shell's LIST PAGING block (`createListPager`). Production and
    Physical Count are generated, so the generator converts them
    (`tools/legacy-port/listPaging.js`, patches `list-paging-*`).
  - **Tests:** the `listPaging` suite (11) and `listPaging.ui.js` (5).
    - Negative controls caught: nine. Six on the server (cursor
      off-by-one, search over the first 100 only, no id tie-break, GRN
      invoice state after the filter, PO search without the vendor, JV
      by id from any company). Three in the UI ("next" replacing
      instead of adding, a reload overtaking a drill-down, search
      local-only).
    - Not catchable by a test: the shortcut for a single-company user
      (it saves reads but returns the same page).
  - **To go live, in this order:**
    1. Deploy → "hosting" (the shell's pager);
    2. "functions set", set `list-paging`, with screens.
    Done: run #43 deployed the functions without the screens; run #44
    ("screens only") released them.
- [x] **Purchase Requisition and Inventory Purchase Requisition fixes**
  (owner, 2026-09-28). Live 2026-09-28 in screen release
  `20260928T122017Z-5adca41` ([DEPLOY_LOG.md](DEPLOY_LOG.md)); no function
  deploy was needed.
  1. A Rejected requisition's item lines were locked. The header, the
     buttons and the "fully editable below" banner already allowed
     editing, and so did the server; the line grid unlocked only for
     Draft (inherited from Code.gs). It now unlocks for Draft or Rejected,
     like GRN, Stock Adjustment and the invoices.
  2. A Home task (pending approval or rejection) opened the module's list,
     not the requisition. Both screens now take the task's `OpenEntryId`,
     as 26 other screens do. They open the entry only once its company and
     cost-center dropdowns have loaded, so those don't show blank, and they
     load more than the first 100 entries when needed.

  Both screens are now hand-maintained (`handScreens`). Tests:
  `functions/test/ui/requisitions.ui.js`, 6/6; negative controls (lines
  locked again; task ID ignored; no wait for dropdown data), each caught
  exactly its checks. PR/IPR emulator suites 8/8; smoke 4/4.
  **Same gap, not fixed yet:** Job Order Request and Purchase Order
  don't read `OpenEntryId` either, so their Home tasks also land on the
  list.
- [ ] **Monthly and yearly closing** (owner, 2026-09-27): closing moves
  the income and expense account balances into one P&L account, so they
  stop carrying forward in the Trial Balance's opening. Needs its own
  design doc.
- [x] **GL Report: compact view** (owner request 2026-09-27; branch
  `trial-balance-ob-cb`, PR #13; **live 2026-09-27**, release
  `20260927T072723Z-19e00b8`, [DEPLOY_LOG.md](DEPLOY_LOG.md)): the same
  tight rows and columns as the Trial Balance, smaller header and filter
  panel. Screen only, no function change; GLREPORT is now a
  hand-maintained screen (`tools/legacy-port/modules.json`). Check added
  to `functions/test/ui/trialBalance.ui.js` (now 6), negative control on
  the compact CSS. Release: `tools/release-screens.sh`. Three release
  attempts timed out on 2026-09-27 (nothing changed for users); the
  release tool now reads screens back in retried groups
  ([SCREENS_ON_HOSTING.md](modules/SCREENS_ON_HOSTING.md#change-2026-09-27-read-back-in-groups)).
- [x] **Trial Balance: opening, transactions, closing** (owner request
  2026-09-27; branch `trial-balance-ob-cb`, PR #13; **live 2026-09-27**,
  [DEPLOY_LOG.md](DEPLOY_LOG.md)). Income and expense accounts carry an
  opening balance until period closing exists (owner, 2026-09-27: see
  *Monthly and yearly closing* above).
  The screen now takes From and To dates (both required; defaults: the
  1st of this month to today) and shows per account Opening Dr/Cr
  (everything before From), Transactions Dr/Cr (gross, From..To
  inclusive) and Closing Dr/Cr, with totals and a balance check on all
  three; compact grid (tight rows and columns). Balances stay cumulative
  since inception, as before (no year-end close, so income and expense
  accounts carry an opening balance). Drill-through to GL Report passes
  the same From/To. New hand-written callable `getTrialBalancePeriod`
  (`functions/src/trialBalance.js`); the legacy `getTrialBalance` stays
  deployed but unused by the screen. TRIALBALANCE is now a hand-maintained
  screen (`tools/legacy-port/modules.json` handScreens). Tests: 4 new
  emulator tests in trialBalance suite, `functions/test/ui/trialBalance.ui.js`
  (5 checks), negative controls on the opening cutoff and the compact CSS.
  Deployed with `tools/deploy-functions.sh trial-balance-period --screens`.
- [ ] **Customer credit control** (from Customer SOA decision C1): a
  credit limit on Customer Master and a warning on new Sales Orders for
  overdue or over-limit customers. Needs its own design doc.
- [x] **Party Payments UI check timing** (2026-09-26): it now waits for
  elements and options instead of fixed times; 3/3 right after an
  emulator restart (was 0/3).
- [x] **Faster deploys** (2026-09-26): inside tmux, batches of 20 instead
  of 6; invoker bindings 8 at a time instead of one by one
  (`tools/deploy-lib.sh`). First deploy with batches of 20 is untried:
  if it times out or hits API quota, rerun with `BATCH=10`. **Tried
  2026-09-26 (Fixed Assets, both phases):** batches of 20 hit Cloud
  Functions API request errors every time, a few functions per batch;
  `BATCH=6` then went through first time. Use `BATCH=6` for large sets.
- [x] **Deploy from GitHub Actions** (2026-09-28, after hitting Cloud
  Shell's weekly limit): `.github/workflows/deploy.yml` runs the same
  deploy scripts from GitHub on a clean checkout of `main`. It's manual,
  asks you to type `DEPLOY`, runs one deploy at a time, and uses batches
  of 6. It can deploy a functions set (with or without screens), screens
  only, or the runtime. The deploy scripts now exit non-zero on failure,
  so a failed run shows red. **To do (owner):**
  - Create a service account with Firebase Admin, Cloud Functions Admin,
    Cloud Run Admin and Service Account User.
  - Save its JSON key as the repository secret `GCP_SA_KEY`.
  - Optionally, require a reviewer on the `production` environment.

  **Done:** the secret is set (Cloud Run Admin added 2026-09-28), PR #16 is
  merged, and the first run (a no-op redeploy of `trial-balance-period`)
  succeeded with `ALL DONE` ([DEPLOY_LOG.md](DEPLOY_LOG.md)). Follow-ups:
  - upgrade `firebase-functions` (the CLI warns it's outdated; breaking
    changes, so it needs its own tested change);
  - **Workflow actions off Node 20, runner pinned:** a PR moves them to
    `actions/checkout@v6`, `actions/setup-node@v6` (dependency cache
    off), `google-github-actions/auth@v3` and `setup-gcloud@v3`, all
    Node 24. It also pins `runs-on: ubuntu-24.04`, because `ubuntu-latest`
    becomes Ubuntu 26 from 2026-10-19. **Done and proven** (PR #24): run
    #10 ("screens only") passed on `ubuntu-24.04` with no Node 20 warning. Moving to Ubuntu 26 later is
    a deliberate change with its own test run.
  - **Cloud Run readiness timeouts:** in run #9 one batch failed after 15
    minutes ("Resource readiness deadline exceeded"). The script's retry
    deployed it. If it recurs, look at Cloud Run in the console for that
    window.
- [x] **Release screens without a function deploy**
  ([SCREENS_ON_HOSTING.md](modules/SCREENS_ON_HOSTING.md)): live
  2026-09-26 ([DEPLOY_LOG.md](DEPLOY_LOG.md)). Owner's decisions: access
  check kept (B), Firestore, last 10 releases. Screens are in `screens/`;
  `getModuleFragment` serves the active release (first release
  `20260926T051858Z-b0cd09d`). Screen-only changes now go live with
  `tools/release-screens.sh`, not a function deploy.
- [x] **Home screen improvements** (owner, 2026-09-26; `public/index.html`,
  Hosting; live 2026-09-26, PR #8):
  1. User name (8rem) and role (6rem) are cut with an ellipsis; the full
     text is the user button's tooltip.
  2. Light/Dark mode moved into the user menu. The user menu isn't shown
     inside a module, so neither is the switch.
  3. **Configure Favourites** in the user menu: expands the whole tree
     and shows every module's star, with a banner and a Done button. It
     ends on Done, opening a module, Refresh, or a page reload (it's
     only held in memory). Stars no longer appear on hover. Outside the
     mode they're hidden, so a favourite still isn't marked in the tree.
  4. **Module search** box in the Home header: filters as you type
     (module names, and a folder name shows everything under it), opens
     the matching folders, shows "No modules match". Enter opens the
     module when there's exactly one match; Esc clears and restores the
     tree's open/closed state.
  5. Light mode highlights the hovered tree row (`#e2e8f0`), as dark mode
     does. Also fixed: row dividers (`divide-slate-700/800`, 83 uses
     including module tables) kept their dark colour in light mode.
  6. Expand/Collapse is a single icon button (double chevrons down/up,
     with a tooltip).
  Test: `functions/test/ui/home.ui.js` (6 checks, runs the real
  `index.html` with the Firebase SDK stubbed; no emulators). Negative
  controls, each caught: the light hover rule removed; the mode not
  ending on opening a module; search matching only the start of a name.
- [x] **Approving from Home Tasks** (owner report, 2026-09-26): PDC,
  Purchase Return and Sales Return screens drew an entry opened from Tasks
  before the user's rights had loaded, so no Approve/Reject appeared. They
  now redraw it when the rights arrive ([PDC.md](modules/PDC.md) → Fix).
  Same change: the SOA's "if pending PDCs bounce" lines removed (owner).
- [x] **One-company users: company chosen for them** (owner, 2026-09-26;
  live 2026-09-26, PR #10, [DEPLOY_LOG.md](DEPLOY_LOG.md)).
  1. A user assigned exactly one active company finds it already selected
     in every company dropdown on every screen: entry forms (also after
     New), list filters and report selectors. Done once in the shell
     (`public/index.html`, SINGLE-COMPANY DEFAULT), not per screen, since
     most screens are generated. It fills a company select whenever it's
     blank, and fires a non-bubbling `change` so the screen loads what
     depends on the company (accounts, items, eligible documents).
     Company selects on the 7 screens whose own change handler marked
     the form dirty now do so only for a user's change (`e.isTrusted`),
     so Back from an untouched New doesn't ask about unsaved changes
     (PR, Inventory PR, Sales Order, Purchase/Sales Return, both PDC
     screens; the three generated ones also edited in `legacy-gas/`).
  2. Home title: "ERP Module Hierarchy Tree - <their company>" for such a
     user (others still see the `01` company).
  3. **Owner's decision (2026-09-26):** master-data forms whose blank
     option is a real choice ("Shared across all companies" on Customer,
     Vendor, Item, COA, Org Units, Procurement and Sales Invoice setup)
     keep shared as the default, not the user's company.
  Users with two or more companies see no change. Tests:
  `functions/test/ui/singleCompany.ui.js` (41 screens as a one-company
  user, 4 as a two-company user; 45/45), a title check in `home.ui.js`
  (7/7). Negative controls, each caught: the fill turned off; the
  `isTrusted` guard removed on Purchase Return; the fill's event made to
  bubble (JV and GRN then asked about unsaved changes); the title's old
  "01 only" rule. Every other UI check reran green (fixture users all
  have one company): smoke 105/105, dynamic toggle 2/2, stock 12/12,
  party payments 3/3, returns 4/4 each, statements 4/4, PDC 8/8.
  Deployed: Hosting plus screen release `20260926T115827Z-d933363`; no
  functions.
- [ ] **Design: module/approval/voucher-type lists out of the code.** These
  lists are built into every function, so adding a module redeployed 19
  unchanged functions in the returns-and-statements deploy. Kept in
  Firestore, a new module would deploy only its own functions. Needs a
  design doc; touches ported modules (MIGRATION.md).

## Follow-ups from the migration

- [ ] **Data checks on the data the Apps Script system wrote** before its
  retirement (2026-09-28), for the bugs that were live in it: deviations #5, #6, #8, #11, #12, #14–#16 and #18 in
  [MIGRATION.md](MIGRATION.md) → "Deviations from Code.gs". Don't use its
  "Recalculate Stock Ledger" (#18).
- [ ] **Back-fill Physical Counts** posted by the Apps Script system before
  deviation #7. While any exist, Data Reset's ledger rebuild refuses to
  run and names them.
- [ ] **Decisions on preserved quirks**, such as the missing company
  scoping in Approval Tracker and BOM, the company gaps in draft
  edit/delete, and the no-lock numbering and reservation races. All are
  listed in [MIGRATION.md](MIGRATION.md) → Status.
- [x] **Retire the Apps Script project** (done 2026-09-28; owner decision:
  no longer used):
  - `database.rules.json` is deny-all and live in production (Deploy run
    #2, [DEPLOY_LOG.md](DEPLOY_LOG.md)). It was `auth != null` only for
    Apps Script's RTDB access;
  - the owner confirmed the console steps: web app deployment archived,
    no triggers, `FIREBASE_API_KEY` and `Temp.js` deleted, the `Temp.js`
    passwords changed, the script's account access removed;
  - the owner confirmed the app works after the rules change.

  Still separate: the data checks and the Physical Count back-fill below,
  on the data it wrote before retirement. The `no-cache` Hosting header
  (README → Caching) stays while deploys are frequent.
