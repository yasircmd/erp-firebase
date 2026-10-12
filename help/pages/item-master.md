---
title: Item Master
area: inventory
order: 1
modules: [ITEMMASTER]
sources: [functions/src/masterData.js]
summary: Maintain the master item record used by purchase, stock movement, valuations and stock reports.
reviewed: 2026-10-12
fingerprint: 4769b083eb1bc423
---
## What it is for

**Item Master** is the core record for every stocked item. It defines the item, its stock rules, and the company data that allows purchasing and inventory movement.

## Before you start

- The item category and units are already set.
- The company has its stock accounts and item coding rules.
- The item is active for the relevant warehouse and company.

## Step by step

1. Open **Item Master** and choose the company.
2. Add or edit the item record: code, description, unit and category.
3. Set the stock and cost details required by the company.
4. Save the item and check it appears in the stock routines.

## What happens in the books

The item master does not create a ledger entry itself. It provides the item definition that the purchase, stock issue, transfer and valuation processes use.

## Rights

Users need write access for item setup. Read access is often broader than write access.

## Questions and mistakes

- If an item does not appear on a stock screen, check the item status and the company assignment.
- If the item has no cost basis, the system will not post a trade movement correctly.
