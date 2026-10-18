// Approval delegation (owner, 2026-09-29; docs/modules/APPROVAL_DELEGATION.md).
// From the Approval Tracker, an Admin (any pending approval) or an approver
// (their own) hands an undecided level of a pending approval to another
// person, with a reason: one approval, or every pending approval waiting
// on an absent approver. Only the level's ApproverUserID changes, so the
// approve / reject check, Home tasks, the screens' banners and the
// Tracker all follow; each delegation is kept on the approval
// (Delegations) with who, from, to, when and why. Approval Configuration
// is not changed: documents submitted later still go to the configured
// approver.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { approvalInstances } = require('./approvalStore');
const movedPaths = require('./movedPaths');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { APPROVAL_MODULE_STORAGE_, approvalLabelOf } = require('./approvalRegistry');

const onCallOptions = { region: 'us-central1' };

const isAdmin = profile => /^admin$/i.test(String(profile && profile.role || ''));
const nameOf = (users, uid) => (users[uid] && (users[uid].fullName || users[uid].username)) || uid;

async function requireTrackerAccess(user) {
  if (!(await moduleHasCapability('APPROVALTRACKER', 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to Approval Tracker.');
  }
}

// The document an approval is for, to find its company (a Job Order line
// carries it on its batch). '' when unknown: no company restriction.
async function companyOfApproval(inst) {
  const storage = APPROVAL_MODULE_STORAGE_[inst.ModuleID];
  if (!storage || !inst.DocumentID) return '';
  const doc = storage.type === 'firestore'
    ? (d => (d.exists ? d.data() : null))(await firestore.collection(storage.collection).doc(inst.DocumentID).get())
    : movedPaths.storeOf(storage.path) ? await movedPaths.storeOf(storage.path).get(inst.DocumentID)
    : (await rtdb.ref(storage.path + '/' + inst.DocumentID).get()).val();
  if (!doc) return '';
  if (doc.CompanyID) return doc.CompanyID;
  if (doc.ParentBatchID) return ((await require('./jobStore').jobOrderBatches.get(doc.ParentBatchID)) || {}).CompanyID || '';
  return '';
}

// Why `toUserId` can't take this level of this approval, or '' if they can.
async function whyNotEligible(inst, levelNumber, toUserId, users, companyId) {
  const to = users[toUserId];
  if (!to) return 'That user was not found.';
  if (to.status !== 'Active') return nameOf(users, toUserId) + ' is not an active user.';
  const level = (inst.RequiredLevels || []).find(l => l.LevelNumber === levelNumber);
  if (level && level.ApproverUserID === toUserId) return nameOf(users, toUserId) + ' is already the approver of this level.';
  const onOtherLevel = (inst.RequiredLevels || []).some(l => l.LevelNumber !== levelNumber && l.ApproverUserID === toUserId) ||
    (inst.Decisions || []).some(d => d.LevelNumber !== levelNumber && d.ApproverUserID === toUserId);
  if (onOtherLevel) return nameOf(users, toUserId) + ' already approves another level of this document.';
  if (!(await moduleHasCapability(inst.ModuleID, 'access', to.role))) return nameOf(users, toUserId) + ' has no access to ' + approvalLabelOf(inst) + '.';
  if (!userCanAccessCompany(to, companyId)) return nameOf(users, toUserId) + ' has no access to this document\'s company.';
  return '';
}

// Why `user` can't delegate this level, or '' if they can.
function whyCannotDelegate(user, inst, levelNumber) {
  if (!inst) return 'Approval record not found.';
  if (inst.Status !== 'Pending') return 'This document has already been ' + String(inst.Status || '').toLowerCase() + '.';
  const level = (inst.RequiredLevels || []).find(l => l.LevelNumber === levelNumber);
  if (!level) return 'That approval level does not apply to this document.';
  if ((inst.Decisions || []).some(d => d.LevelNumber === levelNumber)) return 'This level has already recorded a decision.';
  if (!isAdmin(user.profile) && level.ApproverUserID !== user.uid) return 'Only an Admin or this level\'s approver can delegate it.';
  return '';
}

// Moves one level, re-checking inside a transaction that nothing changed
// meanwhile (a decision, or another delegation). Returns the new record.
async function moveLevel(user, users, instanceId, levelNumber, toUserId, reason) {
  let refusal = '';
  let fromUserId = '';
  const result = await approvalInstances.transact(instanceId, inst => {
    if (!inst) return inst;
    refusal = whyCannotDelegate(user, inst, levelNumber);
    if (refusal) return; // abort
    const levels = inst.RequiredLevels.map(l => Object.assign({}, l));
    const level = levels.find(l => l.LevelNumber === levelNumber);
    fromUserId = level.ApproverUserID;
    level.ApproverUserID = toUserId;
    const now = new Date().toISOString();
    inst.RequiredLevels = levels;
    inst.Delegations = (inst.Delegations || []).concat([{
      LevelNumber: levelNumber, FromUserID: fromUserId, FromName: nameOf(users, fromUserId),
      ToUserID: toUserId, ToName: nameOf(users, toUserId), By: user.uid, ByName: nameOf(users, user.uid),
      At: now, Reason: reason
    }]);
    inst.UpdatedAt = now;
    return inst;
  });
  if (!result.committed) throw new HttpsError('failed-precondition', refusal || 'Approval record not found.');
  return { fromUserId, instance: result.snapshot.val() };
}

function requireReason(d) {
  const reason = String(d.reason || '').trim();
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for delegating (e.g. "On annual leave").');
  return reason;
}

// Who the level can go to: for the picker (one approval), or every active
// user (all of an approver's, where each approval is checked as it moves).
exports.getDelegationCandidates = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireTrackerAccess(user);
  const d = request.data || {};
  const users = (await rtdb.ref('users').get()).val() || {};
  const active = Object.keys(users).filter(uid => users[uid].status === 'Active')
    .map(uid => ({ UserID: uid, FullName: users[uid].fullName || users[uid].username || uid }))
    .sort((a, b) => a.FullName.localeCompare(b.FullName));
  const context = { UserID: user.uid, IsAdmin: isAdmin(user.profile) };
  if (!d.instanceId) return Object.assign(context, { users: active });
  const levelNumber = Number(d.levelNumber);
  const inst = await approvalInstances.get(d.instanceId);
  const why = whyCannotDelegate(user, inst, levelNumber);
  if (why) throw new HttpsError('failed-precondition', why);
  const companyId = await companyOfApproval(inst);
  const eligible = [];
  for (const u of active) if (!(await whyNotEligible(inst, levelNumber, u.UserID, users, companyId))) eligible.push(u);
  return Object.assign(context, { users: eligible });
});

