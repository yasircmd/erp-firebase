# In-app dialogs: no browser popups

Status: **built** (2026-09-29), not yet live.

## The request (owner, 2026-09-29)

"Change all warning / messages from browser to app, in future also."

Every message, confirmation and question was a browser popup (`alert`,
`confirm`, `prompt`). They can't take the app's theme, they name the site
("… says"), and they freeze the page. They should all appear inside the
app, and new code must not bring them back.

No business decisions were needed: the wording of every message is
unchanged, and so is what each button does, apart from one bug (below).

## How it works

- **One dialog, in the app shell** (`public/index.html`, the `APP DIALOGS`
  block in `<head>`). It follows the theme (dark or light) and sits above
  every screen and modal. Screens run inside the shell, so they all use
  it.
  - `appAlert(message)`: a message with OK.
  - `appConfirm(message)`: Cancel / Confirm, answers `true` or `false`.
  - `appPrompt(message, defaultValue)`: a text box, answers the text, or
    `null` for Cancel.
  - Optional last argument `{ title, okLabel, cancelLabel, danger }`.
- **What it looks like:**
  - Messages about a problem (error, unable, not allowed, required, …) get
    the title "Attention" and an amber icon; others get "Notice".
  - Confirmations that delete, cancel, deactivate, reverse, reject,
    withdraw or discard have a red Confirm button.
  - A long text to copy (the copy button's fallback when the clipboard is
    blocked) shows in a selected multi-line box.
- **Behaviour:**
  - One dialog at a time; a second waits until the first is closed.
  - Enter is OK, Esc is Cancel, Tab stays inside the dialog.
  - While a dialog is open, the screen underneath receives no keys
    (e.g. no shortcut fires behind it).
- **Every `alert()` is routed to it.** The shell replaces the browser's
  `alert`, so the ~300 existing messages and any future `alert()` show in
  the app without touching the screens.
- **`confirm()` and `prompt()` can't be routed that way**, because code
  waits for their answer. Each of the 110 calls (in 49 screens and the shell) now awaits `appConfirm` /
  `appPrompt`, and the function holding it became `async`. Nothing used
  those functions' return values (checked for each one).
  - `tools/legacy-port/appDialogs.js` does the conversion. `generate.js`
    runs it on every generated screen, so the Apps Script sources stay
    as they were. It was run once on the hand-maintained screens.
  - The shell's own "unsaved changes" question (Back to Hierarchy) uses
    it too.

## Keeping it that way

- **`functions/test/unit/noBrowserDialogs.test.js`** fails if any screen
  or the shell calls `confirm` / `prompt` (in a script, a module script or
  an `on…=` attribute), or if the shell stops routing `alert()`.
- **The Deploy workflow runs it** ("Check no browser popups") before any
  deploy, so a screen with a browser popup can't go live.
- **CLAUDE.md** has the rule for new code: use `appAlert` / `appConfirm`
  / `appPrompt`.
- **UI tests** answer dialogs through `functions/test/ui/_appDialogs.js`
  (`onAppDialog`, like Playwright's `page.on('dialog')`). A browser popup
  appearing in any UI test is recorded as an error.

## Fixed on the way

- **Cancel PO:** it asks for an optional reason. Pressing **Cancel** on
  that question still cancelled the PO (the browser's `null` became an
  empty reason). With an in-app button labelled Cancel that would be even
  more misleading. Cancel now leaves the PO as it is; OK (with or without
  a reason) cancels it.

## Tests

- `noBrowserDialogs.test.js` (4):
  - no screen or shell popups;
  - the shell's routing of `alert()`;
  - the detector (confirm and prompt in scripts, module scripts and
    attributes; comments, strings and other names ignored);
  - the converter's output, including that a second run changes nothing.
- `appDialogs.ui.js` (3):
  - Unit of Measure (a generated screen): Esc keeps the unit, Enter
    deactivates it;
  - Cancel PO: Cancel on the question keeps the PO, OK cancels it with
    the reason typed;
  - the dialog itself: an `alert()` shown in the app, a second one
    waiting its turn, keys not reaching the screen, Tab kept inside, the
    copy box.
- The 16 UI checks that answered browser popups now answer the in-app
  dialog. `dynamicToggle.ui.js` and `fixedAssets.ui.js` exercise real
  confirmations and reason questions through it.
- **Negative controls, each caught:**
  - the Cancel PO fix removed;
  - `alert()` no longer routed;
  - keys reaching the screen underneath;
  - the one-at-a-time queue removed;
  - a screen back on the browser's `confirm()` (the UI test and the guard
    both fail).
- The converter bug found while building it (a call to a function named
  `valueOf` was mistaken for a popup) is covered by the converter test.

## To go live

No functions change. **Order matters:**

1. Deploy → **"hosting"** (the shell with the dialog). Today's screens
   keep working with it; their `alert()`s already show in the app.
2. Then Deploy → **"screens only"** (the converted screens).
3. Anyone with the app open should **reload the page** afterwards. An
   open tab still has the old shell, which has no `appConfirm`: a
   confirmation in a newly loaded screen would do nothing until reload.
