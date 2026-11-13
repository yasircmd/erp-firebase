# Audit log (design; owner, 2026-11-13)

Status: **design agreed 2026-11-13** (QA1–QA7, all as recommended; see *The owner's decisions*). **Step 1 built 2026-11-13** (see *As built: step 1*); steps 2 and 3 next.
Item 14 of UX batch 4 (docs/modules/UX4.md). Already decided:

- **Q508:** it records actions and changed fields. Every save, submit,
  approve or reject, post, reverse, delete and status change of documents
  and masters is recorded, as are users, roles and rights, settings, and
  Data Reset. Each entry says who, when and which record. Masters and
  settings record each changed field (before → after). A document records
  the action and its key totals, not every line.
- **Q509:** an Admin-only module, append-only, kept 7 years. Data Reset
  clears it, since reset is only used in development and testing.

## What is there today

There are three places every change already goes through:

1. **The request** (functions/src/callable.js): every callable runs in
   `onCallInCorporate`, which knows the function, the user (from the token)
   and whether it succeeded.
2. **The documents in Firestore** (docStore.js): every transaction
   document goes through a store's `set`, `update` or `transact`. A store
   can already be told of each write with its before and after
   (`afterWrite`; approvalStore uses it for the task emails).
3. **The masters and settings in RTDB**: items, vendors, customers, the
   chart of accounts, companies, org units, users, roles and rights, and
   setups. The ported saves write through one function
   (legacy/runtime.js `firebaseDbRequest_`). The hand-written ones call
   `rtdb.ref(...).set/update` directly, through the `rtdb` handle in
   firebaseAdmin.js.

## The proposal

### One writer: functions/src/audit.js

`audit.record({ action, module, recordId, recordLabel, changes, totals })`
adds one entry, with the user and time filled in from the request. It
never throws: a failed audit write is logged to the console and the
user's save still goes through. Entry:

```
auditLog/{time-ordered id}
  At, UserID, UserName, Role, Corporate
  Action      save | submit | approve | reject | post | reverse | delete | status | signin | reset | rights | ...
  Function    the callable (e.g. postGrn)
  ModuleID, RecordID, RecordLabel (e.g. GRN-26-000123, the vendor's name)
  CompanyID
  Changes     [{ field, from, to }]       masters and settings (QA2)
  Totals      { Amount, Currency, Status: from → to }   documents
  Outcome     done | refused (QA4)
```

### Where it is called

- **Actions:** in callable.js, after the handler answers. The function
  name says the action (the same verbs the shell's SAVING_CALL list
  uses), and the request's id fields say the record. This needs no change
  in any module, so no module is missed.
- **Documents:** an `afterWrite` on every store in docStore.js. It gives
  the Status before → after and the key totals; a document change with
  the same Status and totals adds nothing beyond the action.
- **Masters and settings:** one place for the field changes (QA2).

### Storage, keeping and clearing

- **Where:** per corporate, in Firestore `auditLog`, read with equality
  queries and indexed by user, module, record and date (the indexes ship
  with the rules release).
- **Append-only, in code:** only audit.js writes `auditLog`. A unit check
  fails if any other file writes the collection, as unit/stockReads does
  for the stores. Only two things delete entries: a monthly scheduled
  sweep of entries over 7 years old, and Data Reset (Q509).
- **The screen:** a new **Audit Log** module, Admin only. It filters by
  user, module, record, action and date, opens an entry's changes, and
  has Copy to Excel. It shows times in the user's own time and dates as
  dd/mm/yyyy.
- **Cost:** one Firestore write per change, plus one RTDB read of a
  master before it is saved. At 1,000 changes a day that is about 30,000
  writes a month, around US$0.06.

## The owner's questions

| # | Question | Options | Recommended |
|---|---|---|---|
| QA1 | Which requests are recorded? | (a) only those that change something (save, post, approve…); (b) also opening reports and documents (views) | **(a).** Views would be most of the log and say little; a report opened is not a change. |
| QA2 | How are a master's changed fields found? | (a) one wrapper on every RTDB write to the master and settings paths (a list in audit.js), with the record read before the write; (b) a hook added to each module's save | **(a).** One place, so a new module is covered once its path is listed; (b) needs every master's save changed, and one can be missed. |
| QA3 | Sensitive fields (salary, bank account numbers, the mail account's password, tokens): what is kept? | (a) that the field changed, not the values; (b) the values, as for any field | **(a).** The log would otherwise become a second copy of salaries and bank details. Passwords and tokens are never recorded in any case. |
| QA4 | Refused attempts (no permission, a closed month, over the limit)? | (a) record refusals for rights and limits only, as Outcome refused; (b) every refusal, validation errors too; (c) none | **(a).** "Who tried to do what they may not" is what an audit needs; a mistyped date is noise. |
| QA5 | Sign-ins? | (a) each ERP and portal sign-in and sign-out; (b) none | **(a).** Failed passwords are kept by Firebase Authentication, not by us. |
| QA6 | What the firm does to a client from Client Management (modules, limits, Data reset, tree)? | (a) in the firm's own log (Corporate 100); (b) also shown in the client's log | **(b).** The client's Admin should see that their modules or limits were changed, and when; it shows as "the provider". |
| QA7 | Older records, from before the log? | (a) the log starts on the day it is switched on; (b) also build entries from the CreatedBy / UpdatedBy fields records already have | **(a).** Those fields say who saved last, not what changed; a log made from them would look complete when it isn't. |

## The owner's decisions (2026-11-13)

- **QA1:** only requests that change something; views are not recorded.
- **QA2:** one wrapper on the RTDB writes to the master and settings paths, which reads the record first.
- **QA3:** sensitive fields record that they changed, not their values; passwords and tokens are never recorded.
- **QA4:** refusals are recorded for rights and limits only (Outcome refused).
- **QA5:** each ERP and portal sign-in and sign-out is recorded.
- **QA6:** the firm's actions on a client go in the firm's log and also in the client's, as "the provider".
- **QA7:** the log starts on the day it is switched on.

## The steps, once agreed

1. audit.js, the callable hook and the document hook, with the unit
   append-only check, plus emulator tests and negative controls.
2. The master and settings writes (QA2), sensitive fields (QA3), sign-ins
   (QA5) and the firm's actions (QA6).
3. The Audit Log module (screen, rights, Help, What's new), the 7-year
   sweep, and Data Reset clearing the log.

Each step is its own PR. Step 1 deploys every function (callable.js is in
every one), and step 3 adds the module to moduleRegistry.js.

## As built: step 1 (2026-11-13)

- **functions/src/audit.js** is the only writer of the `auditLog`
  Firestore collection, and it only adds (no update, no delete; the unit
  test auditLog checks both). Ids are time-ordered. A failed audit write
  is logged and never fails the request.
- **The request hook.** callable.js runs every callable inside
  `audit.runWithRequest` (an AsyncLocalStorage store, so nothing is kept
  in module scope between corporates). After the handler, `afterCall`
  records the action: Function, Module (the longest module id the
  function's name carries), Action (create, save, post, approve, reject,
  delete …; reads and sign-in helpers are not actions, QA1), RecordId
  (the first `…Id` field of the request or the result), User (read once
  per request from users/<uid>), Outcome done or refused. A refusal is
  recorded only for rights and limits (QA4); any other failure records
  nothing.
- **The document hook.** docStore's `told` (every Firestore store write)
  calls `audit.documentChanged`: a create, a delete, or a Status change,
  with Totals {Status 'A → B', Amount, Currency} and the document's
  number as RecordLabel. A write inside a `postStock` batch is queued and
  recorded only once the request succeeds, so a rolled-back posting
  leaves no entry.
- **Tests:** unit auditLog (6), emulator auditLog (3: GRN save and post
  with the Draft → Posted change; reads and a failed validation not
  recorded, a viewer's refusal recorded; a PO approval rejected).
  Negative controls: removing the request hook, the batch flush, or the
  refusal check each failed a test.
- **Deploy:** set audit-log-1, every function (callable.js and docStore.js
  are in each). No new function, screen or rule. No screen yet, so no
  Help change; the Audit Log module and its Help come in step 3.
