// Linked document flows (owner, 2026-10-24; docs/modules/LINKED_FLOWS.md,
// decisions Q287-Q289). New development, hand-written.
//
// For a document open on its screen: the next steps it can be followed by
// ("Create next"), and its chain, the documents before and after it.
//
//   Purchase Requisition / Inventory PR → Purchase Order → GRN → Vendor
//   Invoice → Payment (Cash & Bank) or PDC Issued;
//   Sales Order → Delivery Note → Customer Invoice → Receipt (Cash & Bank)
//   or PDC Received; Sales Order → Customer Invoice where the company lets
//   an invoice deliver (decision 167).
//
// A next step is offered only while the document has something left to
// follow (the next screen's own picker would list it) and only to a user
// who may open the next module and create in it (access and draft). It
// opens the next screen with CreateFrom; that screen's own rules apply
// from there. Chain entries carry canOpen (access to their module).
// Payments, PDCs and returns are the live GL entries allocating against an
// invoice (partyLedger), opened by their entry id as the GL Report does.
// Read only: nothing here writes.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const stockStore = require('./stockStore');
const { salesOrders, customerInvoices } = require('./salesStore');
const { vendorInvoices, purchaseOrders, purchaseRequisitions, inventoryPurchaseRequisitions } = require('./purchaseStore');
const { getReservationsForSource } = require('./reservations');
const { directStockAllowed } = require('./invoiceStock');
const { liveEntriesAllocating, isLive } = require('./partyLedger');
const { moduleIdForEntry } = require('./masterData');
const { firestore } = require('./firebaseAdmin');

const onCallOptions = { region: 'us-central1' };
const round2 = n => Math.round(n * 100) / 100;
const listOf = v => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])).filter(Boolean);
const withId = (map, key) => Object.entries(map || {}).map(([id, d]) => Object.assign({ [key]: id }, d));

const LABELS = {
  PURCHASEREQUISITION: 'Purchase Requisition', INVENTORYPURCHASEREQUISITION: 'Inventory Purchase Requisition', PURCHASEORDER: 'Purchase Order',
  GRN: 'Goods Receipt', VENDORINVOICE: 'Vendor Invoice', SALESORDER: 'Sales Order', DELIVERYNOTE: 'Delivery Note',
  CUSTOMERINVOICE: 'Customer Invoice', CBT: 'Cash and Bank', JV: 'Journal Entry', PDCRECEIVED: 'PDC Received', PDCISSUED: 'PDC Issued',
  SALESRETURN: 'Credit Note', PURCHASERETURN: 'Debit Note'
};
const SOURCE_MODULES = ['PURCHASEREQUISITION', 'INVENTORYPURCHASEREQUISITION', 'PURCHASEORDER', 'GRN', 'VENDORINVOICE', 'SALESORDER', 'DELIVERYNOTE', 'CUSTOMERINVOICE', 'CBT', 'JV'];

// ---------- the documents ----------
const live = t => t && t.Status === 'Posted' && !t.ReversedByGRN && !t.ReversalOfGRN && !t.ReversedByDeliveryNoteID && !t.ReversalOfDeliveryNoteID && !t.ReversedByJV && !t.ReversalOfJV;
const invoiceLive = i => i && (i.Status === 'Posted' || i.Status === 'PendingReversalApproval') && !i.ReversedByInvoiceID && !i.ReversalOfInvoiceID;

async function loadDoc(module, id) {
  switch (module) {
    case 'SALESORDER': return salesOrders.get(id);
    case 'CUSTOMERINVOICE': return customerInvoices.get(id);
    case 'VENDORINVOICE': return vendorInvoices.get(id);
    case 'PURCHASEORDER': return purchaseOrders.get(id);
    case 'PURCHASEREQUISITION': return purchaseRequisitions.get(id);
    case 'INVENTORYPURCHASEREQUISITION': return inventoryPurchaseRequisitions.get(id);
    case 'GRN': case 'DELIVERYNOTE': {
      const t = await stockStore.getTx(id);
      return t && t.TransactionType === (module === 'GRN' ? 'GRN' : 'DeliveryNote') ? t : null;
    }
    case 'CBT': case 'JV': {
      const s = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(id).get();
      return s.exists ? Object.assign({ _id: id }, s.data()) : null;
    }
    default: return null;
  }
}

