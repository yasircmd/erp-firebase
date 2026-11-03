# Projects, and which accounts need a cost centre, profit centre or project (UX Tier 3, Q)

Status: **design agreed** (owner's direction 2026-10-16, round 16).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 3, Q).

## The owner's direction (2026-10-16)

- **Projects** become a dimension, like cost centres and profit centres.
- **You choose which accounts need each dimension.** Today every expense
  needs a cost centre, and that has to change.

## Today

- **Dimensions on a GL line:** Division, Branch, Cost Center and Profit
  Center. Each is an Organizational Unit of its type, either shared or one
  company's.
- **The rule is fixed in the code:** an account of type Expense, Revenue
  or COGS must have a cost centre on every line. The rule is checked in
  glWriting.js (`COST_CENTER_REQUIRED_TYPES`), the GRN and opening balances,
  and copied by hand into the JV and CBT screens. Payroll has the same rule
  (payrollPost.js, payrollSettlement.js).
- **The profit centre** is never required.
- **There is no project** anywhere.

## Proposal

### 1. Projects

**Project** becomes a new Organizational Unit type, alongside the others
(shared or one company's, Active / Inactive). It has a code, name, and
optional start and end dates and customer. Every GL line can carry a
**Project**. The entry screens get a Project field on the header and on
each line, as cost centre does today: JV, CBT, the invoices, GRN, payroll
and so on.

### 2. Which accounts need what

Each account says, for each dimension, **Required**, **Optional** or **Not
used**:

| | Cost center | Profit center | Project |
|---|---|---|---|
| e.g. 610001 Salaries | Required | Optional | Optional |
| e.g. 620001 Rent | Optional | Not used | Not used |
| e.g. 630001 Site expenses | Required | Optional | Required |

The rule is set on a **group** (heading) in the Chart of Accounts, and its
accounts take it. An account may override it, as it does the Cash Flow
Category.

The first setting reproduces today's behaviour (Expense, Revenue and COGS
need a cost centre), so nothing changes until you change it. One shared
check (glWriting.js) then serves every posting screen, payroll included,
and the JV and CBT screens read the rule from the server instead of a copy.

"Not used" hides the field for that line, so it is never posted.

### 3. Reports

- The GL Report, the Trial Balance and Profit & Loss can be **filtered by
  project**.
- A **Project report** shows each project's income, costs and result for
  a period, by account.

## Questions for the owner

- **219.** Where is the rule set: on the account's **group**, its accounts
  following it, with an account allowed to differ (recommended); on every
  account one by one; or by account type for the whole chart?
- **220.** The three choices Required / Optional / Not used for each of
  cost centre, profit centre and project: agreed? Should Division and
  Branch get the same?
- **221.** Projects: shared or one company's like the other units
  (recommended)? With a customer, start and end dates, and a status
  (Active / Closed, where a closed project takes no new postings)?
- **222.** Must a project's lines also carry a cost centre, or does the
  project replace it for those accounts? Recommended: both are set by the
  rule in 219. Each account says what it needs, independently.
- **223.** Existing postings have no project. Is that fine (they show
  under "no project")? Recommended: yes.
- **224.** A project budget, comparing actual against budget, now or
  later? Recommended: later.

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 219 | The rule is set on the account's **group**; its accounts follow it, and an account may differ. |
| 220 | Required / Optional / Not used for cost centre, profit centre and project. Division and branch unchanged. |
| 221 | Projects shared or one company's, with customer, start and end dates and a status (a Closed project takes no new postings). |
| 222 | Each dimension independently, as the rule says. |
| 223 | Existing postings show under "no project". |
| 224 | Project budget later. |
| (all) | "Go with your recommendations" (owner, 2026-10-16). |

## As built (2026-10-16)

**Rules** (`functions/src/dimensionRules.js`):
- Each heading or account may carry `DimensionRules { CostCenter,
  ProfitCenter, Project }`, each `Required`, `Optional` or `NotUsed`.
  Blank or absent follows the nearest heading above.
- With nothing set anywhere, Expense, Revenue and COGS need a cost center
  and the rest is optional, exactly as before.
- `glWriting.validateAndNormalizeLines` applies the rules to every GL
  line, payroll included:
  - a required one missing is refused (the cost center message as
    before: "Line n: account X (Expense) requires a Cost Center.");
  - a not-used one is dropped;
  - `ProjectID` is kept when set.
- The save-time checks of the Customer Invoice, Delivery Note, GRN,
  Opening Balances and the invoice item lines follow the account's rule
  (`needsCostCenter`, `ruleOf`). So do payroll's: an Optional expense
  still takes the slip's cost center.
- The COA form (SCREEN_EDITS) has the three choices with a "Now: …" hint.
  The account save is patch `dimension-rules`; an import that doesn't
  send the field keeps it.

**Projects** (`functions/src/projects.js`):
- A Project is an Organizational Unit type (patch `projects`, ORGUNITS
  SCREEN_EDITS) with an optional `CustomerID`, `StartDate` and `EndDate`,
  and a status of Active or Closed. Closed applies to projects only.
- `assertProjects` refuses a line whose project is unknown, of another
  company, or not Active. It runs in buildStockGlEntry (except reversals),
  journal save and post, and the recurring journal template.
- Line clubbing keeps projects apart. The JV and CBT screens get a
  Project column once the company has a project, and their red marks
  follow the rules.
- The Customer and Vendor Invoice header Project goes on every posted
  line (`linesWithProject`). The mirror reversals keep `ProjectID`.

**Reports:**
- `buildDimensionFilters_` / `getPostedGlLines_` filter by `ProjectID`
  (`__none__` = no project), so the GL Report, Trial Balance and P&L
  screens take a Project filter.
- The new **Project Report** (`PROJECTREPORT`,
  `functions/src/projectReport.js`, `getProjectReport`) shows each
  project's Income (Revenue), Costs (Expense, COGS) and Result for a
  period, by account, with "No project".

**Not yet:**
- a Project field on the GRN, Purchase Order, Sales Order, Delivery Note
  and payroll;
- a project budget (decision 224, later).

**Tests:** unit `dimensionRules` (4); emulator `projectsDimensions` (6); UI `projectsEInvoice` (5). Negative control: a required dimension not refused — 3 suite tests and 1 unit test fail.

## Projects on every document (owner, 2026-11-03)

Asked 2026-11-03: "add the Project section after cost center and profit
center for all modules". Decisions:

| # | Decision |
|---|---|
| Q387 | Every posting document gets a Project: SO, PO, Delivery Note, GRN, Customer / Vendor Invoice, Sales / Purchase Return, Stock Adjustment, Material Issue, Warehouse Movement, PDC, Retail Sales, JV, CBT, **and payroll now**. |
| Q388 | A header Project, the default for new lines; where a screen has dimension columns per line (JV, CBT, the invoices' direct lines) a line may differ. Stock documents: header only. |
| Q389 | The field shows when the company has a project (as JV / CBT today); nothing changes for a company without projects. |
| Q390 | Carried along the chain (SO -> Delivery Note -> Customer Invoice, PO -> GRN -> Vendor Invoice), changeable on the next document. |
| Q391 | Payroll: an employee's default Project on their record, and a run may split an employee's cost across projects by %, as it splits by cost centre. |
| Q392 | In steps, each its own PR: (1) Vendor Invoice, Sales Order, JV, with the entry layout's date width; (2) the sales chain (Delivery Note, Customer Invoice, Sales Return); (3) purchase (PO, GRN, Purchase Return); (4) stock entries, PDC, Retail Sales, CBT; (5) payroll. |

The field sits after Cost Center and Profit Center (the entry layout's
dimension row, docs/modules/ENTRY_LAYOUT.md).

## As built: step 1, Vendor Invoice, Sales Order, JV (2026-11-03)

Live 2026-11-03 (PR #211; runs #281 functions and screens, #282 Hosting).

- **projects.js:** `linesWithProject` keeps a line's own project (the
  header's is the default, Q388); new `documentProject(projectId,
  companyId)` checks a document's header project when saved (unknown,
  another company's or not Active is refused, as `assertProjects` does for
  a line). Routed into the port as `documentProject_` (generate.js MAPPED).
- **Vendor Invoice** (patches `projects-docs (vendor invoice direct lines,
  save / post / reverse)`): a direct line saves its own `ProjectID` and
  posts it; the reversal mirrors it. The posting's line check
  (glWriting.assertProjects) refuses a line project of another company or
  closed. Screen: the Project field moved from inside the Company box to
  the dimension row after Profit Center ("line default"); the direct lines
  get a Project column; a new line takes the header project.
- **Sales Order** (patch `projects-docs (sales order)`): the order keeps
  its `ProjectID`, checked when saved; it is carried on to its Delivery
  Notes and invoices in step 2. Screen: Project after Profit Center.
- **JV** (journal.js): the header `ProjectID` is saved and checked; the
  screen's header Project (after Profit Center) is the default for new
  lines (the trailing row, Add Line, a paste's new rows) and fills the
  lines that have none when chosen, as the Cost / Profit Center do.
- **All three:** the field shows once the company has a project (the
  company's or shared; the screens' list holds Active units only, and a
  saved project since closed stays shown, marked "(closed)").
- **Date width** (ENTRY_LAYOUT.md): on a wide window the sticky key row
  and the dimension row are flexible rows (`.entry-fields.keys`): a date
  takes 10rem (`.entry-date`), Vendor / Customer / Description a double
  share (`.grow-2`), the rest share what is left.
- **Tests:** emulator/projectsDocs (4: the Vendor Invoice's header and line
  projects posted and reversed; a line project of another company or
  closed refused; the Sales Order's kept and checked; the JV header's kept
  and checked), ui/projectsDocs (3: the date widths and the Project field's
  place on the three screens; new lines take the header project; no field
  for a company without projects). Negative controls, each caught and
  restored: the header overwriting a line's project; the Sales Order's
  project unchecked; the date rule removed.
- **Results:** full emulator regression 756 passed, 1 failed (essPortal
  "who is away today", date-dependent, fails on main too); unit 222/222;
  UI projectsDocs 3/3, entryLayout 6/6 and the three screens' suites pass.
- **Deploy:** `projects-step1` (445: projects.js and journal.js reach most
  functions), with screens, then Hosting.
