---
title: Vendor Master
area: procurement
order: 2
modules: [VENDORMASTER]
sources: [functions/src/partyLedger.js]
summary: Maintain the supplier record used in requisitions, purchase orders, GRNs and supplier bills.
reviewed: 2026-10-17
fingerprint: cb3abc64dd8f4738
---
## What it is for

**Vendor Master** keeps every supplier record used by the buying process. The ERP reuses this record when a purchase is raised, received and finally invoiced.

## Before you start

- The company and the vendor account structure are set up in the ERP.
- The vendor's tax and company details are known.
- If the company wants supplier controls, the approval and payment rules are already defined.

## Step by step

1. Open **Vendor Master** and choose the company.
2. Add or update the vendor's basic details: name, address, contact and tax information.
3. Complete the trade details needed for purchasing and payment processing.
4. Save the vendor and test a PO or GRN using that vendor.

## A vendor in a foreign currency

Set **Default Currency** to the vendor's currency (for example USD) and
its invoices, payments and statement are in it, at the rates in
[Currency Configuration](currencies.html). Leave it on the company default
for a local vendor. Once the vendor has invoices or payments, its currency
can't change: create a new vendor for another currency.

## What happens in the books

Vendor Master stores the supplier identity used by the purchase flow. The actual accounting impact appears later when the supplier bill and any related payments are posted.

## Rights

Typically a procurement or master-data role can maintain vendors. Full setup rights are usually limited to admin or finance support users.

## Questions and mistakes

- If a vendor is missing from the dropdown, the record may not be saved or the company filter may be wrong.
- If a supplier bill cannot be matched, check that the company and vendor on the PO and GRN are the same supplier record.
