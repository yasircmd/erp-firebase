# Loading, not "nothing found", while a module opens

Status: **paused** (owner, 2026-09-29), not live. Built and mostly tested
(see Tests), then paused by the owner before its negative controls were
done. The code is in commit `854542e` and was taken out by the commit
"Pause module loading" right after it: reverting that commit
(`git revert 57455ed`) brings it all back (shell block, harness, both tests,
the README line). Then run the negative controls before shipping.

## The request (owner, 2026-09-29)

"While loading any module, it shows like 'no transaction found' in bottom
for a few seconds before loading, then it loads. Instead, while opening
show like loading until load, or in case nothing to load, that time can
be like no transaction found."

## Why it happened

Most screens draw their list more than once while opening. The first
draw often comes before the list's data has arrived: when the user's
permissions come back, or when the company is filled in for a
one-company user. With no data yet, the list is empty, so it showed its
empty message ("No transactions found.", "No Purchase Orders found.",
"No assets yet." …) until the data arrived.

A check that opened every screen with its server calls slowed down found
this on **34 of 60 screens**.

## How it works now

- **One rule in the app shell** (`public/index.html`, the `MODULE LOADING`
  block), so it covers every screen, present and future, without changing
  any of them.
- **While a module is loading,** from the moment its screen is put on the
  page until all its server calls have finished, any empty-state message
  it shows reads **"Loading…"** with a spinner.
- **When loading ends,** a list that is really empty gets its own message
  back, e.g. "No transactions found." A list with data just shows the
  data.
- **What counts as an empty-state message:**
  - text starting "No …" or "Nothing …";
  - inside a table, only a row-wide cell (the "No … found." row).
  - An ordinary cell, such as a Yes / No value or a description starting
    "No", is never touched.
- **When loading ends:**
  - When no server call is pending. The rule waits a moment first, since
    a screen often starts its next call as soon as one answers
    (permissions, then the list).
  - At most after 30 seconds.
- Only the first load of a module is covered. Refreshing a list later
  (a filter, "Load all") works as before.

## Tests

- **`moduleLoading.ui.js` (4):**
  - CBT with its list held back: "Loading…" while pending, then "No
    transactions found." when there are none;
  - the same with a transaction: "Loading…", then the transaction;
  - Price Listing (a generated screen): "Loading…", then "No price lists
    found.";
  - the rules: data cells are never swapped, and a call started straight
    after another keeps it loading.
- **`shellLoading.test.js` (2):** the real shell watches every module it
  opens and reports the end of each server call (the UI harness has its
  own openModule).
- **Every screen:** 0 of 60 screens show an empty message while loading
  (34 before). 41 showed "Loading…", and no "Loading…" was left behind on
  any screen.
- **Negative controls:** see ROADMAP.md.

## To go live

Deploy → **"hosting"** (the shell only; no screens or functions change).
