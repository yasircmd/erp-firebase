# Recurring Journal Entries

**Status:** deployed 2026-09-27, with the change "Spread by service period" · **Roadmap:** [#7](../ROADMAP.md) · **Branch:** `worktree-recurring-journal-entries`

## Purpose

Set up a journal entry once and have the system post it on a schedule for
a fixed period, instead of keying the same JV every month. Typical uses:

- **Prepaid expense to expense:** a year's rent or insurance paid up
  front, released monthly (Dr Rent Expense · Cr Prepaid Rent).
- **Advance to expense:** an advance (e.g. to an employee or contractor)
  charged to expense over the months it covers.
- **Fixed monthly provisions / accruals:** end-of-service benefits,
  bonus, audit fee, utilities accrual (Dr Expense · Cr Provision).

## Owner's brief (2026-09-27)

- New module **Recurring Journal Entries**. Its node is already in the
  module tree under FI; it gets linked with Tree Management after deploy.
- An entry can run on the **1st of every month**, at **month end (EOM)**,
  on **any date**, or on **any weekday**, for a **specific period**.

## How it compares with other ERPs

SAP (FBD1 recurring entry + F.14 run), Oracle (Recurring Journals),
Dynamics (periodic journals), Odoo (deferred expenses), Tally (scheduled
vouchers) all use the same shape: a **template** (lines + schedule +
period) and a **run** that turns each due date into a real posted entry.
Odoo's deferred expense also offers "spread a total evenly", which is the
prepaid case exactly. This design follows that shape.

## The document: a recurring template

One template per recurring entry. Numbered `RJT-<company>-<year>-<seq>`
when activated (drafts have an internal ID, as JV).

| Field | Notes |
|---|---|
| Company, division, branch, cost center, profit center | As JV (header defaults; lines can override cost/profit center) |
| Description, reference | Copied onto every generated entry. Description may use `{MONTH}` / `{DATE}` (e.g. "Rent {MONTH}" → "Rent Oct-2026") |
| Lines | Account, Dr/Cr, amount, line description, cost/profit center, exactly as JV. Balanced, at least two lines |
| Amount mode | **Fixed** (the lines' amounts every run) or **Spread a total** (question 3) |
| Schedule | See below |
| Period | Start date, and an end date **or** a number of runs |

### Schedule

| Frequency | Parameter | Example |
|---|---|---|
| Monthly, on day N | day 1–31 | 1 = "1st of every month"; 15 = "15th". A day past the month's end (31 in Feb) runs on the last day |
| Monthly, month end (EOM) | – | 31 Jan, 28/29 Feb, 31 Mar … |
| Weekly, on a weekday | Mon…Sun | every Thursday |
| Monthly, on the Nth weekday | first/second/third/fourth/last + weekday | last Friday of each month (question 2) |

Plus **every N** (every 1, 2, 3… months or weeks), which also gives
quarterly (every 3 months) and yearly (every 12). The screen shows the
full list of run dates before activation, with the amount of each.

### Status

Draft → PendingApproval (if gated) → **Active** → **Completed** (all runs
posted), or **Paused** (resumable) / **Ended** (stopped early, no more
runs). A Draft or Rejected template is editable. An Active or Paused one
can change only its future (question 6).

## Runs: turning a due date into a posted entry

Each run date becomes one normal GL entry in `journalEntries`, voucher
type `RecurringJV`, numbered `RJV-…` per company and year (the usual
voucher numbering), dated **the run date**, with `RecurringTemplateID`
and `RecurringRunDate` on it. It appears in GL Report, Trial Balance and
the statements like any JV; GL Report drill-through opens the recurring
screen.

The template keeps a run log: date, amount, status (Posted / Failed /
Skipped / Reversed), the entry posted, and the error if it failed.

**Rules (proposed):**
- **Exactly once:** a run is keyed by template + run date and posted
  under the global lock with a commit-attempt marker, so a retry or two
  overlapping triggers never post the same date twice.
- **Re-validated at each run** against the live COA (account still
  active, company restriction), as JV posting does. A run that fails is
  logged as Failed with the reason, doesn't stop later runs, and can be
  retried from the screen once fixed.
- **Catch-up:** a template whose start date is in the past has its
  missed run dates due as soon as it's active; Post Due Runs posts each
  with its own date (see the next section).
- **Reversal** of a posted run is done from this screen (a normal
  reversal entry; the run shows Reversed). The JV screen refuses it, as
  it does for PDC and the returns. A reversed run can be posted again.
- **Skip** a single future date (e.g. no provision in a month) without
  ending the template.

## How runs get posted (decided: by hand)

**Owner's decision (question 1): C, manual.** No scheduler. An Active
template's dates become **due** on their date ("today" in Asia/Dubai,
decided by the server), and a user with post rights posts them with
**Post Due Runs**: on the list (every active template) or on one
template. A Home task, "Recurring Journal Entries Due to Post", lists the
templates with runs due or failed. Catch-up is the same button: a
template whose start is in the past has its past dates due at once, each
posted with its own date.

## Vendor / customer lines (question 4)

A line on a vendor's or customer's control account must name the party
(Party Payments). Proposed for now: such lines are **allowed with a
party tag, posted as a New Ref** each run. Settling against invoices
automatically (Against Ref) is left out, since the right invoice isn't
known in advance. The prepaid/advance/provision cases normally use
non-party accounts anyway (an employee or contractor advance account,
prepaid, provision).

## Approvals and permissions

- Approval Config can gate **activating** a template (optional per
  company, like JV). Runs aren't gated.
- Roles as JV: access ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; draft +
  ACCOUNTANT; activate, pause, end, skip, retry, reverse: ADMIN,
  FINANCE_MGR.

## Screen

`RECURRINGJV`, server module `functions/src/recurringJournal.js`.
- **List:** templates with status, frequency, next run date, runs
  posted / total, amount per run; filters by company and status.
- **Entry:** header and lines as the JV screen, schedule and period
  pickers, amount mode, and a live **schedule preview** (date + amount of
  every run, total).
- **Run log** per template with a link to each posted entry, and actions
  Retry, Reverse, Skip.
- Actions on the template: Activate (post), Pause/Resume, End.

## Owner decisions (2026-09-27)

| # | Question | Decision |
|---|---|---|
| 1 | How are runs posted: automatic, as drafts, or manual? | **Manual:** "Post Due Runs" button and a Home task (proposal was automatic) |
| 2 | Schedules: monthly day N, EOM, weekly weekday, plus "Nth weekday of the month" (e.g. last Friday) and "every N months/weeks"? | Yes, all of them |
| 3 | Amount: besides a fixed amount per run, a **"spread a total"** mode (e.g. 12,000 prepaid over 12 runs → 1,000 each; rounding difference on the last run)? | Yes, both modes |
| 4 | Vendor/customer control-account lines: allowed as New Ref only, or not allowed? | Allowed, New Ref only |
| 5 | Time zone for "today"? | **Asia/Dubai** |
| 6 | Editing an active template: allow changing lines/amounts/end date for future runs (posted runs untouched), or only Pause/End and create a new one? | Allow, future runs only, with the change logged |
| 7 | Catch-up of past dates on activation (with confirmation)? | Yes |
| 8 | Voucher type: own `RecurringJV` / `RJV-…` numbers (separate list, JV refuses to reverse), or plain JV numbers? | Own type `RJV` |
| 9 | Approval gating on activation; roles as JV? | Yes |
| 10 | Home task for Failed runs (and, with option C, due runs)? | Yes |
| 11 | Tree node name and module ID | "Recurring Journal Entries" → `RECURRINGJV` |

Questions 2, 4 and 6–11 were agreed as proposed. With the manual choice,
question 7's catch-up needs no separate confirmation: the past dates are
simply due, and the user posts them.

## Build plan (after the design is agreed)

1. `functions/src/recurringJournal.js`: schedule engine (run dates,
   spread amounts; pure functions, unit-tested), save/delete draft,
   activate (+ approval decision), pause/resume/end, skip, post due runs
   (shared by the button and the scheduler), retry, reverse, list.
   Store: RTDB `recurringJournals/{id}`; entries in `journalEntries`.
2. The daily scheduled function (option A), under the global lock.
3. Registries: `moduleRegistry.js`, `approvalRegistry.js`, voucher maps
   in `journal.js` / `masterData.js`, `treeSeedNodes.js`, Data Reset.
4. Screen `screens/RECURRINGJV.html`; Home task.
5. Tests: schedule unit tests (EOM, Feb/leap year, day 31, Nth weekday,
   every N, end date vs count), an emulator suite (activate, catch-up,
   exactly-once under a double trigger, failure and retry, skip,
   reversal and re-post, pause/end, edit of future runs, access,
   approval), a UI check, smoke, and negative controls.
6. Deploy set, deploy, bindings, release the screen, link the tree node.

## As built (2026-09-27)

**Code**
- `functions/src/recurringSchedule.js`: the pure engine. Run dates for
  each frequency (day N clamped to the month's end, EOM, weekly, Nth or
  last weekday, every N, end date or count, at most 240 runs), the
  schedule's wording, `{MONTH}`/`{DATE}`/`{YEAR}`, "today" in Asia/Dubai,
  and the spread installments.
- `functions/src/recurringJournal.js`: callables `getRecurringJournalSetup`,
  `getRecurringJournals`, `getRecurringJournal` (also takes a run's GL
  entry ID, for GL Report and SOA drill-through), `previewRecurringJournal`,
  `saveRecurringJournalDraft`, `deleteRecurringJournalDraft`,
  `activateRecurringJournal` (activate, resubmit, resume),
  `decideRecurringJournalApproval`, `pauseRecurringJournal`,
  `endRecurringJournal`, `postRecurringJournalRuns`,
  `repostRecurringJournalRun`, `skipRecurringJournalRun`,
  `reverseRecurringJournalRun`, `getRecurringJournalsDueForUser` (Home).
  Store: RTDB `recurringJournals/{id}`, with `Runs/{date}` (the run log)
  and `History`.
- Numbering: templates `RJT-yy-cc-nnnnnn` at first activation; runs and
  their reversals `RJV-yy-cc-nnnnnn` (voucher type `RecurringJV`), per
  company and year.
- **Editing an active template** is Pause → edit → Resume. Resume goes
  through activation again, including the approval gate, so an edit
  can't bypass approval. Edits of a template that has run are logged in
  its History (fields changed, "lines changed"). The period can't drop a
  date already in the log, the company of an activated template can't
  change, and once a spread template has posted runs, its lines'
  accounts, sides and parties are fixed (amounts and the period can
  change).
- **Spread amounts:** what is still unreleased is shared over the open
  dates (not posted, not skipped). The installment is fixed when the
  template is saved, activated or has a date skipped (`SpreadBase`), so
  posting a run doesn't move the rounding: middle runs post the
  installment and the last open date posts exactly what is left. An edit
  or a skip re-spreads what's left over the remaining dates. A spread
  template's last open date can't be skipped while anything is left.
- **Exactly once:** each run is posted under its own acquisition of the
  global lock (a long catch-up never holds it for long), at most 60 runs
  per click. The run is marked Committing before its GL entry is written;
  a run found at Committing is resolved by looking for its GL entry
  (`SourceTransactionID` + `RecurringRunDate`): if it exists, the run is
  marked Posted; if not, it's posted now.
- **Each run is checked like a JV post**, against live data: accounts
  active, postable and allowed for the company, cost center where the
  account type needs one, Fixed Assets' controlled accounts refused,
  vendor/customer lines on the party's own control account (posted as a
  New Ref). A run that fails is logged as Failed with the reason, stays
  due, and doesn't stop the other runs.
