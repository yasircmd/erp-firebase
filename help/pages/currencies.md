---
title: Currency Configuration
area: finance
order: 2
modules: [CURRENCYCONFIG]
summary: The currencies list and the default (functional) currency every entry is recorded in.
reviewed: 2026-10-12
fingerprint: 77069edadb4e0129
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

## Good to know

- The ERP records amounts in the default currency only; there are no
  exchange rates. Enter foreign-currency documents at their value in the
  default currency.
- Changing the default later does not convert anything already posted, so
  choose it before going live.
