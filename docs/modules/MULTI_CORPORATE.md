# One app, each corporate ID's data in the client's own account

Status: **design agreed** (owner, 2026-10-17: the recommendations, 243–249). Built after phase T1 of TRANSACTIONS_FIRESTORE.md (248).

## The owner's direction (2026-10-17)

- **The business:** B2B shared services (accounting, procurement, HR,
  payroll and other support) for client companies.
- **Privacy is the top priority.** All client data, the sign-in system
  and the supporting documents are stored entirely in the **client's own
  account and infrastructure**; the firm has no direct access to the
  clients' databases or stored documents. The clients keep ownership and
  control of their data.
- **One app** (https://erp1-8f4cd.web.app/, this project's Hosting and
  Cloud Functions). Which database a session uses is decided by its
  **Corporate ID**.
- **The region stays** `us-central1`.
- **Every client runs the same version:** an update reaches all clients
  at once.

## Today

- **One Corporate ID.** `'100'` is fixed in functions/src/session.js;
  `completeLogin` refuses any other.
- **One database.** functions/src/firebaseAdmin.js opens this project's
  RTDB and Firestore. 88 modules take `rtdb` / `firestore` from it,
  including the legacy port through its helpers.
- **One sign-in.** public/index.html and ess.html carry this project's
  Firebase web config, and users sign in to its Firebase Auth.
- **Drive** is already per installation: Document Storage keeps the Drive
  connection (OAuth client, refresh token, root folder) in Firestore
  `settings/documentStorage`, in the same database as the data.
- **Every function is a callable** from a signed-in user. There is no
  scheduled or background function, so every piece of work has a user and
  a request to take the Corporate ID from. 67 of the 72 function files go
  through one wrapper (callable.js `onCallWithMessages`); 5 call `onCall`
  directly.
- **Module-level state** that would be shared between corporates in one
  function instance:
  - documentStorage.js `cachedToken`: the Drive access token, keyed by
    refresh token;
  - getModuleFragment.js `cachedRelease`: the screens release, which is
    code, not data;
  - numbering.js `KINDS`: the document kinds, static;
  - the legacy port: to be audited.

## Proposal

### 1. What lives where

| Stays in this project (erp1-8f4cd), the firm's | In each client's own Firebase project |
|---|---|
| Hosting (the one app, the public Help) | Firebase Auth: the client's users, the firm's staff among them |
| The Cloud Functions (the one version) | RTDB and Firestore: all of the client's data, settings, permissions, the tree |
| The screens release (code) | The Document Storage settings, so Drive is the client's own |
| The **Corporate directory**: Corporate ID → the client's project id, database URL and public web config. No client data. | The rules (deny-all) and the indexes, deployed by the firm's release |

**Corporate 100**, the firm's own books, stays in this project, as
today.

### 2. Sign-in

1. **Corporate ID first.** The user types the Corporate ID. The app asks
   the directory for that corporate's public web config (these values are
   not secrets).
2. **The client's Auth.** The app signs in to the **client's** Firebase
   Auth. The user's password never reaches the firm's project.
3. **Each call carries the Corporate ID**, with the ID token from the
   client's Auth.
4. **The function checks the token** against that client's project (only
   its project id is needed, no credential) before anything else. A token
   from one corporate can never open another's data.

### 3. Reaching the client's database without keys

- **A grant, not a key.** The client grants this project's Cloud Functions
  service account a role on **their** project: database and Firestore
  read/write only, not owner. No service-account key is ever made or
  stored.
- **The client stays in control.** Every access shows in the client's own
  Cloud Audit Logs, and the client can withdraw the grant at any time.
  That stops the ERP for them at once, and that is their control.
- **The firm's staff get no console access:**
  - none to the client's Firebase console, database or Drive;
  - they work through the app as **named users of the client's Auth**,
    whom the client's Admin creates, limits by role and company, and can
    disable.

### 4. One request, one corporate

