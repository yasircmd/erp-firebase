---
fingerprint: f88be32650744fa4
reviewed: 2026-10-30
title: Tax Configuration
area: finance
order: 15
modules: [TAXCONFIG]
sources: [functions/src/taxConfig.js, functions/src/taxEngine.js, screens/TAXCONFIG.html]
summary: Each company's sales tax: UAE VAT, India GST or a tax of its own, with its components, accounts and tax codes rated by date.
---
## What it is for

**Tax Configuration** says how a company charges sales tax: its **regime**
(UAE VAT, India GST, or a tax of its own), the **components** the tax is
charged as, each posted to its own accounts, and its **tax codes** (standard,
zero rated, exempt …), each with its rate from a date. Items name their tax
code in [Item Master](item-master.html); customers and vendors their
registration type, state or emirate, and tax number in
[Customer Master](customer-master.html) and [Vendor Master](vendor-master.html).

[Customer Invoices](customer-invoice.html), [Vendor Invoices](vendor-invoice.html)
and their returns take their tax from here, line by line, and so do
[Retail Sales](retail-sales.html) and asset sales in
[Fixed Asset Retirement](fixed-asset-retirement.html).
[Sales Orders](sales-order.html), their Proforma Invoices and
[Purchase Orders](purchase-order.html) show an estimate of the tax. The tax
reports are in [Tax Reports](tax-reports.html); India's **B2CL limit**
(GSTR-1's invoice value above which an inter-state sale to an unregistered
buyer is listed on its own, ₹1,00,000 by default) is set here.

## Before you start

- The tax accounts exist in the [Chart of Accounts](chart-of-accounts.html):
  for UAE VAT an output and an input VAT account; for India GST one of each
  for CGST, SGST (or UTGST), IGST and, if used, cess.
- You need Tax Configuration's **setup** right to change it (Admin by
  default); **access** lets you look.

## Step by step

1. Open **Tax Configuration** and choose the company.
2. With nothing set up yet, start from **UAE VAT**, **India GST** or **an own
   regime**. The preset fills in its components and tax codes; nothing is
   saved until you save.
3. Choose the company's **emirate** (UAE VAT) or its **GST state**, the
   first two digits of its GSTIN (India GST).
4. **Rounding**: per rate on the whole document (UAE VAT's default) or per
   line (India GST's).
5. For each **component**, choose its **output tax account** (sales) and
   **input tax account** (purchases).
6. Check the **tax codes**: their name, what kind each is, the
   **recoverable %** of input tax (100 unless part of it can't be
   reclaimed, the rest then being part of the cost), and **Active**.
7. **Save**.

### When a rate changes

Add a rate to the code with the date it applies from (**Add a rate**). A
document takes the rate valid on its own date, so documents before the
change keep the old rate. Don't change the old row.

### India GST

Within the company's state a rate is charged as **CGST** and **SGST** (in a
union territory such as Chandigarh, **UTGST**), half each; to another state,
an SEZ or abroad, as **IGST**. Whether a sale is within the state comes from
the customer's state (the place of supply). A code can carry a **cess** % as
well. The preset holds the rates as revised from 22/09/2025 (5%, 18% and
40%, with 0.25% and 3% for stones and gold). The earlier 12% and 28% are kept,
inactive, for documents dated before. Check the codes against your own
items, and adjust them as needed.

### A tax of your own

For another country's tax, start from **an own regime**: name up to six
components (for example STATE and CITY), then give each code's rate as a %
per component (6% STATE and 1.5% CITY make 7.5%).

## Rights

**access** shows the configuration; **setup** changes it. A tax code that
documents have used can't be removed (make it inactive), and the regime of
a company whose documents use its codes can't change.

## Questions and mistakes

- **"Choose the company's GST state"**: India GST needs it, to tell CGST +
  SGST from IGST.
- **"… belongs to another company"**: a component's account must be the
  company's own or shared by all companies.
- **"Tax code … is used by documents"**: untick **Active** instead.
- For example: *Example Trading LLC* (Dubai) starts from UAE VAT, picks
  Dubai, Output VAT 2200 and Input VAT 1400, and saves; its SR code charges
  5% from 01/01/2018.

## Related pages

[Item Master](item-master.html) · [Customer Master](customer-master.html) · [Vendor Master](vendor-master.html) · [Chart of Accounts](chart-of-accounts.html)
