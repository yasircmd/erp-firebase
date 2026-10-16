# End-of-service statement with the final settlement (UX Tier 3, J)

Status: **design agreed** (owner, 2026-10-16; UX_TIER3.md round 15).
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
