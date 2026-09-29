# Approval routing: CBT by voucher type, and follow-up teams

Status: **design agreed** (2026-09-29): the owner answered the four open
questions (see Owner's decisions).

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
