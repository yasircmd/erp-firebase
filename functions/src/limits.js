// Limits per corporate (owner, 2026-11-13; docs/modules/UX4.md item 2,
// Q501): the firm sets, in Client Management, the most Active companies and
// Active users a client corporate may have (MaxCompanies, MaxUsers on its
// directory entry; blank: no limit). Adding one more Active company or user
// at the limit, or making an inactive one Active again, is refused, with a
// message to contact the provider. Inactive ones don't count; nothing
// already there is switched off. Corporate 100 has no limit.
// New development, hand-written.
'use strict';
const { rtdb, corporateEntry } = require('./firebaseAdmin');

const KINDS = Object.freeze({
  company: { max: 'MaxCompanies', path: 'companies', status: 'Status', label: 'companies' },
  user: { max: 'MaxUsers', path: 'users', status: 'status', label: 'users' }
});

// The limit set for a kind on a directory entry, or 0 (none).
function limitOf(entry, kind) {
  const n = Number(entry && entry[KINDS[kind].max]);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Throws Error when saving record `id` (blank: a new one) of `kind` with
// `status` would take the corporate over its limit.
async function assertRoom(kind, id, status) {
  const k = KINDS[kind];
  if (!k || String(status || '') !== 'Active') return;
  const max = limitOf(corporateEntry(), kind);
  if (!max) return;
  const all = (await rtdb.ref(k.path).get()).val() || {};
  const key = String(id || '');
  if (key && all[key] && all[key][k.status] === 'Active') return; // already counted
  const active = Object.keys(all).filter(x => all[x] && all[x][k.status] === 'Active').length;
  if (active >= max) {
    throw new Error('Your subscription allows ' + max + ' active ' + k.label + ', and all are in use. Make one inactive, or contact your provider to raise the limit.');
  }
}

module.exports = { KINDS, limitOf, assertRoom };
