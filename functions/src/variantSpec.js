// Module Builder, phase 4 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q481-Q488): the five documents a variant may be of, and for each the fields
// a variant may relabel, hide or give a default. New development, hand-written.
//
// Each field: key (the variant's settings name it), el (its element on the
// original's screen, where the shell applies the setting), label (the
// original's), and required (true: it may be relabelled or defaulted, never
// hidden). prefix: the original's own number prefix (the variant takes its own
// instead, Q482).
'use strict';

const F = (key, el, label, required) => ({ key, el, label, required: required === true });

const BASES = Object.freeze({
  CUSTOMERINVOICE: {
    label: 'Customer Invoice', prefix: () => require('./glWriting').STOCK_TRANSACTION_PREFIXES.CustomerInvoice,
    fields: [F('customer', 'cinv-form-customer', 'Customer', true), F('date', 'cinv-form-date', 'Invoice Date', true), F('description', 'cinv-form-description', 'Description', true),
      F('division', 'cinv-form-division', 'Division'), F('branch', 'cinv-form-branch', 'Branch'), F('costCenter', 'cinv-form-costcenter', 'Cost Center'),
      F('profitCenter', 'cinv-form-profitcenter', 'Profit Center'), F('project', 'cinv-form-project', 'Project'), F('salesRep', 'cinv-form-rep', 'Sales Rep'),
      F('discount', 'cinv-form-discount', 'Discount'), F('roundOff', 'cinv-form-roundoff', 'Round Off')]
  },
  VENDORINVOICE: {
    label: 'Vendor Invoice', prefix: () => require('./glWriting').STOCK_TRANSACTION_PREFIXES.VendorInvoice,
    fields: [F('vendor', 'vinv-form-vendor', 'Vendor', true), F('date', 'vinv-form-date', 'Invoice Date', true), F('vendorRef', 'vinv-form-vendorref', 'Vendor\'s Own Invoice Number', true),
      F('description', 'vinv-form-description', 'Description', true), F('division', 'vinv-form-division', 'Division'), F('branch', 'vinv-form-branch', 'Branch'),
      F('costCenter', 'vinv-form-costcenter', 'Cost Center'), F('profitCenter', 'vinv-form-profitcenter', 'Profit Center'), F('project', 'vinv-form-project', 'Project'),
      F('discount', 'vinv-form-discount', 'Discount'), F('roundOff', 'vinv-form-roundoff', 'Round Off')]
  },
  SALESORDER: {
    label: 'Sales Order', prefix: () => 'SO',
    fields: [F('customer', 'so-form-customer', 'Customer', true), F('date', 'so-form-date', 'Order Date', true), F('deliveryDate', 'so-form-deliverydate', 'Requested Delivery Date'),
      F('description', 'so-form-description', 'Description'), F('division', 'so-form-division', 'Division'), F('branch', 'so-form-branch', 'Branch'),
      F('costCenter', 'so-form-costcenter', 'Cost Center'), F('profitCenter', 'so-form-profitcenter', 'Profit Center'), F('project', 'so-form-project', 'Project'), F('salesRep', 'so-form-rep', 'Sales Rep')]
  },
  QUOTATION: {
    label: 'Quotation', prefix: () => 'QT',
    fields: [F('party', 'qt-party', 'Customer or lead', true), F('date', 'qt-date', 'Date', true), F('validUntil', 'qt-until', 'Valid until', true),
      F('opportunity', 'qt-opp', 'Opportunity'), F('salesRep', 'qt-rep', 'Sales Rep'), F('terms', 'qt-terms', 'Terms and notes (printed)')]
  },
  JV: {
    label: 'Journal Entry', prefix: () => 'JV',
    fields: [F('date', 'jv-form-date', 'Entry Date', true), F('description', 'jv-form-description', 'Description', true), F('reference', 'jv-form-reference', 'Reference'),
      F('division', 'jv-form-division', 'Division'), F('branch', 'jv-form-branch', 'Branch'), F('currency', 'jv-form-currency', 'Currency'),
      F('costCenter', 'jv-form-costcenter', 'Cost Center'), F('profitCenter', 'jv-form-profitcenter', 'Profit Center'), F('project', 'jv-form-project', 'Project')]
  }
});

module.exports = { BASES };
