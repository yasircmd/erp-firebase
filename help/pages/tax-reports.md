---
fingerprint: a294ec0260c509a4
reviewed: 2026-10-30
title: Tax Reports
area: finance
order: 16
modules: [TAXREPORTS]
sources: [functions/src/taxReports.js, screens/TAXREPORTS.html]
summary: A company's tax for a period from its posted documents: the tax summary, UAE VAT 201, and India's GSTR-1 and GSTR-3B, ready to copy to Excel.
---
## What it is for

**Tax Reports** works out a company's tax for a period, ready for the
person who files the return. It reads the documents posted with tax line
by line (see [Tax Configuration](tax-configuration.html)):

- [Customer Invoices](customer-invoice.html) and [Sales Returns](sales-return.html);
- [Retail Sales](retail-sales.html) and their returns;
- asset sales in [Fixed Asset Retirement](fixed-asset-retirement.html);
- [Vendor Invoices](vendor-invoice.html) and [Purchase Returns](purchase-return.html).

The reports are:

- **Tax summary**, for any regime: sales and purchases by tax code and by
  component, with the part reclaimed, the part that went to cost, and
  reverse charge.
- **VAT 201**, for UAE VAT: the boxes of the FTA's return.
- **GSTR-1** and **GSTR-3B**, for India GST: GSTR-1 as the sheets of the
  GST offline tool, and GSTR-3B's tables.

Filing stays outside: you enter the figures on the FTA or GST portal
yourself.

## Before you start

- The company has a [Tax Configuration](tax-configuration.html).
- Customers and vendors have their registration type, state or emirate,
  and tax number (GSTIN or TRN) in [Customer Master](customer-master.html)
  and [Vendor Master](vendor-master.html). The reports use what is there
  when you run them.
- For India, items have their HSN or SAC code in
  [Item Master](item-master.html), for GSTR-1's HSN summary.

## Step by step

1. Choose the **Company**. The **Report** list shows the reports its regime
   has.
2. Choose the period: **From** and **To**, or **This month**, **Last
   month** or **Last quarter**.
3. Click **Run**.
4. Click a figure's row to see the documents behind it.
5. Click **Copy** on a table and paste it into Excel. GSTR-1's sheets copy
   with the GST offline tool's headings, dates (for example *05-Oct-2026*)
   and units, ready to paste into the tool's template.

## How the figures are counted

- **Dates.** A document counts on its own date. A Sales Return, Purchase
  Return or retail return counts minus.
- **Reversals.** A reversed document stays in its own period. Its reversal
  counts minus on the reversal's date.
- **Currency.** Amounts are in the company's base currency, at each
  document's exchange rate.
- **Documents with one tax %.** A document posted before line tax, with
  one tax % for the whole document, is not counted. The screen says how
  many such documents fall in the period, with their tax and numbers, so
  you can add them from the old figures.
- **VAT 201:**
  - boxes 1a–1g are standard-rated sales by emirate, the place of supply.
    A counter sale, or an asset sold to the bank, counts in the company's
    own emirate;
  - box 6 is goods from an overseas vendor under reverse charge, and box 3
    is the rest of reverse charge;
  - box 9 is standard-rated purchases with the VAT you can reclaim;
  - box 14 is the tax due less the tax reclaimed;
  - adjustments (bad-debt relief, corrections, box 7) are made on the FTA
    portal.
- **GSTR-1:**
  - B2B: registered buyers and SEZs;
  - B2CL: inter-state invoices to unregistered buyers above the **B2CL
    limit** in Tax Configuration (₹1,00,000 by default);
  - B2CS: the rest, by state and rate, Retail Sales included. A credit
    note to a consumer reduces it;
  - EXP: exports, with or without IGST;
  - CDNR and CDNUR: credit notes;
  - nil rated, exempt and non-GST supplies, the HSN summary (B2B and B2C
    apart), and the documents issued by series.
- **GSTR-3B:**
  - 4(A) is the full input tax of each purchase, and 4(B) reverses the part
    the tax code doesn't let you reclaim;
  - 6.1 shows each component's tax payable, the net credit, and reverse
    charge, which is paid in cash. Setting off one tax's credit against
    another is done on the portal.

## Rights

**access** runs the reports, for the companies you can open. Admin, Finance
Manager and Accountant have it by default.

## Questions and mistakes

- **"This company has no Tax Configuration"**: set its tax up first.
- **A figure looks wrong.** Open its documents and check the party's
  registration type and state, and each line's tax code.
- **Documents are "not in this report"**: they were posted with one tax %
  before line tax.
- For example: *Example Trading LLC* (Sharjah) runs VAT 201 for October.
  Box 1b shows Dubai's sales of 1,400.00 with VAT of 70.00, from invoices
  *CI-1* and *CI-2*.

## Related pages

[Tax Configuration](tax-configuration.html) · [Customer Invoice](customer-invoice.html) · [Vendor Invoice](vendor-invoice.html) · [Retail Sales](retail-sales.html)