- **Reverse** (from this screen only): a mirror entry dated by the user,
  refused while a New Ref it created is settled elsewhere or its lines
  were capitalized to an asset. The date is then Reversed: it waits for
  **Post again** or **Skip**, and isn't picked up by Post Due Runs.
- Registries: `moduleRegistry.js` (permissions as JV),
  `approvalRegistry.js` (gateable, storage `recurringJournals`), the
  voucher maps in `glWriting.js`, `journal.js` (JV refuses to reverse a
  run) and `masterData.js` (GL Report opens this screen),
  `treeSeedNodes.js` (under General Ledger, fresh installs only),
  `partyStatement.js` ("Recurring Journal" rows; the SOA screens open
  them here). Data Reset: new category `recurringJournals` (generator
  patch); its GL entries are in GL Journal Entries, so clear both
  together.
- Screen `screens/RECURRINGJV.html`: list with due counts and **Post Due
  Runs**; entry with header, schedule, amount mode, JV-style lines (with
  the vendor/customer picker on control accounts), a live run-date
  preview, the run log with GL drill-through and Reverse / Post again /
  Skip, and the history. Home: "Recurring Journal Entries Due to Post"
  (`public/index.html`, Hosting).

**Known gaps**
- Posting is by hand, as decided: nothing posts if nobody clicks. The
  Home task is the reminder.
