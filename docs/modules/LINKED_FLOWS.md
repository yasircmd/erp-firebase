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

## As built (2026-10-25)

- **Server:** `getDocumentLinks({ module, id })` (functions/src/flows.js),
  read only, for the ten source modules (PR, IPR, PO, GRN, VI, SO, DN, CI,
  and CBT / JV entries, which show the invoices they settle). It gives:
  - `next`: the steps still open, each `{ module, label, from }`, where
    `from` (CreateFrom) is `{ type, id, number, companyId, customerId |
    vendorId, amount?, voucherType? }`. A step is offered when:
    - a PR or IPR is Submitted;
    - a PO is Approved with quantity left to receive;
    - a GRN or DN is posted, live and not yet invoiced (MatchedToInvoiceID);
    - an SO is Reserved or Partially Reserved with a line that still has
      quantity to deliver and stock reserved for it (plus the direct
      invoice where `salesInvoiceSettings/{co}.DirectStock`);
    - an invoice is live with an amount open, computed from the live GL
      entries allocating against it.

    Each step is offered only with the next module's access and draft
    rights.
  - `chain`: the documents before and after, `{ module, kind, id, number,
    date, status, relation: before | after, canOpen }`. The links are
    found as follows:
    - DNs and GRNs by their lines' SourceSOID / SourcePOID;
    - invoices by the stores' DeliveryNoteID / SalesOrderID / GRNID
      queries;
    - POs from requisitions by their lines' SourceRequisitionID;
    - payments, PDCs and returns as the live GL entries allocating against
      an invoice, opened by entry id (as the GL Report drills, through
      moduleIdForEntry);
  - `outstanding` for an invoice.
- **Shell** (public/index.html, DOCUMENT LINKS):
  - The **Linked documents** panel is attached by `supportingDocs.mount`,
    so no screen changes for it. It sits above the supporting documents,
    holds the Create next buttons and the open amount, then Comes from and
    Followed by. It reloads on a new id and whenever the view is shown
    again, and is never printed.
  - `openModule(m, { CreateFrom })` then runs `documentLinks.start`, which
    works on the screen as a user would: New, the company and the party
    (set again if a late answer resets them), then the source ticked in
    the screen's own picker:
    - SO lines on a DN;
    - the DN, or the SO's lines through "From Sales Order", on a CI;
    - the requisition on a PO;
    - the PO's lines on a GRN;
    - the GRN on a VI;
    - on a PDC, the open amount allocated against the invoice.
  - Cash and Bank starts its own (`window.startCreateFrom`): the type, the
    company, one line on the party's account allocated against the
    invoice. `party.partyOf` is now exported in JV and CBT.
  - If a step doesn't come within 20 s, the user is told and carries on by
    hand.
- **Screens:** CUSTOMERINVOICE's order-line rows carry `data-so`; CBT has
  `startCreateFrom`. Nothing else in the screens changed.
- **Tests:**
  - `flows` suite (4);
  - UI `documentLinks` (2) and `createNext` (7);
  - negative controls caught: the draft right, the open amount, the panel
    attach, the DN steps, the CBT allocation.
