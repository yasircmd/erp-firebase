# Fixed Assets (Asset Accounting, FI-AA)

**Status:** phase 1 deployed 2026-09-26 ([DEPLOY_LOG.md](../DEPLOY_LOG.md)); phase 2 retirement (sale, scrap) deployed 2026-09-26; transfer, AuC and phase 3 not started · **Roadmap:** [#6](../ROADMAP.md) · **Branch:** `worktree-fixed-assets-design`

## Purpose

An asset sub-ledger and depreciation engine, modelled on SAP FI-AA and
kept at SME size. Every asset has a class and a master record. Each
financial event on it is an immutable **asset transaction** that posts a
normal GL entry. The General Ledger stays the official book. The asset
sub-ledger explains its asset balances and must reconcile to it.

```
Asset Class → Account Determination → GL accounts
     ↓
Asset Master ──→ Asset Transactions (capitalization, depreciation,
     ↓                transfer, disposal, AuC settlement, reversal …)
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

**Owner's notes with the decisions (2026-09-26):**
1. A **Fixed Asset Clearing Account** already exists in the chart of
   accounts. Every asset purchase (Vendor Invoice, CBT, JV) posts to it,
   and capitalization transfers it from there to the asset account.
2. Configuration is a **separate Fixed Asset Configuration module**.
3. Period lock, location, employee and similar are developed later:
   **reserve space for them now** (see [Reserved for later](#reserved-for-later)).
4. Besides the scheduled depreciation, an option for **additional
   depreciation** (see [Additional depreciation](#additional-depreciation)).
5. List the **sub-modules** required (see [Sub-modules](#sub-modules)).

## What exists today (checked 2026-09-26)

| Area | Today | Consequence for this design |
|---|---|---|
| Menu tree | Four FI-AA nodes, no module linked: *Capital Asset Master Management*, *Asset Acquisition & CWIP*, *Multi-GAAP Depreciation Calculation Engine*, *Asset Retirement, Transfer & Impairment* | Linked to sub-modules; new nodes added for the rest |
| Chart of accounts | `620000 Depreciation Expense` header seeded; the Fixed Asset Clearing Account exists in the live COA (data, not code) | The module seeds no accounts. The clearing account is chosen per company in Fixed Asset Configuration |
| Purchases | Vendor Invoice direct lines, CBT and JV can all post to any postable account | Unchanged: they debit the clearing account, as today |
| GL writing | `glWriting.writeStockGlEntry`: validated, balanced entry in Firestore `journalEntries`, voucher number per company and year; Expense lines **require a cost center** | Reused. Depreciable assets therefore need a cost center |
| Party ledger | JV/CBT/PDC lines tagged with vendor/customer (`partyLedger.js`) | Reused for a sale to a customer on account |
| Org units | Division, Branch, Warehouse, Rack, CostCenter, ProfitCenter | Department and Location reserved, not built |
| Employees | No employee master | Responsible employee reserved |
| Period lock | None anywhere in the system | Reserved: one guard function all posts go through |
| Currency | One default currency; new modules post company currency only | Same here; foreign-currency fields reserved |
| Company Master | Input/Output Tax, GRN Clearing, Discount, Round Off, PDC clearing accounts | Output Tax reused for VAT on an asset sale; Company Master itself unchanged |

## Sub-modules

Each sub-module is its own module in the module registry (own rights,
own screen, own menu node), under *Asset Accounting (FI-AA)*.

| # | Sub-module (menu node) | Module ID | What it does | Phase |
|---|---|---|---|---|
| 1 | **Fixed Asset Configuration** (new node) | `FACONFIG` | Asset classes; account determination; per-company settings: Fixed Asset Clearing Account, asset number counter; reserved: period lock, locations | 1 |
| 2 | **Fixed Asset Master** (*Capital Asset Master Management*) | `FAASSET` | Create and maintain assets; asset list and search; **History** tab (every transaction and master change); change of estimate (method, life, residual) | 1 |
| 3 | **Fixed Asset Capitalization** (*Asset Acquisition & Capital Work-in-Progress (CWIP)*) | `FAACQ` | Capitalize from the clearing account (first acquisition and additions); take-over of existing assets; reversal | 1 |
| 4 | **Depreciation Run** (*Multi-GAAP Depreciation Calculation Engine*) | `FADEPRUN` | Monthly scheduled depreciation: select, preview, post, reverse; depreciation register | 1 |
| 5 | **Additional Depreciation** (new node) | `FAADDDEP` | Extra (unplanned) depreciation on chosen assets, with reason; reversal | 1 |
| 6 | **Fixed Asset Register** (new node) | `FAREGISTER` | Fixed Asset Register as at a date with filters; asset history report | 1 |
| 7 | **Asset Transfer** (new node) | `FATRANSFER` | Transfers between cost centers, profit centers, divisions, branches (reserved: departments, locations, employees); transfer history | 2 |
| 8 | **Asset Retirement** (*Asset Retirement, Transfer & Impairment*) | `FARETIRE` | Sale, scrapping, write-off, other retirement; gain/loss; reversal | 2 |
| 9 | **Assets under Construction** (new node) | `FAAUC` | Cost collected on an AuC from the clearing account; settlement to final assets | 2 |
| 10 | **Asset Reconciliation** (new node) | `FARECON` | Asset register vs GL, per account | 3 |
| 11 | **Fixed Asset Dashboard** (new node) | `FADASHBOARD` | KPIs and breakdowns | 3 |

Reversal isn't a sub-module: each sub-module reverses its own
transactions, with its own rights.

**Later sub-modules (reserved, not built):** Revaluation & Impairment,
Inter-company Transfer, Asset Split/Merge, Lease Assets (IFRS 16),
Depreciation Areas (tax / IFRS books), Period Lock (system-wide, with
GL), Asset Locations and Employees (when those masters exist).

## Master data

### Asset Class (`faClasses`), in Fixed Asset Configuration

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

Classes the owner will create in the app (not coded in): Land,
Buildings, Machinery, Vehicles, Furniture & Fixtures, Computers & IT
Equipment, Office Equipment, Leasehold Improvements, Intangible Assets,
Assets Under Construction.

### Account Determination (`faAccountDetermination`), in Fixed Asset Configuration

GL accounts are never stored on an asset. A class points to an account
determination key. The key holds the accounts per company, with an
optional shared row (a COA account can be restricted to one company).

| Account | Used by | Account type check |
|---|---|---|
| Asset cost (APC) | capitalization, disposal, settlement | Asset |
| Accumulated depreciation | depreciation, additional depreciation, disposal | Asset (contra) |
| Depreciation expense | scheduled depreciation | Expense |
| Additional depreciation expense | additional depreciation; optional, blank = depreciation expense | Expense |
| Gain on disposal | disposal | Revenue |
| Loss on disposal | disposal | Expense |
| AuC | AuC classes: cost collected; settlement credit | Asset |
| Fixed Asset Clearing (override) | optional; blank = the company's clearing account from settings | Asset or Liability, not bank, not a party control account |
| *reserved:* revaluation reserve, impairment loss, accumulated impairment | later | — |

**Fixed Asset Clearing Account:** one per company, chosen in Fixed Asset
Configuration → Settings. It's the existing account the owner's
purchases already post to. A key can override it (rarely needed).

Resolution: class → key → the company's row, else the shared row. A post
fails with a clear message naming the missing account ("Vehicles: no Loss
on Disposal account for company 01").

### Asset Master (`faAssets`)

| Group | Fields |
|---|---|
| Identity | **Asset number** `FA-<company ref>-<6 digits>` (system, unique, never reused), sub-number (0 now; components later), company, class (mandatory), description, serial number, tag/barcode, quantity (default 1), notes |
| Origin | supplier (vendor master), purchase invoice (link or reference), purchase date, capitalization date (set by the first capitalization). Supplier and invoice fill in from the clearing item when it came from a Vendor Invoice |
| Valuation, per depreciation area | method (mandatory unless Land/AuC), useful life (mandatory for SL, months), WDV rate (mandatory for WDV), residual value, depreciation start date |
| Assignment, live | division, branch, cost center (mandatory when depreciable), profit center |
| Assignment, **reserved** | department, location, responsible employee (see [Reserved for later](#reserved-for-later)) |
| Balances, per area (kept by the server, never edited) | cost, accumulated depreciation (scheduled and additional kept apart), NBV, last depreciated period, disposed at |
| Status | `Planned` (created, not capitalized) · `UnderConstruction` (AuC) · `Active` · `FullyDepreciated` · `Disposed` · `Transferred` (reserved: inter-company) |

Rules:
- Class, method and life default from the class and can be overridden.
- Before capitalization everything is editable, and an asset with no
  transactions can be deleted (it's still only master data).
- After capitalization: class and company are fixed (a class change is
  refused in v1). Description, serial, notes and so on stay editable.
  Assignment changes only through a **Transfer**. Method, life, residual
  and rate change only prospectively, from the next unposted period (a
  change of estimate). Every master change is kept in the history (old
  value, new value, user, time).
- Currency: company currency only now; transaction currency and rate
  fields are reserved.

## Asset transactions (the sub-ledger)

`faTransactions`, **append-only**. Nothing in it is edited or deleted.
One document per asset per area per event.

| Field | Notes |
|---|---|
| Txn number, type, date, period (`YYYY-MM`), company, asset, area | |
| Cost Δ, accumulated depreciation Δ | signed amounts; the asset's balances are the sums of these |
| Proceeds, NBV at disposal, gain/loss | disposal only |
| Clearing items used | capitalization / AuC cost: `[{ journal entry id, line no, amount }]` |
| Assignment before / after | transfer only |
| Source | `{ type, id, number }`: clearing entry, AuC, depreciation run, etc. |
| GL entry | journal entry id and voucher number (blank for non-financial ones) |
| Reversal of / reversed by | links both ways |
| Reason, created by, created at | reason mandatory on additional depreciation, retirement and every reversal |

**Types.** Now: `Capitalization` (the first one on an asset), `Addition`
(more cost on an active asset), `TakeOver` (opening balance), `AuCCost`,
`AuCSettlement` (out of the AuC, into the final asset), `Depreciation`,
`AdditionalDepreciation`, `Transfer`, `ProfitCenterTransfer`,
`Disposal`, `MasterChange` (non-financial), `Reversal`. Reserved:
`Revaluation`, `Impairment`, `WriteUp`, `IntercoTransferOut/In`,
`Split`, `Merge`.

The asset's balance fields are a cache of these sums, written in the
same commit as the transaction. The reconciliation recomputes them from
the transactions and lists any mismatch.

## Accounting

Every entry is an ordinary GL entry in `journalEntries`, with its own
voucher types and numbers per company and year, like the stock and PDC
vouchers. The JV screen refuses to reverse them (only the asset
sub-modules can), and GL Report drill-through opens the asset screen, as
for PDC.

**How purchases reach an asset (owner's note 1):** the purchase itself is
posted as today, by Vendor Invoice (direct line), CBT or JV, to the
**Fixed Asset Clearing Account**. Nothing changes in those modules.
Capitalization then moves the amount from clearing to the asset.

| Event | Entry | Voucher |
|---|---|---|
| Purchase (existing modules) | Dr FA Clearing · Cr Vendor / Bank / … | VINV, CBT, JV as today |
| Capitalization / Addition | Dr Asset cost · Cr FA Clearing | `FAA` |
| Take-over of an existing asset | none (the GL already has it) | — |
| AuC cost | Dr AuC · Cr FA Clearing | `FAA` |
| AuC settlement | Dr Asset cost (final asset) · Cr AuC | `FAS` |
| Scheduled depreciation (monthly run) | Dr Depreciation expense (by cost center, profit center) · Cr Accumulated depreciation | `FAD` |
| Additional depreciation | Dr Additional depreciation expense (or depreciation expense) · Cr Accumulated depreciation | `FAU` |
| Profit-center transfer | Dr Asset cost (new PC) · Cr Asset cost (old PC) · Dr Acc. dep. (old PC) · Cr Acc. dep. (new PC) | `FAT` |
| Disposal | Dr Bank/Cash or Customer (proceeds) · Dr Accumulated depreciation · Dr Loss (if any) · Cr Asset cost · Cr Gain (if any) · Cr Output VAT (if any) | `FAR` |
| Reversal of any of the above | the exact opposite, dated as chosen | next number of the same type |

### Capitalizing from the clearing account

- **Open clearing items** = posted GL lines on the company's clearing
  account (from any module), minus what has already been capitalized from
  each. A source entry that has been reversed isn't an open item. Credit
  lines on clearing (a debit note, a correction) are listed and reduce
  the open balance, but aren't capitalized.
- The Capitalization screen lists the open items (date, voucher, source
  module, vendor, description, open amount). The user picks one or more,
  full or partial, for an asset. The amount capitalized is their sum.
- Several items can go to one asset (price + freight + installation),
  and one item can be split across several assets.
- The item's vendor and invoice fill in the asset's supplier and
  purchase invoice when they're blank.
- Whatever is still in clearing shows in the Reconciliation as "not yet
  capitalized", item by item.

### Disposal example (the brief's)

Cost 6,000, accumulated depreciation 4,000, NBV 2,000, proceeds 1,000:

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

**Depreciable amount** = cost − residual value. Scheduled plus additional
accumulated depreciation can never exceed it. The last charge is capped
at what's left, which also absorbs rounding (2 decimals each month).

**Straight line.** Monthly charge = depreciable amount ÷ useful life in
months. The brief's example: 120,000, 10 years, residual 0 → 12,000 a
year, 1,000 a month. After an Addition, additional depreciation or a
change of estimate: the remaining depreciable amount ÷ the remaining
months.

**Written down value.** Rate entered (class default, e.g. 25%). The
charge for a fiscal year (calendar year) = NBV at the start of the year
(or the cost, in the year of capitalization) × the rate, spread evenly
over the months, pro-rata in the first year. Example: 100,000 at 25% →
2,083.33 a month in year 1, then 75,000 × 25% = 1,562.50 a month in
year 2. At the end of the useful life, the remaining NBV above the
residual is charged in the last month.

**Partial periods: pro-rata by day.** Depreciation starts on the
depreciation start date (default: the capitalization date). The first
month is charged for its remaining days: start 17 March → 15/31 of a
month (1,000 → 483.87). The shortfall is charged after the last full
month, so the total is always exactly the depreciable amount. A disposal
charges the days up to the disposal date.

**Not depreciated:** Land, AuC, Planned, Disposed, FullyDepreciated, and
any asset whose depreciation start date is after the period.

**Catch-up.** An asset capitalized with a date in an already-posted
period gets the missed months in the next run, as one line marked
*catch-up*.

**Depreciation areas.** Each asset carries its valuation and balances
per area. v1 has one area, `BOOK`, which posts to the GL. A `TAX` or
`IFRS` area later is another key with its own method, life and
transactions, and no GL posting (or its own ledger). The run and the
register take an area.

## Depreciation run (scheduled)

Per company and period (calendar month).

1. **Select** company and period. The screen shows the last posted
   period. Periods are posted in order, with no gaps.
2. **Preview**: every eligible asset, with opening NBV, the month's
   charge (and catch-up), additional depreciation already posted this
   period, closing NBV, and any warnings (missing cost center, missing
   accounts). Totals by class and account. CSV export. Nothing is written.
3. **Post** (`post` right): under the global lock, recompute (the
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
4. **Reverse** (`reverse` right: ADMIN, FINANCE_MGR; reason mandatory):
   only the latest posted period. A reversal GL entry, a `Reversal`
   transaction per asset, balances and statuses restored, period back to
   Open. It can then be run again.

**Depreciation register** (per run, or any period range): asset, class,
cost center, opening NBV, scheduled depreciation, additional
depreciation, accumulated depreciation, closing NBV, totals by class.

*Technical note:* Firestore commits are limited to 500 writes, so a large
run is written in chunks with fixed transaction ids and a `Posting` run
status. A run that stops half-way resumes and finishes on the next post,
and nothing counts until the period record says Posted. This is the same
idea as the existing commit-attempt markers.

## Additional depreciation

Owner's note 4: depreciation beyond the schedule, when needed (heavier
use, damage, a policy decision), posted by hand.

- **Input:** company, date, one or more assets, the amount for each (or
  a % of NBV), and a reason (mandatory).
- **Limits:** the asset must be Active; the amount can't exceed NBV −
  residual value; the date must be after the last posted run period
  (so it can't slip into a closed month) and on or after the
  depreciation start date.
- **Entry:** Dr Additional depreciation expense (from account
  determination; blank = the depreciation expense account), on the
  asset's cost center and profit center · Cr Accumulated depreciation.
  Voucher `FAU`, one entry per posting, one `AdditionalDepreciation`
  transaction per asset.
- **Effect on the schedule:** straight line spreads the lower remaining
  amount over the remaining months, so the total over the life never
  exceeds the depreciable amount. WDV's next year starts from the lower
  NBV. If it brings the NBV to the residual, the asset becomes
  `FullyDepreciated`.
- **Shown apart:** the register, depreciation register and asset history
  show scheduled and additional depreciation in separate columns.
- **Reversal:** reason mandatory; refused once a later run period has
  been posted for the company (reverse that first).
- Approval gating is optional per company, as for capitalization.
- Distinct from impairment (reserved): impairment will have its own
  accounts and can be written back; additional depreciation can't.

## Transfer (within the company)

Changes division, branch, cost center and/or profit center, from a date
(department, location and responsible employee reserved). It never
changes cost or accumulated depreciation. A `Transfer` transaction keeps
the before and after values, so the asset's history shows every move.

- Depreciation posted from the transfer date onward goes to the new cost
  center. A transfer dated inside an already-posted period is refused.
- A profit-center change also posts the `FAT` reclass entry above, so
  balance-sheet-by-profit-center stays right. Other changes post nothing.
- Inter-company transfer (the only one that moves cost and accumulated
  depreciation) is reserved: `IntercoTransferOut` in the sending company
  (status `Transferred`) and `IntercoTransferIn` in the receiving one.

## Disposal / retirement

Types: **Sale**, **Scrapping**, **Write-off**, **Other retirement**
(reason required). Whole asset in v1; partial disposal later.

- Inputs: date, type, proceeds (sale only), where the proceeds go (a bank
  or cash account, or a customer on account, party-tagged so it's in the
  customer SOA), optional VAT % (to the company's Output Tax account),
  reason.
- The date must be after the last posted run period; the disposal month's
  depreciation up to that day is posted with it.
- The screen shows cost, accumulated depreciation to the disposal date,
  NBV, proceeds and gain/loss before posting. NBV = cost − accumulated
  depreciation; gain/loss = proceeds − NBV.
- Status → `Disposed`. The engine never depreciates it again, and a
  disposed asset refuses every transaction except the reversal of its
  disposal.
- Reversing a disposal restores the asset with a reversing entry; refused
  once a later run period has been posted for the company.

## Assets under Construction (AuC)

An AuC is an asset of an `AuC` class (status `UnderConstruction`).

- **Cost lines** from open items on the Fixed Asset Clearing Account
  (same picker as capitalization), each tagged Materials / Contractors /
  Labour / Consultants / Other. Posts Dr AuC · Cr FA Clearing. Materials
  issued from stock are later (needs a Material Issue change).
- **Settlement** when it's finished: one or more final assets (new or
  existing, depreciable classes), an amount for each. Posts Dr Asset cost
  (each final asset) · Cr AuC. The final assets are capitalized on the
  settlement date and depreciate from their own depreciation start date.
  A partial settlement leaves the rest on the AuC. A fully settled AuC is
  closed with a zero balance.
- The AuC's history lists every cost line and settlement.

## Reports

**Fixed Asset Register** (`FAREGISTER`), as at a date. Filters: asset number,
class, description, cost center, status, acquisition and capitalization
date ranges, supplier; department and location when they exist. Columns:
original cost, additions, transfers, accumulated depreciation (scheduled,
additional), current-period depreciation, NBV, disposal value,
gain/loss. Totals by class. Print and CSV. Built from the transactions,
so any past date gives the right figures.

**Asset Reconciliation** (`FARECON`), per company as at a date, one row
per account from account determination (asset cost, accumulated
depreciation, AuC, FA Clearing):

| Account | Asset register | GL balance | Difference | Status |
|---|---|---|---|---|

Status Reconciled or Difference. A difference drills down to the GL
lines on that account that didn't come from the asset module, and to
asset transactions without a GL entry. For FA Clearing, the "register"
side is the open items not yet capitalized, listed one by one. It also
recomputes each asset's cached balances and lists any mismatch.

**Fixed Asset Dashboard** (`FADASHBOARD`), per company or all the user's
companies: total cost, accumulated depreciation, NBV, current-month
depreciation, assets acquired this month, disposed this month, fully
depreciated, AuC balance, open clearing balance; cost/NBV by class and
by cost center (by department and location once they exist).

## Reserved for later

Owner's note 3. Built later, but given their place now so adding them
needs no restructuring.

| Later feature | Reserved now |
|---|---|
| **Department** | `DepartmentID` on the asset and on transfer before/after; register filter slot. Shown disabled ("available later") on the asset form, so the layout won't change |
| **Location** | `LocationID`, same as department |
| **Responsible employee** | `EmployeeID` (plus `EmployeeName`), same as department |
| **Period lock** | Every asset post goes through one guard, `assertFaPostingOpen(companyId, date)`. Today it checks company access and the run-period order. A future period lock (FA-only or system-wide) is added inside it, and every sub-module obeys it with no other change. `faSettings` has a reserved `LockedThroughDate` |
| Depreciation areas / books | `Area` on valuation, balances, transactions, runs and periods; `BOOK` only now |
| Revaluation, impairment, write-up | transaction types and account-determination slots |
| Components | sub-number and parent asset on the master |
| Lease assets (IFRS 16) | a `RightOfUse` class kind |
| Foreign currency | transaction currency and rate on transactions |
| Inter-company transfer | transaction types and the `Transferred` status |
| Split / merge | transaction types; quantity on the master |
| Partial disposal, low-value asset threshold, attachments/photos, barcode printing, insurance, maintenance | not built; nothing in the model blocks them |

## Controls

| Control | How |
|---|---|
| Unique asset number | server-generated under the global lock; the counter never goes back |
| Mandatory class, method, useful life (or WDV rate) | checked on save and again at capitalization |
| No depreciation of disposed assets, none beyond the depreciable amount | engine (scheduled and additional together); every post recomputes under the lock |
| No duplicate depreciation for a period | the fixed-id period record, set in the same commit |
| No capitalizing the same clearing amount twice | each clearing line's capitalized amount is tracked and checked under the lock |
| No deleting posted transactions | no delete function exists; reversal only |
| Reversal instead of change | every reversal is its own transaction and GL entry, linked both ways, with a reason |
| Audit trail | transactions and master changes: user, time, source, GL voucher |
| Entries not editable elsewhere | JV refuses to reverse FA voucher types. JV and CBT refuse lines on accounts used as asset cost, accumulated depreciation or AuC; the FA Clearing Account stays open to them |
| Period locking | reserved guard (above) |
| Role-based authorization | per sub-module rights below; company access as everywhere |
| Approvals | capitalization, additional depreciation and disposal optionally gated in Approval Configuration per company |
| Concurrency | every post under the global lock (`lock.js`), unchanged |
| Atomicity | GL entry, transactions and balances in the same Firestore commit |

## Permissions

| Module | access | draft | post | other |
|---|---|---|---|---|
| FACONFIG | ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER | — | — | write: ADMIN, FINANCE_MGR |
| FAASSET | all four | ADMIN, FINANCE_MGR, ACCOUNTANT | — (phase 1 has nothing to post) | |
| FAACQ, FAADDDEP, FATRANSFER, FARETIRE, FAAUC | all four | ADMIN, FINANCE_MGR, ACCOUNTANT | ADMIN, FINANCE_MGR | |
| FADEPRUN | all four | — | ADMIN, FINANCE_MGR | reverse: ADMIN, FINANCE_MGR |
| FAREGISTER, FARECON, FADASHBOARD | all four | — | — | |

## Storage

Firestore, not RTDB: `faClasses`, `faAccountDetermination`, `faSettings`,
`faAssets`, `faTransactions`, `faClearingUse`, `faPeriods`, `faRuns`.
The GL entries are already in Firestore, so an asset transaction, its GL
entry and the asset's balances are written in **one atomic commit**, with
no cross-database gap (the gap PDC lists under Known gaps). Transactions
grow by one per asset per month, and Firestore queries them by asset,
period or company without reading everything. Voucher counters stay
where they are (RTDB), under the global lock. Security Rules stay
deny-all. Data Reset gets a `fixedAssets` category.

## Compared with SAP FI-AA and SME ERPs

| Feature | Here |
|---|---|
| Asset classes, account determination, number ranges | ✓ |
| Integrated acquisition via asset clearing | ✓ (the owner's existing clearing account) |
| Depreciation keys (SL, declining balance), pro-rata at day | ✓ (two methods) |
| Depreciation run with test run, repeat protection, reversal | ✓ |
| Unplanned depreciation | ✓ Additional depreciation |
| Transfers within the company, with history | ✓ |
| Retirement with revenue, scrapping, gain/loss | ✓ (whole asset) |
| AuC with settlement to one or more assets | ✓ |
| Asset explorer (history per asset) | ✓ History tab |
| Legacy data transfer (take-over) | ✓ |
| Parallel depreciation areas, revaluation, impairment, leases, inter-company, partial retirement | reserved |

## Owner decisions (2026-09-26)

The owner agreed every recommendation, with the notes at the top. Where a
note changed a recommendation, the decision below says so.

| # | Question | Decision |
|---|---|---|
| 1 | Phasing | Three phases, each tested and deployed on its own (sub-modules table). Additional depreciation added to phase 1 |
| 2 | Asset number | `FA-<company ref>-<6 digits>`, per company |
| 3 | Fiscal year | Calendar year |
| 4 | Partial months | Pro-rata by day |
| 5 | WDV | Rate entered; base = NBV at the start of the fiscal year; remaining NBV charged in the last month of the life |
| 6 | Acquisition from purchases | **Changed by note 1:** every purchase (Vendor Invoice, CBT, JV) posts to the existing Fixed Asset Clearing Account; every capitalization and AuC cost is Dr Asset/AuC · Cr FA Clearing, picked from open clearing items. No direct-to-bank or on-account capitalization |
| 7 | Existing assets | Take-over with no GL entry |
| 8 | Department and Location | **Changed by note 3:** not built now; fields reserved |
| 9 | Responsible employee | **Changed by note 3:** reserved |
| 10 | Profit-center transfer | Reclass entry (`FAT`) |
| 11 | Sale proceeds and VAT | Bank/cash or customer on account; optional VAT to Output Tax |
| 12 | Disposal date | After the last posted run period; disposal-month depreciation posted with it |
| 13 | Back-dated capitalization | Allowed; caught up in the next run |
| 14 | Run order and reversal | In order; only the latest period reversed; ADMIN or FINANCE_MGR; reason mandatory |
| 15 | Period locking | **Changed by note 3:** later; reserved as one guard every post goes through |
| 16 | Manual postings to asset accounts | JV/CBT refused on asset cost, accumulated depreciation and AuC accounts (FA Clearing stays open) |
| 17 | Approvals | Optional per company on capitalization and disposal (and, by note 4, additional depreciation) |
| 18 | Roles | As in Permissions |
| 19 | Later | Partial disposal, revaluation, impairment, leases, inter-company, split/merge, low-value threshold, attachments, barcodes, insurance, maintenance |
| 20 | Change of estimate | Prospective, recorded in history |
| 21 | "Transferred" status | Inter-company only (reserved) |
| 22 | Class change after capitalization | Refused in v1 |
| 23 | AuC cost from stock | Later |
| 24 | Menu | **Extended by notes 2 and 5:** eleven sub-modules, each its own node (Sub-modules table); the four existing FI-AA nodes linked to four of them |

## Build plan

Phase 1 (`FACONFIG`, `FAASSET`, `FAACQ`, `FADEPRUN`, `FAADDDEP`, `FAREGISTER`):
1. `faDepreciation.js` (pure engine) with unit tests first: the brief's
   examples, partial months, WDV, caps, catch-up, additional
   depreciation's effect on the schedule, rounding.
2. Server: configuration (classes, account determination, settings),
   asset master and history, open clearing items and capitalization,
   take-over, depreciation preview/post/reverse, additional depreciation,
   register; the reserved posting guard. Reuse `glWriting` (a variant
   that returns the entry for one Firestore commit), `approvals`, `lock`.
3. Registries: `moduleRegistry.js`, `approvalRegistry.js`, voucher-type
   maps in `glWriting.js`, `journal.js`, `masterData.js`,
   `treeSeedNodes.js`, Data Reset; the JV/CBT guard on asset accounts.
4. Screens for the six sub-modules.
5. Tests: emulator suite `fixedAssets.emulator.test.js` (lifecycle,
   double capitalization of a clearing line, duplicate run, reversal,
   controls, company access) and a UI check; negative controls. Then
   deploy set, deploy, release screens, link the menu nodes.

Phase 2 (`FATRANSFER`, `FARETIRE`, `FAAUC`) and phase 3 (`FARECON`,
`FADASHBOARD`) follow the same steps.

## As built — phase 1 (2026-09-26)

**Code** (`functions/src/`)
- `faDepreciation.js`: the engine, pure functions (no database), unit
  tests in `functions/test/unit/faDepreciation.test.js`.
- `fixedAssetsCommon.js`: collections, rights, account resolution, the
  reserved posting guard (`assertFaPostingOpen`), the JV/CBT guard
  (`assertNoFaControlledAccounts`), the reversal guard for capitalized
  purchases (`assertEntryNotCapitalized`), asset numbering.
- `fixedAssetsConfig.js` (FACONFIG): `getFaRights`, `getFaConfig`,
  `saveFaSettings`, `saveFaAccountDetermination`, `saveFaClass`.
- `fixedAssetsMaster.js` (FAASSET): `getFaAssetSetup`, `getFaAssets`,
  `getFaAsset` (with history), `saveFaAsset`, `deleteFaAsset`.
- `fixedAssetsPostings.js` (FAACQ, FAADDDEP): `getFaClearingItems`,
  `getFaPostings`, `saveFaPostingDraft`, `deleteFaPostingDraft`,
  `postFaPosting`, `decideFaPostingApproval`, `reverseFaPosting`.
- `fixedAssetsDepreciation.js` (FADEPRUN, FAREGISTER):
  `previewFaDepreciation`, `postFaDepreciation`, `reverseFaDepreciation`,
  `getFaRuns`, `getFaDepreciationRegister`, `getFaRegister`.
- `glWriting.js`: `buildStockGlEntry` (the entry without the write, for
  one Firestore commit with the sub-ledger); `writeStockGlEntry` now calls
  it, unchanged for its callers. Voucher prefixes `FAA` (capitalization),
  `FAD` (depreciation), `FAU` (additional), `FAO` (take-over, number only).
- Registries: `moduleRegistry.js` (six modules, rights as in
  Permissions), `approvalRegistry.js` (FAACQ, FAADDDEP gateable, stored
  in `faPostings`), the voucher maps in `journal.js` / `masterData.js`
  (JV refuses to reverse an FA entry; GL Report opens the FA screen),
  `treeSeedNodes.js` (fresh installs). Data Reset: categories
  `fixedAssets` and `fixedAssetSetup` (generator patch).
- Screens: `FACONFIG`, `FAASSET`, `FAACQ`, `FADEPRUN`, `FAADDDEP`,
  `FAREGISTER`.

**Decided while building** (within the agreed design)
- The account determination's shared row is keyed `SHARED` (Firestore
  map keys can't be empty).
- Run state (last posted period, a run in progress) is in `faRunState`,
  apart from `faSettings`, so Data Reset can clear transactions and keep
  the configuration.
- Asset Master: cost/profit center, division and branch can still be
  corrected while no depreciation has been posted for the asset (recorded
  in its history); after that only a Transfer (phase 2) moves it.
  FAASSET has only `access` and `draft` in phase 1.
- A reversal (capitalization, take-over, additional depreciation, a run)
  is dated the same day as what it reverses, so every as-at report stays
  consistent. It is refused while the asset has a later financial
  transaction (reverse that first). A run can only be reversed for the
  latest posted period.
- Capitalization fills the asset's blank supplier, purchase invoice and
  purchase date from the clearing items (the Vendor Invoice, or a JV/CBT
  line tagged with a vendor).
- The JV/CBT guard also runs when a JV pending approval is approved.
  Reversing a JV, CBT or Vendor Invoice is refused while any of its
  clearing lines is capitalized.
- Take-over: the original capitalization date, cost, accumulated
  depreciation, the last period depreciated, and for WDV optionally the
  NBV at the start of the year.
- A large run is written in chunks of 200 assets; an interrupted run is
  finished by posting the same period again, and other asset postings of
  the company wait until it is.

**Tests** (2026-09-26): engine 15/15 unit tests; emulator suite
`fixedAssets.emulator.test.js` 8 tests; UI check `fixedAssets.ui.js`
7/7; the six screens in the smoke check. Negative controls, each caught:
the depreciable-amount cap removed (engine), day pro-rata off (engine),
the duplicate-period check removed, the "still open" check on clearing
lines removed, the JV/CBT account guard removed, the class defaults not
applied on the asset form (UI); the Capitalization screen without its
stale-load guard (UI: a late answer for the company's open items, forced
by the check, wiped the amount typed against an item — found by the
full run, where the shell's one-company default loads the items twice).

**Known gaps**
- Open clearing items are found by reading the company's posted GL
  entries; fine at SME volume, an index (or a clearing-line log) later if
  it grows.
- A run stores its lines on the run document (Firestore's 1 MB limit:
  a few thousand assets per company per month).
- The run and the registers read all of the company's asset
  transactions each time (one per asset per month); period snapshots can
  be added if that grows slow.
- Postings to the clearing account by modules other than Vendor
  Invoice, CBT and JV aren't guarded against reversal after
  capitalization; the reconciliation (phase 3) will show any difference.

**Names (owner, 2026-09-26):** the menu entries were renamed in the live
tree, and the labels everywhere (Roles & Permissions, Approval
Configuration, Home tasks, screen headings, messages, the menu seed) now
match them: Fixed Asset Configuration (FACONFIG), Fixed Asset Master
(FAASSET), Fixed Asset Capitalization (FAACQ), Depreciation Run
(FADEPRUN), Additional Depreciation (FAADDDEP), Fixed Asset Register
(FAREGISTER). The sub-module table above keeps the working names.

## As built — phase 2, retirement (2026-09-26)

**Owner (2026-09-26):** "go phase 2 — retirement as scrap, sale". Built
as **Fixed Asset Retirement** (FARETIRE), following the owner's naming.
Write-off / other retirement, Asset Transfer and Assets under
Construction are not built yet.

**How it works**
- A retirement document holds one or more assets, a date, Sale or Scrap,
  and a reason (required). Sale: proceeds per asset (excluding VAT), to a
  bank/cash account (`10…`/`11…`) or to a customer on account, and an
  optional VAT % posted to the company's Output Tax account. Scrap: no
  proceeds.
- The date must be after the company's last posted depreciation month
  and after the month the asset is depreciated up to. Depreciation up to
  the date is every unposted month before it in full, plus the days of
  the retirement month before the date (`faDepreciation.computeToDate`:
  retired 16 March → 15/31 of March; on the 1st → nothing for March).
- **One GL entry, voucher FAR** (a deviation from the design, which had
  the depreciation as its own FAD entry: one document, one voucher, one
  commit): Dr Depreciation Expense · Cr Accumulated Depreciation (to the
  date); Dr Accumulated Depreciation (all) · Cr Asset Cost; Dr Loss or
  Cr Gain (proceeds − NBV); Dr Bank/Customer (proceeds + VAT) · Cr Output
  VAT. The customer line is party-tagged as a New Ref, so it shows in the
  customer's SOA ("Asset Sale") and is settled by a CBT receipt.
- The asset becomes **Disposed** (balances 0; `DisposedAt`,
  `DisposalType`). Runs, additional depreciation, capitalization, a
  second retirement and master edits all refuse a disposed asset.
- **Reversal** (reason required): mirror entry and reversal
  transactions dated as the original; the asset returns to its previous
  status and balances. Refused once a later depreciation month has been
  posted for the company (reverse those first, as decided), and while a
  customer receipt is allocated to the sale (Party Payments' guard).
- Sub-ledger: a `Depreciation` transaction (`DepKind: 'Retirement'`) and
  a `Disposal` transaction (cost and accumulated depreciation off, with
  proceeds, NBV at disposal and gain/loss). Fixed Asset Register: new
  **Retirements** column (cost retired), and Disposal Value and Gain/Loss
  filled in; as at a date before the retirement, the asset shows as it
  was.
- Registries: `FARETIRE` (rights as Capitalization; gateable in Approval
  Configuration), voucher prefix `FAR` (`FARetirement`), JV refuses to
  reverse it, GL Report opens the screen, menu seed *Fixed Asset
  Retirement*. Code: `functions/src/fixedAssetsRetirement.js`
  (`getFaRetirementSetup`, `previewFaRetirement`; draft, post, approval
  and reversal through the existing posting calls); screen `FARETIRE`.

**Tests:** engine 17/17 (two new: retirement month by day, catch-up,
nothing before the start, the brief's NBV example); emulator: sale to a
bank with VAT and a loss, disposed asset refused everywhere, register
before/after, reversal order; the brief's 6,000 / 4,000 / 1,000 example
sold on account, scrap, reversal blocked by an allocated receipt; UI
check 8/8 (a scrap from the screen). Negative controls, each caught: the
retirement month charged in full; the date check (the asset's own
"depreciated up to" check then still refused it); the receipt guard on
reversal; the screen not calculating.

