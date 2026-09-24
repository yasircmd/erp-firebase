const { randomUUID } = require('crypto');
const { rtdb } = require('./firebaseAdmin');

// Ported from createStockReservation_. Caller supplies the acting
// user directly (actor) rather than this function re-deriving it via
// requireUser — every caller so far already holds a validated user
// object from its own top-level requireUser call, so re-verifying
// here would just be a redundant round-trip.
async function createStockReservation(actor, params) {
  const itemId = String(params.ItemID || '').trim();
  const warehouseId = String(params.WarehouseID || '').trim();
  const companyId = String(params.CompanyID || '').trim();
  const quantity = Number(params.Quantity);
  const sourceType = String(params.SourceType || '').trim();
  const sourceId = String(params.SourceID || '').trim();

  if (!itemId) throw new Error('Reservation requires an ItemID.');
  if (!warehouseId) throw new Error('Reservation requires a WarehouseID.');
  if (!companyId) throw new Error('Reservation requires a CompanyID.');
  if (!(quantity > 0)) throw new Error('Reservation quantity must be greater than zero.');
  if (!sourceType) throw new Error('Reservation requires a SourceType.');
  if (!sourceId) throw new Error('Reservation requires a SourceID.');

  const now = new Date().toISOString();
  const newId = 'RSV-' + randomUUID().split('-')[0].toUpperCase();

  await rtdb.ref('stock/reservations/' + newId).set({
    ItemID: itemId, ItemCode: String(params.ItemCode || '').trim(),
    WarehouseID: warehouseId, CompanyID: companyId, Quantity: quantity,
    Status: 'Active', SourceType: sourceType, SourceID: sourceId,
    SourceLineID: String(params.SourceLineID || '').trim(),
    SourceLabel: String(params.SourceLabel || '').trim(),
    CreatedByProductionID: String(params.CreatedByProductionID || '').trim(),
    Reason: String(params.Reason || '').trim(),
    CreatedAt: now, CreatedBy: actor
  });

  return newId;
}

// Ported from getReservationsForSource_.
async function getReservationsForSource(sourceType, sourceId) {
  const snap = await rtdb.ref('stock/reservations').get();
  const data = snap.val() || {};
  return Object.keys(data)
    .map(id => Object.assign({ ReservationID: id }, data[id]))
    .filter(r => r.SourceType === sourceType && r.SourceID === sourceId);
}

// Ported from refreshSalesOrderReservationStatus_.
async function refreshSalesOrderReservationStatus(soId) {
  const soSnap = await rtdb.ref('salesOrders/' + soId).get();
  const so = soSnap.val();
  if (!so || (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved')) return;

  let allLinesCovered = true;
  for (const soLine of (so.Lines || [])) {
    const reservations = await getReservationsForSource('SalesOrder', soId);
    const reserved = reservations
      .filter(r => r.Status === 'Active' && r.SourceLineID === soLine.LineID)
      .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
    const delivered = Number(soLine.DeliveredQuantity || 0);
    if ((reserved + delivered) < Number(soLine.OrderedQuantity)) { allLinesCovered = false; break; }
  }

  const correctStatus = allLinesCovered ? 'Reserved' : 'Partially Reserved';
  if (correctStatus !== so.Status) {
    await rtdb.ref('salesOrders/' + soId).update({ Status: correctStatus, UpdatedAt: new Date().toISOString() });
  }
}

// Ported from allocateAvailableStockToShortfalls_.
async function allocateAvailableStockToShortfalls(actor, itemId, itemCode, warehouseId, companyId, newlyAvailableQty, sourceLabel) {
  let remaining = newlyAvailableQty;
  if (!(remaining > 0)) return;

  const soSnap = await rtdb.ref('salesOrders').get();
  const soData = soSnap.val() || {};
  const candidates = [];
  for (const soId of Object.keys(soData)) {
    const so = soData[soId];
    if (so.CompanyID !== companyId) continue;
    if (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved') continue;
    for (const soLine of (so.Lines || [])) {
      if (soLine.ItemCode !== itemCode || soLine.WarehouseID !== warehouseId) continue;
      const reservations = await getReservationsForSource('SalesOrder', soId);
      const reserved = reservations
        .filter(r => r.Status === 'Active' && r.SourceLineID === soLine.LineID)
        .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
      const shortfall = Number(soLine.OrderedQuantity) - reserved;
      if (shortfall > 0) candidates.push({ SOID: soId, SONumber: so.SONumber || '', SOLineID: soLine.LineID, Shortfall: shortfall });
    }
  }
  candidates.sort((a, b) => a.SONumber.localeCompare(b.SONumber));

  const touchedSoIds = new Set();
  for (const c of candidates) {
    if (remaining <= 0) break;
    const toAllocate = Math.min(remaining, c.Shortfall);
    if (toAllocate <= 0) continue;
    await createStockReservation(actor, {
      ItemID: itemId, ItemCode: itemCode, WarehouseID: warehouseId, CompanyID: companyId,
      Quantity: toAllocate, SourceType: 'SalesOrder', SourceID: c.SOID, SourceLineID: c.SOLineID,
      SourceLabel: c.SONumber, Reason: 'Auto-allocated from ' + (sourceLabel || 'a stock increase')
    });
    remaining -= toAllocate;
    touchedSoIds.add(c.SOID);
  }
  for (const soId of touchedSoIds) {
    await refreshSalesOrderReservationStatus(soId);
  }
}

module.exports = { createStockReservation, getReservationsForSource, refreshSalesOrderReservationStatus, allocateAvailableStockToShortfalls };
