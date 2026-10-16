# Foreign currency for customers and vendors (UX Tier 3, O)

Status: **design, questions open** (owner's direction 2026-10-16, round 16).
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
