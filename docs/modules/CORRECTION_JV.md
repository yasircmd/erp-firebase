# Correction JV: reclassify a posted entry (CJV)

Status: **decisions made** (owner, 2026-11-07, Q415-Q418); building.

## The request (owner, 2026-11-07)

"Develop a module for corrections or reclassify any entry, voucher number by
default as CJV, only to change account code, cost center, profit center,
project. So a new rectification entry will be posted. I confused about the
party transactions, should it also updatable or what normally ERPs doing?"

## What it does

1. Choose any **posted** GL entry: a JV, a Cash & Bank voucher, an invoice,
   a payroll run and so on, found by its voucher number.
2. Its lines are shown. On each line to correct, choose a new **account**,
   **cost centre**, **profit centre** and/or **project**. Nothing else can be
   changed: not the amount, the side, the date, the party or the description.
3. Posting makes a new entry, numbered **CJV-...** (a series of its own in
   Numbering, prefix "CJV" by default and changeable). For each corrected
   line it posts two lines of the same amount:
   - the old coding, on the opposite side, which takes it out;
   - the new coding, on the line's own side, which puts it in.

   The entry nets to zero, and every report built on the GL (Trial Balance,
   P&L, the GL report, Budget vs Actual, the Project report) then shows the
   new coding from the CJV's date.
4. The original entry and its document are **not changed**. Each links to the
   other: the original shows "Corrected by CJV-...", and the CJV shows
   "Correction of JV-...". The audit trail stays complete.
5. A CJV can be reversed like a JV, which puts the old coding back.

## Party transactions: what ERPs normally do (the question asked)

SAP, Oracle and Dynamics all treat the **party side** and the **GL side**
differently.

- **The account of a party line is never reclassified.** The receivables and
  payables accounts are *control accounts*. Their balance must always equal
  the sum of the customers' or vendors' open items. If a correction moved a
  customer's line from Trade Receivables to another account, the customer
  would still owe the amount, but the GL would no longer show it, and the
  party statement would disagree with the Trial Balance. So the reclass tools
  in those ERPs refuse control accounts.
- **A wrong party** (posted to customer A, meant for B) is not a
  reclassification either. It is a **party transfer**: credit A, debit B,
  each with its allocation, so both statements show it. In this ERP that is
  an ordinary JV with two party lines, which already works.
- **The dimensions of a party line** (cost centre, profit centre, project) can
  be corrected. They change no party balance and no allocation.
- **The other side of a party transaction** (the revenue of an invoice, the
  expense of a vendor bill) is plain GL, and correcting it is the most common
  use of a reclass.

**Decided (Q415): party lines are not corrected at all.** A customer's or
vendor's line is shown on the CJV read-only, its account, party and
dimensions as posted. So the CJV never touches a party, its statement, aging
or allocations, nor a control account. A wrong party is fixed with a JV (a
party transfer), and the Help says so.

## Other accounts the CJV keeps fixed (recommended)

The same reasoning applies wherever a sub-ledger must agree with an account.
On these lines the dimensions may change but the account may not. No line
may be moved *to* such an account either.

| Account | Why |
|---|---|
| Customers' receivables, vendors' payables, Rep Cash Clearing | Control accounts: the party ledgers (above). |
| Items' inventory accounts | The stock ledger's value must equal the account. Fix stock with a Stock Adjustment. |
| Tax accounts (Tax Configuration's components) | The tax reports are built from the documents. Moving tax in the GL alone would make VAT 201 / GSTR disagree with the books. |
| Fixed asset cost and accumulated depreciation accounts | The asset register must agree. Use Fixed Asset postings / transfer. |

A bank or cash account can be corrected. The CJV is then a new line in Bank
Reconciliation for the month of its date, as any other entry.

## How it fits the system

- Posted through `glWriting` as a normal GL entry with VoucherType `CJV`, so
  the period lock (no closed month, nothing after this month), numbering,
  approvals and the GL indexes all apply unchanged.
- The new coding is checked as any new posting: an active postable account of
  the company, cost and profit centres and projects open and valid for the
  account's dimension rules.
- Foreign-currency lines keep their currency amount and rate. Both CJV lines
  carry the same figures.
- Its own module **Correction JV** (CJV), with access, write and post rights
  in Roles & Permissions. It can be put through approval in Approval
  Configuration, as JV can.

## The owner's decisions (2026-11-07)

| # | Question | Decision |
|---|---|---|
| Q415 | Party lines: what may a correction change? | **Nothing.** Party lines are shown read-only; only GL lines (no party) are corrected. A wrong party is a JV (party transfer). |
| Q416 | The CJV's date | **Chosen on the CJV, the original's date by default**; it must be in an open period (and not after this month), so a closed month is corrected in an open one. |
| Q417 | Part of a line | **A line may be split:** its amount spread over several new codings (e.g. 60 % / 40 % between two cost centres), the parts totalling the line. |
| Q418 | The original document reversed after a correction | **Refused until the CJV is reversed** (the message names it); otherwise the reversal would take out the old coding a second time. |

Taken as the plain reading (say if any should differ): the accounts kept fixed
above (inventory, tax, fixed asset accounts, and the control accounts, which
only party lines carry); the CJV's own module and rights; optional approval; a
line corrected again by correcting the CJV.

## Build plan (after the design is agreed)

1. Server: `functions/src/correctionJv.js`: find a posted entry, save a
   draft, post (the checks above, one `glWriting` entry), reverse; the links
   both ways; the reversal guard (Q418); the CJV numbering series; the module
   in the registry and approvals. Emulator tests with negative controls.
2. Screen `screens/CJV.html`: list, entry layout, the original's lines with
   the new coding beside each, print. UI test.
3. Help page (in Accounting), What's new, docs, deploy set, PR.
