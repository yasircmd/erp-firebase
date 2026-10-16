# Direct sales invoice, and Sales Order → invoice without a delivery (UX Tier 3, H)

Status: **design agreed** (owner, 2026-10-16: the recommendations, questions 166–172; UX_TIER3.md round 15).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, H).

## Today

There are three documents, and only the delivery moves stock:

- **Sales Order** reserves stock (Reserved / Partially Reserved). It posts
  nothing.
- **Delivery Note** is made only from Sales Order lines. The warehouse and
  price are the order's, and the quantity is up to what is ordered and
  reserved. Posting it sends the stock Out at average cost: **Dr Sales COGS
  / Cr Inventory**. It counts as delivered on the order and uses up the
  reservation.
- **Customer Invoice** takes posted deliveries (each invoiced whole) and/or
  **direct lines**. A direct line is a free-text charge with a Sales Type:
  this is how services and non-stock items are billed today. Posting it
  writes **Dr Receivables / Cr Revenue (by Sales Type) / Cr Output Tax**,
  with the discount and round-off. It touches no stock.
- **Sales Return** is made against an invoice, through the invoice's
  delivery lines. The stock comes back at the cost it left at. An invoice
  with only direct lines can't be returned (credit with a JV instead,
  SALES_RETURN.md decision 5).
- **Retail Sales** is the one sale that is its own invoice and issues
  stock. It posts revenue, tax, payment and COGS in one entry, and keeps
  each line's cost for returns. It is cash-and-carry, though: prices
  include tax, and it has no drafts, no approvals and no service lines.

## Proposal

### 1. A direct sales invoice

Customer Invoice gets a third kind of line, an **item line**: item,
warehouse, quantity and price. It sits beside the delivery lines and the
direct (service) lines, and one invoice can mix all three.

On posting, under the global lock as every posting is:

- The stock goes **Out** at average cost, refused if it isn't there, as a
  delivery is.
- One entry adds **Dr Sales COGS / Cr Inventory** to the invoice's
  revenue, tax and receivables lines.
- Each line keeps its cost (UnitCost), so a return can bring the stock
  back at that cost.
- A reversal brings the stock back In at the same cost and mirrors the GL,
  as a delivery's reversal does today.

The invoice also becomes a stock document, shown in the Stock Ledger and
the stock reports like a delivery. The checks are a delivery's: the
warehouse belongs to the company, and the quantity follows the unit's
decimals.

### 2. Sales Order → invoice, skipping the delivery

On the invoice, **From Sales Order** brings in the order's lines that are
still to deliver (ordered − delivered), as item lines locked to the
order's warehouse and price, as a delivery does. Posting the invoice then
does a delivery's work on the order too: it counts as delivered and uses up
the reservation. The order shows its lines as delivered, and a delivery
can no longer be made for them.

Partial invoicing follows the same rule as partial delivery: invoice part
of a line now, and the rest stays open on the order.

### 3. Returns

A return against such an invoice offers its item lines too, as it offers
delivery lines today, with the stock back at the line's cost. Service
lines stay as they are (credited with a JV) unless question 171 says
otherwise.

## What stays as it is

- The delivery flow (order → delivery → invoice) for companies that ship
  before they bill.
- Retail Sales.
- Approvals: an invoice with item lines goes through the Customer Invoice
  approval, as it does today.

## Questions for the owner

- **166.** May anyone who can post a Customer Invoice use item lines (sell
  from stock without a delivery), or only some users (a separate right,
  "invoice from stock")? Recommended: the same right as posting an
  invoice.
- **167.** Skipping the delivery from a Sales Order: allowed for every
  order, or chosen per company (some always deliver first)? Recommended:
  a company setting, "Invoices may deliver stock directly", **off** by
  default, so nothing changes until you switch it on.
- **168.** On an order that has been partly delivered, may the rest be
  invoiced directly (mixing a delivery and a direct invoice on one order)?
  Recommended: yes, line by line: what is not yet delivered can be invoiced
  directly.
- **169.** The price on an item line made **without** an order: the
  customer's price list where the item has one (changeable), as on a Sales
  Order? Recommended: yes, with the same "may change prices" rule as the
  Sales Order.
- **170.** The delivery-note print: should an invoice with item lines also
  print a **delivery slip** (items and quantities, no prices) for the
  driver or the store? Recommended: yes, a second print button, as the
  delivery has a packing list.
- **171.** Returns of service lines (direct lines), still only by JV, or
  should a return also credit service lines? Recommended: keep the JV for
  now (SALES_RETURN.md decision 5); it is a separate change.
- **172.** The month-end check "Deliveries posted, not invoiced" stays as
  it is (a direct invoice is never in it). Agreed?

## The owner's decisions (2026-10-16)

The recommendations, 166–172: item lines for anyone who may post an
invoice; skipping the delivery is a company setting, **off** by default;
the rest of a partly delivered order may be invoiced directly, line by
line; prices from the customer's price list with the Sales Order's
"may change prices" rule; a delivery slip print; service lines still
credited by JV; the "deliveries not invoiced" check unchanged.

## As built (2026-10-16)

- **Setting** (167): `salesInvoiceSettings/{companyId}.DirectStock`, via
  `getInvoiceStockSettings` / `saveInvoiceStockSettings` (Sales Invoice
  Configuration's write right), on the Sales Invoice Configuration screen.
- **Save**: `invoiceStock.cleanItemLines`, called from the legacy patch
  `invoice-item-lines-save` (mapped `cleanInvoiceItemLines_`), checks:
  - an active stock item of the company, a warehouse of the company,
    quantity above 0 (whole units where the UOM has no decimals), a price of
    0 or more, and a cost centre;
  - from an order: locked to the order's item, warehouse and price, up to
    what is still to deliver and reserved, summed per order line.

  The lines are stored as `ItemLines`, with one `ItemSalesTypeID`, and
  counted in the subtotal. The header cost centre is required (their
  revenue posts there). An invoice whose items were already delivered (a
  failed post after its delivery) can't change its lines.
- **Post** (`invoice-item-lines-post`):
  1. `createInvoiceDeliveryNote_` makes a Delivery Note (`AutoFromInvoiceID`,
     dated the invoice date) and posts it through the delivery's own
     `commitDeliveryNotePosting_`: stock out at average cost, its COGS
     entry, the order's delivered quantity and reservation.
  2. It is appended to the invoice's `SourceDeliveryNotes` and matched like
     any delivery (`AutoDeliveryNoteID` / `Number` on the invoice).
  3. If the delivery fails (not enough stock), its record is removed and the
     invoice stays a draft.

  A line without an order is skipped by the delivery's order checks and
  status refresh.
- **Reverse** (`invoice-item-lines-reverse`): reversing the invoice reverses
  its delivery, so the stock comes back at its cost. The Delivery Note right
  is not needed for a reversed invoice's own delivery.
- **From Sales Order**: `getInvoiceableOrderLines`, with Customer Invoice
  access (a delivery's picker needs Delivery Note access).
- **Returns**: as for any delivered invoice (the delivery is one of its
  `SourceDeliveryNotes`).
- **Delivery slip** (170): the invoice screen's **Print delivery slip**, with
  items and quantities and no prices.
- **Tests**:
  - `directSalesInvoice` suite (5);
  - the customerInvoice, deliveryNote, salesReturn and salesOrder suites
    (40, one message check updated);
  - `directSalesInvoice` UI (4), plus the invoiceState, salesReturn, smoke,
    glReferences and draftTasks UI tests.

  Negative controls caught: the delivery's reversal skipped, the order
  guard removed, and the screen not saving the lines.

