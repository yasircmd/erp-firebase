// Who sees which Purchase Requisitions (owner, 2026-10-02;
// docs/modules/PR_VISIBILITY.md). Within the companies a user may access,
// they see a requisition if they:
//   - raised it (RequestedBy / CreatedBy: their username or uid);
//   - approve it: they are, or were, the approver of one of its levels
//     (a delegated level included, and a level they already decided), on
//     any of its approval records (a resubmission starts a new one);
//   - are in the Procurement follow-up team for its scope (Approval
//     Configuration), as their Home tasks are, once it is no longer a
//     draft.
// Admins see all. The list and every requisition action use this, so a
// requisition can't be opened or acted on by its id either.
// Inventory Purchase Requisition is not affected (owner: Sales only).
const { rtdb } = require('./firebaseAdmin');
const { userCanAccessCompany } = require('./glWriting');
const { scopeKeyFor } = require('./followUps');

const MODULE_ID = 'PURCHASEREQUISITION';
const isAdmin = profile => /^admin$/i.test(String(profile && profile.role || ''));

// Everything the rule needs, read once: returns canSee(pr) for one user.
// `pr` needs its PRID (the list adds it), or pass the id as the second
// argument.
async function visibilityFor(user) {
  const profile = user.profile || {};
  if (isAdmin(profile)) return pr => Boolean(pr) && userCanAccessCompany(profile, pr.CompanyID);
  const [config, teams, instances] = (await Promise.all([
    rtdb.ref('approvalConfigurations/' + MODULE_ID).get(),
    rtdb.ref('approvalFollowUps/' + MODULE_ID).get(),
    require('./approvalStore').approvalInstances.query({ ModuleID: MODULE_ID }).then(v => ({ val: () => v })) // this module's (approvalStore.js)
  ])).map(s => s.val() || {});
  const me = new Set([user.uid, profile.username].filter(Boolean).map(String));
  // Requisition id -> approvers on any of its approval records.
  const approversOf = {};
  Object.values(instances).forEach(inst => {
    if (!inst || inst.ModuleID !== MODULE_ID || !inst.DocumentID) return;
    const set = approversOf[inst.DocumentID] || (approversOf[inst.DocumentID] = new Set());
    (inst.RequiredLevels || []).concat(inst.Decisions || []).forEach(l => { if (l && l.ApproverUserID) set.add(String(l.ApproverUserID)); });
    // An approver a level was delegated away from keeps sight of it too.
    (inst.Delegations || []).forEach(d => { if (d && d.FromUserID) set.add(String(d.FromUserID)); });
  });
  const inTeam = pr => {
    const key = scopeKeyFor(config.ScopeType, pr);
    return Boolean(key) && ((teams[key] || {}).UserIDs || []).map(String).includes(String(user.uid));
  };
  return (pr, prId) => {
    if (!pr || !userCanAccessCompany(profile, pr.CompanyID)) return false;
    if (me.has(String(pr.RequestedBy || '')) || me.has(String(pr.CreatedBy || ''))) return true;
    if ((approversOf[prId || pr.PRID] || new Set()).has(String(user.uid))) return true;
    // Drafts stay with whoever drafted them (owner, 2026-10-02): the team
    // sees a requisition once it is submitted.
    return pr.Status !== 'Draft' && inTeam(pr);
  };
}

// For one requisition (the actions): may this user see it?
async function canSeeRequisition(user, prId, pr) {
  return (await visibilityFor(user))(pr, prId);
}

module.exports = { visibilityFor, canSeeRequisition };
