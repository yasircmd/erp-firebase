---
title: Retail Sales
area: sales
order: 8
modules: [RETAILSALES]
sources: [functions/src/retailSales.js]
summary: Process a retail transaction at the counter, settle the sale and print or record the receipt.
reviewed: 2026-10-12
fingerprint: 7222f83393b82685
---
## What it is for

**Retail Sales** has four tabs: **Counter**, **Sales**, **Returns**, and **Setup**. Counter records a sale; Sales reports and opens completed transactions; Returns records eligible partial returns; Setup configures company defaults and payment methods. Returns is visible only to users with the return right.

## Before you start

- In **Setup**, configure the default Sales Type, store warehouse, sales cost center, tax-inclusive retail price list/tax rate, Retail Customer receivable account, return period, counter price/discount permissions, receipt options, and payment methods/account mappings.
- Items are active, stocked in the store warehouse, and have a retail price or the user is permitted to change prices.
- User rights are set for selling, setup changes, reports, reversal, and returns.

## Step by step

### Counter tab

1. Select company, date, customer, Sales Type, and store warehouse. Enter optional invoice bill-to details when needed.
2. Scan the item's barcode or enter its code/name. Confirm stock, quantity, price, and any allowed line discount. A barcode configured as a pack can add its pack quantity.
3. Add one or more payment lines. Cash may be over-tendered and produces change; non-cash methods cannot exceed the sale total. A Retail Customer must pay in full; an existing customer may leave an on-account balance.
4. Review the tax-inclusive total, tax, discount, paid amount, change, and any balance due. Confirm the sale. The screen assigns a transaction number and can print the configured receipt on confirmation.

### Sales tab

Filter sales by date range and show either the sales list or the payment-method report. Open a sale to review/print its invoice, return items (with the return right), or reverse the entire sale (with the applicable posting right). A user without the all-sales report right sees only sales they billed.

### Returns tab

Find the original invoice by scanning its receipt barcode or entering its invoice number. Enter return quantities, a reason, and the refund breakdown, then confirm. The open on-account balance is reduced first; the rest is refunded by the original payment mix. A promotion portion is reversed rather than paid out. Returns must be within the configured return period unless it is set to no limit.

### Setup tab

Set the company defaults and receipt options, then map every payment method to its ledger account. Cash, card, and QR methods use cash/bank/clearing Asset accounts; Promotion uses a discount Expense account and requires a promotion code. Verify the Retail Customer and sales defaults before enabling counter use.

## What happens in the books

Confirming a sale posts one journal and an inventory transaction: payment accounts are debited for amounts received, Trade Receivables is debited for any customer balance, Discount Given is debited, Sales revenue and Output Tax are credited, and inventory cost is debited to Sales COGS/credited to inventory. The sale number uses the retail reference sequence. A full reversal mirrors the original sale. A partial return posts the return's sales/tax/discount/refund and restores stock at the cost it left at.

## Rights

RETAILSALES **access** opens the screen; **post** permits selling and full reversal; **write** maintains Setup; **report** permits viewing all users' sales; **return** permits partial returns. Without report, users see their own billed sales. Company access applies.

## Questions and mistakes

- **Counter is unavailable:** configure the company in Setup first; the default warehouse, Sales Type, cost center, and receivables account are required.
- **Item cannot be added:** check company eligibility, status, barcode, stock in the store warehouse, price-list date, and whether price changes are allowed.
- **Sale cannot be confirmed:** check quantities, payment totals, required payment references, Retail Customer full-payment rule, and the company's open-period status.
- **Payment method/account is wrong:** correct the mapping in Setup; a confirmed sale is corrected by reversal, not by changing its original payment line.
- **Return cannot be found or confirmed:** confirm invoice number, return right, remaining unreturned quantity, reason, and configured return window.
- **Refund differs from original tender:** the open account balance is reduced first; remaining refund follows original payment proportions and promotion amounts are not paid as cash.

## Related pages

[Sales Invoice Setup](sales-invoice-setup.html) · [Price Listing](price-listing.html) · [Sales Return](sales-return.html) · [Stock Availability](stock-availability.html)