// A chain entry: what the screen lists and opens.
const entry = (module, id, number, date, status, relation) => ({ module, kind: LABELS[module] || module, id, number: number || '', date: date || '', status: status || '', relation });
const glEntry = (e, relation) => {
  const module = moduleIdForEntry(e);
  return entry(module, e._id, e.JVNumber || e.TransactionNumber || '', e.JVDate || '', e.Status, relation);
};
const soEntry = (id, so, rel) => entry('SALESORDER', id, so.SONumber, so.SODate, so.Status, rel);
const dnEntry = (id, t, rel) => entry('DELIVERYNOTE', id, t.TransactionNumber, t.TransactionDate, t.Status, rel);
const ciEntry = (id, i, rel) => entry('CUSTOMERINVOICE', id, i.TransactionNumber, i.InvoiceDate, i.Status, rel);
const poEntry = (id, po, rel) => entry('PURCHASEORDER', id, po.PONumber, po.PODate, po.Status, rel);
const grnEntry = (id, t, rel) => entry('GRN', id, t.TransactionNumber, t.TransactionDate, t.Status, rel);
const viEntry = (id, i, rel) => entry('VENDORINVOICE', id, i.TransactionNumber, i.InvoiceDate, i.Status, rel);

// What settles an invoice: the live entries allocating against it, and
// what is still open.
async function settlement(invoiceType, id, total) {
  const ref = invoiceType + ':' + id;
  const entries = await liveEntriesAllocating([ref]);
  let allocated = 0;
  entries.forEach(e => listOf(e.Lines).forEach(l => listOf(l.Allocations).forEach(a => {
    if (a.RefType === 'Against' && a.RefID === ref) allocated += Number(a.Amount) || 0;
  })));
  return { entries, outstanding: round2((Number(total) || 0) - allocated) };
}

// ---------- each module: its chain and its next steps ----------
async function salesOrderLinks(id, so) {
  const chain = [];
  const dns = withId(await stockStore.queryTx({ TransactionType: 'DeliveryNote', CustomerID: so.CustomerID }), '_id')
    .filter(t => listOf(t.Lines).some(l => l.SourceSOID === id));
  dns.forEach(t => chain.push(dnEntry(t._id, t, 'after')));
  const invoices = Object.assign({}, await customerInvoices.query({ SalesOrderID: id }));
  for (const t of dns) Object.assign(invoices, await customerInvoices.query({ DeliveryNoteID: t._id }));
  Object.entries(invoices).forEach(([iid, i]) => chain.push(ciEntry(iid, i, 'after')));
  // Something left to deliver: a line with quantity still to go and stock reserved for it.
  let shippable = false;
  if (so.Status === 'Reserved' || so.Status === 'Partially Reserved') {
    const res = (await getReservationsForSource('SalesOrder', id)).filter(r => r.Status === 'Active');
    shippable = listOf(so.Lines).some(l => {
      const remaining = Number(l.OrderedQuantity || 0) - Number(l.DeliveredQuantity || 0);
      const reserved = res.filter(r => r.SourceLineID === l.LineID).reduce((t, r) => t + (Number(r.Quantity) || 0), 0);
      return Math.min(remaining, reserved) > 0.000001;
    });
  }
  const from = { type: 'SalesOrder', id, companyId: so.CompanyID, customerId: so.CustomerID };
  const next = [];
  if (shippable) {
    next.push({ module: 'DELIVERYNOTE', label: 'Delivery Note', from });
    if (await directStockAllowed(so.CompanyID)) next.push({ module: 'CUSTOMERINVOICE', label: 'Customer Invoice (no delivery)', from });
  }
  return { chain, next };
}

async function deliveryNoteLinks(id, t) {
  const chain = [];
  const soIds = [...new Set(listOf(t.Lines).map(l => l.SourceSOID).filter(Boolean))];
  for (const soId of soIds) { const so = await salesOrders.get(soId); if (so) chain.push(soEntry(soId, so, 'before')); }
  const invoices = await customerInvoices.query({ DeliveryNoteID: id });
  Object.entries(invoices).forEach(([iid, i]) => chain.push(ciEntry(iid, i, 'after')));
  const next = live(t) && !t.MatchedToInvoiceID
    ? [{ module: 'CUSTOMERINVOICE', label: 'Customer Invoice', from: { type: 'DeliveryNote', id, companyId: t.CompanyID, customerId: t.CustomerID } }] : [];
  return { chain, next };
}

