// Asset Master (FAASSET): create and maintain assets, the asset list,
// and each asset's history (docs/modules/FIXED_ASSETS.md → Asset Master).
//
// Before capitalization (status Planned) everything but the company is
// editable and an asset with no transactions can be deleted. After it:
// class and company are fixed; the assignment (division, branch, cost
// and profit center) can still be corrected until depreciation has been
// posted, and after that only by a Transfer (phase 2); method, life,
// rate and residual change prospectively (a change of estimate) and the
// depreciation start date is fixed once depreciation has been posted.
// Every change after capitalization is a MasterChange transaction.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const E = require('./faDepreciation');
const C = require('./fixedAssetsCommon');
const { COL, AREA, str, round2 } = C;

const onCallOptions = { region: 'us-central1' };
const INFO_FIELDS = ['Description', 'SerialNumber', 'TagNumber', 'Quantity', 'Notes', 'SupplierID', 'SupplierName', 'PurchaseInvoiceRef', 'PurchaseDate'];
const ASSIGN_FIELDS = ['DivisionID', 'BranchID', 'CostCenterID', 'ProfitCenterID'];
const VALUATION_FIELDS = ['Method', 'UsefulLifeMonths', 'WdvRate', 'ResidualValue', 'DepStartDate'];
const ORG_TYPES = { DivisionID: 'Division', BranchID: 'Branch', CostCenterID: 'CostCenter', ProfitCenterID: 'ProfitCenter' };

const depreciates = kind => kind === 'Tangible' || kind === 'Intangible';

// Classes and vendors an asset of this company can use.
exports.getFaAssetSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const moduleId = ['FAASSET', 'FAADDDEP'].includes(request.data && request.data.moduleId) ? request.data.moduleId : 'FAASSET';
  await C.requireCap(moduleId, 'access', user.profile.role);
  const companyId = str(request.data && request.data.companyId);
  if (!companyId) return { classes: [], vendors: [] };
  C.requireCompany(user, companyId);
  const [classes, vendorsSnap, settings] = await Promise.all([firestore.collection(COL.classes).get(), rtdb.ref('vendors').get(), C.getSettings(companyId)]);
  const vendors = vendorsSnap.val() || {};
  return {
    classes: C.docsOf(classes).filter(c => c.Status === 'Active' && (!c.CompanyID || c.CompanyID === companyId))
      .map(c => Object.assign({ ClassID: c._id }, c)).sort((a, b) => a.Code.localeCompare(b.Code)),
    vendors: Object.keys(vendors).filter(id => vendors[id].Status === 'Active' && (!vendors[id].CompanyID || vendors[id].CompanyID === companyId))
      .map(id => ({ VendorID: id, Code: vendors[id].VendorCode || '', Name: vendors[id].VendorName || '' })).sort((a, b) => a.Name.localeCompare(b.Name)),
    clearingConfigured: Boolean(settings.ClearingAccountID), lastPostedPeriod: settings.LastPostedPeriod || ''
  };
});

// Every asset of the user's companies (optionally one company).
exports.getFaAssets = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const moduleId = ['FAASSET', 'FAACQ', 'FAADDDEP', 'FADEPRUN', 'FAREGISTER'].includes(d.moduleId) ? d.moduleId : 'FAASSET';
  await C.requireCap(moduleId, 'access', user.profile.role);
  const companyId = str(d.companyId);
  let assets;
  if (companyId) { C.requireCompany(user, companyId); assets = await C.listWhere(COL.assets, 'CompanyID', companyId); }
  else assets = C.docsOf(await firestore.collection(COL.assets).get()).filter(a => userCanAccessCompany(user.profile, a.CompanyID));
  return assets.map(a => Object.assign({ AssetID: a._id }, a)).sort((a, b) => a.AssetNumber.localeCompare(b.AssetNumber));
});

// One asset with its history (every transaction, newest last).
exports.getFaAsset = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const moduleId = ['FAASSET', 'FAREGISTER'].includes(d.moduleId) ? d.moduleId : 'FAASSET';
  await C.requireCap(moduleId, 'access', user.profile.role);
  const asset = await C.getDoc(COL.assets, str(d.assetId));
  if (!asset) throw new HttpsError('not-found', 'Asset not found.');
  C.requireCompany(user, asset.CompanyID);
  const txns = (await C.listWhere(COL.txns, 'AssetID', asset._id)).sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
  return { asset: Object.assign({ AssetID: asset._id }, asset), history: txns.map(t => Object.assign({ TxnID: t._id }, t)) };
});

async function orgUnits() { return (await rtdb.ref('orgUnits').get()).val() || {}; }

