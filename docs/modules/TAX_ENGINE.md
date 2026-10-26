# Sales tax of any kind: VAT, GST and others (UX round 2, item 32, widened)

**Status:** design, waiting for the owner's decisions (Q311–Q320) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 5, item 32 · **Touches:** every invoice,
return and print; e-invoicing ([E_INVOICING.md](E_INVOICING.md)); Retail Sales.

## What the owner asked (2026-10-26)

A tax module with customization options for any sales tax, such as the UAE's
VAT and India's GST. (Item 32 asked for tax per item or line: some items
exempt or at another rate.)

## Today

- **One rate for the whole document.** Customer Invoice and Vendor Invoice
  take a **Tax %** typed on the header, applied to the subtotal net of
  discount (`TaxPercent`, `TaxAmount`). Sales and Purchase Returns reuse their
  invoice's rate. Retail Sales has one tax-inclusive rate in its settings.
  Asset retirement (a sale) takes its own %.
- **One account each way.** Output tax posts to the company's Output Tax
  Account, input tax to its Input Tax Account (Company Master).
- **Numbers.** A company has its tax numbers (type and number, e.g. TRN); a
  customer or vendor has one Tax Registration Number. A company has its
  State / Emirate and Country; customers and vendors have no state.
- **E-invoicing** (PINT AE) gives the whole invoice one category: S above
  0 %, else Z.
- **No tax report.** No VAT return figures; tax is read from the GL.
- Items carry no tax class, HSN or SAC code.

So a mixed invoice (a standard item and an exempt one) can't be issued, an
export can't be zero-rated line by line, and GST (which splits into CGST and
SGST, or IGST, by the place of supply) can't be done at all.

## Proposed

### 1. Tax Configuration (a new module, per company)

A company chooses its **tax regime**, from a preset or its own:

| Preset | Components | Rates (editable) | Place of supply |
|---|---|---|---|
| **UAE VAT** | VAT | Standard 5 %, Zero-rated 0 %, Exempt, Out of scope, Reverse charge 5 % | Emirate (for the return's boxes) |
| **India GST** | CGST, SGST / UTGST, IGST, Cess (optional) | 0, 0.25, 3, 5, 12, 18, 28 %, Exempt, Nil, Non-GST, Reverse charge | State: same state → CGST + SGST (half each); another state, an SEZ or export → IGST |
| **Saudi VAT** | VAT | Standard 15 %, Zero, Exempt, Out of scope | — |
| **Own** | Any components the company names | Any | None, or by region |

The parts the company can change:
- **Components** (VAT; CGST, SGST, IGST …), each with its **output** and
  **input** account (and, for reverse charge, both).
- **Tax codes**: a name, its category (standard, zero-rated, exempt, out of
  scope, reverse charge, nil, non-GST), its rate, how it splits into
  components (GST: 18 % = CGST 9 % + SGST 9 % within the state, IGST 18 %
  across), the e-invoice category it maps to, and whether input tax on it
  is **recoverable** (and how much).
- **Rounding**: per line, or per rate on the document (Q315).
- **Prices**: exclusive or inclusive of tax (Q314).
- The dates a rate applies from, so a rate change (as GST had) needs no new
  code: a document takes the rate valid on its date.

### 2. Where a line's tax code comes from

- An **item** has its tax code (and, for India, its **HSN** code; a service
  its **SAC**).
- A Sales Type or an account used on direct lines has its default code too.
- The line takes its default and may be changed (Q313).
- A **customer / vendor** gains: registration type (registered,
  unregistered, composition, SEZ, overseas), **state** or emirate, and its
  tax number (GSTIN validated for India: 15 characters, the state code first).
- **The document** works out the place of supply (Q318) and, from the
  company's state against it, which components apply.

### 3. On every document

- **Lines** show their tax code, the tax amount and the total; the footer a
  **tax summary** by code (taxable, tax by component).
- **Customer Invoice, Sales Return, Retail Sale and Return, Vendor Invoice,
  Purchase Return, asset sale**: computed and posted per component (Output
  CGST, Output SGST …). Reverse charge: output and input both, netting nil
  where it is recoverable. Non-recoverable input tax goes to the line's own
  expense or the item's cost.
- **Sales Order, Proforma, Purchase Order**: the tax shown as an estimate,
  as today's totals are.
- **Prints** show each line's rate and the summary by rate (as GST and the
  FTA require); **e-invoices** (PINT AE) carry the category and rate per line.

