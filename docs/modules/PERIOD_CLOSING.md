# Month-End and Year-End Closing (design, 2026-10-11)

**Owner, 2026-10-11:** "Then we go for the month-end and year-end module."
(Roadmap: "Monthly and yearly closing (owner, 2026-09-27): closing moves the
income and expense account balances into one P&L account, so they stop
carrying forward in the Trial Balance's opening.")

## Today

- **No general period lock.** Any user with the right can post into any
  past date. Only some modules lock their own dates: the leave month lock
  (HR), the payroll cut-off day, Retail Sales' return period, and a
  reserved Fixed Assets lock date (`faSettings.LockedThroughDate`, never
  set).
- **No closing entry.** The Balance Sheet works out every profit since the
  start as a computed line, "Retained Earnings (Current Period — not yet
  closed)". The Trial Balance carries the income and expense accounts'
  balances forward for ever, so a new year opens with last year's sales and
  costs in it.
- The Chart of Accounts already has a **Retained Earnings** account
  (310000) in the default chart.
- Fixed Assets depreciation and leave already work on the **calendar year**.

## Proposed: one new module, "Period Closing"

Rights: `access` (see the periods), `close` (close a month or a year),
`reopen` (reopen one, with a reason). Defaults: access for Admin, Finance
Manager and Accountant; close and reopen for Admin and Finance Manager.

### Month-end close (a period lock)

- A grid per company: the months of the year, each **Open** or **Closed**
  (who, when), and the year's status.
- **Close a month:** first a **checklist** for that company and month,
  each item linking to where it is fixed:
  - drafts still dated in the month (JV, CBT, invoices, GRNs, stock
    entries…);
  - documents waiting for approval dated in the month;
  - recurring journals due in the month and not posted;
  - depreciation not run for the month (Fixed Assets);
  - the payroll run for the month not posted;
  - post-dated cheques maturing in the month not yet cleared;
  - sub-ledger checks at the month end: Customer / Vendor Aging against
    their control accounts, stock value against the inventory accounts;
  - the Trial Balance balancing.
- **Closed means locked:** no posting, reversal or edit **dated in a closed
  month**, from any module (every journal and stock movement is checked at
  the one place they are written). The message names the month and says
  who can reopen it. Months close in order (a month can't be closed while
  an earlier one is open).
- **Reopen** (the `reopen` right): with a reason, logged; reopening a month
  reopens the later ones too (so they are checked again when closed).

### Year-end close

- **Close the year** (after its last month is closed): a **Year-End Closing
  entry** dated the last day of the year moves every income, cost of
  sales and expense balance of the year to the company's **Retained
  Earnings** account (a setting per company, default 310000). The year is
  then closed with all its months.
- After it: the next year's Trial Balance opens with nothing on the income
  and expense accounts; the Balance Sheet's "not yet closed" line shows
  only the new year's profit; Retained Earnings holds the past years'.
