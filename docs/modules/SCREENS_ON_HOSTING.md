# Screens on Hosting

**Status:** design, awaiting the owner's decisions · **Roadmap:** follow-up "Design: serve screens from Hosting" ([ROADMAP.md](../ROADMAP.md))

## Purpose

Make a screen-only change (a label, a layout fix, a client-side check) a
Hosting deploy instead of a Cloud Functions deploy. Today every screen is
bundled into the `getModuleFragment` function, so changing one line of
HTML means redeploying a function.

## What exists today (from the code)

- **Screens:** 51 files in `functions/modules/<ID>.html`, 1.9 MB in all
  (about 37 KB each), named after their `MODULE_REGISTRY` id. Each one is
  HTML plus an inline `<script>` that defines `window.initModule(token, canWrite)`.
- **`getModuleFragment`** (`functions/src/getModuleFragment.js`, ported
  from Code.gs): signed-in user → module must be in `MODULE_REGISTRY` →
  the user's role must have the `access` capability for it → reads the
  file from its own deploy package → returns `{ html, canWrite }`.
  `canWrite` = the module has `write` in the registry **and** the role
  has `write` in the permissions table (RTDB, `ensurePermissionsSeeded`).
- **The shell** (`public/index.html`, `openModule`): calls
  `getModuleFragment`, injects the HTML (re-creating `<script>` tags so
  they run), then calls `initModule(null, canWrite)`. Screens call
  `openModule` themselves for drill-down (Trial Balance → GL Report →
  JV), so a screen can open one that isn't in the user's menu tree.
- **Every data call checks permissions itself** (`requireUser`, module
  capability, company access). The screen's own code is not what
  protects the data.
- **Written by tools:** `tools/build-soa-screens.js` (SOA screens) and
  `tools/legacy-port/generate.js` + `check-shell-deps.js` (ported
  screens) write to or read `functions/modules/`.
- **Tests:** `stockModules.emulator.test.js` calls `getModuleFragment`;
  every UI check's harness (`functions/test/ui/buildHarness.js`) loads
  screens through it.
- **Deploy order rule:** `getModuleFragment` goes last in a deploy set,
  so a new screen can't go live before the functions it calls.
- **Hosting** already sends `Cache-Control: no-cache` for every `.html`
  file (`firebase.json`), so browsers always recheck with the server.
  Unchanged files come back as a small "not modified" reply.

## What it saves, honestly

- **Screen-only fixes:** a Hosting deploy of `public/` (the shell plus the
  screens, released together in one step) instead of a function deploy
  plus its checks. These are the cases this design is for.
- **Screen + server changes** (most new modules): little saved. The
  functions still deploy. `getModuleFragment` was 1 of the 34 functions in
  the last deploy. Hosting becomes one more step, after the functions.
- **History:** none of the last 40 commits that touched
  `functions/modules/` changed only screens. Every one also changed
  server code. The saving shows up as the app settles and changes become
  UI tweaks from users. It isn't there yet.
- **For users:** opening a screen becomes a CDN fetch (plus, under
  option A1, one small call in parallel) instead of a function call that
  can hit a cold start. Screens should open a little faster.
- **Adding a module** still needs a function deploy until the separate
  "lists out of the code" item is done, because the module registry is
  in the code.

## Options

**A. Screens are public files on Hosting (recommended).**
Move them to `public/screens/<ID>.html`. The shell fetches the file and,
at the same time, asks the server whether this user may open the module
and write in it. It shows the screen only if the answer is yes.
- **Gain:** a screen-only change is a Hosting deploy. Hosting releases
  are atomic (the shell and all screens switch together) and can be
  rolled back from the Firebase console.
- **Cost:** anyone, even someone not signed in, could download a
  screen's HTML/JS (for example `/screens/USERMGMT.html`). They get no
  data: every data call still checks the user. What they see is the
  screen's layout, field names and the names of the functions it calls.
  The port deliberately kept this gate as "defense in depth"
  (`getModuleFragment.js` header). Removing it is a real, if small,
  loss. Scan of all 51 screens: no keys, secrets or real addresses (one
  placeholder `user@company.com`, and password-field labels in User
  Management).

