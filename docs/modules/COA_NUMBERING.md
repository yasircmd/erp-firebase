# Chart of Accounts: headings only at the top, and renumbering a used account (UX Tier 3, M)

Status: **design agreed** (owner, 2026-10-16; UX_TIER3.md round 15, follow-ups 208–210).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, M).
The owner (Tier 2, 2026-10-16): "an account with 100001 should not be
created, instead it should be like 110001"; and "is it possible to
customize within the limit even after posting, like 110001 can change to
11xxxx without duplicating?"

## Today

The code is never typed: the ERP gives the next one from the account's
type and parent.

- **Type digit:** Asset 1, Liability 2, Equity 3, Revenue 4, Cost of
  sales 5, Expense 6.
- **Top headers** `X?0000`: up to 10 per type, for example **100000 Cash**,
  **110000 Bank**, 120000 Receivables. They are seeded with the chart.
  There is no separate "class" record: 100000 is the Cash heading itself,
  a sibling of 110000, not a heading above it.
- **Sub-headers** `X?N000` (N 1–9) sit under a top header.
- **Accounts** `X?0001–X?0999` sit directly under a top header (so
  **100001** is the first account under Cash). `X?N001–X?N999` sit under
  a sub-header.
- Whether an account is a heading or takes postings is its **Postable**
  tick, not its code.
- **A gap found:** an account with **no parent**, ticked Postable, is saved
  with a heading-style code (e.g. 140000) and takes postings. Nothing
  stops it. This is likely how unexpected codes appear.
- **Renumbering** (COA_RECODE.md, live since 2026-10-02): moving an account
  to another parent gives it the next code there. This is **refused once
  the account has been used** (any entry, invoice, PDC, template …), and
  for an account with children.
- Postings keep a **copy** of the code on every GL line (and drafts,
  invoice direct lines, recurring templates and PDCs refer to it by code).
  Master data (items, vendors, customers, companies, asset classes) links
  by ID.

**Important: 100000 is the Cash heading.** Cash and Bank Transactions
finds cash accounts by the code **10…** and bank accounts by **11…**
(journal.js, CBT_VOUCHER_CONFIG). So **100001 is a cash account by
design**, not a mistake. "No 100001" would mean no cash accounts; see
question 197.

## Proposal

1. **Close the gap:** a postable account must have a parent heading. An
   account without one is a heading (not postable). The same rule in
   Master Data Import. Accounts already saved that way are listed (a
   "headings that take postings" check) for the owner to fix.
2. **Renumber a used account, within its heading (the owner's 110001 →
   11xxxx).** In Chart of Accounts, **Renumber** on an account offers the
   free codes of its own heading (same type, same parent, same company);
   you choose one and give a reason. Then, under the global lock:
   - the account takes the new code;
   - every stored **copy** of the old code is rewritten to the new one:
     GL lines, drafts, invoice and PDC lines, recurring templates,
     requisitions and orders;
   - the change is logged (old, new, who, when, reason), and the account
     keeps "formerly 110001" so old printouts can still be found.

   The account's ID doesn't change, so its balance, history and every link
   by ID stay as they are. Nothing is duplicated: the old code becomes free
   only after all its copies are rewritten.

   Moving a used account to **another** heading stays refused. It would
   move its whole history into another group of the financial statements.
3. **A closed month** isn't affected: no amounts change. The rewrite is
   allowed in closed months and logged (as Re-match, decision 165).

## Questions for the owner

- **197.** "No account 100001": Cash is the 100000 heading, so 100001 is a
  cash account. Do you mean that **no account should be created without a
  heading above it** (the gap above, recommended), or that you want a
  heading above 100000/110000 (an "Assets" class)? A class above would
  change every code and how Cash and Bank finds cash and bank accounts, a
  much larger change; not recommended.
- **198.** Renumber within the same heading only (recommended), or also
  within the same type in another heading (e.g. 110001 → 120005)?
- **199.** Who may renumber: a new right "renumber" on Chart of Accounts,
  recommended, or whoever may change the chart?
