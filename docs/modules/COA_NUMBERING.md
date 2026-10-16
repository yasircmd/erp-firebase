# Chart of Accounts: headings only at the top, and renumbering a used account (UX Tier 3, M)

Status: **built** 2026-10-16 (branch tier3-wave2); design agreed by the owner the same day (UX_TIER3.md round 15, follow-ups 208–210).
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

## As built (2026-10-16)

- **functions/src/coaScheme.js** (new, hand-written) holds the scheme:
  - `generateCode`: class X00000 (only when the type has none), a group
    XN0000 under the class, a sub-group XNM000 under a group, an account
    XN0001–XN0999 under a group or XNM001–XNM999 under a sub-group. The
    first free code is taken, so a renumbered account's old code can be
    reused.
  - Refused: an account straight under a class or with no parent, a
    second class, a heading under a sub-group, a heading becoming an
    account.
  - The legacy `generateAccountCode_` is mapped to it (generate.js
    MAPPED), so saveAccount, the recode on a move (COA_RECODE.md) and
    Master Data Import use the same rules.
- **Seed:** `SEED` holds a class per type and its groups, as in the table
  above. Patch `coa-class-group-seed` gives each group its class as the
  parent. Seeding still adds only the codes missing, so the old chart's
  seeded headings (100000 Cash …) stay until the Data Reset (209).
- **Cash / Bank (210):** stored on the account rather than worked out each
  time.
  - A group or sub-group of the Assets class keeps its own choice in
    `OwnCashBank` (Cash, Bank or empty). Classes and other types are
    refused.
  - Every account keeps the effective value in `CashBank`: its own
    heading's choice, else its nearest marked ancestor's.
  - The account save writes it (patches `coa-class-group-*`). Saving a
    heading rewrites it on every account under it.
  - Every check reads `CashBank` alone (`coaScheme.isCashOrBank / isBank
    / kindOf`):
    - journal.js (CBT ledger and Fund Transfer);
    - pdc.js (a bank account, the bank list, the clearing account not
      cash or bank);
    - fixedAssetsConfig.js and fixedAssetsRetirement.js;
    - payrollLoans, payrollPayment, payrollPlan (and so Interim Payroll),
      payrollProvisions and payrollSettlement;
    - the legacy Cash Flow Statement (`isCashOrBankAccount_` mapped);
    - screens/CBT.html (hand-maintained) filters by `CashBank`.
  - No code reads the code prefix any more.
- **Renumber (198–200, 202):** functions/src/coaRenumber.js (new).
  - `getAccountRenumberCodes` lists the free codes of the account's own
    group or sub-group. Only accounts that take postings and sit under a
    group are renumbered.
  - `renumberAccount({ accountId, newCode, reason })` needs COA write
    (199: no new right) and runs under the global lock. It rewrites every
    `…AccountCode` field equal to the old code in the stores coaUsage.js
    searches: journalEntries (posted and drafts, CBT included),
    faTransactions, faPostings, stock transactions, vendor and customer
    invoices, PDCs, recurring journals, requisitions, purchase and sales
    orders. Only the top-level fields that change are written.
  - The account then takes the new code. The old code is kept in
    `FormerCodes` ([{ Code, Until, By, Reason }], kept by later saves and
    shown on COA as "formerly …"), and the change is logged in
    `coaRenumberLog`. Amounts don't change, so closed months are not
    checked.
  - On screen: a **Renumber** button on each account row, using the
    in-app prompts (the free range, then the reason).
- **Accounts to fix (201):** `getCoaAccountsToFix` lists, in a box above
  the chart, accounts that take postings but have no parent, sit straight
  under a class, or have a heading's code. Such an account can still be
  edited, so it can be given its group.
- **Period Closing:** the default Retained Earnings account is the first
  active Equity account under the 320000 group
  (`coaScheme.defaultRetainedEarnings`), instead of the account coded
  310000.
- **COA screen (generated):** SCREEN_EDITS in generate.js add:
  - the Cash / Bank field (shown for an Assets heading with a parent);
  - the parent list's levels indented;
  - new help text;
  - the Cash / Bank badge and "formerly …" on rows;
  - the Renumber button and the Accounts to fix box.
- **Tests:**
  - functions/test/unit/coaScheme.test.js (6).
  - functions/test/emulator/coaNumbering.emulator.test.js: the seed, the
    rules, CBT by the mark (and the mark following the group), Renumber
    rewriting posted lines, drafts and templates (refused outside the
    heading, without a reason, without the right), and the accounts to
    fix.
  - Fixtures: the test chart's cash and bank accounts carry `CashBank`.
    Retained Earnings moved to 320001 under a 320000 group in the period
    closing, year-end and rematch tests.
- **UI:** functions/test/ui/coaNumbering.ui.js (3): the accounts to fix,
  a Bank group under the class, Renumber through the prompts.
- **Negative control:** with `kindOf` reading the code prefix again
  (10…/11…), the CBT test failed ("Cash and Bank Transactions go by the
  mark"). It was then restored.
- **The owner, after the deploy:** run Data Reset (Chart of Accounts and
  the transactional data) so the chart starts from the new seed (209).
