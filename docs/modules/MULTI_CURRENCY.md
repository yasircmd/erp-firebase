# Foreign currency for customers and vendors (UX Tier 3, O)

Status: **design agreed** (owner's direction 2026-10-16, round 16).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 3, O).

## The owner's direction (2026-10-16)

- Under one corporate ID, **every company uses one base currency** (the
  system currency, the Default in Currency Configuration). A second
  corporate ID with another base currency comes later, and is not part of
  this design.
- A **foreign customer or vendor has its own currency (FC)**. Its invoices,
  payments and statement (SOA) are in that currency.
- **Exchange rates** can be updated daily or at any time. Each rate has an
  **effective date** and applies until a newer one takes effect.
- Check whether a **live rate** can be fetched when updating (Google
  Finance or another source).

## Today

- **One currency in practice.** Currency Configuration lists currencies,
  with one marked Default. JV, CBT, Recurring JV and fixed asset entries
  record the Default's code at save time (`CurrencyCode`), but every amount
  is in it. There are no exchange rates anywhere.
- **The party masters already have a field:** Vendor Master and Customer
  Master have **Default Currency** (`DefaultCurrency`). It is stored, but
  nothing uses it yet.
- **Price lists** have their own currency (`CurrencyID`), and a Sales Order
  copies it from its price list, but the amounts are never converted.
- **The GL** (journalEntries, the Trial Balance, the reports) is in one
  currency, which is right: it stays in the base currency.
- **Party balances** (SOA, aging, open items, allocation in JV / CBT / PDC)
  are worked out from GL lines tagged with the party (partyLedger.js), in
  the base currency.

## Proposal

### 1. Rates

A **Exchange Rates** list in Currency Configuration: currency, effective
date, rate (1 FC = x base), source (typed, or fetched) and who entered it.
The rate for a date is the latest one effective on or before it. Rates
are never edited after a document uses them. A correction is a new rate
from a date.

**Fetching a rate:** a **Get today's rate** button fills in the rate from
an online source, for you to check before saving.
- Google Finance has no API, so it can't be used from the ERP.
- The Central Bank of the UAE publishes official daily rates on its
  website, but has no official free feed that I could find. Commercial
  services mirror it.
- Free general services (for example Frankfurter, from the European Central
  Bank) don't all quote AED directly, but a rate can be worked out through
  EUR or USD.
- The AED is pegged to the USD at 3.6725, so USD itself never needs
  fetching.

See question 213.

### 2. Documents in a foreign currency

A foreign party's documents carry the **currency and the rate** (the rate
on the document date, which you may override with a reason). Lines are
entered in FC. Each GL line keeps both:
- the **FC amount, currency and rate**;
- the **base amount**, which every report, the Trial Balance and the
  financial statements use.

Phase 1 covers what a party's balance is made of:

- Customer Invoice, Vendor Invoice;
- Sales Return, Purchase Return;
- CBT receipts and payments to or from the party (the bank side converts
  at the voucher's rate);
- PDCs;
- JV lines tagged with a foreign party;
- opening balances for foreign parties.

Orders, GRNs and Delivery Notes stay in base (question 215).

### 3. Settling: realized exchange difference

When a payment in FC settles an invoice in FC at a different rate, the
base amounts differ. The difference posts automatically to an **Exchange
Gain / Loss** account (set in Company Master or Currency Configuration).
Allocation (Against Ref) works in FC. A bill is fully settled when its FC
amount is, whatever the base difference.

### 4. Statements and balances in FC

- The **SOA** of a foreign party shows FC: each line's FC amount and rate,
  the FC running balance, and the base equivalent beside it.
- **Aging**, **open items** and **allocation** work in the party's FC.

### 5. Month-end revaluation (unrealized)

At month end, open FC balances can be revalued at the month-end rate. A
reversing entry on the 1st posts the difference to Unrealized Exchange
Gain / Loss. This could be a step on the Period Closing checklist.
Question 216.

### 6. Bank accounts in a foreign currency

A bank account may itself be in FC (a USD account), so its balance is
kept in USD as well as in base. Question 217.

## Questions for the owner

- **211.** Is the party's currency fixed (all of its documents in that
  currency), or chosen per document from the party's default? Recommended:
  fixed per party. That keeps the SOA in one currency, and it is what you
  described.
- **212.** Who may enter or fetch rates? Recommended: a new right "rates"
  on Currency Configuration.
