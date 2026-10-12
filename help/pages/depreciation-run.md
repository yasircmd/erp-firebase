---
title: Depreciation Run
area: assets
order: 5
modules: [FADEPRUN]
sources: [functions/src/fixedAssetsDepreciation.js]
summary: Calculate and post the monthly depreciation for the active fixed asset register.
reviewed: 2026-10-12
fingerprint: f637072b0ebd4d56
---
## What it is for

**Depreciation Run** calculates the monthly depreciation charge for all active assets using the company rules and asset class settings.

## Before you start

- Assets are capitalized and active.
- The depreciation policy and rates are configured.
- The reporting period is open.

## Step by step

1. Open **Depreciation Run** and choose the company and period.
2. Review the asset list that qualifies for the run.
3. Calculate the depreciation and check the amount per asset.
4. Post the run once it is approved.

## What happens in the books

The run posts the depreciation expense and reduces the asset’s carrying value, while updating the accumulated depreciation account.

## Rights

Finance and fixed asset support roles normally post the depreciation run.

## Questions and mistakes

- If an asset is missing, confirm it was capitalized and not retired or already fully depreciated.
