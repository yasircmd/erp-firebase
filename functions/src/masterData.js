const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { getStockLedgerEntry } = require('./stockMovement');

const onCallOptions = { region: 'us-central1' };

// The read-side and small helper functions every ported stock-module
// screen calls on load (dropdowns, permission flags, available-stock
// hints, approval banner, GL impact popup). The four stock modules'
// commit logic was ported first; without these, their screens could
// load but never populate a line, so none of them was actually usable.

// Ported from getModulePermissionsForUser.
exports.getModulePermissionsForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const id = String(request.data && request.data.moduleId || '').trim().toUpperCase();
  return {
    canDraft: await moduleHasCapability(id, 'draft', user.profile.role),
    canPost: await moduleHasCapability(id, 'post', user.profile.role)
  };
});

// Ported from getActiveItems.
exports.getActiveItems = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = (await rtdb.ref('items').get()).val() || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany(user.profile, data[id].CompanyID))
    .map(id => ({
      ItemID: id, ItemCode: data[id].ItemCode, ItemName: data[id].ItemName,
      Category: data[id].Category, SubCategoryID: data[id].SubCategoryID || '',
      UOMID: data[id].UOMID, AltUOMID: data[id].AltUOMID || '', ConversionFactor: data[id].ConversionFactor || 0,
      CompanyID: data[id].CompanyID || '', DefaultWarehouseID: data[id].DefaultWarehouseID || '',
      InventoryAccountID: data[id].InventoryAccountID, ConsumptionAccountID: data[id].ConsumptionAccountID,
      SalesCogsAccountID: data[id].SalesCogsAccountID || '', WriteOffAccountID: data[id].WriteOffAccountID || '',
      BatchTracked: Boolean(data[id].BatchTracked)
    }));
});

// Ported from DEFAULT_UOMS, verbatim.
const DEFAULT_UOMS = [
  { code: 'PCS', name: 'Pieces', allowDecimals: false, decimalPlaces: 0 },
  { code: 'KG', name: 'Kilogram', allowDecimals: true, decimalPlaces: 3 },
  { code: 'LTR', name: 'Litre', allowDecimals: true, decimalPlaces: 2 },
  { code: 'MTR', name: 'Metre', allowDecimals: true, decimalPlaces: 2 },
  { code: 'BOX', name: 'Box', allowDecimals: false, decimalPlaces: 0 }
];

// Ported from ensureUOMsSeeded_ — same lazy seed: any default UOM code
// missing from the live node is added, never overwriting an existing
// record. ID format kept identical ('UOM-' + first UUID segment,
// uppercased), in place of Utilities.getUuid().
async function ensureUOMsSeeded(existing) {
  const existingCodes = new Set(Object.values(existing).map(u => String(u.Code).toUpperCase()));
  const missing = DEFAULT_UOMS.filter(u => !existingCodes.has(u.code));
  if (!missing.length) return existing;

  const now = new Date().toISOString();
  const updates = {};
  missing.forEach(u => {
    const id = 'UOM-' + randomUUID().split('-')[0].toUpperCase();
    const record = { Code: u.code, Name: u.name, AllowDecimals: u.allowDecimals, DecimalPlaces: u.decimalPlaces, Status: 'Active', CreatedAt: now, CreatedBy: 'system', UpdatedAt: now, UpdatedBy: 'system' };
    updates[id] = record;
    existing[id] = record;
  });
  await rtdb.ref('uoms').update(updates);
  return existing;
}

// Ported from getActiveUOMs.
exports.getActiveUOMs = onCallWithMessages(onCallOptions, async (request) => {
  await requireUser(request);
  let data = (await rtdb.ref('uoms').get()).val() || {};
  data = await ensureUOMsSeeded(data);
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .map(id => ({ UOMID: id, Code: data[id].Code, Name: data[id].Name, AllowDecimals: Boolean(data[id].AllowDecimals), DecimalPlaces: data[id].DecimalPlaces || 0 }));
});

// Ported from getActiveOrgUnits.
exports.getActiveOrgUnits = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = (await rtdb.ref('orgUnits').get()).val() || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany(user.profile, data[id].CompanyID || ''))
    .map(id => ({ UnitID: id, Type: data[id].Type, Code: data[id].Code, Name: data[id].Name, CompanyID: data[id].CompanyID || '' }));
});

// Ported from getActiveVendors.
exports.getActiveVendors = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = (await rtdb.ref('vendors').get()).val() || {};
  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => userCanAccessCompany(user.profile, data[id].CompanyID))
    .map(id => ({
      VendorID: id, VendorCode: data[id].VendorCode, VendorName: data[id].VendorName,
      Category: data[id].Category || '', CompanyID: data[id].CompanyID || '',
      Classification: data[id].Classification || '', Country: data[id].Country || '',
      TradePayablesAccountID: data[id].TradePayablesAccountID || '',
      PaymentTermsDays: data[id].PaymentTermsDays || 0, DefaultCurrency: data[id].DefaultCurrency || '',
      AddressLine1: data[id].AddressLine1 || '', AddressLine2: data[id].AddressLine2 || '',
      ContactPerson: data[id].ContactPerson || '', Phone: data[id].Phone || '',
      Email: data[id].Email || '', TaxRegistrationNumber: data[id].TaxRegistrationNumber || ''
    }));
});

