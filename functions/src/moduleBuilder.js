// Module Builder, phase 1 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q461-Q469): the firm defines a module, saves it as a draft, previews it and
// publishes a version, which every corporate then has (Q467) where the
// module is switched on (Developer: modules of a corporate or a group).
// Corporate 100 only (Q461), BUILDER rights. New development, hand-written.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firm, HOME_ID, corporateId } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const B = require('./builtDefinitions');

const onCallOptions = { region: 'us-central1' };
const DEFS = () => firm.firestore.collection('moduleDefinitions');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };

async function requireBuilder(user, capability) {
  if (String(corporateId()) !== HOME_ID) throw new HttpsError('permission-denied', 'The Module Builder is the firm\'s (Corporate 100).');
  if (!(await moduleHasCapability('BUILDER', capability || 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have the right to ' + (capability === 'publish' ? 'publish modules' : capability === 'write' ? 'change modules' : 'open the Module Builder') + ' (Module Builder: ' + (capability || 'access') + ').');
  }
}
// The cleaner's own messages as the user's (it throws plain Errors).
function checked(fn) {
  try { return fn(); } catch (err) { if (err && err.code === 'invalid-argument') bad(err.message); throw err; }
}
const by = user => user.profile.username || user.uid;

// What a new version may not change of the one in use (Q467): its kind, and an
// existing field's type (its records keep their values; a removed field stays
// readable on them).
function compatible(next, prev) {
  if (!prev) return;
  if (next.kind !== prev.kind) bad('A published module stays a ' + prev.kind + '.');
  const types = (list, at) => list.forEach(f => {
    const was = (at === 'line' ? (prev.lines || {}).fields || [] : prev.fields).find(p => p.key === f.key);
    if (was && was.type !== f.type) bad((at === 'line' ? 'Line field' : 'Field') + ' "' + f.label + '" was ' + was.type + ': a published field keeps its type (add a new field instead).');
    if (was && was.type === 'link' && was.target !== f.target) bad('Field "' + f.label + '" links to ' + was.target + ': a published link keeps what it links to.');
  });
  types(next.fields, 'header');
  types((next.lines || {}).fields || [], 'line');
}

const publishedMasters = async () => (await B.refresh(true)).filter(d => d.kind === 'master').map(d => d.id);

// The list: every definition, its version and whether its draft differs.
exports.getModuleDefinitions = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'access');
  const snap = await DEFS().get();
  const list = snap.docs.map(d => {
    const x = d.data();
    const def = x.Draft || x.Published || {};
    return { id: d.id, label: def.label || d.id, kind: def.kind || '', version: x.Version || 0, publishedAt: x.PublishedAt || '', updatedAt: x.UpdatedAt || '',
      changed: Boolean(x.Published) && JSON.stringify(x.Draft) !== JSON.stringify(x.Published) };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return { definitions: list, masters: await publishedMasters(), types: B.TYPES, lineTypes: B.LINE_TYPES, linkTargets: B.LINK_TARGETS,
    rights: { write: await moduleHasCapability('BUILDER', 'write', user.profile.role), publish: await moduleHasCapability('BUILDER', 'publish', user.profile.role) } };
});

exports.getModuleDefinition = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'access');
  const id = text((request.data || {}).id, 33).toUpperCase();
  const s = await DEFS().doc(id || '-').get();
  if (!s.exists) throw new HttpsError('not-found', 'No such module.');
  const x = s.data();
  const versions = (await s.ref.collection('versions').get()).docs.map(v => ({ version: Number(v.id), publishedAt: v.data().PublishedAt, publishedBy: v.data().PublishedBy })).sort((a, b) => b.version - a.version);
  return { draft: x.Draft || null, published: x.Published || null, version: x.Version || 0, versions };
});

// Save the draft (checked as it would be published).
exports.saveModuleDefinitionDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'write');
  const masters = await publishedMasters();
  const def = checked(() => B.cleanDefinition((request.data || {}).definition, masters));
  const { MODULE_REGISTRY } = require('./moduleRegistry');
  if (MODULE_REGISTRY.some(m => m.id === def.id && !m.built)) bad('That id is a module of the ERP\'s own.');
  const ref = DEFS().doc(def.id);
  const s = await ref.get();
  if (!s.exists && (request.data || {}).isNew !== true) throw new HttpsError('not-found', 'No such module: create it first.');
  if (s.exists && (request.data || {}).isNew === true) bad('A module with the id ' + def.id + ' already exists.');
  compatible(def, s.exists ? s.data().Published : null);
  await ref.set({ Draft: def, UpdatedAt: new Date().toISOString(), UpdatedBy: by(user) }, { merge: true });
  return { success: true, id: def.id };
});

// Publish the draft as the next version, for every corporate (Q467).
exports.publishModuleDefinition = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'publish');
  const id = text((request.data || {}).id, 33).toUpperCase();
  const ref = DEFS().doc(id || '-');
  const s = await ref.get();
  if (!s.exists || !s.data().Draft) throw new HttpsError('not-found', 'No draft to publish.');
  const masters = await publishedMasters();
  const def = checked(() => B.cleanDefinition(s.data().Draft, masters));
  compatible(def, s.data().Published || null);
  const version = (s.data().Version || 0) + 1;
  const now = new Date().toISOString();
  await ref.collection('versions').doc(String(version)).set({ def, PublishedAt: now, PublishedBy: by(user) });
  await ref.set({ Published: Object.assign({}, def, { version }), Draft: def, Version: version, PublishedAt: now, PublishedBy: by(user) }, { merge: true });
  await B.refresh(true);
  return { success: true, version };
});

// A definition never published may be deleted (a published one stays: corporates' records name it).
exports.deleteModuleDefinitionDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireBuilder(user, 'write');
  const id = text((request.data || {}).id, 33).toUpperCase();
  const ref = DEFS().doc(id || '-');
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'No such module.');
  if (s.data().Published) throw new HttpsError('failed-precondition', 'A published module is not deleted: corporates\' records name it. Switch it off for them in the Developer screen instead.');
  await ref.delete();
  return { success: true };
});

module.exports = Object.assign(exports, { compatible });