// Builds the stored fields from what the screen sent, checked.
async function buildAsset(d, user, existing) {
  const companyId = existing ? existing.CompanyID : str(d.CompanyID);
  C.requireCompany(user, companyId);
  const cls = await C.getDoc(COL.classes, existing ? existing.ClassID : str(d.ClassID));
  if (!cls) throw new HttpsError('invalid-argument', 'Select an asset class.');
  if (!existing && cls.Status !== 'Active') throw new HttpsError('invalid-argument', 'That asset class is inactive.');
  if (cls.CompanyID && cls.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'That asset class belongs to a different company.');
  if (cls.Kind === 'AuC') throw new HttpsError('failed-precondition', 'Assets under Construction are handled by their own sub-module (phase 2).');

  const out = { CompanyID: companyId, ClassID: cls._id, ClassCode: cls.Code, ClassName: cls.Name, ClassKind: cls.Kind };
  out.Description = str(d.Description);
  if (!out.Description) throw new HttpsError('invalid-argument', 'Description is required.');
  out.SerialNumber = str(d.SerialNumber);
  out.TagNumber = str(d.TagNumber);
  out.Notes = str(d.Notes);
  out.Quantity = d.Quantity === '' || d.Quantity == null ? 1 : Number(d.Quantity);
  if (!(out.Quantity > 0)) throw new HttpsError('invalid-argument', 'Quantity must be more than zero.');
  out.PurchaseDate = str(d.PurchaseDate);
  if (out.PurchaseDate && !E.isDate(out.PurchaseDate)) throw new HttpsError('invalid-argument', 'Purchase date is not a valid date.');
  out.PurchaseInvoiceRef = str(d.PurchaseInvoiceRef);
  out.SupplierID = str(d.SupplierID);
  out.SupplierName = '';
  if (out.SupplierID) {
    const v = (await rtdb.ref('vendors/' + out.SupplierID).get()).val();
    if (!v) throw new HttpsError('invalid-argument', 'Supplier not found.');
    out.SupplierName = v.VendorName || '';
  }

  const units = await orgUnits();
  for (const f of ASSIGN_FIELDS) {
    out[f] = str(d[f]);
    if (!out[f]) continue;
    const u = units[out[f]];
    if (!u || u.Type !== ORG_TYPES[f]) throw new HttpsError('invalid-argument', 'Unknown ' + ORG_TYPES[f].replace('Center', ' Center') + '.');
    if (u.CompanyID && u.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'That ' + ORG_TYPES[f].replace('Center', ' Center') + ' belongs to a different company.');
  }
  if (depreciates(cls.Kind) && !out.CostCenterID) {
    throw new HttpsError('invalid-argument', 'Select a Cost Center: depreciation expense is posted to it.');
  }

  const v = {
    Method: depreciates(cls.Kind) ? str(d.Method) || cls.DefaultMethod : 'None',
    UsefulLifeMonths: depreciates(cls.Kind) ? Number(d.UsefulLifeMonths || cls.DefaultUsefulLifeMonths) : 0,
    WdvRate: 0, ResidualValue: round2(Number(d.ResidualValue) || 0), DepStartDate: str(d.DepStartDate)
  };
  if (v.Method === 'WDV') v.WdvRate = Number(d.WdvRate || cls.DefaultWdvRate);
  if (!depreciates(cls.Kind)) { v.ResidualValue = 0; v.DepStartDate = ''; }
  const err = E.validateValuation(v, cls.Kind);
  if (err) throw new HttpsError('invalid-argument', err);
  out.valuation = v;
  return { fields: out, cls: cls };
}

function areaWith(existingArea, v) {
  return Object.assign({ Cost: 0, AccDep: 0, AccDepScheduled: 0, AccDepAdditional: 0, LastDepPeriod: '', FullyDepreciatedAt: '' }, existingArea || {}, v);
}

