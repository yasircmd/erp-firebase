---
title: Company Master
area: admin
order: 1
modules: [COMPANYMASTER]
sources: [functions/src/companies.js]
summary: Keep the company profile, chart links and the legal defaults used across the ERP.
reviewed: 2026-10-12
fingerprint: f2f52ace7063e5a2
---
## What it is for

**Company Master** holds the company profile and many of the legal and operational defaults that the rest of the ERP relies on, including account structure and tax-related settings.

## Before you start

- The legal company information is agreed.
- The financial account and tax configuration is ready.
- The business knows which setup defaults must be shared across all modules.

## Step by step

1. Open **Company Master** and select the company.
2. Review the company information and operational defaults.
3. Set the required account links and the fields that should be shared with all modules.
4. Save and test a standard transaction against the company setup.

## What happens in the books

Company Master is a setup record and not a posting document by itself. It provides the default company rules used by many other screens.

## Rights

Usually restricted to ERP admin or finance-support roles.

## Questions and mistakes

- If a screen cannot find the company or accounts, the company profile may not be set correctly.
