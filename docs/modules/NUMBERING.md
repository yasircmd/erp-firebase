# Numbering: customizable document numbers and codes (design, 2026-10-09)

## The owner's request (2026-10-09)

> Now we need to develop a module for customize voucher numbers, item
> numbers, employee code, account code, etc. Now all are system default,
> keep what is now what is default but option to customize each.

## Today (from the code)

Every number is made by the system, in one of these fixed shapes:

| What | Shape today | Counter | Made by |
|---|---|---|---|
| Journal and Cash & Bank vouchers (JV, CR, BR, CP, BP, FT), PR, IPR, PO, SO, JOB | `JV-26-01-000001`: prefix, year (2 digits), company ref, 6-digit sequence | per prefix, year, company (`gl/counters`) | legacy `generateVoucherNumber_` |
| Stock and finance documents (GRN, MI, PRD, WM, ADJ, PC, VINV, DN, CINV, DBN, CRN, PDC, FA, OB, PAY, RS, RR, …; about 35 prefixes) | the same shape | per prefix, year, company (`stock/counters/voucher`) | `glWriting.generateStockVoucherNumber` |
| Audit references | `TXN-00000001`, `STK-00000001`, `PRL-00000001` | one lifetime sequence each | `glWriting` |
| Item codes | `RM-000001`, `SFG-`, `FG-`, `CONS-`, `SCRAP-` (by category) | per category | legacy `generateItemCode_` |
| Vendor codes | `VEN-000001` | one | legacy `generateVendorCode_` |
| Customer codes | `CL-000001` (local), `CE-000001` (export) | per classification | legacy `generateCustomerCode_`, Retail Sales, Master Import |
| Employee codes | `EMP-0001` | one | `hrEmployees.js` |
| Fixed asset numbers | `FA-01-000001` | per company | `fixedAssetsCommon.js` |
| HR documents | `LV-2026-0001` (leave), `EC-2026-0001` (changes); `IP-0001`, `LN-0001`, `FS-0001` | per year, or one | the HR and payroll modules |
| Account codes | `100000`, `110001`, `221000`, `221001` | none: worked out from the type and the parent | legacy `generateAccountCode_` |

**Account codes are not just labels.** The code carries the structure:
- the first digit is the account type;
- a header ends `0000`; a sub-parent `X000`; a leaf takes a sequence under
  its parent.

Cash & Bank finds the cash ledgers by the `10` prefix and the banks by
`11`, and the reports group by the digits. A free format would break
these. Account codes are therefore treated differently below.

## Proposed: a Numbering module

A new admin screen, **Numbering** (`NUMBERING`; rights: access, write),
lists every numbered thing with its current format, the next number and
a live preview. **Defaults are exactly today's formats**, so nothing
changes until someone customizes one.

### A format

A format is text with placeholders:

| Placeholder | Gives |
|---|---|
| `{YY}` / `{YYYY}` | the document's year, 2 or 4 digits |
| `{MM}` | its month, 2 digits |
| `{CO}` | the company's reference code (`01`, `02`, …) |
| `{SEQ:n}` | the running number, padded to n digits (at least 1) |

Today's JV is `JV-{YY}-{CO}-{SEQ:6}`; an item `RM-{SEQ:6}`; an employee
`EMP-{SEQ:4}`. A company might want `JV/{YYYY}/{SEQ:5}` or `E{SEQ:5}`.

Rules, checked when saving:
- exactly one `{SEQ:n}`;
- only letters, digits and `- / _ .` besides the placeholders;
- at most 30 characters when rendered;
- a document number that runs per year needs `{YY}` or `{YYYY}`, and one
  that runs per month needs `{MM}` too, so a number can never repeat;
- a document number counted per company needs `{CO}`, unless the format
  is per company (question 81).

### The counter (no duplicates, by construction)

The running number is kept per **"everything but the sequence"**: the
number with `{SEQ}` left out. `JV-26-01-` and `JV-27-01-` count
separately; changing the prefix to `GJ` starts `GJ-26-01-` at 1 (or at a
chosen number). Two formats that would give the same text share one
counter, so they can't clash.