exports.saveFaAsset = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FAASSET', 'draft', user.profile.role);
  const d = request.data || {};
  const assetId = str(d.AssetID);

  return withGlobalLock(user.uid, async () => {
    const existing = assetId ? await C.getDoc(COL.assets, assetId) : null;
    if (assetId && !existing) throw new HttpsError('not-found', 'Asset not found.');
    if (existing && str(d.CompanyID) && str(d.CompanyID) !== existing.CompanyID) throw new HttpsError('failed-precondition', 'An asset\'s company can\'t change.');
    const { fields, cls } = await buildAsset(d, user, existing && existing.Status !== 'Planned' ? existing : (existing ? Object.assign({}, existing, { ClassID: str(d.ClassID) || existing.ClassID }) : null));
    const now = C.nowIso();
    const actor = C.actorOf(user);
    const v = fields.valuation;
    delete fields.valuation;

    if (!existing) {
      const number = await C.nextAssetNumber(fields.CompanyID);
      const doc = Object.assign(fields, {
        AssetNumber: number, SubNumber: 0, ParentAssetID: '', Status: 'Planned', CapitalizationDate: '',
        CurrencyCode: await defaultCurrencyCode(),
        // Reserved (docs → Reserved for later): filled once their masters exist.
        DepartmentID: '', LocationID: '', EmployeeID: '', EmployeeName: '',
        Areas: { [AREA]: areaWith(null, v) },
        CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
      });
      const id = C.newId('FA');
      await firestore.collection(COL.assets).doc(id).set(doc);
      return { success: true, assetId: id, assetNumber: number };
    }

    C.requireCompany(user, existing.CompanyID);
    const area = (existing.Areas || {})[AREA] || {};
    if (existing.Status === 'Planned') {
      await firestore.collection(COL.assets).doc(assetId).update(Object.assign(fields, {
        [`Areas.${AREA}`]: areaWith(area, v), UpdatedAt: now, UpdatedBy: actor
      }));
      return { success: true, assetId: assetId, assetNumber: existing.AssetNumber };
    }
    if (existing.Status === 'Disposed') throw new HttpsError('failed-precondition', 'A disposed asset can\'t be changed.');

    // After capitalization: record what changed.
    const txns = await C.assetTxns(assetId);
    const depPosted = txns.some(t => t.Type === 'Depreciation' && !t.ReversedByTxnID);
    const changes = [];
    const update = { UpdatedAt: now, UpdatedBy: actor };
    INFO_FIELDS.forEach(f => {
      if (String(existing[f] == null ? '' : existing[f]) !== String(fields[f] == null ? '' : fields[f])) {
        changes.push({ Field: f, From: existing[f] == null ? '' : existing[f], To: fields[f] }); update[f] = fields[f];
      }
    });
    ASSIGN_FIELDS.forEach(f => {
      if ((existing[f] || '') === fields[f]) return;
      if (depPosted) throw new HttpsError('failed-precondition', 'Depreciation has been posted for this asset: change its ' + ORG_TYPES[f].replace('Center', ' center').toLowerCase() + ' with an Asset Transfer.');
      changes.push({ Field: f, From: existing[f] || '', To: fields[f] }); update[f] = fields[f];
    });
    if (!v.DepStartDate) v.DepStartDate = area.DepStartDate || ''; // not sent: unchanged
    VALUATION_FIELDS.forEach(f => {
      const before = area[f] == null ? '' : area[f];
      if (String(before) === String(v[f])) return;
      if (f === 'DepStartDate' && depPosted) throw new HttpsError('failed-precondition', 'Depreciation has been posted for this asset: its depreciation start date can\'t change.');
      if (f === 'DepStartDate' && !E.isDate(v[f])) throw new HttpsError('invalid-argument', 'The depreciation start date is required.');
      changes.push({ Field: f, From: before, To: v[f] }); update[`Areas.${AREA}.${f}`] = v[f];
    });
    if (v.ResidualValue > round2(area.Cost || 0)) throw new HttpsError('invalid-argument', 'Residual value can\'t be more than the asset\'s cost (' + round2(area.Cost || 0).toFixed(2) + ').');
    if (!changes.length) return { success: true, assetId: assetId, assetNumber: existing.AssetNumber, unchanged: true };

    const batch = firestore.batch();
    batch.update(firestore.collection(COL.assets).doc(assetId), update);
    batch.set(firestore.collection(COL.txns).doc(C.newId('FAT')), {
      AssetID: assetId, AssetNumber: existing.AssetNumber, CompanyID: existing.CompanyID, Area: AREA, Type: 'MasterChange',
      Date: now.substring(0, 10), Period: now.substring(0, 7), CostDelta: 0, AccDepDelta: 0, Changes: changes,
      Reason: str(d.ChangeReason), CreatedAt: now, CreatedBy: actor
    });
    await batch.commit();
    return { success: true, assetId: assetId, assetNumber: existing.AssetNumber, changes: changes.length };
  });
});

async function defaultCurrencyCode() {
  const data = (await rtdb.ref('currencies').get()).val() || {};
  const id = Object.keys(data).find(k => data[k].IsDefault && data[k].Status === 'Active');
  return id ? data[id].Code || '' : '';
}

// Only a Planned asset that nothing refers to can be deleted.
exports.deleteFaAsset = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FAASSET', 'draft', user.profile.role);
  const assetId = str(request.data && request.data.assetId);
  return withGlobalLock(user.uid, async () => {
    const asset = await C.getDoc(COL.assets, assetId);
    if (!asset) throw new HttpsError('not-found', 'Asset not found.');
    C.requireCompany(user, asset.CompanyID);
    if (asset.Status !== 'Planned') throw new HttpsError('failed-precondition', 'Only an asset that was never capitalized can be deleted.');
    if ((await C.listWhere(COL.txns, 'AssetID', assetId)).length) throw new HttpsError('failed-precondition', 'This asset has transactions and can\'t be deleted.');
    const drafts = (await firestore.collection(COL.postings).where('AssetIDs', 'array-contains', assetId).get()).docs.map(x => x.data());
    const live = drafts.find(p => p.Status !== 'Reversed');
    if (live) throw new HttpsError('failed-precondition', 'This asset is on ' + (live.PostingNumber || 'a draft') + ' in ' + (live.Type === 'AdditionalDepreciation' ? 'Additional Depreciation' : 'Asset Capitalization') + '; remove it there first.');
    await firestore.collection(COL.assets).doc(assetId).delete();
    return { success: true };
  });
});
