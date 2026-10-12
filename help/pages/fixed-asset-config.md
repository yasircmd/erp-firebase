---
title: Fixed Asset Configuration
area: assets
order: 1
modules: [FACONFIG]
sources: [functions/src/fixedAssetsConfig.js]
summary: Configure the fixed asset classes, accounts and defaults used when assets are added and depreciated.
reviewed: 2026-10-12
fingerprint: 71c24ed630f5fc3c
---
## What it is for

**Fixed Asset Configuration** defines the fixed asset structure for the company: classes, account determination, depreciation settings and the asset defaults used by the rest of the asset process.

## Before you start

- The company’s asset accounts and cost centers are defined.
- The depreciation policy is agreed with finance.
- Asset classes and categories are known.

## Step by step

1. Open **Fixed Asset Configuration** and select the company.
2. Review the asset classes and the account mapping used for capitalisation and depreciation.
3. Confirm the depreciation rate and treatment defaults.
4. Save the configuration and test it with one asset.

## What happens in the books

This configuration does not post a document itself; it defines the accounts and rules that future asset additions and depreciation will use.

## Rights

Usually only finance support or admin users with fixed asset setup rights can edit these settings.

## Questions and mistakes

- If a new asset cannot be capitalised, check the class, account and company defaults.
