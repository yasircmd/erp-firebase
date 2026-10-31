// Customer credit control, the pure parts (docs/modules/CREDIT_CONTROL.md,
// Q360-Q365). New development, hand-written; no Firebase here, so the unit
// tests reach every rule.
'use strict';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// What a confirmed Sales Order still has to deliver, at its prices (before tax),
// in its own currency.
function openOrderValue(so) {
  return round2((so.Lines || []).reduce((s, l) =>
    s + Math.max(0, (Number(l.OrderedQuantity) || 0) - (Number(l.DeliveredQuantity) || 0)) * (Number(l.UnitPrice) || 0), 0));
}
// A posted Delivery Note's value, at its prices (before tax), in its order's currency.
function deliveryValue(dn) {
  return round2((dn.Lines || []).reduce((s, l) => s + (Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0), 0));
}
// A Delivery Note still to be invoiced: posted, not matched, not reversed or a reversal.
function uninvoiced(dn) {
  return dn.TransactionType === 'DeliveryNote' && dn.Status === 'Posted' && !dn.MatchedToInvoiceID && !dn.ReversedByDeliveryNoteID && !dn.ReversalOfDeliveryNoteID;
}

// A customer's overdue items from its aging row (due basis): those more than
// `grace` days past their due date. { Amount, Days (the oldest), Items }.
function overdueOf(agingRow, grace) {
  const g = Math.max(0, Number(grace) || 0);
  const items = ((agingRow && agingRow.Items) || []).filter(i => Number(i.Outstanding) > 0 && Number(i.Age) > g);
  return {
    Amount: round2(items.reduce((s, i) => s + (Number(i.BaseOutstanding != null ? i.BaseOutstanding : i.Outstanding) || 0), 0)),
    Days: items.reduce((m, i) => Math.max(m, Number(i.Age) || 0), 0),
    Items: items
  };
}

// The exposure (Q361): the receivable (net of credits not applied; cheques in
// hand are still in it) and, where the company counts them, deliveries not
// yet invoiced and confirmed orders not yet delivered.
function exposureOf(parts, mode) {
  const receivable = round2(parts.Receivable);
  if (mode === 'Receivable') return receivable;
  return round2(receivable + (Number(parts.Deliveries) || 0) + (Number(parts.Orders) || 0));
}

// A limit as stored: null for none, else a number >= 0.
function limitOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

// What stands against a customer (Q362, Q364), with `extra` the document
// being checked (0 for the report): the hold, the limit, overdue items.
function standing(row, extra) {
  const flags = [];
  if (row.Hold) flags.push('Hold');
  const after = round2((Number(row.Exposure) || 0) + (Number(extra) || 0));
  if (row.Limit !== null && row.Limit !== undefined && after > row.Limit + 0.005) flags.push('OverLimit');
  if (row.Overdue > 0) flags.push('Overdue');
  return { Flags: flags, After: after, Over: row.Limit === null || row.Limit === undefined ? 0 : round2(Math.max(0, after - row.Limit)) };
}

// The report's order: on hold, then over the limit, then overdue, then the most exposed.
function sortRows(rows) {
  const rank = r => (r.Flags.includes('Hold') ? 0 : r.Flags.includes('OverLimit') ? 1 : r.Flags.includes('Overdue') ? 2 : 3);
  return rows.sort((a, b) => rank(a) - rank(b) || b.Exposure - a.Exposure || String(a.Name).localeCompare(String(b.Name)));
}

module.exports = { round2, openOrderValue, deliveryValue, uninvoiced, overdueOf, exposureOf, limitOf, standing, sortRows };
