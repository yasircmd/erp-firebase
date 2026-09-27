# Recurring Journal Entries

**Status:** design · **Roadmap:** [#6](../ROADMAP.md) · **Branch:** `worktree-recurring-journal-entries`

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
- **Catch-up:** a template whose start date is in the past posts the
  missed run dates (each with its own date) when it's activated, after
  the screen has listed them for confirmation.
- **Reversal** of a posted run is done from this screen (a normal
  reversal entry; the run shows Reversed). The JV screen refuses it, as
  it does for PDC and the returns. A reversed run can be posted again.
- **Skip** a single future date (e.g. no provision in a month) without
  ending the template.

## How runs get posted (question 1 — the main decision)

- **A. Automatic (proposed).** A scheduled Cloud Function runs every day
  at 01:00 (the company's time zone, question 5) and posts every Active
  template's runs dated up to today. Posted by "Recurring (activated by
  <user>)". The approval, if any, is on activating the template, not on
  each run. New infrastructure: the project's first scheduled function
  (Cloud Scheduler, a few cents a month).
- **B. Semi-automatic.** Same daily job, but it creates each run as a JV
  **Draft** for someone to review and post. Safer, but it's back to a
  monthly manual step.
- **C. Manual.** No scheduler: a Home task "Recurring entries due" and a
  "Post due runs" button on the screen.

With A, a "Post due runs now" button is still there (for catch-up and
retries), and a Home task shows Failed runs to roles that can post.

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

## Owner's open questions

| # | Question | Proposal |
|---|---|---|
| 1 | How are runs posted: automatic, as drafts, or manual? | A: automatic posting by a daily scheduled job |
| 2 | Schedules: monthly day N, EOM, weekly weekday, plus "Nth weekday of the month" (e.g. last Friday) and "every N months/weeks"? | Yes, all of them |
| 3 | Amount: besides a fixed amount per run, a **"spread a total"** mode (e.g. 12,000 prepaid over 12 runs → 1,000 each; rounding difference on the last run)? | Yes |
| 4 | Vendor/customer control-account lines: allowed as New Ref only, or not allowed? | Allowed, New Ref only |
| 5 | Time zone for "today" and the daily run? | Ask: e.g. Asia/Dubai, Asia/Riyadh, Asia/Karachi |
| 6 | Editing an active template: allow changing lines/amounts/end date for future runs (posted runs untouched), or only Pause/End and create a new one? | Allow, future runs only, with the change logged |
| 7 | Catch-up of past dates on activation (with confirmation)? | Yes |
| 8 | Voucher type: own `RecurringJV` / `RJV-…` numbers (separate list, JV refuses to reverse), or plain JV numbers? | Own type `RJV` |
| 9 | Approval gating on activation; roles as JV? | Yes |
| 10 | Home task for Failed runs (and, with option C, due runs)? | Yes |
| 11 | Tree node name and module ID | "Recurring Journal Entries" → `RECURRINGJV` |

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
