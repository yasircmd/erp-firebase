# Direct Retail Sales (agreed 2026-10-09)

## The owner's request (2026-10-09)

> Develop a Direct Retail Sales module that allows users to bill and sell
> inventory directly without creating a Sales Order (SO) or Delivery Note.
> - Customer Selection: an existing customer or a default customer named
>   "Retail Customer".
> - Sales Type: a default sales type, which can be changed when required.
> - Customer Details: optional name, address and tax registration number.
>   If none is entered, they are left off the printed invoice.
> - Multiple Payment Methods: one or more for a sale, such as Cash, Card,
>   QR Code/Scan Payment, Promotion Code and other configured methods.
>   Split payments across methods.
> - Ledger Mapping: each payment method is mapped in advance to its ledger
>   account (Cash, Bank, Card Clearing, Promotional Discounts), so the
>   entries are generated automatically.
> - Inventory and Accounting Integration: confirming the sale updates
>   inventory, generates the sales invoice and posts revenue, tax,
>   inventory, COGS and payment entries by the configured rules.

## Today

A sale takes three documents: Sales Order (reserves stock), Delivery Note
(stock out: Dr Sales COGS, Cr Inventory, at cost) and Customer Invoice
(Dr Trade Receivables; Cr revenue by Sales Type; Dr Discount Given; Cr
Output Tax; round off). The payment is a fourth: a Cash & Bank receipt
settling the invoice. None of this fits a counter sale.

What a retail sale reuses:
- **Sales Types** (Sales Invoice Configuration): each maps a revenue
  account and may be restricted to a customer classification.
- **The company's fixed accounts**: Discount Given, Output Tax, Round Off.
- **Items**: their Inventory and Sales COGS accounts; batch tracking.
- **Price lists**: the price effective on a date, picked by the
  customer's classification.
- **stockMovement.js**: the stock ledger, cost and batches, the same as
  Delivery Note and Sales Return.

## Proposed

### A new module: Retail Sales (`RETAILSALES`)

A counter screen: pick the customer, scan or pick items, take the
payments, **Confirm**. One step, no draft-and-approve. Rights: access,
sell (confirm), reverse; Setup needs its own right.

### Setup, per company

- **Default customer** "Retail Customer". It is created in Customer
  Master by the setup (Classification Local, the company's Trade
  Receivables account), so the normal customer reports and SOA see it.
- **Default Sales Type**, changeable on the sale. A Sales Type restricted
  to a classification still applies (as on the Customer Invoice).
- **Default warehouse** (the store), changeable on the sale.
- **Default price list** for the Retail Customer; an existing customer
  takes the list for their classification, as on a Sales Order.
- **Payment methods**: a name, a kind (Cash, Card, QR / scan, Promotion,
  Other), the ledger account it posts to, whether it needs a reference
  (card slip, transaction ID, promotion code), and Active. Seeded with
  Cash, Card, QR Code, Promotion Code; any number can be added.

### The sale

- **Customer:** the Retail Customer by default, or an existing customer
  of the company. Optional **name, address, tax registration number**
  printed on the invoice; when all are blank the invoice prints no
  customer block. For an existing customer they default from Customer
  Master.
- **Lines:** item, quantity, price (from the price list, editable when
  the user has the right), line discount; batch for batch-tracked items,
  defaulted first-expiry-first-out. Stock checked at confirm, under the
  global lock; a sale can't take a warehouse negative.
- **Totals:** subtotal, discount, tax, round off, total — the Customer
  Invoice's own formula (tax on the net of discount).
- **Payments:** one or more rows (method, amount, reference). Split
  across methods; cash can be over-tendered and the change is shown and
  printed, not posted.
- **Confirm:** one GL entry, prefix `RS`, voucher type `RetailSale`,
  reference sequence TXN- (a finance document, decision 50), and one
  stock movement:

| Dr / Cr | Account | Amount |
|---|---|---|
| Dr | each payment method's account | what it paid |
| Dr | Discount Given | the discount |
| Cr | Revenue (the Sales Type's account) | the goods |
| Cr | Output Tax | the tax |
| Dr / Cr | Round Off | the round off |
| Dr | Sales COGS (item's) | at cost |
| Cr | Inventory (item's) | at cost |

  A Promotion method's account is an expense (Promotional Discounts):
  the promotion is recorded as a cost, not cash. The invoice is the
  sale itself: number, date, lines, totals and payments, printable as a
  receipt or A4.
- **Reverse:** the whole sale, from the module (stock back at the cost
  it left at, the GL entry reversed), with a reason.

### Reports and links

The sale shows in the stock ledger, the GL (opening in Retail Sales), the
customer's SOA (both sides, net zero when fully paid) and a Retail Sales
register by day, user and payment method, which is the end-of-day
cash-up.

## Open questions

52. **Unpaid balance:** must every sale be paid in full at the counter?
    - Retail Customer: always fully paid; an existing customer may leave
      a balance on account (Dr Trade Receivables, an open invoice in their
      SOA) — recommended;
    - or every sale fully paid, no credit.
53. **Prices and tax:** are retail prices entered tax-inclusive?
    - Tax-inclusive (the shelf price is what the customer pays; tax is
      worked out of it), with a company tax % — recommended for retail;
    - or tax-exclusive, added on top, as on the Customer Invoice.
54. **Promotion Code:**
    - A payment method like any other: the cashier enters the code as its
      reference and the amount; posted to Promotional Discounts —
      recommended for now;
    - or managed codes (value or %, validity dates, single use), checked
      at the counter.
55. **Returns:**
    - Reverse a whole sale now; a retail return of part of a sale (refund
      by method) as a later step — recommended;
    - or partial returns in this step.

## The owner's decisions (2026-10-09)

| # | Question | Decision |
|---|---|---|
| 52 | Unpaid balance | **The Retail Customer always pays in full; an existing customer may leave a balance on account** (Dr Trade Receivables, an open invoice in their SOA). |
| 53 | Prices and tax | **Tax-inclusive**: the price is what the customer pays; tax is worked out of it at the company's tax %. |
| 54 | Promotion Code | **A payment method**: the code as its reference, posted to Promotional Discounts. Managed codes later. |
| 55 | Returns | **Reverse a whole sale now**; a partial retail return later. |