- **213.** Where should **Get today's rate** fetch from?
  - (a) A free source (European Central Bank based, AED worked out through
    EUR or USD).
  - (b) A paid service that mirrors the Central Bank of the UAE's official
    rates (needs an account and an API key, about USD 10–30 a month).
  - (c) No fetch: type the rate from the Central Bank's website.

  Recommended: (a) now, to fill in a rate you check before saving, with
  (b) if your auditors need the official Central Bank rate.
- **214.** May a document's rate be changed from the rate on its date (for
  example the bank's actual rate)? Recommended: yes, with a reason, logged.
- **215.** Scope of phase 1: the party documents listed above. Should
  Sales Orders, Purchase Orders, GRNs and Delivery Notes also be in FC now?
  Recommended: later. For now they stay in base, and an FC price list
  converts on the invoice.
- **216.** Month-end revaluation of open FC balances: needed now, or
  later? Recommended: later. Realized differences on payment come first.
- **217.** Do you have bank accounts in a foreign currency (for example a
  USD account) whose balance must show in that currency? Recommended: yes
  if you have them. A bank account then carries a currency, and its CBT
  vouchers are in it.
- **218.** Printed invoices in FC: show the base equivalent too (some UAE
  VAT rules ask for the VAT amount in AED)? Recommended: yes, the VAT total
  in AED at the invoice rate.

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 213 | **Skip fetching**: rates are typed in, with their effective date. No online source and no Get today's rate button. |
| 211 | The party's currency is **fixed**: all of its documents are in it, and its SOA too. |
| 212 | A new right **rates** on Currency Configuration enters rates. |
| 214 | A document's rate may differ from the rate on its date, with a reason, logged. |
| 215 | Phase 1: the party documents only (invoices, returns, CBT, PDC, JV party lines, openings). Orders, GRNs and Delivery Notes later. |
| 216 | Month-end revaluation **later**; realized differences on payment now. |
| 217 | A bank account may carry a currency; its CBT vouchers are in it. |
| 218 | A foreign-currency invoice prints the VAT total in AED at the invoice rate too. |
| (all) | "Go with your recommendations" (owner, 2026-10-16). |

## As built: phase O1 (2026-10-16)

Built in two steps. **O1** covers rates, invoices, returns,
Cash & Bank and the statements. **O2** covers PDCs, openings, JV party
lines, bank accounts in a foreign currency, and the print with the VAT in
AED.

**Rates** (`functions/src/exchangeRates.js`):
- Stored at `exchangeRates/{CODE}/{pushId}` as `{ EffectiveDate, Rate,
  Note, By, ByName, At }`, with 1 FC = Rate base. They are only added.
- The rate for a date is the latest one on or before it. On the same date
  the later entry wins.
- Currency Configuration → **Rates** lists and adds them. Adding needs the
  right **rates**: Admin and Finance Manager by default, and the owner
  ticks it in Roles & Permissions.
- Each company's **Exchange Gain / Loss** account (Revenue or Expense) and
  cost center are stored at `fxSettings/{companyId}`.

**The party's currency** (`functions/src/fx.js`):
- It is the master's `DefaultCurrency` when that is not the base currency.
- It is fixed once the party has an invoice or a journal line (patch
  `party-currency-fixed`).

**GL lines:**
- `Debit` / `Credit` are base, as before. A foreign line adds
  `FcCurrency`, `FcDebit`, `FcCredit` and `FcRate`.
- glWriting keeps these fields, and line clubbing keeps foreign lines
  apart by currency and rate.
- A reversal swaps the foreign amounts with the base ones (`fx.mirrorFc`)
  in JV/CBT, PDC, the returns, openings and asset retirement.

**Invoices** (patches `invoice-currency-*`):
- A foreign party's Customer / Vendor Invoice is in its currency: `Total`
  is in FC, and the invoice stores `CurrencyCode`, `ExchangeRate`,
  `RateEffectiveDate`, `ExchangeRateReason` and `TotalBase`.
- The rate is the one on the invoice date. Another rate needs a reason
  (decision 214).
- At posting, the lines are converted to base (`fx.toBase`): each line is
  rounded, and the cent left over goes to the largest line, so the entry
  balances.
- The approval amount is `TotalBase`. A reversal keeps the invoice's rate.
- **For now** a foreign vendor's invoice takes direct lines only (GRNs are
  base, decision 215). A foreign customer's invoice takes item lines and
  direct lines. Delivery Notes made separately are refused, because
  nothing records the currency of their prices.
- A **Sales Return** of a foreign invoice converts its invoice-side lines
  at the invoice's rate. The stock and COGS lines stay in base.

