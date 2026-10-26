---
title: Price Listing
area: sales
order: 3
modules: [PRICELISTING]
sources: [functions/src/masterData.js]
summary: Review and maintain the item prices and rates used for sales transactions and customer orders.
reviewed: 2026-10-26
fingerprint: 71e3f040017bff69
---
## What it is for

**Price Listing** shows the current sales prices used by the company. It is where price rules, customer pricing and standard list prices are reviewed and updated.

## Before you start

- The item master is complete.
- The company and sales type are known.
- The pricing policy is agreed for the customer or item group.

## Step by step

1. Open **Price Listing** and filter by item, customer or sales type.
2. Review the effective price and any discount or price basis.
3. Update the list or customer price when the commercial terms change.
4. Save and test the quotation or sales order using the new price.

**Prices include tax**: tick it for a list whose prices already hold the tax
(a shop's prices, for example). Where the company has a
[Tax Configuration](tax-configuration.html), a
[Customer Invoice](customer-invoice.html) for an order on this list takes
the tax out of the price instead of adding it. Untick it (as it starts) for
prices before tax.

## What happens in the books

Price Listing itself does not create accounting entries. It just sets the rate the sales transaction uses when it is posted.

## Rights

Sales managers, pricing maintainers and admin users typically have access; end users normally only read.

## Questions and mistakes

- A sales order using the wrong price usually means the item or customer pricing was not updated.
- If the price list is blank, check whether the item is active and whether the company filter is correct.
