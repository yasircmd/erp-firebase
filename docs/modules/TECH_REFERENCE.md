# Technical Reference: the app's technical details for developers

Status: **built** 2026-11-07 (owner's decisions Q419-Q422); deploy set `techref`.

## The request (owner, 2026-11-07)

"Now need to develop a module for developers to understand all technical
details about the App, only for information purposes to fix bugs and improve
it later, plan and prepare it."

## What it is

A read-only reference inside the ERP for the firm's developers. It answers
questions like these, without opening the repository:
- Which function does this screen call?
- Where is this data kept?
- What does this module touch?
- Why was it built this way?
- How is it deployed and tested?

It changes nothing in the app. It is **information only**.

## Why it is not public like the Help

The Help is public on purpose: it holds made-up examples and how to use the
screens. The Technical Reference describes the inside of the system: every
function name, every database path, the security model, the deploy steps.
That would be a map for an attacker, so it stays **behind sign-in**, like the
screens. It is served through a Cloud Function that checks the module right,
never from public/.

## What it holds

Two kinds of content, in one searchable reference.

### 1. The catalogue, generated from the code (always accurate)

Built by a tool from the repository on every release, so it can't drift:

| Section | For each item |
|---|---|
| **Modules** (about 160) | Id, name, rights (capabilities and default roles), its screen, its server files, its functions, its data, its Help page, its design doc, its tests; firm-only or not; in the baseline or provided later. |
| **Functions** (669) | Name, the file that defines it, its module, whether it is callable or scheduled, the screens that call it. |
| **Data** | Each Firestore collection and RTDB path: what it holds, which modules read and write it, its indexes (database.rules.json `.indexOn`), its Data Reset category. |
| **Screens** (100) | The file, its module, the functions it calls, whether it is generated from the port (SCREEN_EDITS) or hand-written. |
| **Shared logic** | glWriting, stockPosting, approvals, lock, periodLock, docStore and the rest: what each does and who uses it. |
| **Tests** | Each suite (emulator, UI, unit), what it covers, how to run it. |
| **Deploys** | The deploy sets and the deploy log: what went live when, which PR and run. |

### 2. The written documents (the "why")

The existing docs, rendered and linked from the catalogue:
- README: layout, testing, deploying;
- the Roadmap;
- the Migration record: deviations and kept quirks;
- the module designs (docs/modules/*.md): decisions, as built;
- the Deploy Log.

Plus a new **Architecture overview**, written once and kept current:
- the request path (shell → callable → corporate context → stores);
- the multi-corporate model;
- the security rules;
- the transaction stores and the posting batch;
- the legacy port;
- the release and deploy flow;
- the "learned the hard way" facts.

## How it stays current

The same way the Help does. A build tool (tools/techref/, beside
tools/help/) reads the repository and writes the reference. It finds:
- modules from moduleRegistry.js;
- functions from index.js and their source files;
- screens' calls from their `rpc` / `call('…')` uses;
- data paths from `collection('…')`, `ref('…')` and movedPaths.js;
- indexes from database.rules.json;
- tests from functions/test.

A unit check in the Deploy workflow refuses a release when the built
reference is behind the code, like help.test.js.

## The screen

A module **Technical Reference** (`TECHREF`), under Developer.
- **Navigation:** a search box across everything; tabs for Modules,
  Functions, Data, Screens, Shared logic, Tests, Deploys, Documents and
  Architecture; and cross-links throughout (a module → its functions →
  the data they touch → the design doc's decision).
- **Read-only:** nothing on it changes the app. Copy to Excel is available
  for any list.

## The owner's decisions (2026-11-07)

| # | Question | Decision |
|---|---|---|
| Q419 | Who sees it | **The firm's own corporate only** (firm-only, like Developer), by the TECHREF access right. Client corporates never see it. |
| Q420 | What it holds | **The generated catalogue, the existing documents, and a new Architecture overview.** |
| Q421 | Kept current how | **Rebuilt on every release, checked:** the Deploy workflow refuses a stale one, as for the Help. |
| Q422 | Where | **Its own module, Technical Reference, under Developer**, with its own access right. |

## Build plan (after the design is agreed)

1. **The builder** (tools/techref/): the catalogue extracted from the code,
   the documents rendered, into a private bundle released with the screens.
   Unit tests on the extraction, with a negative control. The staleness
   check.
2. **The server** (techRef.js): serves the bundle to TECHREF users of the
   firm's corporate. The module is in the registry, firm-only.
3. **The screen** (screens/TECHREF.html): search, tabs, cross-links. UI test.
4. **The Architecture overview** (docs/ARCHITECTURE.md), the Help page,
   What's new, the deploy set, and the PR.

## As built (2026-11-07)

- **The builder** (tools/techref/build.js, tools/techref/markdown.js) reads
  the repository:
  - **modules** from moduleRegistry.js, with their rights, firm-only and
    baseline;
  - **functions** from index.js, each traced to the file that defines it
    by the deploy's own lazy-exports map (tools/build-lazy-exports.js);
  - **files**: every functions/src file, with its header comment, what it
    requires and what requires it, its functions and its data;
  - **data**: Firestore collections named literally, through a string
    constant, or as a store's `collection:`; RTDB paths named in `ref()`;
    `.indexOn` from database.rules.json; and which paths moved to
    Firestore (movedPaths.js);
  - **screens** and the functions each calls;
  - **tests** and the functions each calls;
  - **deploy sets**;
  - **documents**: CLAUDE.md, README, docs/*.md (the new
    docs/ARCHITECTURE.md first) and docs/modules/*.md, rendered with the
    Help's converter plus fenced code and `#` titles.

  A module is followed to its own functions (those few screens call), their
  files, the data those files and their stores touch, the design docs naming
  it, its Help page, and its tests (those named after it or its files, and
  those calling the functions only its screen uses).
- **The release** (tools/screen-release.js): `release` builds the
  reference in its own process (`--parts`) and writes it beside the screens,
  as `screenReleases/{id}/techref/{part}`. There is one part per catalogue
  section, the documents' search text in parts of up to 500 KB, one part per
  document, and the meta part (counts, issues, the documents' list, the
  search parts, the commit). It is read back by hash with the screens; a
  failed part leaves the active release as it was. A rollback shows that
  release's own reference. A release refuses to go out when the reference
  has issues.
- **The check (Q421):** unit/techRef.test.js, a Deploy workflow step ("Check
  technical reference"). It checks the following, and a release is
  refused otherwise:
  - no issues: every function has its file, every module its screen,
    every screen its module, and the Architecture overview exists;
  - every function and module is catalogued;
  - one module is followed through end to end;
  - the parts are under Firestore's limit.
- **The server** (functions/src/techRef.js): `getTechRefPart` (meta,
  `cat_<section>`, `docNNN`, from the active release in the firm's
  Firestore) and `searchTechRef` (the documents containing every word, with
  a snippet), each with the TECHREF access right. The module is homeOnly, so
  every client corporate is refused whatever its roles.
  unit/corporateContext lists techRef.js among the files that reach the
  firm's project (the screens release only).
- **The module:** TECHREF, "Technical Reference": access only, ADMIN by
  default. It is internal: there is **no public Help page and no What's new
  entry**, because the Help is public and this maps the system's inside (a
  change from the plan's step 4, for the reason of Q419). Its tree node is
  after Developer.
- **The screen** (screens/TECHREF.html):
  - the release and commit;
  - the Overview, with the counts and issues;
  - tabs for Modules, Functions, Files, Data, Screens, Tests, Deploys and
    Documents, each list with a filter, each item with its links to the
    others;
  - a document's links to another document opening it in place;
  - a search across the catalogue and the documents.
- **The Architecture overview** (docs/ARCHITECTURE.md): the pieces, a
  request end to end, multi-corporate, modules and rights, posting, the
  legacy port, releases and deploys, testing, and a pointer to the facts
  learned the hard way.
- **Tests:**
  - unit/techRef: 5 tests;
  - emulator/techRef: 3 tests. The release carries the reference; the
    firm's admin reads it and searches it; a viewer and a client
    corporate are refused; a release without it says so. A part name
    outside the list is refused;
  - ui/techRef: 2 tests. The overview; a module followed to its function
    and file; a document and its link; the search; a refused user.

  Negative controls, each caught and restored:
  - the constant resolution off (unit fails);
  - the access check off (emulator fails);
  - the document links not followed (the UI test fails).
- **Results:**
  - unit: 240/240;
  - emulator: techRef, screenRelease, developer, corporates, roles,
    treeFolders, treeMgmt, onboarding, all passing;
  - UI: techRef 2/2, smoke 123/123, developer 9/9, rolesMatrix 2/2,
    home 19/19.
- **Deploy:** `techref`, every function (moduleRegistry.js), with
  --screens. The release builds and carries the reference, then Hosting
  (the styles). No rules change.