async function customerInvoiceLinks(id, inv) {
  const chain = [];
  const dnIds = [...new Set(listOf(inv.SourceDeliveryNotes).map(d => d.DeliveryNoteID).filter(Boolean))];
  const soIds = new Set(listOf(inv.ItemLines).map(l => l.SourceSOID).filter(Boolean));
  for (const dnId of dnIds) {
    const t = await stockStore.getTx(dnId);
    if (!t) continue;
    listOf(t.Lines).forEach(l => { if (l.SourceSOID) soIds.add(l.SourceSOID); });
    chain.push(dnEntry(dnId, t, 'before'));
  }
  for (const soId of soIds) { const so = await salesOrders.get(soId); if (so) chain.unshift(soEntry(soId, so, 'before')); }
  const s = await settlement('CustomerInvoice', id, inv.Total);
  s.entries.forEach(e => chain.push(glEntry(e, 'after')));
  const from = { type: 'CustomerInvoice', id, companyId: inv.CompanyID, customerId: inv.CustomerID, amount: s.outstanding };
  const next = invoiceLive(inv) && s.outstanding > 0.005
    ? [{ module: 'CBT', label: 'Receipt', from: Object.assign({ voucherType: 'Bank Receipt' }, from) }, { module: 'PDCRECEIVED', label: 'PDC Received', from }] : [];
  return { chain, next, outstanding: invoiceLive(inv) ? s.outstanding : null };
}

async function requisitionLinks(module, id, r) {
  const type = module === 'PURCHASEREQUISITION' ? 'PR' : 'IPR';
  const chain = [];
  Object.entries(await purchaseOrders.query({ CompanyID: r.CompanyID }))
    .filter(([, po]) => listOf(po.Lines).some(l => l.SourceRequisitionID === id && (!l.SourceRequisitionType || l.SourceRequisitionType === type)))
    .forEach(([pid, po]) => chain.push(poEntry(pid, po, 'after')));
  const next = r.Status === 'Submitted' ? [{ module: 'PURCHASEORDER', label: 'Purchase Order', from: { type, id, companyId: r.CompanyID } }] : [];
  return { chain, next };
}

async function purchaseOrderLinks(id, po) {
  const chain = [];
  for (const q of listOf(po.Requisitions)) {
    const m = q.RequisitionType === 'IPR' ? 'INVENTORYPURCHASEREQUISITION' : 'PURCHASEREQUISITION';
    const r = await (m === 'PURCHASEREQUISITION' ? purchaseRequisitions : inventoryPurchaseRequisitions).get(q.RequisitionID);
    if (r) chain.push(entry(m, q.RequisitionID, r.PRNumber || r.IPRNumber || q.RequisitionNumber, r.PRDate || r.IPRDate, r.Status, 'before'));
  }
  const grns = withId(await stockStore.queryTx({ TransactionType: 'GRN', VendorID: po.VendorID }), '_id')
    .filter(t => listOf(t.Lines).some(l => l.SourcePOID === id));
  grns.forEach(t => chain.push(grnEntry(t._id, t, 'after')));
  for (const t of grns) Object.entries(await vendorInvoices.query({ GRNID: t._id })).forEach(([vid, v]) => chain.push(viEntry(vid, v, 'after')));
  const open = po.Status === 'Approved' && listOf(po.Lines).some(l => Number(l.Quantity || 0) - Number(l.ReceivedQuantity || 0) > 0.000001);
  const next = open ? [{ module: 'GRN', label: 'Goods Receipt', from: { type: 'PurchaseOrder', id, companyId: po.CompanyID, vendorId: po.VendorID } }] : [];
  return { chain, next };
}

async function grnLinks(id, t) {
  const chain = [];
  const poIds = [...new Set(listOf(t.Lines).map(l => l.SourcePOID).filter(Boolean))];
  for (const poId of poIds) { const po = await purchaseOrders.get(poId); if (po) chain.push(poEntry(poId, po, 'before')); }
  Object.entries(await vendorInvoices.query({ GRNID: id })).forEach(([vid, v]) => chain.push(viEntry(vid, v, 'after')));
  const next = live(t) && !t.MatchedToInvoiceID
    ? [{ module: 'VENDORINVOICE', label: 'Vendor Invoice', from: { type: 'GRN', id, companyId: t.CompanyID, vendorId: t.VendorID } }] : [];
  return { chain, next };
}

