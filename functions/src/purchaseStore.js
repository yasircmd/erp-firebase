// Vendor Invoices, Purchase Orders and the two kinds of requisition in
// Firestore (owner, 2026-10-17; docs/modules/TRANSACTIONS_FIRESTORE.md,
// phase T3). New development, hand-written.
//
// They were RTDB's vendorInvoices/{id}, purchaseOrders/{id},
// purchaseRequisitions/{id} and inventoryPurchaseRequisitions/{id}. Same
// ids, same fields, the same shape RTDB gave (docStore.js); a reader asks
// for what it needs (query) instead of downloading the collection.
//
//   vendorInvoices/{id}                  plus _q { GRNIDs, Period }
//   purchaseOrders/{id}                  plus _q { ItemCodes, Period }
//   purchaseRequisitions/{id}
//   inventoryPurchaseRequisitions/{id}
//
// Queries are equality only (and array-contains on a derived list); see
// docStore.js.
'use strict';
const { makeStore } = require('./docStore');

const listOf = v => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])).filter(Boolean);
const distinct = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean).map(String))].sort();

const vendorInvoices = makeStore({
  name: 'Vendor Invoice', path: 'vendorInvoices', collection: 'vendorInvoices',
  fields: ['Status', 'CompanyID', 'VendorID', 'TransactionNumber', 'ReversalOfInvoiceID'],
  derived: {
    // The GRNs it invoices.
    GRNID: { field: 'GRNIDs', op: 'array-contains', value: d => distinct(listOf(d.SourceGRNs), 'GRNID') },
    Period: { field: 'Period', op: '==', value: d => String(d.InvoiceDate || '').slice(0, 7) }
  }
});

const purchaseOrders = makeStore({
  name: 'Purchase Order', path: 'purchaseOrders', collection: 'purchaseOrders',
  fields: ['Status', 'CompanyID', 'VendorID', 'PONumber', 'CreatedBy'],
  derived: {
    ItemCode: { field: 'ItemCodes', op: 'array-contains', value: d => distinct(listOf(d.Lines), 'ItemCode') },
    Period: { field: 'Period', op: '==', value: d => String(d.PODate || '').slice(0, 7) }
  }
});

const purchaseRequisitions = makeStore({
  name: 'Purchase Requisition', path: 'purchaseRequisitions', collection: 'purchaseRequisitions',
  fields: ['Status', 'CompanyID', 'PRNumber', 'CreatedBy']
});

const inventoryPurchaseRequisitions = makeStore({
  name: 'Inventory Purchase Requisition', path: 'inventoryPurchaseRequisitions', collection: 'inventoryPurchaseRequisitions',
  fields: ['Status', 'CompanyID', 'IPRNumber', 'CreatedBy']
});

module.exports = { vendorInvoices, purchaseOrders, purchaseRequisitions, inventoryPurchaseRequisitions };