- **200.** Printed documents from before keep the old code (they are
  paper); the ERP shows the new code everywhere, with "formerly …" on the
  account. Agreed?
- **201.** The existing headings that take postings (found by the check in
  1): list them for you to fix by hand (recommended), or turn them into
  headings automatically where they have no postings?
- **202.** May a sub-header (X?N000) be renumbered too, taking its accounts
  with it (X?N001 → X?M001)? Recommended: not now; accounts only.

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 197 | **X00000 is the class**: 100000 Assets, 200000 Liabilities, 300000 Equity, 400000 Revenue, 500000 Cost of sales, 600000 Expenses. A class is a heading only, and an account always sits under a **group** below it (the owner: "there should be always a sub category for any ledger"), e.g. 110001, never 100001. |
| 198 | Renumber within the same heading only (the recommendation). |
| 199 | **No new right**: whoever may change the Chart of Accounts may renumber. |
| 200 | Nothing to keep from before: the ERP is still in test, with no real data. |
| 201 | Headings that take postings are listed to fix (the recommendation). |
| 202 | Sub-groups are not renumbered for now (the recommendation). |

### What 197 means for the chart

The levels move down by one, keeping 6 digits:

| Level | Code | Example |
|---|---|---|
| Class (one per type, heading only, seeded) | `X00000` | 100000 Assets |
| Group (up to 9 per class, heading) | `XN0000` | 110000 Cash, 120000 Bank |
| Sub-group (optional, heading) | `XNM000` | 121000 Bank: current accounts |
| Account (takes postings) | `XN0001`–`XN0999` or `XNM001`–`XNM999` | 110001 Petty cash, 121001 Bank A |

The seeded chart would become:

| Class | Groups |
|---|---|
| 100000 Assets | 110000 Cash / Petty Cash, 120000 Bank Accounts, 130000 Receivables (Trade), 140000 Inventory |
| 200000 Liabilities | 210000 Payables (Trade), 220000 Short-term Loans, 230000 Accrued Liabilities |
| 300000 Equity | 310000 Share Capital, 320000 Retained Earnings |
| 400000 Revenue | 410000 Domestic Sales, 420000 Sales Returns & Discounts, 430000 Other Income |
| 500000 Cost of Sales | 510000 Cost of Goods Sold, 520000 Direct Material |
| 600000 Expenses | 610000 Wages & Salaries, 620000 Rent & Facility, 630000 Depreciation |

**Cash and bank accounts are found by their code today**: "10…" is cash
and "11…" is bank. This is used in Cash and Bank (which ledger a voucher
may use), PDCs (the bank account), Fixed Assets (paid from cash or bank,
twice) and payroll payment and the final settlement (cash or bank). With
the new chart cash would start "11" and bank "12", so these checks change
too. The proposal is to stop reading the code and mark the **group**
instead: a group is **Cash**, **Bank** or neither (seeded: 110000 Cash,
120000 Bank). One shared check then serves all six places, and any later
renumbering can't break it. The default Retained Earnings account moves
from 310000 to the new group 320000 (Period Closing looks it up).

## Follow-up questions (before building)

- **208.** You wrote "1100001" (7 digits). Do you mean **110001** (6
  digits, as above; recommended, so no stored code grows), or 7-digit
  codes?
- **209.** The test data has accounts on the old codes. **Reset the test
  data** (Data Reset) and start on the new chart (recommended: simplest
  and cleanest, since nothing is real), or renumber the existing accounts
  into the new chart?
- **210.** Cash and bank found by a **Cash / Bank mark on their group**,
  not by the code (recommended), so they can sit under any group you
  name?

### The owner's answers to the follow-ups (2026-10-16)

| # | Decision |
|---|---|
| 208 | **6 digits** (110001); "1100001" was a typo. |
| 209 | **Reset the test data** and start on the new chart. |
| 210 | Cash and bank are found by a **Cash / Bank mark on their group**, not by the code. |
