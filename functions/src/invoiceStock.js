// Direct sales invoice: item lines on a Customer Invoice that deliver the
// stock themselves, typed directly or brought in from a Sales Order
// (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions
// 166-172). New development, hand-written.
//
// A company setting, off by default (167): salesInvoiceSettings/{companyId}
// { DirectStock: true }. On posting, the invoice makes and posts a Delivery
// Note for its item lines, already matched to it (the legacy patches
// invoice-item-lines-*), so stock, costing, the Stock Ledger and its
// reports, the order's delivered quantities, reservations, returns and the
// month-end check all work as for a delivery. This module checks the lines
// at save time; the delivery's own posting checks the stock and re-checks
// the order lines again.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { getReservationsForSource } = require('./reservations');

const onCallOptions = { region: 'us-central1' };
const PATH = 'salesInvoiceSettings/';
const MAX_LINES = 200;
const val = async p => (await rtdb.ref(p).get()).val();
const round = (n, d) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const ofCompany = (r, co) => !r.CompanyID || r.CompanyID === co;

async function directStockAllowed(companyId) {
  return Boolean(((await val(PATH + companyId)) || {}).DirectStock);
}

// The invoice's item lines as entered, checked; returns them to store.
// Throws Error (the legacy save turns it into { success: false, error }).
async function cleanItemLines(raw, companyId, customerId, invoiceId, headerCostCenterId) {
  const rows = (Array.isArray(raw) ? raw : []).filter(l => l && (l.ItemCode || l.ItemID || l.SourceSOLineID));
  if (!rows.length) return [];
  if (!(await directStockAllowed(companyId))) throw new Error('This company does not invoice stock directly: deliver it with a Delivery Note (Sales Invoice Configuration → "Invoices may deliver stock directly").');
  if (rows.length > MAX_LINES) throw new Error('At most ' + MAX_LINES + ' item lines.');
  const [items, units, uoms] = await Promise.all([val('items'), val('orgUnits'), val('uoms')]);
  const byCode = {};
  Object.entries(items || {}).forEach(([id, i]) => { byCode[i.ItemCode] = Object.assign({ ItemID: id }, i); });
  const soCache = {}, resCache = {};
  const so = async id => (id in soCache ? soCache[id] : (soCache[id] = await val('salesOrders/' + id)));
  const reserved = async (soId, lineId) => {
    if (!(soId in resCache)) resCache[soId] = await getReservationsForSource('SalesOrder', soId);
    return resCache[soId].filter(r => r.Status === 'Active' && r.SourceLineID === lineId).reduce((s, r) => s + (Number(r.Quantity) || 0), 0);
  };
  const usedPerSoLine = {};
  const out = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const l = rows[idx], n = 'Item line ' + (idx + 1) + ': ';
    const soId = text(l.SourceSOID, 80), soLineId = text(l.SourceSOLineID, 80);
    let item, warehouseId, unitPrice, soNumber = '';
    const qty = Number(String(l.Quantity == null ? '' : l.Quantity).replace(/,/g, ''));
    if (!(qty > 0)) throw new Error(n + 'enter a quantity greater than zero.');
    if (soId) {
      // From a Sales Order (decision 168): the order's item, warehouse and price, up to what is still to deliver and reserved.
      const order = await so(soId);
      if (!order || (order.Status !== 'Reserved' && order.Status !== 'Partially Reserved')) throw new Error(n + 'the Sales Order is no longer available for delivery.');
      if (order.CompanyID !== companyId || order.CustomerID !== customerId) throw new Error(n + 'the Sales Order belongs to another company or customer.');
      const sl = (order.Lines || []).find(x => x.LineID === soLineId);
      if (!sl) throw new Error(n + 'the Sales Order line was not found.');
      item = byCode[sl.ItemCode];
      warehouseId = sl.WarehouseID;
      unitPrice = Number(sl.UnitPrice) || 0;
      soNumber = order.SONumber || '';
      const key = soId + '|' + soLineId;
      usedPerSoLine[key] = (usedPerSoLine[key] || 0) + qty;
      const remaining = Math.max(0, Number(sl.OrderedQuantity || 0) - Number(sl.DeliveredQuantity || 0));
      const max = Math.min(remaining, await reserved(soId, soLineId));
      if (usedPerSoLine[key] > max + 0.000001) throw new Error(n + (soNumber || 'the order') + ', ' + sl.ItemCode + ': at most ' + max + ' can be invoiced now (remaining on the order ' + remaining + ', reserved ' + Math.min(max, remaining) + ').');
    } else {
      item = byCode[text(l.ItemCode, 60)] || (l.ItemID && items[l.ItemID] ? Object.assign({ ItemID: l.ItemID }, items[l.ItemID]) : null);
      warehouseId = text(l.WarehouseID, 80);
      unitPrice = Number(String(l.UnitPrice == null ? '' : l.UnitPrice).replace(/,/g, ''));
      if (!(unitPrice >= 0) || !isFinite(unitPrice)) throw new Error(n + 'enter the price (zero or more).');
    }
    if (!item || item.Status !== 'Active' || !ofCompany(item, companyId)) throw new Error(n + 'choose an active item of the company.');
    if (!item.InventoryAccountID) throw new Error(n + item.ItemCode + ' is not a stock item (no inventory account).');
    const wh = (units || {})[warehouseId];
    if (!wh || wh.Type !== 'Warehouse' || !ofCompany(wh, companyId)) throw new Error(n + 'choose a warehouse of the company.');
    const u = (uoms || {})[item.UOMID] || {};
    if (u.AllowDecimals === false && Math.round(qty) !== qty) throw new Error(n + item.ItemCode + ' is counted in whole ' + (u.Code || 'units') + '.');
    const ccId = text(l.CostCenterID, 80) || headerCostCenterId;
    if (!ccId) throw new Error(n + 'a cost center is required (on the line or the header): the cost of sales posts to it.');
    out.push({
      LineNo: out.length + 1, ItemID: item.ItemID, ItemCode: item.ItemCode, ItemName: item.ItemName || '', WarehouseID: warehouseId,
      Quantity: round(qty, 6), UnitPrice: round(unitPrice, 4), Amount: round(qty * unitPrice, 2),
      Description: text(l.Description, 300) || item.ItemName || item.ItemCode, CostCenterID: ccId, ProfitCenterID: text(l.ProfitCenterID, 80),
      SourceSOID: soId, SourceSOLineID: soId ? soLineId : '', SourceSONumber: soNumber
    });
  }
  return out;
}

