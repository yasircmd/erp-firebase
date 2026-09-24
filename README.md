# ERP: Apps Script → Firebase migration

## ⚠ A live production bug, found during this migration, not caused by it

While porting Warehouse Movement, testing surfaced a genuine data
integrity bug in `reverseWarehouseMovement_`'s own `outLines`
construction — confirmed present in the CURRENT, live `Code.gs`, not
something this migration introduced. Reversing a Warehouse Movement
appears to succeed (no error, transaction marked reversed), but the
destination warehouse's stock is never actually reduced — an object-merge
ordering bug where a stale `WarehouseID` field left over from the
original posting silently wins over the intended, swapped value. The
source warehouse happens to come out correct by coincidence (a second,
unrelated write overwrites the first), which is likely why this hasn't
been caught by normal use — the numbers looked right on one side.

**Practical impact**: any Warehouse Movement reversal in the live
system right now may be leaving the destination warehouse's stock
overstated, silently. Worth checking recent Warehouse Movement
reversals against physical stock if any have happened. This has been
fixed in this migration's own `functions/src/warehouseMovement.js`
(see that file's own comment for the exact trace), but fixing the
still-active `Code.gs` is a separate, live-system concern from this
migration project and hasn't been done here — worth flagging to
Yasir directly as its own priority, not bundled into migration work.

## Status

**The shell is done.** `public/index.html` no longer depends on
`google.script.run` for anything of its own — 9 functions ported and
tested, and the client-side rewrite (auth flow, session handling,
every call site) is complete and verified.

| Function | Replaces | Notes |
|---|---|---|
| `getModuleFragment` | `getModuleFragment` | The access-control gate — ported first specifically to prove this pattern |
| `completeLogin` | `loginWithFirebase` | Client signs in via the Firebase Auth SDK directly first; this checks Corporate ID + builds the session, called right after |
| `restoreSession` | `restoreSession` | Same session-building, no Corporate ID check — for tab restore/reload |
| `getMyTree` | `getMyTree` | Refresh-tree action |
| `getMyFavorites` / `toggleFavorite` | same | Unchanged behavior, 5-favorite limit preserved |
| `getPendingApprovalsForUser` / `getMyRejectedSubmissions` | same | Both bug fixes from earlier this session carried over and re-tested: orphaned documents, and the stale-rejected-after-resubmit issue |
| `getActiveCompanies` | same | Missed in the first port pass — found and fixed while sweeping `index.html`'s remaining call sites; needed for `loadMainCompanyName` |

**Dropped entirely, not ported:** `sendPasswordResetEmail` and
`changeOwnPassword` — both are one-line client SDK calls now
(`sendPasswordResetEmail(auth, email)`, `reauthenticateWithCredential`
+ `updatePassword`), wired directly into `index.html` itself. No
server function needed for either.

**Also done: the lock module.** `functions/src/lock.js` replaces
`LockService.getScriptLock()` with a Firestore-transaction-based
global lock — the exact same GLOBAL (not per-item) scope as today's
behavior, deliberately, plus a staleness fallback GAS never needed
(a crashed Cloud Function has no equivalent of script-execution-ending
auto-release). 11 tests, including a genuine ~10-second real-time
timeout test against the actual deployed constant (not accelerated),
and a verified negative control on the core mutual-exclusion
guarantee. Now genuinely in use — see Stock Adjustment below.

**Also done: the first full module port, Stock Adjustment.** Every
server function ported — save, post, approve/reject, delete, list,
reverse — the first proof that the whole pattern (lock + approval
engine + two-phase commit-attempt marker + atomic ledger write) works
together, not just as separate pieces. Built alongside it, in
`functions/src/`, four shared modules every future stock-module port
will reuse directly rather than rebuild: `glWriting.js`
(`validateAndNormalizeLines_`, `writeStockGlEntry_`, voucher
numbering), `stockMovement.js` (`computeStockMovement_`, plus the
atomic multi-path ledger write — see its own comment on the specific
gap in the original GAS code this closes, not just ports faithfully),
`commitAttempt.js` (the two-phase commit-attempt marker sequence), and
`approvals.js` (the generic approval workflow engine). 28 tests, plus
a verified negative control on the specific behavior this whole
pattern exists to guarantee: that approval actually gates the commit
(bypassing that check was caught with 2 clear failures — nothing
physical should happen, and didn't, until genuinely approved).

**The previously disclosed gap is now closed.** `functions/src/reservations.js`
ports the Sales Order reservation subsystem
(`createStockReservation_`, `getReservationsForSource_`,
`refreshSalesOrderReservationStatus_`,
`allocateAvailableStockToShortfalls_`), and `stockAdjustment.js` now
genuinely calls it for every Increase line, matching the original's
own behavior. 12 tests, including — the one that actually matters
here — posting a real Stock Adjustment Increase against a real,
open Sales Order shortfall and confirming a reservation actually
gets created and the Sales Order's own status correctly flips to
Reserved, not just that the allocation function works in isolation.
Verified with a negative control on that specific integration (the
allocation call itself, not just the underlying function), which
failed with exactly the 2 expected failures when removed.

**Also done: the second full module port, Material Issue.**
`functions/src/materialIssue.js` — save, post, approve/reject, delete,
list, reverse, all 7 functions, reusing every shared module built for
Stock Adjustment with ZERO changes needed to any of them — the
clearest proof yet that the pattern itself, not just this one
module's own code, is what got built. 24 tests, covering the module's
own distinct behavior: the Issue/Return direction toggle and its
opposite GL logic (Issue debits Consumption, Return credits it),
reversing an Issue using its original cost even after WAC has since
drifted, and reversing a Return correctly becoming an Out movement at
current WAC instead. A verified negative control on the opposite-GL-logic
feature specifically — caught immediately by the independent GL
balance check (`Debit 400.00 vs Credit 0.00`), the same way an
earlier negative control on `lock.js` was, which crashed the test
before it could print an explicit failure line rather than failing
silently — worth remembering as a class of "genuine detection, unusual
shape" result, not a sign something's wrong with the test itself.

A pre-existing quirk in the original Code.gs was found and faithfully
preserved, not silently corrected: `postMaterialIssue`'s own approval
preview always computes as `Direction: 'Out'`, even for a Return. The
cost comes out numerically identical either way, but the
insufficient-stock guard that check applies would incorrectly also
constrain a Return's own preview — which should never be
stock-constrained, since a Return adds stock rather than removing it.
Documented in the code itself and in this file, not changed — silently
altering behavior during a migration is its own risk, and this port's
job is fidelity first.

**Also done: the third full module port, GRN.** `functions/src/grn.js`
— save, post, approve/reject, delete, list, reverse, plus
`getEligibleApprovedPOsForGRN` for the client's own PO picker. First
port to exercise genuinely new territory the other two never touched:
matching against Purchase Order lines. 21 tests, including the ones
that actually prove this works — a PO-sourced line's unit cost is
locked server-side to the PO's own price regardless of what the client
sends, posting correctly updates the PO line's own `ReceivedQuantity`,
a PO belonging to a different vendor than the GRN is rejected, and
reversing a GRN correctly rolls that received quantity back. One
worth calling out specifically: reversing a GRN whose received stock
has since been substantially consumed elsewhere (via a Material
Issue) is correctly blocked — not through any special-case logic
written for GRN specifically, but because `computeStockMovement`'s
existing negative-stock guard already protects it automatically, the
same way it protects every other outbound movement. A verified
negative control on the unit-cost-locking feature specifically caught
the bug immediately when the PO's own price was bypassed in favor of
whatever the client sent.

Same reuse story as Material Issue: zero changes needed to
`glWriting.js`, `stockMovement.js`, `commitAttempt.js`, `approvals.js`,
or `lock.js` — now proven across three genuinely different modules,
not just designed to generalize.

**Also done: the fourth full module port, Warehouse Movement.**
`functions/src/warehouseMovement.js` — save, post, approve/reject,
delete, list, reverse. First module with NO GL entry at all (moving
stock between locations within the same company doesn't change total
inventory value), so no two-phase commit-attempt marker either — that
pattern exists specifically to guard a Firestore-GL-vs-RTDB-ledger
disagreement, and there's no GL write here to disagree with. Also the
first to genuinely prove a paired transfer within one transaction: an
Out from the source and an In to the destination, with the
destination's own cost explicitly carried over from the source's
resolved cost rather than independently computed — confirmed by a
dedicated test. 21 tests, including finding and fixing the live
production bug flagged at the top of this file, with a verified
negative control specifically reproducing the original broken
behavior (reverting to the exact original code line) to confirm the
test genuinely catches it, not just this once by coincidence.

Same reuse story again: zero changes needed to `stockMovement.js` or
`commitStockLedgerUpdates`'s own atomic multi-path write, now proven
across four genuinely different modules — this one the first to prove
it against TWO ledger keys updated together in one commit, not just
one.

**The four stock modules' screens now actually work (previously they
didn't open at all).** The commit logic for Stock Adjustment, Material
Issue, GRN and Warehouse Movement was ported earlier, but their screens
never were: `functions/modules/` held no fragment files, so opening any
of them showed "has no fragment file yet". Fixing that surfaced three
more gaps, all now closed:

- **The screens themselves** — the original `STOCKADJUSTMENT.html`,
  `MATERIALISSUE.html`, `GRN.html`, `WAREHOUSEMOVEMENT.html` pulled from
  the live Apps Script project (`clasp clone`), with every
  `google.script.run.fn(token, a, b)` call rewritten to
  `rpc.fn({ name: a, ... })` matching each ported function's own
  argument names. Nothing else in them changed.
- **9 server functions the screens call that were never ported**, now in
  `functions/src/masterData.js`: `getModulePermissionsForUser`,
  `getActiveItems`, `getActiveUOMs` (with its UOM lazy-seed),
  `getActiveOrgUnits`, `getActiveVendors`, `getStockLedgerEntryPublic`,
  `getMyPendingApprovalLevel`, `getJournalEntryDetail`,
  `updatePostedDescription`. Without these no dropdown populated, so no
  line could ever be entered.
- **Return-shape mismatch**: every screen checks `result.success` after
  save/post/approve/reverse, but the ported functions had dropped the
  original's `success: true` — a genuinely successful post would have
  displayed as a failure (inviting a double-post). Restored.
- **Error messages were hidden**: shared logic throws plain `Error`s, and
  Cloud Functions turns any non-`HttpsError` into a bare "INTERNAL" on
  the client — so e.g. a correctly-blocked GRN reversal (insufficient
  stock) told the user nothing. `functions/src/callable.js`
  (`onCallWithMessages`) passes the message through, as the original
  did; all five files above use it.

One deliberate behavior change, at the owner's request: the GRN screen's
PO picker now greys out non-stock PO lines (lines from a category-based
Purchase Requisition, which carry no ItemCode) with the note "non-stock
line – not received via GRN". The GAS version let them be ticked, which
only produced a GRN line that failed on save. Those lines are meant to be
billed through Vendor Invoice (not yet ported).

Pre-existing quirks in these screens/functions, preserved and disclosed
(not changed):
- Stock Adjustment, Material Issue and Warehouse Movement's own reversal
  success alert reads `result.grnNumber` (a copy-paste from GRN), so it
  shows "Reversal posted as undefined." — cosmetic, the reversal is fine.
- Warehouse Movement's screen offers "edit description" on posted moves,
  but a movement has no GL entry to edit, so it answers "Entry not
  found." — same as today's GAS.
- `updatePostedDescription` only updates the GL entry in Firestore, not
  the stock transaction's own Description in RTDB (the list keeps the
  old text); it has no company-access check. `getStockLedgerEntryPublic`
  has no company-access check either. Both as in the original.

**Remaining modules: generated port (in progress).** Everything
after the four stock modules is ported MECHANICALLY rather than by hand:
`tools/legacy-port/generate.js` parses the Apps Script `Code.gs`, takes
exactly the functions each enabled screen calls plus their helper
closure, and emits them VERBATIM (original comments included) into
`functions/src/legacy/codegs.js`, changing only what Node requires:

- I/O primitives — `firebaseDbRequest_`, the `firestore*_` helpers,
  `requireUser_`, `firebaseAuthRequest_` (create-user only),
  `LockService`, `Utilities` — come from `functions/src/legacy/runtime.js`,
  which reproduces their REST semantics on the Admin SDK (undefined
  keys dropped like JSON, PATCH-with-updateMask upsert for
  `firestoreUpdate_`, `_id` on documents, re-entrant per-request script
  lock backed by the SAME Firestore global lock the hand-ported modules
  use).
- Helpers that already have hand-ported shared versions (stock
  movement, GL writing, commit attempts, approvals, reservations,
  permissions, tree/roles seeding) are routed to those modules
  (`MAPPED` in the generator) — one implementation of each.
  `recordApprovalDecision` is deliberately NOT mapped: the original
  returns `{ success, error }`, which its callers rely on.
- Every function that reaches I/O becomes `async`, every call to one is
  `await`ed, and array callbacks that became async are routed through
  `runtime.seq.*` (strictly sequential, like the synchronous original).
  The generator exits non-zero with a WARNINGS list if it meets an async
  callback it can't convert.
- `functions/src/legacy/callables.js`: one callable per screen-called
  function, named as in Code.gs; `request.data` keys are the original
  function's own parameter names. Screens are rewritten to match
  (`google.script.run.fn(token, a, b)` → `rpc.fn({ p1: a, p2: b })`,
  including dynamic `[fnVar](token, ...)` calls).
- Bug fixes go in `tools/legacy-port/patches.js` as documented
  find/replace patches on Code.gs (each must match exactly once), never
  as hand edits to the generated files. (None needed so far.)

### Generated-port status (kept current after every module)

<!-- PORT-STATUS:start (generated by tools/legacy-port/status.js — do not edit by hand) -->
| Module | Ported (committed) | Deployed |
|---|---|---|
| UOM | ✅ | ✅ |
| ITEMSUBCAT | ✅ | ✅ |
| ORGUNITS | ✅ | ✅ |
| COMPANYMASTER | ✅ | ✅ |
| CURRENCYCONFIG | ✅ | ✅ |
| ITEMMASTER | ✅ | **not yet** |
| COA | — | — |
| VENDORMASTER | — | — |
| CUSTOMERMASTER | — | — |
| PRICELISTING | — | — |
| PROCUREMENTSETUP | — | — |
| SALESINVOICESETUP | — | — |
| ROLES | — | — |
| USERMGMT | — | — |
| TREEMGMT | — | — |
| APPROVALCONFIG | — | — |
| APPROVALTRACKER | — | — |
| STOCKAVAILABILITY | — | — |
| STOCKLEDGER | — | — |
| STOCKVALUATION | — | — |
| INVENTORYVALUATION | — | — |
| MATERIALVARIANCE | — | — |
| GLREPORT | — | — |
| TRIALBALANCE | — | — |
| BALANCESHEET | — | — |
| PROFITLOSS | — | — |
| CASHFLOW | — | — |
| PHYSICALCOUNT | — | — |
| BOM | — | — |
| JOBORDERREQUEST | — | — |
| PRODUCTION | — | — |
| PRODCONSUMPTION | — | — |
| PURCHASEREQUISITION | — | — |
| INVENTORYPURCHASEREQUISITION | — | — |
| PURCHASEORDER | — | — |
| SALESORDER | — | — |
| DELIVERYNOTE | — | — |
| JV | — | — |
| CBT | — | — |
| VENDORINVOICE | — | — |
| CUSTOMERINVOICE | — | — |
| DATARESET | — | — |

**Next module to port:** COA

**Committed but NOT yet deployed** (ITEMMASTER) — deploy these 6 functions (≤6 per `firebase deploy --only functions:a,functions:b,...` batch), then add the public-invoker IAM binding to each, then add the modules to `tools/legacy-port/deployed.json` and rerun this script:

```
getModuleFragment deactivateItem getActiveItemSubCategories getItems reactivateItem saveItem
```
<!-- PORT-STATUS:end -->

**Deploy note (for whoever deploys):** Claude Code's permission guard
blocks production deploys from the migration session — including edits
to `tools/deploy-migration.sh`. So the session commits + pushes each
module and lists what's not yet live above; the owner (or a session
allowed to deploy) deploys that list. `tools/deploy-migration.sh`
currently still holds batch 1's list; replace its `FNS=(...)` with the
"not yet deployed" list above and run it (batches of ≤6 + IAM binding per
function, ends ALL DONE), then add the modules to
`tools/legacy-port/deployed.json` and run `node tools/legacy-port/status.js`.

