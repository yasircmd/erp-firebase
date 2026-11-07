# Technical Reference: the app's technical details for developers

Status: **design agreed** (owner, 2026-11-07, Q419-Q422); build next, in the four steps below.

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
