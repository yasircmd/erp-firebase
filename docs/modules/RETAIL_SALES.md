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

## As built (2026-10-09)

Where it differs from the proposal above, the build is the record:

- **No batch on the way out.** The stock ledger has no batch dimension
  (item and warehouse only); Delivery Note doesn't take one either, so a
  sale doesn't ask for it.
- **One retail price list per company** (Setup), for every customer at
  the counter, with tax-inclusive prices. "Prices can be changed at the
  counter" is a setup choice; when it is off, the server always takes the
  list's price, whatever the screen sends.
- **No round off**, and **no seeded payment methods**: each company adds
  its own (Cash, Card, QR, Promotion, Other).
- **Stock** is checked against the ledger only, like Delivery Note and
  Material Issue (reservations of Sales Orders don't hold it back).
- **The cost center** of the revenue, COGS, discount and promotion lines
  is the one set in Setup.
- **An existing customer's SOA** shows only the balance left on account
  (a "Retail Sale" row, an open item settled later by a receipt); a sale
  paid in full doesn't touch receivables.

**Server:** functions/src/retailSales.js.
- `getRetailSalesSetup`, `saveRetailSalesSettings` (makes the Retail
  Customer, code CL-…, Local, once per company), `saveRetailPaymentMethod`
  (Cash, Card, QR, Other post to an asset account; Promotion to an expense
  account and always needs its code).
- `getRetailCounter` (customers, items with price and stock),
  `confirmRetailSale` (under the global lock: stock Out at average cost,
  one GL entry `RetailSale`, prefix RS, reference TXN-), `getRetailSales`
  (the register and the cash-up by method), `getRetailSale` (by sale, or
  by journal for the GL report), `reverseRetailSale` (whole sale, with a
  reason; refused while its on-account balance has been settled).
- Rights (module `RETAILSALES`): access; post = sell and reverse; write =
  setup.
- Registries: module, permissions, menu seed ("Retail Sales" under
  Accounts Receivable), voucher prefix RS, finance sequence, GL report and
  Journal Vouchers maps (Journal Vouchers refuses to reverse it), SOA
  label "Retail Sale".

**The posting** for 2 × 52.50 + 1 × 21.00 less 5.00 discount, tax 5%
included, paid card 60, promotion 10, cash 100 (change 49):

| Account | Dr | Cr |
|---|---|---|
| Cash | 51.00 | |
| Card Clearing | 60.00 | |
| Promotional Discounts | 10.00 | |
| Discount Given | 4.76 | |
| Sales (Sales Type) | | 120.00 |
| Output Tax | | 5.76 |
| Cost of Sales | 47.50 | |
| Inventory | | 47.50 |

**Screen:** screens/RETAILSALES.html: Counter (items by code or name,
Enter adds; payments with "Rest"; change and amount due shown; Confirm),
Sales (register by dates, cash-up, the invoice, Print, Reverse), Setup.
The printed invoice leaves the customer block off when no details were
entered.

**Tests:** `retailSales.emulator.test.js` (5) and `retailSales.ui.js` (5),
plus the smoke check. Negative controls caught: tax worked out
exclusive; the Retail Customer's full payment not enforced; a promotion
on an asset account; a reversal not returning the stock; the customer
block always printed; the counter's Confirm open to a Viewer.

**Deploy:** `tools/deploy-sets/retail-sales.txt` with `--screens`
(RETAILSALES).

## Change 2026-10-09 (owner): no empty Discount column

The invoice (on screen and printed) shows the Discount column only when
some line has a discount; otherwise it is Item, Qty, Price, Amount. A
screen change only, released with `retail-sales` (`--screens`). Test:
`retailSales.ui.js` (both cases); negative control (the column always
shown) caught.

## Change 2026-10-09 (owner): who sees which sales; Excel; payment-wise report

> Limit normal counter users to see their billing reports only in the
> sales tab; add an option in the role for who can access the full sales
> report. The sales tab: copy to Excel, and a payment-wise report.

- **A new right, `report`** ("Report" in Roles & Permissions, Retail
  Sales): every user's sales. Default roles: Admin and Finance Manager.
  Without it a user sees **only the sales they billed** (the user who
  confirmed them):
  - in the Sales tab ("Showing the sales you billed."); a filter by
    another user is ignored;
  - opening a sale (or its journal from the GL report) and reversing it:
    another's sale is refused, "You can open only the sales you billed
    yourself."
  A reversal is billed by whoever reversed it; the original stays in its
  cashier's list, marked Reversed, and leaves their takings.
- **With the right:** a "Billed by" filter (everyone, or one user).
- **Report: By payment method:** each payment of the live sales (neither
  reversed nor a reversal) grouped by method: date, number, customer,
  reference, billed by, amount (cash net of change), a subtotal per
  method and the total taken. The summary line adds what was left on
  account and the total sales.
- **Copy to Excel** copies the report on show (Sales or By payment
  method, with its subtotals), tab-separated, dates as dd/mm/yyyy.

Server: `getRetailSales` (filter by the right; `billedBy`; `payments`,
`byMethod` with counts, `onAccount`, `total`, `billers`), `getRetailSale`
and `reverseRetailSale` (own sales only without the right),
`getRetailSalesSetup` (`canReport`); module registry (`report`, default
Admin and Finance Manager). Tests: the emulator suite's 6th test, the UI
check's 6th; negative controls caught: the list not filtered by user,
another's sale opened without the right, Copy to Excel ignoring the
payment-wise view. Released with `retail-sales` (not yet deployed).

## Change 2026-10-09 (owner): Clear asks first

The counter's **Clear** asks "Clear this sale? N lines and the payments
entered will be removed." once anything is entered (an item line, a
payment amount or reference); Cancel keeps the sale as it is. An empty
sale clears without asking. Screen only (RETAILSALES.html, `clearSale`).
Tests: the UI check's 5th; negative controls caught: Clear without
asking, Cancel ignored. Released with `retail-sales` (not yet deployed);
if that is already live, `tools/release-screens.sh` is enough.

