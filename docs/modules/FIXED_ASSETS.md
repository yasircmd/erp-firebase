# Fixed Assets (Asset Accounting, FI-AA)

**Status:** design · **Roadmap:** [#6](../ROADMAP.md) · **Branch:** `worktree-fixed-assets-design`

## Purpose

An asset sub-ledger and depreciation engine, modelled on SAP FI-AA and
kept at SME size. Every asset has a class and a master record. Each
financial event on it is an immutable **asset transaction** that posts a
normal GL entry. The General Ledger stays the official book. The asset
sub-ledger explains its asset balances and must reconcile to it.

```
Asset Class → Account Determination → GL accounts
     ↓
Asset Master ──→ Asset Transactions (acquisition, depreciation, transfer,
     ↓                disposal, AuC settlement, reversal …)
Depreciation Engine ─┘          ↓ each financial one posts
                         GL (journalEntries) → Financial Statements
```

## Owner's brief (2026-09-26)

A Fixed Asset Management module with: an asset master (auto-numbered),
admin-defined asset classes with default life/method and GL accounts,
acquisition (direct purchase, purchase invoice, AP, AuC capitalization),
straight-line and written-down-value depreciation with partial periods,
a monthly depreciation run (preview, post, no duplicates, authorized
reversal), a depreciation register, transfers with history, disposal
(sale, scrap, write-off) with automatic gain/loss, Assets under
Construction, account determination by class (no GL accounts on assets),
an asset register with filters, a full audit trail, an asset-vs-GL
reconciliation, a dashboard, accounting controls (period locking,
role-based authorization, reversal instead of delete), and a data model
ready for depreciation areas, revaluation, impairment, components,
leases, foreign currency, inter-company transfers and splitting.
"Transaction-based accounting rather than a CRUD asset register."

## What exists today (checked 2026-09-26)

| Area | Today | Consequence for this design |
|---|---|---|
| Menu tree | Four FI-AA nodes, no module linked: *Capital Asset Master Management*, *Asset Acquisition & CWIP*, *Multi-GAAP Depreciation Calculation Engine*, *Asset Retirement, Transfer & Impairment* | Link the new screens to them (question 24) |
| Chart of accounts | Six-digit codes; `620000 Depreciation Expense` header seeded. No fixed-asset or accumulated-depreciation header | The owner creates the accounts in COA (e.g. under a new `14…` sub-category); the module doesn't seed any |
| Procurement | Requisition categories of type *Fixed Asset* map to an Asset-type GL account; POs carry those lines; nothing links them to GRN or invoice | Unchanged. See acquisition route B |
| Vendor Invoice | Posts GRNs plus **direct lines** to any postable account, Cr the vendor's payables | Acquisition from an invoice via an asset clearing account (question 6) |
| GL writing | `glWriting.writeStockGlEntry`: validated, balanced entry in Firestore `journalEntries`, voucher number per company and year; Expense lines **require a cost center** | Reused. Depreciable assets therefore need a cost center |
| Party ledger | JV/CBT/PDC lines tagged with vendor/customer, bill-wise allocation (`partyLedger.js`) | Reused for "on account" acquisitions and sales to a customer |
| Org units | Division, Branch, Warehouse, Rack, CostCenter, ProfitCenter | No Department or Location (question 8) |
| Employees | No employee master | Responsible employee (question 9) |
| Period lock | None anywhere in the system | Question 15 |
| Currency | One default currency; new modules post company currency only | Same here; foreign-currency fields reserved |
| Company Master | Input/Output Tax, GRN Clearing, Discount, Round Off accounts, PDC clearing accounts | Output Tax reused for VAT on an asset sale |

## Master data

### Asset Class (`faClasses`)

| Field | Notes |
|---|---|
| Code, Name | e.g. `VEH` Vehicles. Code unique |
| Kind | `Tangible` · `Land` (never depreciated) · `Intangible` (amortized; same engine) · `AuC` (collects cost, never depreciated) |
| Default method | `SL` (straight line) · `WDV` (written down value) · `None` |
| Default useful life | months (entered as years + months) |
| Default WDV rate | % a year, for WDV |
| Default residual value | % of cost |
| Account determination | reference, see below |
| Company | blank = shared by all companies, as other masters |
| Status | Active / Inactive. A class in use can't be deleted |

Proposed seed list (the owner's ten, created by an admin, not coded in):
Land, Buildings, Machinery, Vehicles, Furniture & Fixtures, Computers &
IT Equipment, Office Equipment, Leasehold Improvements, Intangible
Assets, Assets Under Construction.

### Account Determination (`faAccountDetermination`)

GL accounts are never stored on an asset. A class points to an account
determination key. The key holds the accounts per company, with an
optional shared row (because a COA account can be restricted to one
company).

| Account | Used by | Account type check |
|---|---|---|
| Asset cost (APC) | acquisition, disposal, settlement | Asset |
| Accumulated depreciation | depreciation, disposal | Asset (contra) |
| Depreciation expense | depreciation | Expense |
| Gain on disposal | disposal | Revenue |
| Loss on disposal | disposal | Expense |
| Asset clearing | acquisition from a vendor invoice | Asset or Liability, not bank, not a party control account |
| AuC | AuC classes: cost collected; settlement credit | Asset |
| *reserved:* revaluation reserve, impairment loss, accumulated impairment | future | — |

Resolution: class → key → the company's row, else the shared row. A post
fails with a clear message naming the missing account ("Vehicles: no Loss
on Disposal account for company 01").

### Asset Master (`faAssets`)

| Group | Fields |
|---|---|
| Identity | **Asset number** (system, unique, never reused; question 2), sub-number (0 now; components later), company, class (mandatory), description, serial number, tag/barcode, quantity (default 1), notes |
| Origin | supplier (vendor master), purchase invoice (link to a posted Vendor Invoice, or reference text), purchase date, capitalization date (set by the first acquisition) |
| Valuation, per depreciation area | method (mandatory unless Land/AuC), useful life (mandatory for SL, months), WDV rate (mandatory for WDV), residual value, depreciation start date |
| Assignment | division, branch, cost center (mandatory when depreciable), department, location, responsible employee, profit center |
| Balances, per area (kept by the server, never edited) | cost, accumulated depreciation, NBV, last depreciated period, disposed at |
| Status | `Planned` (created, not capitalized) · `UnderConstruction` (AuC) · `Active` · `FullyDepreciated` · `Disposed` · `Transferred` (inter-company, later; question 21) |

Rules:
- Class, method and life default from the class and can be overridden.
- Before capitalization everything is editable, and an asset with no
  transactions can be deleted (it's still only master data).
- After capitalization: class and company are fixed. Description,
  serial, notes and so on stay editable. Assignment changes only through
  a **Transfer**. Method, life, residual and rate can change only
  prospectively (question 20). Every change to a master field is kept in
  its history (old value, new value, user, time).
- Currency: company currency only now. Fields for transaction currency
  and rate are reserved.

## Asset transactions (the sub-ledger)

`faTransactions`, **append-only**. Nothing in it is edited or deleted.
One document per asset per area per event.

| Field | Notes |
|---|---|
| Txn number, type, date, period (`YYYY-MM`), company, asset, area | |
| Cost Δ, accumulated depreciation Δ | signed amounts; the asset's balances are the sums of these |
| Proceeds, NBV at disposal, gain/loss | disposal only |
| Assignment before / after | transfer only |
| Source | `{ type, id, number }`: vendor invoice, AuC, depreciation run, etc. |
| GL entry | journal entry id and voucher number (blank for non-financial ones) |
| Reversal of / reversed by | links both ways |
| Reason, created by, created at | |

**Types.** Now: `Acquisition` (the first one capitalizes), `Addition`
(more cost on an active asset), `TakeOver` (opening balance, question 7),
`AuCCost`, `AuCSettlement` (out of the AuC, into the final asset),
`Depreciation`, `Transfer`, `ProfitCenterTransfer`, `Disposal`,
`MasterChange` (non-financial; valuation-field changes), `Reversal`.
Reserved: `Revaluation`, `Impairment`, `WriteUp`,
`IntercoTransferOut/In`, `Split`, `Merge`.

The asset's balance fields are a cache of these sums. They're written in
the same commit as the transaction, and a check (in the reconciliation
report) recomputes them from the transactions.

## Accounting

Every entry is an ordinary GL entry in `journalEntries`, with its own
voucher types and numbers per company and year, like the stock and PDC
vouchers. The JV screen refuses to reverse them (only the asset screens
can), and GL Report drill-through opens the asset screen, as for PDC.

| Event | Entry | Voucher (proposed) |
|---|---|---|
| Acquisition, direct purchase | Dr Asset cost · Cr Bank/Cash (a `10…`/`11…` account) | `FAA` |
| Acquisition on account (AP) | Dr Asset cost · Cr Vendor payables (party-tagged New Ref, so it's in the vendor SOA and payable by CBT allocation) | `FAA` |
| Acquisition from a vendor invoice | (the invoice already posted Dr Asset clearing · Cr Vendor) · then Dr Asset cost · Cr Asset clearing | `FAA` |
| Take-over of an existing asset | none (question 7) | — |
| AuC cost | Dr AuC · Cr Bank / Vendor / Asset clearing | `FAA` |
| AuC settlement | Dr Asset cost (final asset) · Cr AuC | `FAS` |
| Depreciation (monthly run) | Dr Depreciation expense (by cost center, profit center) · Cr Accumulated depreciation | `FAD` |
| Profit-center transfer | Dr Asset cost (new PC) · Cr Asset cost (old PC) · Dr Acc. dep. (old PC) · Cr Acc. dep. (new PC) | `FAT` |
| Disposal | Dr Bank/Cash or Customer (proceeds) · Dr Accumulated depreciation · Dr Loss (if any) · Cr Asset cost · Cr Gain (if any) · Cr Output VAT (if any, question 11) | `FAR` |
| Reversal of any of the above | the exact opposite, dated as chosen within an open period | next number of the same type |

Disposal example (the brief's): cost 6,000, accumulated depreciation
4,000, NBV 2,000, proceeds 1,000:

| Account | Dr | Cr |
|---|---|---|
| Bank | 1,000 | |
| Accumulated depreciation | 4,000 | |
| Loss on disposal | 1,000 | |
| Asset cost | | 6,000 |

Before the disposal entry, the disposal posts the depreciation for the
disposal month up to the disposal date (own `FAD` entry, same commit),
so the NBV used is the NBV on that day.

## Depreciation engine

Pure functions (`functions/src/faDepreciation.js`), unit-tested on their
own. They take an asset's valuation and transactions and return the
depreciation due for a period.

**Depreciable amount** = cost − residual value. Accumulated depreciation
can never exceed it. The last charge is capped at what's left, which
also absorbs rounding (amounts rounded to 2 decimals each month).

**Straight line.** Monthly charge = depreciable amount ÷ useful life in
months. The brief's example: 120,000, 10 years, residual 0 → 12,000 a
year, 1,000 a month. After an Addition or a change of estimate: the
remaining depreciable amount ÷ the remaining months.

**Written down value.** The charge for a fiscal year = NBV at the start
of the year (or the cost, in the year of capitalization) × the annual
rate. It's spread evenly over the months, pro-rata in the first year.
Example: 100,000 at 25% → 2,083.33 a month in year 1, then 75,000 × 25%
= 1,562.50 a month in year 2. Stops at the residual value. What happens
at the end of the useful life is question 5.

**Partial periods** (question 4, proposal: by day). Depreciation starts
on the depreciation start date (default: the capitalization date). The
first month is charged for its remaining days: start 17 March → 15/31 of
a month (1,000 → 483.87). The shortfall is charged after the last full
month, so the total is always exactly the depreciable amount. A disposal
charges the days up to the disposal date.

**Not depreciated:** Land, AuC, Planned, Disposed, FullyDepreciated, and
any asset whose depreciation start date is after the period.

**Catch-up** (question 13). An asset capitalized with a date in an
already-posted period gets the missed months in the next run, as one
line marked *catch-up*.

**Depreciation areas.** Each asset carries its valuation and balances
per area. v1 has one area, `BOOK`, which posts to the GL. A `TAX` or
`IFRS` area later is another key with its own method, life and
transactions, and no GL posting (or its own ledger). The run and the
register take an area.

## Depreciation run

Per company and period (calendar month).

1. **Select** company and period. The screen shows the last posted
   period and refuses a period out of order (question 14).
2. **Preview**: every eligible asset, with opening NBV, the month's
   charge (and catch-up), closing NBV, and any warnings (missing cost
   center, missing accounts). Totals by class and account. Exportable to
   CSV. Nothing is written.
3. **Post** (the `post` right): under the global lock, recompute (the
   preview isn't trusted), then write in one commit:
   - one GL entry dated the last day of the period, lines summed by
     expense account, cost center and profit center, and by
     accumulated-depreciation account;
   - one `Depreciation` transaction per asset;
   - the asset balances, and the status → `FullyDepreciated` where the
     depreciable amount is reached;
   - the period record `faPeriods/{company}_{area}_{YYYY-MM}` = Posted.
     Its fixed document id is what makes a duplicate run impossible:
     a second post finds it Posted and stops.
4. **Reverse** (the `reverse` right, question 14): only the latest posted
   period. A reversal GL entry, a `Reversal` transaction per asset,
   balances and statuses restored, period back to Open. It can then be
   run again.

**Depreciation register** (per run, or any period range): asset,
class, cost center, opening NBV, depreciation for the period,
accumulated depreciation, closing NBV, with totals by class.

*Technical note:* Firestore commits are limited to 500 writes, so a large
run is written in chunks with fixed transaction ids and a `Posting` run
status. A run that stops half-way resumes and finishes on the next post,
and nothing counts until the period record says Posted. This is the same
idea as the existing commit-attempt markers.

## Transfer (within the company)

Changes division, branch, cost center, department, location, responsible
employee and/or profit center, from a date. It never changes cost or
accumulated depreciation. A `Transfer` transaction keeps the before and
after values, so the asset's history shows every move.

- Depreciation posted from the transfer date onward goes to the new cost
  center. A transfer dated inside an already-posted period is refused.
- A profit-center change also posts the `FAT` reclass entry above, so
  balance-sheet-by-profit-center stays right (question 10).
- Inter-company transfer (the only one that moves cost and accumulated
  depreciation) is reserved: `IntercoTransferOut` in the sending company
  (status `Transferred`) and `IntercoTransferIn` in the receiving one.

## Disposal / retirement

Types: **Sale**, **Scrapping**, **Write-off**, **Other retirement**
(reason required). Whole asset in v1. Partial disposal is question 19.

- Inputs: date, type, proceeds (sale only), where the proceeds go (bank
  or cash account, or a customer on account, question 11), VAT %, reason.
- The screen shows cost, accumulated depreciation to the disposal date,
  NBV, proceeds and gain/loss before posting.
- NBV = cost − accumulated depreciation. Gain/loss = proceeds − NBV.
- Status → `Disposed`. The engine never depreciates it again, and a
  disposed asset refuses every transaction except the reversal of its
  disposal.
- Reversing a disposal restores the asset (status, balances) with a
  reversing entry. It's refused once a later depreciation period has
  been posted for the company (reverse that first).

## Assets under Construction (AuC)

An AuC is an asset of an `AuC` class (status `UnderConstruction`).

- **Cost lines**, each tagged Materials / Contractors / Labour /
  Consultants / Other: posted from the asset screen against bank, a
  vendor (on account), or asset clearing (for costs invoiced through
  Vendor Invoice). Materials from stock via Material Issue is question 23.
- **Settlement** when it's finished: choose one or more final assets
  (new or existing, of depreciable classes) and the amount for each.
  Posts Dr Asset cost (each final asset) · Cr AuC. The final assets are
  capitalized on the settlement date and depreciate from their own
  depreciation start date. A partial settlement leaves the rest on the
  AuC. A fully settled AuC becomes `Disposed` (settled) with a zero
  balance.
- The AuC's history lists every cost line and settlement.

## Reports and screens

Six screens, one server module each where it helps
(`functions/src/fixedAssets*.js`):

| Screen | Contents | Tree node |
|---|---|---|
| `FACONFIG` Fixed Asset Setup | classes, account determination, depreciation settings (FA lock date, question 15) | new node under Asset Accounting |
| `FAASSET` Asset Master | asset list with search; the asset form; **History** tab (every transaction and master change, user, time, GL voucher link); Transfer action | *Capital Asset Master Management* |
| `FATXN` Asset Transactions | acquisition, addition, take-over, AuC cost, AuC settlement, with the GL preview before posting; reversal | *Asset Acquisition & CWIP* |
| `FADEPRUN` Depreciation Run | select, preview, post, reverse; the depreciation register | *Multi-GAAP Depreciation Calculation Engine* |
| `FARETIRE` Asset Retirement | disposal with the gain/loss calculation; disposal reversal | *Asset Retirement, Transfer & Impairment* |
| `FAREPORTS` Asset Reports | **Asset Register**, **Reconciliation**, **Dashboard** (tabs) | new node under Asset Accounting |

**Asset Register**, as at a date, filters: asset number, class,
description, department, cost center, location, status, acquisition and
capitalization date ranges, supplier. Columns: original cost, additions,
transfers, accumulated depreciation, current-period depreciation, NBV,
disposal value, gain/loss. Totals by class. Print and CSV. Built from the
transactions, so any past date gives the right figures.

**Reconciliation**, per company as at a date, one row per account from
account determination (asset cost, accumulated depreciation, AuC, asset
clearing):

| Account | Asset register | GL balance | Difference | Status |
|---|---|---|---|---|

Status Reconciled or Difference. A difference drills down to the GL
lines on that account that didn't come from the asset module (manual JV
or CBT), and to asset transactions without a GL entry. Asset clearing
should be zero: its non-zero balance lists the vendor-invoice amounts
not yet capitalized. It also recomputes each asset's cached balances
from its transactions and lists any mismatch.

**Dashboard** (per company, or all the user's companies): total cost,
accumulated depreciation, NBV, current-month depreciation, assets
acquired this month, disposed this month, fully depreciated, AuC balance;
charts of cost/NBV by class, by department and by location.

## Controls

| Control | How |
|---|---|
| Unique asset number | server-generated under the global lock; counter never goes back |
| Mandatory class, method, useful life (or WDV rate) | checked on save and again at capitalization |
| No depreciation of disposed assets, none beyond the depreciable amount | engine; the post recomputes under the lock |
| No duplicate depreciation for a period | the fixed-id period record, set in the same commit |
| No deleting posted transactions | no delete function exists; reversal only |
| Reversal instead of change | every reversal is its own transaction and GL entry, linked both ways |
| Audit trail | transactions and master changes: user, time, source, GL voucher |
| Entries not editable elsewhere | JV refuses to reverse FA voucher types; question 16 on manual postings to FA accounts |
| Period locking | question 15 |
| Role-based authorization | module rights below; company access as everywhere |
| Concurrency | every post under the global lock (`lock.js`), unchanged |
| Atomicity | GL entry, transactions and balances in the same Firestore commit (see storage) |

## Permissions (proposed, question 18)

| Module | access | draft | post | other |
|---|---|---|---|---|
| FACONFIG | ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER | — | — | write: ADMIN, FINANCE_MGR |
| FAASSET | all four | ADMIN, FINANCE_MGR, ACCOUNTANT | ADMIN, FINANCE_MGR (capitalize-related, transfer) | |
| FATXN, FARETIRE | all four | ADMIN, FINANCE_MGR, ACCOUNTANT | ADMIN, FINANCE_MGR | |
| FADEPRUN | all four | — | ADMIN, FINANCE_MGR | reverse: ADMIN, FINANCE_MGR |
| FAREPORTS | all four | — | — | |

## Storage

Firestore, not RTDB: `faClasses`, `faAccountDetermination`, `faAssets`,
`faTransactions`, `faPeriods`, `faRuns`, `faSettings`. Reasons: the GL
entries are already in Firestore, so an asset transaction, its GL entry
and the asset's balances can be written in **one atomic commit**, with no
cross-database gap (the gap PDC lists under Known gaps). Transactions grow
by one per asset per month, and Firestore can query them by asset, period
or company without reading everything. Voucher counters stay where they
are (RTDB), under the global lock. Security Rules stay deny-all. Data
Reset gets a `fixedAssets` category.

## Future-ready

| Later | Where it fits |
|---|---|
| Multiple depreciation areas / books, tax and IFRS depreciation | `Area` on valuation, balances, transactions, runs and periods; v1 has `BOOK` only |
| Revaluation, impairment, write-up | reserved transaction types and accounts; balances get revaluation/impairment fields |
| Component accounting | sub-number and parent asset on the master |
| Lease assets (IFRS 16) | a `RightOfUse` class kind; lease liability stays in the GL |
| Foreign-currency assets | reserved currency and rate fields on transactions |
| Inter-company transfers | reserved types and the `Transferred` status |
| Splitting / merging | reserved types; quantity on the master |
| Multiple books | a book = an area with its own GL target |

## Compared with SAP FI-AA and SME ERPs

| Feature | Here |
|---|---|
| Asset classes, account determination, number ranges | ✓ |
| Integrated acquisition with vendor, via asset clearing | ✓ |
| Depreciation keys (SL, declining balance), pro-rata at day | ✓ (two methods) |
| Depreciation run with test run, repeat protection, reversal | ✓ |
| Transfers within the company, with history | ✓ |
| Retirement with revenue, scrapping, gain/loss | ✓ (whole asset) |
| AuC with settlement to one or more assets | ✓ |
| Asset explorer (history per asset) | ✓ History tab |
| Legacy data transfer (take-over) | ✓ (question 7) |
| Parallel depreciation areas | model ready; one area now |
| Partial retirement, revaluation, impairment, leases, inter-company | later (question 19) |
| Unplanned depreciation, low-value asset rule, insurance, maintenance | later (question 19) |
| Year-end closing of the asset fiscal year | not needed: periods are posted in order |

## Open questions (owner's decisions)

Each has a recommendation. Say "agree all" or change any of them.

| # | Question | Recommendation |
|---|---|---|
| 1 | **Phasing.** Build and deploy all at once, or in phases? | Three phases, each tested and deployed on its own: **(1)** setup, asset master, acquisition (all routes, take-over), depreciation engine and run, register, history; **(2)** transfer, disposal, AuC; **(3)** reconciliation, dashboard, the JV guard |
| 2 | **Asset number format** | `FA-<company ref>-<6 digits>` per company (`FA-01-000001`); class shown beside it, not in it. Alternative: class prefix (`VEH-01-000001`) |
| 3 | **Fiscal year**: calendar year? | Yes (the system's vouchers already number by calendar year). A start-month setting can come later |
| 4 | **First/last partial month** | Pro-rata by day, as above. Alternatives: full month from the start month; from the next month; mid-month rule (before the 16th = full month) |
| 5 | **WDV**: rate entered or derived from life? Base? End of life? | Rate entered (class default, e.g. 25%); base = NBV at the start of the fiscal year; at the end of the useful life the remaining NBV above the residual is charged in the last month |
| 6 | **Acquisition from a purchase invoice** | Through an **asset clearing account**: the Vendor Invoice direct line debits clearing (no change to the ported Vendor Invoice), and the asset acquisition picks that posted invoice and credits clearing. The reconciliation lists what's still in clearing. Alternative: tag the asset on the Vendor Invoice line (changes a ported module) |
| 7 | **Existing assets** (bought before go-live, already in the GL) | A **take-over** transaction with cost, accumulated depreciation and last depreciated period, and **no GL entry** (the GL already has them). Reconciliation then proves they match |
| 8 | **Department and Location** | Add `Department` and `Location` as Org Unit types (one small patch to Org Units; company-scoped, hierarchical, reusable later). Alternative: department = cost center, and a location list inside Fixed Asset Setup |
| 9 | **Responsible employee** (no employee master) | Free-text name for now, plus an optional link to a system user. Replace with the employee master when HR exists |
| 10 | **Profit-center change on transfer**: post a reclass entry? | Yes (`FAT`). Other assignment changes post nothing |
| 11 | **Sale proceeds and VAT** | Proceeds to a bank/cash account, or to a customer on account (party-tagged, in the SOA). Optional VAT % posted to the company's Output Tax account |
| 12 | **Disposal date rules** | Disposal date after the last posted depreciation period; the disposal month's depreciation up to that day is posted with it |
| 13 | **Back-dated acquisition** into a posted period | Allowed; the missed months are caught up in the next run. Alternative: refuse |
| 14 | **Run order and reversal** | Periods posted in order, no gaps; only the latest period can be reversed, by ADMIN or FINANCE_MGR, and a reversal needs a reason |
| 15 | **Period locking** (none exists today) | An **FA lock date** per company in Fixed Asset Setup: no asset transaction, run or reversal dated on or before it. A system-wide GL lock date for every module is a separate follow-up (it touches ported modules) |
| 16 | **Manual postings to asset accounts** | Refuse JV and CBT lines on accounts used as asset cost, accumulated depreciation or AuC (reconciliation accounts, as SAP). Alternative: allow, and show them as differences |
| 17 | **Approvals** | Acquisition and disposal can be gated in Approval Configuration, optional per company, like the others. Depreciation runs and transfers not gated |
| 18 | **Roles** | As in the Permissions table |
| 19 | **Later, not now** | Partial disposal, revaluation, impairment, leases, inter-company transfer, split/merge, a capitalization threshold (low-value assets), attachments/photos, barcode printing, insurance and maintenance. Agree to leave them? |
| 20 | **Changing method, life or residual after capitalization** | Allowed, prospectively from the next unposted period (a change of estimate), recorded in history |
| 21 | **"Transferred" status** | Only for an asset moved to another company (later). A transfer within the company keeps it Active |
| 22 | **Class change after capitalization** | Refused in v1 (it would move the balances between accounts); later as a reclass transaction |
| 23 | **AuC cost from stock** (materials issued from inventory) | Later: needs a Material Issue change. Now: costs from bank, vendor or asset clearing |
| 24 | **Menu** | Link the four existing FI-AA nodes as in the Screens table and add two: *Fixed Asset Setup* and *Asset Reports* |

## Build plan (after the design is agreed)

Phase 1:
1. Org Units: `Department`, `Location` types (generator patch, if
   question 8 agrees).
2. `faDepreciation.js` (pure engine) with unit tests first: the brief's
   examples, partial months, WDV, caps, catch-up, rounding.
3. Server: setup (classes, account determination, settings), asset
   master, acquisitions (direct, on account, from invoice via clearing,
   take-over), depreciation preview/post/reverse, register, history.
   Reuse `glWriting` (a variant that returns the entry for one Firestore
   commit), `partyLedger`, `approvals`, `lock`.
4. Registries: `moduleRegistry.js`, `approvalRegistry.js`, voucher-type
   maps in `glWriting.js`, `journal.js`, `masterData.js`,
   `treeSeedNodes.js`, Data Reset.
5. Screens `FACONFIG`, `FAASSET`, `FATXN`, `FADEPRUN`, `FAREPORTS`
   (register tab).
6. Tests: emulator suite `fixedAssets.emulator.test.js` (lifecycle,
   duplicate run, reversal, controls, company access) and a UI check;
   negative controls. Then deploy set, deploy, release screens, link in
   the tree.

Phases 2 and 3 as in question 1, each with its own tests and deploy.
