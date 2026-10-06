const { onCall } = require('firebase-functions/v2/https');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { APPROVAL_MODULE_STORAGE_, FIRESTORE_JOURNAL_ENTRIES_COLLECTION, approvalLabelOf } = require('./approvalRegistry');
const { MODULE_REGISTRY } = require('./moduleRegistry');
const { userCanAccessCompany } = require('./glWriting');
const { moduleIdForEntry } = require('./masterData');

const onCallOptions = { region: 'us-central1' };

// Ported from fetchApprovalSourceDocument_. Firestore's own Admin SDK
// shape differs from the old firestoreGet_ wrapper (doc.exists is a
// property, doc.data() is a method) — everything else is identical.
async function fetchApprovalSourceDocument(moduleId, documentId) {
  const storage = APPROVAL_MODULE_STORAGE_[moduleId];
  if (!storage || !documentId) return null;
  if (storage.type === 'firestore') {
    const doc = await firestore.collection(storage.collection).doc(documentId).get();
    return doc.exists ? doc.data() : null;
  }
  const snap = await rtdb.ref(storage.path + '/' + documentId).get();
  return snap.val();
}

// Ported from documentStillExists_.
async function documentStillExists(moduleId, documentId) {
  if (!APPROVAL_MODULE_STORAGE_[moduleId]) return true;
  return Boolean(await fetchApprovalSourceDocument(moduleId, documentId));
}

exports.getPendingApprovalsForUser = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const actor = user.uid;
  const snap = await rtdb.ref('approvalInstances').get();
  const data = snap.val() || {};

  const candidates = Object.keys(data)
    .map(id => Object.assign({ InstanceID: id }, data[id]))
    .filter(inst => inst.Status === 'Pending')
    .filter(inst => {
      const decidedLevels = new Set((inst.Decisions || []).map(d => d.LevelNumber));
      // Job Order acceptance / stop acts level by level (owner, 2026-09-28): only the
      // lowest undecided level's approver has the task. Other modules: any undecided level.
      if (inst.ModuleID === 'JOBORDERREQUEST') {
        const current = inst.RequiredLevels.slice().sort((a, b) => a.LevelNumber - b.LevelNumber)
          .find(l => !decidedLevels.has(l.LevelNumber));
        return Boolean(current) && current.ApproverUserID === actor;
      }
      return inst.RequiredLevels.some(l => l.ApproverUserID === actor && !decidedLevels.has(l.LevelNumber));
    });

  // documentStillExists is async, so this filter step can't be a
  // plain synchronous .filter() the way the original was — resolved
  // in parallel here, then filtered against the resolved booleans.
  const existsFlags = await Promise.all(candidates.map(inst => documentStillExists(inst.ModuleID, inst.DocumentID)));

  return candidates
    .filter((inst, i) => existsFlags[i])
    .map(inst => Object.assign({ ModuleLabel: approvalLabelOf(inst) }, inst))
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
});

exports.getMyRejectedSubmissions = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const actor = user.uid;
  const snap = await rtdb.ref('approvalInstances').get();
  const data = snap.val() || {};

  const candidates = Object.keys(data)
    .map(id => Object.assign({ InstanceID: id }, data[id]))
    .filter(inst => inst.Status === 'Rejected' && inst.CreatedBy === actor);

  // Same reasoning as getPendingApprovalsForUser above for resolving
  // this in parallel rather than inline in a synchronous filter — plus
  // the fix this filter embodies: a "Rejected" instance's own Status
  // field is frozen forever, even once the document is edited and
  // resubmitted (resubmitting creates a genuinely FRESH instance, see
  // the old beginApprovalInstance_, never marking this one superseded).
  // Checking the document's own CURRENT ApprovalInstanceID against this
  // instance's own id is what actually distinguishes "still the active
  // rejection" from "superseded by a later resubmission."
  const stillActiveFlags = await Promise.all(candidates.map(async inst => {
    if (!APPROVAL_MODULE_STORAGE_[inst.ModuleID]) return true; // unknown module — safe default, don't hide
    const doc = await fetchApprovalSourceDocument(inst.ModuleID, inst.DocumentID);
    return Boolean(doc) && doc.ApprovalInstanceID === inst.InstanceID;
  }));

  return candidates
    .filter((inst, i) => stillActiveFlags[i])
    .map(inst => {
      const rejection = (inst.Decisions || []).slice().reverse().find(d => d.Decision === 'Rejected');
      return {
        InstanceID: inst.InstanceID, ModuleID: inst.ModuleID,
        ModuleLabel: approvalLabelOf(inst),
        DocumentID: inst.DocumentID, DocumentNumber: inst.DocumentNumber,
        RejectionReason: rejection ? rejection.Reason : '', RejectedAt: rejection ? rejection.DecidedAt : inst.UpdatedAt
      };
    })
    .sort((a, b) => (b.RejectedAt || '').localeCompare(a.RejectedAt || ''));
});