## Partial returns (proposed 2026-10-09, owner's request)

> Now complete the partial return of a retail sales invoice. What is the
> best way — searching with the invoice number?

Decision 55 left this for later: today a sale can only be reversed whole.

### Finding the sale

The invoice number is the right key: it is unique, printed on every
receipt, and the customer has it in hand. Two additions make it quick
and safe:
- **A barcode of the invoice number on the printed receipt** (Code 128,
  drawn by barcodeSvg.js from the labels step), so the cashier scans the
  receipt into the Return box instead of typing it. Typing still works.
- **No receipt:** a holder of the "report" right can find the sale in
  the Sales tab by date and customer, and start the return from there.

A cashier finds a sale **by its exact number** even when another cashier
billed it, because returns are taken at any counter. Browsing other
people's sales still needs the "report" right.

### The return

- A new **Return** tab (or a Return button on an opened sale) shows the
  sale's lines with the quantity sold, the quantity already returned
  and a **Return qty** column, which starts at 0.
- A line can be returned up to what is left on it. Several returns
  against one sale are allowed until everything has been returned.
- **The value of each returned unit is what the customer actually paid
  for it:** the line's price less its discount share, pro rata by
  quantity. The tax share is worked out the same tax-inclusive way.
  When the last unit of a line is returned, it takes the exact
  remainder, so the returns add up to the sale to the cent.
- **The goods come back** into the sale's warehouse at the cost they
  left at (the line's UnitCost), the same rule Sales Return uses.
- **A sale with any partial return can no longer be reversed whole.**
  What is left of it is returned instead. The whole-sale reversal stays
  for a sale with no returns.

### The refund

- If the sale left a balance on account that is still open, the return
  **reduces that balance first** (Cr Trade Receivables against the sale).
  Only what remains is refunded.
- The refund is split by method; see question 77.
- A Promotion method's share is **reversed, not paid out**: the
  customer doesn't get cash for a promotion.

### The posting (one GL entry, voucher type `RetailReturn`, prefix `RR`, reference TXN-)

| Dr / Cr | Account | Amount |
|---|---|---|
| Dr | Sales Returns (the Sales Type's, as Sales Return uses) | the goods, net of tax |
| Cr | Discount Given | the returned share of the discount, net of tax |
| Dr | Output Tax | the returned share of the tax |
| Cr | each refund method's account | what it refunds |
| Cr | Promotional Discounts | the promotion share reversed |
| Cr | Trade Receivables | the open on-account balance reduced |
| Dr | Inventory (item's) | at the cost it left at |
| Cr | Sales COGS (item's) | at the cost it left at |

The return prints like the sale, as a **Return Receipt**, with the
original invoice number, the lines and the refund by method. It appears
in the register (marked Return, linked to its sale), and the cash-up and
payment-wise report show it as negative takings for the refund methods.

### Reversing a return

A mistaken return is reversed whole, with a reason. The goods leave
again at the cost they came back at, and the entry is mirrored. The
reversal is refused when stock is short.

## Open questions (partial returns)

76. **Finding the sale:**
    - The invoice number, typed or scanned from a barcode printed on the
      receipt; without a receipt, a "report" right holder finds it by
      date and customer — recommended;
    - or the invoice number only, typed.
77. **Refund by method:**
    - The original way by default: each method gets back its share pro
      rata; the promotion share is
      reversed, not paid out. The cashier may move a card or QR share to
      cash (e.g. the card terminal is down) — recommended;
    - or strictly the original methods, no changes;
    - or the cashier chooses any methods freely.
78. **Who can take a return, and a time limit:**
    - A new right **"return"** in Roles & Permissions (default Admin and
      Finance Manager; given to counter staff as the business decides),
      and a **return period in days** per company in Setup (0 = no
      limit) — recommended;
    - or anyone with the "post" (sell) right, no time limit.
79. **Returned goods' condition:**
    - All back into the store's stock at the cost it left at; damaged
      goods are then written off with Stock Adjustment, as today —
      recommended for now;
    - or the cashier marks each line "resaleable" or "damaged", and
      damaged goods go to a damaged-goods warehouse set in Setup.

## The owner's decisions (partial returns, 2026-10-09)

| # | Question | Decision |
|---|---|---|
| 76 | Finding the sale | **The invoice number, typed or scanned** from a barcode printed on the receipt; without a receipt, a "report" right holder finds it by date and customer. |
| 77 | Refund by method | **The original way by default**, pro rata; the promotion share reversed, not paid out; the cashier may move a card or QR share to cash; an open on-account balance reduced first. |
| 78 | Rights and time limit | **A new "return" right** (default Admin, Finance Manager) and **a return period in days** per company in Setup (0 = no limit). |
| 79 | Returned goods | **All back into the store's stock** at the cost they left at; damaged goods written off with Stock Adjustment. |
