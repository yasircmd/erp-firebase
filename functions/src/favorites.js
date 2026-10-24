const { HttpsError } = require('firebase-functions/v2/https');
const { onCallInCorporate } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { MODULE_REGISTRY } = require('./moduleRegistry');

const onCallOptions = { region: 'us-central1' };
const MAX = 5;

// Default favourites per role (owner, 2026-10-24, decision 270): up to 5,
// set in Roles & Permissions; a user with no favourites of their own sees
// their role's, limited to the modules they may open. The first change makes
// the list their own (userPreferences/{uid}/OwnFavorites), so removing every
// one doesn't bring the role's back.
async function roleDefaults(user) {
  const list = (await rtdb.ref('roleFavorites/' + user.profile.role).get()).val() || [];
  const allowed = await Promise.all(list.map(f => moduleHasCapability(f.moduleId, 'access', user.profile.role)));
  return list.filter((f, i) => allowed[i]);
}
async function favoritesOf(user) {
  const [own, prefs] = await Promise.all([rtdb.ref('userFavorites/' + user.uid).get(), rtdb.ref('userPreferences/' + user.uid + '/OwnFavorites').get()]);
  if (own.val() || prefs.val()) return own.val() || [];
  return roleDefaults(user);
}

exports.getMyFavorites = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  return favoritesOf(user);
});

exports.toggleFavorite = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const moduleId = String(request.data && request.data.moduleId || '').trim();
  const moduleLabel = request.data && request.data.moduleLabel;
  if (!moduleId) throw new HttpsError('invalid-argument', 'No module specified.');

  const ref = rtdb.ref('userFavorites/' + user.uid);
  const favorites = await favoritesOf(user); // the role's, the first time
  const existingIndex = favorites.findIndex(f => f.moduleId === moduleId);

  if (existingIndex !== -1) {
    favorites.splice(existingIndex, 1);
  } else {
    if (favorites.length >= MAX) throw new HttpsError('failed-precondition', 'You can have at most 5 favorite modules — remove one first.');
    favorites.push({ moduleId: moduleId, label: String(moduleLabel || moduleId).trim() });
  }

  await ref.set(favorites);
  await rtdb.ref('userPreferences/' + user.uid + '/OwnFavorites').set(true);
  return { favorites: favorites };
});

// The light / dark theme, saved with the user (owner, 2026-10-24, decision
// 272): userPreferences/{uid}, apart from the profile User Management saves.
exports.saveMyTheme = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const theme = String(request.data && request.data.theme || '');
  if (theme !== 'light' && theme !== 'dark') throw new HttpsError('invalid-argument', 'The theme is light or dark.');
  await rtdb.ref('userPreferences/' + user.uid + '/Theme').set(theme);
  return { theme };
});

// Roles & Permissions: each role's default favourites.
exports.getRoleFavorites = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('ROLES', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Roles & Permissions.');
  return (await rtdb.ref('roleFavorites').get()).val() || {};
});
exports.saveRoleFavorites = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('ROLES', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change Roles & Permissions.');
  const d = request.data || {};
  const roleId = String(d.roleId || '').trim();
  if (!roleId || !(await rtdb.ref('roles/' + roleId).get()).exists()) throw new HttpsError('not-found', 'Role not found.');
  const ids = [...new Set((Array.isArray(d.moduleIds) ? d.moduleIds : []).map(x => String(x || '').trim()).filter(Boolean))];
  if (ids.length > MAX) throw new HttpsError('invalid-argument', 'At most ' + MAX + ' default favourites.');
  const list = ids.map(id => {
    const m = MODULE_REGISTRY.find(x => x.id === id);
    if (!m) throw new HttpsError('invalid-argument', 'Unknown module: ' + id);
    return { moduleId: m.id, label: m.label };
  });
  await rtdb.ref('roleFavorites/' + roleId).set(list.length ? list : null);
  return { roleId, favorites: list };
});
