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

**Additional Depreciation** is a separate posting document for a justified, one-off charge beyond scheduled depreciation, such as damage or a policy-directed reduction. It applies only to Active Tangible or Intangible assets and cannot reduce an asset below its residual value.

## Before you start

- The asset is Active, depreciable, and has a valid class/account determination and cost center.
- The posting date is on or after the asset's capitalization/depreciation start and in or after the latest posted depreciation period.
- The reason, amount, and approval policy are documented; an amount above NBV less residual value is rejected.

## Step by step

1. Open Additional Depreciation and create a draft. Select company, date, required reason, optional description/reference, and one or more eligible assets.
2. For each asset, compare current NBV and **At most** with the proposed additional amount. Enter no more than NBV less residual value.
3. Review the total and the displayed GL impact. Save/post the draft. If Approval Configuration is enabled, it becomes Pending Approval; nothing posts until approval. A rejected entry can be corrected and resubmitted.
4. After posting, open the GL entry and asset history to confirm the expense, accumulated depreciation, and new NBV. The scheduled depreciation engine spreads the lower remaining balance over the remaining life.
5. Reverse an incorrect posted entry with a reason. Reversal may be blocked if a later financial transaction exists on the asset; reverse later transactions first.

## What happens in the books

Posting debits the class's Additional Depreciation Expense account (or the configured Depreciation Expense fallback) and credits Accumulated Depreciation. The asset transaction records the reduction in NBV. The posting is separate from the scheduled Depreciation Run.

## Rights

FAADDDEP **access** controls viewing; **draft** creates/edits/deletes Draft or Rejected documents; **post** submits/posts, approves/rejects when assigned, and reverses. Company access and Approval Configuration apply.

## Questions and mistakes

- **Asset is not selectable:** it must be Active and Tangible or Intangible; Land, AuC, retired, and transferred assets are not eligible.
- **Amount is too high:** the maximum is current NBV less residual value as of the posting date.
- **Date is rejected:** use a date no earlier than capitalization/depreciation start and no earlier than the latest posted depreciation period; the accounting period must also be open.
- **Expense account missing:** configure Additional Depreciation Expense or its allowed Depreciation Expense fallback in Fixed Asset Configuration.
- **Reversal is blocked:** reverse later transactions affecting that asset first, then reverse this posting.

## Related pages

[Fixed Asset Configuration](fixed-asset-config.html) · [Fixed Asset Master](fixed-asset-master.html) · [Depreciation Run](depreciation-run.html) · [Approvals](approvals.html)