- Reverse, skip and approval write the GL entry (where there is one) and
  then the template, without a commit-attempt marker, as PDC's clearing
  does. They run under the global lock.

**Tests**
- `functions/test/unit/recurringSchedule.test.js` (13): every frequency,
  Feb/leap years, day 31, Nth/last weekday, every N, validation, Dubai
  date, spread rounding and balance, the fixed installment.
- `functions/test/emulator/recurringJournal.emulator.test.js` (5): fixed
  lifecycle (catch-up, exactly once, JV guard, reverse and post again,
  skip, pause/edit/resume with the change log, end); spread (3,333.33 /
  3,333.33 / 3,333.34 and Completed; re-spread after an edit; locked
  accounts; total below what's posted); failed runs and retry, recovery
  of a Committing run both ways; weekly and last-Friday schedules,
  validation, vendor line as New Ref and its SOA row, company access;
  approval of activation and of resume.
- `functions/test/ui/recurringJournal.ui.js` (5), after the suite: a new
  entry typed in with the live preview and activated, approval as from
  Home, Post Due Runs on the list, GL drill-through, reverse and post
  again with the prompts, drill-through by a run's GL entry ID, Viewer.
  Home check (`home.ui.js`) for the new task block; smoke and one-company
  checks include `RECURRINGJV`.
- Related suites rerun green: JV, CBT, Data Reset, Approval Config, GL
  Report, Party Payments, PDC, Tree, Roles, Fixed Assets, Vendor Master,
  Party Statement (and its UI check).
- **Negative control** (2026-09-27): three breaks, each caught, then
  restored and green again.
  1. Posted dates treated as still open → the fixed-lifecycle, spread,
     recovery and vendor tests fail (re-posting, never Completed).
  2. The "not ahead of its date" guard removed → the fixed-lifecycle test
     fails.
  3. The fixed spread installment ignored → the spread test fails
     (3,333.33 / 3,333.34 / 3,333.33).

**Deploy:** 33 functions in `tools/deploy-sets/recurring-journal.txt`,
then the screens, then Hosting, from a clean checkout in tmux:
`tools/deploy-functions.sh recurring-journal --screens`, then
`firebase deploy --project erp1-8f4cd --only hosting`. After that, link
the existing "Recurring Journal Entries" tree node to `RECURRINGJV` in
Tree Management.

## Change 2026-09-27: Spread by service period

**Owner's request:** a prepaid for a service period that starts mid-month
(e.g. 16 Sep 2026 – 15 Sep 2027) must charge the partial first month and
add a run for the partial last month, instead of equal shares.

**Owner's decisions (2026-09-27):**

| # | Question | Decision |
|---|---|---|
| 1 | A partial month's share | **Days in that month:** monthly amount × days the run covers ÷ days in its month. First chosen as "exact days over the whole period"; changed the same day by the owner so the example gives 500 |
| 2 | What the user enters | **Total + service period** (from, to) |
| 3 | When the last partial month posts | **At that month's month end** |
| 4 | Which schedules | **Month end only** |

The monthly amount is the total ÷ the period's length in months (the sum of
each run's share of its month). 12,000 for 16 Sep 2026 – 15 Sep 2027 is
12 months: **500** (16–30 Sep, 15/30), **1,000** for every full month
(February too), **500** (1–15 Sep 2027). A 5 Oct start gives 870.97
(27/31) and 129.03 (4/31); 3,000 for 15 Feb – 30 Apr 2027 (2.5 months)
gives 600 / 1,200 / 1,200.

**As built**
- Amount mode `Period` ("Spread by service period"). The schedule is
  built from `ServiceFrom`/`ServiceTo`: a run at every month end from the
  start month to the end month (`recurringSchedule.periodSchedule`), each
  covering the service days in its month (`periodDays`), weighted by its
  share of that month (`periodWeight` = days ÷ days in the month).
- Amounts: what's left (total − posted) is shared over the open dates by
  those weights, with cumulative rounding per line, each run balanced across
  lines, and the last open date taking exactly what remains. The per-date
  plan is stored (`SpreadBase`, as for Spread) when the entry is saved,
  activated or has a date skipped, so posting a run never moves a cent to
  another date. A skip or an edit re-shares what's left by days.
- Screen: the third amount mode swaps the frequency and start/end pickers
  for Service from / Service to; the run list shows each run's days.

**Tests**
- Unit (3 more, 16 in all): dates, days and month shares for the example
  (12 months), a period within one month, validation; 500 / 1,000 × 11 /
  500, the 5 Oct and mid-February cases, exact totals, balance with
  uneven lines; the stored plan keeping a cent that re-sharing would move
  (1,000: November 83.33, not 83.34); a skipped month re-shared.
- Emulator (6th test): a period from the 16th two months back, 13 month
  ends, the first run's days and amount, total 12,000, the two due runs
  posted with the planned amounts and the rest unchanged, validation,
  preview with days. UI check (6th): the mode's fields and the preview
  for the example. Smoke green.
- **Negative control** (2026-09-27): (1) runs counting from the 1st of
  the month (ignoring the service start) → two unit tests fail; (2) the
  stored plan ignored → the stored-plan test fails; (3) after the switch,
  raw days as weights again (the first rule) → three unit tests fail. All
  restored, green.

**Deploy:** `tools/deploy-functions.sh recurring-journal-period --screens`
(the 15 recurring callables, then the screen). No Hosting change.
