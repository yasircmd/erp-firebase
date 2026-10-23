---
title: Fixed Asset Configuration
area: assets
order: 1
modules: [FACONFIG]
sources: [functions/src/fixedAssetsConfig.js]
summary: Configure the fixed asset classes, accounts and defaults used when assets are added and depreciated.
reviewed: 2026-10-23
fingerprint: 502711f749ffca59
---
## What it is for

**Fixed Asset Configuration** has three tabs: **Settings**, **Account Determination**, and **Asset Classes**. Together they determine where acquisitions first post, which accounts each asset class uses, and the default valuation/depreciation rules for new assets.

## Before you start

- Fixed Asset Clearing, cost, accumulated depreciation, expense, and any work-in-progress accounts are agreed with Finance.
- Active postable accounts exist in the Chart of Accounts with the correct type and company/shared scope.
- Finance has agreed the asset kinds, useful lives, depreciation methods, residual value, and account assignment.

## Step by step

### Settings tab

Select a company and set its **Fixed Asset Clearing Account**. Asset purchases entered through supported finance/procurement documents first accumulate here; Asset Capitalization later transfers the amount to the asset's cost account. The clearing account must be an active postable Asset or Liability account, not cash/bank, a party control account, or an account already controlled by Fixed Assets.

### Account Determination tab

Create a coded determination, then select its **Shared** row or a specific company row. Map the accounts displayed for the asset functions, such as asset cost, accumulated depreciation, depreciation expense, clearing, and work in progress. A blank company field falls back to the shared row. The class points to a determination; accounts are not entered separately on each asset.

Check every account's type, active/postable status, and company ownership. Asset-controlled accounts cannot be used as cash/bank or in incompatible roles.

### Asset Classes tab

Create a class and choose its kind: Tangible, Intangible, Land, or Assets under Construction (AuC). For depreciable Tangible/Intangible classes, set the default Straight Line or Written Down Value method, useful life, WDV rate when applicable, and residual percentage. Select an account determination and choose whether the class is shared or company-specific.

Land and AuC are not depreciated by the ordinary scheduled run. AuC is used for accumulation and later settlement into completed assets. Test one representative asset and acquisition/capitalization flow before using a class operationally.

## What happens in the books

Configuration saves no journal. The clearing account is used by acquisition postings, account determinations are used by capitalization/depreciation/retirement postings, and asset classes provide defaults to asset records. Changing an account mapping does not rewrite previously posted journals.

## Rights

FACONFIG **access** allows viewing; **write** allows changing settings, determinations, and classes. Restrict write access to Fixed Asset/Finance setup owners.

## Questions and mistakes

- **Purchase cannot use the clearing account:** use a postable Asset or Liability account for the correct company; do not choose cash/bank, a vendor/customer control account, or an asset-controlled account.
- **Company account is rejected in Shared:** shared rows need shared accounts. Put a company-owned account in that company's override row.
- **Class cannot be selected:** check that it is Active, is shared or belongs to the selected company, and points to an active account determination.
- **Class kind or company cannot be changed:** once assets use the class, its kind and company scope are protected.
- **Depreciation does not post:** verify the class's determination contains the expense and accumulated-depreciation accounts, and the asset has a cost center.

## Related pages

[Fixed Asset Master](fixed-asset-master.html) · [Capitalization](fixed-asset-capitalization.html) · [Depreciation Run](depreciation-run.html) · [Capital Work in Progress](capital-work-in-progress.html)
