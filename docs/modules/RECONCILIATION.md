# Reconciliations (design)

Requested 2026-11-01 (owner): "develop a new module for Reconciliations".
The owner chose two kinds: **bank reconciliation** and **GL account
reconciliation**. Vendor statement and customer balance confirmation are
not in scope.

**Status:** all decisions made 2026-11-01. R1 (bank: paste, match,
report) is being built.

## What already exists (from the code)

- **Bank accounts** are Chart of Accounts accounts marked Bank (COA
  `CashBank`, COA_NUMBERING.md). Their movements are posted journal lines
  (Firestore `journalEntries`):
  - each line has `AccountID`, `Debit` and `Credit`;
  - each entry has `JVDate`, `JVNumber`, `Description`, `Reference` and
    `VoucherType` (Bank Receipt or Payment, JV, PDC, payroll payment …).
- **Cheques:** PDCs carry the cheque number (pdc.js). A Cash & Bank entry
  has a free Reference.
- **Approvals:** Approval Configuration and `approvals.js` (the levels,
  Home tasks, the phone card).
- **Posting:** a Cash & Bank entry is posted through `journal.js` (CBT),
  with the period lock.
- The tree has a placeholder node, "Electronic Bank Statement (EBS)
  Reconciliation", under Cash Management.

## Decisions

| # | Decision |
|---|---|
| Q366 | **Kinds:** bank reconciliation and GL account reconciliation (owner, 2026-11-01). |
| Q367 | **The statement:** pasted from Excel/CSV (date, description, reference, debit, credit), or the GL lines ticked by hand against a paper or PDF statement. No bank file formats (owner, 2026-11-01). |
| Q368 | **Matching:** the ERP suggests matches (same amount, close date, a cheque number or reference found); the user accepts them, matches the rest by hand, one to many or many to one (owner, 2026-11-01). |
| Q369 | **A statement line with nothing in the GL** (bank charges, interest, a direct debit): a Cash & Bank entry is posted for it from the reconciliation screen, the account chosen (e.g. Bank Charges), and it is matched at once (owner, 2026-11-01, changed from "list only" the same day). |
| Q370 | **Closing a month:** submitted and approved through Approval Configuration, then locked with its report (statement balance, uncleared items, difference 0); a later change means reopening it, recorded (owner, 2026-11-01; first left to the recommendation, then confirmed). |
| Q371 | **A GL account's balance is explained** by matching its offsetting lines, or by a supporting schedule of items, chosen per account (owner, 2026-11-01, the recommendation). |
| Q372 | **A per-company list of accounts reconciled monthly** (the bank accounts always in it), with each month's status (owner, 2026-11-01, the recommendation). |
| Q373 | **Sign-off through Approval Configuration's levels** (owner, 2026-11-01, the recommendation). |
| Q374 | **Period Closing checks reconciliations** (owner, 2026-11-01): closing a month checks that each bank account's, and each listed GL account's, reconciliation for it is approved; Block, Warn or Off as Period Closing's other checks. Added with R2 (bank: once approval exists) and R3 (GL accounts). |

## Bank reconciliation: the proposal

**Per bank account and month:**

1. **The statement.** Paste the month's statement lines from Excel, or
   type the opening and closing balances only. The pasted lines are kept
   with the reconciliation.
2. **Match.** On the left, the bank account's posted GL lines that are
   not yet matched; on the right, the statement lines.
   - **Suggest** pairs:
     - the same amount on the same side, within a few days;
     - first, those whose reference, cheque number or document number
       appears in the statement text.
   - **Accept** takes the suggestions; matching by hand allows one to
     many and many to one, where the totals must agree.
   - Without a pasted statement, the GL lines are **ticked** as cleared
     by hand.
3. **Unmatched statement lines (Q369):** **Post entry** opens a small
   form, prefilled from the line (date, amount, description). The user
   chooses the account (and a cost centre if it needs one). It posts a
   Bank Payment or Receipt through Cash & Bank's own posting (rules,
   numbering and the period lock), and the new line is matched to the
   statement line.
