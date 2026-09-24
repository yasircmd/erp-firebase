const { onCall } = require('firebase-functions/v2/https');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { APPROVAL_GATEABLE_MODULES, APPROVAL_MODULE_STORAGE_ } = require('./approvalRegistry');

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
      return inst.RequiredLevels.some(l => l.ApproverUserID === actor && !decidedLevels.has(l.LevelNumber));
    });

  // documentStillExists is async, so this filter step can't be a
  // plain synchronous .filter() the way the original was — resolved
  // in parallel here, then filtered against the resolved booleans.
  const existsFlags = await Promise.all(candidates.map(inst => documentStillExists(inst.ModuleID, inst.DocumentID)));

  return candidates
    .filter((inst, i) => existsFlags[i])
    .map(inst => {
      const moduleInfo = APPROVAL_GATEABLE_MODULES.find(m => m.ModuleID === inst.ModuleID);
      return Object.assign({ ModuleLabel: moduleInfo ? moduleInfo.Label : inst.ModuleID }, inst);
    })
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
      const moduleInfo = APPROVAL_GATEABLE_MODULES.find(m => m.ModuleID === inst.ModuleID);
      return {
        InstanceID: inst.InstanceID, ModuleID: inst.ModuleID,
        ModuleLabel: moduleInfo ? moduleInfo.Label : inst.ModuleID,
        DocumentID: inst.DocumentID, DocumentNumber: inst.DocumentNumber,
        RejectionReason: rejection ? rejection.Reason : '', RejectedAt: rejection ? rejection.DecidedAt : inst.UpdatedAt
      };
    })
    .sort((a, b) => (b.RejectedAt || '').localeCompare(a.RejectedAt || ''));
});