// ---------- My Drafts (docs/modules/DRAFT_TASKS.md, owner 2026-09-28) ----------
// Every document still in Draft, shown only to its last updater
// (UpdatedBy, else CreatedBy), until it is submitted, posted or deleted.
// Rejected documents stay in getMyRejectedSubmissions.
const STOCK_TYPE_TO_MODULE = {
  GRN: 'GRN', MaterialIssue: 'MATERIALISSUE', Production: 'PRODUCTION', WarehouseMovement: 'WAREHOUSEMOVEMENT',
  StockAdjustment: 'STOCKADJUSTMENT', PhysicalCount: 'PHYSICALCOUNT', DeliveryNote: 'DELIVERYNOTE',
  PurchaseReturn: 'PURCHASERETURN', SalesReturn: 'SALESRETURN'
};
const DRAFT_RTDB_SOURCES = [
  { path: 'stock/transactions', moduleOf: r => STOCK_TYPE_TO_MODULE[r.TransactionType] },
  { path: 'purchaseRequisitions', moduleOf: () => 'PURCHASEREQUISITION' },
  { path: 'inventoryPurchaseRequisitions', moduleOf: () => 'INVENTORYPURCHASEREQUISITION' },
  { path: 'purchaseOrders', moduleOf: () => 'PURCHASEORDER' },
  { path: 'salesOrders', moduleOf: () => 'SALESORDER' },
  { path: 'jobOrderBatches', moduleOf: () => 'JOBORDERREQUEST' },
  { path: 'vendorInvoices', moduleOf: () => 'VENDORINVOICE' },
  { path: 'customerInvoices', moduleOf: () => 'CUSTOMERINVOICE' },
  { path: 'pdcCheques', moduleOf: r => (r.Direction === 'Received' ? 'PDCRECEIVED' : r.Direction === 'Issued' ? 'PDCISSUED' : null) },
  { path: 'recurringJournals', moduleOf: () => 'RECURRINGJV' }
];
const DRAFT_FIRESTORE_SOURCES = [
  { collection: FIRESTORE_JOURNAL_ENTRIES_COLLECTION, moduleOf: r => moduleIdForEntry(r) },
  { collection: 'faPostings', moduleOf: r => r.ModuleID || null },
  { collection: 'employeeChanges', moduleOf: () => 'EMPCHANGE' },
  { collection: 'leaveRequests', moduleOf: () => 'LEAVE' },
  { collection: 'payrollRuns', moduleOf: () => 'PAYROLL' },
  { collection: 'payrollLoans', moduleOf: () => 'PAYROLLLOAN' },
  { collection: 'payrollSettlements', moduleOf: () => 'PAYROLLFS' },
  { collection: 'payrollInterim', moduleOf: () => 'PAYROLLIP' }
];
const draftDateOf = r => r.TransactionDate || r.JVDate || r.Date || r.InvoiceDate || r.PRDate || r.IPRDate ||
  r.PODate || r.SODate || r.JODate || r.EffectiveDate || r.FromDate || r.LeavingDate || r.PaymentDate || '';

exports.getMyDraftsForUser = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const actor = user.profile.username || user.uid;
  const role = user.profile.role;

  const records = [];
  const rtdbSnaps = await Promise.all(DRAFT_RTDB_SOURCES.map(src => rtdb.ref(src.path).get()));
  DRAFT_RTDB_SOURCES.forEach((src, i) => {
    const data = rtdbSnaps[i].val() || {};
    Object.keys(data).forEach(id => { if (data[id] && data[id].Status === 'Draft') records.push({ id, r: data[id], moduleOf: src.moduleOf }); });
  });
  const fsSnaps = await Promise.all(DRAFT_FIRESTORE_SOURCES.map(src => firestore.collection(src.collection).where('Status', '==', 'Draft').get()));
  DRAFT_FIRESTORE_SOURCES.forEach((src, i) => {
    fsSnaps[i].docs.forEach(d => records.push({ id: d.id, r: d.data(), moduleOf: src.moduleOf }));
  });

  const mine = records
    .filter(x => (x.r.UpdatedBy || x.r.CreatedBy) === actor)
    .filter(x => userCanAccessCompany(user.profile, x.r.CompanyID))
    .map(x => Object.assign(x, { moduleId: x.moduleOf(x.r) }))
    .filter(x => x.moduleId);

  const moduleIds = [...new Set(mine.map(x => x.moduleId))];
  const accessFlags = await Promise.all(moduleIds.map(m => moduleHasCapability(m, 'access', role)));
  const canAccess = new Set(moduleIds.filter((m, i) => accessFlags[i]));

  return mine
    .filter(x => canAccess.has(x.moduleId))
    .map(x => {
      const moduleInfo = MODULE_REGISTRY.find(m => m.id === x.moduleId);
      return {
        ModuleID: x.moduleId, ModuleLabel: moduleInfo ? moduleInfo.label : x.moduleId,
        DocumentID: x.id, Description: x.r.Description || '', DocumentDate: draftDateOf(x.r),
        CompanyID: x.r.CompanyID || '', SavedAt: x.r.UpdatedAt || x.r.CreatedAt || ''
      };
    })
    .sort((a, b) => (b.SavedAt || '').localeCompare(a.SavedAt || ''));
});