**B. Keep the gate; move the files to Cloud Storage.**
`getModuleFragment` keeps its exact checks but reads each screen from a
Storage bucket (cached in memory) instead of its own package. A screen
change becomes an upload script.
- **Gain:** nothing becomes public. The ported function's behavior
  doesn't change.
- **Cost:** a new moving part: a bucket, an upload script with its own
  clean-copy rule, and the Storage emulator in tests. There's no atomic
  release or rollback for the shell and screens together. The function
  still runs on every screen open, so there's no speed gain for users.

**C. Do nothing.** Screen-only changes stay function deploys. With the
faster deploy scripts (2026-09-26), deploying `getModuleFragment` alone
takes one batch.

## Design for option A

**Files:** `functions/modules/*.html` → `public/screens/*.html` (git
move, contents unchanged). `functions/modules/README.md` is replaced by a
note in `public/README.md`.

**New callable `getModuleAccess`** (`functions/src/getModuleAccess.js`,
hand-written): the same first three steps as `getModuleFragment` (signed
in, known module, `access` capability, with the same error messages),
returning `{ canWrite }` computed exactly as today.

**Shell `openModule`:** starts `fetch('/screens/' + id + '.html')` and
`getModuleAccess({ moduleId })` together. If access is refused, it shows
the error as today and never injects the HTML. Otherwise it injects the
HTML and calls `initModule(null, canWrite)`. The token/double-click
guard is unchanged: the stale-response check happens after both
requests finish. If the fetch fails, it shows "Couldn't load this
screen, please reload."

**`getModuleFragment`:** kept deployed, unchanged, for a transition
period. A tab opened before the switch still runs the old shell and
calls it, and gets the old bundled copy of the screen. It's deleted in a
later deploy after the owner decides it's safe (question 4).

**Deploy rule:** functions first, then Hosting, so a screen can't go
live before its functions. That's the same rule as "getModuleFragment
last", in a new form. `tools/deploy-functions.sh` gets an optional
`--hosting` flag that runs the Hosting deploy (with the `REPLACE_ME`
check) after the last batch and bindings succeed.

**Tools:** `build-soa-screens.js`, `legacy-port/generate.js` and
`check-shell-deps.js` get the new output/input path. They're tooling,
not `functions/src/legacy/`, so they can change, and the generated
screens stay byte-identical.

**Tests:**
- Emulator: `getModuleAccess`: unknown module, no access, access
  without write, access with write, not signed in. Also a file check
  that every `MODULE_REGISTRY` id has a `public/screens/<ID>.html` and no
  screen contains `google.script.run`. This replaces the current
  `getModuleFragment` test, which stays until that function is deleted.
- UI: the harness serves `public/screens/` from its own local server and
  uses the new `openModule` code from the shell. All UI checks (smoke
  101, dynamic toggle, the five module checks) must pass unchanged.
- Negative controls: return `canWrite: true` for a read-only role
  (the Viewer checks must fail), and skip the access check in the
  shell (a no-access open must fail).

## Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | A (public screen files), B (Storage, gate kept) or C (not now)? | **A.** The screens hold no data or secrets, every data call checks the user, and it's the only option that also speeds up screen opening. Choose B if screen code must never be downloadable without signing in. Choose C if you'd rather wait until UI-only changes are actually common |
| 2 | Where does `canWrite` come from? A small call made alongside the file fetch, or the menu tree at login? | **The small call.** It works for drill-down to modules outside the tree and doesn't touch the ported login/tree code. It costs one call per screen open, in parallel with the fetch |
| 3 | Keep `no-cache` on screens (always recheck, small "not modified" replies)? | **Yes.** A fix shows on the next open. Revisit together with the shell's header when deploys become rare |
| 4 | How long does `getModuleFragment` stay deployed after the switch? | **One week**, then delete it, so open tabs from before the switch keep working until they're reloaded |
| 5 | Switch all 51 screens at once, or a few first? | **All at once.** The contents don't change and the UI checks cover every screen. A half-and-half shell would be more code and more to test |

## Not in scope

- Moving the module, approval and voucher-type lists out of the code
  (the separate roadmap item that saves most on new-module deploys).
- Any change to screen contents, permissions or the permissions table.
