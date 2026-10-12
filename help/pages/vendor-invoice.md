---
title: Vendor Invoice
area: procurement
order: 7
modules: [VENDORINVOICE]
sources: [functions/src/grn.js, functions/src/partyLedger.js]
summary: Match the supplier bill to the received GRNs and post the payable amount to the company books.
reviewed: 2026-10-12
fingerprint: 5a5948b5618c6e36
---
## What it is for

**Vendor Invoice** records the supplier bill against the received goods or services. It checks the invoice against the GRNs and records the payables impact in the ledger.

## Before you start

- The GRN is posted and the purchase is received.
- The supplier and company match the PO and GRN.
- The invoice amount and quantities are ready for verification.

## Step by step

1. Open **Vendor Invoice** and choose the company.
2. Choose the supplier and the relevant GRNs to match.
3. Review the items, quantities and amounts before posting.
4. Save or post the vendor invoice once the supplier bill is confirmed.
5. Review the payables impact in the ledger.

## What happens in the books

The vendor invoice records the supplier liability and clears the matched purchase value from the receiving side. This is the main point where the purchase becomes a balance in accounts payable.

## Rights

Users need access and post rights for supplier invoice processing; approval may be required in some companies.

## Questions and mistakes

- If the invoice is refused, the supplier, GRN or company may not match.
- If the amount does not tie to the GRN, recheck the posted receipt and the supplier bill.
