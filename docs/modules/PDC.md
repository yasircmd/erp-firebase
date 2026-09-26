# PDC Received and PDC Issued (post-dated cheques)

**Status:** deployed 2026-09-26 · **Roadmap:** [#5](../ROADMAP.md) · **Branch:** `pdc`

## Purpose

Record post-dated cheques when they're received from customers or issued
to vendors, carry them in a PDC clearing account until the cheque date,
then clear them to the bank (or record a bounce or cancellation). The
vendor's and customer's SOA show the cheques still waiting to clear.

## Owner's brief (2026-09-26)

- Two modules, **PDC Received** and **PDC Issued**. Their menu nodes
  already exist in the live tree; they'll be linked with Tree Management
  after deploy.
- On receipt or issue, the entry is between the **PDC clearing account**
  and the **customer or vendor account**. On clearing, it's between the
  **bank** and the clearing account.
- Separate clearing accounts for received and issued, both mapped in
  **Company Master**.
- PDC Issued uses one of our existing bank accounts. PDC Received has the
  bank typed in by hand.
- The vendor and customer SOA show the PDCs still pending clearance.
- Compare with modern ERPs in case something's missing (see below).

## Accounting

| Event | PDC Received (customer) | PDC Issued (vendor) |
|---|---|---|
| Post (receive / issue) | Dr PDC Received Clearing · Cr Customer receivables (party-tagged) | Dr Vendor payables (party-tagged) · Cr PDC Issued Clearing |
| Clear | Dr Bank · Cr PDC Received Clearing | Dr PDC Issued Clearing · Cr Bank |
| Bounce / cancel (before clearing) | Reversal of the post entry: customer owes again | Reversal of the post entry: we owe the vendor again |
| Undo clearing (entered by mistake) | Reversal of the clear entry, back to pending | Same |

- The party line follows the Party Payments rules: it's on the party's own
  control account and is allocated **Against** open invoices or kept as a
  **New Ref** (an advance). So the invoices it settles show as paid from
  the receipt/issue date, and a bounce releases them again.
- The clearing entries touch no party account, so they carry no party
  tag. The SOA gets the pending cheques from the PDC records.
- Every entry is a normal GL entry in `journalEntries`, with its own
  voucher types (`PDCReceived`, `PDCReceivedClear`, `PDCIssued`,
  `PDCIssuedClear`). The JV screen refuses to reverse them (only the PDC
  screen can), and GL Report drill-through opens the PDC screen, as for
  the returns.

## The two banks on a PDC Received

"Manually type bank" means (decision 1):
- **Drawee bank** (the customer's bank the cheque is drawn on): typed in
  as free text, with the cheque number. It's for identifying the cheque.
- **Deposit bank** (our bank account the money lands in): one of our
  existing bank accounts (COA `11…`, as CBT), chosen **at clearing**,
  since the cheque can be deposited into any of our accounts.

On a PDC Issued the bank is our own account, chosen at entry; clearing
always uses that account.

## Document

One document per cheque (one party, one amount).

| Field | Received | Issued |
|---|---|---|
| Company (division, branch, cost/profit center as CBT) | ✓ | ✓ |
| Customer / Vendor | ✓ | ✓ |
| Receipt / issue date (posting date of the first entry) | ✓ | ✓ |
| Cheque date (maturity) | ✓ | ✓ |
| Cheque number | ✓ | ✓ |
| Bank | drawee bank, free text | our bank account (COA `11…`) |
| Amount (company currency only, as the SOA) | ✓ | ✓ |
| Allocations against invoices / New Ref | ✓ | ✓ |
| Reference, description | ✓ | ✓ |
| Replaces (a bounced PDC this cheque replaces) | optional | optional |

**Status:** Draft → PendingApproval (if gated) → **Pending** (posted,
in the clearing account) → **Cleared**, or **Bounced** / **Cancelled**.
Each change keeps its date, the user, and the GL entry it posted.

**Rules (proposed):**
- The cheque date can be before, on or after the receipt date (a current
  cheque is allowed too).
- Clearing date on or after the cheque date, and on or after the
  receipt/issue date.
- A duplicate cheque is refused: same cheque number + drawee bank +
  customer (received), same cheque number + bank account (issued), unless
  the earlier one is Bounced or Cancelled.
- A bounce or cancellation is refused while a New Ref it created is
  allocated by another live entry (the same guard as JV/CBT reversal).
- Posting, clearing, bounce and undo run under the global lock, with the
  allocations re-checked at that moment (Party Payments' rule).

## Screens

`PDCRECEIVED` and `PDCISSUED`, one shared server module (`functions/src/pdc.js`).
- **List:** filters by status, party, cheque-date range and bank. A
  **"Due to clear"** view: Pending cheques with a cheque date up to today
  (overdue in red), totals per bank.
- **Entry:** the fields above, with the Party Payments Allocate dialog.
- **Actions on a Pending cheque:** Clear (date; the deposit bank for
  Received), Bounce (date, reason), Cancel (date, reason). On Cleared:
  Undo clearing. Several Pending cheques can be cleared in one go (same
  date and deposit bank), each still getting its own GL entry.
- Print a PDC receipt / voucher, as CBT does.

## Company Master

Two new optional fields, `PdcReceivedClearingAccountID` and
`PdcIssuedClearingAccountID`, same route as the Purchase Return Variance
Account (generator patch in `tools/legacy-port/patches.js`, hand-kept
screen). Posting is refused with a clear message if the company's field
is empty. Each must be a postable account that isn't a bank account and
isn't any party's control account.

## Vendor and Customer SOA

- The PDC post, bounce and cancel lines already appear as statement rows,
  because the party line is tagged. The clearing doesn't touch the
  party's account, so it doesn't appear as a row.
- New **Pending PDCs** section, as at the statement's end date: every PDC
  posted on or before the end date and not cleared, bounced or cancelled
  by then. Columns: cheque date, cheque no., bank, amount, days to
  maturity (or overdue), document number (links to the PDC).
- Summary line under the closing balance: **"of which by pending PDCs"**
  and **"Balance if pending PDCs bounce"** (closing balance + pending
  PDCs received for a customer; the vendor equivalent). Also on print and
  CSV.

## Compared with modern ERPs

What SAP (bills of exchange / cheque management), Oracle, Odoo PDC,
Tally and the Gulf-region ERPs (Focus, etc.) commonly have, and what this
design does with it:

| Feature | Here |
|---|---|
| Register at receipt, clear on maturity via a clearing account | ✓ (the brief) |
| Bounce with automatic reopening of the invoices | ✓ |
| Cancel / return the cheque to the party before deposit | ✓ |
| Undo clearing | ✓ |
| Maturity list ("due to clear"), batch clearing | ✓ |
| Replacement cheque linked to the bounced one | ✓ (optional link) |
| Duplicate cheque check | ✓ |
| Separate "Deposited" step (cheque in transit account) | Not proposed: clearing is one step (question 6) |
| Bank charges on bounce, recovered from the customer | Not proposed: a separate JV/CBT (question 7) |
| Series entry (e.g. 12 monthly rent cheques at once) | Not proposed now (question 8) |
| Stale cheque warning (validity, often 6 months) | Not proposed now (question 8) |
| Cheque printing on our cheque stock | Not proposed |
| Home-screen reminder of cheques maturing | Question 5 |

## Owner decisions (2026-09-26)

The owner agreed every proposal. The tree nodes are named **PDC Received** and **PDC Issued**.

| # | Question | Decision |
|---|---|---|
| 1 | Received: is the typed bank the **customer's (drawee) bank**, with our deposit bank picked from our bank accounts at clearing? | Yes, as above |
| 2 | Allocation: does a PDC settle invoices **at receipt/issue** (invoice shows paid; a bounce reopens it), or stay a New Ref until cleared? | At receipt/issue, matching the posting |
| 3 | Can a cheque be cleared **before its cheque date**? | No: clearing date ≥ cheque date |
| 4 | Approval gating on posting (Approval Config), as CBT? | Yes, optional per company like the others; clear/bounce/cancel not gated |
| 5 | Home screen task for cheques due or overdue to clear? | Yes, for roles that can post PDCs |
| 6 | A separate **Deposit** step before clearing? | No |
| 7 | Bounce charges: record in the PDC screen, or a separate JV/CBT? | Separate JV/CBT |
| 8 | Leave series entry and stale-cheque warnings for later? | Yes |
| 9 | Roles: as CBT (access: ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; draft: + ACCOUNTANT; post, clear, bounce: ADMIN, FINANCE_MGR)? | Yes |
| 10 | Invoice lists: show "Paid (PDC pending)" while the settling cheque hasn't cleared? | Yes |
| 11 | The existing tree nodes | "PDC Received" and "PDC Issued", linked to `PDCRECEIVED` / `PDCISSUED` |

## Build plan (after the design is agreed)

1. Company Master fields (generator patch, screen, test).
2. `functions/src/pdc.js`: save/delete draft, post, approval decision,
   clear (single and batch), bounce, cancel, undo clearing, list; reusing
   `glWriting`, `partyLedger`, `commitAttempt`, `approvals`, `lock`.
3. Registries: `moduleRegistry.js`, `approvalRegistry.js`, voucher-type
   maps in `journal.js` / `masterData.js`, `treeSeedNodes.js`, Data Reset
   coverage for the new store.
4. Screens `PDCRECEIVED.html` / `PDCISSUED.html` (one generated from the
   other, as the SOA screens).
5. SOA: pending PDCs section and summary lines; invoice list status.
6. Tests: emulator suite (lifecycle both ways, bounce reopening invoices,
   guards, duplicate check, SOA as-at-date) and a UI check; negative
   controls. Then deploy set, deploy, release screens, link in the tree.

## As built (2026-09-26)

**Code**
- `functions/src/pdc.js`: one engine for both directions. Callables:
  `getPdcSetup`, `getPdcOpenItems`, `savePdcDraft`, `deletePdcDraft`,
  `postPdc`, `decidePdcApproval`, `clearPdcs` (one or many),
  `bouncePdc`, `cancelPdc`, `undoPdcClearing`, `getPdcEntries`,
  `getPdcsDueForUser` (Home). Store: RTDB `pdcCheques/{id}`.
- Numbering: `PDR` (received), `PDRC` (its clearing), `PDI` (issued),
  `PDIC` (its clearing), per company and year like the other vouchers
  (`glWriting.js`). A bounce or cancellation takes the next number of its
  post type; undoing a clearing, the next of its clearing type.
- The party line goes through Party Payments' own check
  (`partyLedger.resolvePartyLines`). The screen sends only what the
  cheque settles (Against), and the rest of the cheque becomes one New
  Ref. The check runs again at post, under the global lock.
- Bounce and cancel reverse the post entry (party tag kept, no
  allocations, `PdcEvent` = Bounced / Cancelled), so its allocations are
  released. They're refused on a Cleared cheque and while a New Ref the
  cheque created is settled elsewhere (`assertEntryReversible`).
- Company Master: `PdcReceivedClearingAccountID` and
  `PdcIssuedClearingAccountID` through generator patches (read, validate,
  store). Posting and clearing refuse a clearing account that is missing,
  inactive, a cash/bank account (`10…`/`11…`) or any party's control
  account.
- Registries: `moduleRegistry.js` (permissions as CBT),
  `approvalRegistry.js` (gateable, storage `pdcCheques`), the voucher-type
  maps in `journal.js` and `masterData.js` (JV refuses to reverse a PDC
  entry; GL Report opens the PDC screen), and `treeSeedNodes.js` (fresh
  installs only).
- Data Reset: new category `pdcCheques` (generator patch). Deleting
  single PDC records doesn't remove their GL entries, and deleting GL
  entries doesn't remove the PDC: clear both categories together.
- Invoice lists: `annotateInvoiceOutstanding` adds `PdcPending`, the part
  settled by cheques still Pending. The lists show "(PDC pending)" under
  the payment status, which keeps its old values.
- SOA (`partyStatement.js`): PDC rows are labelled "PDC Received", and
  "PDC Received Bounced" / "… Cancelled" for the reversals. New
  `PendingPdcs` as at the end date: posted on or before it and not
  cleared, bounced or cancelled by then, with their total
  (`PendingPdcTotal`). They appear on the screen, in print and in CSV.
  **Changed 2026-09-26 (owner):** the "of which by pending PDCs" and
  "Balance if pending PDCs bounce" lines were removed. Only the Pending
  PDCs table and its total remain.
- Home: a "Post-dated Cheques Due to Clear" block (`public/index.html`,
  Hosting) for roles with `post` on the module, using the user's local
  date.
- Screens: `PDCRECEIVED.html` is the template. `PDCISSUED.html` is
  written from it by `node tools/build-pdc-screens.js`, so edit only the
  Received file (the UI check fails if they drift apart). The list has a
  "Due to clear" view with totals per bank, and selected Pending cheques
  can be cleared together. Each cheque has an entry form with an
  Allocate table and "Oldest first", a history with a link to each GL
  entry, a print receipt/voucher, and actions for approval, clear,
  bounce, cancel and undo.

**Known gaps**
- Clearing, bounce and undo write the GL entry and then update the
  cheque, without the commit-attempt marker, because the cheque already
  carries its post entry's number. If the second write failed, the GL
  entry would exist with the cheque still showing its old status.
  They run under the global lock, and the gap is the same size as the
  approval path's (Party Payments → Known gaps).
- The duplicate-cheque check at save isn't under the lock. It runs again
  at post, which is under the lock.

**Tests**
- `functions/test/emulator/pdc.emulator.test.js` (6): the received
  lifecycle (post, clear, undo, bounce, invoice reopened, clearing
  account back to zero); issued with a New Ref advance and the cancel
  guard, JV and GL Report guards; validation, duplicates, clearing
  account rules, partial allocation, Company Master save, access;
  all-or-nothing batch clearing and the Home list; approval; statements
  as at three dates for both parties.
- `functions/test/ui/pdc.ui.js` (7): the template check, a received
  cheque with "Oldest first", clearing from the due view, bouncing an
  issued cheque plus the history and drill-through, the Viewer, the
  Customer SOA's pending PDCs, and the Company Master fields.
- Smoke now loads both PDC screens (105/105).
- **Negative control** (2026-09-26, run with the owner's go-ahead after
  the permission guard first refused it): three breaks at once, each
  caught, then restored and the suite green again (6/6).
  1. Clearing before the cheque date allowed → the received-lifecycle
     and batch-clearing tests fail.
  2. Duplicate cheque check off → the validation test fails.
  3. The SOA ignoring when a cheque cleared, bounced or was cancelled →
     the statements test fails.

**Fix 2026-09-26: approving from Home Tasks.** Opening a PDC from Tasks
loads the cheque list and the user's rights in parallel. When the list
came first, the entry was drawn as if the user had no post right, so the
approval banner and action buttons stayed hidden. The screen now redraws
them when the rights arrive. Purchase Return and Sales Return had the
same race and got the same fix. UI check "approval from Home Tasks" (the
rights call is held back on purpose). Negative controls: without the
redraw, that check fails; with an "if they bounce" line put back, the
SOA check fails. Deploy: `tools/deploy-sets/pdc-fixes.txt`
(`getPartyStatement`) with `--screens`.

**Deploy:** 33 functions in `tools/deploy-sets/pdc.txt`, then the
screens, then Hosting:
`tools/deploy-functions.sh pdc --screens` from a clean checkout, then
`firebase deploy --project erp1-8f4cd --only hosting`. After that: set
both clearing accounts in Company Master for each company, and link the
existing "PDC Received" / "PDC Issued" tree nodes to `PDCRECEIVED` /
`PDCISSUED` in Tree Management.
