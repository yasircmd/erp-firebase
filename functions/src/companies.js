const { HttpsError } = require('firebase-functions/v2/https');
const { onCallInCorporate } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser } = require('./auth');

const onCallOptions = { region: 'us-central1' };

// Ported from getUserAssignedCompanies_.
function getUserAssignedCompanies(profile) {
  return Array.isArray(profile.AssignedCompanies) ? profile.AssignedCompanies : [];
}

// Ported from getActiveCompanies — used by the shell's own
// loadMainCompanyName(), missed in the first port pass (it's called
// from onAuthResponse's own call chain, not a call site that showed up
// in the original 10-call-site sweep of Index.html directly — worth
// noting as exactly the kind of thing a second, careful pass over the
// actual running code catches that a static call-site grep alone can
// miss).
// Chosen: in the user's company filter at the top (owner, 2026-10-24,
// decision 273). A filter among their own companies, not rights: the
// screens default to the chosen ones. None saved, or none still theirs:
// all of them.
async function activeAssigned(user) {
  const data = (await rtdb.ref('companies').get()).val() || {};
  const assigned = getUserAssignedCompanies(user.profile);
  return { data, ids: Object.keys(data).filter(id => data[id].Status === 'Active' && assigned.includes(id)) };
}

exports.getActiveCompanies = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const [{ data, ids }, saved] = await Promise.all([activeAssigned(user), rtdb.ref('userPreferences/' + user.uid + '/Companies').get()]);
  const chosen = (saved.val() || []).filter(id => ids.includes(id));

  return ids
    .map(id => ({
      Chosen: !chosen.length || chosen.includes(id),
      CompanyID: id, LegalName: data[id].LegalName,
      CompanyRefCode: data[id].CompanyRefCode || '',
      AddressLine1: data[id].AddressLine1 || '', AddressLine2: data[id].AddressLine2 || '',
      TaxNumbers: data[id].TaxNumbers || []
    }));
});

// Saved with the user, for the next sign-in on any device; all of them
// (or none) clears it.
exports.saveMyCompanies = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const { ids } = await activeAssigned(user);
  const chosen = [...new Set((Array.isArray(request.data && request.data.companyIds) ? request.data.companyIds : []).map(x => String(x || '').trim()).filter(Boolean))];
  const other = chosen.find(id => !ids.includes(id));
  if (other) throw new HttpsError('invalid-argument', 'Not one of your companies: ' + other);
  const all = !chosen.length || chosen.length === ids.length;
  await rtdb.ref('userPreferences/' + user.uid + '/Companies').set(all ? null : chosen);
  return { companyIds: all ? ids : chosen };
});

module.exports.getUserAssignedCompanies = getUserAssignedCompanies;
