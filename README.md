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

**At a glance (2026-09-25):** all 46 modules are ported and tested: the
shell, the 4 hand-ported stock modules, and the 42 generated-port modules
in the status table below. 45 are live in production. DATARESET, the
last one, is kept for last because it deletes data, and is committed
but not yet deployed (batch G in the deploy log). All functions run on
Node 24 (moved from Node 20 before its 2026-10-30 shutdown). What else is open:
see "Suggested next step" at the end of this file. The sections below are
in the order the work was done.

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
billed through Vendor Invoice (ported since; see the status table).

Pre-existing quirks in these screens/functions, preserved and disclosed
(not changed):
- User Management: a role with only `access` to USERMGMT can open the
  screen, but listing users requires `write` (Code.gs's
  `getAllFirebaseUsers` calls `requireAdmin_`), so it gets "You do not
  have permission to manage users." — same as the GAS version.
- User Management: deleting a user removes only the ERP profile; the
  Firebase Auth account remains (as the original's own comment says).
- Approval Tracker: `getApprovalHistory` applies no company filter — a
  role with APPROVALTRACKER access sees approval instances for every
  company (document numbers, amounts, approvers). Same as GAS; the rest
  of the system is company-scoped, so this is worth a deliberate
  decision.
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
- Physical Count: reversing a shortfall puts stock back at the item's
  CURRENT average cost, not the cost it was written off at (a surplus is
  likewise removed at current cost). If the average cost moved in between,
  the reversal's GL amount differs from the original's. Both sides of each
  entry still balance. Same as GAS.
- BOM: no company scoping. `getBoms` returns every company's BOMs, and
  `saveBom`/`deactivateBom`/`reactivateBom` don't check that the user can
  access the parent item's company (a component must still belong to
  the parent's company). Any role with BOM access sees and, with
  `write`, edits every company's recipes. Same as GAS. Worth a deliberate
  decision, like Approval Tracker's.
- Job Order Request, company scoping: listing and submit are
  company-checked, but the per-line actions (accept, amendment,
  revise, withdraw, stop, cancel), `deleteDraftJobOrderBatch`, and
  editing an existing draft batch check only the role's capability, so
  they work on another company's lines given the ID.
  `getSalesOrderLineShortfallOptions` checks neither module access nor
  company: any signed-in user can list any company's open Sales Order
  shortfalls. Linked Sales Order lines aren't validated on save. All as
  in GAS.
- Job Order Request, numbering: batch numbers come from a
  read-then-write counter (`generateVoucherNumber_`) and submit takes no
  lock, so two batches submitted at the same moment can get the same
  number. Same race as GAS. Numbering only, no stock or GL effect.
- Production: `getItemCostForProduction` checks only that the caller is
  signed in, not module access or company, so any user can read any
  company's valuation cost for an item. Same as GAS.
- GRN (hand-ported): the `reverseGrn` reversal-of-a-reversal problem
  noted here earlier is fixed (deviation #15) and live since batch F.
- Purchase Requisition, company scoping: listing, submit, close, cancel
  and approval decisions are company-checked. `deleteDraftPurchaseRequisition`
  and editing an existing draft check only the role's capability, so
  they work on another company's draft given its ID. An edit re-checks
  the NEW header's company, so it can also move a draft to a company
  the editor belongs to. `getActiveRequisitionCategories` needs only a
  signed-in user, not module access (on purpose, per its comment).
  All as in GAS.
- Purchase Requisition, numbering: every submit draws a fresh PR number,
  including a resubmission after rejection, so the rejected attempt's
  number is skipped. There's the same no-lock race as Job Order Request
  (two simultaneous submits can share a number). An empty draft saves
  but can't be submitted. There's no value field and no stock or GL
  effect, as designed in GAS.
- Inventory Purchase Requisition: the same company-scoping gaps and
  numbering behavior as Purchase Requisition above. Its lines look an
  item up by `ItemCode` across ALL companies. The item's company isn't
  checked, and if two companies share a code, the last one read wins.
  That's deliberate "any item" per its GAS comment. Line warehouse and
  UOM aren't validated. As in GAS.
- Purchase Order, company scoping: listing, draft create, reopen and
  approval decisions are company-checked. Submit, revise, close, cancel,
  delete and editing an existing draft check only the role's capability.
  `getEligibleRequisitionsForPO` doesn't check that the caller belongs to
  the company it's asked about. As in GAS.
- Purchase Order, lifecycle: source requisitions close at submit, even
  when the PO then waits for approval, and cancelling the PO (allowed
  from any status except Closed/Cancelled, unless goods were received)
  doesn't reopen them. A new requisition is needed. Every submit and
  revision draws a fresh PO number (the rejected attempt's number is
  skipped). The list returns at most 100 entries unless the screen asks
  for `'all'`. The screen's requisition-category lookup is
  `getRequisitionCategories`, which requires Procurement Setup access. As
  in GAS.
- Sales Order: confirm, cancel, claim and release are company-checked.
  `deleteDraftSalesOrder` and editing an existing draft aren't.
  `getPriceListForCustomer` and `getItemPriceOnPriceList` need only a
  signed-in user (no module or company check). The sellable-item picker
  treats any item on ANY price list line (active or not, any company's
  list) as sellable. As in GAS.
- Sales Order, reservations: confirm and claim take no lock, so two
  orders confirmed at the same moment can both reserve the same free
  stock (reservations can exceed on-hand). Same class of race as the
  voucher numbering. Confirm isn't atomic: if a later line fails (an item
  deleted since the draft was saved), reservations already made for
  earlier lines stay Active on a still-Draft order. Cancelling that order
  releases them, but confirming again would reserve those lines twice.
  Items are deactivated, not deleted, in normal use. Cancelling is
  allowed from any status except Cancelled. As in GAS.
- Delivery Note: editing an existing draft and `deleteDeliveryNoteDraft`
  aren't company-checked. If the stock check fails when an approval
  completes (stock moved since submission, or the re-checked ship cap),
  the approval instance is already recorded as Approved while the DN
  stays PendingApproval, with no way to resubmit it. It has to be
  cleared by hand. Physical Count and Production have the same
  shape. As in GAS.
- JV: editing an existing draft isn't company-checked, and saving any
  draft through `saveJournalDraft` stamps `VoucherType: 'JV'`. A CBT
  draft ID passed there becomes a plain JV. A reversal can itself be
  reversed; unlike the stock modules this is harmless here, since a
  reversal swaps Dr/Cr exactly. The approval decision assigns the
  lifetime `TXN-` reference without taking the lock. Posting and
  reversal do take it, so a decision at the same moment as another post
  can duplicate a reference, which is audit numbering only. An account
  deactivated between approval request and final approval isn't
  re-checked when the entry becomes Posted. As in GAS.
- CBT: shares JV's engine and quirks above (post, approval and reversal
  go through the JV callables). Mirror of the JV stamping quirk: saving a
  plain JV draft's ID through `saveCbtDraft` turns it into a CBT voucher.
  Cash vs Bank is decided purely by the ledger account code prefix
  (`10`/`11`), per the COA numbering scheme. As in GAS.
