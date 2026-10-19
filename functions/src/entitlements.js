// Which modules the current corporate may use (docs/modules/
// MULTI_CORPORATE.md, M2; owner, 2026-10-19, decision 250). New
// development, hand-written.
//
// The firm ticks a client corporate's modules in the Developer screen; they
// are kept in its directory entry (Modules: { MODULEID: false } for one
// switched off; a module not listed is on, so a new corporate starts with
// every module). The client's own Admin then gives rights only within
// that, in Roles as before. A module switched off is not in the
// corporate's tree, Roles or Tree Management, and moduleHasCapability
// refuses it (so getModuleFragment and every function that checks it do
// too); its data stays where it is.
//
// Corporate 100 has every module. A homeOnly module (Developer) is never
// any other corporate's, whatever its entry or roles say.
'use strict';
const { MODULE_REGISTRY } = require('./moduleRegistry');
const { HOME_ID, corporateId, corporateEntry } = require('./firebaseAdmin');

const byId = id => MODULE_REGISTRY.find(m => m.id === id);

// For a corporate's entry (its id; null entry: none set yet).
function availableIn(id, entry, moduleId) {
  // Corporate 100 as before: nothing is taken away (a tree node naming a
  // module no longer registered still shows, as it always did).
  if (String(id) === HOME_ID) return true;
  const m = byId(moduleId);
  if (!m) return false;
  if (m.homeOnly) return false;
  const modules = (entry && entry.Modules) || {};
  return modules[moduleId] !== false;
}

const moduleAvailable = moduleId => availableIn(corporateId(), corporateEntry(), moduleId);
const availableModules = () => MODULE_REGISTRY.filter(m => moduleAvailable(m.id));

module.exports = { availableIn, moduleAvailable, availableModules };
