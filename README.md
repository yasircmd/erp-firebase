# ERP on Firebase

A multi-company ERP: finance (chart of accounts, JV, cash and bank, GL
reports, financial statements), inventory (GRN, material issue, stock
adjustment, warehouse movement, physical count, valuation), production
(BOM, job orders, production), purchasing (requisitions, purchase orders,
vendor invoices), sales (price lists, sales orders, delivery notes,
customer invoices) and fixed assets (asset sub-ledger, depreciation,
retirement and Capital Work in Progress), with role-based access and
configurable approvals.

It runs on Firebase project `erp1-8f4cd`: Cloud Functions (2nd gen,
callable, Node 24), Hosting, Realtime Database and Firestore. It was
migrated from Google Apps Script, and that migration finished on
2026-09-25 with 46 screens; new development since then brings the live
screen release to 61 (see [docs/DEPLOY_LOG.md](docs/DEPLOY_LOG.md)).

## Documents

| File | What it's for |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | **Start here for new work.** Modules in development, their status, and open follow-ups |
| [docs/modules/](docs/modules/) | One design doc per new module, agreed before coding starts |
| [docs/DEPLOY_LOG.md](docs/DEPLOY_LOG.md) | Every production deploy |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Frozen record of the Apps Script migration: deviations from Code.gs, preserved quirks, generator internals |
| [CLAUDE.md](CLAUDE.md) | Standing rules for working in this repo |

## Key design decisions

| Decision | Answer | Why |
|---|---|---|
| Business logic location | Cloud Functions (2nd gen, callable) | GL balance checks, WAC recalculation and the two-phase commit pattern must stay server-trusted |
| Region | `us-central1` | Matches the existing RTDB instance |
| Lock/atomicity | Firestore-transaction global lock (`lock.js`), plus RTDB multi-path `update()` for each commit's own writes | Serializing concurrent commits and making one commit's writes atomic are two separate jobs. The lock is deliberately whole-system, like the original `LockService`. |
| Auth | Firebase Auth client SDK | Callables get `request.auth` verified by the platform |
| Security Rules | Deny-all on Firestore and RTDB | Every read/write goes through a Cloud Function (Admin SDK), so no client can skip the business logic |
| Storage | Most documents in RTDB. Journal entries in Firestore (`journalEntries`). | As inherited from the Apps Script system |

## Structure

```
firebase.json / .firebaserc     — project config (hosting, functions, emulators)
firestore.rules, database.rules.json — deny-all
public/index.html               — the app shell: login, session, menu tree, home tasks, rpc bridge, in-app dialogs
functions/
  index.js                      — exports every callable
  src/                          — hand-written server code
    lock.js, approvals.js, commitAttempt.js, glWriting.js,
    stockMovement.js, reservations.js
                                — SHARED LOGIC: check here before writing anything new
    auth.js, session.js, tree.js, roles.js, companies.js, favorites.js, homeTasks.js
                                — shell, permissions, menu tree
    moduleRegistry.js           — every module's capabilities + default role permissions
    treeSeedNodes.js            — the menu tree
    approvalRegistry.js         — which modules can be approval-gated, and where their documents live
    getModuleFragment.js        — serves a screen from the active screen release, after the access check
    stockAdjustment.js, materialIssue.js, grn.js, warehouseMovement.js, masterData.js
                                — hand-written modules (the pattern for new modules); grn.js also
                                  takes non-stock lines (docs/modules/GRN_NON_STOCK.md)
    journal.js                  — JV and CBT (moved out of the generated code)
    partyLedger.js              — vendor/customer tags and bill-wise allocation on JV/CBT lines
    invoiceAllocations.js       — Vendor/Customer Invoice list and reversal wrappers for allocation
    purchaseReturn.js           — Purchase Return / Debit Note (docs/modules/PURCHASE_RETURN.md)
    salesReturn.js              — Sales Return / Credit Note (docs/modules/SALES_RETURN.md)
    partyStatement.js           — Vendor and Customer Statements of Account (docs/modules/VENDOR_SOA.md)
    pdc.js                      — PDC Received and PDC Issued, post-dated cheques (docs/modules/PDC.md)
    faDepreciation.js           — Fixed Assets depreciation engine, pure functions (docs/modules/FIXED_ASSETS.md)
    fixedAssets*.js             — Fixed Assets: Config, Master, Postings (capitalization, take-over,
                                  additional depreciation, Capital Work in Progress cost and settlement),
                                  Retirement (sale, scrap), Depreciation (run, registers), Common
    recurringSchedule.js        — Recurring Journal Entries: run dates and spread amounts, pure functions
    recurringJournal.js         — Recurring Journal Entries: templates, Post Due Runs, reversal (docs/modules/RECURRING_JOURNAL.md)
    callable.js                 — onCallWithMessages: shows the real error message to the user
    legacy/                     — GENERATED from Code.gs, never hand-edit (see docs/MIGRATION.md)
  test/unit/*.test.js           — pure-function tests, no emulators (the depreciation, recurring-schedule and payroll engines)
  test/emulator/*.test.js       — one API suite per module, against the local emulators
  test/ui/                      — headless-browser checks (smoke, dynamic toggle, stock screens, party payments, returns, statements)
tools/
  legacy-port/                  — the Code.gs → Cloud Functions generator (migration only)
  deploy-migration.sh           — deploys pending generated-port functions
  deploy-functions.sh           — deploys a named set (tools/deploy-sets/<set>.txt) for new development
  deploy-runtime.sh             — moves every live function onto engines.node's runtime
  (.github/workflows/deploy.yml — runs the deploy scripts from GitHub Actions, manual only)
  build-soa-screens.js          — writes CUSTOMERSOA.html from VENDORSOA.html (edit only the vendor one)
  build-pdc-screens.js          — writes PDCISSUED.html from PDCRECEIVED.html (edit only the received one)
  release-screens.sh            — releases screens/ to production (list, rollback, compare)
  screen-release.js             — the release logic (verify, activate, keep the last 10)
screens/*.html                  — the module screens, released to Firestore (screens/README.md)
legacy-gas/                     — read-only snapshot of the old Apps Script project
docs/                           — see Documents above
```