- Vendor Invoice: editing an existing draft and
  `deleteVendorInvoiceDraft` aren't company-checked. The GRN amount is
  recomputed from `Quantity × UnitCost` at save and stored; a later
  change to the GRN wouldn't be reflected. Direct lines don't check the
  account's company restriction. Unlike Delivery Note, a commit failure
  at approval time is rolled back to Rejected (the GAS code already did
  this here and for Customer Invoice). As in GAS.
- Customer Invoice: same draft edit/delete company gap as Vendor
  Invoice. A DN's billed amount is its lines' `Quantity × UnitPrice`
  (the SO price locked at delivery). All DN revenue on one invoice posts
  to the header Cost Center, not each DN line's own. Sales Types are
  checked against the customer's classification only when the type is
  restricted. As in GAS.
- Data Reset: every function requires the role ID to be literally
  `ADMIN`, whatever the permissions matrix says. A custom admin-like role
  gets "Only Admin users can access Data Reset." As in GAS.
- Data Reset, scope: the categories never include Purchase Requisitions,
  Purchase Orders, Sales Orders, Job Orders, reservations
  (`stock/reservations`) or approval instances. Clearing "Stock
  Transactions & Ledger" leaves Active reservations holding stock that
  is no longer on hand. Deleting single records doesn't recalculate the
  ledger. Deleting a reversal entry leaves its original marked as
  reversed. As in GAS.
