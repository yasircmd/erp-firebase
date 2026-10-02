# Vendor SOA (Statement of Account)

**Status:** deployed 2026-09-25 · **Roadmap:** [#3](../ROADMAP.md) · **Branch:** `party-statements` (from `sales-return`)

## Purpose

A read-only statement for one vendor over a date range: opening balance,
every invoice, debit note and payment in date order, a running balance,
the closing balance, what's still open and how overdue it is. Printable or
exportable to send to the vendor.

## Owner decisions (2026-09-25, shared with [CUSTOMER_SOA.md](CUSTOMER_SOA.md))

| # | Question | Decision |
|---|---|---|
| 1 | Source of the figures | Party Payments (roadmap #0, option A plus allocation): the party's posted invoices plus every posted GL entry tagged with the party (JV, CBT, debit/credit notes). Opening balance = everything before the start date; running balance per row. Reversed documents and their reversals both appear, marked |
| 2 | Open/paid per invoice | Yes: an **Open items** section — each unpaid invoice or open credit with amount, outstanding, due date (invoice date + the party's `PaymentTermsDays`) and days overdue, computed **as at the statement's end date** (allocations dated later don't count) |
| 3 | Aging | Yes, from the due date: Not yet due, 1–30, 31–60, 61–90, 90+ days overdue, over the open items |
| 4 | Output | On screen, Print (browser print / save as PDF, as Trial Balance and GL Report), and CSV export. No email sending |
| 5 | Currency | The company's own currency only: no invoice or payment stores a foreign-currency amount |
| 6 | Shape | Two screens and modules (`VENDORSOA`, `CUSTOMERSOA`), access ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; one shared server engine |
| 7 | Scope per run | One party at a time: company, party, date range. A batch "all parties with a balance" run can come later |
| 8 | Reconciliation | When the party's payables/receivables account is used by no other party, compare the statement's closing balance with that account's GL balance for the company at the end date and flag any difference (usually an old untagged payment needing a settling JV) |

## What already exists (from the code)

- **Vendor Invoices** (RTDB `vendorInvoices`): `VendorID`, `CompanyID`,
  `TransactionNumber`, `InvoiceDate`, `VendorRefNumber`, `Total`, status and
  reversal links (`ReversedByInvoiceID`, `ReversalOfInvoiceID`). Their GL
  lines are **not** party-tagged; the invoice record is the source.
- **Tagged GL entries** (Firestore `journalEntries`, `PartyKeys` array,
  single-field `array-contains` query): JV, CBT, Purchase Return (DBN).
  Lines carry `PartyType`, `PartyID`, `Allocations`; entries carry
  `ReversedByJV` / `ReversalOfJV`.
- **Open items and outstanding:** `partyLedger.getOpenItemsForParty`
  (currently "as of now"; needs an as-of-date variant).
- **Reports:** print CSS and `window.print()` in TRIALBALANCE / GLREPORT.

## Design

**Rows**, in date order (then posting time), vendor side = credit
increases what we owe:
- each Vendor Invoice (and invoice reversal entry): Cr `Total`
- each tagged line of a posted GL entry for this vendor: Dr/Cr as posted
  (payments Dr, refunds/debit-note remainders etc. as they fall)

Columns: date, document number, type, reference / description, debit,
credit, running balance. Opening row first, closing row last. Marked:
"reversed" / "reversal of …".

**Open items as at the end date:** the same open items Party Payments
derives today (live invoices and New Refs, live meaning not reversed),
limited to those dated on or before the end date, with outstanding =
amount − the Against allocations on live entries dated on or before the
end date. Aging buckets compare each item's due date with the end date.
A document reversed after the end date is treated as reversed; the
statement shows current knowledge, not a historical snapshot.

**Reconciliation:** GL balance of the vendor's `TradePayablesAccountID`
for the company up to the end date vs the closing balance, shown only
when no other vendor/customer uses that account.

**Code:** `functions/src/partyStatement.js` (one engine, one callable per
party type), screens `VENDORSOA.html` / `CUSTOMERSOA.html`, emulator suite
and UI check, negative controls.

## As built (2026-09-25)

**Code:** `functions/src/partyStatement.js`, one callable for both
statements: `getPartyStatement({ partyType, partyId, companyId, fromDate,
toDate })`, gated by `VENDORSOA` / `CUSTOMERSOA` access. Screens:
`functions/modules/VENDORSOA.html`, plus `CUSTOMERSOA.html`, generated from
it by `node tools/build-soa-screens.js`. Edit only the vendor file; the
UI check fails if the two drift apart.

**Behaviour worth knowing:**
- The rows are the party's invoices (and invoice reversal entries, on the
  opposite side) plus every line tagged with the party on a posted GL
  entry. Sorted by date, then posting time.
- **Invariant:** every tagged amount is allocated (New or Against), so the
  open items add up to the closing balance. The suite checks this.
- **Open items** come from `partyLedger.getOpenItemsForParty`, which
  gained an optional as-of date. With no date it works as before. An
  invoice waiting on reversal approval appears in the rows but not in
  the open items, the same as the Party Payments pickers.
- **Reconciliation** compares with the party's control account in this
  company. It's skipped when another party usable in this company (same
  company or unassigned) has the same account. A party of another company
  on the same account doesn't count, since the GL is per company.
- Each document number links through to its source screen (invoice, JV,
  CBT, debit or credit note), with a back button that re-runs the
  statement.
- CSV is built in the browser (UTF-8 with a byte-order mark, so Excel
  opens it correctly). Print uses the browser's print dialog. The
  reconciliation line is left out of the print.

**Test tooling:** the UI harness's `openModule` now forwards drill-through
parameters and the back-chain like the real shell does
(`functions/test/ui/buildHarness.js`).

**After deploy:** link both screens into the live menu with Tree
Management. Deploy set: `tools/deploy-sets/party-statements.txt`, after
the two return sets.

**Tests:** `functions/test/emulator/partyStatement.emulator.test.js` (3
tests) and `functions/test/ui/partyStatement.ui.js` (4 checks). Negative
controls, each confirmed caught, then restored:
1. The open items ignoring the end date.
2. An invoice reversal booked on the invoice's own side.
3. Rows dated on the start date folded into the opening balance.

## Compact view (owner, 2026-10-02)

"Both SOAs also make compact view, reduce amount font size, no need to
change print." On screen only (`@media screen` in VENDORSOA.html, built
into CUSTOMERSOA.html):
- tighter rows (0.15rem × 0.5rem) and sections;
- amounts at 0.72rem, other cells at 0.75rem, headers at 0.68rem;
- every column but the description on one line;
- smaller ageing tiles and title.

The printout is unchanged. Checked by `partyStatement.ui.js`, also under
print media.
