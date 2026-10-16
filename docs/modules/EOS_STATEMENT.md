# End-of-service statement with the final settlement (UX Tier 3, J)

Status: **built** 2026-10-16 (branch tier3-wave2); design agreed by the owner
the same day (UX_TIER3.md round 15).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, J).

## Today

- **The final settlement** (Payroll → Final Settlement) works out:
  - the unpaid salary;
  - the **gratuity** on the leaving date, by the company's rule in Payroll
    Setup → Provisions (UAE default: 21 days a year for the first 5
    years, then 30; a day is basic × 12 ÷ 365; at least 1 year; capped at 2
    years' basic; unpaid leave days not counted);
  - the leave salary for the leave balance, a negative balance deducted;
  - the accruals paid at leaving;
  - notice pay;
  - other additions and deductions;
  - the running loans' balances;
  - the net.

  HR may change an amount with a reason. It posts a FinalSettlement entry
  (Dr each provision used, the difference to its expense).
- **There is no print** of the settlement: the screen shows its lines only.
  The payslip has its own fixed layout (EXTERNAL_PRINTS.md), and nothing
  else in payroll prints.

## Proposal

A printed **End-of-Service Statement** for a settlement, from its screen
(**Print statement**), on the same shell print style as the other
documents. Laid out as the owner's sample, once it is shared (question
179). Without a sample, it would show:

1. **The company:** name and logo, the address.
2. **The employee:** name, employee no., ID / passport, nationality,
   designation, department, joining date, last working day, leaving
   reason, years / months / days of service and the unpaid leave days
   excluded.
3. **The gratuity working:** basic, a day's pay, and per slab the years,
   the days a year, the days and the amount; the cap if it applied; any
   change HR made, with its reason.
4. **Other entitlements:** unpaid salary, leave salary (days), accruals,
   notice pay, other additions.
5. **Deductions:** loans, a negative leave balance, other deductions.
6. **Net payable**, in figures and in words.
7. **Signatures:** prepared by, approved by, and the employee's
   acknowledgement ("received in full and final settlement"), with date
   lines.

The same statement could be shown to the employee in the Employee Portal,
once the settlement is paid (question 183).

## Questions for the owner

- **179.** Do you have a sample statement (your current format, a scan
  is enough, with names removed)? Recommended: share it, and the print
  follows it; otherwise the layout above.
- **180.** Is it sent outside (to the employee, a bank, a labour office)?
  If so, it prints **without** the ERP title bar, like the other external
  documents (EXTERNAL_PRINTS.md).
- **181.** Arabic as well as English (two columns or Arabic below)?
  Recommended: English only for now, unless the sample is bilingual.
- **182.** Printable from which state: a draft (marked DRAFT) for checking
  with the employee before posting, and the posted one? Recommended:
  both, the draft clearly marked.
- **183.** In the Employee Portal: may the employee see and download their
  own statement once it is paid? Recommended: yes.
- **184.** The amount in words: in the company's currency (AED, dirhams
  and fils)? Recommended: yes.

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 179 | The **UAE standard** end-of-service statement layout (the one above); the owner may change it later. |
| 180 | **Sent outside**: it prints without the ERP title bar (added to the external prints). |
| 181 | English only, no Arabic. |
| 182 | A draft prints marked DRAFT; the posted one plainly (the recommendation). |
| 183 | The employee sees and downloads it in the Employee Portal once paid (the recommendation). |
| 184 | The amount in words is in the **system currency**: the currency marked Default in Currency Configuration (the one JV and CBT record), not AED fixed. |

## As built (2026-10-16)

- **functions/src/eosStatement.js** (new) holds the layout, like
  payslipDocument.js for the payslip: `statementData` gathers the facts,
  `statementHtml` lays them out (CSS scoped to `.eos-doc`). The Final
  Settlements print and the Employee Portal use the same HTML.
- **The employee:** name, employee no., name as in passport, nationality,
  designation, department (the cost center's name), joining date, last
  working day, leaving reason, length of service (whole years, months and
  days, both ends counted), basic and gross. The **passport and Emirates
  ID numbers** come from Employee Documents (the active one of each type;
  a renewed document is Superseded). There is no ID field on the employee
  record itself.
- **Gratuity by slab:** `payrollCalc.gratuityFor` now also returns its
  working (base, a day's pay, each slab's years, days a year, days and
  amount, the cap). The settlement keeps it on its Gratuity line
  (`Working`). The slab amounts add up to the gratuity before any cap, with
  the last slab taking the rounding. A settlement saved before this change
  has no working, so its statement shows the one-line working text instead.
  A Draft picks it up the next time it is opened or printed, because a
  draft is worked out again each time.
- **Entitlements and deductions:** the salary paid in the settlement is
  shown as one line per month (earnings, and deductions separately). Other
  lines are shown as on the screen. An amount HR changed shows its reason.
- **DRAFT:** a saved settlement prints from any status. Until it is
  Posted, the print carries a DRAFT watermark and the line "DRAFT: not
  final, for checking only". A draft prints as it is worked out now
  (draftFields), the same as the screen. An unsaved settlement has no
  Print button.
- **Words:** "QAR Thirty-Eight Thousand … and 72/100 only", using the code
  of the Active currency marked Default. With no default currency set, the
  code is left out.
- **Signatures:** "Prepared by" is the submitter. "Approved by" is the last
  approval in the history, shown once the settlement is posted. The
  employee's acknowledgement reads "received … in full and final
  settlement", with signature and date lines.
- **Company logo:** company records have no logo field, so the header
  shows the legal name and address. A logo can be added when Company
  Master stores one.
- **Sent outside (180):** screens/PAYROLLFS.html hides the title bar in
  print, and PAYROLLFS is on the EXTERNAL list in
  functions/test/unit/externalPrints.test.js.
- **Callable:** `getSettlementStatement({ settlementId })` (PAYROLLFS
  access, the company's) returns `{ html, css, draft, number }`.
- **Employee Portal (183):** `essPortal` `payslips` now also returns
  `statement` (number, payment date and net, once Posted and paid). A new
  action, `statement`, returns the HTML. The portal shows the statement
  card at the top of My payslips and opens it in the payslip viewer (no
  "Something wrong?" button; Download PDF as for a payslip).
  **Limitation:** a leaver's portal access normally ends on the payment
  date (leaverAccess.js, owner 2026-10-14), so the employee can see the
  statement on that day only, unless HR extends access in Employee Master.
  The Help page says so. If the owner wants a longer window, change the
  rule in leaverAccess.js.
- **Tests:**
  - functions/test/emulator/eosStatement.emulator.test.js (3): draft
    content, slabs, words in a non-AED default currency, rights; an
    override and the posted print; the portal before and after payment.
  - functions/test/unit/eosStatement.test.js (2): words and service
    length.
  - payrollSettlement.ui.js: print from the draft (DRAFT, no title bar)
    and once posted (5/5).
  - eosStatement.ui.js (2): the portal card and viewer.
  - Negative control: with the DRAFT rule broken (always false), emulator
    test 1 failed; the rule was then restored.
