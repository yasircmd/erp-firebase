---
title: Material Variance Report
area: production
order: 5
modules: [MATERIALVARIANCE]
sources: [functions/src/stockMovement.js]
summary: Compare BOM-expected component use with net actual stock consumption for production in a date range.
reviewed: 2026-10-12
fingerprint: 1eff671ff7dee7ec
---
## What it is for

**Material Variance Report** compares the BOM quantity expected for production with actual stock consumption over a date range. It is a read-only analysis report, not a transaction for entering or posting a variance.

Expected usage is based on the BOM version effective on each production date. Actual usage nets Material Issue, Stock Adjustment, and Physical Count movements, so it can differ from the total on Material Issue alone.

## Before you start

- Production and related stock movements for the period are posted.
- BOM versions and effective dates are correct for the production dates being analyzed.
- The user can access the selected company and has Material Variance Report access.

## Step by step

1. Open **Material Variance Report** and select the company and From/To dates.
2. Run the report. Review the items produced during the range first; this is the output population used in the comparison.
3. For each component, compare Expected (BOM), Actual, Variance, and Variance %. A positive variance means actual consumption is higher than expected; a negative variance means it is lower.
4. Check the warning on any produced item with no BOM effective on its production date. Its output is listed, but it is not included in expected component consumption.
5. Copy the result table to a spreadsheet for investigation or use Print for a review copy. Trace an unexpected figure to the BOM version, production posting, and material movements in the same date range.

## What happens in the books

Running, copying, or printing the report does not change inventory, production documents, or the general ledger. The report explains quantity differences; correct the underlying BOM, production, issue, stock adjustment, or count document through its own module. It does not create a variance journal.

## Rights

The Material Variance Report's **access** right controls the report. It is separate from the rights to create Production, Material Issue, Stock Adjustment, or Physical Count documents.

## Questions and mistakes

- **No rows appear:** check the company and date range, and confirm production or component stock movement was posted in that period.
- **Expected quantity is missing:** check that the item had an active BOM on the production date. A BOM created later does not retroactively define earlier production.
- **Actual differs from Material Issue totals:** the report also nets relevant Stock Adjustment and Physical Count movements, and reversal movements cancel their originals.
- **Variance looks doubled after a reversal:** verify both the original production and its reversal are posted; a reversal should cancel the original output and expected usage.
- **A large positive or negative amount:** drill into production quantities, the effective BOM component quantities, and all stock movements for that material before changing a source record.

## Related pages

[Production](production.html) · [Bill of Materials](bill-of-materials.html) · [Material Issue](material-issue.html) · [Stock Adjustment](stock-adjustment.html) · [Physical Count](physical-count.html)
