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

**Fixed Asset Master** holds the asset's descriptive, assignment, and book information. Its list lets you search/filter the asset population; opening an asset provides **Details** and **History** tabs. Transactions such as capitalization, depreciation, transfer, and retirement remain in their own modules and appear in this asset's history.

## Before you start

- [Fixed Asset Configuration](fixed-asset-config.html) has an active class and account determination for the company.
- The asset's company, class, description, acquisition facts, cost center, and depreciation defaults are known.
- Determine whether this is a Planned asset awaiting acquisition/capitalization or an already capitalized asset being reviewed.

## Step by step

### Find or create an asset

Use the list filters for company, class, status, or search terms such as asset number, description, serial number, or tag/barcode. Select **New Asset** to create a Planned record; the system assigns its asset number. Enter company, class, description, serial/tag, quantity, purchase date, supplier/invoice reference, organization assignment, notes, and applicable depreciation method/life/rate/residual/start date.

Save the Planned record, then use the appropriate Asset Capitalization flow to recognize its value. Master data entry alone does not capitalize the asset.

### Details tab

Review or maintain editable master details. Once capitalized, company and class are fixed; valuation changes apply from the next depreciation period and require a reason. Do not use Master to change a capitalized asset's assignment. Use the designated Asset Transfer workflow when it is available; if it is not on your menu yet, ask the Fixed Asset administrator about the approved transfer process. Planned records may be deleted; posted/capitalized history is retained.

### History tab

Use History to trace creation, capitalization/additions, take-over, scheduled and additional depreciation, CWIP costs/settlement, retirement, reversals, and master-data changes. Each event shows its date, linked document/GL reference, cost and accumulated-depreciation movement, details, and user/time. Review this before troubleshooting NBV or status.

## What happens in the books

Creating or editing the asset master does not post a journal. It supplies details and depreciation inputs to asset transactions. Capitalization, depreciation, retirement, and CWIP settlement create their own accounting entries and update the asset book balances/history.

## Rights

FAASSET **access** controls viewing; **draft** allows creating and changing eligible asset records. A capitalized asset's company and class cannot be changed; certain post-capitalization changes require a reason. Company access applies.

## Questions and mistakes

- **Asset is missing from the list:** clear the filters and check company, class, and status.
- **No History tab for a new record:** history is available for an existing saved asset; the tab appears when you open an existing record.
- **Cannot edit a field:** capitalized assets have controlled fields; use the correct transaction module for movements and enter a reason for supported master changes.
- **Depreciation does not appear:** check class kind/method, start date, cost/value, depreciation status, period sequence, and mapped accounts.
- **NBV differs from expectation:** compare cost and scheduled/additional accumulated depreciation in Details with the dated transactions in History.

## Related pages

[Fixed Asset Configuration](fixed-asset-config.html) · [Capitalization](fixed-asset-capitalization.html) · [Depreciation Run](depreciation-run.html) · [Fixed Asset Retirement](fixed-asset-retirement.html)
