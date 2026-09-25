#!/usr/bin/env node
// Builds mirror-image screens from one template each, so the pairs can't
// drift apart:
//   return.tmpl.html -> functions/modules/PURCHASERETURN.html, SALESRETURN.html
//   soa.tmpl.html    -> functions/modules/VENDORSOA.html, CUSTOMERSOA.html
//   node tools/screen-templates/build.js
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '../../functions/modules');

const SCREENS = [
  ['return.tmpl.html', 'PURCHASERETURN', {
    P: 'pret', MODULE: 'PURCHASERETURN', ISSALES: 'false', DOC: 'PURCHASE_RETURN.md',
    TITLE: 'Purchase Return / Debit Note', SECTION: 'Accounts Payable', ICON: 'fa-truck-ramp-box',
    NOTE: 'Debit Note', NOTE_LC: 'debit note', PARTY: 'Vendor', PARTYLC: 'vendor', PARTYFIELD: 'VendorID',
    CODEFIELD: 'VendorCode', NAMEFIELD: 'VendorName', INVOICE: 'Vendor Invoice', SOURCE: 'GRN',
    WHLABEL: 'From Warehouse', QTYLABEL: 'Received', REFHINT: "the vendor's credit note no.",
    VALUEHINT: 'credits the chosen account, e.g. a rebate or the expense overbilled',
    FN_ENTRIES: 'getPurchaseReturnEntries', FN_INVOICES: 'getVendorInvoicesForReturn', FN_SOURCE: 'getPurchaseReturnSource',
    FN_SAVE: 'savePurchaseReturnDraft', FN_POST: 'postPurchaseReturn', FN_DECIDE: 'decidePurchaseReturnApproval',
    FN_DECIDEREV: 'decidePurchaseReturnReversalApproval', FN_REVERSE: 'requestReversePurchaseReturn',
    FN_DELETE: 'deletePurchaseReturnDraft', FN_PARTIES: 'getActiveVendors'
  }],
  ['return.tmpl.html', 'SALESRETURN', {
    P: 'sret', MODULE: 'SALESRETURN', ISSALES: 'true', DOC: 'SALES_RETURN.md',
    TITLE: 'Sales Return / Credit Note', SECTION: 'Accounts Receivable', ICON: 'fa-rotate-left',
    NOTE: 'Credit Note', NOTE_LC: 'credit note', PARTY: 'Customer', PARTYLC: 'customer', PARTYFIELD: 'CustomerID',
    CODEFIELD: 'CustomerCode', NAMEFIELD: 'CustomerName', INVOICE: 'Customer Invoice', SOURCE: 'Delivery Note',
    WHLABEL: 'Return to Warehouse', QTYLABEL: 'Delivered', REFHINT: "the customer's return note no.",
    VALUEHINT: 'debits the chosen account, e.g. Sales Returns for a price correction',
    FN_ENTRIES: 'getSalesReturnEntries', FN_INVOICES: 'getCustomerInvoicesForReturn', FN_SOURCE: 'getSalesReturnSource',
    FN_SAVE: 'saveSalesReturnDraft', FN_POST: 'postSalesReturn', FN_DECIDE: 'decideSalesReturnApproval',
    FN_DECIDEREV: 'decideSalesReturnReversalApproval', FN_REVERSE: 'requestReverseSalesReturn',
    FN_DELETE: 'deleteSalesReturnDraft', FN_PARTIES: 'getActiveCustomers'
  }],
  ['soa.tmpl.html', 'VENDORSOA', {
    P: 'vsoa', MODULE: 'VENDORSOA', PARTYTYPE: 'Vendor', PARTY: 'Vendor', PARTYLC: 'vendor', DOC: 'VENDOR_SOA.md',
    TITLE: 'Vendor Account Statement', SECTION: 'Accounts Payable', ICON: 'fa-file-lines', BALANCE: 'Payable'
  }],
  ['soa.tmpl.html', 'CUSTOMERSOA', {
    P: 'csoa', MODULE: 'CUSTOMERSOA', PARTYTYPE: 'Customer', PARTY: 'Customer', PARTYLC: 'customer', DOC: 'CUSTOMER_SOA.md',
    TITLE: 'Customer Account Statement', SECTION: 'Accounts Receivable', ICON: 'fa-file-lines', BALANCE: 'Receivable'
  }]
];

for (const [tmpl, id, vars] of SCREENS) {
  let s = fs.readFileSync(path.join(__dirname, tmpl), 'utf8');
  s = s.replace(/%%([A-Z_]+)%%/g, (m, k) => {
    if (!(k in vars)) throw new Error(tmpl + ' uses %%' + k + '%% but ' + id + ' has no value for it');
    return vars[k];
  });
  fs.writeFileSync(path.join(OUT, id + '.html'), s);
  console.log('wrote functions/modules/' + id + '.html');
}