- Data Reset, speed and locking: clearing "GL Journal Entries" deletes
  its Firestore documents one at a time. A very large collection could
  hit the callable's 60-second timeout, and running it again finishes
  the job. The clear functions take no lock (only Recalculate does, see
  #18), so don't run them while others are posting. As in GAS.

**Remaining modules: generated port (complete, DATARESET last).** Everything
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
  (`google.script.run.fn(token, a, b)` → `rpc.fn({ p1: a, p2: b })`).
  Dynamic calls (`[fnVar](token, a)`, used by the deactivate/reactivate
  buttons, whose targets can have differently-named parameters) become
  `[fnVar]({ __positional: [a] })`; every generated callable accepts
  either named keys or `__positional`.
- Bug fixes go in `tools/legacy-port/patches.js` as documented
  find/replace patches on Code.gs (each must match exactly once), never
  as hand edits to the generated files. (See "Deviations from Code.gs" below.)

### Deviations from Code.gs (generated port)

Real bugs found while porting, fixed as patches in
`tools/legacy-port/patches.js` (owner's standing instruction: fix and
report). Each has a test that fails against the original logic.

1. **Stock Ledger Report ignored transfers into a warehouse, and
   undercounted multi-line transactions** (`getStockLedgerReport`). A
   posted Warehouse Movement stores only its Out side (`WarehouseID` =
   source, `ToWarehouseID` = destination) and the report matched on
   `WarehouseID` only, so a destination warehouse's report never showed
   stock moved in and its closing balance disagreed with the real
   ledger. It also took only the first matching line per transaction, so
   e.g. a GRN with two lines of the same item into the same warehouse
   (live PO-26-03-000001 has exactly that shape) was undercounted. Fixed:
   every matching line counts; a movement line whose `ToWarehouseID` is
   the selected warehouse counts as In. (`stockLedger` suite.)
2. **Material Variance Report doubled reversed production**
   (`getMaterialVarianceReport`). A Production reversal is stored as
   `TransactionType: 'Production'` with Direction Out, and the report
   added every Production line as output — so reversing a run doubled the
   produced quantity and the expected component consumption instead of
   cancelling them, inflating the reported variance. Reversal lines now
   count negatively. (`materialVariance` suite.)
3. **GL Report under-reported header accounts** (`getGlReport`). A
   header (non-postable) account rolled up only its DIRECT children;
   since headers are never posted to, every account under a sub-header
   was silently excluded. The live chart has 3 sub-headers with 6
   postable accounts beneath them. A header now rolls up all
   descendants. (`glReport` suite.)
4. **Cash Flow Statement category resolution stopped one level up**
   (`resolveCashFlowCategory_`). An account under a sub-header with no
   category of its own defaulted to Operating even when an ancestor
   header said Investing/Financing. Now resolves from the nearest
   categorized ancestor. No live misclassification today (the one blank
   live sub-header's parent is blank too). (`cashFlow` suite.)
5. **Reversing a Physical Count reversal re-applied it instead of undoing
   it** (`reversePhysicalCount`). A reversal entry is stored as another
   Physical Count whose lines copy the original's `Variance`, and the
   reversal direction is derived from that `Variance`. The screen offers
   "Reverse Count" on reversal entries too, so reversing one moved stock
   the same way again: count 10 → 6, reverse → 10, reverse the reversal →
   **14** instead of 6, with a matching GL entry. Now refused with "A
   reversal entry cannot itself be reversed." (the wording the invoice and
   Delivery Note modules already use); to redo an adjustment, post a new
   count. **This bug is live in the current Apps Script system.** Any
   Physical Count whose `Reference` is itself a reversal's voucher number
   should be checked against physical stock. (`physicalCount` suite.)
6. **Reversing a Production reversal took the stock out twice**
   (`reverseProduction`). The reversal forces every line to Direction
   Out, and a reversal entry is itself a Posted Production entry the
   screen offers to reverse. So reversing one removed the produced stock
   again instead of restoring it: 20 → post 5 → 25 → reverse → 20 →
   reverse the reversal → **15** (should be 25). It also posted a
   matching GL entry and cut a linked Job Order line's produced quantity
   a second time. Now refused with the same message as #5. **Live in the
   current Apps Script system.** Any Production entry whose `Reference` is
   a Production reversal's number should be checked.
   (`production` suite.)
7. **A posted Physical Count didn't store what it posted**
   (`commitPhysicalCountPosting_`). Its lines kept only the audit fields
   (`CountedQuantity`, `Variance`) and dropped the `Direction`,
   `Quantity`, `UnitCost` and `TotalValue` of the adjustment it actually
   posted. Every stock report reads those fields, and Material Variance's
   own comment says every consumption type stores `Direction`. So a
   count's adjustment read as zero while its reversal, which does store
   them, read in full:
   - Stock Ledger's running balance drifted from the real ledger.
   - Material Variance and Production & Consumption missed count
     write-offs and showed a reversed count as negative consumption
     (e.g. −4).
   - The count list showed every posted count's value as 0.

   Each variance line now also stores what it posted; clean lines are
   unchanged. The readers didn't need changing, so the Stock Ledger and
   Material Variance reports need no redeploy. **Counts already posted
   by the live Apps Script system still have the old shape** and stay
   misread until back-filled; each one's values are recoverable from its
   linked GL entry. That's a one-off data decision, not done here.
   (`physicalCount` and `prodConsumption` suites.)
8. **One requisition could feed two Purchase Orders**
   (`submitPurchaseOrder`). The design says a requisition is pulled into
   one PO and Closed when that PO submits, "so it can never be sourced
   into a second PO by mistake". But submit never checked the
   requisition's status. Two draft POs built from the same Submitted
   requisition could both submit, ordering the same goods twice. A draft
   could also submit after its requisition was Cancelled, or cite a
   requisition ID that doesn't exist, which also skipped the direct-line
   item/category check. Submit now refuses unless every source
   requisition exists, belongs to the PO's company and is still
   Submitted. The error tells the user to remove that requisition's
   lines and save. **Live in the current Apps Script system.** It's worth
   checking whether any PR/IPR number appears in more than one PO's
   `SourceRequisitions`. (`purchaseOrder` suite.)
9. **A PO revision accepted a zero or negative quantity**
   (`reviseAndResubmitPurchaseOrder`). The draft save refuses one, but
   the revision didn't check quantity. A negative line lowered the Total
   that the approval thresholds are resolved against, so a revision could
   skip the higher approval levels. The revision now applies the draft's
   rule. (`purchaseOrder` suite.)
10. **A multi-level PO reopen lost its "reopen" flag after the first
   approval** (`decidePurchaseOrderReopenApproval`). It cleared
   `ReopenRequested` after every decision, including a level-1 approval
   that leaves the request pending. The screen picks the decide function
   from that flag, so level 2's decision went through the ordinary PO
   approval instead. A rejection there left the Closed PO "Rejected":
   editable, re-priceable and renumbered on resubmit, instead of back to
   Closed. The flag is now cleared only once the request resolves.
   (`purchaseOrder` suite.)
11. **A Delivery Note's ship cap was only checked when the draft was
   saved** (`postDeliveryNote` / `commitDeliveryNotePosting_`). Each
   line is capped at min(remaining on the SO line, reserved for it), but
   posting (or approval, possibly days later) never re-checked it. Three
   cases all posted anyway:
   - two drafts against the same SO line, each within the cap alone
   - two lines on one DN pointing at the same SO line
   - a draft whose Sales Order was cancelled after saving

   In each case `DeliveredQuantity` passed `OrderedQuantity` and the
   shipment took free stock, or stock reserved for other orders, with
   COGS booked. The cap is now re-checked, summed per SO line, against
   the live SO and reservations at submit and again at commit. This is
   the "never trust the draft-time snapshot" rule Physical Count already
   follows. **Live in the current Apps Script system.** Any SO line with
   `DeliveredQuantity > OrderedQuantity`, or any delivery against a
   Cancelled SO, is a sign it happened. (`deliveryNote` suite.)
12. **Reversing a delivery after its Sales Order was cancelled locked
   the stock forever** (`reverseDeliveryNote`). The reversal re-reserved
   the returned quantity whenever the SO still existed, so a Cancelled
   SO got a new Active reservation. Nothing can release it: release and
   claim need a Reserved SO, and cancel refuses an already-Cancelled one.
   It now re-reserves only for a Reserved or Partially Reserved SO;
   otherwise the returned stock is simply free. **Live in the current
   Apps Script system.** Check for Active reservations whose source SO is
   Cancelled. (`deliveryNote` suite.)
13. **The JV reversal accepted any GL entry** (`reverseJournalEntry`).
   The JV and CBT screens only offer "Reverse" on their own entries.
   But a direct call with a stock or invoice posting's GL entry ID
   (GRN, Delivery Note, Vendor/Customer Invoice...) reversed the GL
   while leaving the stock and the source document untouched. The source
   module's own reversal stayed available, so the GL could be reversed
   twice. It needed only that module's post right. Now refused with
   "reverse it from that module". (`jv` suite.)
14. **One GRN could be invoiced twice** (`commitVendorInvoicePosting_`).
   Saving a Vendor Invoice draft refuses a GRN already matched to
   another invoice, but posting never re-checked. Two drafts built from
   the same unmatched GRN could both post. The vendor's payable was
   booked twice and GRN Clearing debited twice, and
   `MatchedToInvoiceID` was overwritten by the second. Reversing either
   invoice then unmatched the GRN while the other still claimed it. A
   GRN reversed after the draft was saved was likewise still invoiced.
   Every source GRN is now re-checked at commit (post and approval): it
   must still be a Posted, unreversed GRN of this company and vendor,
   matched to no other invoice. **Live in the current Apps Script
   system.** Check for two posted, unreversed Vendor Invoices listing the
   same GRN in `SourceGRNs`. (`vendorInvoice` suite.)
15. **GRN reversal: two guards the original lacked** (hand-ported
   `functions/src/grn.js`, not a generated patch).
   - **Reversal of a reversal:** a reversal entry is itself a Posted GRN,
     and reversing forces every line Out. Reversing a reversal therefore
     removed the received stock a second time, the same shape as #5/#6.
     This was only caught by the negative-stock guard when no other stock
     existed. It is now refused.
   - **Invoiced GRN:** reversing a GRN already matched to a Vendor Invoice
     left the invoice's payable standing against goods that were sent
     back. It is now refused with "Reverse the invoice first", the same
     guard Delivery Note already has for Customer Invoices.

   **Both are live in the current Apps Script system.**
   (`grnGuards` suite.)
16. **One delivery could be billed twice** (`commitCustomerInvoicePosting_`).
   This is the customer-side twin of #14. The "already matched" check on
   a source Delivery Note ran only at draft save, so two drafts built
   from the same delivery both posted, doubling AR and revenue. A
   delivery reversed after the draft was saved (goods returned) could
   also be billed, and so could a Delivery Note reversal entry itself,
   which is a Posted Delivery Note for the same customer. Every source
   DN is now re-checked at commit. **Live in the current Apps Script
   system.** Check for two posted, unreversed Customer Invoices listing
   the same DN, or any invoice listing a reversed DN or a reversal
   entry. (`customerInvoice` suite.)
17. **Both invoice pickers offered reversed documents and reversal
   entries** (`getEligibleGRNsForInvoice`,
   `getEligibleDeliveryNotesForInvoice`). A GRN or Delivery Note reversal
   is stored as another Posted document of the same type, and neither
   picker excluded those or the documents they reversed. They're now left
   out; the commit re-checks (#14, #16) refuse them anyway.
   (`customerInvoice` suite.)
18. **Data Reset's "Recalculate Stock Ledger" could destroy the ledger**
   (`recalculateStockLedger`). It deletes `stock/ledger` and rebuilds it
   by replaying every Posted stock transaction. Four problems:
   - **Warehouse Movements replayed one-sided.** A posted movement stores
     only its Out lines, so the replay took stock out of the source and
     never put it into the destination. The destination's stock vanished,
     and any later issue from it made the replay fail.
   - **Wrong order.** It replayed in `CreatedAt` order, which is when the
     *draft* was created. A draft saved before the stock it draws on
     existed replayed too early, so WAC came out wrong or the replay failed
     with "insufficient stock". It now uses `PostedAt`, which every
     posting path sets, and falls back to `CreatedAt` only if `PostedAt`
     is missing.
   - **Not atomic.** The ledger was deleted first and rebuilt one
     transaction at a time, so any failure left every balance wiped or
     half-built. The replay now runs in memory, and the ledger is replaced
     in one write only if every transaction replays. A failure names the
     transaction and changes nothing.
   - **No lock.** A posting that ran during the rebuild read a half-built
     ledger. The rebuild now holds the global lock.

   Physical Counts posted before #7, whose variance lines have no
   `Direction`, would be silently dropped from a rebuild, so they're now
   refused by voucher number. Back-fill them first (see #7).

   A movement reversal is replayed as the transfer it records (from
   `FromWarehouseID`), so a rebuild also corrects stock left overstated
   by the live Warehouse Movement reversal bug at the top of this file.
   `computeStockMovement` in `stockMovement.js` gained an optional ledger
   reader for this. Nothing else passes one, so no other module's
   behavior changed. **All four problems are live in the current Apps
   Script system:** running Recalculate there with any posted Warehouse
   Movement loses the destination's stock. (`dataReset` suite; negative
   controls with the one-sided replay and the `CreatedAt` order restored
   were each caught.)

Port-runtime fix (not a Code.gs deviation): `runtime.js` used
`admin.firestore.FieldPath`, which isn't a constructor in this
firebase-admin version — every Firestore query/update through the
generated port would have thrown. Now imported from
`firebase-admin/firestore`, and `runtime.emulator.test.js` tests each
primitive's REST semantics directly.

### Generated-port status (kept current after every module)

<!-- PORT-STATUS:start (generated by tools/legacy-port/status.js — do not edit by hand) -->
| Module | Ported (committed) | Deployed |
|---|---|---|
| UOM | ✅ | ✅ |
| ITEMSUBCAT | ✅ | ✅ |
| ORGUNITS | ✅ | ✅ |
| COMPANYMASTER | ✅ | ✅ |
| CURRENCYCONFIG | ✅ | ✅ |
| ITEMMASTER | ✅ | ✅ |
| COA | ✅ | ✅ |
| VENDORMASTER | ✅ | ✅ |
| CUSTOMERMASTER | ✅ | ✅ |
| PRICELISTING | ✅ | ✅ |
| PROCUREMENTSETUP | ✅ | ✅ |
| SALESINVOICESETUP | ✅ | ✅ |
| ROLES | ✅ | ✅ |
| USERMGMT | ✅ | ✅ |
| TREEMGMT | ✅ | ✅ |
| APPROVALCONFIG | ✅ | ✅ |
| APPROVALTRACKER | ✅ | ✅ |
| STOCKAVAILABILITY | ✅ | ✅ |
| STOCKLEDGER | ✅ | ✅ |
| STOCKVALUATION | ✅ | ✅ |
| INVENTORYVALUATION | ✅ | ✅ |
| MATERIALVARIANCE | ✅ | ✅ |
| GLREPORT | ✅ | ✅ |
| TRIALBALANCE | ✅ | ✅ |
| BALANCESHEET | ✅ | ✅ |
| PROFITLOSS | ✅ | ✅ |
| CASHFLOW | ✅ | ✅ |
| PHYSICALCOUNT | ✅ | ✅ |
| BOM | ✅ | ✅ |
| JOBORDERREQUEST | ✅ | ✅ |
| PRODUCTION | ✅ | ✅ |
| PRODCONSUMPTION | ✅ | ✅ |
| PURCHASEREQUISITION | ✅ | ✅ |
| INVENTORYPURCHASEREQUISITION | ✅ | ✅ |
| PURCHASEORDER | ✅ | ✅ |
| SALESORDER | ✅ | ✅ |
| DELIVERYNOTE | ✅ | ✅ |
| JV | ✅ | ✅ |
| CBT | ✅ | ✅ |
| VENDORINVOICE | ✅ | ✅ |
| CUSTOMERINVOICE | ✅ | ✅ |
| DATARESET | ✅ | **not yet** |

**Next module to port:** (none — all ported)

**Committed but NOT yet deployed** (DATARESET) — deploy these 8 functions (≤6 per `firebase deploy --only functions:a,functions:b,...` batch), then add the public-invoker IAM binding to each, then add the modules to `tools/legacy-port/deployed.json` and rerun this script:

```
getModuleFragment clearDataCategories clearSelectedRecords getCategoryRecords getDataResetCounts getLifetimeAuditCounterValues recalculateStockLedger resetLifetimeAuditCounters
```
<!-- PORT-STATUS:end -->

**Deploy log** (project `erp1-8f4cd`,
[Firebase console](https://console.firebase.google.com/project/erp1-8f4cd/overview);
all deploys from Cloud Shell, by the owner or by the migration session, in
batches of ≤6 with a public-invoker IAM binding for each new function):

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
- **Batch G, prepared 2026-09-25, not yet deployed:** DATARESET, the last
  module (7 callables plus `getModuleFragment`, so the screen appears).
  It includes the ledger-rebuild fix (deviation #18). The change to
  `stockMovement.js` is backward-compatible, so the hand-ported stock
  functions don't need a redeploy. Verified beforehand: 182/182
  emulator tests (in two chunks with an emulator restart between them),
  smoke UI 93/93 (Data Reset loaded as Admin, Viewer and a real `ADMIN`
  user) and dynamic toggle 2/2. To deploy, run
  `tools/deploy-migration.sh`. Only users whose role ID is `ADMIN` can
  use the screen.
- **Rule for every deploy:** `git status --porcelain` must be empty.
  `firebase deploy` uploads the working copy, not the last commit.

**Deploy note (for whoever deploys):** the migration session commits
and pushes each module; the owner deploys from Cloud Shell. Run
`tools/deploy-migration.sh` on a clean checkout of the branch. It refuses
to run if `git status --porcelain` isn't empty, because `firebase deploy`
uploads the working copy, not the last commit. It takes the "not yet
deployed" list above from `node tools/legacy-port/status.js --pending`,
adds the hand-ported helpers the stock and production screens call on
load, and deploys in batches of ≤6 with the IAM binding for each
function, ending `ALL DONE`. There's no list to edit. Afterwards, add the
modules to `tools/legacy-port/deployed.json` and run
`node tools/legacy-port/status.js`.

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
    # 3. Tests, then a negative control per module. Emulators (firebase.json
    #    has an "emulators" block; the Auth emulator is REQUIRED — without it
    #    User Management's create-user test would reach production Auth):
    #    firebase emulators:start --only auth,database,firestore,functions --project erp1-8f4cd
    node --test --test-concurrency=1 functions/test/emulator/*.test.js
    node functions/test/ui/smoke.ui.js        # every ported screen loads cleanly, Admin + Viewer
    #    MEMORY: the functions emulator keeps one ~100 MB worker per function it
    #    has run and never frees them. With 170+ callables, the full suite plus
    #    the full smoke run fills Cloud Shell's 16 GB and the emulator is killed
    #    (exit 137). Restart the emulators between the suite and the smoke run,
    #    and after a crash kill leftover workers: pkill -f '[f]unctionsEmulatorRuntime'
    node functions/test/ui/dynamicToggle.ui.js  # a real [call](...) deactivate/reactivate click
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
- `window.google = { script: { run: rpc } }`, a temporary compatibility shim for fragments that still called `google.script.run`, was **removed** (2026-09-25) once all 46 screens used `rpc`. Smoke UI passed 93/93 without it. As a negative control, a `google.script.run` call added to UOM.html failed the smoke test with `google is not defined`. It goes live with the next Hosting deploy.

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
legacy-gas/                     — reference snapshot of the Apps Script project (Code.js + every screen), the generator's input
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
    *.html                      — the 46 ported screens (google.script.run → rpc), served by getModuleFragment
  test/
    emulator/_helpers.js        — shared guard/fixture/call() for the per-module emulator suites
    emulator/*.emulator.test.js — one suite per module (masters1 covers UOM … CURRENCYCONFIG; stockModules the 4 hand-ported ones)
    ui/stockModules.ui.js       — headless-browser click-through of the 4 hand-ported screens against the emulators
    ui/smoke.ui.js              — every ported screen loads with zero failed calls (Admin + Viewer)
    ui/dynamicToggle.ui.js      — a real deactivate/reactivate click through the dynamic [fnVar](...) call path
tools/
  legacy-port/                  — the generator (generate.js, modules.json, patches.js, hand-args.json, check-shell-deps.js, status.js); dev-time only
  deploy-migration.sh           — deploys the not-yet-deployed ported functions (see Deploy note)
  deploy-runtime.sh             — moves every live function onto engines.node's runtime (see deploy log)
```

## A caching note for whoever deploys this

`firebase.json`'s hosting config sets `Cache-Control: no-cache` on
every `.html` file. That's deliberate for the duration of active
migration — the default CDN caching behavior would otherwise mean a
freshly-deployed module fix isn't visible immediately. Worth
reconsidering once the migration itself has stabilized and deploys
aren't happening multiple times a day.

## Testing approach for every future port

**Current method: real packages against local emulators.** Every ported
module has its own suite in `functions/test/emulator/`, plus the UI checks
in `functions/test/ui/`. The exact commands, including the Auth emulator
requirement and the emulator memory limit, are in step 3 of "To continue
with the next modules" above. The latest full run (batch G) was
182/182 emulator tests, 93/93 smoke UI, and 2/2 dynamic toggle. Each module also needs a
negative control: break the logic on purpose, confirm a test fails, then
restore it.

The API suites seed a fixture that WIPES the emulator database. `_helpers.js`
refuses to run unless every client points at the local emulators, because
Application Default Credentials in Cloud Shell would otherwise reach
production. The first real-package run, for the four stock modules, drove
every call their screens make (GRN → MI → SA → WM, an approval, every
reversal including the Warehouse Movement live-bug regression, GL detail,
description edit, permission refusals). `stockModules.ui.js` clicks through
the real screens via the shell's own `rpc` bridge. Its negative controls
covered the description-edit permission check, the approver-identity check,
the item company filter, `success: true` on `postGrn`, the error-message
wrapper, and one screen call's argument conversion. Each break was caught.

**History: the stub-based tests.** The shell's functions (`getModuleFragment`:
9 cases; `session`/`favorites`/`homeTasks`: 15) and the first stock-module
ports were originally tested against stub `firebase-admin` /
`firebase-functions` packages kept outside this repo, because a real `npm
install` didn't fit in the tool time available back then. The emulator
suites have replaced them. One lesson from that period still applies to
any mock: the first RTDB stub did only exact-key lookups, not real RTDB's
path aggregation. It silently returned empty results, which made two tests
pass for the wrong reason. A wrong mock fails loudly; an *incomplete* one
can quietly return nothing.

## Suggested next step

Every module is ported: the 4 hand-ported stock modules plus 42 generated
ones, DATARESET last. What's left:

1. **Deploy batch G (DATARESET)**: run `tools/deploy-migration.sh` on a
   clean checkout, then add `DATARESET` to `tools/legacy-port/deployed.json`
   and run `node tools/legacy-port/status.js`. See the deploy log.
2. ~~**Node.js runtime**~~ — done: every live function runs on `nodejs24`
   (see the deploy log). Batch G deploys on Node 24 too.
3. **The live Apps Script bugs** flagged at the top of this file and
   marked "Live in the current Apps Script system" under Deviations
   (#5, #6, #8, #11, #12, #14–#16, #18). These need the owner's
   attention as data checks in the running system, separate from this
   migration. Don't run Recalculate Stock Ledger in the Apps Script
   system (#18).
4. **Cleanup**: the `google.script.run` shim is removed in the repo; deploy
   Hosting (`firebase deploy --only hosting`) after batch G is live, then
   merge the working branch into `main`.
5. **Decisions the owner should make about disclosed quirks.** These were
   preserved as in GAS, not fixed. They include the missing company scoping
   in Approval Tracker and BOM, the company gaps in draft edit/delete across
   modules, and the no-lock numbering and reservation races. All are listed
   in the Status section above.
6. **Once deploys slow down:** revisit the `no-cache` hosting header (see
   "A caching note"), and retire the Apps Script project once the owner is
   satisfied with Firebase in production.