async function vendorInvoiceLinks(id, inv) {
  const chain = [];
  const grnIds = [...new Set(listOf(inv.SourceGRNs).map(g => g.GRNID).filter(Boolean))];
  const poIds = new Set();
  for (const gid of grnIds) {
    const t = await stockStore.getTx(gid);
    if (!t) continue;
    listOf(t.Lines).forEach(l => { if (l.SourcePOID) poIds.add(l.SourcePOID); });
    chain.push(grnEntry(gid, t, 'before'));
  }
  for (const poId of poIds) { const po = await purchaseOrders.get(poId); if (po) chain.unshift(poEntry(poId, po, 'before')); }
  const s = await settlement('VendorInvoice', id, inv.Total);
  s.entries.forEach(e => chain.push(glEntry(e, 'after')));
  const from = { type: 'VendorInvoice', id, companyId: inv.CompanyID, vendorId: inv.VendorID, amount: s.outstanding };
  const next = invoiceLive(inv) && s.outstanding > 0.005
    ? [{ module: 'CBT', label: 'Payment', from: Object.assign({ voucherType: 'Bank Payment' }, from) }, { module: 'PDCISSUED', label: 'PDC Issued', from }] : [];
  return { chain, next, outstanding: invoiceLive(inv) ? s.outstanding : null };
}

// A payment, receipt or journal: the invoices it settles.
async function journalLinks(id, e) {
  const chain = [];
  const refs = new Set();
  listOf(e.Lines).forEach(l => listOf(l.Allocations).forEach(a => { if (a.RefType === 'Against' && a.RefID) refs.add(a.RefID); }));
  for (const ref of refs) {
    const [type, rid] = String(ref).split(':');
    if (type === 'CustomerInvoice') { const i = await customerInvoices.get(rid); if (i) chain.push(ciEntry(rid, i, 'before')); }
    else if (type === 'VendorInvoice') { const i = await vendorInvoices.get(rid); if (i) chain.push(viEntry(rid, i, 'before')); }
  }
  return { chain, next: [] };
}

async function linksFor(module, id, doc) {
  switch (module) {
    case 'SALESORDER': return salesOrderLinks(id, doc);
    case 'DELIVERYNOTE': return deliveryNoteLinks(id, doc);
    case 'CUSTOMERINVOICE': return customerInvoiceLinks(id, doc);
    case 'PURCHASEREQUISITION': case 'INVENTORYPURCHASEREQUISITION': return requisitionLinks(module, id, doc);
    case 'PURCHASEORDER': return purchaseOrderLinks(id, doc);
    case 'GRN': return grnLinks(id, doc);
    case 'VENDORINVOICE': return vendorInvoiceLinks(id, doc);
    default: return journalLinks(id, doc);
  }
}

exports.getDocumentLinks = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const module = String(d.module || '').trim().toUpperCase();
  const id = String(d.id || '').trim();
  if (!SOURCE_MODULES.includes(module)) throw new HttpsError('invalid-argument', 'No linked documents for ' + (module || 'this screen') + '.');
  if (!(await moduleHasCapability(module, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to ' + (LABELS[module] || module) + '.');
  const doc = id ? await loadDoc(module, id) : null;
  if (!doc) throw new HttpsError('not-found', (LABELS[module] || module) + ' not found.');
  if (!userCanAccessCompany(user.profile, doc.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if ((module === 'CBT' || module === 'JV') && !isLive(doc)) return { next: [], chain: [] };

  const links = await linksFor(module, id, doc);
  const role = user.profile.role;
  const can = {};
  const allowed = async (m, cap) => (can[m + cap] === undefined ? (can[m + cap] = await moduleHasCapability(m, cap, role)) : can[m + cap]);
  const next = [];
  for (const n of links.next) if ((await allowed(n.module, 'access')) && (await allowed(n.module, 'draft'))) next.push(n);
  const chain = [];
  for (const c of links.chain) chain.push(Object.assign(c, { canOpen: await allowed(c.module, 'access') }));
  return Object.assign({ next, chain }, links.outstanding === undefined ? {} : { outstanding: links.outstanding });
});

module.exports.SOURCE_MODULES = SOURCE_MODULES;
