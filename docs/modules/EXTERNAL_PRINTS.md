# Prints for outside the organization: no ERP title bar

**Owner, 2026-10-11:** "On print, the module name is at the top; remove it
only from prints given outside the organization, like invoices and delivery
notes."

## What was printed

Every screen's print showed the shell's title bar at the top: the module
name (e.g. "Customer Invoice Processing"), as the first block of
`#app-container`. Most screens' print styles hid only the back button, the
tree controls and the user menu.

## The rule

These documents go to customers or vendors, so they print **without the
title bar** (the whole first block of `#app-container`, so no empty bordered
strip is left):

| Screen | Document |
|---|---|
| CUSTOMERINVOICE | Tax invoice |
| DELIVERYNOTE | Delivery note |
| PURCHASEORDER | Purchase order |
| PURCHASERETURN | Debit note |
| SALESRETURN | Credit note |
| RETAILSALES | Receipt (roll or A4) and return receipt |
| CUSTOMERSOA, VENDORSOA | Statements of account |
| PDCRECEIVED | Post-dated cheque receipt |

Everything else keeps it: internal vouchers and reports. The owner kept
these too: payslips, the portal welcome slips, the PDC Issued voucher and
the GRN. PDC Issued is built from PDC Received's template
(`tools/build-pdc-screens.js`), so the PDC receipt hides the bar through a
body class (`pdc-print-external`) set only when printing a received cheque,
cleared on `afterprint`.

A new external document follows the same pattern: add
`#app-container > div:first-child { display: none !important; }` to its
`@media print` block, and its name to `EXTERNAL` in
`functions/test/unit/externalPrints.test.js`.

## Tests

- `functions/test/unit/externalPrints.test.js`: each external screen hides
  the bar when printed; PDC only for a received cheque; no internal print
  hides it.
- `retailSales.ui.js` and `pdc.ui.js`: in print media the bar is hidden for
  the receipt and the cheque receipt, and kept for the issued voucher. The
  UI harness now places the title bar as the shell does.
- Four negative controls, all caught.

## Deploy

Screens only: the Deploy workflow's **screens only** task (no functions, no
Hosting).