exports.getInvoiceStockSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const co = text((request.data || {}).companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return { DirectStock: await directStockAllowed(co) };
});

// The customer's Sales Order lines still to deliver, for "From Sales Order"
// on the invoice (decision 168): with Customer Invoice access (a delivery's
// own picker needs Delivery Note access).
exports.getInvoiceableOrderLines = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('CUSTOMERINVOICE', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Customer Invoice.');
  const d = request.data || {};
  const co = text(d.companyId, 80), cust = text(d.customerId, 80);
  if (!co || !cust) return [];
  if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const orders = (await val('salesOrders')) || {};
  const out = [];
  for (const [id, o] of Object.entries(orders)) {
    if (o.CompanyID !== co || o.CustomerID !== cust || (o.Status !== 'Reserved' && o.Status !== 'Partially Reserved')) continue;
    const res = (await getReservationsForSource('SalesOrder', id)).filter(r => r.Status === 'Active');
    (o.Lines || []).forEach(l => {
      const reservedQty = res.filter(r => r.SourceLineID === l.LineID).reduce((t, r) => t + (Number(r.Quantity) || 0), 0);
      const remaining = Math.max(0, Number(l.OrderedQuantity || 0) - Number(l.DeliveredQuantity || 0));
      const max = Math.min(remaining, reservedQty);
      if (max > 0.000001) out.push({ SOID: id, SONumber: o.SONumber || '', SODate: o.SODate || '', LineID: l.LineID, ItemCode: l.ItemCode, WarehouseID: l.WarehouseID,
        UnitPrice: Number(l.UnitPrice) || 0, Remaining: remaining, Reserved: reservedQty, MaxQuantity: max });
    });
  }
  return out.sort((a, b) => (a.SODate + a.SONumber).localeCompare(b.SODate + b.SONumber));
});

exports.saveInvoiceStockSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('SALESINVOICESETUP', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change Sales Invoice Configuration.');
  const d = request.data || {};
  const co = text(d.companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  await rtdb.ref(PATH + co).set({ DirectStock: d.directStock === true, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

module.exports.cleanItemLines = cleanItemLines;
module.exports.directStockAllowed = directStockAllowed;
