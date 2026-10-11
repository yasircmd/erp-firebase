# Deploy log

Every production deploy to project `erp1-8f4cd`
([Firebase console](https://console.firebase.google.com/project/erp1-8f4cd/overview)),
oldest first. All deploys run from Cloud Shell, in batches of ≤6
functions, with a public-invoker IAM binding for each new function. After
every deploy, add an entry: the date, what was deployed, the commit it came
from, and how it was verified. The deploy procedure is in the
[README](../README.md#deploying).

## Migration (2026-09-24 – 2026-09-25)

- **2026-09-24, batch A:** the 50 callables behind the 11 already-live
  modules (UOM … PROCUREMENTSETUP) were redeployed from `b64c41d`, picking up
  the `__positional` change and the `runtime.js` FieldPath fix (`9e5f34e`).
  `getModuleFragment` was held back so it wouldn't expose the 16 screens
  that had no live functions yet. The working copy was not verified clean
  for this batch; batch B below redeployed the same functions from a clean
  checkout, which settles that.
- **2026-09-24, batch B:** all 91 generated-port functions (`getModuleFragment`
  plus the 90 callables for all 27 modules) were deployed from `005021a` on a
  verified-clean working copy (in-progress Physical Count work stashed
  first), ending `ALL DONE`. With this, all 27 generated-port modules are
  live, including the 16 from SALESINVOICESETUP to CASHFLOW.
  `getModuleFragment` now serves all 31 screens in `functions/modules/`,
  including the 4 hand-ported stock modules; this log does not record a
  deploy of those modules' own functions (see the hand-ported sections
  above).
- **2026-09-25, batch C:** PHYSICALCOUNT, BOM, JOBORDERREQUEST, PRODUCTION
  and PRODCONSUMPTION (33 callables, plus `getModuleFragment` and the 8
  hand-ported helpers the script adds) were deployed from `e490376` by the
  migration session itself. It ran `tools/deploy-migration.sh` in a
  separate clean `git worktree` of that commit so porting could continue
  in the main checkout. 7 batches, all IAM bindings OK, ending `ALL DONE`.
  Unauthenticated probes of `getBoms`, `postProduction` and
  `getProductionConsumptionReport` return 401 from the function (not
  403 from IAM), so they're public and live.
- **2026-09-25, batch D:** PURCHASEREQUISITION, INVENTORYPURCHASEREQUISITION and
  PURCHASEORDER (27 functions with the helpers) were deployed from `390662c`
  the same way (clean worktree, migration session), ending `ALL DONE`. Probes
  reach the functions.
- **2026-09-25, batch E:** SALESORDER and DELIVERYNOTE (19 functions with the
  helpers) from `1633f44`, same method, ending `ALL DONE`.
- **2026-09-25, batch F:** JV, CBT, VENDORINVOICE and CUSTOMERINVOICE went
  live. `tools/deploy-migration.sh` deployed 37 functions from `f66c2bc`
  (reported by the owner as completed): the 27 generated functions plus
  10 hand-ported ones. Two of those no earlier batch had deployed:
  - `reverseGrn`, so the GRN reversal guards (deviation #15) are now live.
  - `getActiveVendors`, the Purchase Order and GRN vendor dropdown.

  Verified on `a2cbb08` beforehand: 173/173 emulator tests and smoke UI
  90/90, run in chunks with an emulator restart between them (see the
  MEMORY note in step 3), plus dynamic toggle 2/2.
- **2026-09-25, runtime upgrade Node 20 → 24:** `functions/package.json`
  `engines.node` is now `"24"`. Node 20 is decommissioned 2026-10-30, and Node 24
  is GA until 2028-10-31. The emulator tests have always run on the local
  Node 24, so no code changed. `functions/` is identical to the batch-F code (`a2cbb08`).
  All 235 live functions (the same set `functions/index.js` exports) were on
  `nodejs20`. `tools/deploy-runtime.sh` redeploys every function whose live
  runtime differs from `engines.node`, ≤6 per batch. It is idempotent, so re-run it
  after a timeout. It needs no IAM step because redeployed functions keep their
  bindings. Run it from a clean worktree, since `.claude/` is untracked in the main
  checkout. Check afterwards:
  `gcloud functions list --project=erp1-8f4cd --format="value(buildConfig.runtime)" | sort | uniq -c`
  should show only `nodejs24`.
  **Done 2026-09-25:** the migration session ran it from a clean worktree of
  `7cb2b65`: a canary (`getActiveUOMs`), then 234 functions in 39 batches,
  with no retries, ending `ALL DONE`. The check shows all 235 functions as
  `nodejs24 ACTIVE`. Unauthenticated probes of `restoreSession`,
  `postCustomerInvoice`, `getSalesTypes`, `reverseGrn` and `getActiveUOMs`
  return the function's own 401, so they're running and still public.
- **2026-09-25, batch G:** DATARESET went live, deployed by the migration
  session after the Node 24 upgrade finished. `tools/deploy-migration.sh`
  deployed 18 functions from `25c30f7` (function code identical to
  `84c9cdb`, the tested commit) in 3 batches with no retries, all IAM
  bindings OK, ending `ALL DONE`. Unauthenticated probes of all 7 Data
  Reset callables and `getModuleFragment` answer "Please sign in again."
  from the function, so they're public and live. The project now has 242
  functions, all on `nodejs24`. The original notes follow.

  DATARESET is the last module (7 callables plus `getModuleFragment`, so
  the screen appears).
  It includes the ledger-rebuild fix (deviation #18). The change to
  `stockMovement.js` is backward-compatible, so the hand-ported stock
  functions don't need a redeploy. Verified beforehand: 182/182
  emulator tests (in two chunks with an emulator restart between them),
  smoke UI 93/93 (Data Reset loaded as Admin, Viewer and a real `ADMIN`
  user) and dynamic toggle 2/2. To deploy, run
  `tools/deploy-migration.sh`. Only users whose role ID is `ADMIN` can
  use the screen.
- **2026-09-25, Hosting:** `firebase deploy --only hosting` from `ee3b088`,
  a clean checkout, after batch G. This put the shim-free `index.html`
  live. `https://erp1-8f4cd.web.app/` returns 200 and matches the repo's
  `public/index.html` byte for byte (no shim, no `REPLACE_ME`).

## New development (from 2026-09-25)

- **2026-09-25, Party Payments & Bill-wise Allocation (roadmap #0):**
  `tools/deploy-functions.sh party-payments` deployed the 17 functions in
  `tools/deploy-sets/party-payments.txt` from `a0185f6` (branch
  `party-payments`, clean checkout), at the owner's go-ahead. It ran in 3
  batches with no retries, all IAM bindings OK, ending `ALL DONE`. Two
  functions are new (`getPartyAccounts`, `getPartyOpenItems`), and
  `getModuleFragment` went last, serving the new JV, CBT and invoice
  screens. Unauthenticated probes of `getPartyAccounts`,
  `getPartyOpenItems`, `saveCbtDraft`, `getVendorInvoiceEntries` and
  `getModuleFragment` answer "Please sign in again." from the function,
  so they're public and live. The project now has 244 functions.
  Verified beforehand: 190/190 emulator tests, smoke 93/93, dynamic
  toggle 2/2, party payments UI 3/3. From now on, JV/CBT lines on a
  payables or receivables account need their vendor or customer.

- **2026-09-25, Hosting — compact density:** `firebase deploy --only hosting`
  from `b1054bc` (branch `ui-compact`, clean checkout), at the owner's
  go-ahead. The shell's stylesheet gains `--erp-density: 0.88`: about 12%
  less vertical spacing and smaller page titles on the home page and every
  module screen (pages measured 10–11% shorter). No functions changed.
  `https://erp1-8f4cd.web.app/` returns 200 and matches that commit's
  `public/index.html` byte for byte.

- **2026-09-25, Purchase Return, Sales Return, Vendor and Customer SOA
  (roadmap #1–#4):** the owner ran `tools/deploy-functions.sh
  returns-and-statements`, which deployed the 34 functions in
  `tools/deploy-sets/returns-and-statements.txt` from `a4c0f0d` (branch
  `party-statements`, not yet merged into `main`, clean checkout). That
  set is the union of the `purchase-return`, `sales-return` and
  `party-statements` sets, with each function listed once. It ran in 6
  batches with no retries and no IAM failures, ending `ALL DONE`.
  - **New (15):** the 7 Purchase Return callables, the 7 Sales Return
    callables and `getPartyStatement`.
  - **Updated (19):** the existing functions that read the changed module,
    approval and voucher-type lists, plus the Vendor/Customer Invoice
    reversal guards, `reverseJournalEntry`, `saveCompany`, and the GL and
    Stock Ledger reports. `getModuleFragment` went last, serving the four
    new screens and the Company Master fields.
  - The first batch reported four Purchase Return functions as "update"
    rather than "create". The log doesn't say why; they are live and
    public like the rest.
  - **Verified:** all 34 answer an unauthenticated call with "Please sign
    in again", so they're public and live. The project now has 259
    functions.
  - **Beforehand:** 205/205 emulator tests, smoke 101/101, dynamic toggle
    2/2, and the purchase return, sales return and statements UI checks
    4/4 each.
  - **Still to do in the app:** link the four screens with Tree
    Management, and set each company's Sales Returns Account (and, where
    needed, its Purchase Return Variance Account) in Company Master.

- **2026-09-26, screens released without a function deploy
  ([SCREENS_ON_HOSTING.md](modules/SCREENS_ON_HOSTING.md)):** two steps
  from `b0cd09d` (branch `party-statements`, clean checkout), run by the
  owner in this order:
  1. `tools/release-screens.sh` wrote release
     `20260926T051858Z-b0cd09d` (all 50 screens) to production Firestore,
     verified it and made it active. It's the first release. It took
     about 2 minutes, not the few seconds expected; it exited 0.
  2. `tools/deploy-functions.sh screen-releases` deployed
     `getModuleFragment` (1 batch, `ALL DONE`, updated 05:28:49 UTC,
     Node 24). It now serves the active release instead of its own
     copies. Its checks, messages and reply are unchanged.
  - **Verified:** the `allUsers` invoker binding is still in place, and an
    unauthenticated call gets "Please sign in again". The owner opened
    screens in the app and they load fine. The project still has 259
    functions.
  - **From now on**, screen-only changes go live with
    `tools/release-screens.sh`; roll back with `list` and
    `rollback <ID>`.

- **2026-09-26, Purchase Return cost-center fix
  ([PURCHASE_RETURN.md](modules/PURCHASE_RETURN.md), PR #6):**
  `tools/deploy-functions.sh purchase-return-cost-center` from `39276cd`
  (branch `purchase-return-cost-center`, clean checkout, in tmux)
  updated four existing functions: `getReturnableVendorInvoices`,
  `savePurchaseReturnDraft`, `postPurchaseReturn`,
  `decidePurchaseReturnApproval` (1 batch, `ALL DONE`, Node 24). No screen
  change.
  - **Fixes:** posting refused with "account 510001 (COGS) requires a
    Cost Center" when the invoice header had no cost center. The variance
    and Inventory lines now take the GRN's cost center.
  - **Verified:** all four answer an unauthenticated call with "Please
    sign in again", so they're still public and live.
  - **Beforehand:** purchaseReturn emulator suite 7/7 (with a negative
    control) and UI checks 4/4.

- **2026-09-26, Sales Returns Account per Sales Type
  ([SALES_RETURN.md](modules/SALES_RETURN.md), PR #7):**
  `tools/deploy-functions.sh sales-type-returns-account --screens` from
  `2c04eab` (branch `sales-type-returns-account`, clean checkout, in tmux)
  updated six existing functions: `saveSalesType`, `saveCompany`,
  `getReturnableCustomerInvoices`, `saveSalesReturnDraft`,
  `postSalesReturn`, `decideSalesReturnApproval` (1 batch, Node 24). It then
  released screens `20260926T063920Z-2c04eab` (Sales Invoice Configuration
  with the new field; Company Master without it). `ALL DONE`, exit 0.
  - **Verified:** all six answer an unauthenticated call with "Please
    sign in again", so they're still public and live.
  - **Beforehand:** salesReturn 7/7 with negative controls, related suites
    27/27, UI 4/4, smoke 101/101.
  - **Still to do in the app:** set a Sales Returns Account on every Sales
    Type in use (Sales Invoice Configuration). Until then, returns of that
    type are refused at posting.

- **2026-09-26, Home screen improvements (PR #8, see ROADMAP follow-ups):**
  `firebase deploy --project erp1-8f4cd --only hosting` from `b413e6c`
  (branch `home-screen-improvements`, clean checkout, in tmux). Hosting
  only: no functions, no screen release. `release complete`, exit 0.
  - **Verified:** the live `https://erp1-8f4cd.web.app/` is byte-identical
    to `public/index.html` at `b413e6c` (module search and Configure
    Favourites present). No `REPLACE_ME` placeholders.
  - **Beforehand:** `functions/test/ui/home.ui.js` 6/6, with three
    negative controls.
  - Users get it on their next page load. A reload may be needed if the
    browser has the old page cached.

- **2026-09-26, PDC Received / PDC Issued ([PDC.md](modules/PDC.md)):**
  `tools/deploy-functions.sh pdc --screens` from `a706976` (branch `pdc`,
  clean checkout, in tmux, run by the owner). 33 functions: the 12 new PDC
  callables plus 21 existing ones that read the changed registries,
  voucher-type maps, Data Reset categories, invoice lists, statements and
  Company Master (`tools/deploy-sets/pdc.txt`). 2 batches, all 33
  successful, then released screens `20260926T092427Z-a706976`. `ALL DONE`,
  exit 0.
  - **Verified:** the 12 new functions and `getPartyStatement` answer an
    unauthenticated call with "Please sign in again", so they're public
    and live.
  - **Beforehand:** pdc suite 6/6 with negative controls (3 breaks, each
    caught), PDC UI 7/7, full run 221/221, smoke 105/105.
  - **Hosting not yet deployed:** the Home "Post-dated Cheques Due to
    Clear" block needs `firebase deploy --project erp1-8f4cd --only hosting`.
  - **Still to do in the app:** set the PDC Received and PDC Issued
    Clearing Accounts in Company Master for each company. Link the
    "PDC Received" and "PDC Issued" tree nodes to `PDCRECEIVED` and
    `PDCISSUED` in Tree Management.

- **2026-09-26, PDC follow-up fixes and Hosting ([PDC.md](modules/PDC.md) → Fix):**
  `tools/deploy-functions.sh pdc-fixes --screens` from `9edc574` (branch
  `pdc`, clean checkout, in tmux) updated `getPartyStatement` (drops the
  "if pending PDCs bounce" figure). The first run's screen release failed
  with a Firestore `DEADLINE_EXCEEDED` after 300 s and left
  `20260926T104043Z-9edc574` INCOMPLETE (never active, so users stayed on
  the previous release). The re-run redeployed the function and released
  `20260926T105242Z-9edc574`: PDC, Purchase Return and Sales Return
  screens (approving from Home Tasks) and the two SOA screens. `ALL DONE`.
  Then `firebase deploy --project erp1-8f4cd --only hosting` from the
  same commit, which also completes the first PDC deploy's pending Hosting
  step (the Home "Post-dated Cheques Due to Clear" block).
  `release complete`.
  - **Verified:** `getPartyStatement` updated 10:52 UTC and answers an
    unauthenticated call with "Please sign in again". Active screen
    release `20260926T105242Z-9edc574` (52 screens). The live
    `https://erp1-8f4cd.web.app/` is byte-identical to `public/index.html`
    at `9edc574`. No `REPLACE_ME` placeholders.
  - **Beforehand:** pdc suite 6/6, PDC UI 8/8 (new "approval from Home
    Tasks" check), Purchase Return, Sales Return and SOA UI 4/4 each, smoke
    of the six changed screens 12/12. Negative controls: without the
    redraw the Tasks check fails; with a bounce line put back the SOA check
    fails.

- **2026-09-26, one-company users (ROADMAP → "One-company users: company
  chosen for them", PR #10):** from `d933363` (`main` after the merge,
  clean checkout; no functions changed).
  `firebase deploy --project erp1-8f4cd --only hosting` (`release
  complete`), then `tools/release-screens.sh` released
  `20260926T115827Z-d933363` (52 screens; took about 5 minutes, exit 0).
  - **Verified:** the live `https://erp1-8f4cd.web.app/` is byte-identical
    to `public/index.html` at `d933363` (contains SINGLE-COMPANY DEFAULT;
    no `REPLACE_ME`). Active screen release `20260926T115827Z-d933363`.
  - **Beforehand:** singleCompany UI 45/45, Home 7/7, smoke 105/105,
    dynamic toggle 2/2, stock 12/12, party payments 3/3, returns 4/4 each,
    statements 4/4, PDC 8/8; four negative controls caught.

- **2026-09-26, Fixed Assets phase 1 ([FIXED_ASSETS.md](modules/FIXED_ASSETS.md)):**
  from `9357d09` (branch `worktree-fixed-assets-design`, clean worktree),
  inside tmux: `tools/deploy-functions.sh fixed-assets-1 --screens`, the
  first deploy in batches of 20. 46 functions: the 23 new Fixed Asset
  callables, plus JV/CBT (asset-account guard), JV and Vendor Invoice
  reversal (capitalized-purchase guard), GL Report and
  `updatePostedDescription` (module map), Data Reset (two new
  categories), Roles/Tree Management and Approval Configuration (module
  lists), Home tasks, `getModuleFragment`. Batches 1 and 2 each needed a
  retry for transient Cloud Functions API request errors
  (`reverseFaPosting`; `saveAllModulePermissions`, `saveTreeNode`); all
  succeeded, `ALL DONE`. Screen release `20260926T154532Z-9357d09`
  (the six new screens). No Hosting change.
  - **Verified:** all 46 answer an unauthenticated call with "Please sign
    in again" (`saveJournalDraft` with a `jvData` argument: it reads it
    before the sign-in check, as before).
  - **Beforehand**, on `9357d09`: engine 15/15 unit tests; the emulator
    suite in three parts 73 + 72 + 84 = 229/229 (thirds now: halves ran out
    of memory); smoke 117/117, dynamic toggle 2/2, one-company 51/51,
    Home 7/7, Fixed Assets UI 7/7, Party Payments UI 3/3, PDC 6/6 + UI
    8/8. Negative controls as listed in FIXED_ASSETS.md → As built.
  - **To do in the app:** in Tree Management link *Capital Asset Master
    Management* → FAASSET, *Asset Acquisition & Capital Work-in-Progress
    (CWIP)* → FAACQ, *Multi-GAAP Depreciation Calculation Engine* →
    FADEPRUN, and add *Fixed Asset Configuration* (FACONFIG), *Additional
    Depreciation* (FAADDDEP), *Asset Register* (FAREGISTER). Then in Fixed
    Asset Configuration: each company's Fixed Asset Clearing Account, the
    account determinations and the asset classes.

- **2026-09-26, Fixed Assets phase 2: Fixed Asset Retirement (sale, scrap) and
  the owner's menu names ([FIXED_ASSETS.md](modules/FIXED_ASSETS.md) → As
  built — phase 2):** from `081fd56` (branch `worktree-fixed-assets-design`,
  clean worktree), owner's go-ahead, inside tmux: `tools/deploy-functions.sh
  fixed-assets-2 --screens`, 41 functions (2 new: `getFaRetirementSetup`,
  `previewFaRetirement`; the other Fixed Asset callables; JV / Vendor
  Invoice reversal, GL Report, `updatePostedDescription`,
  `getPartyStatement`; registries, approvals, Home tasks;
  `getModuleFragment`). First run in batches of 20: batches 1 and 2 still
  had Cloud Functions API request errors after 3 attempts each (different
  functions each time), so the script skipped the screen release. Re-run
  with `BATCH=6`: all 7 batches succeeded first time, bindings done,
  screen release `20260926T212000Z-081fd56` (FARETIRE plus the renamed
  headings), `ALL DONE`.
  - **Verified:** all 41 answer an unauthenticated call with "Please sign
    in again".
  - **Beforehand**, on `081fd56`: engine 17/17; emulator suite in thirds
    73 + 72 + 86 = 231/231; smoke 119/119; one-company 52/52; Home 7/7;
    Fixed Assets UI 8/8; Party Payments UI 3/3; PDC UI 8/8.
  - **To do in the app:** add a *Fixed Asset Retirement* node (FARETIRE)
    in Tree Management; set Gain on Disposal and Loss on Disposal in the
    account determinations; set the company's Output Tax account if
    sales carry VAT.

- **2026-09-27, Trial Balance: opening, transactions, closing (ROADMAP →
  Follow-ups; PR #13):** `tools/deploy-functions.sh trial-balance-period
  --screens`, run by the owner from `31c9d01` (branch
  `trial-balance-ob-cb`): 1 new function, `getTrialBalancePeriod`
  (created, Node.js 24, 2nd Gen, invoker binding with no failures), then
  screen release `20260927T062419Z-31c9d01` (TRIALBALANCE with From/To and
  the compact grid), `ALL DONE`. Not in tmux: batch of 6 (only 1 needed).
  - **Verified:** it answers an unauthenticated call with "Please sign in
    again".
  - **Beforehand**, on `31c9d01`: trialBalance emulator suite 6/6;
    Trial Balance UI 5/5; one-company 52/52; negative controls on the
    opening cutoff and the compact CSS.
- **2026-09-27, GL Report compact view (ROADMAP → Follow-ups; PR #13):**
  screen release `20260927T072723Z-19e00b8` via `tools/release-screens.sh`,
  run by the owner from `19e00b8` (branch `trial-balance-ob-cb`): 59
  screens written and verified in groups of 10, `Released and active`. No
  function change.
  - **Before it:** three attempts from `6a2bd0e` failed with
    `DEADLINE_EXCEEDED` (5 min): all screens written, but the single
    verify query stalled on a slow Cloud Shell link, so the active release
    (`20260927T062419Z-31c9d01`) never changed. They are listed as
    INCOMPLETE and will be pruned. Fixed in `19e00b8`: read-back in retried
    groups ([SCREENS_ON_HOSTING.md](modules/SCREENS_ON_HOSTING.md#change-2026-09-27-read-back-in-groups)).
  - **Beforehand**, on `19e00b8`: screenRelease suite 10/10; Trial
    Balance UI 6/6 (incl. the GL Report check); one-company 3/3; smoke 4/4.
- **2026-09-27, Recurring Journal Entries (ROADMAP #7; PR #14):** two
  passes, run by the owner (detached tmux, `~/deploy-rj.sh`) from the
  branch `worktree-recurring-journal-entries`.
  1. `tools/deploy-functions.sh recurring-journal --screens` from
     `800007e`, then Hosting: 33 functions in batches of 20. The 15 new
     callables (`getRecurringJournalSetup` … `getRecurringJournalsDueForUser`)
     were created, Node.js 24, 2nd Gen, and every invoker binding
     succeeded. `getGlReport` and `getDataResetCounts` failed all three
     retries ("Failed to make request", API errors in a batch of 20). Their
     previous versions kept serving. Every other update succeeded. The
     script ended `SOME STEPS FAILED`, so it skipped the screen release.
     The wrapper then deployed Hosting (the Home "Recurring Journal Entries
     Due to Post" block) anyway, because it didn't check that line. That
     was harmless: the block shows nothing when its call fails. The
     wrapper was fixed for the second pass.
  2. `tools/deploy-functions.sh recurring-journal-retry --screens` from
     `ea83977`: `getGlReport` and `getDataResetCounts` updated, then
     screen release `20260927T090709Z-ea83977` (RECURRINGJV, and the
     SOA screens' drill-through), `ALL DONE`.
  - **Verified:** unauthenticated calls to `getRecurringJournals`,
    `postRecurringJournalRuns`, `getRecurringJournalsDueForUser`,
    `reverseRecurringJournalRun`, `getGlReport` and `getDataResetCounts`
    answer "Please sign in again". All 15 new functions are ACTIVE
    (`gcloud functions list`).
  - **Beforehand**, on `800007e`: unit 30/30; recurringJournal suite 5/5
    plus JV, CBT, Data Reset, Approval Config, GL Report, Party Payments,
    PDC, Tree, Roles, Fixed Assets, Vendor Master and Party Statement
    suites green; UI: recurring 5/5, Home 8/8, statements 4/4, smoke and
    one-company green with RECURRINGJV; negative control (3 breaks, each
    caught).
  - **To do in the app:** link the existing "Recurring Journal Entries"
    tree node under FI to `RECURRINGJV` in Tree Management.
- **2026-09-27, Recurring Journal Entries: "Spread by service period"
  (owner's change; PR #14):** `tools/deploy-functions.sh
  recurring-journal-period --screens`, run by the owner (detached tmux,
  `~/deploy-rj.sh`) from `477bf33`: the 15 recurring callables updated
  (batch of 20; `getRecurringJournalsDueForUser` and then
  `reverseRecurringJournalRun` failed once each with API request errors
  and went through on the retries), then screen release
  `20260927T101610Z-477bf33`, `ALL DONE`. No Hosting change.
  - **Verified:** all 15 show ACTIVE, updated 10:15 UTC (`gcloud functions
    list`); `previewRecurringJournal` answers an unauthenticated call with
    "Please sign in again".
  - **Beforehand**, on `477bf33`: unit 16/16; recurringJournal suite 6/6;
    recurring UI 6/6 (the preview shows 500 / 1,000 × 11 / 500); smoke
    green; negative controls (service start ignored; stored plan ignored;
    raw days as weights), each caught.
- **2026-09-28, first deploy from GitHub Actions (PR #16):** a test run of
  the new **Deploy** workflow (`.github/workflows/deploy.yml`), started by
  the owner while Cloud Shell's weekly limit was reached. Task "functions
  set", set `trial-balance-period`, from `24622fd` (`main`, the PR #16
  merge). Run
  [#1](https://github.com/yasircmd/erp-firebase/actions/runs/36413715887),
  11:07–11:09 UTC, success.
  - **What changed in production:** nothing functional. The one function,
    `getTrialBalancePeriod`, was redeployed on Node.js 24 ("Successful
    update operation"), and `functions/src` is identical to the last
    deploy (`477bf33`). Then `ALL DONE` with no `IAM FAILED`, so the
    public-invoker binding worked.
  - **This confirms** the service account behind `GCP_SA_KEY` has every
    role a functions deploy needs, including Cloud Run Admin (added by the
    owner 2026-09-28 for the binding). The workflow's clean-checkout and
    generated-code checks passed, and the auth action removed its
    credentials file after the run.
  - **Warnings, not blocking:**
    - `firebase-functions` is reported outdated; upgrading has breaking
      changes and needs its own tested change.
    - The four actions used still target Node 20; GitHub runs them on
      Node 24 for now.
- **2026-09-28, security rules: RTDB locked to deny-all (Apps Script
  retired; PR #18):** Deploy workflow task "database rules"
  (`tools/deploy-rules.sh`) from `bb1cfe4` (`main`, the PR #18 merge), run
  [#2](https://github.com/yasircmd/erp-firebase/actions/runs/36416877541),
  11:38–11:39 UTC, success.
  - **RTDB:** "rules for database erp1-8f4cd-default-rtdb released
    successfully". It was `auth != null`, which let any signed-in user read
    and write the whole database directly; that existed only for the Apps
    Script system, retired by the owner the same day. It is now
    `".read": false, ".write": false`.
  - **Firestore:** already deny-all; "already up to date, skipping upload".
  - `ALL DONE`. The owner confirmed afterwards that the app works (sign
    in, screens, posting). Nothing in the app reads the database directly,
    and the functions use the Admin SDK, which bypasses rules. Rollback, if
    ever needed: revert `database.rules.json` and run this task again.
- **2026-09-28, screen release: PR and IPR fixes (PR #19):** Deploy
  workflow task "screens only" (`tools/release-screens.sh`) from `5adca41`
  (`main`, the PR #20 merge), run
  [#4](https://github.com/yasircmd/erp-firebase/actions/runs/36421065625),
  success. Release **`20260928T122017Z-5adca41`**: 60/60 screens written
  and verified, active. It contains the Purchase Requisition and Inventory
  Purchase Requisition fixes (Rejected lines editable; Home tasks open the
  entry). No function deploy.
  - The first attempt, run
    [#3](https://github.com/yasircmd/erp-firebase/actions/runs/36420417597)
    from `ac90c00`, failed before writing: "Command failed: git config
    user.name". `tools/screen-release.js` records the releaser's git name,
    and the runner had none. PR #20 made the workflow set it to
    "<actor> (GitHub Actions)", then the release went through.
- **2026-09-28, Job Order acceptance through Approval Configuration
  (PR #21):** Deploy workflow task "functions set, then screens", set
  `job-order-acceptance`, from `9c1de3d` (`main`, the PR #21 merge), run
  [#7](https://github.com/yasircmd/erp-firebase/actions/runs/36436602882),
  14:31–14:36 UTC, success.
  - **Functions:** the 10 in the set, updated in two batches (6, then 4),
    "Deploy complete!" each. Public-invoker bindings were applied by the
    script, which exits on any failure; the run ended `ALL DONE`.
  - **Screens:** release **`20260928T143614Z-9c1de3d`**, 60/60 written and
    verified, active. It carries the hand-maintained Job Order Request
    screen.
  - The owner tested it afterwards.
  - Runs [#5](https://github.com/yasircmd/erp-firebase/actions/runs/36429143655)
    and [#6](https://github.com/yasircmd/erp-firebase/actions/runs/36429375445),
    from `5adca41` before the merge, both failed without deploying. #5 had
    no set name given. #6 named a set that wasn't on `main` yet; the
    script listed the sets that were.
- **2026-09-28, screen release: GRN picker fix (PR #22):** Deploy workflow
  task "screens only" from `f75f256` (`main`, the PR #22 merge), run
  [#8](https://github.com/yasircmd/erp-firebase/actions/runs/36444550141),
  15:34–15:35 UTC, success. Release **`20260928T153508Z-f75f256`**: 60/60
  screens written and verified, active. A posted or pending GRN now shows
  only its own PO lines, locked. No function deploy.
- **2026-09-28, GRN non-stock lines (PR #23):** Deploy workflow task
  "functions set, then screens", set `grn-non-stock`, from `ce7496b`
  (`main`, the PR #23 merge), run
  [#9](https://github.com/yasircmd/erp-firebase/actions/runs/36453439590),
  16:46–17:09 UTC, success.
  - **Functions:** the 10 in the set, in two batches.
    - Batch 1: the four GRN functions, `getEligibleGRNsForInvoice` and
      `saveVendorInvoiceDraft`. "Deploy complete!" in 2 minutes.
    - Batch 2, the four Fixed Assets functions: the first attempt failed
      after 15 minutes. All four gave "Could not create or update Cloud
      Run service … Resource readiness deadline exceeded". The script's
      automatic retry deployed all four ("Deploy complete!", 17:09).
      Hence the 23-minute run.
    - The run ended `ALL DONE`, and the script exits on any failure, so
      the invoker bindings were applied.
  - **Screens:** release **`20260928T170924Z-ce7496b`**, 60/60 written and
    verified, active (GRN non-stock grid).
  - The owner deployed and confirmed it.
  - **Notices on the run, not blocking** (follow-ups in the roadmap):
    - The four actions still target Node 20 and are forced onto Node 24.
    - `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19; this run used
      `ubuntu-24.04`.
    - Also in the log: "invalid or damaged lockfile detected" from
      `npm ci` in `functions/`. The install still succeeded. Worth
      regenerating the lockfile in the `firebase-functions` upgrade.
- **2026-09-28, workflow test after PR #24 (actions on Node 24, runner
  pinned):** Deploy workflow task "screens only" from `43a9cc0` (`main`,
  the PR #24 merge), run
  [#10](https://github.com/yasircmd/erp-firebase/actions/runs/36458035329),
  17:25–17:26 UTC, success.
  - Ran on `ubuntu-24.04` with `actions/checkout@v6`, `setup-node@v6`,
    `google-github-actions/auth@v3` and `setup-gcloud@v3`.
  - No Node 20 warning.
  - Release **`20260928T172632Z-43a9cc0`**: 60/60 screens written and
    verified, active. The same screens as before, a harmless re-release.
- **2026-09-28, Fixed Assets: Capital Work in Progress + Job Order screen
  fix (PR #25):** Deploy workflow task "functions set, then screens", set
  `fixed-assets-cwip`, from `4ea8010` (`main`, the PR #25 merge), run
  [#11](https://github.com/yasircmd/erp-firebase/actions/runs/36468224611),
  18:52–19:07 UTC, success.
  - **Functions:** the 25 in the set, in batches of 6. The last batch
    ended with `getModuleFragment` "Successful update operation". The run
    ended `ALL DONE` (the script exits on any failure).
  - **Screens:** release **`20260928T190649Z-4ea8010`**, 61/61 written
    and verified, active. The new `FAAUC` screen makes it 61. It also
    carries the Job Order fix.
  - The owner then used CWIP Cost with no CWIP selected. The screen's
    message was unclear, which led to the follow-up in the next PR.
- **2026-09-28, screen release: clearer CWIP empty state (PR #26):** Deploy
  workflow task "screens only" from `c031af6` (`main`, the PR #26 merge),
  run
  [#12](https://github.com/yasircmd/erp-firebase/actions/runs/36474971111),
  19:50–19:51 UTC, success, on `ubuntu-24.04` with the Node 24 actions.
  Release **`20260928T195106Z-c031af6`**: 61/61 screens written and
  verified, active. The CWIP Cost list now says "No CWIP yet — create one
  in Fixed Asset Master" when a company has none open. No function
  deploy.
- **2026-09-29, GRN / Delivery Note invoicing state (PR #28):** Deploy
  workflow task "functions set, then screens", set `invoice-state`, from
  `ae7cbe1` (`main`, the PR #28 merge), run
  [#13](https://github.com/yasircmd/erp-firebase/actions/runs/36521207133),
  04:20–04:23 UTC, success, on `ubuntu-24.04`.
  - **Functions:** `getGrnEntries`, `getDeliveryNoteEntries`; the run
    ended `ALL DONE`.
  - **Screens:** release **`20260929T042254Z-ae7cbe1`**, 61/61 written and
    verified, active.
  - The owner tested it: all works.
- **2026-09-29, a run from `main` before PR #29 was merged:** Deploy task
  "functions set, then screens", set `draft-tasks`, from `ae7cbe1`, run
  [#14](https://github.com/yasircmd/erp-firebase/actions/runs/36530047797),
  failed at once (`no tools/deploy-sets/draft-tasks.txt`). Nothing was
  deployed.
- **2026-09-29, My Drafts in Home Tasks (PR #29):** from `ff73a34` (`main`,
  the PR #29 merge), on `ubuntu-24.04`.
  - **Functions:** Deploy task **"functions set"**, set `draft-tasks`, run
    [#15](https://github.com/yasircmd/erp-firebase/actions/runs/36530410031),
    06:18–06:20 UTC, success. `getMyDraftsForUser` was created and
    `getModuleFragment` updated. The run ended `ALL DONE`.
  - **No screen release:** the task was "functions set", not "functions
    set, then screens". The PURCHASEORDER, SALESORDER, JOBORDERREQUEST
    and GRN changes are **not live yet**: run Deploy → "screens only".
  - **Hosting:** Deploy task "hosting", run
    [#16](https://github.com/yasircmd/erp-firebase/actions/runs/36530654883),
    06:21–06:22 UTC, success ("release complete"). The My Drafts block is
    live.
  - The owner tested My Drafts: all works.
- **2026-09-29, screen releases for PR #29:** Deploy task "screens only"
  from `ff73a34` (`main`), twice, both successful with 61/61 screens
  written and verified. This released the PO, SO, Job Order and GRN
  changes that run #15 left out.
  - Run [#17](https://github.com/yasircmd/erp-firebase/actions/runs/36532532230),
    06:43–06:44 UTC: release `20260929T064408Z-ff73a34`.
  - Run [#18](https://github.com/yasircmd/erp-firebase/actions/runs/36538226387),
    07:42–07:43 UTC: release **`20260929T074308Z-ff73a34`**, active. The
    same screens again, a harmless re-release.
- **2026-09-29, `approval-routing` before its PR was merged:** Deploy task
  "functions set, then screens", set `approval-routing`, from `ff73a34`,
  run [#19](https://github.com/yasircmd/erp-firebase/actions/runs/36538605673),
  failed at once (`no tools/deploy-sets/approval-routing.txt`). Nothing
  was deployed.
- **2026-09-29, Approval routing (PR #30):** from `e114c8b` (`main`, the
  PR #30 merge), on `ubuntu-24.04`.
  - **Functions and screens:** Deploy task "functions set, then screens",
    set `approval-routing`, run
    [#20](https://github.com/yasircmd/erp-firebase/actions/runs/36539917920),
    07:59–08:03 UTC, success, `ALL DONE`. Screens release
    **`20260929T080311Z-e114c8b`**, 61/61 written and verified, active.
  - **Hosting:** Deploy task "hosting", run
    [#21](https://github.com/yasircmd/erp-firebase/actions/runs/36540542185),
    08:05–08:06 UTC, success.
  - The owner confirmed the deploy, then asked for a fifth CBT type for
    transfers between cash and bank accounts (Fund Transfer).
- **2026-09-29, CBT Fund Transfer (PR #31):** Deploy task "functions set,
  then screens", set `cbt-fund-transfer`, from `03f421e` (`main`, the PR #31
  merge), run
  [#22](https://github.com/yasircmd/erp-firebase/actions/runs/36548892490),
  09:23–09:29 UTC, success on `ubuntu-24.04`, `ALL DONE`.
  - **Functions:** the 15 in the set.
  - **Screens:** release **`20260929T092926Z-03f421e`**, 61/61 written and
    verified, active.
- **2026-09-29, report links restyled (PR #33):** Deploy task "screens
  only" from `833c3b7` (`main`, the PR #33 merge), run
  [#23](https://github.com/yasircmd/erp-firebase/actions/runs/36555695384),
  10:27–10:28 UTC, success. Release **`20260929T102829Z-833c3b7`**, 61/61
  written and verified, active.
- **2026-09-29, Credit / Debit Note print (PR #34):** Deploy task "screens
  only" from `11a985f` (`main`, the PR #34 merge), run
  [#24](https://github.com/yasircmd/erp-firebase/actions/runs/36561291054),
  11:22–11:23 UTC, success. Release **`20260929T112255Z-11a985f`**, 61/61
  written and verified, active.
- **2026-09-29, Fixed Assets: additional depreciation in the latest posted
  month (PR #35):** Deploy task "functions set, then screens", set
  `fa-additional-dep-same-month`, from `d96ab86` (`main`, the PR #35 merge),
  run [#25](https://github.com/yasircmd/erp-firebase/actions/runs/36564148306),
  11:49–11:52 UTC, success, `ALL DONE`. Release
  **`20260929T115154Z-d96ab86`**, 61/61 written and verified, active.
- **2026-09-29, TB and Balance Sheet balance notes (PR #36):** Deploy task
  "screens only" from `9fac02d` (`main`, the PR #36 merge), run
  [#26](https://github.com/yasircmd/erp-firebase/actions/runs/36565788677),
  12:04–12:06 UTC, success. Release **`20260929T120558Z-9fac02d`**, 61/61
  written and verified, active.
- **2026-09-29, runs #27 and #28 (no change):** Deploy tasks "hosting"
  ([#27](https://github.com/yasircmd/erp-firebase/actions/runs/36569174110),
  12:35–12:37 UTC) and "screens only"
  ([#28](https://github.com/yasircmd/erp-firebase/actions/runs/36569458584),
  12:38–12:39 UTC, release **`20260929T123924Z-9fac02d`**, 61/61), both
  success, from `9fac02d` (`main`, still the PR #36 merge). They were meant
  for the in-app dialogs, but that PR had not been opened yet, so they
  redeployed what was already live. The in-app dialogs are PR #37.
- **2026-09-29, in-app dialogs (PR #37):** from `b3542c0` (`main`, the
  PR #37 merge), in the right order. The new "Check no browser popups" step
  passed in each run.
  - **Hosting:** Deploy task "hosting", run
    [#29](https://github.com/yasircmd/erp-firebase/actions/runs/36584381951),
    14:40–14:41 UTC, success.
  - **Screens:** "screens only", run
    [#30](https://github.com/yasircmd/erp-firebase/actions/runs/36584650253),
    14:42–14:43 UTC, success. Release **`20260929T144327Z-b3542c0`**, 61/61
    written and verified, active.
  - **Hosting again:** run
    [#31](https://github.com/yasircmd/erp-firebase/actions/runs/36587983482),
    15:09–15:10 UTC, success. Same commit, so no change.
- **2026-09-29, compact line grids and tables (PR #38):** Deploy task
  "hosting" from `ffbb6ea` (`main`, the PR #38 merge), run
  [#32](https://github.com/yasircmd/erp-firebase/actions/runs/36593101304),
  15:49–15:50 UTC, success, `ALL DONE`.
- **2026-09-29, copyright on the login page and Home only (PR #39):**
  Deploy task "hosting" from `3ab374a` (`main`, the PR #39 merge), run
  [#33](https://github.com/yasircmd/erp-firebase/actions/runs/36594734223),
  16:02–16:03 UTC, success, `ALL DONE`.
- **2026-09-29, JV list columns (PR #40):** Deploy task "screens only" from
  `859e66f` (`main`, the PR #40 merge), run
  [#34](https://github.com/yasircmd/erp-firebase/actions/runs/36596733003),
  16:18–16:19 UTC, success. Release **`20260929T161919Z-859e66f`**, 61/61
  written and verified, active.
- **2026-09-29, runs #35 and #36 (no change):** from `859e66f` (`main`,
  still the PR #40 merge), before the date PR existed; they redeployed
  what was live. The owner then found dates unchanged.
- **2026-09-29, dates dd/mm/yyyy (PR #41):** from `1b7c39e` (`main`, the
  PR #41 merge). The new "Check date format" step passed in both runs.
  - **Hosting:** Deploy task "hosting", run
    [#37](https://github.com/yasircmd/erp-firebase/actions/runs/36599529091),
    16:41–16:42 UTC, success.
  - **Screens:** "screens only", run
    [#38](https://github.com/yasircmd/erp-firebase/actions/runs/36599727622),
    16:43–16:44 UTC, success. Release **`20260929T164350Z-1b7c39e`**, active.
- **2026-09-29, BOM parent name (PR #42):** Deploy from `1163051` (`main`,
  the PR #42 merge), run
  [#39](https://github.com/yasircmd/erp-firebase/actions/runs/36602855604),
  17:08–17:11 UTC, success (a functions deploy by its length; the set to
  run was `bom-current-parent-name`).
- **2026-09-29, approval delegation (PR #43):** from `607ba19` (`main`,
  the PR #43 merge).
  - **Functions:** Deploy task "functions set", set `approval-delegation`,
    run [#40](https://github.com/yasircmd/erp-firebase/actions/runs/36606712998),
    17:41–17:43 UTC, success. The screens box was not ticked, so the
    Approval Tracker didn't change yet.
  - **Screens:** "screens only", run
    [#41](https://github.com/yasircmd/erp-firebase/actions/runs/36609576600),
    18:05–18:06 UTC, success. Release **`20260929T180641Z-607ba19`**, 61/61
    written and verified, active.
- **2026-10-02, list paging (PR #44):** from `9de393a` (`main`, the PR #44
  merge). The workflow's checks (generated code, no browser popups, date
  format) passed in all three runs.
  - **Hosting:** Deploy task "hosting", run
    [#42](https://github.com/yasircmd/erp-firebase/actions/runs/36972089359),
    06:07–06:08 UTC, success, `ALL DONE`.
  - **Functions:** "functions set", set `list-paging`, run
    [#43](https://github.com/yasircmd/erp-firebase/actions/runs/36972519345),
    06:13–06:17 UTC, success: all nine list functions in two batches,
    `ALL DONE`. The screens box was not ticked, so JV still showed "Load
    all".
  - **Screens:** "screens only", run
    [#44](https://github.com/yasircmd/erp-firebase/actions/runs/36973806188),
    06:29–06:30 UTC, success. Release **`20261002T063030Z-9de393a`**,
    61/61 written and verified, active.
- **2026-10-02, Purchase Requisition visibility (PR #46):** Deploy task
  "functions set", set `pr-visibility`, from `a4742f4` (`main`, the PR #46
  merge), run
  [#45](https://github.com/yasircmd/erp-firebase/actions/runs/36993042721),
  10:00–10:04 UTC, success.
  - The new step "Check screens are released" (PR #45) ran for the first
    time: "the active release matches screens/ (a4742f4)" (release
    `20261002T063030Z-9de393a`). It is right, as this change has no
    screens.
- **2026-10-02, Master Data Import, Part 1 (PR #47):** Deploy task
  "functions set, then screens", set `master-import-1`, from `42a2762`
  (`main`, the PR #47 merge), run
  [#46](https://github.com/yasircmd/erp-firebase/actions/runs/37003487769),
  11:53–11:56 UTC, success.
  - Release **`20261002T115635Z-42a2762`**: 62/62 screens (MASTERIMPORT
    new) written and verified, active, `ALL DONE`.
  - The screen check was skipped, correctly: the screens were released
    in the same run.
  - **In the app:** link a menu node to Master Data Import.
- **2026-10-02, Master Data Import, Part 2 (PR #48):** Deploy task
  "functions set", set `master-import-2`, from `6beeafe` (`main`, the PR
  #48 merge), run
  [#47](https://github.com/yasircmd/erp-firebase/actions/runs/37010517136),
  13:03–13:07 UTC, success.
  - **The screens were not included.** The step "Check screens are
    released" (PR #45) warned: "Screens NOT released: 1 differ from the
    active release. changed: MASTERIMPORT" (active release still
    `20261002T115635Z-42a2762`).
  - **Still to run:** "screens only", so the Part 2 screen (the Users
    temporary-password box) goes live.
- **2026-10-02, Master Data Import Part 2 screen (PR #48) and item account
  rules (PR #49):** two runs from `9b2336b` (`main`, the PR #49 merge).
  - Run [#48](https://github.com/yasircmd/erp-firebase/actions/runs/37011989049),
    13:17–13:18 UTC, success: "screens only". Release
    **`20261002T131810Z-9b2336b`**: 62/62 screens written and verified,
    active. The Part 2 screen (the Users temporary-password box) is live.
  - Run [#49](https://github.com/yasircmd/erp-firebase/actions/runs/37012290963),
    13:20–13:22 UTC, success: "functions set", set
    `master-import-item-accounts` (getMasterImportSpecs, checkMasterImport,
    runMasterImport), `ALL DONE`. "Check screens are released": "the active
    release matches screens/ (9b2336b)".
- **2026-10-02, Compact master forms and Opening Balances (PR #50):** from
  `767fd3b` (`main`, the PR #50 merge), three runs, all successful.
  - Run [#50](https://github.com/yasircmd/erp-firebase/actions/runs/37024530073),
    15:05–15:15 UTC: "functions set, then screens", set `opening-balances`
    (the last function updated was clearSelectedRecords), `ALL DONE`.
    Release **`20261002T151543Z-767fd3b`**: 63/63 screens (OPENINGBALANCES
    new) written and verified, active.
  - Run [#51](https://github.com/yasircmd/erp-firebase/actions/runs/37029458873),
    15:47–15:56 UTC: the same task again, `ALL DONE`. Release
    `20261002T155643Z-767fd3b`.
  - Run [#52](https://github.com/yasircmd/erp-firebase/actions/runs/37031757900),
    16:07–16:08 UTC: "screens only". Release `20261002T160827Z-767fd3b`.
  - **The one-line list fix was not in it.** PR #50 was merged before
    that commit was pushed, so the lists still wrapped (owner's
    screenshot). The fix follows in its own PR.
  - **In the app:** link a menu node to Opening Balances.
- **2026-10-02, master lists one line per row (PR #51):** Deploy task
  "screens only", from `f39b072` (`main`, the PR #51 merge), run
  [#53](https://github.com/yasircmd/erp-firebase/actions/runs/37032350517),
  16:12–16:13 UTC, success. The list fix is live.
- **2026-10-02, COA recode on move (PR #52) and shared accounts under
  each company (PR #53):** two runs, both successful. Each released
  screens in the same run (its "Check screens are released" step was
  skipped).
  - Run [#54](https://github.com/yasircmd/erp-firebase/actions/runs/37038635143),
    17:08–17:10 UTC, from `0279e49` (the PR #52 merge): with functions
    (deploy step 1 min 19 s; set `coa-recode`).
  - Run [#55](https://github.com/yasircmd/erp-firebase/actions/runs/37039499387),
    17:15–17:18 UTC, from `416bc71` (the PR #53 merge).
- **2026-10-02, SOA compact view (PR #54):** run
  [#56](https://github.com/yasircmd/erp-firebase/actions/runs/37040649860),
  17:25–17:27 UTC, from `3f949ff` (the PR #54 merge), success
  ("screens only").
- **2026-10-02, Copy / Paste with headings on every entry grid (PR #55):**
  run [#57](https://github.com/yasircmd/erp-firebase/actions/runs/37044352746),
  17:58–17:59 UTC, from `5503b74` (the PR #55 merge), success
  ("screens only").
- **2026-10-02, one GL line per identical posting (PR #57):** run
  [#58](https://github.com/yasircmd/erp-firebase/actions/runs/37061530012),
  20:35–20:48 UTC, from `195f026` (the PR #57 merge), success (13 min:
  the `line-clubbing` functions set, 50 functions).
- **2026-10-03, Stock Ledger Back keeps its filters (PR #58):** run
  [#59](https://github.com/yasircmd/erp-firebase/actions/runs/37099166098),
  05:14–05:15 UTC, from `c1c8b95` (the PR #58 merge), success
  ("screens only").
- **2026-10-03, supporting documents on entries (PR #60):** three runs
  from `43274e3` (the PR #60 merge), all successful, in the order the PR
  gives:
  - Run [#60](https://github.com/yasircmd/erp-firebase/actions/runs/37106703397),
    07:32–07:37 UTC: functions, set `supporting-documents` (its "Check
    screens are released" step ran).
  - Run [#61](https://github.com/yasircmd/erp-firebase/actions/runs/37107176393),
    07:41–07:42 UTC, and run
    [#62](https://github.com/yasircmd/erp-firebase/actions/runs/37107304020),
    07:43–07:44 UTC: Hosting and the screens.
  - In the app (owner): the Document Storage menu node is linked. The
    Google set-up and Connect Google Drive are still to do.
- **2026-10-03, supporting documents in light mode (PR #61):** run
  [#63](https://github.com/yasircmd/erp-firebase/actions/runs/37108586107),
  from `ad0d2ff` (the PR #61 merge), success ("hosting").
- **2026-10-03, Document Storage connected (owner, in the app):** Google
  Cloud set-up done (Drive API, consent screen in production with
  `drive.file`, Web OAuth client), Google Drive connected and the test
  passed. The owner moved "ERP Documents" into a project folder in Drive.
- **2026-10-03, Company Documents (PR #63):** three runs from `4c484b2`
  (the PR #63 merge), all successful, in the order the PR gives:
  - Run [#64](https://github.com/yasircmd/erp-firebase/actions/runs/37123937093),
    12:46–12:51 UTC: functions, set `company-documents`.
  - Run [#65](https://github.com/yasircmd/erp-firebase/actions/runs/37124259667),
    12:51–12:52 UTC, and run
    [#66](https://github.com/yasircmd/erp-firebase/actions/runs/37124352644),
    12:53–12:54 UTC: Hosting and the screens.
  - The owner linked the menu node and tested it in the app.
- **2026-10-03, HR Employee Records step 1 (PR #65):** two runs from
  `c8d6d4d` (the PR #65 merge), both successful:
  - Run [#67](https://github.com/yasircmd/erp-firebase/actions/runs/37131981656), 15:05–15:10 UTC: functions, set
    `hr-employees-1` (its "Check screens are released" step ran).
  - Run [#68](https://github.com/yasircmd/erp-firebase/actions/runs/37132477834), 15:13–15:14 UTC: the follow-up release
    (screens; a one-minute run).
- **2026-10-03, HR Employee Records steps 2–5 (PRs #66–#69):** five runs
  from `d82f4c7` (the PR #69 merge), all successful, in the order agreed
  (functions sets first without screens, so no screen went live before
  its functions):
  - Run [#73](https://github.com/yasircmd/erp-firebase/actions/runs/37152225851), 20:37–20:41 UTC: functions, set
    `hr-employees-2`.
  - Run [#74](https://github.com/yasircmd/erp-firebase/actions/runs/37152510859), 20:42–20:45 UTC: functions, set
    `hr-employees-3`.
  - Run [#75](https://github.com/yasircmd/erp-firebase/actions/runs/37152719698), 20:46–20:52 UTC: functions, set
    `hr-employees-4`.
  - Run [#76](https://github.com/yasircmd/erp-firebase/actions/runs/37153243474), 20:55–20:56 UTC: Hosting.
  - Run [#77](https://github.com/yasircmd/erp-firebase/actions/runs/37153420830), 20:58–20:59 UTC: screens only.
  - In the app (owner): the HR roles were added in Roles & Permissions,
    which showed the grid wrapping with 12 roles (fixed in the next PR).
- **2026-10-03, Roles & Permissions with many roles (PR #70):** run
  [#78](https://github.com/yasircmd/erp-firebase/actions/runs/37154333286),
  21:13–21:14 UTC, from `8d56d84` (the PR #70 merge), success ("screens
  only").
- **2026-10-04, the Leave Register and Payroll steps 0–3 (PRs #71–#78):**
  ten runs of the Deploy workflow, all successful, logged on 2026-10-05
  from the workflow's run list. The run list doesn't record each run's
  task or set, so the sets below are taken from the PR each run was made
  from (the owner, 2026-10-05: deployed up to `payroll-3`):
  - Runs [#79](https://github.com/yasircmd/erp-firebase/actions/runs/37184022395),
    06:51–06:54 UTC, and [#80](https://github.com/yasircmd/erp-firebase/actions/runs/37184332675),
    06:57–06:58 UTC, from `fc92d8e` (PR #71): `hr-leave-1`.
  - Run [#81](https://github.com/yasircmd/erp-firebase/actions/runs/37188200781),
    08:13–08:22 UTC, from `aed396f` (PR #72): `hr-leave-2`.
  - Run [#82](https://github.com/yasircmd/erp-firebase/actions/runs/37191661515),
    09:17–09:26 UTC, from `c54faaf` (PR #73): `hr-leave-3`.
  - Runs [#83](https://github.com/yasircmd/erp-firebase/actions/runs/37195104831),
    10:21–10:31 UTC, and [#84](https://github.com/yasircmd/erp-firebase/actions/runs/37195921371),
    10:36–10:37 UTC, from `ebd6d66` (PR #74): `hr-leave-4`, then a
    one-minute run (Hosting, for the Home leave blocks).
  - Run [#85](https://github.com/yasircmd/erp-firebase/actions/runs/37199245711),
    11:35–11:42 UTC, from `6c7aaa7` (PR #75): `payroll-0`.
  - Run [#86](https://github.com/yasircmd/erp-firebase/actions/runs/37205339438),
    13:21–13:24 UTC, from `274bf9d` (PR #76): `payroll-1`.
  - Run [#87](https://github.com/yasircmd/erp-firebase/actions/runs/37208515766),
    14:14–14:20 UTC, from `61ce4fd` (PR #77): `payroll-2`.
  - Run [#88](https://github.com/yasircmd/erp-firebase/actions/runs/37213898904),
    15:40–15:49 UTC, from `b139201` (PR #78): `payroll-3`.
  - Still to deploy: `payroll-4`, `payroll-4b`, `payroll-5a`, `payroll-5b`
    (ROADMAP → "Waiting to go live").
- **2026-10-05, Payroll steps 4–5b (PRs #79–#82):** five runs, all
  successful. The owner reports deploying the functions sets
  `payroll-4` to `payroll-5b` in order, then the screens; the run list
  doesn't record each run's set, so the order below follows that report.
  No Hosting deploy was needed: nothing in `public/` or `firebase.json`
  changed since run #84.
  - Run [#89](https://github.com/yasircmd/erp-firebase/actions/runs/37273431837),
    06:38–06:45 UTC, from `68f136d` (the PR #82 merge): `payroll-4`.
  - Run [#90](https://github.com/yasircmd/erp-firebase/actions/runs/37274075637),
    06:45–06:55 UTC, from `a3b6ae7` (the PR #83 merge, docs only on top):
    `payroll-4b`.
  - Run [#91](https://github.com/yasircmd/erp-firebase/actions/runs/37275123844),
    06:58–07:12 UTC, from `a3b6ae7`: `payroll-5a`.
  - Run [#92](https://github.com/yasircmd/erp-firebase/actions/runs/37276559839),
    07:13–07:23 UTC, from `a3b6ae7`: `payroll-5b`.
  - Run [#93](https://github.com/yasircmd/erp-firebase/actions/runs/37277711203),
    07:26–07:27 UTC, from `a3b6ae7`: the screens release.
  - In the app (owner, still to do): the payroll set-up listed in
    ROADMAP → "Waiting to go live".
- **2026-10-05, Master Data Import 3a, update existing Employees (PR #85):**
  run [#94](https://github.com/yasircmd/erp-firebase/actions/runs/37302114785),
  11:18–11:20 UTC, from `6d41244` (the PR #85 merge), success: functions
  set `master-import-3a` with the screens. The owner tested it (line
  managers updated; the org chart shows them).
- **2026-10-05 – 2026-10-09, runs #95–#107** (recorded 2026-10-09 from
  the runs' logs. Where a log's tail no longer showed the set's name,
  the set was matched by the functions deployed: their number, the
  batches of 6 and the last batch match exactly one set file):
  - Run [#95](https://github.com/yasircmd/erp-firebase/actions/runs/37309546690), 2026-10-05
    12:26–12:29 UTC, from `0fa861d` (PR #86): `master-import-3b`,
    functions only (4); the screens already matched the live release.
  - Run [#96](https://github.com/yasircmd/erp-firebase/actions/runs/37454730865), 2026-10-06
    11:11–11:25 UTC, from `b940395` (PR #87): `payroll-5c` with the
    screens (53 functions, 9 batches); release `20261006T112447Z-b940395`.
  - Run [#97](https://github.com/yasircmd/erp-firebase/actions/runs/37480955912), 2026-10-06
    14:40–14:54 UTC, from `3e5a963` (PR #88): `payroll-6` with the
    screens (50 functions, 9 batches); release `20261006T145404Z-3e5a963`.
  - Run [#98](https://github.com/yasircmd/erp-firebase/actions/runs/37887395391), 2026-10-09
    05:11–05:19 UTC, from `e12df4a` (PR #89): `gl-references` with the
    screens (27 functions); release `20261009T051849Z-e12df4a`.
  - Run [#99](https://github.com/yasircmd/erp-firebase/actions/runs/37892066600), 2026-10-09
    06:09–06:15 UTC, from `e1d36fb` (PR #90): `retail-sales` with the
    screens (16 functions); release `20261009T061428Z-e1d36fb`.
  - Run [#100](https://github.com/yasircmd/erp-firebase/actions/runs/37896704826), 07:01–07:08
    UTC, from `bf1aeb9` (PR #91): `retail-sales`, functions only; the
    run warned that RETAILSALES was not released.
  - Run [#101](https://github.com/yasircmd/erp-firebase/actions/runs/37898143969), 07:17–07:18
    UTC, from `bf1aeb9`: "screens only"; release `20261009T071800Z-bf1aeb9`.
  - Run [#102](https://github.com/yasircmd/erp-firebase/actions/runs/37902176643), 07:59–08:05
    UTC, from `2e0f9d3` (PR #92): `retail-sales` with the screens;
    release `20261009T080507Z-2e0f9d3`.
  - Run [#103](https://github.com/yasircmd/erp-firebase/actions/runs/37915009559), 10:01–10:06
    UTC, from `8ca198a` (PR #93): `payroll-7a` with the screens (8
    functions); release `20261009T100550Z-8ca198a`.
  - Run #104: not in the repository's run list (deleted); nothing known.
  - Run [#105](https://github.com/yasircmd/erp-firebase/actions/runs/37924034652), 11:29–11:38
    UTC, from `9670c09` (PR #94): `payroll-7b` with the screens (25
    functions); release `20261009T113728Z-9670c09`.
  - Run [#106](https://github.com/yasircmd/erp-firebase/actions/runs/37934666070), 13:07–13:12
    UTC, from `1989fb6` (PR #95): `payroll-7c` with the screens (11
    functions); release `20261009T131128Z-1989fb6`.
  - Run [#107](https://github.com/yasircmd/erp-firebase/actions/runs/37946265484), 14:43–14:49
    UTC, from `e3daafa` (PR #96): `retail-sales`, functions only; the
    run warned that RETAILSALES (Clear asks first) was not released. Run
    #109 below released it.
- **2026-10-09, Retail Sales (`retail-sales`):** run
  [#108](https://github.com/yasircmd/erp-firebase/actions/runs/37947839223),
  14:55–14:56 UTC, from `3307499` (the PR #97 merge), **failed before
  deploying anything**: "working copy not clean … M screens/ITEMMASTER.html".
  The workflow's generated-code check reruns tools/legacy-port/generate.js,
  which rewrote Item Master's screen (still a generated one) and dropped
  its new Barcodes section (PR #97). Fixed by making that screen
  hand-maintained (`handScreens` in tools/legacy-port/modules.json); rerun
  `retail-sales` once the fix is merged.
- **2026-10-09, Retail Sales and item barcodes (PRs #90–#92, #96–#98):**
  both from `3c58cc3` (the PR #98 merge), "functions set, then screens":
  - Run [#109](https://github.com/yasircmd/erp-firebase/actions/runs/37948665820),
    15:02–15:07 UTC, success: `retail-sales` (as the owner reported; its
    log was not read).
  - Run [#110](https://github.com/yasircmd/erp-firebase/actions/runs/37949426206),
    15:08–15:10 UTC, success: `item-barcodes` (getItemBarcodes and
    saveItemBarcodes created; getRetailCounter, getMasterImportSpecs,
    checkMasterImport, runMasterImport updated); screens release
    `20261009T151026Z-3c58cc3`.
  - In the app (owner): link a menu node to "Retail Sales", set its rights
    and each company's setup (ROADMAP); add the products' barcodes in Item
    Master or Master Data Import → Item Barcodes.
- **2026-10-09, item barcodes 2 and 3, Retail Sales returns:** each
  "functions set, then screens", success (as the owner reported; their logs
  were not read):
  - Run [#111](https://github.com/yasircmd/erp-firebase/actions/runs/37953423952),
    15:40–15:42 UTC, from `ed38f1b` (PR #99): `item-barcodes-2`.
  - Run [#112](https://github.com/yasircmd/erp-firebase/actions/runs/37964320809),
    17:09–17:12 UTC, from `41a57d7` (PR #100): `item-barcodes-3`.
  - Run [#113](https://github.com/yasircmd/erp-firebase/actions/runs/37985274289),
    20:11–20:17 UTC, from `dfada15` (PR #101): `retail-returns`. In the
    app: tick "return" in Roles & Permissions → Retail Sales, and set
    each company's return period.
- **2026-10-10, Numbering (`numbering`, every function):** run
  [#114](https://github.com/yasircmd/erp-firebase/actions/runs/38022856515),
  04:05–06:22 UTC, from `47822ce` (PR #102), batches of 6.
  - **All 83 batches deployed** (the last, batch 83/83, finished at
    06:14).
  - The invoker bindings then ran, and **one failed**:
    `getActiveRequisitionCategories`, an existing function. A redeploy
    keeps an existing function's binding, so it is most likely still
    public. Check with an unauthenticated call, and grant it once if not.
  - The run ended red ("SOME STEPS FAILED"), so **the screens were not
    released**. The NUMBERING screen is not live yet.
  - **No full re-run is needed:** release the screens with the
    workflow's "screens only" task.
- **2026-10-10, Numbering's screen and GL views:** both success:
  - Run [#115](https://github.com/yasircmd/erp-firebase/actions/runs/38031637212),
    06:38–06:39 UTC, from `47822ce` (PR #102): **screens only**, which
    released NUMBERING, the screen run #114 had left unreleased.
  - **`getActiveRequisitionCategories` checked by the owner:** Purchase
    Requisition's categories load, so its invoker binding is intact (the
    one that failed in run #114).
  - Run [#116](https://github.com/yasircmd/erp-firebase/actions/runs/38032088539),
    06:46–06:49 UTC, from `5e92869` (PR #103): `gl-views`, functions then
    screens.
  - **Verified:** the owner reports everything tested and working.
- **2026-10-10, Employee Self-Service Portal steps 1–3** (`employee-portal`,
  `employee-portal-2`, `employee-portal-3`; screens; Hosting). Logged
  afterwards from the Actions history: the runs' tasks are not visible
  there, so they are taken from the owner's reports.
  - From `8d52227` (PR #105, step 1): run
    [#117](https://github.com/yasircmd/erp-firebase/actions/runs/38040337768)
    09:08–09:16 UTC success; runs
    [#118](https://github.com/yasircmd/erp-firebase/actions/runs/38040945461)
    and [#119](https://github.com/yasircmd/erp-firebase/actions/runs/38041054558)
    failed; run [#120](https://github.com/yasircmd/erp-firebase/actions/runs/38041143409)
    09:22–09:34 success; run
    [#121](https://github.com/yasircmd/erp-firebase/actions/runs/38041960565)
    (**hosting**) failed: the REPLACE_ME guard matched a word in a comment
    in public/ess.html (fixed in PR #106, with `hostingGuards.test.js`).
  - From `fff1947` (PR #106, step 2 and the hosting fix): runs
    [#122](https://github.com/yasircmd/erp-firebase/actions/runs/38046511038),
    [#123](https://github.com/yasircmd/erp-firebase/actions/runs/38046772346)
    and [#124](https://github.com/yasircmd/erp-firebase/actions/runs/38047991056),
    10:53–11:20, all success.
  - From `e586d72` (PR #107, step 3): run
    [#125](https://github.com/yasircmd/erp-firebase/actions/runs/38053052470)
    12:44–12:48 and run
    [#126](https://github.com/yasircmd/erp-firebase/actions/runs/38053895983)
    12:57–12:59, both success.
  - **Owner's decision after step 3:** the reimbursement pay elements stay
    in Earnings & Deductions (HR still enters other entries there).
- **2026-10-10, Employee Portal follow-ups (`employee-portal-4`):** run
  [#127](https://github.com/yasircmd/erp-firebase/actions/runs/38078744782),
  19:10–19:13 UTC, from `4b7d30b` (PR #108): functions and screens,
  success. The company names show (screens).
  - Run [#128](https://github.com/yasircmd/erp-firebase/actions/runs/38079309942),
    19:19–19:20 UTC, same commit: **hosting**, success. My Portal in the
    user menu, ERP Home without the leave blocks, the portal's leave
    sections and Payroll's payslip in the portal. The owner confirms it's done.
- **2026-10-11, Retail Sales roll receipts and the discount switch
  (`retail-receipts`):** run
  [#129](https://github.com/yasircmd/erp-firebase/actions/runs/38119062963),
  06:44–06:48 UTC, from `2dec994` (PR #109): functions and screens,
  success. The owner confirms it is done.