- **The wrapper sets the corporate.** callable.js (and the 5 direct
  `onCall` files, moved onto it) resolves the Corporate ID and opens or
  reuses that client's Admin SDK app. It holds it for the length of the
  request (Node's AsyncLocalStorage).
- **firebaseAdmin.js** exports `rtdb` and `firestore` as handles that
  always point at **the current request's corporate**. So the 88 modules
  and the legacy port keep their code unchanged.
- **No corporate, no database.** Outside a request, the handles refuse to
  work. A missing Corporate ID can never fall back to the firm's own data.
- **Module-level caches** become per corporate, or go: the Drive token,
  and whatever the legacy audit finds. A unit test refuses new
  module-level data caches.
- **The global lock** (lock.js) is a document in the current corporate's
  Firestore. So it is one lock per corporate: whole-system within a
  client, as today, and one client never waits on another.

### 5. Releases

- **Function and screen releases:** one Cloud Functions deploy and one
  screens release serve every client at once, as the owner wants. The
  code and data shapes must then work for every client's database at the
  same moment.
- **Rules and indexes** go to every client's project in the same release
  (the Deploy workflow's "database rules" task loops over the directory).
  The grant in §3 needs one more role for that: rules and indexes admin.
- **Data changes:** a change that needs data changed (a backfill, a new
  seed) runs per corporate, by the same loop, and is written so it can run
  twice safely.

### 6. Onboarding a client

A checklist, and a script for the steps that can be scripted:
1. The client creates a Firebase project on **their** Google account and
   billing, in `us-central1`.
2. The client grants the roles in §3 to this project's service account.
3. The client adds erp1-8f4cd.web.app to their Auth's authorized domains.
4. The firm adds the corporate to the directory (Developer screen,
   question 247). The release deploys the rules and indexes, and seeds the
   starting data (roles, tree, numbering, chart of accounts).
5. The client's Admin is created in the client's Auth.
6. The client's Admin creates users, the firm's staff included, and
   connects their own Drive in Document Storage, with their own OAuth
   client.

### 7. What privacy this gives, stated exactly

- **What the clients get:**
  - every record, password and document stays in the client's account,
    on their bill;
  - the firm's staff see only what the client's Admin lets their user see
    in the app;
  - every access is in the client's own logs, and the client can cut the
    firm off at any time.
- **What remains, and how to answer it:**
  - The firm's code runs with the access the client grants. Whoever can
    deploy that code could, in principle, write code that reads a
    client's data.
  - What answers this is the release discipline: deploys only from
    reviewed, merged code, through the Deploy workflow, with a log of
    every release (DEPLOY_LOG.md). It also helps to say this plainly in
    the client agreement.
  - **This is the main difference from a separate deployment per client,
    which the owner has decided against.**

### 8. Effects on other work

- **Transactions to Firestore (TRANSACTIONS_FIRESTORE.md):** no change of
  plan. Its code takes `rtdb` / `firestore` from firebaseAdmin.js at call
  time and keeps no data in module scope (a rule from now on), so it
  routes per corporate once this is built.
- **The migration's quirks and every module's behavior stay as they
  are.** Only where the data lives changes.

## Questions for the owner

243. **Sign-in per client.** Each client's users, the firm's staff
     included, are in the client's own Firebase Auth, so a staff member
     has a separate login per client (recommended, as your direction says
     the sign-in system is the client's)?
244. **Access without keys.** The client grants this project's service
     account a database-only role on their project, revocable, with no key
     made (recommended)? Or a service-account key the client gives you,
     stored in this project's Secret Manager?
245. **Corporate 100.** Your own books stay in this project, as today
     (recommended)?
246. **Rules and indexes.** Deployed to every client's project with each
     release, which needs one more role in the client's grant
     (recommended)? Or applied by each client from a file you send?
247. **The directory.** A **Developer** screen (Admin of Corporate 100
     only) to add a corporate, test its connection and see each client's
     release status (recommended)? Or edited by the firm by hand?
248. **Order.** Build this after phase T1 of the Firestore move
     (recommended: T1 is agreed and the rules above keep it compatible)?
     Or before T1, because onboarding the first client comes first?
249. **The firm's own staff across clients.** Is a staff member's work
     only ever inside one client's app at a time, with no screen that
     shows several clients together (recommended for privacy)?

## The owner's decisions (2026-10-17)

"Go with your recommendations":
- **243:** each client's users, the firm's staff included, are in the
  client's own Firebase Auth (a login per client).
- **244:** keyless access: the client grants this project's service
  account a database-only role, revocable; no key is made.
- **245:** Corporate 100 stays in this project.
- **246:** each release deploys the rules and indexes to every client's
  project (one more role in the grant).
- **247:** a Developer screen, for the Admin of Corporate 100 only.
- **248:** built after phase T1.
- **249:** staff work in one client's app at a time; no screen shows
  several clients together.
