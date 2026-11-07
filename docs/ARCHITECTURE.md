# Architecture overview

How the ERP fits together, for a developer about to fix a bug or extend it.
Each section links to the document that holds the detail. The Technical
Reference module (TECHREF) shows the generated catalogue beside this page:
every module, function, file, data path, screen and test, linked to each
other. This page explains how they fit; the catalogue lists them.

## The pieces

- **The shell** (`public/index.html`, on Firebase Hosting): sign-in, the
  session, the menu tree, Home and its tasks, the in-app dialogs
  (`appAlert`, `appConfirm`, `appPrompt`), the date format, the light theme,
  and the `rpc` bridge to the server. The Employee Portal is `public/ess.html`.
  Both are installable apps (docs/modules/PWA.md).
- **The screens** (`screens/<MODULE>.html`): one HTML fragment per module.
  They are never on Hosting. A release writes them into the firm's Firestore
  (`screenReleases/{id}/screens/{ID}`). `getModuleFragment` serves the active
  release's screen after checking the user's access (docs/modules/
  SCREENS_ON_HOSTING.md). The screens of the ported modules are generated
  (tools/legacy-port, SCREEN_EDITS); the others are hand-written.
- **The server**: Cloud Functions, 2nd gen, callable, Node 24, us-central1,
  every one exported from `functions/index.js`. Hand-written code is in
  `functions/src/`. `functions/src/legacy/` is generated from the old Apps
  Script `Code.gs` by tools/legacy-port and is never edited by hand
  (docs/MIGRATION.md).
- **The data**: the Realtime Database for masters and most settings;
  Firestore for the journal entries and every transaction document
  (docs/modules/TRANSACTIONS_FIRESTORE.md). Security rules deny everything
  (database.rules.json, firestore.rules, storage.rules): only the functions,
  through the Admin SDK, read and write.
- **The Help** (`help/pages/*.md` built into `public/help/`): public, for
  users (docs/modules/HELP.md).

## A request, end to end

1. A screen calls `rpc.someFunction({...})`. The shell turns that into a
   Firebase callable with the user's ID token.
2. `callable.js` (`onCallWithMessages` / `onCallInCorporate`) works out the
   request's **corporate** (`corporates.js`) and runs the handler inside
   `runInCorporate`. From there, `rtdb`, `firestore` and `admin.auth()` from
   `firebaseAdmin.js` reach that corporate's own Firebase project
   (docs/modules/MULTI_CORPORATE.md, M1).
3. The handler calls `requireUser` (`auth.js`): the user's profile in
   `users/{uid}`, Active. It checks the module right with
   `moduleHasCapability` (the role's permissions, and whether the corporate
   has the module: `entitlements.js`, M2) and the company with
   `userCanAccessCompany`.
4. It reads and writes through the stores and the shared logic below, and
   returns plain data. An error's message reaches the user as written
   (`HttpsError`, or `{ success: false, error }` in the ported style).

## Multi-corporate

Each client corporate has its **own Firebase project**: its data is
separate. Corporate 100 is the firm's own project, `erp1-8f4cd`, which
also holds what the firm keeps for everyone:
- the corporate directory;
- the screens release;
- this reference.

That is `firebaseAdmin.firm`. No module keeps data in module scope,
because it would be shared between corporates (unit/corporateContext
checks this). Modules are provided to corporates by groups (M4); a module
added after the baseline (`moduleBaseline.js`, frozen) is off for client
corporates until provided. Firm-only modules (`homeOnly`, such as Developer
and this reference) exist only in Corporate 100.

## Modules and rights

- **`moduleRegistry.js`** lists every module: its id, its capabilities
  (access, write, draft, post, ...) and the default roles for each.
  `auth.js` seeds the permissions from it. A change to it reaches every
  function, so its deploy set is every function.
- **`treeSeedNodes.js`** is the menu tree's seed. The live tree is edited
  in Tree Management.
