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

**Depreciation Run** has two tabs: **Run** previews and posts the scheduled charge for one company and month; **Depreciation Register** reports asset balances over a period range. The run uses each asset's class, method, depreciation start, posting history, and any catch-up due.

## Before you start

- Assets are capitalized, active, and assigned to a depreciable tangible or intangible class with a start date and Straight Line or Written Down Value method.
- Fixed Asset Configuration contains valid depreciation expense and accumulated depreciation accounts.
- Every asset in the run has a cost center for the expense posting.
- The month is open for Fixed Asset posting. Runs are posted in monthly order without gaps.

## Step by step

### Run tab

1. Select the company and month. The screen shows the last posted month and the next month allowed; the first run may start at the chosen period.
2. Select **Preview**. Review each asset's opening net book value, scheduled charge, catch-up, accumulated depreciation, closing net book value, method, and notes. Review totals by class and expense account.
3. Resolve every blocker or asset error before posting. Typical blockers include a period out of sequence, an already-posted month, another run still in progress, missing account determination, no cost center, or nothing eligible to depreciate.
4. Select **Post Depreciation** after reviewing the preview. Posting recalculates the run and writes the asset transactions and GL journal. If posting was interrupted, reopen the same period and use **Finish Posting** to resume that run.
5. Review the run list and open **Lines** to inspect a posted or reversed run. Export the preview or lines to CSV when needed.

### Depreciation Register tab

Choose From and To periods, then **Show**. Review opening NBV, scheduled depreciation, additional depreciation, accumulated depreciation, and closing NBV by asset; use CSV for reconciliation.

### Reverse a run

Only the latest posted period can be reversed. Enter a reason. Reverse any later fixed-asset postings on the run's assets first. If the accounting month is closed, the system offers an adjustment in the first open month; confirm that prompt only when that treatment is intended. After reversal, the period can be posted again.

## What happens in the books

The run creates a journal dated on the period's last day: debit depreciation expense, grouped by account and cost center, and credit accumulated depreciation. It also writes a depreciation transaction for each asset, updates the asset's accumulated depreciation and net book value, and marks an asset Fully Depreciated when appropriate. No approval step is required by this screen; the **post** right controls posting.

## Rights

FADEPRUN **access** allows viewing runs/registers; **post** permits posting; **reverse** permits reversal of the latest run. Company access applies.

## Questions and mistakes

- **Asset is absent from preview:** check active status, tangible/intangible class, depreciation method, start date, remaining net book value, and selected company.
- **Posting is blocked:** resolve the account or cost-center errors and check that this is the next unposted month.
- **Run says posting is in progress:** reopen and post that same period to finish it before starting another.
- **Charge includes catch-up:** review the period history and depreciation start date; catch-up covers eligible depreciation from an earlier period not previously scheduled.
- **Need to reverse a non-latest period:** reverse later runs first; the process deliberately preserves chronological asset balances.
- **Month is closed:** review the offered first-open-month adjustment before continuing; do not edit the resulting GL journal directly.

## Related pages

[Fixed Asset Configuration](fixed-asset-config.html) · [Fixed Asset Register](fixed-asset-register.html) · [Additional Depreciation](additional-depreciation.html) · [Period Closing](period-closing.html)
