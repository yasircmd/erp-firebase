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
