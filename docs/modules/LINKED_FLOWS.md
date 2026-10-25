# Linked document flows: "Create next" (UX round 2, item 21)

**Status:** design agreed (owner, 2026-10-24, decisions Q287–Q289) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 3

## Purpose

Each step of a sale or a purchase already picks up the one before it: a
Delivery Note lists the customer's open Sales Orders, an invoice the open
Delivery Notes, a GRN the approved POs, and so on. What's missing is the
other direction: from a document, go straight to the next step without
reopening the next screen, choosing the company, the party and the source
again.

## What it does

A **Create next** button on a document that can be followed. It opens the
next screen in New mode, with the company, the party and that document
already chosen, exactly as if the user had picked them there. From then
on the next screen's own rules apply, unchanged: which lines it offers,
the remaining quantities, its checks, approval and posting. Nothing about
posting changes, and the server checks nothing new.

- **Partial quantities:** the next document takes everything still open
  (as its picker does today); the user lowers quantities or removes lines.
  The source can be followed again until nothing is left, and the button
  disappears then.
- **Rights:** the button shows only to a user who may create the next
  document (its module's write right) and only when the source has
  something left to follow.
- **Payments:** from an invoice, the button opens Cash & Bank on a receipt
  (customer) or payment (vendor) with the party and the invoice's open
  balance allocated Against it.
- Built on the shell's drill-through (`openModule(moduleId, params)`,
  already used by Home tasks and the GL Report): each next screen reads a
  new `CreateFrom` parameter in `initModule`. Generated screens get it
  through SCREEN_EDITS.

## The steps (proposed)

| From | Create next | Available when |
|---|---|---|
| Purchase Requisition | Purchase Order | approved, with lines not yet ordered |
| Purchase Order | GRN | approved, with quantity not yet received |
| GRN | Vendor Invoice | posted, not yet fully invoiced |
| Vendor Invoice | Payment (Cash & Bank) | posted, with a balance open |
| Sales Order | Delivery Note | approved, with quantity not yet delivered |
| Sales Order | Customer Invoice (no delivery) | approved, where the company allows invoicing without a delivery (decision 167) |
| Delivery Note | Customer Invoice | posted, not yet fully invoiced |
| Customer Invoice | Receipt (Cash & Bank) | posted, with a balance open |

## Decisions (owner, 2026-10-24)

- **Q287:** the eight steps above, **plus PDCs**: Customer Invoice → PDC
  Received and Vendor Invoice → PDC Issued (available when posted with a
  balance open). Not the returns. Each button shows **only to a user who
  may open the next module** (and create in it); to anyone else it is
  hidden, not disabled.
- **Q288:** a payment from an invoice opens Cash & Bank on a **Bank**
  Receipt / Payment, which the user may change to Cash there.
- **Q289:** **in this step**: each document also shows its **chain**, the
  documents before and after it (on an invoice: its Sales Order, Delivery
  Notes, and the receipts, PDCs and returns settling it), each opening
  its document, shown only for modules the user may open. Read-only; it
  changes nothing.