- **`approvalRegistry.js`** lists the modules that can need approval, and
  where their documents are. `approvals.js` runs the levels.

## Posting: how money and stock move

- **`glWriting.js`** checks a GL entry (balanced, postable accounts, the
  dimension rules, a closed project, the period lock), numbers it, and
  writes it to `journalEntries`.
- **`stockPosting.postStock`** is a whole posting in **one Firestore
  batch**: the GL entry, the documents and the stock ledger. It is all or
  nothing.
- **`stockMovement.js`**: the weighted average cost and the movements.
- **`reservations.js`**: stock reserved for Sales Orders.
- **`periodLock.js`**: no posting in a closed month, and no entry dated
  after this month (payroll may post 12 months ahead).
- **`lock.js`**: one **global** lock for every posting, deliberately
  whole-system, as Apps Script's LockService was. Don't make it per item
  without discussing it first.
- **The transaction stores** (`docStore.js`, and on it `stockStore`,
  `salesStore`, `purchaseStore`, `jobStore`, `approvalStore`) keep the
  documents in Firestore. A moved document is reached through its store,
  or by its old RTDB path through `movedPaths.js`, and read with an
  equality query, never the whole collection.
- **Party ledger** (`partyLedger.js`): vendor, customer and sales-rep lines
  on their control accounts, with bill-wise allocations
  (docs/modules/PARTY_PAYMENTS.md).
- **Corrections** go through a new entry, never an edit: a reversal, or a
  Correction JV for the coding (docs/modules/CORRECTION_JV.md).

## The legacy port

The Apps Script system was ported module by module (the migration finished
2026-09-25). `tools/legacy-port/generate.js` writes
`functions/src/legacy/codegs.js` and `callables.js` from `Code.gs`. Its
patches mark new development as `[NEW DEVELOPMENT ...]` and fixes as
`[PORT FIX ...]`. Its SCREEN_EDITS change the generated screens. The ported
modules' quirks were kept on purpose (docs/MIGRATION.md): change one only
when asked, or for a real bug, and record it.

## Releases and deploys

- **Functions:** a named set, `tools/deploy-sets/<set>.txt`, through
  `tools/deploy-functions.sh`. Each new callable gets its public-invoker
  binding. The set is the require closure of what changed, or every
  function when moduleRegistry.js, auth.js or other shared code changed.
  Deploy from a clean checkout only. The GitHub Deploy workflow runs it
  (its checks: generated code up to date, no browser popups, the date
  format, the Help, this reference).
- **Screens:** `tools/release-screens.sh`, always after the functions they
  call. It writes, verifies and activates a release, which carries this
  reference too. The last 10 releases are kept, and `rollback` undoes one.
- **Hosting:** `tools/deploy-hosting.sh`. It covers the shell, the styles
  built from the screens and the Help.
- **Rules:** `tools/deploy-rules.sh`. It deploys to the firm's project and
  every active client corporate's. An RTDB query needs its `.indexOn`
  deployed first.
- **Logging:** every deploy is recorded in docs/DEPLOY_LOG.md. The README's
  "Deploying" section has the details.

## Testing

- **Emulator suites** (`functions/test/emulator/`): one or more per module,
  against the local Firebase emulators. The functions don't hot-reload, so
  restart the emulators after a change.
- **UI checks** (`functions/test/ui/`): Playwright against a harness built
  from the shell and the screens. Some seed their own data; some, like
  smoke, need a seeding suite run first.
- **Unit tests** (`functions/test/unit/`): pure functions, and the repo's
  guards (no browser dialogs, the date format, the Help, corporate context,
  this reference).
- **Every change** needs its tests and a verified negative control (break
  it on purpose, see a test fail, restore it).

## Learned the hard way

The project instructions (CLAUDE.md, in the Documents) list the deployment
facts that were each found by a failure: the invoker binding, the index
before the query, the clean checkout, the moduleRegistry deploy set, the
duplicate project copies. Read them before a deploy.
