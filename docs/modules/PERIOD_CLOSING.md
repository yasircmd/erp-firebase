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

**Not yet:** the lock itself (posting into a closed month is still allowed
until step 1b), the year-end close (step 2).

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
