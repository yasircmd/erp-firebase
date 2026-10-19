---
title: Company Master
area: admin
order: 1
modules: [COMPANYMASTER]
sources: [functions/src/companies.js, functions/src/shareholders.js]
summary: Keep the company profile, chart links and the legal defaults used across the ERP.
reviewed: 2026-10-19
fingerprint: 893174536d10e45f
---
## What it is for

**Company Master** holds the company profile and many of the legal and operational defaults that the rest of the ERP relies on, including account structure and tax-related settings.

## Before you start

- The legal company information is agreed.
- The financial account and tax configuration is ready.
- The business knows which setup defaults must be shared across all modules.

## Step by step

1. Open **Company Master** and select the company. Companies are listed in code order (01, 02 … 10).
2. Review the company information and operational defaults.
3. Set the required account links and the fields that should be shared with all modules.
4. Save and test a standard transaction against the company setup.

## Shareholders

Select **Shareholders** (the people icon) on a company to see and keep its
shareholders: name, nationality, ID or passport number, shares held, and the
dates they held them from and to.

- Enter the company's **Issued shares**: each shareholder's **%** is worked
  out of them. If the current shareholders don't hold exactly the issued
  shares (100%), a warning says so; you can still save, for example while
  a transfer is being entered.
- A shareholder who sold or left: **edit** them and enter the **To** date.
  They stay on the list as a past shareholder, so the history is kept. A
  record entered by mistake can be removed, with a reason.
- **Changes** lists every change: who made it and when.
- **Print company profile** prints the company's details with its current
  shareholders and their %.

## What happens in the books

Company Master is a setup record and not a posting document by itself. It provides the default company rules used by many other screens.

## Rights

Usually restricted to ERP admin or finance-support roles.

Shareholders are personal data, so they have their own right: Company Master
**shareholders** in Roles & Permissions, to see them. Changing them also
needs Company Master's **write** right.

## Questions and mistakes

- If a screen cannot find the company or accounts, the company profile may not be set correctly.
