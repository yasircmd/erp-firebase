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
