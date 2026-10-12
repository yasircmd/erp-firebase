---
title: Additional Depreciation
area: assets
order: 6
modules: [FAADDDEP]
sources: [functions/src/fixedAssetsDepreciation.js]
summary: Add one-off depreciation adjustments for assets with unusual or exceptional value changes.
reviewed: 2026-10-12
fingerprint: 98a6c4a33c6dd304
---
## What it is for

**Additional Depreciation** handles one-off or extra depreciation adjustments beyond the normal monthly run. It is used when an asset’s useful life, value or impairment requires a special adjustment.

## Before you start

- The asset and its current value are known.
- The reason and period are approved.
- The asset is active and linked to the correct class.

## Step by step

1. Open **Additional Depreciation** and select the asset.
2. Enter the adjustment period and the extra depreciation value.
3. Review the resulting carrying value and any GL effect.
4. Post the adjustment.

## What happens in the books

This creates or adjusts the depreciation expense and the accumulated depreciation balance according to the company policy.

## Rights

Finance and asset admin users with additional depreciation rights can post this adjustment.

## Questions and mistakes

- If the adjustment is rejected, check whether the selected period is still open and whether the asset is still active.
