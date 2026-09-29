// Follow-up teams (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md).
// Per module and scope, the users who act next once a document is ready:
// Production on an accepted Sales Job Order line, Procurement on a
// submitted Purchase / Inventory Purchase Requisition. Set in Approval
// Configuration, beside the approval levels, and used whether or not
// approval itself is enabled. Their Home tasks come from the documents'
// current status (getMyFollowUpTasksForUser), so nothing is stored per task.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { MODULE_REGISTRY } = require('./moduleRegistry');

const onCallOptions = { region: 'us-central1' };

const FOLLOW_UP_MODULES = [
  { ModuleID: 'JOBORDERREQUEST', Team: 'Production', When: 'A Sales Job Order line is accepted, until its first production entry or it is stopped.' },
  { ModuleID: 'PURCHASEREQUISITION', Team: 'Procurement', When: 'A requisition is submitted (approved), until a Purchase Order from it is submitted or it is closed.' },
  { ModuleID: 'INVENTORYPURCHASEREQUISITION', Team: 'Procurement', When: 'A requisition is submitted (approved), until a Purchase Order from it is submitted or it is closed.' }
];
const isFollowUpModule = id => FOLLOW_UP_MODULES.some(m => m.ModuleID === id);
const labelOf = id => (MODULE_REGISTRY.find(m => m.id === id) || {}).label || id;

// The scope key a document falls under, from the module's ScopeType, as the
// approval levels do (approvals.js resolveApprovalScopeKeyForDocument).
function scopeKeyFor(scopeType, d) {
  switch (scopeType) {
    case 'Global': return 'GLOBAL';
    case 'Company': return d.CompanyID || '';
    case 'Division': return d.DivisionID || '';
    case 'Branch': return d.BranchID || '';
    case 'CostCenter': return d.CostCenterID || '';
    default: return '';
  }
}

async function requireConfigCap(user, capability) {
  if (!(await moduleHasCapability('APPROVALCONFIG', capability, user.profile.role))) {
    throw new HttpsError('permission-denied', capability === 'write'
      ? 'You do not have permission to modify Approval Configuration.'
      : 'You do not have access to Approval Configuration.');
  }
}

exports.getFollowUpTeams = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireConfigCap(user, 'access');
  const moduleId = String(request.data && request.data.moduleId || '').trim();
  if (!moduleId) return { modules: FOLLOW_UP_MODULES.map(m => Object.assign({ Label: labelOf(m.ModuleID) }, m)) };
  if (!isFollowUpModule(moduleId)) return { teams: [] };
  const data = (await rtdb.ref('approvalFollowUps/' + moduleId).get()).val() || {};
  return {
    teams: Object.keys(data).map(scopeKey => ({
      ScopeKey: scopeKey, UserIDs: data[scopeKey].UserIDs || [], UpdatedAt: data[scopeKey].UpdatedAt || '', UpdatedBy: data[scopeKey].UpdatedBy || ''
    }))
  };
});

