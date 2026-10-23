# One app, each corporate ID's data in the client's own account

Status: **design agreed** (owner, 2026-10-17: the recommendations, 243–249). Built after phase T1 of TRANSACTIONS_FIRESTORE.md (248). The Developer module (owner, 2026-10-19): **agreed** (250–257, see the decisions at the end). **M1 live** 2026-10-19 and **M2 built** 2026-10-19 (see "As built" at the end).

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

## The Developer module (owner, 2026-10-19)

The owner asked, starting the build:
1. Corporate ID **100** has the development module.
2. It needs **no Help** information.
3. It decides **which modules each corporate may use**.
4. It keeps an **internal note per corporate**: a plain note, a task to
   complete, a bug to fix and so on.
5. **Each client can submit an issue** (a bug and the like), with
   attachments.
6. **Each corporate's module tree can differ**, laid out as it wants; by
   default it follows the main one.

### Proposal

**Who sees it.** A new module, **Developer** (DEVELOPER):
- it exists only in Corporate 100: no other corporate's tree, permissions
  or getModuleFragment ever offers it, whatever its roles say;
- within 100, it is given by role like any module (default: Admin), so
  the firm can grant it to its developers without making them Admin.

**No Help.** The module registry marks it internal: it is left out of
Help, the Help home page and the search, and the Help test (which now
requires every module to have a Help area) skips internal modules. The
client-facing **Support** screen below does get a short Help page, unless
the owner prefers otherwise (question 256).

**The Developer screen**, in Corporate 100. A list of corporates, and for
each one:
- **Connection:** the directory entry (project id, database URL, public
  web config), a connection test, its release status (rules and indexes
  deployed, last seed). (247, already agreed.)
- **Modules:** which modules the corporate may use, ticked per module
  (point 3; question 250). The firm decides what a client has; the
  client's own Admin then gives rights only within that, in Roles as
  today. A module switched off disappears from the client's tree and its
  screens and functions refuse it (the same check getModuleFragment and
  moduleHasCapability already make), while its data stays where it is.
- **Notes:** the firm's internal notes on the corporate (point 4; question
  251): each with a type (Note, Task, Bug, Change request), a title, the
  text, a status (Open, In progress, Done) and, for a task or bug, who on
  the firm's side has it and a due date. Never shown to the client.
- **Issues:** what the client has submitted (point 5), with their
  attachments, a status and the firm's reply (questions 252–254).
- **Tree:** whether the corporate follows the main tree or has its own,
  and a "back to the main tree" action (point 6; questions 255).

**Where each part is kept**, given the privacy rule (client data in the
client's account):

| | Where | Why |
|---|---|---|
| The directory, module entitlements | the firm's project (erp1-8f4cd) | the firm's commercial terms, not client data; the app needs them before it can open the client's database |
| Internal notes | the firm's project | the firm's own notes about its work; the client never sees them. **Rule: no client data in a note** (no figures, names or records), as for Help |
| Issues and their attachments | **the client's own project** (recommended, question 252) | an issue often shows the client's data (a screenshot, an invoice); the firm reads it through the grant it already has, and the client can see and delete what it sent |
| The tree | the client's own database, as today | it is the client's setting |

**Submitting an issue (each client).** A **Support** screen in every
corporate's app (point 5):
- the user picks a type (Bug, Question, Change request), writes what
  happened, and attaches files (screenshots, documents; up to 5 files of
  up to 10 MB each, question 253);
- the screen records where the user was (the module open, the time, the
  app version), so a bug can be found;
- the user sees their issues, each one's status (New, In progress,
  Waiting for you, Resolved, Closed) and the firm's replies, and can
  answer;
- who may submit: a capability in Roles (default: every role), question
  254.

The Developer screen lists every corporate's open issues together. This is
the firm's own support queue, read through each client's grant, in
Corporate 100 only. It is not a screen for a client's staff, so 249 (one
client at a time) still holds for them. The owner confirms this in
question 257.