- **Reports keep the closed year readable:** the P&L leaves the closing
  entry out (otherwise the closed year's P&L would show zero), and so does
  the Trial Balance when asked "before closing". This touches the P&L
  carried over from Apps Script (a patch through the legacy port, recorded
  in docs/MIGRATION.md).
- **Reopen the year** (the `reopen` right, with a reason): the closing
  entry is reversed and the year's last month reopens.

## Open questions (round 8)

122. **Financial year.**
     - **Calendar year (January–December)** for every company —
       recommended (depreciation and leave already work on it);
     - or a start month set per company.
123. **How strong the month lock is.**
     - **Hard:** nothing dated in a closed month can be posted, reversed or
       changed, from any module, until someone with the right reopens it —
       recommended;
     - or **soft:** a warning, and posting still allowed.
124. **The checklist before closing a month.**
     - **Warnings:** the problems are listed, and the month can still be
       closed after confirming — recommended (a month can't be held up by
       one late draft);
     - or **blocking:** the month closes only when the list is clean.
125. **The year-end closing entry's detail.**
     - **By account and cost center** — recommended: the Trial Balance and
       P&L filtered by cost center also start the new year at zero;
     - or by account only (shorter entry; cost-center reports of the new
       year then show last year's balances in the opening).

## The owner's decisions, round 8 (2026-10-11)

| # | Question | Decision |
|---|---|---|
| 122 | Financial year | **A choice per company: January–December or April–March.** |
| 123 | The month lock | **Hard:** nothing dated in a closed month can be posted, reversed or changed, from any module, until someone with the right reopens it (with a reason). |
| 124 | The checklist | **Configurable** (see 128): an item can warn or block. |
| 125 | The year-end entry | **By account and cost center.** |
| 126 | Where the settings live | **Period Closing → Setup**, per company (financial year, Retained Earnings account, the checklist). Company Master is unchanged. |
| 127 | What follows an April–March year | **Everything:** closing and reports, **and the Fixed Assets depreciation year and the leave year.** |
| 128 | Warn or block | **Per checklist item**, per company: Block, Warn or Off. |
| 129 | Changing the financial year | **Free until the company's first year-end close**, then fixed. |
| 130 | Reversing a document of a closed month | **Allowed**, with the reversal dated in an open month (any date after the locked period); the document itself is not changed, only marked reversed. |
| 131 | Reversing a payroll run or a depreciation run of a closed month | **A warning** that it will be adjusted in the next month (the reversal posts in the next open month, and the correction comes through the next month's run); otherwise reopen the month first. |

## Build plan

The closing itself (steps 1–2) is agreed and can be built now. Step 3
(decision 127) changes two live modules and needs its own short design.

Step 1 is built in three parts, each its own PR:
- **1a** the module, Setup, the month grid, the checklist, close and reopen;
- **1b** the hard lock at every writer of journals and stock movements
  (one shared check, and a guard test that fails if a writer skips it;
  the Apps Script ports through legacy-port patches), with decision 130:
  reversals dated in an open month;
- **1c** decision 131 for the payroll and depreciation runs (how the next
  month's run carries the adjustment: a short design first).

1. **Period Closing, months:** the module (rights `access`, `close`,
   `reopen`), Setup per company (financial year 122 / 129, Retained
   Earnings account, each checklist item's Block / Warn / Off, 128), the
   month grid, the checklist, close and reopen, and the **hard lock** (123)
   at the one place journals and stock movements are written.
2. **Year-end close:** the closing entry by account and cost center (125)
   to Retained Earnings, the year closed with its months, reopen by
   reversing it; the P&L and Trial Balance leave the closing entry out
   (the ported P&L through a legacy-port patch, recorded in
   docs/MIGRATION.md); "year" in the reports follows the company's
   financial year.
3. **April–March for Fixed Assets and leave (127):** the depreciation
   year (the reducing-balance base resets at the financial year start,
   the year's depreciation limits) and the leave year (entitlements,
   carry-forward and its cap at the financial year end, balances and
   their reports, the leave year close). A design section with the
   questions it raises (e.g. a company switching while it already has
   leave and assets history) comes before that step's code.

## As built: step 1a (2026-10-11)

**Module `PERIODCLOSE`** (General Ledger → Period Closing). Rights:
`access` (Admin, Finance Manager, Accountant), `close` (Admin, Finance
Manager; also changes the Setup), `reopen` (Admin, Finance Manager).

- **Months tab:** the company's financial year, twelve months, each Open
  or Closed (who, when), year by year with the arrows. A month can be closed
  once it has ended. The first close may be any ended month (the months
  before it close with it, shown "Closed (before the first close)"); after
  that only the next month after the last closed one.
- **The checklist** (a month's "Checklist and close"): it covers the period
  since the last closed month (for the first close: everything up to the
  month's end). Each item shows its mode, OK / Warning / Blocks / Off, and
  its findings, each with **Open** to the module where it is fixed:
  - drafts (Draft or Rejected) and documents waiting for approval, dated in
    the period: journals and CBT, stock documents (GRN, issues, production,
    movements, adjustments, counts, delivery notes, returns), vendor and
    customer invoices, PDCs, fixed asset postings;
  - recurring journal dates due and not posted;
  - depreciation: an asset in use by the month's end and the last run before
    the month;
  - payroll: active employees and no posted run for the month;
  - PDCs matured by the month's end and still pending;
  - Customer / Vendor Aging against their control accounts at the month's
    end (the aging report's own GL check);
  - stock value (Inventory Aging's) against each inventory account at the
    month's end;
  - the Trial Balance: debits equal credits (an unbalanced entry is named).
- **Close:** asks first (naming the warnings), then logs who and when. An
  item set to **Block** with findings refuses the close (checked again on
  the server).
- **Reopen** (any closed month): the app asks for the reason; the month and
  the later ones reopen, the earlier ones stay closed. Logged.
- **Setup tab:** financial year January–December or April–March (fixed once
  a year-end close exists: step 2), the Retained Earnings account (an
  Equity account; 310000 by default when the chart has it), and each
  checklist item Block / Warn / Off (all Warn at first).
- **Log tab:** every setup change, close and reopen, newest first.

**Not yet:** the year-end close (step 2). The lock came with step 1b
(below).

**Server:** `functions/src/periodClosing.js`; callables `getPeriodClosing`,
`savePeriodClosingSettings`, `getPeriodClosingChecklist`, `closePeriod`,
`reopenPeriod` (close, reopen and setup under the global lock). Storage:
RTDB `periodClosing/{companyId}` (`Settings`, `ClosedThrough`,
`FirstClosed`, `Closed`, `Log`; `YearsClosed` comes with step 2). The aging
reports' engines (`agingReports.partyAging`, `inventoryAging`) and the
recurring journals' due dates (`recurringJournal.dueDatesBetween`) are
reused, unchanged.

**Tests:** `periodClosing.emulator.test.js` (5: setup and the year grid,
rights, every checklist item found and cleared, close rules, reopen),
`test/ui/periodClosing.ui.js` (5). Ten negative controls, all caught.

**Deploy:** `tools/deploy-sets/period-closing-1a.txt` with `--screens`. In
the app: link a menu node to "Period Closing" (Tree Management).

## Step 1b design: the lock (2026-10-11)

**Where it is checked.** One shared check, `periodLock.assertOpen(company,
date)`, refusing with "Sep-2026 is closed for <company>; a user with the
reopen right in Period Closing can reopen it":
- **every GL entry built by `glWriting`** (all modules' postings and
  reversals, including the Apps Script ports: invoices, delivery notes,
  production, physical count) — one place;
- **JV / CBT** posting, final approval and reversal (`journal.js` writes its
  own entries);
- **Opening Balances** (its own entries);
- **stock movements with no GL entry** (Warehouse Movement posting and
  reversal);
- a **guard test** lists every place that writes journal entries or posts
  stock movements and fails if one does not go through the check (a new
  module that forgets it fails the Deploy workflow's unit tests).

**Decision 130 (reversals):** a reversal is checked on its own date, so a
document of a closed month is reversed with a date in an open month; the
original is only marked reversed. Reversals that are forced onto the
original's date (Opening Balances, Fixed Asset postings and retirements) are
refused while its month is closed.
Payroll and depreciation runs: decision 131, step 1c.

**Approvals:** a document waiting for approval whose date falls in a month
closed meanwhile is refused at the final approval (the message says so);
the approver rejects it so it can be re-dated. (Setting the checklist's
"waiting for approval" item to Block keeps that from happening.)

## Open questions (round 9)

132. **Drafts dated in a closed month.**
     - **Saved and edited freely; only posting (and sending for approval)
       is refused** — recommended: a draft is not in the books;
     - or refused already when saved.
133. **Changes that touch no amount or date on a closed month's entries**
     (attachments, and the Chart of Accounts recode, which renames an
     account code on old entries).
     - **Allowed** — recommended: the books' figures don't change;
     - or refused while the month is closed.
134. **Data Reset (Admin)** deleting entries of closed months.
     - **Allowed** — recommended: it is the Admin's wipe tool for test data;
     - or refused while any month in its range is closed.
135. **The date a reversal of a closed month's document proposes.**
     - **Today** (as now), refused if today's month is closed;
     - or the first day of the first open month.

## The owner's decisions, round 9 (2026-10-11)

| # | Question | Decision |
|---|---|---|
| 132 | Drafts dated in a closed month | **Saved and edited freely; only posting (and sending for approval) is refused.** |
| 133 | Changes that touch no amount or date (attachments, the Chart of Accounts recode) | **Allowed.** |
| 134 | Data Reset (Admin) deleting entries of closed months | **Allowed.** |
| 135 | The date a reversal of a closed month's document proposes | **Today** (as now), refused if today's month is closed; any date in an open month can be entered. |

## As built: step 1b, the lock (2026-10-11)

**Closed means locked.** For a company, nothing dated in a month up to its
"closed through" month is posted, sent for approval or reversed, from any
module. The message names the month and the company and says a user with
the reopen right in Period Closing can reopen it. Another company's months
are not affected; reopening lifts the lock at once.

- **Drafts** (decision 132): saved and edited freely; posting and sending
  for approval are refused.
- **Waiting for approval** when the month closed: the final approval is
  refused; the approver rejects it so it can be re-dated (or set the
  checklist's approvals item to Block).
- **Reversals** (decisions 130, 135): checked on the reversal's own date
  (today by default), so a closed month's document is reversed into an open
  month and the original is only marked reversed. The Vendor and Customer
  Invoice reversal requests, which may wait for approval, check their date
  first. Reversals dated as the original (Opening Balances, Fixed Asset
  postings and retirements) are refused while that month is closed.
  Payroll and depreciation runs: decision 131, step 1c (until then their
  reversal into a closed month is refused: reopen first).
- **Allowed** (decisions 133, 134): attachments, the Chart of Accounts
  recode, Data Reset.

**Where:** `functions/src/periodLock.js` (`assertOpen`,
`assertDocumentOpen`), called from:
- `glWriting.buildStockGlEntry`: every module's GL entry, the Apps Script
  ports included (they write through it);
- `glWriting.assignStockVoucherNumbering`: Warehouse Movement (stock, no GL);
- `approvals.beginApprovalInstance`: every posting module calls it before it
  posts or sends for approval; the document's own date is checked
  (`periodLock.DOCUMENTS` maps the posting modules to their documents);
- `journal.js`: JV / CBT posting, final approval and reversal;
- `openingBalances.js`: its reversal;
- `fixedAssetsCommon.assertFaPostingOpen`: every Fixed Asset posting;
- the ported invoice reversal requests, through two legacy-port patches
  (`period-lock-vendor-reversal`, `period-lock-customer-reversal`).

**Guard:** `functions/test/unit/periodLockGuard.test.js` (run by the Deploy
workflow): each place above still checks; every file that writes journal
entries is listed with how it is covered (a new one fails until it checks
and is listed); every file that posts stock movements goes through a checked
writer.

**Warehouse Movement:** its posting and reversal moved the stock ledger
before numbering, where the lock is checked, so a refused movement would
still have moved stock. Both now number first (a voucher number may be
skipped if the ledger write then fails, as elsewhere); the guard checks the
order in every function that moves the ledger.

**Tests:** `periodLock.emulator.test.js` (8: JV drafts, posting, another
company, reopening; JV reversal into an open month; a final approval after
the month closed; GRN and Warehouse Movement with stock untouched, GRN
reversal; Vendor Invoice and its reversal request; Opening Balances'
reversal; a GRN needing approval not sent; a Warehouse Movement reversal and
an invoice reversal needing approval); the guard (5). Negative controls, all
caught (the JV posting's own check is also covered by the approval step's,
so only the guard sees it removed).

**Deploy:** `tools/deploy-sets/period-closing-1b.txt`: every function (the
check is in shared code). No screens, no Hosting change.

## Step 1c design: payroll and depreciation runs of a closed month (2026-10-11)

**Decision 131:** reversing a payroll or depreciation run of a closed month
warns that it will be adjusted in the next month; otherwise the month is
reopened first.

**Today:**
- A **payroll run's** reversal is dated as the run (the month's last day),
  and the run goes back to Draft so the **same month** is run and posted
  again (HR payroll decision 18). Later runs must be reversed first.
- A **depreciation run's** reversal is dated the period's last day; the
  periods run in order, so after reversing period M the next run is M again.
- Since step 1b, both are refused while their month is closed, and so is the
  re-run.

So "adjusted in the next month" has to cover the re-run too, not only the
reversal.

**Proposed:** when the run's month is closed, Reverse shows: "Sep-2026 is
closed. The reversal will be posted on 01/10/2026, in the first open month,
and the corrected run for Sep-2026 will also post there. Continue? (To keep
it in Sep-2026, reopen the month in Period Closing first.)" On Continue:
- the reversal is posted on the **first open day**;
- the run is redone **for its own month** (the payslips and the asset
  records stay in that month), and its entry is posted on the first open
  day too, with the same warning;
- the run, its history and the GL entries say "adjusted in Oct-2026".

## Open questions (round 10)

136. **After the reversal.**
     - **The run is redone for its own month and posted in the first open
       month** (as above) — recommended: payslips and asset records stay
       in the right month; the GL shows the correction in the open month;
     - or the closed month's run is not redone: the correction is entered
       in the next month's own run (payroll: arrears / Earnings & Deductions;
       depreciation would need a change to its run order).
137. **The date of the adjustment.**
     - **The first day of the first open month** — recommended;
     - or today;
     - or chosen by the user (any date in an open month).
138. **Other payroll postings dated as their original** (payroll payments,
     final settlements, loan payouts, provisions):
     - **the same treatment** (warning, posted in the first open month) —
       recommended, one rule for payroll;
     - or only the runs; the others need the month reopened.
139. **Who can do it.**
     - **Whoever can reverse the run today** (Payroll post, Depreciation Run
       reverse) — recommended;
     - or also needs Period Closing's reopen right.

## The owner's decisions, round 10 (2026-10-11)

| # | Question | Decision |
|---|---|---|
| 136 | After reversing a closed month's run | **The run is redone for its own month and posted in the first open month**, as the reversal. |
| 137 | The adjustment's date | **The first day of the first open month.** |
| 138 | Other payroll postings dated as their original (payments, settlements, loan payouts, provisions) | **The same treatment.** |
| 139 | Who can do it | **Whoever can reverse it today.** |

## As built: step 1c (2026-10-11)

**A payroll or depreciation posting of a closed month** (decisions 131,
136-139): its reversal is dated as the original, so it would be refused.
Instead the screen shows the server's offer in the app's own dialog:
"Jul-2026 is closed for <company>. It can be adjusted in the first open
month: it is posted on 01/08/2026 (the run or document keeps its own
month). Continue to adjust it there, or reopen Jul-2026 in Period Closing
first." Cancel changes nothing; Continue posts it on the first day of the
first open month.
- **Payroll run:** reversed there, back to Draft for its own month, marked
  "adjusted"; its redo (submit, approval, posting) posts there too without a
  second question. The history notes the date.
- **Depreciation run:** reversed there (the asset records keep the period
  and its last day); the period's redo posts there too.
- **Final settlement:** as a run (reversed, then redone there).
- **Payroll payments, interim payroll payments, loan payouts, provision
  claims** (decision 138): their reversals the same way.
- **Rights** (139): unchanged — whoever can reverse it today.
- Other reversals are not adjustable: they take a date in an open month
  (decision 130). A month reopened meanwhile posts on the original date.

**How:** `periodLock.adjustableDate` (the offer, or the first open day);
the GL writer applies it only to payroll and depreciation voucher types
(`periodLock.ADJUSTABLE_TYPES`) when the entry is a reversal or the redo of
a run reversed that way (`AdjustableRedo`), and records `AdjustedFromDate`
on the entry. The user's Continue is the request's `adjustInOpenMonth`:
`callable.js` runs every callable in that context, so a reversal reached
several calls deep (an interim batch undoing its payments) sees it. The
screens (Payroll, Final Settlements, Interim Payroll, Loans & Advances,
Provisions, Depreciation Run) ask and send again.

**Tests:** `periodAdjust.emulator.test.js` (3: payroll run reversed and
redone; payroll payment reversal, a JV reversal not adjustable, a reopened
month; depreciation run reversed and redone), the settlement in
`payrollSettlement.emulator.test.js` (1 more), `test/ui/periodAdjust.ui.js`
(2: the warning, Cancel; Continue). Negative controls, all caught.

**Deploy:** `tools/deploy-sets/period-closing-1c.txt` with `--screens`:
every function (the callable wrapper and the GL writer are shared). No
Hosting change.

## Step 2 design: the year-end close (2026-10-11)

Agreed already: the entry by account and cost center (125) to the
company's Retained Earnings account (126), the financial year January or
April (122, fixed after the first year-end, 129), reopening the year
reverses it.

**Close the year** (Period Closing → Months, the year's line; the `close`
right), once every month of the financial year is closed:
- a **Year-End Closing** entry (voucher type `YearEndClose`, number
  YEC-…) dated the year's last day: for each income, cost of sales and
  expense account (types Revenue, COGS, Expense) and cost center, the
  opposite of its balance at that date; the total to Retained Earnings by
  cost center. It zeroes every such balance at the year end, so a first
  year-end also carries the years before it into Retained Earnings;
- the year is marked closed (who, when, the entry); its months stay
  closed. The entry is the one posting allowed into a closed month (it is
  the system's, made by the close itself).
- **Reopen the year** (the `reopen` right, with a reason): the entry is
  reversed on the same date and the year shows open; its months stay
  closed until reopened one by one. Logged, as months are.

**Reports:**
- **Profit and Loss** leaves the closing entry out, so a closed year's P&L
  still shows its figures (a legacy-port patch, recorded in
  docs/MIGRATION.md).
- **Trial Balance**: a switch "Before year-end closing" leaves it out
  (the closing entry is included by default: the real balances).
- **Balance Sheet**: unchanged; after the close Retained Earnings holds the
  past years' profit and the "not yet closed" line shows only the new
  year's.
- **Cash Flow**: unchanged (the entry has no cash, so it never counts).
- **GL Report**: shows the entry like any other.
- The P&L and Trial Balance screens propose the company's financial year
  as the default period.

## Open questions (round 11)

140. **The closing entry's detail:** by account and cost center (125); also
     **by profit center** — recommended, so P&L by profit center also starts
     the new year at zero — or not.
141. **The Trial Balance's default:** **with the closing entry** (the real
     balances; a switch to see the year before closing) — recommended — or
     without it by default.
142. **The new year's months before the year-end close:**
     - **can be closed** (the year-end often waits for the audit) —
       recommended;
     - or only after the year is closed.
143. **Reopening a month of a closed year:**
     - **refused until the year is reopened** — recommended (the closing
       entry would no longer match);
     - or reopening the month reopens the year too (its entry reversed).

## The owner's decisions, round 11 (2026-10-11)

| # | Question | Decision |
|---|---|---|
| 140 | The closing entry's detail | **By account, cost center and profit center.** |
| 141 | The Trial Balance's default | **With the closing entry**; a switch shows the year before closing. |
| 142 | The new year's months before the year-end close | **Can be closed.** |
| 143 | Reopening a month of a closed year | **Refused until the year is reopened.** |

## As built: step 2, the year-end close (2026-10-11)

**Months tab, the year's line:** Year open (and what is missing: its
months, a later year closed, the year before it) or Year closed (who,
when, the closing entry).
- **Close the year** (the `close` right), once its twelve months are closed:
  the app asks first, naming the date and the Retained Earnings account.
  The **Year-End Closing** entry (`YearEndClose`, YEC-…) is dated the
  year's last day: for every income, cost of sales and expense account (any
  status), cost center and profit center, the opposite of its balance at
  that date, the total to Retained Earnings by cost center and profit center
  (125, 140). A first close also carries the years before it. It is the one
  posting into a closed month (written by the close itself, not the shared
  writer, so a line with no cost center or an inactive account is closed
  too).
- **Years close in order:** not one before a later closed year, and after
  the first, not with the year before it open. The new year's months close
  meanwhile (142).
- **A month of a closed year** is not reopened until the year is (143).
- **Reopen the year** (the `reopen` right, a reason): the entry reversed on
  the same date; logged. The financial year is fixed while any year is
  closed (129).
- The JV screen refuses to reverse the closing entry ("posted by
  YearEndClose — reverse it from that module").

**Reports:**
- **Profit and Loss:** the closing entry left out (legacy-port patch
  `pl-without-year-end-close`; recorded in docs/MIGRATION.md).
- **Trial Balance:** "Before year-end closing" leaves it out; by default it
  is in (141). The period label says so.
- **Balance Sheet, Cash Flow:** unchanged (Retained Earnings holds the past
  years; the entry has no cash).
- **P&L and Trial Balance** propose the company's financial year as the From
  date (`getFinancialYearStart`; "All" companies: the calendar year), until
  the user picks a date or arrives from another report with one.

**Server:** `periodClosing.js` (`closeFinancialYear`,
`reopenFinancialYear`, `getFinancialYearStart`; the year in
`getPeriodClosing`; `reopenPeriod` refusing within a closed year),
`trialBalance.js` (the switch), `glWriting` (the YEC prefix, finance
transaction reference), `masterData` / `journal.js` (the voucher type's
module), `numbering.js` (its label). The guard lists `periodClosing.js` as a
journal writer.

**Tests:** `yearEnd.emulator.test.js` (3: the close, its entry and the
reports; the months, reopening the year; the financial-year default and an
April year), `test/ui/yearEnd.ui.js` (2), `trialBalance.ui.js` updated (the
default From). Negative controls, all caught.

**Deploy:** `tools/deploy-sets/period-closing-2.txt` with `--screens`.
