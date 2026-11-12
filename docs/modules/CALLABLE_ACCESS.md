# Callable access: every function checks its caller, first

Status: **design, waiting for the owner's decisions** (Q489-Q494). Nothing
built yet beyond the one fix below.

## The note raised (2026-11-12)

An external technical review of `main` at `6007fcf` (2026-11-12) found that
the security rules deny every direct read and write, so the Cloud Functions
are the only way in, and they use the Admin SDK, which the rules don't
bind. Every callable is therefore the boundary. The review asked for:

1. an inventory of every callable, each checked for sign-in, its module
   right, its company and the records it touches;
2. automated negative tests: no sign-in, an inactive user, no right, another
   company, a missing company id;
3. those tests to run before a release.

## What the code shows (checked 2026-11-12)

- **715 callables** (functions/index.js, `__endpoint.callableTrigger`), plus
  one HTTP function (Google's Drive sign-in return) and one scheduled one.
  Every one has `allUsers` as invoker (CLAUDE.md), so anyone on the internet
  can call any of them. Whether a call does anything is the function's own
  code.
- **Every callable goes through callable.js** (`onCallWithMessages` /
  `onCallInCorporate`; unit/corporateContext checks it). The wrapper finds
  the corporate and verifies a client corporate's token. It does **not**
  require a sign-in: each handler does, by calling `requireUser` (465 calls)
  or a generated function that calls `requireUser_`.
- **Rights are checked by hand in each handler**: `requireCap` (239),
  `requireCompany` (128), `requireAccess` (42), `requirePostAccess` (24) and
  others. Nothing checks that a handler made them, or made them before it
  read anything.
- **One gap found by reading, fixed 2026-11-12**: the invoice reversal
  wrappers (`invoiceAllocations.js`) ran their guards before the wrapped
  function checked the caller. With no sign-in, a call took the global lock
  and was answered with the numbers of the documents allocated to the
  invoice. See PARTY_PAYMENTS.md, "Who may ask, first". The new emulator test
  failed on the old code exactly that way.
- **`userCanAccessCompany(profile, '')` is true** (glWriting.js): no company
  id means no company check. Correct for a company-independent call, wrong
  for a call that reads a record whose company it never compared.
  `requireCompany` refuses an empty id, and most handlers use it.

## What may be called without sign-in

A probe (2026-11-12, local emulators) calls every callable with no sign-in
and seeded data. **In progress:** results so far are below, updated when
it completes.

- Answered with no sign-in, by design: `corporateSignIn` (the sign-in
  screen's Corporate ID lookup) and `userIdSignIn` (sign-in by user ID; it
  checks the password itself).
- Every other function probed so far refuses: most with UNAUTHENTICATED,
  the generated ones with "Please sign in again." in their result.
  `saveJournalDraft` reads its own input before checking the caller (a code
  error on an empty call), but touches no stored data first.

## The options

### A. Sign-in required by the wrapper, by default (recommended)

`onCallWithMessages` / `onCallInCorporate` refuse a call with no signed-in
user before the handler runs, unless the function is declared public
(`{ public: true }` in its options, kept out of what goes to `onCall`). The
public list is short and named in this doc (Q490). Cost: none (no database
read). It closes the whole "no sign-in" class at once, including any
handler that reads before it checks, and any written later.

Optionally, the wrapper also checks the profile is Active and within
`AccessUntil` (Q491). That is one more RTDB read per call, unless the
handler's own `requireUser` reuses it within the request.

### B. The inventory test (recommended, with A)

A unit test, no emulators, so it runs in the Deploy workflow in seconds:

- every callable is created through callable.js (as today) **and** is
  either refused with no sign-in by the wrapper or on the public list;
- every public function is on the list with a reason, and the list matches
  the code both ways (a new public function needs a line here);
- a function's module is known: the file declares which module ids it
  serves, so a right can be checked (B2, later: see Q492).

### C. Negative tests per module (gradual)

Each module's emulator suite gains a short "who may ask" test, as
partyPayments has now: as a Viewer (no right), as `u-other` (another
company), with an empty company id, for each callable that writes or posts,
and for reads of one record by id. Added when a module is next changed, and
first for the posting modules: Journal and CBT, Vendor and Customer
Invoices, GRN, Delivery Note, Payroll, Fixed Assets, Stock.

### D. A full inventory review by hand

The review's own suggestion: read all 715. Expensive, a one-off, and stale
by the next module. A and B make most of it unnecessary; C covers the part
that needs each module's knowledge (which company a record belongs to).

## Recommended

A + B now, C module by module (posting modules first), D only for the
modules C has not reached after a quarter.

## Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q489 | Should the wrapper require a sign-in by default (option A)? | **Yes.** It closes the whole class at no cost; a public function is declared. |
| Q490 | Which functions may be called without sign-in? | **Only the list in "What may be called without sign-in" below**, each with its reason. |
| Q491 | Should the wrapper also check the profile is Active and within its access date? | **Yes, once per request**, reused by the handler's own `requireUser`, so no extra read. |
| Q492 | Should each callable declare its module, so the test can check a right is required? | **Later.** A and B first; declaring 715 modules is a larger change, worth it once the Module Builder settles. |
| Q493 | The order for C, the per-module negative tests | **Posting modules first** (listed in C), then payroll and HR reads, then masters. |
| Q494 | Run the new unit test in the Deploy workflow? | **Yes.** No emulators, seconds, within the Actions minutes. The emulator suites stay in Cloud Shell before a release. |

## The review's other items (for later designs)

Checked against the code 2026-11-12; each needs its own design and the
owner's decision, not part of this one.

- **Deploys without a stored key.** The Deploy workflow signs in with
  `GCP_SA_KEY`, a long-lived JSON key with rules-admin rights on every
  client project (MULTI_CORPORATE.md, "The accounts and their roles").
  Workload Identity Federation lets GitHub sign in with no stored key.
- **A runtime account of its own.** The functions run as the default
  compute account, which usually holds Editor on Corporate 100's project. A
  dedicated account with only the roles the functions use would narrow
  what a compromised function can do there. The client grants stay as they
  are (the clients would re-grant to the new account's email).
- **System errors with a generic message.** `onCallWithMessages` returns
  every error's message on purpose (the users need the reason a posting was
  refused). Errors from Firestore, the Realtime Database or Auth carry a
  `code` and can name the project or an index link: those would return a
  generic message with a reference, kept in full in the log.
- **Strict amounts.** `parseAmountServer` (glWriting.js, 12 calls) takes a
  number's prefix (`"12abc"` is 12, `"1e3"` is 1000). A strict parser would
  refuse the rest.
- **Disabled sign-ins.** `requireUser` reads the profile on every call, so
  setting a user inactive ends access at once. Disabling only the Auth
  account leaves its token valid for up to an hour (`verifyIdToken` without
  `checkRevoked`). Documenting that offboarding goes through the profile
  costs nothing; `checkRevoked` costs an Auth lookup per call.
- **The release gate.** The emulator suites are not in the Deploy workflow
  (the Actions minutes cap). B above adds the access test there; the full
  suites stay in Cloud Shell, recorded in DEPLOY_LOG.md per release.

## Build plan (once agreed)

1. callable.js: the sign-in check and `{ public: true }`; the public list.
2. unit/callableAccess: the inventory test (B), with its negative control
   (a callable made public without a line in the list; the wrapper's check
   removed).
3. Deploy: every function (callable.js reaches all of them): Cloud Shell,
   not the Deploy workflow (CLAUDE.md, Actions minutes).
4. C, module by module.