**Attachments** go where the client's documents already go: the client's
own Drive, through Document Storage, in an "ERP support" folder. If the
client has not connected Drive yet, the files go to their Firebase
project's Cloud Storage bucket instead, which is still the client's own
(question 253).

**The tree per corporate (point 6).** The tree is already in each
client's own database (tree, Tree Management). So:
- a new corporate starts with the main tree (the seed);
- while it has not changed its tree, it **follows the main one**: a
  release that adds or moves modules updates it;
- once its Admin changes it in Tree Management, it keeps its own layout.
  A release that adds a module then puts the new module where the main
  tree has it (its folder, created if missing), so nothing new is lost
  (question 255);
- the Developer screen shows which corporates follow the main tree, and
  can put one back on it.

### Questions for the owner

250. **Module access per corporate.** Ticked **per module** (recommended)?
     Or per capability (access, draft, post), which is finer but much more
     to keep up? For a new corporate: start with **every module on**, so
     you switch off what they have not bought (recommended)? Or start
     with none?
251. **Internal notes.** Types **Note, Task, Bug, Change request**, with a
     status, an owner on your side and a due date for tasks and bugs
     (recommended)? Any other type, or fields you want?
252. **Where a client's issues are kept.** In **the client's own project**
     (recommended: an issue often carries the client's data; the firm
     reads it through its grant)? Or in your project, which is simpler but
     moves the client's data out of their account?
253. **Attachments.** Up to **5 files of 10 MB** each, any image, PDF or
     office file (recommended)? Kept in the client's Drive (Document
     Storage), or in their Firebase Storage until Drive is connected?
254. **Who may submit an issue.** Every user (recommended), or only the
     roles the client's Admin chooses? And may the client see and answer
     the firm's replies (recommended)?
255. **The tree after a customised layout.** A release's new module goes
     where the main tree has it (recommended)? Or into one "New modules"
     folder for the client's Admin to place?
256. **Help for the Support screen.** The Developer module has no Help, as
     you said. The client-facing Support screen gets a short Help page
     (recommended, as clients use it)? Or none?
257. **The support queue.** The Developer screen shows open issues of all
     corporates in one list, for your developers in Corporate 100 only
     (recommended)? Or one corporate at a time, as 249 does for client
     work?

### The owner's decisions (2026-10-19)

"Except these, agreed":
- **250:** module access is ticked per module; a new corporate starts
  with every module on.
- **251:** internal notes of type Note, Task, Bug and Change request, with
  a status, an owner on the firm's side and a due date for tasks and bugs.
- **252: issues are kept in the firm's project, not the client's.** The
  Support screen says so before anything is sent: what is written and
  attached is shared with the firm and leaves the client's account. The
  user confirms it each time.
- **253:** up to 5 files of 10 MB each (images, PDF, office files).
  Following 252, they go with the issue: in the firm's project (its Cloud
  Storage), under the same warning.
- **254: only the client's Admin submits issues** (Support in the client's
  app). Other users will submit theirs from the Employee Portal, later.
  The Admin sees the firm's replies and answers them.
- **255: a module a release adds goes into a "New modules" folder** of a
  corporate that has its own tree, for its Admin to place. A corporate
  that follows the main tree gets it where the main tree has it.
- **256:** the Support screen gets a short Help page; the Developer module
  none.
- **257:** the Developer screen's issue queue shows all corporates
  together, for the firm's developers in Corporate 100 only.

**What 252 changes in §7 (privacy).** Issues are the one place where
client content enters the firm's project, and only what the client's
Admin chooses to send, with a warning each time. The rest of §7 stands.

### Build order

1. **M1: one request, one corporate** (§2–§4): the Corporate directory;
   sign-in by Corporate ID to that corporate's Auth; callable.js resolves
   the corporate and opens its database; firebaseAdmin.js handles that
   follow the request; per-corporate caches and lock. Corporate 100 keeps
   working exactly as today, and is the only corporate until the first
   client is onboarded.
2. **M2: the Developer module** (Corporate 100): the directory screen and
   connection test, module access per corporate (enforced in the tree,
   getModuleFragment and moduleHasCapability), internal notes, the tree
   status and "back to the main tree".
