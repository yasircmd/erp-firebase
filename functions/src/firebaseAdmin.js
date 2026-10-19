// Single shared Admin SDK instance for every Cloud Function in this
// project. Runs with full, trusted server privileges — unlike the old
// Code.gs pattern (which manually passed a caller's idToken through
// every REST call to firebaseDbRequest_/firebaseAuthRequest_), the
// Admin SDK bypasses Security Rules entirely by design. That's the
// correct trust model here: it's what let today's Code.gs functions
// act as the sole gatekeeper for every read and write, and Cloud
// Functions need to keep playing that same role — access control is
// enforced explicitly in code (see auth.js), not by rules.
//
// One request, one corporate (docs/modules/MULTI_CORPORATE.md §4, M1).
// Each corporate's data is in its own Firebase project; Corporate 100, the
// firm's own, is this project. callable.js works out a request's corporate
// and runs the handler inside runInCorporate, so `rtdb`, `firestore` and
// `admin.auth()` below always reach the current request's corporate: the
// modules that take them from here are unchanged. Outside a request they
// refuse to work, so nothing can fall back to the firm's own data by
// accident. The test suites and tools that call the modules directly say
// which corporate they work in (useCorporateOutsideRequests).
const admin = require('firebase-admin');
const { AsyncLocalStorage } = require('async_hooks');

if (!admin.apps.length) {
  admin.initializeApp({
    // Matches the existing RTDB instance exactly (erp1-8f4cd-default-rtdb,
    // legacy .firebaseio.com domain = us-central1) — do not change this
    // without also confirming Cloud Functions' own deploy region still
    // matches, or every read/write pays a needless cross-region hop.
    databaseURL: 'https://erp1-8f4cd-default-rtdb.firebaseio.com'
  });
}
const homeApp = admin.app();

// The firm's own corporate: this project.
const HOME_ID = '100';

// A client corporate's Admin SDK app, made once per function instance from
// its directory entry (corporates.js): no key, the client's grant to this
// project's service account (§3). Named by the entry's project and database
// too, so a changed entry gets a fresh app.
function appFor(id, entry) {
  if (String(id) === HOME_ID) return homeApp;
  if (!entry || !entry.ProjectID || !entry.DatabaseURL) throw new Error('Corporate ' + id + ' is not set up.');
  const name = 'corp-' + id + '-' + entry.ProjectID + '-' + entry.DatabaseURL;
  return admin.apps.find(a => a.name === name) || admin.initializeApp({ projectId: entry.ProjectID, databaseURL: entry.DatabaseURL }, name);
}

const context = new AsyncLocalStorage();
let outsideRequests = null;

// Runs fn with the given corporate's data: { id, entry } (entry: its
// directory record; none for Corporate 100).
function runInCorporate(corporate, fn) {
  const c = { id: String(corporate.id), app: appFor(corporate.id, corporate.entry) };
  return context.run(c, fn);
}

// For the test suites and tools that call the modules outside a callable.
// Never called by the functions themselves (unit/corporateContext checks).
function useCorporateOutsideRequests(corporate) {
  outsideRequests = corporate ? { id: String(corporate.id), app: appFor(corporate.id, corporate.entry) } : null;
}

function current() {
  const c = context.getStore() || outsideRequests;
  if (!c) throw new Error('No corporate for this request: the database is not reachable outside one.');
  return c;
}
const corporateId = () => current().id;

// A handle that is always the current corporate's service.
function follow(service) {
  return new Proxy({}, {
    get(_t, prop) {
      const s = service(current().app);
      const v = s[prop];
      return typeof v === 'function' ? v.bind(s) : v;
    }
  });
}
const rtdb = follow(app => app.database());
const firestore = follow(app => app.firestore());
// admin.auth() is the current corporate's Auth; everything else in the SDK
// (admin.apps, the namespaces) is as it is.
const adminForRequest = new Proxy(admin, {
  get(target, prop) {
    if (prop === 'auth') return () => current().app.auth();
    return target[prop];
  }
});

// The firm's own project, whatever the request: only for what the firm
// keeps about its corporates (the directory). Never a corporate's data
// (unit/corporateContext lists who may use it).
const firm = { rtdb: homeApp.database(), firestore: homeApp.firestore(), auth: () => homeApp.auth(), app: homeApp };

module.exports = {
  admin: adminForRequest, rtdb, firestore, firm, HOME_ID, appFor,
  runInCorporate, useCorporateOutsideRequests, corporateId
};
