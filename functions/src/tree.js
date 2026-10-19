const { randomUUID } = require('crypto');
const { rtdb } = require('./firebaseAdmin');
const { TREE_SEED_NODES } = require('./treeSeedNodes');

// Ported from ensureTreeSeeded_. Utilities.getUuid() (GAS) becomes
// crypto.randomUUID() (Node's own built-in, no dependency needed) —
// same "take the first hyphen-delimited segment, uppercase it" shape
// for the node id prefix, to keep ids visually consistent with
// whatever's already in the live tree from the old system.
async function ensureTreeSeeded() {
  const snap = await rtdb.ref('tree').get();
  const existing = snap.val();
  if (existing && Object.keys(existing).length) return existing;

  const records = {};
  const stack = [];
  let order = 0;
  const now = new Date().toISOString();

  TREE_SEED_NODES.forEach(node => {
    const nodeId = 'NODE-' + randomUUID().split('-')[0].toUpperCase();
    const parentId = node.depth > 0 ? (stack[node.depth - 1] || '') : '';
    const allowedRoles = ['USERMGMT', 'TREEMGMT', 'ROLES'].includes(node.moduleId)
      ? ['ADMIN']
      : ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'];

    records[nodeId] = {
      Text: node.text,
      ParentID: parentId,
      Order: order++,
      ModuleID: node.moduleId || '',
      AllowedRoles: allowedRoles,
      CreatedAt: now, CreatedBy: 'SYSTEM',
      UpdatedAt: now, UpdatedBy: 'SYSTEM'
    };
    stack[node.depth] = nodeId;
    stack.length = node.depth + 1;
  });

  try {
    await rtdb.ref('tree').set(records);
  } catch (err) {
    // Read-only caller (or a transient write failure) — proceed with
    // the in-memory seed for this call only, same as the original.
  }
  return records;
}

// Ported from buildVisibleTreeList_ — identical depth-first flatten,
// visible only if the node AND every ancestor allow the role.
function buildVisibleTreeList(nodesById, roleId) {
  const childrenByParent = {};
  Object.keys(nodesById).forEach(id => {
    const parent = nodesById[id].ParentID || '';
    if (!childrenByParent[parent]) childrenByParent[parent] = [];
    childrenByParent[parent].push(id);
  });
  Object.keys(childrenByParent).forEach(parent => {
    childrenByParent[parent].sort((a, b) => (nodesById[a].Order || 0) - (nodesById[b].Order || 0));
  });

  const result = [];
  function walk(parentId, depth, ancestorVisible) {
    (childrenByParent[parentId] || []).forEach(id => {
      const node = nodesById[id];
      const ownAllowed = (node.AllowedRoles || []).includes(roleId);
      const visible = ancestorVisible && ownAllowed;
      if (visible) {
        result.push({ text: node.Text, depth: depth, moduleId: node.ModuleID || '' });
      }
      walk(id, depth + 1, visible);
    });
  }
  walk('', 0, true);
  return result;
}

// A module the corporate may not use is left out of its tree
// (entitlements.js), with anything under it.
async function buildTreeForRole(roleId) {
  const { moduleAvailable } = require('./entitlements');
  const all = await ensureTreeSeeded();
  const nodes = {};
  Object.keys(all).forEach(id => { if (!all[id].ModuleID || moduleAvailable(all[id].ModuleID)) nodes[id] = all[id]; });
  return buildVisibleTreeList(nodes, roleId);
}

module.exports = { ensureTreeSeeded, buildVisibleTreeList, buildTreeForRole };