Today's counters carry on where they are: the first time a default
format is used, its counter starts from today's (`gl/counters`,
`stock/counters/voucher`, `itemCounters`, …).

**Next number:** it can be raised (e.g. to carry on from an old system),
never lowered below what has been used.

### Changing a format

- **Applies to new numbers only.** Existing documents and codes keep
  their numbers; nothing is renumbered.
- **Every change is logged:** who, when, from what, to what.
- **Reset to default** brings back today's format; its counter carries on.

### Account codes

The structure stays: the digits mean the type, the header and the
sub-parent. The option is to **type the code yourself** when creating an
account (question 83), checked to fit the structure: the right first
digit, inside the parent's range, unique. Cash & Bank and the reports
keep working.

### Where it plugs in

One hand-written module, `functions/src/numbering.js`: `next(kind, {
companyId, date, category })` under the global lock, used by every
generator above. The legacy generators (`generateVoucherNumber_`,
`generateItemCode_`, `generateVendorCode_`, `generateCustomerCode_`) are
routed to it through the port's helper table (tools/legacy-port/
generate.js). The ported code itself is not edited, as with
`generateStockVoucherNumber_` today. Master Import and Retail Sales make
their codes through it too.

## Open questions

80. **What can be customized?**
    - Document numbers (every voucher and document), master codes (item
      by category, vendor, customer local/export, employee, fixed asset)
      and HR document numbers. **Not the audit references** (TXN-, STK-,
      PRL-): they are the lifetime audit sequence and stay uniform.
      Account codes keep their structure with the option to type one —
      recommended;
    - or everything, the audit references too.
81. **One format for all companies, or per company?**
    - One format per document type for the whole system (`{CO}` puts the
      company in it; the counter stays per company where it is today) —
      recommended: simpler, and numbers look the same in every company;
    - or each company may set its own format.
82. **When does the running number start again?**
    - Chosen per type: never, every year, or every month (document
      numbers default to every year, as today; codes to never) —
      recommended;
    - or as today only (documents yearly, codes never), only the text
      customizable.
83. **Typing a code instead of the next number** (items, vendors,
    customers, employees, fixed assets, accounts):
    - Allowed per type when switched on in Numbering (off by default):
      the form offers the next code, and a user may type another one,
      checked unique (and, for accounts, to fit the structure) —
      recommended;
    - or always automatic, never typed.

## The owner's decisions (2026-10-09)

| # | Question | Decision |
|---|---|---|
| 80 | What can be customized | **Document numbers, master codes and HR document numbers; not the audit references** (TXN-, STK-, PRL-). |
| 81 | One format or per company | **One format per type for the whole system.** |
| 82 | When the number restarts | **The owner's own answer:** "choose like BP-01-26-00001: here the user can decide what for bank payment, BP or 10 etc.; 01, company code, needed or not; 26, year, needed or not; 00001, how many digits." So a format is **built from parts**: the prefix text, the company code (yes/no), the year (no, 2 or 4 digits), and the number of digits. **The restart follows from the parts:** with the year in it the number restarts each year; without it, never. |
| 83 | Typing a code | **Always automatic.** No code is typed, so account codes stay exactly as today (their structure drives Cash & Bank and the reports; see "Account codes" above). The account-code option in question 80 falls away. |

## The agreed design (supersedes "A format" above where they differ)

### The builder

Each numbered type has these parts:

| Part | Choice | Today's JV |
|---|---|---|
| Prefix | any text: letters, digits; 1-10 characters (e.g. `BP`, `10`, `PAY`) | `JV` |
| Company code | include or not; documents only (master codes belong to no single company) | yes |
| Year | none, `26` or `2026` (the document's own date; a code's creation date) | `26` |
| Order | company then year, or year then company (when both) | year, company |
| Separator | `-`, `/` or none | `-` |
| Digits | 3 to 10 | 6 |

The screen shows a live sample (e.g. `BP-01-26-00001`) and the next number
that will be given.

- **Restart:** a counter runs per "everything but the running number". So
  with the year included the number restarts each year. Without the
  company code, one sequence is shared by all companies, so a number is
  never given twice.
