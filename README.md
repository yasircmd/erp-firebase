# ERP on Firebase

A multi-company ERP: finance (chart of accounts, JV, cash and bank, GL
reports, financial statements), inventory (GRN, material issue, stock
adjustment, warehouse movement, physical count, valuation), production
(BOM, job orders, production), purchasing (requisitions, purchase orders,
vendor invoices) and sales (price lists, sales orders, delivery notes,
customer invoices), with role-based access and configurable approvals.

It runs on Firebase project `erp1-8f4cd`: Cloud Functions (2nd gen,
callable, Node 24), Hosting, Realtime Database and Firestore. It was
migrated from Google Apps Script, and that migration finished on
2026-09-25. All 46 screens are live.

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
public/index.html               — the app shell: login, session, menu tree, home tasks, rpc bridge
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
    getModuleFragment.js        — serves a screen after the access check
    stockAdjustment.js, materialIssue.js, grn.js, warehouseMovement.js, masterData.js
                                — hand-written modules (the pattern for new modules)
    journal.js                  — JV and CBT (moved out of the generated code)
    partyLedger.js              — vendor/customer tags and bill-wise allocation on JV/CBT lines
    invoiceAllocations.js       — Vendor/Customer Invoice list and reversal wrappers for allocation
    purchaseReturn.js           — Purchase Return / Debit Note (docs/modules/PURCHASE_RETURN.md)
    salesReturn.js              — Sales Return / Credit Note (docs/modules/SALES_RETURN.md)
    partyStatement.js           — Vendor and Customer Statements of Account (docs/modules/VENDOR_SOA.md)
    callable.js                 — onCallWithMessages: shows the real error message to the user
    legacy/                     — GENERATED from Code.gs, never hand-edit (see docs/MIGRATION.md)
  modules/*.html                — the screens, served by getModuleFragment
  test/emulator/*.test.js       — one API suite per module, against the local emulators
  test/ui/                      — headless-browser checks (smoke, dynamic toggle, stock screens, party payments, returns, statements)
tools/
  legacy-port/                  — the Code.gs → Cloud Functions generator (migration only)
  deploy-migration.sh           — deploys pending generated-port functions
  deploy-functions.sh           — deploys a named set (tools/deploy-sets/<set>.txt) for new development
  deploy-runtime.sh             — moves every live function onto engines.node's runtime
  build-soa-screens.js          — writes CUSTOMERSOA.html from VENDORSOA.html (edit only the vendor one)
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
4. **Screen:** `functions/modules/<ID>.html`, calling the server with
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

node --test --test-concurrency=1 functions/test/emulator/*.test.js
node functions/test/ui/smoke.ui.js          # every screen loads cleanly (Admin + Viewer)
node functions/test/ui/dynamicToggle.ui.js  # a real deactivate/reactivate click
node functions/test/ui/partyPayments.ui.js  # after the partyPayments suite: JV/CBT allocation screens
node functions/test/ui/purchaseReturn.ui.js # after the purchaseReturn suite: the Purchase Return screen
node functions/test/ui/salesReturn.ui.js    # after the salesReturn suite: the Sales Return screen
node functions/test/ui/partyStatement.ui.js # after the partyStatement suite: the two SOA screens
```

- **Emulator memory:** the functions emulator keeps a ~100 MB worker for
  each function it has run and never frees them. The full suite plus the
  full smoke run fills Cloud Shell's 16 GB (exit 137). Run the suite in two
  halves and restart the emulators before the smoke run. After a crash:
  `pkill -f '[f]unctionsEmulatorRuntime'`.
- **Hot reload:** the functions emulator doesn't pick up source edits.
  Restart it after changing code, including for negative controls.
- **Safety:** the suites WIPE the emulator database. `_helpers.js` refuses
  to run unless every client points at the local emulators.
- **Last full run** (2026-09-25, `party-statements` branch): 205/205
  emulator tests, 101/101 smoke, 2/2 dynamic toggle, 4/4 each for the
  purchase return, sales return and statements UI checks. The party
  payments UI check passes 2/3 (0/3 on `main` right after an emulator
  restart): its fixed short waits lose to function cold starts, and the
  JV check passes with a longer wait. It's a roadmap follow-up to switch
  it to `waitForSelector` waits like the newer checks.

## Deploying

- **Always from a clean checkout:** `git status --porcelain` must be empty,
  because `firebase deploy` uploads the working copy, not the last commit.
- **Batches of ≤6 functions**, to avoid Cloud Shell connection timeouts.
- **Every new callable needs a public-invoker binding**, since a 2nd-gen
  function doesn't get one automatically:
  `gcloud functions add-invoker-policy-binding FN --region=us-central1 --member=allUsers --gen2 --project=erp1-8f4cd`
- **New modules:** list the functions in `tools/deploy-sets/<set>.txt` and
  run `tools/deploy-functions.sh <set>` (clean-copy check, batches of ≤6,
  retries, the binding for each). Put `getModuleFragment` last when a
  screen changes, so it can't go live before the functions it calls.
- **Generated-port functions:** `tools/deploy-migration.sh` (reads the
  pending list from `tools/legacy-port/status.js`).
- **Hosting (`public/index.html`):** `firebase deploy --project erp1-8f4cd --only hosting`.
  Check first that `grep REPLACE_ME public/index.html` returns nothing.
- **Runtime:** functions run on Node 24 (`engines.node`). After a future
  bump, run `tools/deploy-runtime.sh` from a clean worktree.
- **Verify** with an unauthenticated call. A reply of "Please sign in
  again." comes from the function itself, so it's public and live.
- **Record** every deploy in [docs/DEPLOY_LOG.md](docs/DEPLOY_LOG.md).

## Caching

`firebase.json` sets `Cache-Control: no-cache` on every `.html` file, so a
deployed fix shows immediately. Revisit it once deploys become infrequent.

## The old Apps Script system

Several bugs fixed during the migration are **still live in the Apps
Script system** while it runs. [docs/MIGRATION.md](docs/MIGRATION.md) →
"Deviations from Code.gs" lists each one with the data check to run. In
particular, don't use its "Recalculate Stock Ledger" button (#18).