**Cash & Bank:**
- A line tagged with a foreign party takes the FC amount beside the base
  amount (`FcCurrency` / `FcAmount`, rate = amount / FC amount), and its
  allocation is in FC.
- `resolvePartyLines` refuses a foreign party's line without its FC
  amount. JV, PDC and openings can't enter one yet: they say so, and
  openings refuse foreign parties outright.

**Realized differences** (`partyLedger.resolvePartyLines`):
- For each allocation of a foreign item, d = round2(A × the line's rate) −
  round2(A × the item's rate).
- The differences are summed per party line and posted as a pair:
  - one line on the party's control account, FC 0, `FxAdjustment`, on the
    item's side when d > 0;
  - one line on the Exchange Gain / Loss account.
- They are recomputed on every save and post (the incoming
  `FxAdjustment` lines are dropped first), and the entry's totals follow.
- A settlement at another rate is refused until the account is set.

**Statements and aging:**
- The SOA of a foreign party is in its currency, with a base running
  balance beside it (`BaseOpening`, `BaseBalance`, `BaseClosing`).
- Exchange lines move only the base balance. The GL check uses the base.
- Open items carry `Currency`, `Rate` and `BaseOutstanding`.
- The aging shows a foreign party in base, each item at its own rate, so
  the totals and the control-account check still add up. `FcOwed`,
  `FcUnapplied` and `FcNet` are given beside it.

## As built: phase O2 (2026-10-16)

**PDC** (pdc.js, PDC screens):
- A foreign party's cheque takes `FcAmount` beside its `Amount` (base,
  what the bank pays). The allocations and the advance (New Ref) are in
  FC, and the rate is Amount / FcAmount.
- The post entry carries the party line's FC fields and the exchange
  difference lines from `resolvePartyLines`.
- Bounce and cancel mirror them (`mirrorFc`, `FxAdjustment`).
- `getPdcSetup` gives each party's `Currency`.
- The SOA's pending PDCs are in the party's currency.

**JV:**
- A foreign party's line takes its FC amount beside the debit or credit
  (`fcFromAmounts_` in saveJournalDraft, rate = base / FC). Without one it
  is refused.
- The JV and CBT screens no longer load the `FxAdjustment` lines into the
  grid. Re-saving a draft used to add them a second time. The server
  works them out again on every save.

**Opening Balances:**
- Open Invoices gain an optional **Rate** column. A foreign party's
  Amount is in its currency, at the given rate, or blank for the rate on
  the document date.
- The line is base with the FC fields, and the New Ref is in FC.

**Bank accounts in a foreign currency** (decision 217):
- A postable cash or bank account may carry `Currency`, through patch
  `bank-currency` and the COA SCREEN_EDITS. It is fixed once the account
  has postings (`findAccountUsage`).
- A CBT voucher on such a ledger stores `LedgerCurrency`, `ExchangeRate`,
  `RateEffectiveDate` and `ExchangeRateReason`, with the rate on the date
  or another one with a reason.
- Its amounts are typed in that currency, and every line is base at the
  voucher's rate with its FC amount.
- A party on it must be in the same currency: a base party's line is
  refused by `resolvePartyLines`.
- Fund Transfer:
  - FC to the same FC: both lines keep the FC amount.
  - FC to base: the To line is base only.
  - Base to FC: the To line's FC amount is entered, and the rate is base
    / FC.
  - Between two different FCs: refused for now.
- The GL Report ledger of such an account gives `FcDebit`, `FcCredit`,
  `FcBalance`, `fcOpening` and `fcClosing`. `getPostedGlLines_` keeps the
  FC fields.

**Print** (decision 218): a foreign-currency Customer Invoice prints its
total in FC, then the rate, the VAT in base (TaxAmount × rate) and the
total in base. The CBT voucher prints its currency and rate.

**Not handled yet:**
- Re-match of an entry with foreign lines.
- Recurring JV and asset retirement lines for foreign parties are refused
  (no FC amount on those screens).
- A draft keeps the rate of its last save until it is saved again.
- Month-end revaluation (decision 216, later).
- Orders, GRNs and Delivery Notes in FC (decision 215, later).

**Tests:** `functions/test/emulator/multiCurrency.emulator.test.js` (11
tests) and `functions/test/ui/multiCurrency.ui.js` (11 checks). Three
negative controls were verified:
- the exchange-difference sign flipped: 3 tests fail;
- the return's conversion skipped: 1 test fails;
- the CBT conversion of a foreign-currency ledger skipped: 1 test fails.
