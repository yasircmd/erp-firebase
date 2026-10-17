// Sales Orders, Customer Invoices and stock reservations in Firestore
// (owner, 2026-10-17; docs/modules/TRANSACTIONS_FIRESTORE.md, phase T2).
// New development, hand-written.
//
// They were RTDB's salesOrders/{id}, customerInvoices/{id} and
// stock/reservations/{id}. Same ids, same fields, the same shape RTDB gave
// (docStore.js); a reader asks for what it needs (query) instead of
// downloading the collection.
//
//   salesOrders/{id}         plus _q { ItemCodes, Period }
//   customerInvoices/{id}    plus _q { DeliveryNoteIDs, SalesOrderIDs, Period }
//   stockReservations/{id}
//
// Queries are equality only (and array-contains on a derived list); see
// docStore.js.
'use strict';
const { makeStore } = require('./docStore');

const listOf = v => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])).filter(Boolean);
const distinct = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean).map(String))].sort();

const salesOrders = makeStore({
  name: 'Sales Order', path: 'salesOrders', collection: 'salesOrders',
  fields: ['Status', 'CompanyID', 'CustomerID', 'SONumber', 'CreatedBy'],
  derived: {
    // A line's item: the orders that want it.
    ItemCode: { field: 'ItemCodes', op: 'array-contains', value: d => distinct(listOf(d.Lines), 'ItemCode') },
    Period: { field: 'Period', op: '==', value: d => String(d.SODate || '').slice(0, 7) }
  }
});

const customerInvoices = makeStore({
  name: 'Customer Invoice', path: 'customerInvoices', collection: 'customerInvoices',
  fields: ['Status', 'CompanyID', 'CustomerID', 'TransactionNumber', 'ReversalOfInvoiceID', 'AutoDeliveryNoteID'],
  derived: {
    // The Delivery Notes it invoices, and the Sales Orders its item lines
    // deliver.
    DeliveryNoteID: { field: 'DeliveryNoteIDs', op: 'array-contains', value: d => distinct(listOf(d.SourceDeliveryNotes), 'DeliveryNoteID') },
    SalesOrderID: { field: 'SalesOrderIDs', op: 'array-contains', value: d => distinct(listOf(d.ItemLines), 'SourceSOID') },
    Period: { field: 'Period', op: '==', value: d => String(d.InvoiceDate || '').slice(0, 7) }
  }
});

const reservations = makeStore({
  name: 'stock reservation', path: 'stock/reservations', collection: 'stockReservations',
  fields: ['Status', 'ItemID', 'WarehouseID', 'CompanyID', 'SourceType', 'SourceID', 'SourceLineID', 'CreatedByProductionID']
});

module.exports = { salesOrders, customerInvoices, reservations };