- **No two types may share a prefix**, so a number always says what it is.
- **Defaults are today's formats**, and their counters carry on where
  they are.
- **Changing a format** affects new numbers only, is logged, and can be
  reset to the default.
- **Rights:** Numbering, `access` to see it, `write` to change it (Admin by
  default).

## As built (2026-10-09)

Where it differs from the design above, the build is the record:

- **Counters.** A default-format number uses exactly the counter it
  always used (`gl/counters/P/YYYY/CO`, `stock/counters/voucher/...`,
  `itemCounters/RM`, `vendorCounters/VEN`, `customerCounters/CL|CE`,
  `hrCounters/EMP`, `hrCounters/LV-YYYY`, `fa/counters/asset/CO`, …). It
  never goes below the other document tree's counter for the same prefix.
  A customized format counts under the same root, at
  `<root>/_fmt/<scope>`, so **Data Reset** of that data still restarts it.
  This is the same as before.
- **Never twice.** Each number a customized format gives is recorded at
  `<root>/_issued/<number>` and skipped if already given. A format is
  refused when it has the same shape as another type's current format,
  default format, or any format that type had before. The shape is
  everything but the digits; the message names the type.
- **Master Import** gives a code back after a failed run, the customized
  code too, which is then free again.
- **58 types**, each with a default:
  - **Documents** (46 prefixes, from the GL writer's map plus JV, CR, BR,
    CP, BP, FT, PR, IPR, PO, SO, JOB, RJT). Prefixes shared by two
    document types stay one type, e.g. `FAA`: Asset Capitalization / CWIP
    cost.
  - **Master codes:** items by category, vendor, customer local and
    export, employee, fixed asset.
  - **HR documents:** LV, EC, IP, LN, FS.
- **The company code** can be included only for documents and fixed
  assets. Items, vendors, customers and employees belong to no single
  company.
- **Not changed (decision 80):** the audit references TXN-, STK- and PRL-,
  and account codes (decision 83: codes are always automatic).

**Server:** functions/src/numbering.js.
- `next(kind, { companyId, year })`, plus the old generators by their
  signatures: `voucherNumber`, `itemCode`, `vendorCode`, `customerCode`,
  `employeeCode`, `assetNumber`, `hrNumber`.
- `counterPathOfCode` / `issuedPathOfCode`, for Master Import.
- Callables `getNumbering` (access) and `saveNumberingFormat` (write;
  `reset: true` returns to the default).
- Routed through it:
  - the legacy `generateVoucherNumber_`, `generateItemCode_`,
    `generateVendorCode_`, `generateCustomerCode_`, through the port's
    helper table (tools/legacy-port/generate.js `MAPPED`; the ported code
    is regenerated, not edited);
  - `glWriting.generateStockVoucherNumber`; journal.js;
  - hrEmployees, hrLeave, hrChanges, payrollInterim, payrollLoans,
    payrollSettlement, fixedAssetsCommon, Retail Sales' Retail Customer
    and Master Import.
- Module `NUMBERING` (access, write: Admin), with a menu seed under System
  Admin → Configuration & Data Management.

**Screen:** screens/NUMBERING.html.
- The types by group, each with its sample and default or customized,
  and Find.
- The builder: prefix, digits, year (none / 2 / 4 digits), separator,
  company code where allowed, and order when both are included, with a
  live sample and the default.
- Save, and Reset to default (asked first). The change log. A Viewer sees
  it read-only.

**Tests:**
- `numbering.emulator.test.js` (5): the defaults on today's counters; the
  owner's `BP-01-26-00001`, restarting by year, per company or shared,
  without a separator, reset carrying on; codes; the checks; never twice,
  Data Reset and Master Import.
- `numbering.ui.js` (4).
- Negative controls are in the PR.

**Deploy:** `tools/deploy-sets/numbering.txt` is **every function**, 497,
with `--screens`. Almost every posting numbers its journal through the
shared GL writer, and a function left on its old code would keep the old
default shape. Customize a format only after the whole set is live.
Then link a menu node to "Numbering" and set its rights.
