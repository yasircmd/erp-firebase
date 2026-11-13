// Descriptions on the inventory transactions are optional (owner,
// 2026-11-13; docs/modules/UX4.md item 13, Q503): a blank header saves a
// default naming the document (and what it came from, e.g. "Goods receipt
// from PO-26-000123"); a blank line takes the item's name (a direct line,
// its category's). Journals, invoices and payments keep theirs required.
// New development, hand-written.
'use strict';

const LABELS = Object.freeze({
  GRN: 'Goods receipt', MATERIALISSUE: 'Material issue', STOCKADJUSTMENT: 'Stock adjustment',
  WAREHOUSEMOVEMENT: 'Warehouse movement', PURCHASERETURN: 'Purchase return', SALESRETURN: 'Sales return',
  DELIVERYNOTE: 'Delivery note', PHYSICALCOUNT: 'Physical count', PRODUCTION: 'Production'
});

// The header's description: the one typed, else the default.
function headerDescription(given, moduleId, sources) {
  const typed = String(given == null ? '' : given).trim();
  if (typed) return typed;
  const from = [...new Set((sources || []).map(s => String(s || '').trim()).filter(Boolean))];
  return (LABELS[moduleId] || 'Transaction') + (from.length ? ' from ' + from.join(', ') : '');
}

// A line's description: the one typed, else the item's (or category's) name.
function lineDescription(given, fallbackName) {
  const typed = String(given == null ? '' : given).trim();
  return typed || String(fallbackName == null ? '' : fallbackName).trim();
}

module.exports = { LABELS, headerDescription, lineDescription };
