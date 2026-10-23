// Which modules the current corporate may use (docs/modules/
// MULTI_CORPORATE.md, M2; owner, 2026-10-19, decision 250). New
// development, hand-written.
//
// The firm ticks a client corporate's modules in the Developer screen; they
// are kept in its directory entry (Modules: { MODULEID: true | false }):
// - a module of the baseline (moduleBaseline.js: those there were when
//   client groups came in, M4) is on unless set false, so a new corporate
//   starts with every one of them;
// - a module added after that is off unless set true: the firm provides it
//   to groups of corporates (developer.js) or ticks it for one (decision
//   259). The client's own Admin then gives rights only within
// that, in Roles as before. A module switched off is not in the
// corporate's tree, Roles or Tree Management, and moduleHasCapability
// refuses it (so getModuleFragment and every function that checks it do
// too); its data stays where it is.
//
// Corporate 100 has every module but a clientOnly one (Support: it is the
// firm). A homeOnly module (Developer) is never any other corporate's,
// whatever its entry or roles say.
'use strict';
const { MODULE_REGISTRY } = require('./moduleRegistry');
const { BASELINE_MODULES } = require('./moduleBaseline');
const { HOME_ID, corporateId, corporateEntry } = require('./firebaseAdmin');

const byId = id => MODULE_REGISTRY.find(m => m.id === id);

// For a corporate's entry (its id; null entry: none set yet).
function availableIn(id, entry, moduleId) {
  // Corporate 100 as before: nothing is taken away (a tree node naming a
  // module no longer registered still shows, as it always did).
  if (String(id) === HOME_ID) { const h = byId(moduleId); return !(h && h.clientOnly); }
  const m = byId(moduleId);
  if (!m) return false;
  if (m.homeOnly) return false;
  const modules = (entry && entry.Modules) || {};
  return BASELINE_MODULES.includes(moduleId) ? modules[moduleId] !== false : modules[moduleId] === true;
}

const moduleAvailable = moduleId => availableIn(corporateId(), corporateEntry(), moduleId);
const availableModules = () => MODULE_REGISTRY.filter(m => moduleAvailable(m.id));
// What a menu item may link to in Tree Management: the corporate's modules,
// and in Corporate 100 (the main tree, which the client corporates follow)
// the clientOnly ones too.
const linkableModules = () => MODULE_REGISTRY.filter(m => moduleAvailable(m.id) || (corporateId() === HOME_ID && m.clientOnly));

const isBaseline = moduleId => BASELINE_MODULES.includes(moduleId);

module.exports = { availableIn, moduleAvailable, availableModules, linkableModules, isBaseline };
