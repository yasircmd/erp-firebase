# Sales tax of any kind: VAT, GST and others (UX round 2, item 32, widened)

**Status:** design agreed (owner, 2026-10-26, decisions Q311–Q322) · **Roadmap:** [#19](../ROADMAP.md) ·
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

## The owner's decisions (2026-10-26)

| # | Decision |
|---|---|
| Q311 | Presets: **UAE VAT and India GST**, plus the own-regime builder; more presets are data, added when a client needs one. |
| Q312 | **A company trades in India now**: GST is needed live. |
| Q313 | A line's tax code comes from its item (or Sales Type / account); changing it on a line needs a **new right**. |
| Q314 | Prices exclusive or inclusive **per price list**, defaulting to today's behaviour (exclusive; Retail inclusive). |
| Q315 | Rounding **per regime**: UAE VAT per rate on the document, India GST per line. |
| Q316 | Input tax recoverable **per tax code** (the rest to the expense or cost); reverse charge posts both output and input. |
| Q317 | Documents posted before **keep their single rate**; a return of one follows it. |
| Q318 | India's place of supply: the **customer's state** from Customer Master, changeable per invoice (a ship-to state). |
| Q319 | Reports **all together** in the first release (follows from Q312): the tax summary, the UAE VAT 201 figures, India's GSTR-1 and GSTR-3B figures. |
| Q320 | A new **Tax Configuration** module (setup right, Admin by default), its own Help page. |
| Q321 | India's e-invoice: **ready, not connected**, as UAE e-invoicing: the IRP-schema JSON built and kept, the IRN and QR entered once a GSP provider is chosen. E-way bills later. |
| Q322 | The Indian company is **its own corporate, with INR as its base currency**: its GST figures are in rupees directly. |
| Q323 | (Part 3, 2026-10-26) Input tax that can't be reclaimed on a GRN (stock) line goes **into the stock's cost**: the item's value in its warehouse rises, and later issues and sales carry it. |
| Q324 | (Part 3, 2026-10-26) A Vendor Invoice direct line's default tax code comes from **its account** (Chart of Accounts gains an optional default tax code), changeable with Vendor Invoice's new "change tax code" right. |

## The questions as asked

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

## As built

### Part 1: Tax Configuration (2026-10-26; deploy set `ux2-tax1`)

- **functions/src/taxEngine.js** (pure, no data): the categories (STANDARD,
  ZERO, EXEMPT, OUT_OF_SCOPE, REVERSE_CHARGE, NIL, NON_GST, each with its
  e-invoice category S / Z / E / O / AE), the emirates, the GST states and
  union territories, the registration types (Registered, Unregistered,
  Composition, SEZ, Overseas, Consumer); the presets AE_VAT (SR 5 %, ZR, EX,
  OS, RC; rounding per document), IN_GST (components CGST, SGST, UTGST,
  IGST, CESS; GST5, GST18, GST40 from 2025-09-22, GST3, GST0_25, the old
  GST12 and GST28 inactive, ZERO, NIL, EXEMPT, NONGST, RCM5, RCM18;
  rounding per line) and OWN (up to six components of the company's own).
  It checks a configuration (`validateConfig`), a GSTIN (format, its
  mod-36 check character, its state against the party's) and a UAE TRN,
  an HSN / SAC (4, 6 or 8 digits); and gives a code's rate on a date
  (`rateOn`) and its split into components for a place of supply
  (`componentsOf`: CGST + SGST, or UTGST in a union territory, within the
  state; IGST to another state, an SEZ or abroad). Parts 2-5 use these.
- **functions/src/taxConfig.js**: `getTaxConfig` / `saveTaxConfig`, one
  Firestore document per company, `taxConfig/{companyId}`. Rights
  TAXCONFIG access (Admin, Finance Manager, Accountant, Viewer) and setup
  (Admin), plus the company's access. A code recorded in
  `taxCodeUse/{companyId}` (written by postings from part 2) can't be
  removed, only made inactive, and the regime can't change once one is.
- **TAXCONFIG** is a later module (not in moduleBaseline.js): off for a
  client corporate until provided in the Developer screen. Tree: General
  Ledger → Tax Configuration, after Period Closing. Data Reset: category
  Tax Configuration (Setup).
- **Items** (hand screen ITEMMASTER and patch `tax-item`): Tax code and
  HSN / SAC. **Customers and vendors** (patches `tax-party-customer`,
  `tax-party-vendor`, SCREEN_EDITS `taxPartyEdits`): registration type,
  state / emirate, the tax number checked against them. A party saved
  without the new fields (an older form, an import) keeps its tax number
  as free text, as before. Master Import: the matching columns.
- Documents still charge one tax % per document, as before, until part 2.
- Tests: unit/taxEngine (7), emulator/taxConfig (4), ui/taxConfig (4).
  Negative controls: a GSTIN of another state accepted; a used code
  removed; Customer Master's state not saved (UI). All caught, restored.

### Part 2: sales (2026-10-26; deploy set `ux2-tax2`)

- **functions/src/salesTax.js**: `computeTax` (pure) taxes a document's
  lines: the discount spread over them in proportion (cents to the last
  line), each line's components from `taxEngine.componentsOf` on the
  document's date and place of supply, a price inclusive of tax divided by
  (1 + rate), rounded per line (GST) or per code and component on the
  document with the cents put on its largest line (VAT). A sale under
  reverse charge charges nothing (the buyer accounts for it). Stored on the
  document: `TaxLines` (per line: Key, Label, TaxCode, Category, Percent,
  Taxable, Tax, Inclusive, Components, HSNCode), `TaxSummary` (per code and
  rate), `TaxComponents` (per component, with the output and input
  accounts as configured at the time), `TaxAmount`, `TaxAdded` (on
  exclusive prices: added to the total), `TaxIncluded`, `PlaceOfSupply`,
  `TaxRegime`, `TaxRounding`. Line keys: `<DeliveryNoteID>#<LineNo>`,
  `item#n` (the invoice's own item lines, delivered by its automatic
  Delivery Note), `direct#n`.
- **Customer Invoice** (patches `invoice-line-tax (…)`): where the company
  has a Tax Configuration, the save calls `invoiceTax`. A line's code is its
  item's, else its Sales Type's default (`TaxCode`, Sales Invoice
  Configuration). A code other than that, not already saved on the line,
  needs CUSTOMERINVOICE `taxcode` (Q313, Admin and Finance Manager by
  default; existing corporates tick it in Roles & Permissions). An inactive
  code is refused unless the line already had it. The place of supply is
  the invoice's `PlaceOfSupply`, else the customer's `TaxState` (Q318);
  India needs one unless the buyer is Overseas or an SEZ. A line delivered
  against a Sales Order on a price list with `PricesIncludeTax` is
  inclusive (Q314); direct and typed item lines are exclusive. Total =
  subtotal − discount + `TaxAdded` + round off. Posting credits each
  component to its output account and records the codes in `taxCodeUse`;
  revenue is net of the tax inclusive prices held (`includedTaxOf`). The
  reversal mirrors both. A company without a Tax Configuration, and an
  invoice saved before it had one, keeps the single Tax % (Q317).
- **Sales Return**: each returned line takes its invoice line's share by
  quantity (`shareOf`), at the invoice's codes, rates and accounts; its
  Sales Returns debit leaves out a line's included tax.
- **The screen**: `previewInvoiceTax` (the save's own calculation, its
  problems returned, not thrown) feeds the Tax box: per line its code
  (changeable with the right), rate, components and tax, the summary, the
  place of supply. The print shows each line's rate and tax, HSN under GST,
  a summary by code with each component, and the place of supply. Sales
  Return shows and prints its share.
- **E-invoices**: PINT AE takes each line's category (S, Z, E, O, AE) and
  rate at its taxable value, with a subtotal per category and rate (the
  discount is already in the lines). Fixed with it: after posting, an
  invoice's item lines were listed twice in its e-invoice (once as its
  automatic Delivery Note). **India** (Q321, `eInvoiceIndia.js`): a company
  under India GST gets the IRP's JSON (schema 1.1, `Format: 'IRP'`, `Json`)
  for supplies to a registered business, an SEZ or abroad (else
  NotApplicable), checked for the GSTINs, addresses, cities and PIN codes,
  the place of supply and an HSN / SAC on every line. Nothing is reported
  until a GSP is connected (eInvoiceConnector.js).
- Customers and vendors gain **City** and **PIN / postal code** (an Indian
  PIN is 6 digits), on their screens and in Master Import. Price lists gain
  **Prices include tax**; Sales Types a default tax code.
- Tests: unit/salesTax (8), unit/eInvoiceIndia (4), emulator/salesTax (8),
  ui/salesTax (3).

### Part 3: purchases (2026-10-30; deploy set `ux2-tax3`)

- **functions/src/purchaseTax.js**: `vendorInvoiceTax` gathers a Vendor
  Invoice's lines and calls `salesTax.computeTax` (sale: false): a GRN's
  goods by their item's code, a GRN's non-stock lines and the direct lines
  by their account's `TaxCode` (Q324, Chart of Accounts); another code needs
  VENDORINVOICE `taxcode` (Admin and Finance Manager by default; existing
  corporates tick it). GST's place of supply is the vendor's `TaxState`
  (IGST from another state, an SEZ or abroad). `splitRecoverable` gives each
  line and component its `Recoverable` and `NonRecoverable` part by the
  code's `RecoverablePercent` (Q316), and marks reverse charge (`Reverse`).
  `TaxAdded` (what the vendor charges: not reverse charge) adds to the
  total; `TaxReverse`, `TaxRecoverable` are kept.
- **Posting** (patches `vendor-line-tax (…)`, `purchaseGl`): the part
  reclaimed Dr each component's input account; reverse charge Cr its output
  account; the part not reclaimed is cost: a direct (or non-stock) line's own
  account, a GRN line's goods (Q323) as a **value-only stock line** in an
  `InputTaxCost` stock document posted in the invoice's own batch (Dr the
  item's inventory account, the balance's value and average cost up), or,
  when none of the goods is left in that warehouse, the item's consumption
  account. The reversal mirrors it (a value-only Out line). The codes used
  are recorded in `taxCodeUse`.
- **Value-only lines** (`stockMovement.computeStockMovement`): `ValueOnly`,
  `Direction` In or Out, `TotalValue`, quantity 0; the balance must hold
  stock. The ledger rebuild (Data Reset) replays them like any line; the
  Stock Ledger shows the value; Inventory Aging and Batch Expiry move the
  value only.
- **Purchase Return**: each returned line takes its share by quantity
  (`returnShare`); the input tax reclaimed is credited back, reverse
  charge's output debited back (`returnGl`); the part not reclaimed was in
  the goods' cost, so the vendor's refund of it is credited to the
  Purchase Return Variance account.
- **Screens**: Vendor Invoice's Tax box (`previewVendorInvoiceTax`): per
  line its code (changeable with the right), rate, components, tax and the
  part reclaimed, reverse charge marked, the totals charged / reverse /
  reclaimed / to cost. Purchase Return shows and prints its share. Chart of
  Accounts: Default tax code (postable accounts; SCREEN_EDITS).
- Tests: unit/purchaseTax (2), emulator/purchaseTax (6), ui/purchaseTax
  (2). Negative controls: the goods never given the tax (emulator); every
  code fully reclaimed (unit). Both caught, restored.

### Part 4: Retail Sales, asset sales, orders and proformas (2026-10-30; deploy set `ux2-tax4`)

- **Retail Sales** (functions/src/retailSales.js): for a company with a Tax
  Configuration, each counter line (`line#<LineNo>`) is taxed by its item's
  code at the rate on the sale date; an item without a code is refused.
  Retail prices include the tax (`Inclusive`), so the tax comes out of each
  line's amount after its discount; the line's `DiscountNet` is the discount
  less its tax, `Revenue` the total less tax plus that. The place of supply
  is the company's state for the Retail Customer, the customer's `TaxState`
  otherwise. The sale posts `componentGlLines` (each component to its output
  account) and keeps `TaxLines`, `TaxSummary`, `TaxComponents`,
  `TaxRegime`, `PlaceOfSupply`; the codes used go to `taxCodeUse`. The
  counter returns `lineTax` and each item's `TaxPercent`, so the screen's
  totals and receipts show the tax by code. A return takes each line's share
  by quantity; the last return of a line takes what is left of its tax and
  discount (`lineTaxReturn`), so the returns give back exactly the sale's
  tax. Without a Tax Configuration, Setup's single rate stays.
- **Asset sales** (functions/src/fixedAssetsRetirement.js): a Sale needs a
  `TaxCode` when a Tax Configuration exists (`getFaRetirementSetup` returns
  the codes); `computeTax` on `asset#<id>` lines, the place of supply the
  buying customer's `TaxState` or, to the bank, the company's state. The
  receipt carries the proceeds plus the tax; each component is credited to
  its output account (the output accounts are checked first). Fixed Asset
  Retirement's Tax code replaces the VAT % field then.
- **Order estimates** (`salesTax.previewOrderTax`, new callable; SALESORDER
  or PURCHASEORDER `access`, and the company): the lines' items and amounts,
  the party (customer or vendor) for the place of supply, the price list's
  `PricesIncludeTax` on a Sales Order. It returns the tax and its summary,
  or the problem (an item without a code), and posts nothing. The Sales
  Order's and Purchase Order's grids show the **Estimated tax** and the
  **Total with tax**; the Proforma Invoice prints the tax by code and the
  total with tax. Each line's components are rounded as the invoice rounds
  them. A change of the party or the order date asks again.
- Tests: emulator/retailTax (3), emulator/orderTax (4), the fixedAssets sale
  with tax (1), ui/orderTax (3). Negative controls: retail prices taken as
  excluding tax (2 of 3 caught); the price list's inclusion and the party's
  state ignored (3 of 4 caught); the asset sale's components not posted
  (caught); the screens never asking for the estimate (both caught). All
  restored. Full regression 728 passed, 0 failed; the affected UI suites
  pass.