3. **M3: Support and the issue queue:** the client Admin's Support screen
   (warning, attachments, replies), the queue in the Developer screen;
   the release rule for new modules (255).
4. **M4: onboarding** (§6): the rules and indexes loop in the Deploy
   workflow, the seed, the checklist and script.

## As built: M1, one request, one corporate (2026-10-19)

Corporate 100 is still the only corporate, and works as before. What is
in place for the first client:

**Which corporate a request is for** (functions/src/corporates.js,
callable.js). It is never taken from what a call says alone, but from the
Auth that signed its token:
- a call with no envelope is Corporate 100's. Its token, if any, is this
  project's Auth, checked by Cloud Functions as always;
- a client corporate's app signs in to the client's own Auth and sends
  `{ __corporate: { id, idToken }, __data }`. The function looks the
  corporate up in the directory (Active only), checks the token against
  that corporate's project (`verifyIdToken` on its app; only its project
  id is needed), and gives the handler `__data` as `request.data` and that
  user as `request.auth`. A token from another project is refused ("Please
  sign in again."); an unknown or inactive corporate is refused before
  anything runs ("Invalid Corporate ID."). Corporate 100 never comes in an
  envelope.
- `onCallInCorporate` (callable.js) does this for every callable;
  `onCallWithMessages` is built on it. The 5 files that called `onCall`
  directly now use `onCallInCorporate` (same error behaviour as before).

**The handles** (firebaseAdmin.js). `rtdb`, `firestore` and `admin.auth()`
are now handles that always reach the current request's corporate
(AsyncLocalStorage, `runInCorporate`). The 88 modules and the legacy port
are unchanged. Outside a request they throw ("No corporate for this
request"). The test suites declare Corporate 100 with
`useCorporateOutsideRequests`, which no function calls. A client
corporate's Admin SDK app is made from its directory entry with no key
(the grant, §3), once per function instance.

**The firm's own project** (`firebaseAdmin.firm`) is reached for two
things only: the directory and the screens release (getModuleFragment.js;
the release is code, the same for every corporate, and its access check is
still the corporate's own).

**The directory**: Firestore `corporateDirectory/{Corporate ID}` in this
project: `{ Name, ProjectID, DatabaseURL, WebConfig, Status }`. No screen
yet (M2). `corporateSignIn` (new, no sign-in needed) gives the sign-in
page what it needs for an ID: nothing more for 100, else the public web
config only (apiKey, authDomain, projectId, appId, messagingSenderId).
Like completeLogin before it, it tells whether a Corporate ID exists.

**Sign-in** (public/index.html CORPORATE SIGN-IN, ess.html ESS SDK): the
Corporate ID is looked up first (outside any corporate, so a remembered
corporate since removed never blocks another), then the user signs in to
that corporate's Auth (a second Firebase app, named
`corp-<id>-<project>`), and every call carries its corporate and token.
The corporate is remembered on the device (localStorage `erp-corporate`,
shared by the ERP and the Employee Portal, as their sign-in is), so a
reload restores its session. The Corporate ID fields start empty (owner,
2026-10-19, after M1 went live): they are named fields of the sign-in
form, so the browser can save the ID and offer it, but the page never
fills it in itself. Signing in to
another corporate signs out of the first. completeLogin checks that the
typed ID is the corporate whose Auth signed the user in.

What users see change (also in Help, What's new 19/10/2026):
- **Forgot Password** asks for the Corporate ID, as the reset email comes
  from that corporate's Auth;
- the **Employee Portal** asks for the Corporate ID, before the Employee
  Code;
- the Corporate ID fields start empty (the browser can offer a saved ID).

**Module-level state** is per corporate or gone:
- the Drive access token (documentStorage.js) is kept per corporate;
- the screens cache (getModuleFragment.js) is the firm's release, so it
  stays shared;
- numbering.js `KINDS` and the legacy port's fixed tables are static.
  unit/corporateContext checks that no module adds state, that the port's
  tables are never changed, that every callable goes through callable.js,
  and that only corporates.js and getModuleFragment.js reach the firm's
  project.

**The lock** (lock.js) is unchanged code. Its document is in the current
corporate's Firestore, so it is one lock per corporate: whole-system within
a client, and no client waits on another (tested).

**The one HTTP function**, driveOAuthCallback (Google's return from
"Connect Google Drive"), has no caller to take a corporate from. The
sign-in link now carries it (`state` = `<Corporate ID>.<random>`). The
callback runs in that corporate, where the pending record still proves the
state. A link made before M1 (no corporate in it) is Corporate 100's.

**Found while building, for M4 (onboarding):** the client's grant (§3)
needs **Firebase Authentication Admin** as well as the database roles.
User Management and the Employee Portal create and disable users in the
client's own Auth, through this project's service account. This role is
still revocable by the client, and every use is in the client's audit
logs.

**Tests:** emulator corporates (a second corporate in project
`erp-client-demo`, next to 100: sign-in config, completeLogin and calls
reaching only its own data, tokens from another project refused, writes
landing in the right database, the screens release shared behind each
corporate's own access check, the lock per corporate, concurrent requests
keeping their corporate, nothing reachable outside a request, the Drive
link's corporate); unit corporateContext (the rules above, and the
handles in and outside a corporate); UI corporateSignIn (the real
index.html and ess.html with a stubbed SDK: Corporate 100 as before, a
client corporate's Auth and envelope, reload, reset, switching corporate,
an unknown ID refused before any sign-in).

**Deploy:** set `multi-corporate-m1`: every function (548, with
corporateSignIn), then Hosting. Functions first: the new sign-in page
calls corporateSignIn, while the old page keeps working against the new
functions (no envelope: Corporate 100).

## As built: M2, the Developer module (2026-10-19)

**The module** (moduleRegistry.js): `DEVELOPER`, `internal` (no Help: the
Help tools leave it out, and it is in no area) and `homeOnly` (only
Corporate 100 has it, whatever a role says; entitlements.js). Within 100
it is given by role (default: Admin; `write` changes the corporates).
After the deploy, link a "Developer" item to it in Corporate 100's Tree
Management (the seed has it only for an empty tree).

**Module access per corporate** (entitlements.js; decision 250). A client
corporate's directory entry keeps `Modules: { MODULEID: false }` for each
module switched off; a module not listed is on, so a new corporate starts
with every module, and so does a module a later release adds. User
Management, Roles and the Module Tree are always on (its Admin needs
them). A module switched off:
- is left out of the corporate's menu (tree.js), with anything under it;
- has no capability for anyone (auth.js `moduleHasCapability`), so its
  screen (getModuleFragment) and every function that checks it refuse it;
- is not offered in Roles & Permissions or Tree Management (port patches
  `corporate-modules-*`). Roles keeps the rights given for it when saving,
  so switching it back on finds them;
- keeps its data where it is.

Corporate 100 has every module; nothing is taken away there (a tree item
naming a module no longer registered still shows, as before).

**The Developer screen** (screens/DEVELOPER.html, developer.js), Corporate
100 only:
- **Connection:** the directory entry (Corporate ID, name, status, project
  ID, database URL, web API key, auth domain, app ID), checked when saved.
  The connection test reaches the corporate's Realtime Database, Firestore
  and Auth through the grant, each told apart; the last result shows in
  the list.
- **Modules:** ticked per module.
- **Notes** (decision 251): Firestore `corporateNotes` in the firm's
  project, typed Note, Task, Bug or Change request, with a title, the
  text and a status (Open, In progress, Done); a task or a bug also has
  an owner (an active user of Corporate 100) and a due date. The list
  counts each corporate's open notes. Never shown to the client.
- **Tree:** the main tree is Corporate 100's. What is compared is its
  layout (each item's place, text and module, in order), not who may see
  it: roles are each corporate's own.
  - **Follows the main tree:** the same layout.
  - **Behind the main tree:** unchanged since it was last given the main
    tree, but the main tree has changed since. **"Update corporates that
    follow the main tree"** brings every such Active corporate up to date
    (M4: each release will do it too).
  - **Own layout:** its Admin changed it in Tree Management; updates leave
    it alone.
  - **No menu yet.**
  - **"Back to the main tree"** (asked first) gives a corporate the main
    layout. An item it already had (the same module, or the same folder
    path) keeps who may see it; a new item gets the main tree's roles that
    the corporate has. The Developer item is never copied.

**Tests:**
- **Emulator `developer`:**
  - Corporate 100 only, and the write right;
  - the directory's checks;
  - the connection test;
  - a module switched off leaving a client corporate's tree, screen,
    functions, Roles (its rights kept) and Tree Management, and coming back;
  - notes;
  - the tree's four states, its roles kept through an update.
- **UI `developer`:** the screen, end to end, and read-only for a Viewer.
- **Negative controls**, each caught, then restored:
  - in entitlements.js: the entry's modules ignored, and `homeOnly` ignored;
  - the tree not filtered;
  - Roles dropping the rights;
  - the corporate's roles not kept;
  - no Corporate 100 check;
  - "behind" never told;
  - the owner field shown for a plain note.

**Deploy:** set `developer-module`: every function (moduleRegistry.js
changed), with `--screens` (DEVELOPER.html). Then Hosting (the Help pages
for Roles and Tree Management now mention that they list the
organisation's modules).

## As built: M3, Support and the issue queue (2026-10-22)

**The module** (moduleRegistry.js): `SUPPORT`, `clientOnly`: a client
corporate's module, given by role (default: Admin; decision 254). It is
never Corporate 100's own, because Corporate 100 is the firm: not in its
menu, its Roles or its capabilities. Corporate 100's Tree Management can
still link it, so the main tree, which the client corporates follow, can
hold its item. After the deploy, add a "Support" item linked to it there.
The Help page is short (decision 256).

**Where it is kept** (decisions 252–253): in the firm's project.
- Firestore `supportIssues/{id}`: the issue's corporate, number
  (`<Corporate ID>-00001`, from `supportCounters/{Corporate ID}`), type
  (Bug, Question, Change request), title, status, the screen it is about,
  and where the user was (the time, the screens release, the browser).
- `supportIssues/{id}/messages/{id}`: what each side wrote, with its files.
- **Cloud Storage** (the firm's bucket, `support/<corporate>/<issue>/`):
  the files. There are up to 5 a message, 10 MB each, checked by type and
  content as for supporting documents. Each is sent with its message, by
  its author, within 30 minutes of it.
- `storage.rules`: deny-all, like the other rules; only the functions read
  and write it.

**The warning:** the Support screen says, before anything is sent, that
what is written and attached is shared with the support team and leaves
the organisation's account. Every send (an issue or an answer) asks to
confirm it, and the function refuses one that was not confirmed.

**The conversation:**
- **New:** sent.
- **The firm** (the Developer screen's **Support queue**, decision 257):
  open issues of every corporate, or all of them. An answer sets the
  status: In progress, Waiting for you (the default), Resolved or Closed.
  Viewing needs Developer access; answering needs its write right.
- **The client** (Support): it sees its own corporate's issues only. Its
  answer to an issue that is Waiting for you or Resolved puts it back to In
  progress. It can close an issue; a closed issue takes no more answers
  (send a new one).

**A new module in a customised tree** (decision 255).
- **Update corporates that follow the main tree** also gives each corporate
  with its own layout the main tree's modules it has never been offered.
  They go in a "New modules" folder at the top of its menu, with the main
  tree's roles that the corporate has, for its Admin to place.
- A module offered once and taken out is not offered again (the entry's
  `TreeOffered`).
- Giving a corporate the main tree counts all of it as offered.

**Tests:**
- **Emulator `support`**, with two client corporates:
  - Support's right and the confirmation, the numbering per corporate,
    and the data in the firm's project, not the client's;
  - Corporate 100 without Support but able to link it;
  - files: checked, limited, by their author, in the firm's Cloud
    Storage, opened by both sides;
  - each client seeing only its own issues, and the queue having every
    corporate's;
  - the conversation and its statuses.
- **Emulator `developer`:** the "New modules" folder, and a module taken
  out not offered again.
- **UI `support`:** the screen, end to end with the Developer queue
  (Cancel sends nothing). The UI harness can now be a client corporate
  (`?corp=`).
- **Negative controls**, each caught, then restored:
  - the confirmation not checked;
  - a client seeing every corporate's list, or opening another's issue;
  - `clientOnly` ignored;
  - no file limit;
  - a module taken out offered again;
  - the screen sending without asking.

**Before the deploy** (once): Firebase console → Storage → Get started
(production mode, location `us-central1`), so the bucket
`erp1-8f4cd.firebasestorage.app` exists. Then the Deploy workflow's
"database rules" task (it now deploys storage.rules too).

**Deploy:** set `support-module`: every function (moduleRegistry.js
changed; 7 Support functions, new), with `--screens` (SUPPORT.html,
DEVELOPER.html). Then Hosting (the Help's Support page, What's new, and
the shell's longer time-out for Support files).

## M4: onboarding a client — proposal (2026-10-23)

What is already in place after M1–M3: the directory and its connection
test, modules per corporate, the tree, Support. What M4 adds is getting
a client from "no project" to "its Admin signed in", and keeping every
client's rules current with each release (§5, §6).

### What a new client project needs (found in the code)

- **Rules and indexes:** the same deny-all rules as this project's. Its
  indexes are the RTDB `.indexOn` entries in database.rules.json, deployed
  with the rules: every Firestore query is an equality query, so there
  are no composite indexes. Storage rules: none (Support files are the
  firm's, M3).
- **Starting data:** almost all of it seeds itself the first time it is
  needed: roles, permissions, units of measure, sub-categories, customer
  classifications and the numbering formats. Two things do not:
  - **the first Admin** (an Auth account and its ERP profile): nobody can
    sign in without one;
  - **the menu:** an empty tree would seed itself from the built-in seed,
    not from the main tree. The Developer screen's "Back to the main tree"
    already does it right.
- **Left to the client's Admin, in the app:** the companies (Company
  Master), the chart of accounts (there is no chart seed: Master Import or
  by hand), users and roles, and Document Storage with their own Drive.

### The accounts and their roles

Two of the firm's service accounts need a grant on each client project.
Both grants are keyless and revocable, and every use shows in the
client's audit logs.

| Who | Why | Roles on the client's project |
|---|---|---|
| The Cloud Functions' runtime account. It is the default compute account, `303168627971-compute@developer.gserviceaccount.com` (to be checked in the Cloud console before onboarding) | The app reaches the client's data | Firebase Realtime Database Admin, Cloud Datastore User (Firestore), Firebase Authentication Admin (question 258) |
| The Deploy workflow's account (the `GCP_SA_KEY` secret's) | Each release deploys the rules | Firebase Rules Admin, Firebase Realtime Database Admin |

### Proposal

1. **The checklist** (docs/ONBOARDING.md, for the client's IT, with the
   firm's help on a call):
   - create the Firebase project in `us-central1`, on the client's billing
     (Blaze, with a budget alert; question 264);
   - turn on the Realtime Database, Firestore (native mode) and
     Authentication (email/password);
   - add a web app;
   - add `erp1-8f4cd.web.app` to Auth's authorized domains;
   - give the two accounts above their roles (a `gcloud` command to
     paste).
2. **In the Developer screen**, the firm then:
   - adds the corporate (its project ID, database URL, web config), as
     today;
   - runs **Test connection**, as today;
   - **sets up rules:** asks the Deploy workflow to deploy the rules to
     this corporate now (or waits for the next release);
   - **gives it the main tree**, as today;
   - **creates its first Admin** (new): a name and an email; the account
     is made in the client's own Auth, and the ERP profile in its
     database. The client's Admin gets a password-setting link by email
     from the client's own Auth (question 260);
   - ticks its modules.

   The screen shows each step's state. The corporate stays Inactive
   (nobody can sign in) until the firm sets it Active.
3. **Each release** (the Deploy workflow's "database rules" task):
   - deploys the rules to this project and then to every Active
     corporate's project, from the directory, one by one;
   - records in each entry what was deployed (the commit and the time),
     shown in the Developer screen;
   - on a corporate it cannot reach (grant withdrawn), it says so and
     carries on with the others;
   - then brings the corporates that follow the main tree up to date
     (question 263).
4. **Data changes:** none is needed now. When a release needs one (a
   backfill, a new seed), it is a script that runs once per corporate, by
   the same loop, written so it can run twice safely, and recorded in the
   entry. The mechanism is built with the first one.
5. **A client leaving** (question 265):
   - the firm sets it Inactive, so nobody can sign in through the app;
   - the client withdraws the grants, and its data stays with it;
   - what the firm holds about it (its issues and their files, the
     notes, the entry) is deleted after a set time.

### Questions for the owner

258. **User management in the client's Auth.** The client also grants
     Firebase Authentication Admin, so User Management and the Employee
     Portal can create and disable its users (recommended: without it,
     those two screens cannot work for a client)?
259. **A module a later release adds.** Is it on for every existing client,
     as for a new corporate (today's behaviour)? Or is it off where the
     firm marks it as an add-on in the module list, so only clients who
     buy it get it (recommended: core modules on, add-ons off)?
260. **The first Admin.** Is it created by the firm from the Developer
     screen, with a password-setting link sent from the client's own Auth
     (recommended)? Or does the client create it in its Firebase console
     and the firm only adds the ERP profile?
261. **The chart of accounts.** Does a new client start with an empty
     chart, imported with Master Import (recommended: each client's chart
     is its own)? Or with a copy of a standard chart (codes and names, no
     balances)?
262. **Who creates the project.** The client, on its own Google account
     and billing, following the checklist with the firm's help
     (recommended, as §6 says: the client owns it from the start)? Or the
     firm creates it and then transfers ownership?
263. **The tree at each release.** Does the "database rules" task also bring
     the corporates that follow the main tree up to date (recommended)?
     Or does the firm keep doing it with the Developer screen's button?
264. **The client's plan.** Is Blaze (pay as you go) with a budget alert
     required (recommended)? The free Spark plan allows 50,000 Firestore
     reads a day, which a working ERP passes, and then stops until the
     next day.
265. **When a client leaves.** Does the firm delete what it holds about
     the client (its Support issues and files, the internal notes) 90 days
     after it is set Inactive (recommended)? Or a different time, or
     never?

### The owner's decisions (2026-10-23)

"Note below", the rest agreed:
- **258:** the client grants Firebase Authentication Admin too.
- **259: client groups, built in M4.** Corporates are put in groups
  (categories), and the firm chooses which groups a new module is provided
  to. **A module a release adds is off for every client corporate until
  the firm picks its groups** (or ticks it for one corporate); Corporate
  100 has it at once. The modules that exist today stay as they are (on
  unless switched off).
- **260:** the firm creates the client's first Admin from the Developer
  screen; the client's own Auth sends the password-setting link.
- **261: the chart starts with the current headers only.** A new client
  gets Corporate 100's chart headings as they are now (the top headers,
  headers and sub-headers, codes `X00000`, `XN0000` and `XNN000`), with
  no posting accounts and no balances. Its Admin adds the accounts (or
  imports them with Master Import). This is more than the built-in seed,
  because it follows the firm's own headings.
- **262:** the client creates the project on its own Google account and
  billing, following the checklist with the firm's help.
- **263:** each release's rules task also brings the corporates that
  follow the main tree up to date.
- **264: the client chooses its plan.** Blaze (pay as you go, with a
  budget alert) or the free Spark plan. The checklist says plainly what
  Spark's limit means: 50,000 Firestore reads a day, after which the ERP
  stops for that client until the next day.
- **265:** the firm deletes what it holds about a client (Support issues
  and files, internal notes) 90 days after it is set Inactive.
