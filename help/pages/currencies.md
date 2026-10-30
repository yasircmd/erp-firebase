---
title: Currency Configuration
area: finance
order: 2
modules: [CURRENCYCONFIG]
summary: The currencies list, the default currency the books are kept in, exchange rates by date and the Exchange Gain / Loss account.
reviewed: 2026-10-30
fingerprint: c8199c3f302f8eed
---
## What it is for

Sets the **default (functional) currency** the books are kept in. Every
journal entry, invoice and report is in that currency; entry screens show
it in their read-only **Currency** field.

## Before you start

Only users with Currency Configuration rights (normally Admin) can change
it. Set it once, before the first entry.

## Step by step

1. Open **Currency Configuration** and select **Add Currency**.
2. Enter the **Code (ISO 4217)**, for example `AED` or `USD`, the **Name**
   and the **Symbol**.
3. Tick **Set as default (functional) currency** for the one the books use.
4. Save. Only one active currency is the default.

## Exchange rates

A vendor or customer can be in a **foreign currency** (its **Default
Currency** in Vendor or Customer Master). Its invoices, payments and
statement are then in that currency, at a rate you enter here.

1. Select **Rates** on the foreign currency's row.
2. Enter the date the rate takes effect and the rate: how much of the
   default currency one unit is (for example 1 USD = 3.6725 AED).
3. **Add**. The rate applies from that date until a later one.

Rates are only added, never edited: a document keeps the rate it was made
with. To correct a rate, enter the right one from the same date; the later
entry wins from then on.

### Rates from the sheet

Rates can also come from a Google Sheet, which the firm keeps for every
client. It uses GOOGLEFINANCE, so its rates are indicative and can be up
to 20 minutes late. Nothing applies until you confirm it:

1. Under **Rates from the sheet**, click **Get rates from the sheet**.
2. For each currency you see:
   - the sheet's rate;
   - the last rate you entered and its date;
   - the change.

   A rate more than 5% from the last one is marked and left unticked:
   tick it only if it is right (for example after a devaluation).
3. Choose the date the rates take effect (today by default), tick the ones
   to use, and click **Apply the ticked rates**.

An applied rate is an ordinary rate, its note *From the sheet*.

Apply is refused if the sheet's rate changed after you read it: get the
rates again. A currency the sheet lacks, or a cell still calculating, is
listed and left out.

## Exchange Gain / Loss

When a foreign bill is paid at a rate other than its own, the difference
in the default currency is a realized exchange gain or loss. Choose, for
each company, the **Exchange Gain / Loss** account (a Revenue or Expense
account) and the cost center its lines take when the payment line has
none. A payment that settles a foreign bill at another rate is refused
until it is set.

## Rights

- **Write**: add currencies, set the default, choose the Exchange Gain /
  Loss account.
- **Rates**: enter exchange rates, and get and apply them from the sheet
  (Roles & Permissions, Currency Configuration).

## Good to know

- The books, the Trial Balance and every report stay in the default
  currency. Foreign amounts are kept beside the default-currency amounts
  on each line.
- Rates are typed in, or read from the firm's sheet when you click; the
  sheet is never read on its own, and nothing applies without your Apply.
- Changing the default later does not convert anything already posted, so
  choose it before going live.