// Ported from getStockLedgerEntryPublic. Pre-existing quirk preserved:
// the original checks only that the caller is a signed-in, active ERP
// user — no company-access check on the item or warehouse — so any
// user can read any item+warehouse balance by ID. Not tightened here
// (fidelity first); worth a deliberate decision later.
exports.getStockLedgerEntryPublic = onCallWithMessages(onCallOptions, async (request) => {
  await requireUser(request);
  const itemId = request.data && request.data.itemId;
  const warehouseId = request.data && request.data.warehouseId;
  if (!itemId || !warehouseId) throw new HttpsError('invalid-argument', 'Item and warehouse are required.');
  return getStockLedgerEntry(itemId, warehouseId);
});

// Ported from getMyPendingApprovalLevel.
exports.getMyPendingApprovalLevel = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const approvalInstanceId = request.data && request.data.approvalInstanceId;
  if (!approvalInstanceId) return null;
  const instance = (await rtdb.ref('approvalInstances/' + approvalInstanceId).get()).val();
  if (!instance || instance.Status !== 'Pending') return null;
  const decidedLevels = new Set((instance.Decisions || []).map(d => d.LevelNumber));
  const mine = (instance.RequiredLevels || []).find(l => l.ApproverUserID === user.uid && !decidedLevels.has(l.LevelNumber));
  return mine ? mine.LevelNumber : null;
});

// Ported from getJournalEntryDetail — the "GL impact" popup.
exports.getJournalEntryDetail = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const jvId = request.data && request.data.jvId;
  if (!jvId) throw new HttpsError('invalid-argument', 'No linked GL entry to show.');
  const doc = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(jvId).get();
  if (!doc.exists) throw new HttpsError('not-found', 'Journal entry not found.');
  const entry = doc.data();
  if (!userCanAccessCompany(user.profile, entry.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');

  const coaData = (await rtdb.ref('coa').get()).val() || {};
  const accountsByCode = {};
  Object.keys(coaData).forEach(id => { accountsByCode[coaData[id].AccountCode] = coaData[id]; });

  const lines = (entry.Lines || []).map(l => {
    const account = accountsByCode[l.AccountCode];
    return {
      AccountCode: l.AccountCode, AccountName: account ? account.AccountName : '(account not found)',
      Debit: l.Debit || 0, Credit: l.Credit || 0, Description: l.Description || ''
    };
  });

  return {
    JVID: jvId, JVNumber: entry.JVNumber, JVDate: entry.JVDate,
    Description: entry.Description, Reference: entry.Reference,
    TotalDebit: entry.TotalDebit, TotalCredit: entry.TotalCredit,
    Lines: lines
  };
});

// Ported from CBT_VOUCHER_CONFIG's keys and STOCK_VOUCHER_TYPE_TO_MODULE,
// verbatim — only what moduleIdForEntry_ needs to route a GL entry to
// the module whose 'post' permission governs editing it.
const CBT_VOUCHER_TYPES = ['Cash Receipt', 'Bank Receipt', 'Cash Payment', 'Bank Payment'];
const STOCK_VOUCHER_TYPE_TO_MODULE = {
  GRN: 'GRN',
  MaterialIssue: 'MATERIALISSUE',
  Production: 'PRODUCTION',
  WarehouseMovement: 'WAREHOUSEMOVEMENT',
  StockAdjustment: 'STOCKADJUSTMENT',
  PhysicalCount: 'PHYSICALCOUNT',
  VendorInvoice: 'VENDORINVOICE',
  DeliveryNote: 'DELIVERYNOTE',
  CustomerInvoice: 'CUSTOMERINVOICE'
};

// Ported from moduleIdForEntry_.
function moduleIdForEntry(record) {
  if (record.VoucherType && CBT_VOUCHER_TYPES.includes(record.VoucherType)) return 'CBT';
  if (record.VoucherType && STOCK_VOUCHER_TYPE_TO_MODULE[record.VoucherType]) return STOCK_VOUCHER_TYPE_TO_MODULE[record.VoucherType];
  return 'JV';
}

// Ported from updatePostedDescription — the one write in this file:
// edits ONLY the Description (plus audit fields) of an already-posted
// GL entry, never amounts or lines. Same checks in the same order as
// the original. Two pre-existing quirks preserved, not changed:
//  - no company-access check (only the 'post' capability of the
//    entry's own module gates it), unlike getJournalEntryDetail above;
//  - it only updates the Firestore GL entry, not the stock transaction
//    record's own Description in RTDB, so the module's list view keeps
//    showing the old text after a reload.
// Returns { success, error } rather than throwing, like the original —
// the screens show result.error inline.
exports.updatePostedDescription = onCallWithMessages(onCallOptions, async (request) => {
  try {
    const user = await requireUser(request);
    const jvId = String(request.data && request.data.jvId || '').trim();
    if (!jvId) throw new Error('Entry not found.');
    const ref = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(jvId);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('Entry not found.');
    const existing = doc.data();
    const moduleId = moduleIdForEntry(existing);
    if (!(await moduleHasCapability(moduleId, 'post', user.profile.role))) {
      throw new Error('You do not have permission to post or reverse entries in ' + moduleId + '.');
    }
    if (existing.Status !== 'Posted') throw new Error('This entry is not posted — edit it normally instead.');

    const newDescription = String(request.data && request.data.description || '').trim();
    if (!newDescription) throw new Error('Description is required.');

    await ref.update({
      Description: newDescription,
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: user.profile.username || user.uid
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

module.exports.moduleIdForEntry = moduleIdForEntry;
module.exports.DEFAULT_UOMS = DEFAULT_UOMS;
