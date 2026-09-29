# Approval routing: CBT by voucher type, and follow-up teams

Status: **live** (2026-09-29): approval routing (PR #30) and Fund Transfer
(PR #31). Design agreed by the owner (see Owner's decisions).

## The request (owner, 2026-09-29)

1. **CBT is four transactions.** Cash Receipt, Bank Receipt, Cash Payment
   and Bank Payment should each have their own entry in Approval
   Configuration, since their approvers may be different people.
2. **Job Order → Production.** Once a Sales Job Order line is approved
   (accepted), the Production team should get it as a Home task. Who that
   team is should be set in Approval Configuration.
3. **PR / IPR → Procurement.** In the same way, an approved Purchase
   Requisition or Inventory Purchase Requisition should become a Home
   task for the Procurement team.

## How it works today

- Approval Configuration has one entry per module: enabled, scope (Global,
  Company, Division, Branch or Cost Center), gate type (Threshold or Flat).
  Each scope has its own levels, each level an approver and a threshold.
- **CBT** is one module. `journal.js` sends every Cash/Bank voucher through
  the single `CBT` entry, whatever its voucher type.
- **PR / IPR:** once approved (or submitted, if no approval applies) the
  requisition is **Submitted**. It stays Submitted until a Purchase Order
  built from it is submitted, which **closes** it, or someone closes it by
  hand.
- **Job Order lines** from Sales go Pending Acceptance → **Accepted**
  (after the last approval level) → **In Progress** (first production
  entry) → **Completed**. They can also be **Stopped**. Lines Production
  raises itself start **Open**.
- Nobody is told when a requisition or Job Order is ready. The people who
  act next have to look at the list.

## Design

### 1. CBT split into four entries

- Approval Configuration lists **CBT — Cash Receipt**, **CBT — Bank
  Receipt**, **CBT — Cash Payment** and **CBT — Bank Payment**, in place of
  the single CBT entry.
  - Each has its own scope, gate type, levels and approvers.
- When a CBT voucher is posted, the entry for **its voucher type** is used.
- The approval itself still belongs to the CBT module. Approving,
  rejecting, the Home task and the CBT screen work as today, but the task
  shows the voucher type, e.g. "Bank Payment".
- **Today's CBT setup** (see decision 1): copied into all four when this
  goes live, so nothing changes until someone edits one of them.
- Approvals already pending when this goes live finish under the setup
  they started with.

### 2 and 3. Follow-up teams

A new **Follow-up team** section in Approval Configuration, for
**Job Order Request**, **Purchase Requisition** and **Inventory Purchase
Requisition**:

- Per scope, as the levels are: e.g. a different Procurement team per
  company.
- A list of users. Every user in it sees the task. The first one to act
  clears it for all of them.
- It works **whether or not approval is enabled** for that module. A
  requisition submitted with no approval also reaches Procurement.

**Home:** a new block, **Ready for you to act on**:

| Module | Appears when | Leaves when (see decisions 2 and 3) | Opens |
|---|---|---|---|
| Job Order Request (Sales lines) | the line is Accepted | first production entry, or Stopped | the Job Order line |
| Purchase Requisition | it is Submitted | a PO from it is submitted, or it's closed | the requisition |
| Inventory Purchase Requisition | it is Submitted | a PO from it is submitted, or it's closed | the requisition |

- The task is worked out from the document's current state, not stored
  separately. It can't go stale, and nothing needs cleaning up.
- The user must still be able to open the module and the company.

## What changes in the code

- `approvalRegistry.js`: the four CBT entries replace CBT in the
  configurable list; `CBT` stays as the module that owns the approval.
- `journal.js`: CBT picks its entry by voucher type.
- **Approval Configuration** screen and its functions: the Follow-up team
  section, saved beside the levels. The screen becomes hand-maintained; the
  generated functions change through documented patches, as before.
- `homeTasks.js`: a new `getMyFollowUpTasksForUser`; the shell gets the
  new block (a Hosting deploy).
- A one-time copy of today's CBT setup into the four entries (decision 1).

## Tests

- **Emulator:**
  - each CBT voucher type uses its own approvers;
  - the copied setup matches the old one;
  - pending approvals still finish;
  - follow-up tasks appear and leave at the agreed points, for each
    module;
  - scope, module access and company are respected.
- **UI:** the new Approval Configuration section; the Home block opening
  each task.
- Negative controls for each rule, as usual.

## Owner's decisions (2026-09-29)

1. **Today's CBT approvers are copied into all four entries** when this
   goes live, so nothing changes until someone edits one.
2. **The Job Order task ends at the first production entry** (the line
   goes In Progress), or when the line is Stopped.
3. **The PR / IPR task ends when a PO from it is submitted** (which closes
   the requisition), or when it's closed by hand. A draft PO doesn't end
   it.
4. **The team is the users listed per scope** in a Follow-up team section
   of Approval Configuration. It works even when approval itself is off.

## As built (2026-09-29)

- **CBT:**
  - `approvalRegistry.js` lists `CBT_CASHRECEIPT`, `CBT_BANKRECEIPT`,
    `CBT_CASHPAYMENT` and `CBT_BANKPAYMENT` in place of `CBT`.
  - `journal.js` posts a CBT voucher through its voucher type's entry. The
    approval record keeps `ModuleID: 'CBT'` and adds `ConfigKey`, the entry
    used.
  - Home tasks and rejections are labelled by that entry, e.g. "Cash &
    Bank — Bank Payment". The Approval Tracker's filter finds them by it.
  - **The copy:** `approvals.js ensureCbtSplit` runs once, the first time
    Approval Configuration is opened or a CBT voucher is posted. It copies
    the CBT settings and levels into each of the four entries that has no
    setup of its own, then records `approvalMigrations/cbtSplit`. The old
    `CBT` setup is left in place, unused.
  - CBT approvals from before the split have no `ConfigKey`. They finish
    as they started, show as "Cash & Bank Transactions", and a voucher-type
    filter in the Tracker doesn't find them.
- **Follow-up teams:**
  - `functions/src/followUps.js`: `getFollowUpTeams`, `saveFollowUpTeam`
    (Approval Configuration access / write) and
    `getMyFollowUpTasksForUser`.
  - Teams are stored at `approvalFollowUps/<module>/<scope>`, under the
    module's own scope type. The module's settings must be saved before a
    team can be set. An empty team is removed.
- **Screens:**
  - Approval Configuration is now hand-maintained. It gains the Follow-up
    Team section, shown for Job Order Request, PR and IPR once a scope is
    chosen.
  - Home (`public/index.html`) gains **Ready for You to Act On**, counted
    in the Tasks total.
- **Fixed on the way (Approval Configuration):**
  - A Global-scope module showed no approval levels until it was reopened:
    the levels were drawn before they had loaded.
  - The follow-up team's checkboxes appear only once the saved team has
    loaded, so a late redraw can't wipe a tick (found by the UI test).
- **Generator:** a patch may now call a shared helper Code.gs never defined
  (`ensureCbtSplit_`, mapped in `generate.js`).
- **Tests:**
  - The `approvalRouting` emulator suite (8) covers:
    - the copy, and an entry with its own setup (before or after) never
      being overwritten;
    - each voucher type's own approvers;
    - labels and the Tracker filter;
    - an approval pending from before the split;
    - saving teams, with its checks;
    - PR / IPR tasks by scope, a draft PO vs a submitted one, and closing;
    - Job Order tasks through their statuses;
    - module access and company.
  - `approvalRouting.ui.js` (3): the four CBT entries with the copied
    approver, saving and reloading a team, and the tasks opening the PR
    and the Job Order line.
  - `home.ui.js` gains a check of the new block.
- **Negative controls, each caught:**
  - CBT keyed to the module, not the voucher type;
  - levels not copied;
  - an entry's own setup overwritten by the copy;
  - labels ignoring the voucher type;
  - the Tracker patch removed;
  - PR tasks for any status but Closed;
  - team scope ignored;
  - In Progress Job Order lines kept;
  - module access check dropped;
  - inactive users accepted in a team;
  - the Global-scope levels redraw removed;
  - ticks allowed before the saved team loads (the UI test delays it);
  - the new block left out of the Tasks count.

## Addendum: Fund Transfer, a fifth CBT type (owner, 2026-09-29)

The four CBT types are payments or receipts. Moving money between the
company's own cash and bank accounts is a fifth kind of transaction. Until
now it could only be entered as a payment or receipt with a cash or bank
account on the other side, so it went to that type's approvers.

### Owner's decisions

1. **Name: Fund Transfer**, voucher numbers `FT-…`.
2. **Any cash or bank account to any other:**
   - cash to bank (a deposit);
   - bank to cash (a withdrawal);
   - bank to bank;
   - cash to cash (e.g. a petty cash top-up).
3. **One From account, one To account, one amount**, both in the same
   company.
4. **Its own Approval Configuration entry**, "Cash & Bank — Fund
   Transfer". It starts as a copy of the Bank Payment setup, made once
   when this goes live, so the approvers who see transfers today keep
   seeing them.

### Design

- In the CBT screen, Fund Transfer is a fifth type button.
  - **From** is the ledger account: any active cash (`10…`) or bank
    (`11…`) account. It is credited.
  - **To** is a single line, limited to the company's other cash and bank
    accounts. It is debited.
  - No party tags and no allocations: nothing is owed.
- Posting, approval, reversal, printing and the list work as for the other
  four types. Reversal numbers are also `FT-…`.
- **Reports:** the Cash Flow Statement already leaves out entries that
  only move money between cash and bank accounts, so a transfer never
  shows as an inflow or outflow. The GL, Trial Balance and Balance Sheet
  show both accounts as usual.

### As built (2026-09-29)

**Live 2026-09-29** (PR #31; Deploy run #22, release `20260929T092926Z-03f421e`).

- **Server:**
  - `journal.js`: the `Fund Transfer` type. The From account must be
    cash or bank. There must be exactly one To line, also cash or bank,
    not the same account, and not another company's. Party tags are
    dropped. Numbers are `FT-…`, reversals too.
  - `masterData.js`: a Fund Transfer belongs to CBT.
  - `approvalRegistry.js`: `CBT_FUNDTRANSFER`.
  - Patch `cbt-fund-transfer-prefix`: the generated voucher-prefix table.
- **The copy:** `approvals.js` copies Bank Payment's settings and levels
  to Fund Transfer once, unless Fund Transfer already has its own, and
  records `approvalMigrations/cbtFundTransfer`. On a system that never
  split CBT, the four-way split runs first, so Fund Transfer gets the CBT
  setup through Bank Payment.
- **CBT screen:**
  - A fifth type button and list filter.
  - For Fund Transfer, "Transfer From" lists the company's cash and bank
    accounts, and "Transfer To" offers only its other cash and bank
    accounts.
  - One line only: no Add Line, no Paste, no extra row.
- **Tests:**
  - The `cbtFundTransfer` emulator suite (5) covers:
    - the posting, numbering, list and reversal;
    - every check;
    - the Cash Flow Statement staying at zero;
    - the approval entry, the copy from Bank Payment and its task;
    - a system that never split CBT, and an own setup being kept.
  - `cbtFundTransfer.ui.js` (1) covers the screen.
- **Negative controls, each caught:**
  - a non-cash / bank To account accepted;
  - two To lines accepted;
  - another company's To account accepted;
  - levels not copied from Bank Payment;
  - an own Fund Transfer setup overwritten;
  - the FT- prefix patch removed;
  - Fund Transfer not recognised as CBT;
  - To list not limited to cash / bank;
  - a second grid row offered;
  - From limited to bank only.
