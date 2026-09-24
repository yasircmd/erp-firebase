// Single shared Admin SDK instance for every Cloud Function in this
// project. Runs with full, trusted server privileges — unlike the old
// Code.gs pattern (which manually passed a caller's idToken through
// every REST call to firebaseDbRequest_/firebaseAuthRequest_), the
// Admin SDK bypasses Security Rules entirely by design. That's the
// correct trust model here: it's what let today's Code.gs functions
// act as the sole gatekeeper for every read and write, and Cloud
// Functions need to keep playing that same role — access control is
// enforced explicitly in code (see auth.js), not by rules.
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    // Matches the existing RTDB instance exactly (erp1-8f4cd-default-rtdb,
    // legacy .firebaseio.com domain = us-central1) — do not change this
    // without also confirming Cloud Functions' own deploy region still
    // matches, or every read/write pays a needless cross-region hop.
    databaseURL: 'https://erp1-8f4cd-default-rtdb.firebaseio.com'
  });
}

const rtdb = admin.database();
const firestore = admin.firestore();

module.exports = { admin, rtdb, firestore };
