---
title: Fixed Asset Master
area: assets
order: 2
modules: [FAASSET]
sources: [functions/src/fixedAssetsMaster.js]
summary: Maintain the asset record that contains its details, class, location and book value basis.
reviewed: 2026-10-12
fingerprint: 386190fba7860394
---
## What it is for

**Fixed Asset Master** stores the asset’s identity and the settings used in accounting, depreciation and retirement.

## Before you start

- The asset class and account mapping are configured.
- The asset is assigned to the correct company and department.
- The acquisition details and useful life are known.

## Step by step

1. Open **Fixed Asset Master** and select the asset or add a new asset.
2. Fill in the asset details: code, description, class, date, value and location.
3. Confirm the capitalisation and depreciation settings.
4. Save and test by capitalising or running depreciation.

## What happens in the books

The asset master is the source of information for later capitalisation and depreciation entries, but itself does not post a journal.

## Rights

Asset owners and finance support usually have access; write access is more limited than read access.

## Questions and mistakes

- If depreciation does not appear, check whether the asset class and asset record are active and linked to the correct accounts.
