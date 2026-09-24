const { randomUUID } = require('crypto');
const { rtdb } = require('./firebaseAdmin');

// Ported from resolveRequiredApprovalLevels_.
async function resolveRequiredApprovalLevels(moduleId, scopeKey, amount) {
  const configSnap = await rtdb.ref('approvalConfigurations/' + moduleId).get();
  const config = configSnap.val();
  if (!config || !config.Enabled) return [];
  const key = String(scopeKey || '').trim();
  if (!key) return [];
  const levelsSnap = await rtdb.ref('approvalLevels/' + moduleId + '/' + key).get();
  const levelsRecord = levelsSnap.val();
  const levels = (levelsRecord && levelsRecord.Levels) || [];
  const docAmount = Number(amount) || 0;
  return levels.filter(l => docAmount >= Number(l.ThresholdAmount || 0));
}

// Ported from resolveApprovalScopeKeyForDocument_.
async function resolveApprovalScopeKeyForDocument(moduleId, dimensions) {
  const configSnap = await rtdb.ref('approvalConfigurations/' + moduleId).get();
  const config = configSnap.val();
  if (!config) return '';
  const d = dimensions || {};
  switch (config.ScopeType) {
    case 'Global': return 'GLOBAL';
    case 'Company': return d.CompanyID || '';
    case 'Division': return d.DivisionID || '';
    case 'Branch': return d.BranchID || '';
    case 'CostCenter': return d.CostCenterID || '';
    default: return '';
  }
}

// Ported from beginApprovalInstance_. createdBy MUST be the submitting
// user's own UID (same requirement the original had) — recordApprovalDecision
// compares an approver's own UID against this exact value to flag
// SelfApproved.
async function beginApprovalInstance(moduleId, documentId, documentNumber, scopeKey, amount, createdBy) {
  const levels = await resolveRequiredApprovalLevels(moduleId, scopeKey, amount);
  if (!levels.length) return { required: false };

  const now = new Date().toISOString();
  const newId = 'APR-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref('approvalInstances/' + newId).set({
    ModuleID: moduleId, DocumentID: documentId, DocumentNumber: documentNumber,
    ScopeKey: scopeKey, Amount: Number(amount) || 0, CreatedBy: createdBy,
    RequiredLevels: levels, Decisions: [], Status: 'Pending',
    CreatedAt: now, UpdatedAt: now
  });
  return { required: true, instanceId: newId };
}

// The actual approve/reject action's own core logic — kept separate
// from the callable wrapper below (recordApprovalDecisionCallable) so
// module-specific decide<Module>Approval callables (e.g.
// decideStockAdjustmentApproval) can call this directly as a plain
// function, the same way the original decideStockAdjustmentApproval
// called recordApprovalDecision directly rather than going through its
// own callable/RPC layer.
async function recordApprovalDecision(user, instanceId, levelNumber, decision, reason) {
  const actor = user.uid;
  const usersSnap = await rtdb.ref('users').get();
  const activeUsers = usersSnap.val() || {};
  const actorName = (activeUsers[actor] && (activeUsers[actor].fullName || activeUsers[actor].username)) || actor;
  const instanceSnap = await rtdb.ref('approvalInstances/' + instanceId).get();
  const instance = instanceSnap.val();
  if (!instance) throw new Error('Approval record not found.');
  if (instance.Status !== 'Pending') throw new Error('This document has already been ' + instance.Status.toLowerCase() + '.');

  const level = (instance.RequiredLevels || []).find(l => l.LevelNumber === levelNumber);
  if (!level) throw new Error('That approval level does not apply to this document.');
  if (level.ApproverUserID !== actor) throw new Error('You are not the assigned approver for this level.');
  if ((instance.Decisions || []).some(d => d.LevelNumber === levelNumber)) {
    throw new Error('This level has already recorded a decision.');
  }

  if (decision !== 'Approved' && decision !== 'Rejected') throw new Error('Invalid decision.');
  const reasonText = String(reason || '').trim();
  if (decision === 'Rejected' && !reasonText) throw new Error('A reason is required to reject.');

  const now = new Date().toISOString();
  const newDecision = {
    LevelNumber: levelNumber, ApproverUserID: actor, ApproverName: actorName, Decision: decision,
    DecidedAt: now, Reason: reasonText, SelfApproved: actor === instance.CreatedBy
  };
  const decisions = (instance.Decisions || []).concat([newDecision]);

  let newStatus = instance.Status;
  if (decision === 'Rejected') {
    newStatus = 'Rejected';
  } else if (instance.RequiredLevels.every(l => decisions.some(d => d.LevelNumber === l.LevelNumber && d.Decision === 'Approved'))) {
    newStatus = 'Approved';
  }

  await rtdb.ref('approvalInstances/' + instanceId).update({ Decisions: decisions, Status: newStatus, UpdatedAt: now });
  return { status: newStatus, selfApproved: newDecision.SelfApproved };
}

module.exports = { resolveRequiredApprovalLevels, resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision };
