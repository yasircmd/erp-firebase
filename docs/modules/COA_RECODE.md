# Chart of Accounts: a new code when an account moves to another head

Status: **built** 2026-10-02, not yet live.

## The request (owner, 2026-10-02)

"In COA, if an account created under wrong head then change to correct
head, but code not changing, how to fix it?"

An account's code is made once, when it is created, from its head
(e.g. `110001` under `110000`). Editing it later could change the head,
but the code was kept, as in Apps Script.

## Why a code can't simply change

The code is held in many places besides the account:
- every posted line keeps a copy of it (the GL Report shows that copy;
  the Trial Balance looks the account up), so renumbering only the
  account would show two codes for one account;
- drafts (JV, CBT, invoices), recurring journal templates, invoice
  direct lines and PDCs refer to the account **by code**; renumbered,
  they would find nothing, or a different account if the code were
  reused.

## The owner's decision

**Only if never used.** Moving an account to another head gives it the
next code under the new head, but only when nothing has ever used it.
Otherwise the move is refused, and the fix is the usual one: create a
new account under the right head, move the balance to it with a JV, and
deactivate the old one.

## As built

- **saveAccount** (patch `coa-recode-on-move`): when the head changes,
  - the account has child accounts → refused ("…can't move to another
    head: its code would no longer match theirs. Move or deactivate the
    child accounts first.");
  - it has been used → refused, naming up to three places ("Account
    110002 has already been used (Journal entry JV-26-01-000123), so it
    can't move to another head with a new code. Create a new account under
    the right head, move the balance to it with a JV, and deactivate this
    one.");
  - otherwise it gets the next code under the new head (the same rule as
    a new account there), and the result carries `codeChangedFrom`.
- **Used** (`functions/src/coaUsage.js`, `findAccountUsage`): the account's
  ID under an …Account… key, or its code under an …AccountCode key, in
  any record of the transactional stores:
  - Firestore: journal entries (posted, pending, drafts: every JV, CBT
    and system entry), fixed asset transactions and postings;
  - RTDB: stock transactions, Vendor and Customer Invoices, PDCs,
    recurring journals, Purchase and Inventory Purchase Requisitions,
    Purchase Orders, Sales Orders.

  Master data that links an account **by ID** (an item's Inventory
  account, a vendor's payables, a company's accounts, FA classes) is not
  use: a new code doesn't affect a link by ID.
- **COA screen:** after such a move, an in-app message: "Moved to the new
  head: code 110001 is now 120002." A refusal shows in the form, as any
  save error.
- Saving an account without changing its head keeps its code, as before.
  New accounts and the Master Data Import are unchanged.

## Tests

- `coaRecode` emulator suite (5):
  - an unused account moved gets the next code there;
  - a posted entry refuses, naming it;
  - a draft and a template refuse;
  - an item's account link doesn't count;
  - a head with children refuses, and a rename keeps codes.
- `coaRecode.ui.js` (2): the message after a move, the refusal in the
  form.
- Negative controls, all caught:
  - usage check off (2 fail);
  - code kept on a move (2 fail);
  - items counted as use (1 fails);
  - no screen message (UI 2 fail).
- The `coa`, `masterImport`, `masters1`, `jv` and `dataReset` suites
  still pass.

## Also: shared accounts under each company (owner, 2026-10-02)

Found while testing: a user assigned to one company opens Chart of
Accounts with the company filter set to that company (the shell's
single-company default), and the list showed only that company's own
accounts, so every shared (all-company) account was hidden and the list
could look empty. Owner's decision: **choosing a company shows its own
accounts and the shared ones** (they apply to it too). "Shared (All
Companies)" still shows only shared ones; "All Companies" shows all. It
applies to everyone who picks a company. Done as a screen edit in
`tools/legacy-port/generate.js` (SCREEN_EDITS, COA).

Test: `coaRecode.ui.js` now has 4 checks:
- a one-company user sees their company's and the shared accounts;
- "Shared" shows only shared ones;
- a two-company user choosing one company sees its own and the shared
  accounts, not the other company's.

Negative control (the old filter): all 4 fail. `singleCompany.ui.js`
still passes (54).