exports.saveFollowUpTeam = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireConfigCap(user, 'write');
  const d = request.data || {};
  const moduleId = String(d.moduleId || '').trim();
  if (!isFollowUpModule(moduleId)) throw new HttpsError('invalid-argument', 'This module has no follow-up team.');
  const config = (await rtdb.ref('approvalConfigurations/' + moduleId).get()).val();
  if (!config) throw new HttpsError('failed-precondition', 'Save this module\'s settings (its scope) before setting a follow-up team.');
  const scopeKey = String(d.scopeKey || '').trim();
  if (!scopeKey) throw new HttpsError('invalid-argument', 'Select a scope.');
  if (config.ScopeType === 'Global') {
    if (scopeKey !== 'GLOBAL') throw new HttpsError('invalid-argument', 'A Globally-scoped module only has one configuration.');
  } else if (config.ScopeType === 'Company') {
    if (!(await rtdb.ref('companies/' + scopeKey).get()).exists()) throw new HttpsError('invalid-argument', 'Unknown Company.');
  } else {
    const unit = (await rtdb.ref('orgUnits/' + scopeKey).get()).val();
    if (!unit || unit.Type !== config.ScopeType) throw new HttpsError('invalid-argument', 'Unknown ' + config.ScopeType + '.');
  }
  const users = (await rtdb.ref('users').get()).val() || {};
  const userIds = [...new Set((Array.isArray(d.userIds) ? d.userIds : []).map(u => String(u || '').trim()).filter(Boolean))];
  userIds.forEach(u => {
    if (!users[u] || users[u].status !== 'Active') throw new HttpsError('invalid-argument', 'Select only active users.');
  });
  const ref = rtdb.ref('approvalFollowUps/' + moduleId + '/' + scopeKey);
  if (!userIds.length) { await ref.remove(); return { success: true }; }
  await ref.set({ UserIDs: userIds, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

// Home: the documents ready for this user's team to act on.
exports.getMyFollowUpTasksForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const [configs, teams] = (await Promise.all([rtdb.ref('approvalConfigurations').get(), rtdb.ref('approvalFollowUps').get()])).map(s => s.val() || {});
  const scopeTypeOf = m => (configs[m] || {}).ScopeType;
  const inTeam = (m, dims) => {
    const key = scopeKeyFor(scopeTypeOf(m), dims);
    return Boolean(key) && ((((teams[m] || {})[key]) || {}).UserIDs || []).includes(user.uid);
  };
  const mine = FOLLOW_UP_MODULES.filter(m => teams[m.ModuleID]);
  const access = await Promise.all(mine.map(m => moduleHasCapability(m.ModuleID, 'access', user.profile.role)));
  const modules = new Set(mine.filter((m, i) => access[i]).map(m => m.ModuleID));
  const tasks = [];
  const canSee = d => userCanAccessCompany(user.profile, d.CompanyID);

  for (const [moduleId, path, numberField, dateField] of [
    ['PURCHASEREQUISITION', 'purchaseRequisitions', 'PRNumber', 'PRDate'],
    ['INVENTORYPURCHASEREQUISITION', 'inventoryPurchaseRequisitions', 'IPRNumber', 'IPRDate']
  ]) {
    if (!modules.has(moduleId)) continue;
    const data = (await rtdb.ref(path).get()).val() || {};
    Object.keys(data).forEach(id => {
      const r = data[id];
      if (!r || r.Status !== 'Submitted' || !canSee(r) || !inTeam(moduleId, r)) return;
      tasks.push({ ModuleID: moduleId, ModuleLabel: labelOf(moduleId), DocumentID: id, DocumentNumber: r[numberField] || '',
        Description: r.Description || '', DocumentDate: r[dateField] || '', ReadySince: r.SubmittedAt || r.UpdatedAt || '' });
    });
  }

  if (modules.has('JOBORDERREQUEST')) {
    const [lines, batches] = (await Promise.all([rtdb.ref('jobOrderLines').get(), rtdb.ref('jobOrderBatches').get()])).map(s => s.val() || {});
    Object.keys(lines).forEach(id => {
      const l = lines[id];
      const b = l && batches[l.ParentBatchID];
      // Only Sales lines are ever Accepted (Production's own start Open).
      if (!l || l.Status !== 'Accepted' || !b || !canSee(b) || !inTeam('JOBORDERREQUEST', b)) return;
      tasks.push({ ModuleID: 'JOBORDERREQUEST', ModuleLabel: labelOf('JOBORDERREQUEST'), DocumentID: id, DocumentNumber: l.SubJONumber || '',
        Description: [l.ItemCode, l.OrderedQuantity != null ? '× ' + l.OrderedQuantity : ''].filter(Boolean).join(' '),
        DocumentDate: l.TargetDate || '', ReadySince: l.AcceptedAt || l.UpdatedAt || '' });
    });
  }
  return tasks.sort((a, b) => (a.ReadySince || '').localeCompare(b.ReadySince || ''));
});

module.exports.FOLLOW_UP_MODULES = FOLLOW_UP_MODULES;