### 4. Reports

- **Tax summary** for a period: taxable value and tax by code and component,
  sales and purchases, from the posted documents (not the GL).
- **UAE VAT 201 figures**: boxes 1–14 (standard sales by emirate, zero-rated,
  exempt, reverse charge, recoverable input tax …).
- **India**: GSTR-1 (outward supplies: B2B by GSTIN, B2C, exports, credit
  notes, HSN summary) and GSTR-3B summary figures, with an Excel copy for
  the filer.

Filing itself (the FTA portal, the GST portal) stays outside: the figures
are prepared for the person who files.

### 5. What stays as it is

Documents posted before the change keep their single rate; a return of one
follows it. New documents use the line codes (Q317).

## The questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q311 | Which regimes as presets now: **(a)** UAE VAT and India GST, others built by hand, or **(b)** also Saudi VAT, Oman VAT, Bahrain VAT? | **(a)**, plus the "own regime" builder; more presets are only data, added when a client needs one. |
| Q312 | India: is a company trading there now (GST needed live), or is it to be ready for later clients? | Tells us whether GSTR-1 / 3B figures and the GSTIN checks come in the first release or the second. |
| Q313 | A line's tax code: **(a)** from the item (or Sales Type / account), changeable on the line by anyone who can save the document, or **(b)** changeable only with a new right? | **(b)**: changing tax is a compliance risk; most lines never need it. |
| Q314 | Prices: **(a)** exclusive of tax everywhere except Retail (as today), or **(b)** inclusive or exclusive chosen per price list? | **(b)**, defaulting to today's behaviour: B2C price lists in India are usually tax-inclusive. |
| Q315 | Rounding: **(a)** per line, or **(b)** per rate on the whole document? | Per regime: **(b)** for UAE VAT (the FTA accepts it, fewer cents lost), **(a)** for India GST (per line is the norm, and the e-invoice checks per line). |
| Q316 | Purchases: **(a)** tax codes say how much input tax is recoverable (the rest to the expense or cost), with reverse charge posting both sides, or **(b)** all input tax recoverable (as today)? | **(a)**: blocked input tax (entertainment, motor cars, exempt use) and imports under reverse charge are common in both countries. |
| Q317 | Documents posted before: **(a)** keep their single rate (returns follow it), or **(b)** be converted? | **(a)**: a posted document never changes. |
| Q318 | India's place of supply: **(a)** the customer's state from Customer Master, changeable per invoice (a ship-to state), or **(b)** always the customer's state? | **(a)**: goods shipped to another state are taxed there. |
| Q319 | The first reports: **(a)** the tax summary and the UAE VAT 201 figures, then India's GSTR-1 / 3B, or **(b)** all together? | **(a)** if no company trades in India yet (Q312); else **(b)**. |
| Q320 | Who configures tax: **(a)** a new Tax Configuration module (setup right, Admin by default), or **(b)** inside Company Master? | **(a)**: it is its own subject, with its own Help page and rights. |

## Build plan (after the answers)

Large; in parts, each its own PR:

1. **Tax Configuration**: the regimes, components, codes, rates by date and
   accounts; the presets; items' codes and HSN/SAC; parties' registration
   type, state and tax number checks.
2. **Sales**: Customer Invoice and Sales Return with line codes, the
   summary, posting per component, prints; e-invoices per line.
3. **Purchases**: Vendor Invoice and Purchase Return, recoverable and
   reverse charge.
4. **Retail Sales, asset sales, orders and proformas.**
5. **Reports**: the tax summary, VAT 201, GSTR-1 / 3B (per Q319).

Each part: tests (emulator and UI, negative controls), Help, What's new.
The ported screens (Customer and Vendor Invoice) change through the legacy
port's patches and SCREEN_EDITS.