To continue with the next modules (from the repo alone):

    # 1. Apps Script source: a reference snapshot is committed in legacy-gas/
    #    (use it as <clone-dir> below). To refresh it from the live project:
    #    npm i -g @google/clasp && clasp login --no-localhost
    #    clasp clone 16XxfqOGutYnR21N2xVOSzagKP_C3jXPBS3j4DufZ71m4woD_aU1OsFkf   # into a scratch dir
    # 2. Add the "Next module to port" (status table above) to
    #    tools/legacy-port/modules.json — one module at a time, in the table's
    #    order (finance last; DATARESET last of all — destructive)
    (cd tools/legacy-port && npm i && node generate.js <clone-dir>)
    node tools/legacy-port/check-shell-deps.js <clone-dir>   # old-shell globals a screen needs
    # 3. Tests (emulators running), then a negative control per module
    node --test --test-concurrency=1 functions/test/emulator/*.test.js
    node functions/test/ui/smoke.ui.js        # every ported screen loads cleanly, Admin + Viewer
    # 4. node tools/legacy-port/status.js   # refresh the status table + pending-deploy list
    # 5. Commit and `git push` after EVERY module (sessions can be cut off).
    # 6. Deploy per the note under the status table.

A new screen that calls a HAND-ported callable needs that callable's
argument names in `tools/legacy-port/hand-args.json` (the generator
stops and says so).

**What changed in `index.html` itself:**
- Firebase SDK loaded via a small, separate `<script type="module">`, bridged onto `window.__firebaseSdk` — the main script stays a plain (non-module) script on purpose, since dozens of `onclick="..."` attributes throughout this file depend on true globals, which module-scoped declarations aren't
- An `rpc` proxy synthesizes `google.script.run`'s own `.withSuccessHandler().withFailureHandler().method()` chaining on top of `httpsCallable` — every real call site needed only `google.script.run` replaced with `rpc`, dropping the explicit token argument, and remaining args packed into a single object
- `onAuthStateChanged` is now the single source of truth for session state — consolidating what were three separate paths (manual restore, manual logout, cross-tab sync) into one; a `pendingCorporateId` handoff keeps a fresh sign-in (needs the Corporate ID check) and a restored session (doesn't) from racing each other
- `window.google = { script: { run: rpc } }` — a deliberate, temporary compatibility shim. Every OTHER module fragment (all 45, not yet ported) still calls `google.script.run` internally, which doesn't exist at all on a Firebase-hosted page. Without this shim, opening any unported module throws an uncaught `ReferenceError` that takes down the whole page; with it, the same call still fails (no real function behind it yet), but fails the way that module's own existing `.withFailureHandler(...)` already expects — a clean, visible error instead of a crash. Remove once every module has its own real port.

**Not yet started:** every other module — 375 remaining functions
across JV, CBT, GRN, all stock modules, Vendor/Customer Invoice,
Purchase Order, the requisition modules, and their own 44 HTML files.
Opening any of them right now will show a clean "something went
wrong" error via the compatibility shim above, not a working module —
expected, not a bug, given the staged plan.

## Key decisions already made

| Decision | Answer | Why |
|---|---|---|
| Business logic location | Cloud Functions (2nd gen, callable) | Client-direct + Security Rules can't express GL balance checks, WAC recalculation, or the two-phase commit pattern — this needs to stay server-trusted, same as `Code.gs` today |
| Region | `us-central1` | Matches the existing RTDB instance exactly (confirmed from its legacy `.firebaseio.com` domain format) |
| Lock/atomicity | Firestore transaction-based global lock (replaces `LockService`) + RTDB native multi-path `update()` for each commit's own writes | Two different jobs — serializing concurrent commits vs. making one commit's own writes atomic — kept as two separate mechanisms rather than conflated |
| Auth | Firebase Auth client SDK directly | Callable functions get `context.auth` pre-verified by the platform — this also *removes* the manual `accounts:lookup` REST call `requireUser_` did on every single call today, not just relocates it |
| Security Rules | Deny-all on both Firestore and RTDB | Every read/write goes through a Cloud Function using the Admin SDK, which bypasses rules by design. Locking rules down is what actually forces that — otherwise a client could read/write directly and skip every bit of ported business logic |

## Structure

```
firebase.json / .firebaserc     — project config
firestore.rules                 — deny-all (see above)
database.rules.json             — deny-all (see above)
public/
  index.html                    — the real shell, ported and complete (see Status above)
  (the other 45 module HTML files land here as each gets ported)
functions/
  package.json
  index.js                      — every callable function gets exported from here
  src/
    firebaseAdmin.js            — shared Admin SDK init
    auth.js                     — requireUser, moduleHasCapability, ensurePermissionsSeeded
    roles.js                    — DEFAULT_ROLES + ensureRolesSeeded
    tree.js                     — ensureTreeSeeded, buildVisibleTreeList, buildTreeForRole
    treeSeedNodes.js             — TREE_SEED_NODES (202 entries), extracted verbatim
    moduleRegistry.js           — MODULE_REGISTRY + DEFAULT_PERMISSIONS, extracted verbatim
    approvalRegistry.js         — APPROVAL_GATEABLE_MODULES + APPROVAL_MODULE_STORAGE_, extracted verbatim
    getModuleFragment.js        — the module-fragment access-control gate
    session.js                  — completeLogin, restoreSession, getMyTree
    favorites.js                — getMyFavorites, toggleFavorite
    homeTasks.js                — getPendingApprovalsForUser, getMyRejectedSubmissions (both fixes carried over)
    companies.js                — getActiveCompanies (the one missed in the first pass)
    lock.js                     — Firestore-based global lock, replacing LockService.getScriptLock() — now in real use by stockAdjustment.js
    glWriting.js                — validateAndNormalizeLines_, writeStockGlEntry_, voucher numbering — shared by every future stock-module port
    stockMovement.js            — computeStockMovement_, plus the atomic multi-path ledger write (a genuine improvement, not just a port — see its own comment)
    commitAttempt.js            — the two-phase commit-attempt marker sequence (beginCommitAttempt_/abandonCommitAttempt_/finalizeCommitAttempt_)
    approvals.js                — the generic approval workflow engine (resolveRequiredApprovalLevels_, beginApprovalInstance_, recordApprovalDecision, etc.)
    reservations.js             — Sales Order reservation subsystem (createStockReservation_, getReservationsForSource_, refreshSalesOrderReservationStatus_, allocateAvailableStockToShortfalls_)
    stockAdjustment.js          — the first full module port: save, post, approve/reject, delete, list, reverse — proves the whole pattern together, including Sales Order auto-allocation
    materialIssue.js            — the second full module port: same 7 functions, zero changes needed to any shared module — Issue/Return direction toggle, opposite GL logic, both reversal directions
    grn.js                      — the third full module port: save, post, approve/reject, delete, list, reverse, plus getEligibleApprovedPOsForGRN — first to exercise Purchase Order matching, PO cost locking, and PO ReceivedQuantity tracking
    warehouseMovement.js        — the fourth full module port: save, post, approve/reject, delete, list, reverse — first with no GL entry at all, paired Out+In transfer, and a live production bug found and fixed (see the top of this file)
    masterData.js               — the 9 read-side/helper functions the stock screens call on load (dropdowns, permission flags, stock hint, approval banner, GL impact popup, posted-description edit)
    callable.js                 — onCallWithMessages: onCall that shows the user the real error message instead of "INTERNAL"
    legacy/runtime.js           — Admin-SDK re-implementation of Code.gs's I/O primitives (REST semantics), LockService, Utilities, seq.*
    legacy/codegs.js            — GENERATED: verbatim Code.gs functions for the generated-port modules (do not hand-edit)
    legacy/callables.js         — GENERATED: one callable per screen-called Code.gs function
  modules/
    README.md                   — what needs copying here, and why it's a separate copy from public/
    STOCKADJUSTMENT.html, MATERIALISSUE.html, GRN.html, WAREHOUSEMOVEMENT.html — the 4 ported screens (google.script.run → rpc)
  test/
    emulator/stockModules.emulator.test.js — end-to-end, real packages, local emulators (see Testing approach)
    ui/stockModules.ui.js       — headless-browser click-through of the 4 real screens against the emulators
    emulator/_helpers.js        — shared guard/fixture/call() for the per-module emulator suites
    emulator/masters1.emulator.test.js — UOM, ITEMSUBCAT, ORGUNITS, COMPANYMASTER, CURRENCYCONFIG
    ui/smoke.ui.js              — every ported screen loads with zero failed calls (Admin + Viewer)
tools/legacy-port/              — the generator (generate.js, modules.json, patches.js, hand-args.json, check-shell-deps.js); dev-time only
```

## A caching note for whoever deploys this

`firebase.json`'s hosting config sets `Cache-Control: no-cache` on
every `.html` file. That's deliberate for the duration of active
migration — the default CDN caching behavior would otherwise mean a
freshly-deployed module fix isn't visible immediately. Worth
reconsidering once the migration itself has stabilized and deploys
aren't happening multiple times a day.

## Testing approach for every future port

`getModuleFragment` was tested with 9 cases (including the specific
regression this whole approach was chosen to avoid — a role without
`'access'` capability being able to fetch a module's fragment anyway)
and one verified negative control, using stub `firebase-admin` /
`firebase-functions` modules rather than a real `npm install` (the
real packages are large enough that installation exceeded available
tool time in this environment — the stubs cover only the actual API
surface each ported function uses, so it isn't testing against a
fiction, just a minimal one). The `session`/`favorites`/`homeTasks`
tests followed with 15 more, including both approval-related bug
fixes from earlier in the project re-verified as carried over
correctly, plus a negative control on the Corporate ID gate.

One thing worth knowing if you extend these tests yourself: the first
version of the RTDB mock only did exact-key lookups, not real RTDB's
own hierarchical path aggregation (`ref('approvalInstances').get()`
should return every child under that path, not just a literal key of
that exact name) — this silently failed two tests with an
empty-result false negative rather than a crash, which is exactly the
kind of bug worth watching for in mocks generally: a wrong mock fails
loud, but an *incomplete* one can just quietly return nothing. Fixed
in the current stub; the same approach — mock the two
packages' relevant surface, seed a fake RTDB, exercise every
authorization branch, confirm at least one negative control — should
carry through the rest of the port.

**Now also: real-package emulator tests, in this repo.** The standing
"real npm install + emulator" step is done for the four stock modules:

    firebase emulators:start --only database,firestore,functions --project erp1-8f4cd
    node --test functions/test/emulator/*.test.js      # 21 tests, API level
    (cd functions && npm i --no-save playwright && npx playwright install chromium)
    node functions/test/ui/stockModules.ui.js          # 11 checks, real screens

The API test seeds a fixture (it WIPES the emulator database — it
refuses to run unless both clients point at local emulators, since
Application Default Credentials in Cloud Shell would otherwise reach
production), then drives every call the screens make: GRN → MI → SA →
WM, an approval, every reversal (including the Warehouse Movement
live-bug regression), GL detail, description edit and permission
refusals. The UI test runs the screens through the shell's real `rpc`
bridge (sliced from `public/index.html`) and clicks through create →
post, GL impact, description edit, reversal and approve. Verified
negative controls: removing the description-edit permission check, the
approver-identity check, the item company filter, `success: true` on
`postGrn`, the error-message wrapper, and one screen call's argument
conversion were each caught. The auth emulator isn't configured
(`firebase.json` has no emulators block); callables accept unsigned
test tokens in the functions emulator, and `requireUser` reads RTDB, so
it isn't needed.

## Suggested next step

The shell, the lock module, and four full commit-posting pattern
ports (Stock Adjustment, Material Issue, GRN, and Warehouse Movement)
are all complete. `index.html` in `public/` no longer depends on GAS
for anything of its own, and its Firebase config now holds the real
values (`grep REPLACE_ME public/index.html` returns nothing). The four
stock screens work end-to-end against the emulators (see Testing
approach). What's left:

1. **The live production bug flagged at the top of this file** —
   worth Yasir's attention as its own priority, separate from this
   migration.
2. **~~A real `npm install` and emulator test~~ — done for the four
   stock modules** (see Testing approach); the original note follows.
   **A real `npm install` and emulator test**, since every test so far
   ran against stubs (see Testing approach below) — worth confirming
   against the real packages before trusting any of this in
   production. This matters especially for `lock.js`,
   `stockAdjustment.js`, `materialIssue.js`, `grn.js`,
   `warehouseMovement.js`, and `reservations.js`: their tests are
   only as honest as the mock's own Firestore-transaction
   serialization and RTDB tree semantics (documented there), a
   reasonable stand-in but not a substitute for proving it against
   the real thing.
3. **The next module port** — Warehouse Movement was the first with
   no GL entry at all, and needed no changes to any shared module
   either. Production or Physical Count should each go faster still.
   JV and the invoice modules — the highest financial stakes — should
   come last, once the pattern has proven itself across a few more
   lower-stakes modules first.
