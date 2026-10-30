---
title: Fixed Asset Retirement
area: assets
order: 8
modules: [FARETIRE]
sources: [functions/src/fixedAssetsRetirement.js]
summary: Retire a fixed asset when it is sold, scrapped or otherwise removed from service.
reviewed: 2026-10-30
fingerprint: c9852e22575b3571
---
## What it is for

**Fixed Asset Retirement** records the removal of an asset from the fixed asset register when it is sold, discarded or otherwise disposed of.

## Before you start

- The asset is in the register and is active.
- The retirement date and proceeds are agreed.
- Any gain or loss account mapping is configured.

## Step by step

1. Open **Fixed Asset Retirement** and select the asset.
2. Enter the disposal date, proceeds and reason for retirement. For a sale, when the company has a [Tax Configuration](tax-configuration.html), choose the sale's **Tax code**; the totals show the tax by component.
3. Review the asset’s net book value and gain or loss on disposal.
4. Post the retirement and verify the asset is closed off correctly.

## What happens in the books

The retirement removes the asset from service and posts the net book value and any gain or loss to the relevant accounts.

A sale's tax is worked out from its tax code at the rate on the retirement date. Under India GST it is CGST + SGST when the buyer is in the company's state, or the sale is to the bank, and IGST when a customer is in another state. Each component is credited to its output account, and the receipt (bank or customer) carries the proceeds plus the tax.

## Rights

Finance and asset support roles normally handle retirement posting.

## Questions and mistakes

- **Choose the sale's tax code:** a company with a Tax Configuration needs one on every sale.
- If the asset does not retire, confirm the asset is still active and the disposal date is in an open period.