## Building a new module

1. **Design first.** Write or complete `docs/modules/<MODULE>.md` (purpose,
   linked documents, GL and stock effects, approvals, permissions, open
   questions) and get the owner's decisions on its open questions before
   writing code.
2. **Server:** `functions/src/<module>.js`, exported from `functions/index.js`.
   Reuse the shared modules: `withGlobalLock` for anything that posts,
   `beginApprovalInstance` for approvals, the commit-attempt markers
   around a GL + ledger write, `writeStockGlEntry`/voucher numbering, and
   `computeStockMovement`/`commitStockLedgerUpdates`. Follow `grn.js` as
   the model. Never add code to `functions/src/legacy/`, because it's
   regenerated from Code.gs.
3. **Register it:** capabilities and default permissions in
   `moduleRegistry.js`, a menu entry in `treeSeedNodes.js`, and, if it can
   be approval-gated, `approvalRegistry.js`. A stock/GL module also goes in
   the voucher-type maps in `journal.js` and `masterData.js` (and, by
   generator patch, the Stock Ledger Report's). After deploy, link it into
   the live menu with Tree Management; the seed only fills an empty tree.
4. **Screen:** `screens/<ID>.html`, calling the server with
   `rpc.<fn>({...})`.
5. **Tests:** an emulator suite in `functions/test/emulator/`, including a
   verified negative control (break the logic on purpose, confirm a test
   fails, restore it), plus the module in `functions/test/ui/smoke.ui.js`.
6. **Record it:** update the module's status in `docs/ROADMAP.md`, commit
   and push after every finished step.

## Testing

```bash
# once per machine
npm ci --prefix functions
npm i --no-save --prefix functions playwright && (cd functions && npx playwright install chromium)

# emulators (the Auth emulator is REQUIRED; without it User Management's
# create-user test would reach production Auth)
firebase emulators:start --only auth,database,firestore,functions --project erp1-8f4cd

node --test functions/test/unit/*.test.js   # no emulators needed; includes the no-browser-popups, date-format and supporting-documents light-mode guards
node --test --test-concurrency=1 functions/test/emulator/*.test.js
# while developing, run just the module's suite (seconds, not the full run):
#   node --test functions/test/emulator/salesReturn.emulator.test.js
node functions/test/ui/smoke.ui.js          # every screen loads cleanly (Admin + Viewer)
node functions/test/ui/dynamicToggle.ui.js  # a real deactivate/reactivate click
node functions/test/ui/partyPayments.ui.js  # right after the partyPayments suite, every time: JV/CBT allocation screens
node functions/test/ui/purchaseReturn.ui.js # after the purchaseReturn suite: the Purchase Return screen
node functions/test/ui/salesReturn.ui.js    # after the salesReturn suite: the Sales Return screen
node functions/test/ui/partyStatement.ui.js # after the partyStatement suite: the two SOA screens, compact on screen, print unchanged
node functions/test/ui/pdc.ui.js            # after the pdc suite: the two PDC screens, SOA pending PDCs
node functions/test/ui/home.ui.js           # the Home shell (public/index.html); no emulators needed, but it needs
                                            # cdn.tailwindcss.com: where that's blocked, 8 of its 10 checks fail
node functions/test/ui/singleCompany.ui.js  # one-company user: company preselected on every screen (after vendorMaster)
node functions/test/ui/fixedAssets.ui.js    # the Fixed Asset screens, incl. Retirement and Capital Work in Progress; seeds its own data
node functions/test/ui/stockModules.ui.js   # after the stockModules suite: the four stock screens, GRN PO picker and non-stock lines
node functions/test/ui/requisitions.ui.js   # PR / IPR: rejected lines editable, Home task opens the entry; seeds its own data
node functions/test/ui/jobOrderAcceptance.ui.js # Job Order acceptance through approvals; seeds its own data
node functions/test/ui/invoiceState.ui.js   # GRN / Delivery Note lists: invoicing column, filter, invoice link; seeds its own data
node functions/test/ui/draftTasks.ui.js     # My Drafts: each draft task opens its entry (PO, SO, Job Order batch, GRN, JV); seeds its own data
node functions/test/ui/approvalRouting.ui.js # Approval Configuration: CBT entries, follow-up teams; tasks open their document; seeds its own data
node functions/test/ui/cbtFundTransfer.ui.js   # CBT Fund Transfer: From / To cash or bank, one line, saved From Cr / To Dr; seeds its own data
node functions/test/ui/appDialogs.ui.js     # in-app dialogs: a screen's confirm and question, the dialog itself; seeds its own data
node functions/test/ui/lineGrids.ui.js      # compact line grids and tables, no empty line once posted, JV list columns; seeds its own data
node functions/test/ui/dateFormat.ui.js     # dates dd/mm/yyyy in lists, messages, Excel copies; entry fields keep yyyy-mm-dd; seeds its own data
node functions/test/ui/approvalDelegation.ui.js # Approval Tracker: delegate one level, or all of an approver's; seeds its own data
node functions/test/ui/coaRecode.ui.js        # COA: company filter includes shared accounts; moving an unused account gives a new code, a used one is refused; seeds its own data
node functions/test/ui/stockLedgerBack.ui.js  # Stock Ledger: Back from an opened entry keeps the filters and reruns; seeds its own data
node functions/test/ui/gridClipboard.ui.js    # every entry grid: Copy gives the headings (also when empty), Paste skips them; seeds its own data
node functions/test/ui/compactForms.ui.js     # Item / Vendor / Customer Master: one-line list rows, compact Add form, one-line help notes; seeds its own data
node functions/test/ui/listPaging.ui.js       # JV / Production / PO lists: "Load next", server search, drill-down; seeds its own data
node functions/test/ui/openingBalances.ui.js  # Opening Balances: setup, paste with issues, post, clearing, reverse; seeds its own data
node functions/test/ui/supportingDocs.ui.js   # Supporting documents: add / open / remove on an entry, paperclip, all 27 screens, Document Storage; seeds its own data
node functions/test/ui/companyDocs.ui.js      # Company Documents: add with files, vendor's document, renew, remove, categories, view-only, Documents (n) from the masters; seeds its own data
node functions/test/ui/hrEmployees.ui.js      # HR Setup (grade + pay band, designation, extra field) and Employees (new, Correct, manager, Replace manager, org chart, documents, pay, view-only); seeds its own data
node functions/test/ui/rolesMatrix.ui.js       # Roles & Permissions with 12 roles: one column per role, checkboxes under their role, save; seeds its own data
node functions/test/ui/hrChanges.ui.js        # Employee Changes: from the record, a promotion with a % raise, submit, approve; seeds its own data
node functions/test/ui/hrLeaveSetup.ui.js     # HR Setup: Leave Types (pay by grade, gaps shown, a new type) and Working Calendar (holiday, copy last year, weekend); seeds its own data
node functions/test/ui/hrLeave.ui.js          # Leave Register: from the employee card, days/pay/balance as typed, approve, early return, over-balance split, certificate, filters, adjustment; seeds its own data
node functions/test/ui/hrLeaveClose.ui.js     # Leave Register: an absence, Month close (lock, summary, reopen), the year close (carry, lapse); seeds its own data
node functions/test/ui/hrLeaveReports.ui.js   # Leave Reports: balances (copy to Excel), register, absences, who is away; seeds its own data
node functions/test/ui/hrSchedules.ui.js      # Work schedules: HR Setup tab, company hours, an employee on a schedule, a Transfer from a date; seeds its own data
node functions/test/ui/payrollSetup.ui.js     # Payroll setup: a company's daily rate and payable, an element's GL with a company's own, an overtime example, read-only; seeds its own data
node functions/test/ui/payrollRun.ui.js       # Payroll run: a new run, the register and a payslip, inputs typed and pasted, read-only, delete; seeds its own data
node functions/test/ui/payrollPost.ui.js      # Payroll approval, posting, printed payslips, reversal; Payroll Setup's Recoverable from employees; seeds its own data
node functions/test/ui/payrollPayment.ui.js   # Payroll Setup → Payment Files (a WPS SIF format, previewed), the employee's WPS fields, paying a run by its plan (each employee one way from one account; each group paid and reversed on its own); seeds its own data
node functions/test/ui/payrollLoans.ui.js     # Loans & Advances: a loan type, a loan submitted, paid out, its schedule and a repayment, recovered by the run, its balance on the employee; seeds its own data
node functions/test/ui/payrollProvisions.ui.js # Provisions: an employee's own annual leave, Payroll Setup → Provisions (gratuity, leave salary, an accrual by grade with an exception), a payslip's provisions, Payroll's Provisions button opening the module, a claim recorded and reversed; seeds its own data
node functions/test/ui/payrollSettlement.ui.js # Final Settlements: a leaver's settlement worked out (the leaving month's salary until its run is posted), notice pay and a deduction, an amount changed with a reason, submitted and posted, the bank file, paid; seeds its own data
node functions/test/ui/payrollStep6.ui.js # Payroll step 6: the Payroll Accounting tab and its leave-deductions choice; a sick leave approved without its certificate on confirmation, then flagged; a payroll journal opened from the GL in its module; seeds its own data
node functions/test/ui/payrollStep7.ui.js # Payroll step 7a: runs searched, the employee fixed while elements scroll, the Costing with provisions and Excel, the cut-off day; seeds its own data
node functions/test/ui/earningsDeductions.ui.js # Payroll step 7b: Earnings & Deductions entered before the run, its documents, paste; the run read-only with a link and a changed note; locked once posted; Interim entries offered; seeds its own data
node functions/test/ui/provisions.ui.js # Payroll step 7c: the Provisions statement by provision with subtotals and the GL check, filters, Copy to Excel, a row's movements and their documents; openings entered, corrected, removed; read-only without the rights; a claim's journal opened from the GL; seeds its own data
node functions/test/ui/glReferences.ui.js  # GL references: an opening balance journal opened from the GL lands in Opening Balances, its batch highlighted; seeds its own data
node functions/test/ui/retailSales.ui.js    # Retail Sales: setup, the counter (split payment, change, on account), the invoice with or without the customer block and Discount column, reversal, Viewer read-only, counter staff see only their sales, payment-wise report and Copy to Excel, Clear asking first, scanning the products' own barcodes (a carton's units); seeds its own data
node functions/test/ui/payrollInterim.ui.js # Interim Payroll: a settlement paying the months no run paid (one left to its run and back, an input), then a batch with an advance: saved, approved, the bank file, marked paid, the payment reversed, deleted; seeds its own data
node functions/test/ui/labelPrinting.ui.js # Item barcodes step 3: Item Master's Barcodes & Labels (settings, numbers previewed then saved, labels for chosen items), labels from a posted Production (batch, A4) and GRN (item code when no barcode), a Viewer prints but can't change; seeds its own data
node functions/test/ui/retailReturns.ui.js # Retail Sales partial returns: the receipt's number barcode, the Returns tab (found by number, refund the original way, card as cash, reason, the return receipt), a sale with returns, a return reversed, the return period, no Returns tab without the right; seeds its own data
node functions/test/ui/numbering.ui.js     # Numbering: the types and samples, the builder (BP-01-26-00001), a clash refused, the company code only where allowed, reset asked first, Viewer read-only; seeds its own data
node functions/test/ui/glViews.ui.js       # GL views: GL Report's Cost Center column and Copy Table, the Txn Ref's GL impact (cost centers, Copy to Excel, open the source), the Listing view (several accounts, no balances, totals, copy); seeds its own data
node functions/test/ui/essPortal.ui.js     # Employee Portal on a phone and a desktop: HR switches access on (welcome slip), sign-in with the code (Auth emulator), the forced password change, Home, leave applied with the days counted live, the line manager approves / rejects (Team badge), payslip view and PDF, an ERP user straight in, switched off; seeds its own data (ESS_TAILWIND_CSS where the Tailwind CDN is blocked)
node functions/test/ui/essRequests.ui.js   # Employee Portal step 2: a payroll query from the payslip with a photo, HR's reply / internal note / resolve in Employee Requests, the reply badge, an advance with its limit, the manager's approval, HR's Loans & Advances draft, the handlers, Payroll Setup's loan limits; seeds its own data (ESS_TAILWIND_CSS as above)
node functions/test/ui/stockScanning.ui.js # Item barcodes step 2: the Scan box in GRN, Material Issue, Stock Adjustment, Warehouse Movement and Physical Count (a carton adds 12 to its line, an unknown barcode named), GRN's item cell taking a barcode, a Viewer without Item Master's access; seeds its own data
node functions/test/ui/itemBarcodes.ui.js # Item barcodes: Item Master's Barcodes section (a pack's units, a scanner's Enter), a wrong check digit or a barcode on another item named with the item kept saved, list and search, read-only; seeds its own data
node functions/test/ui/masterImport.ui.js     # Master Data Import: copy headers, paste, issues by row, fix, import; seeds its own data (Part 2: Users password box)
node functions/test/ui/masterImportUpdate.ui.js # Master Data Import, Update existing (Employees): the columns, Copy current records, line managers pasted with each change shown, a locked column refused; seeds its own data
node functions/test/ui/trialBalance.ui.js   # after the trialBalance suite: Trial Balance (opening/transactions/closing)
node functions/test/ui/recurringJournal.ui.js # after the recurringJournal suite: the Recurring Journal Entries screen
```

- **Emulator memory:** the functions emulator keeps a ~100 MB worker for
  each function it has run and never frees them. The full suite plus the
  full smoke run fills Cloud Shell's 16 GB (exit 137). Run the suite in
  three parts, restarting the emulators before each and before the smoke
  run (two halves stopped fitting with the Fixed Assets suite: a half
  reached 152 workers and a suite hung). Every third file per part:
  `ls functions/test/emulator/*.test.js | awk 'NR % 3 == 1'` (then `== 2`, `== 0`).
  After a crash: `pkill -f '[f]unctionsEmulatorRuntime'`.
- **Hot reload:** the functions emulator doesn't pick up source edits.
  Restart it after changing code, including for negative controls.
- **Safety:** the suites WIPE the emulator database. `_helpers.js` refuses
  to run unless every client points at the local emulators.
- **Screens in tests:** `getModuleFragment` serves the active screen
  release, and the suites' wipe removes it. The UI harness releases the
  working copy's `screens/` into the emulator before each UI check, and
  the suites that open screens release them themselves (not every reset:
  a release takes about 0.7 s).
- **Smoke fixture:** run smoke and dynamic toggle after a suite that uses
  `_helpers.js`'s all-modules permissions (e.g. `vendorMaster`), not after
  `stockModules`, which grants only its four modules.
- **Last full run** (2026-09-28, before the Capital Work in Progress
  deploy):
  - Emulator tests: 260/260, in chunks of 7 files with an emulator
    restart between them.
  - Smoke: 93/93, plus FAAUC and its neighbours 16/16.
  - Single-company: 54/54. Dynamic toggle: 2/2.
  - UI checks: Fixed Assets 9/9, stock screens 14/14, Purchase Return
    4/4, requisitions 6/6, Job Order 4/4.
  - Home: 2/8, only because the cloud test container blocks the Tailwind
    CDN (see above); unaffected by those changes.
- **Party payments:** its check waits for elements, not fixed times, so it
  passes right after an emulator restart. Each run adds a bill, so rerun
  the partyPayments suite before rerunning it, or "oldest first" allocates
  against the previous run's bill.
- **Full run vs. one suite:** the full run above is for before a deploy or
  merge. While building or fixing a module, run only its suite (and its
  UI check); it doesn't need the split.

## Deploying

- **Always from a clean checkout:** `git status --porcelain` must be empty,
  because `firebase deploy` uploads the working copy, not the last commit.
- **Run deploys inside tmux** (`tmux new -s deploy`; after a disconnect,
  `tmux attach -t deploy`). A dropped Cloud Shell connection then can't
  kill the deploy, so the scripts use batches of 20 instead of 6; the CLI
  deploys a batch's functions in parallel, and each batch repeats the
  source upload. Outside tmux/screen they fall back to 6. Override with
  `BATCH=N`. Shared steps: `tools/deploy-lib.sh`, tested by
  `bash tools/test-deploy-lib.sh` (stubs; nothing reaches Google).
- **Every new callable needs a public-invoker binding**, since a 2nd-gen
  function doesn't get one automatically:
  `gcloud functions add-invoker-policy-binding FN --region=us-central1 --member=allUsers --gen2 --project=erp1-8f4cd`
- **New modules:** list the functions in `tools/deploy-sets/<set>.txt` and
  run `tools/deploy-functions.sh <set>` (clean-copy check, batches,
  retries, the binding for each, 8 bindings at a time). Add `--screens`
  when screens changed: it releases them after the functions, so a screen
  can't go live before the functions it calls.
- **Screens (`screens/*.html`):** `tools/release-screens.sh` (clean-copy
  check, then write, verify and activate a release in production
  Firestore). Users get it on their next screen open. No function deploy.
  `tools/release-screens.sh list` and `rollback <ID>` undo a release. The
  last 10 are kept. `tools/release-screens.sh compare` says whether the
  active release matches `screens/` (exit 3 if not). Record releases in
  the deploy log.
- **Generated-port functions:** `tools/deploy-migration.sh` (reads the
  pending list from `tools/legacy-port/status.js`).
- **Security rules:** `tools/deploy-rules.sh` deploys `database.rules.json`
  and `firestore.rules`. Both are deny-all.
- **Hosting (`public/index.html`, the app shell):** `tools/deploy-hosting.sh`
  (clean-copy check; stops on REPLACE_ME placeholders or anything in
  `public/` besides the shell). Tested by `bash tools/test-deploy-hosting.sh`
  (stubs; nothing reaches Google).
- **From GitHub instead of Cloud Shell:** go to GitHub → Actions →
  **Deploy** → Run workflow, and type `DEPLOY`. Choose one task:
  - a functions set, optionally followed by its screens. Without the
    screens, the run ends by comparing `screens/` with the live release.
    If they differ, the run shows a **"Screens not released"** warning
    listing them (owner, 2026-10-02); run "screens only" next;
  - screens only;
  - the runtime move;
  - the database rules;
  - Hosting.

  It runs the same scripts on a clean checkout of `main`
  (`.github/workflows/deploy.yml`), with batches of 6 (20 hit API errors in
  practice, see the roadmap), after checking
  that the generated code matches the generator's output. It needs the
  repository secret `GCP_SA_KEY`: the JSON key of a service account with
  Firebase Admin, Cloud Functions Admin, Cloud Run Admin and Service
  Account User. Log each run in the deploy log. All the deploy scripts
  exit non-zero when a step fails, so a failed run shows red.
- **Runtime:** functions run on Node 24 (`engines.node`). After a future
  bump, run `tools/deploy-runtime.sh` from a clean worktree.
- **Verify** with an unauthenticated call. A reply of "Please sign in
  again." comes from the function itself, so it's public and live.
- **Record** every deploy in [docs/DEPLOY_LOG.md](docs/DEPLOY_LOG.md).

## Caching

`firebase.json` sets `Cache-Control: no-cache` on every `.html` file, so a
deployed fix shows immediately. Revisit it once deploys become infrequent.

## The old Apps Script system

**Retired 2026-09-28 (owner): no longer used.** Its source is kept
read-only in `legacy-gas/` as the generator's input. Don't bring it back
into use:
- the bugs fixed during the migration are still in it;
- its RTDB access needed the looser `auth != null` rules that are now
  closed (see Security Rules above).

The data it wrote before retirement is still in production.
[docs/MIGRATION.md](docs/MIGRATION.md) → "Deviations from Code.gs" lists
the data check for each bug that affected that data; see the roadmap's
migration follow-ups. In particular, never use its "Recalculate Stock
Ledger" (#18).
