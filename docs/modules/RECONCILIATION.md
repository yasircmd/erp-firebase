# Reconciliations (design)

Requested 2026-11-01 (owner): "develop a new module for Reconciliations".
The owner chose two kinds: **bank reconciliation** and **GL account
reconciliation**. Vendor statement and customer balance confirmation are
not in scope.

**Status:** the bank decisions are made. The GL account reconciliation
questions are waiting for the owner.

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

## GL account reconciliation: questions for the owner

Asked 2026-11-01. The owner hasn't answered yet; these are the
recommendations.

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q371 | **How an account's balance is explained** | (a) its offsetting lines matched, the unmatched ones being the balance (clearing, suspense); (b) a supporting schedule of items with notes and attachments adding up to the balance (accruals, prepayments); (c) either, chosen per account | **(c)** |
| Q372 | **Which accounts, how often** | (a) a per-company list of accounts reconciled monthly (bank accounts always in it), with each month's status (not started, in progress, waiting for review, done); (b) any account, on demand | **(a)** |
| Q373 | **Sign-off** | (a) through Approval Configuration's levels, as other documents; (b) one "review" right | **(a)** |

## Build plan (proposed)

- **R1:** bank reconciliation: statement paste, suggested and manual
  matching, ticking by hand, the report, Excel copy.
- **R2:** posting an entry from an unmatched statement line (Q369);
  submit, approve, lock, reopen (Q370); carried forward.
- **R3:** GL account reconciliation, once Q371–Q373 are decided; the
  month's status board for every chosen account.

Each step has tests, a Help page in Finance and a What's new entry.
