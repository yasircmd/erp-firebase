---
title: Purchase Return / Debit Note
area: procurement
order: 8
modules: [PURCHASERETURN]
sources: [functions/src/purchaseReturn.js, functions/src/grn.js, functions/src/purchaseTax.js]
summary: Return goods to the supplier, reverse the stock and capture the debit note for the vendor return.
reviewed: 2026-10-30
fingerprint: be577db14cfa84cf
---
## What it is for

**Purchase Return / Debit Note** records stock being sent back to a supplier. It reverses the value and quantity taken from the original purchase and keeps a record for the supplier's debit note.

## Before you start

- The original invoice or GRN is still valid for return.
- The supplier and company details are known.
- The item quantity being returned is confirmed and the reason is recorded.

## Step by step

1. Open **Purchase Return / Debit Note** and choose the company.
2. Select the vendor and the source invoice or GRN line.
3. Enter the return quantity and the reason for the return.
4. Post the return. The system updates the stock and the supplier return ledger.
5. Review the resulting value and any variance entries created by the return.

## What happens in the books

The return reduces stock and may create a variance if the return value differs from the original cost. The supplier balance also reflects the return or debit note.

### An invoice taxed by line

When the invoice was taxed by line ([Tax Configuration](tax-configuration.html)),
each returned line takes its share of its invoice line's tax, by quantity,
at the codes and rates the invoice used:

- the input tax the invoice reclaimed is credited back;
- under reverse charge, the output tax is debited back;
- tax that couldn't be reclaimed was in the goods' cost. The goods leave at
  that cost, so the vendor's refund of it goes with the return's variance.

The Tax line shows **by line**.

## Rights

Users need access and post rights for returns, plus approval rights if the company uses approval on returns.

## Questions and mistakes

- A return can be refused if the source invoice or GRN line is already fully returned or reversed.
- If the return value differs from the expected value, review the original vendor invoice and the stock cost used in the receipt.
