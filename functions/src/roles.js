const { rtdb } = require('./firebaseAdmin');

// Extracted verbatim from Code.gs.
const DEFAULT_ROLES = [
  { id: 'ADMIN', name: 'ADMIN', description: 'Full administrative access to every module.' },
  { id: 'FINANCE_MGR', name: 'FINANCE_MGR', description: 'Can post and approve financial entries.' },
  { id: 'ACCOUNTANT', name: 'ACCOUNTANT', description: 'Can create and edit draft entries; cannot post.' },
  { id: 'VIEWER', name: 'VIEWER', description: 'Read-only access.' }
];

// Ported from ensureRolesSeeded_ — identical lazy-seed behavior.
async function ensureRolesSeeded() {
  const snap = await rtdb.ref('roles').get();
  const existing = snap.val() || {};
  if (Object.keys(existing).length) return existing;

  const now = new Date().toISOString();
  const seeded = {};
  DEFAULT_ROLES.forEach(r => {
    seeded[r.id] = { Name: r.name, Description: r.description, CreatedAt: now, CreatedBy: 'SYSTEM', UpdatedAt: now, UpdatedBy: 'SYSTEM' };
  });

  try {
    await rtdb.ref('roles').set(seeded);
  } catch (err) {
    // Read-only caller — proceed with in-memory defaults; a writer's
    // next visit will persist them.
  }
  return seeded;
}

module.exports = { DEFAULT_ROLES, ensureRolesSeeded };
