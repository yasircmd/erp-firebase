---
title: Asset Register
area: assets
order: 7
modules: [FAREGISTER]
sources: [functions/src/fixedAssetsCommon.js]
summary: Review the assets in use, their values and their depreciation status company-wide.
reviewed: 2026-10-12
fingerprint: a71fec3e9215343a
---
## What it is for

**Fixed Asset Register** is an as-at report reconstructed from asset transactions. It shows asset cost and movements, accumulated depreciation, current-period depreciation, net book value (NBV), disposal proceeds/gain or loss, and asset status as of the selected date.

## Before you start

- Capitalization, additions, depreciation, transfers, retirement, and reversals have been posted for the period being reviewed.
- Select the correct company and as-at date. The report can show historical balances, not only today's balance.
- Know which filters are needed: asset number, class, description, cost center, status, supplier, capitalized date, or purchase date.

## Step by step

1. Open **Fixed Asset Register**, select the company and **As at** date, then choose **Show**.
2. Narrow the rows by asset number, class, description, cost center, status, supplier, capitalized-from/to, or acquired-from/to.
3. Review original cost, additions, transfers, retirements, accumulated depreciation, this-period charge, NBV, disposal value, gain/loss, and status. Totals and class summaries follow the filtered rows.
4. Open a row to inspect its dated asset history and linked posting documents. Use CSV for spreadsheet analysis or Print for a review copy.
5. Reconcile unusual balances to Fixed Asset Master history, depreciation runs, capitalization, transfers, and retirement entries before changing any source transaction.

## What happens in the books

The register is read-only. It reconstructs balances from posted asset transactions and creates no journal. The GL posting remains in the transaction that changed cost or accumulated depreciation.

## Rights

FAREGISTER access controls report visibility; company access limits the report data. CSV/print are report outputs, not postings.

## Questions and mistakes

- **Asset missing:** check the company, as-at date, filters, and whether it existed or was capitalized by that date.
- **NBV is unexpected:** compare cost, additions, transfers, retirements, accumulated depreciation, and this-period depreciation with the transaction history.
- **Disposal gain/loss differs:** inspect disposal proceeds and NBV on the retirement date; do not use today's NBV for a past disposal.
- **Class summary doesn't match the unfiltered report:** the summary follows the currently filtered rows; clear filters before comparing company totals.

## Related pages

[Fixed Asset Master](fixed-asset-master.html) · [Depreciation Run](depreciation-run.html) · [Fixed Asset Capitalization](fixed-asset-capitalization.html) · [Fixed Asset Retirement](fixed-asset-retirement.html)