exports.delegateApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireTrackerAccess(user);
  const d = request.data || {};
  const reason = requireReason(d);
  const instanceId = String(d.instanceId || '');
  const levelNumber = Number(d.levelNumber);
  const toUserId = String(d.toUserId || '').trim();
  if (!toUserId) throw new HttpsError('invalid-argument', 'Select who to delegate to.');
  const inst = await approvalInstances.get(instanceId);
  const why = whyCannotDelegate(user, inst, levelNumber);
  if (why) throw new HttpsError('failed-precondition', why);
  const users = (await rtdb.ref('users').get()).val() || {};
  const notEligible = await whyNotEligible(inst, levelNumber, toUserId, users, await companyOfApproval(inst));
  if (notEligible) throw new HttpsError('failed-precondition', notEligible);
  await moveLevel(user, users, instanceId, levelNumber, toUserId, reason);
  return { success: true, delegatedTo: nameOf(users, toUserId) };
});

// Every pending approval currently waiting on `fromUserId` (an approver:
// themselves only). Each is checked on its own; the ones that can't move
// are listed with why.
exports.delegateApprovalsOf = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireTrackerAccess(user);
  const d = request.data || {};
  const reason = requireReason(d);
  const fromUserId = String(d.fromUserId || '').trim() || user.uid;
  const toUserId = String(d.toUserId || '').trim();
  if (!isAdmin(user.profile) && fromUserId !== user.uid) throw new HttpsError('permission-denied', 'You can only delegate your own approvals.');
  if (!toUserId) throw new HttpsError('invalid-argument', 'Select who to delegate to.');
  if (toUserId === fromUserId) throw new HttpsError('invalid-argument', 'Choose someone other than the absent approver.');
  const users = (await rtdb.ref('users').get()).val() || {};
  const all = await approvalInstances.query({ Status: 'Pending' }); // the pending ones (approvalStore.js)
  const moved = [];
  const skipped = [];
  for (const instanceId of Object.keys(all)) {
    const inst = all[instanceId];
    if (inst.Status !== 'Pending') continue;
    const decided = new Set((inst.Decisions || []).map(x => x.LevelNumber));
    const levels = (inst.RequiredLevels || []).filter(l => l.ApproverUserID === fromUserId && !decided.has(l.LevelNumber));
    for (const level of levels) {
      const label = approvalLabelOf(inst) + ' ' + (inst.DocumentNumber || inst.DocumentID) + ', level ' + level.LevelNumber;
      const why = await whyNotEligible(inst, level.LevelNumber, toUserId, users, await companyOfApproval(inst));
      if (why) { skipped.push({ InstanceID: instanceId, LevelNumber: level.LevelNumber, Document: label, Reason: why }); continue; }
      try {
        await moveLevel(user, users, instanceId, level.LevelNumber, toUserId, reason);
        moved.push({ InstanceID: instanceId, LevelNumber: level.LevelNumber, Document: label });
      } catch (e) {
        skipped.push({ InstanceID: instanceId, LevelNumber: level.LevelNumber, Document: label, Reason: e.message });
      }
    }
  }
  return { success: true, delegatedTo: nameOf(users, toUserId), moved, skipped };
});

module.exports.isAdminProfile = isAdmin;
