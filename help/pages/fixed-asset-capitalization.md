---
title: Fixed Asset Capitalization
area: assets
order: 3
modules: [FAACQ]
sources: [functions/src/fixedAssetsPostings.js]
summary: Record the purchase or acquisition of a fixed asset and place it into service for depreciation.
reviewed: 2026-10-18
fingerprint: 8037fab4ac216c01
---
## What it is for

**Fixed Asset Capitalization** brings a purchased or self-constructed asset into the ERP’s fixed asset register for depreciation.

## Before you start

- The asset master is already created or the class is known.
- The supplier or vendor invoice or accumulation record is ready.
- The account mapping is set in Fixed Asset Configuration.

## Step by step

1. Open **Fixed Asset Capitalization**.
2. Select the asset or create the asset from the acquisition entry.
3. Enter the acquisition value, date and any related cost details.
4. Post the acquisition. The asset is then available for depreciation.

## What happens in the books

The capitalization posts the asset to the fixed asset register and moves the value from the clearing or purchase account into the asset account.

## Rights

Finance or asset support roles generally need access and post rights for capitalisation.

## Questions and mistakes

- If posting is refused, check the class setup, clearing account and asset status.
