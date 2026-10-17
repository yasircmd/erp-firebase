---
title: Vendor Invoice
area: procurement
order: 7
modules: [VENDORINVOICE]
sources: [functions/src/grn.js, functions/src/partyLedger.js]
summary: Match the supplier bill to the received GRNs and post the payable amount to the company books.
reviewed: 2026-10-16
fingerprint: 9e3da5b26d5e85fd
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

## A vendor in a foreign currency

If the vendor's **Default Currency** (Vendor Master) is not the default
currency, its invoice is in that currency:

- the screen shows **Currency and rate**: the rate on the invoice date,
  from [Currency Configuration](currencies.html);
- you may type another rate, with a reason;
- the total shows in the vendor's currency, with its value in the default
  currency beside it;
- for now such an invoice takes **direct lines only**: GRNs stay in the
  default currency.

The books are in the default currency, at the invoice's rate; each line
keeps its foreign amount too. A reversal uses the invoice's own rate.

## Project

Once the company has projects, the invoice has a **Project** field: every
line the invoice posts carries it, for the
[Project Report](project-report.html).

## What happens in the books

The vendor invoice records the supplier liability and clears the matched purchase value from the receiving side. This is the main point where the purchase becomes a balance in accounts payable.

## Rights

Users need access and post rights for supplier invoice processing; approval may be required in some companies.

## Questions and mistakes

- If the invoice is refused, the supplier, GRN or company may not match.
- **"No exchange rate for USD on or before …"**: enter a rate in Currency Configuration → Rates.
- If the amount does not tie to the GRN, recheck the posted receipt and the supplier bill.
