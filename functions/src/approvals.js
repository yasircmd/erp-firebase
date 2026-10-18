const { randomUUID } = require('crypto');
const { rtdb } = require('./firebaseAdmin');
const { approvalInstances } = require('./approvalStore');
const { CBT_APPROVAL_KEYS } = require('./approvalRegistry');

// One-time copy of the single CBT approval setup into its four voucher-type
// entries (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md), so nothing
// changes until someone edits one. An entry that already has its own setup
// is left alone. Runs before the first read of any of them, then never again.
async function ensureCbtSplit() {
  await ensureCbtSplitFromCbt();
  await ensureFundTransferFromBankPayment();
}
// The four payment / receipt entries, from the single CBT setup.
async function ensureCbtSplitFromCbt() {
  const marker = rtdb.ref('approvalMigrations/cbtSplit');
  if ((await marker.get()).exists()) return;
  const keys = Object.values(CBT_APPROVAL_KEYS).filter(k => k !== CBT_APPROVAL_KEYS['Fund Transfer']);
  const [config, levels, ...existing] = await Promise.all([
    rtdb.ref('approvalConfigurations/CBT').get(), rtdb.ref('approvalLevels/CBT').get(),
    ...keys.map(k => rtdb.ref('approvalConfigurations/' + k).get())
  ]);
  const updates = {};
  keys.forEach((k, i) => {
    if (existing[i].exists()) return;
    if (config.exists()) updates['approvalConfigurations/' + k] = config.val();
    if (levels.exists()) updates['approvalLevels/' + k] = levels.val();
  });
  updates['approvalMigrations/cbtSplit'] = { DoneAt: new Date().toISOString(), CopiedFromCBT: config.exists() };
  await rtdb.ref().update(updates);
}
// Fund Transfer (added later, owner 2026-09-29) starts as a copy of Bank
// Payment's setup, once, unless it already has its own.
async function ensureFundTransferFromBankPayment() {
  const marker = rtdb.ref('approvalMigrations/cbtFundTransfer');
  if ((await marker.get()).exists()) return;
  const key = CBT_APPROVAL_KEYS['Fund Transfer'];
  const [own, config, levels] = await Promise.all([
    rtdb.ref('approvalConfigurations/' + key).get(),
    rtdb.ref('approvalConfigurations/CBT_BANKPAYMENT').get(), rtdb.ref('approvalLevels/CBT_BANKPAYMENT').get()
  ]);
  const updates = { 'approvalMigrations/cbtFundTransfer': { DoneAt: new Date().toISOString(), CopiedFromBankPayment: !own.exists() && config.exists() } };
  if (!own.exists()) {
    if (config.exists()) updates['approvalConfigurations/' + key] = config.val();
    if (levels.exists()) updates['approvalLevels/' + key] = levels.val();
  }
  await rtdb.ref().update(updates);
}
const isCbtKey = key => Object.values(CBT_APPROVAL_KEYS).includes(key);

// Ported from resolveRequiredApprovalLevels_.
async function resolveRequiredApprovalLevels(moduleId, scopeKey, amount) {
  if (isCbtKey(moduleId)) await ensureCbtSplit();
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
  if (isCbtKey(moduleId)) await ensureCbtSplit();
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
// SelfApproved. configKey: the Approval Configuration entry to use when it
// isn't the module's own (a CBT voucher type); stored as ConfigKey.
async function beginApprovalInstance(moduleId, documentId, documentNumber, scopeKey, amount, createdBy, configKey) {
  // Every posting module calls this before it posts or sends for approval:
  // a document dated in a closed month stops here (docs/modules/PERIOD_CLOSING.md, decision 132).
  await require('./periodLock').assertDocumentOpen(moduleId, documentId, documentNumber);
  const levels = await resolveRequiredApprovalLevels(configKey || moduleId, scopeKey, amount);
  if (!levels.length) return { required: false };

  const now = new Date().toISOString();
  const newId = 'APR-' + randomUUID().split('-')[0].toUpperCase();
  await approvalInstances.set(newId, Object.assign({
    ModuleID: moduleId, DocumentID: documentId, DocumentNumber: documentNumber,
    ScopeKey: scopeKey, Amount: Number(amount) || 0, CreatedBy: createdBy,
    RequiredLevels: levels, Decisions: [], Status: 'Pending',
    CreatedAt: now, UpdatedAt: now
  }, configKey ? { ConfigKey: configKey } : {}));
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
  const instance = await approvalInstances.get(instanceId);
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

  await approvalInstances.update(instanceId, { Decisions: decisions, Status: newStatus, UpdatedAt: now });
  return { status: newStatus, selfApproved: newDecision.SelfApproved };
}

module.exports = { resolveRequiredApprovalLevels, resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision, ensureCbtSplit };
