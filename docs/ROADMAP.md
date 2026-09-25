# Roadmap

New development after the migration. Keep this file current: update a
module's status after every finished step, then commit and push, so a
fresh session can continue from GitHub.

**Status values:** `not started` → `design` (doc being written) →
`design agreed` (owner has decided the open questions) → `building` →
`tested` (emulator suite, negative control, smoke) → `deployed` (logged in
[DEPLOY_LOG.md](DEPLOY_LOG.md)).

## Modules in development

| # | Module | Design doc | Status | Notes |
|---|---|---|---|---|
| 1 | Purchase Return / Debit Note | [PURCHASE_RETURN.md](modules/PURCHASE_RETURN.md) | not started | Mirrors GRN and Vendor Invoice |
| 2 | Sales Return / Credit Note | [SALES_RETURN.md](modules/SALES_RETURN.md) | not started | Mirrors Delivery Note and Customer Invoice |
| 3 | Vendor SOA | [VENDOR_SOA.md](modules/VENDOR_SOA.md) | not started | Read-only report. Needs the payment question in #0. |
| 4 | Customer SOA | [CUSTOMER_SOA.md](modules/CUSTOMER_SOA.md) | not started | Read-only report. Needs the payment question in #0. |

**Order:** the returns come first because the SOAs report on them, and
the SOAs last because they only read.

### #0 — decision needed before 1–4: tying payments to a party

An SOA lists a vendor's or customer's invoices, notes and payments.
Invoices carry `VendorID`/`CustomerID`, but payments and receipts are
posted through CBT, whose lines store only a GL account. No payment is
linked to a party, and nothing tracks what's paid or outstanding on an
invoice. Each vendor and customer does have its own
`TradePayablesAccountID`/`TradeReceivablesAccountID`. Options:

- **A. Tag CBT lines with a party:** an optional Vendor/Customer on CBT
  lines that hit payables or receivables. Small CBT change; works with
  shared or per-party accounts.
- **B. Per-party GL accounts:** the SOA reads the GL by the party's own
  account. No code change, but correct only if no two parties share an
  account.
- **C. New Vendor Payment / Customer Receipt modules** with allocation
  against invoices (outstanding tracking). Most complete; effectively two
  more modules.

Decision: _pending_.

## Follow-ups from the migration

- [ ] **Data checks in the old Apps Script system** for the bugs still
  live there: deviations #5, #6, #8, #11, #12, #14–#16 and #18 in
  [MIGRATION.md](MIGRATION.md) → "Deviations from Code.gs". Don't use its
  "Recalculate Stock Ledger" (#18).
- [ ] **Back-fill Physical Counts** posted by the Apps Script system before
  deviation #7. While any exist, Data Reset's ledger rebuild refuses to
  run and names them.
- [ ] **Decisions on preserved quirks**, such as the missing company
  scoping in Approval Tracker and BOM, the company gaps in draft
  edit/delete, and the no-lock numbering and reservation races. All are
  listed in [MIGRATION.md](MIGRATION.md) → Status.
- [ ] **Retire the Apps Script project** once the owner is satisfied, then
  revisit the `no-cache` Hosting header (README → Caching).
