# UAE e-invoicing (UX Tier 3, S)

Status: **design agreed** (owner's direction 2026-10-16, round 16).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 3, S).

## The owner's direction (2026-10-16)

E-invoicing can be **switched on per company in Sales Invoice
Configuration**.

## The rules in force (checked 2026-10-16; confirm with the Ministry of Finance)

- The UAE mandate uses the **Peppol** network and the **PINT AE** invoice
  format. Each business sends its invoices through an **Accredited Service
  Provider (ASP)** that it appoints. The ASP passes them to the buyer's ASP
  and reports them to the FTA.
- Scope: **B2B and B2G**. B2C is excluded for now.
- **Phase 1 (revenue of AED 50 million or more):**
  - appoint an ASP by **30 October 2026** (moved from 31 July 2026 by
    Ministerial Decision No. 66 of 2026);
  - go live on **1 January 2027**.
- **Phase 2 (others):**
  - appoint an ASP by **31 March 2027**;
  - go live on **1 July 2027**.
- Government entities follow from 1 October 2027.
- A voluntary pilot has run since 1 July 2026.
- Penalty for missing the deadlines: AED 5,000 a month (Cabinet Decision
  No. 106 of 2025).

Sources: Deloitte Middle East, "UAE e-invoicing: ASP appointment deadline
extended, but go-live remains 1 January 2027"; ClearTax UAE e-invoicing
guide. The schedule is the Ministry of Finance's (mof.gov.ae) and should be
confirmed there.

## Proposal

- **The ERP does not talk to Peppol itself.** It sends each invoice to the
  company's ASP through the ASP's API, and the ASP does the Peppol exchange
  and the FTA reporting. So the build depends on **which ASP you appoint**:
  each has its own API, though most accept PINT AE (UBL XML) or a JSON form
  of it.
- **Sales Invoice Configuration, per company:**
  - **E-invoicing on / off**;
  - the ASP and its connection details, kept in the company's settings and
    readable only by the server;
  - the start date.
- **On posting** a Customer Invoice (and a Sales Return, as a credit note)
  for a company with it on:
  - the ERP builds the PINT AE invoice: seller's and buyer's TRN, the
    lines, VAT by rate, totals, and the currency (with question 218 of
    MULTI_CURRENCY.md);
  - it sends the invoice to the ASP and stores the ASP's reply: accepted
    or rejected, its ID and the reason.
  - The invoice shows its e-invoice status. A rejection is listed in Home
    tasks to correct, then the invoice is sent again.
- **The data it needs** that may be missing today:
  - the **TRN** (already on Customer Master and Company Master, but
    optional today: required for a customer to be e-invoiced) and the
    buyer's Peppol ID, which the ASP can usually look up from the TRN;
  - item and service classification codes, if the ASP requires them;
  - each tax line's category (standard, zero-rated, exempt).
- **Purchases:** vendors' e-invoices arrive through your ASP. Bringing them
  in as draft Vendor Invoices is a phase 2 option.

## Questions for the owner

- **225.** Is any of your companies in **Phase 1** (revenue of AED 50
  million or more)? If yes, its ASP must be appointed by **30 October
  2026** (two weeks from now) and it goes live on 1 January 2027. That
  decides how urgent this is.
- **226.** Have you chosen an ASP? If not, the ERP can be built for any
  ASP with an API. Choosing one that publishes its API (and gives a test
  account) lets the work start.
- **227.** Credit notes (Sales Returns) and debit notes too in phase 1
  (recommended: yes, the mandate covers them)?
- **228.** Receiving vendors' e-invoices into draft Vendor Invoices: phase
  1 or later? Recommended: later. Your ASP holds them meanwhile.
- **229.** Customers without a TRN (B2C or not registered): sent as
  usual, without e-invoicing (recommended, B2C is out of scope)?

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 225, 226 | **Not urgent, and no ASP yet: make the ERP ready.** Build everything up to sending: the switch and settings in Sales Invoice Configuration, the data checks (TRN and the rest), and the PINT AE invoice and credit note built on posting, stored and downloadable (UBL XML) with its readiness status. Sending goes through one connector that is plugged in for the ASP once one is chosen. Until then nothing is sent. |
| 227 | Credit notes (Sales Returns) and debit notes included. |
| 228 | Receiving vendors' e-invoices later. |
| 229 | Customers without a TRN are not e-invoiced. |
| (all) | "Go with your recommendations" (owner, 2026-10-16). |

## As built (2026-10-16)

**The documents** (`functions/src/eInvoiceDocument.js`, pure):
- A posted Customer Invoice becomes a PINT AE UBL 2.1 Invoice
  (CustomizationID `urn:peppol:pint:billing-1@ae-1`, type 380). A Sales
  Return becomes a CreditNote (381) naming its invoice in
  BillingReference.
- Each document carries:
  - the seller's and buyer's TRN, addresses and names;
  - the lines;
  - the VAT by category: S at 5%, Z at 0;
  - the totals;
  - for a foreign-currency invoice, the VAT again in AED (decision 218).
- Readiness:
  - **NotApplicable** for a customer without a TRN (decision 229);
  - **NotReady** with the reasons: a missing or non-15-digit TRN, a
    missing address or number, no lines, or a credit note without its
    invoice;
  - else **Ready**.

**The flow** (`functions/src/eInvoicing.js`):
- `eInvoiceSettings/{company}` holds `{ Enabled, StartDate, AspName }`,
  set in Sales Invoice Configuration (SALESINVOICESETUP write).
- On posting (patch `e-invoicing` after the Customer Invoice commit;
  salesReturn.js after its commit), `recordEInvoice` builds, checks and
  stores `eInvoices/{Kind}_{id}` with its Status, Issues, Xml and
  SendStatus. It never throws: a posting is not held up.
- The invoice and return screens show the status and what is missing,
  with **Download XML** and **Check again** (`rebuildEInvoice`, refused
  once sent).
- Sending: `functions/src/eInvoiceConnector.js` is the one place an
  e-invoice leaves. With no ASP it returns NotSent. The ASP's API (its
  credentials in Secret Manager) is plugged in there when one is chosen.

**Not yet:**
- debit notes: the ERP has no sales debit note document;
- item classification codes, if the ASP requires them;
- receiving vendors' e-invoices (decision 228, later);
- rejections in Home tasks, which come with the connector.

**Tests:** unit `eInvoiceDocument` (3); emulator `eInvoicing`.
