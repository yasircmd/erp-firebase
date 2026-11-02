# Chart of Accounts: Tree view

Requested 2026-11-02 (owner): a tab on the Chart of Accounts showing the
chart as a tree, like the Employee module's Org chart, with the account code
linking to that account's edit form.

A change to a ported screen (COA): made through SCREEN_EDITS in
tools/legacy-port/generate.js. Screen only: no function changes, no data
changes.

## Decisions (owner, 2026-11-02)

- **Q375 Filters:** the tree uses the screen's filters (search, type,
  status, postable, company). An account that matches keeps the headings
  above it, shown greyed, so you can see where it sits.
- **Q376 Top level:** by account type (Asset, Liability, Equity, Revenue,
  COGS, Expense), then the headings and accounts under each, in code order.
- **Q377 Display:** opens to the headings: a heading with headings under
  it is open, one with only accounts under it is closed (with a search
  typed, everything is open). Expand all / Collapse all. Each line: the
  code, the name, Header or Postable, the number of postable accounts
  under a heading, and the currency, Cash / Bank, company and Inactive
  marks.
- **Q378 Viewers:** the code is a link to the edit form only for users
  who may edit (as the list's Edit button). For others it is plain text.

## As built (2026-11-02)

Live 2026-11-02 (PR #206; runs #272 screens, #273 Hosting).

- A **List / Tree view** tab bar above the filters. The tree is built in
  the browser from the accounts the screen already loads (`renderTree`,
  called from `renderTable` with the filtered accounts), so it always
  matches the list.
- An account whose parent is missing (or not shown) sits at its type's
  top. A loop in old data is still shown, once.
- The app's standard headings (seeded with the chart) appear like any
  other heading, including under a class of your own when they belong to
  it.
- Expanding or collapsing is kept while the filters change, until Expand
  all / Collapse all.
- Test: functions/test/ui/coaTree.ui.js (4 checks). Negative controls:
  not keeping the headings above a match, and giving a Viewer the link,
  each caught, then restored.
- Deploy: "screens only" (tools/release-screens.sh) and "hosting" for the
  Help.
