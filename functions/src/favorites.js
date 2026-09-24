const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { rtdb } = require('./firebaseAdmin');
const { requireUser } = require('./auth');

const onCallOptions = { region: 'us-central1' };

exports.getMyFavorites = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const snap = await rtdb.ref('userFavorites/' + user.uid).get();
  return snap.val() || [];
});

exports.toggleFavorite = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const moduleId = String(request.data && request.data.moduleId || '').trim();
  const moduleLabel = request.data && request.data.moduleLabel;
  if (!moduleId) throw new HttpsError('invalid-argument', 'No module specified.');

  const ref = rtdb.ref('userFavorites/' + user.uid);
  const snap = await ref.get();
  const favorites = snap.val() || [];
  const existingIndex = favorites.findIndex(f => f.moduleId === moduleId);

  if (existingIndex !== -1) {
    favorites.splice(existingIndex, 1);
  } else {
    if (favorites.length >= 5) throw new HttpsError('failed-precondition', 'You can have at most 5 favorite modules — remove one first.');
    favorites.push({ moduleId: moduleId, label: String(moduleLabel || moduleId).trim() });
  }

  await ref.set(favorites);
  return { favorites: favorites };
});