4. **The report:**

   | | |
   |---|---|
   | Balance per the GL (at the month's end) | |
   | less: payments not yet presented (uncleared GL credits) | |
   | add: deposits not yet credited (uncleared GL debits) | |
   | = balance per the statement | |
   | statement's closing balance | |
   | **difference** | must be 0 to submit |

5. **Submit, approve, lock (Q370).** Once approved, its matches are
   fixed. Reopening is recorded with a reason, and is only possible for
   the latest locked month.
6. **Carried forward:** next month starts from this month's uncleared
   items; GL lines matched stay matched.

- **A foreign currency bank account** is reconciled in its own currency
  (the lines' currency amounts) where the account has one.
- **Data:**
  - Firestore `bankRecs/{id}`: CompanyID, AccountID, Month,
    StatementOpening, StatementClosing, Lines, Status, History.
  - Firestore `bankRecMatches`: one per GL line matched, so a line
    cannot be matched twice.
- **Rights:** access; prepare (paste, match, post entries); reopen.
  Approving is the approval levels'.

## GL account reconciliation: the questions as asked

Asked 2026-11-01; the owner took the recommendations (Q371-Q373 above).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q371 | **How an account's balance is explained** | (a) its offsetting lines matched, the unmatched ones being the balance (clearing, suspense); (b) a supporting schedule of items with notes and attachments adding up to the balance (accruals, prepayments); (c) either, chosen per account | **(c)** |
| Q372 | **Which accounts, how often** | (a) a per-company list of accounts reconciled monthly (bank accounts always in it), with each month's status (not started, in progress, waiting for review, done); (b) any account, on demand | **(a)** |
| Q373 | **Sign-off** | (a) through Approval Configuration's levels, as other documents; (b) one "review" right | **(a)** |

## Build plan (proposed)

- **R1:** bank reconciliation: statement paste, suggested and manual
  matching, ticking by hand, the report, Excel copy.
- **R2:** posting an entry from an unmatched statement line (Q369);
  submit, approve, lock, reopen (Q370); Period Closing's check for bank
  accounts (Q374).
- **R3:** GL account reconciliation (Q371–Q373); the month's status board
  for every listed account; Period Closing's check for them (Q374).

Each step has tests, a Help page in Finance and a What's new entry.

## As built: step R1, bank reconciliation (2026-11-01)

Live 2026-11-01 (PR #203; runs #266 every function and the screens, #267 Hosting).

- **Module:** `BANKREC`, Bank Reconciliation. It sits in the tree under
  Bank & Cash Ledger, and in Help under Finance. Its rights:
  - *access*;
  - *prepare*;
  - *reopen* (added now for R2, so R2 needs no second full deploy).
- **Server (`bankRec.js`, with the pure parts in `bankRecCalc.js`):**
  - `getBankRecSetup`: the company's bank accounts (COA `CashBank`
    'Bank', Active, postable) and its reconciliations;
  - `getBankRec`: one account and month;
  - `saveBankRec`: the balances, rows pasted (added to those kept), the
    matches and the ticks, all checked again on the server;
  - `deleteBankRecDraft`.
- **GL lines:** the account's posted journal lines to the month's end,
  read by company and date. Each line's key is `entryId:index`; its amount
  is debit less credit (money in is positive). A foreign-currency account
  uses `FcDebit` and `FcCredit`.
- **A line cleared by an earlier month's reconciliation** leaves the later
  months. One cleared by a later month stays open, and can't be used here.
- **The balance** counts every line to the month's end, with earlier
  months' cleared lines counted as cleared. A test caught a first version
  that left those lines out of the balance.
- **Matching:** a match's GL lines and statement lines must total the
  same. With GL lines only, they must net to nothing (an entry and its
  reversal). A line can be in only one match, and can't be both matched
  and ticked.
- **Suggestions:** one GL line to one statement line, the same amount
  within 7 days. A reference, document number or cheque number found in
  the statement's text comes first, then the closer date.
- **The paste:** tab separated. Dates as yyyy-mm-dd, dd/mm/yyyy or
  dd-mm-yyyy. Withdrawal and deposit columns, or one signed amount. A
  header row is skipped and unreadable rows are listed. Lines dated
  outside the month are refused.
- **The report:** balance per the ERP, plus payments not presented, less
  deposits not credited, gives the balance per the bank, set against the
  statement's closing balance and the difference.
- **The screen** (`screens/BANKREC.html`):
  - the balances and the paste;
  - the report panel;
  - the suggestions, with Accept;
  - the two lists, with selection totals, Match, Mark cleared and undo;
  - "only what is not yet cleared";
  - Copy;
  - Delete draft.
- **Data Reset:** Bank Reconciliations (transactional, browsable). It
  clears the reconciliations only, not the GL.
- **Tests:**
  - unit/bankRec (3);
  - emulator/bankRec (1): two months, the paste, the suggestion, one to
    many, a reversal pair, ticks, refusals, carry-forward, rights;
  - ui/bankRec (2);
  - the Data Reset counts.
  - Negative controls, each caught and restored:
    - suggestions ignoring the reference (unit);
    - an earlier month's cleared lines shown again (emulator).
- **Deploy:** `tools/deploy-sets/bankrec-r1.txt`, every function
  (moduleRegistry), with `--screens`, then "hosting".

## As built: step R2, bank reconciliation finished (2026-11-01)

Live 2026-11-02 (PR #204; runs #268 functions and screens, #269 Hosting).

- **An entry for a statement line (Q369): `postBankRecEntry`.**
  - It makes a Bank Payment (for a withdrawal) or a Bank Receipt (for a
    deposit), dated as the line, for the account typed, with an optional
    cost centre given by its code.
  - It goes through Cash & Bank's own save and post (`journal.js`
    `saveAndPostCbt`, run in the caller's request), so Cash & Bank's
    rights, rules (a required cost centre, for example), numbering,
    approval and period lock all apply.
  - Once posted, its bank line is matched to the statement line. If it is
    waiting for approval, it is matched once posted.
  - A foreign-currency account's entry is made in Cash & Bank itself,
    with its rate.
- **Submit, approve, lock (Q370): `submitBankRec`, `decideBankRecApproval`.**
  - Submitting needs the statement's closing balance and a difference of
    nothing, and the account's previous reconciled month approved, so the
    months go in order.
  - It is approved through Approval Configuration, as "Bank
    Reconciliation" (the amount is the statement's closing balance). With
    no levels set, it is approved at once.
  - Statuses: Draft, PendingApproval, Approved (locked) and Rejected. A
    Rejected month can be changed and submitted again.
  - Home tasks and the phone card decide it (approvalRegistry and
    approvalCard). The screen opens a month from a task by its id
    (`company__account__month`).
- **Reopen: `reopenBankRec`** (the *reopen* right, with a reason). Only
  the latest locked month of an account can be reopened: one with a later
  month approved or waiting is refused. The month goes back to Draft, and
  its history keeps the reason.
- **Period Closing (Q374):** a new checklist item, "Bank reconciliations
  not approved for the month" (Warn to start, like the others).
  - It covers each of the company's bank accounts with posted entries to
    the month's end whose month isn't approved.
  - Each finding opens Bank Reconciliation, with "Not started" or the
    month's status.
  - Done by `bankRec.checkMonth`, called from `periodClosing.runChecklist`.
- **The screen:**
  - Submit, Approve, Reject and Reopen;
  - a banner (locked, waiting, or rejected with its reason);
  - Post entry on an unmatched statement line;
  - opening a month from Home.
- **Tests:**
  - emulator/bankRec +1 (2): the entry posted and matched, refusals,
    months in order, approval, the lock, reopening only the latest with a
    reason, and the Period Closing finding before and after;
  - emulator/periodClosing: its checks list now includes `bankRec`;
  - ui/bankRec +1 (3): submit and lock, an entry from a statement line
    (the expense's required cost centre given), submit, reopen.
  - Negative controls, each caught and restored:
    - submitting with a difference;
    - reopening an earlier month under a locked later one.
- **Deploy:** `tools/deploy-sets/bankrec-r2.txt` (287 functions: the
  require closure, the shared approval registry included), with
  `--screens`, then "hosting".
