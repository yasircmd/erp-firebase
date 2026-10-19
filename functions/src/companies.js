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
exports.getActiveCompanies = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const snap = await rtdb.ref('companies').get();
  const data = snap.val() || {};
  const assigned = getUserAssignedCompanies(user.profile);

  return Object.keys(data)
    .filter(id => data[id].Status === 'Active')
    .filter(id => assigned.includes(id))
    .map(id => ({
      CompanyID: id, LegalName: data[id].LegalName,
      CompanyRefCode: data[id].CompanyRefCode || '',
      AddressLine1: data[id].AddressLine1 || '', AddressLine2: data[id].AddressLine2 || '',
      TaxNumbers: data[id].TaxNumbers || []
    }));
});

module.exports.getUserAssignedCompanies = getUserAssignedCompanies;
