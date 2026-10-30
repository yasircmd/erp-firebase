# An installable app that loads faster (UX round 2, item 34)

Status: **built** (2026-10-30, Q332-Q334; a Hosting deploy, no function).

## What the owner asked

An app that can be installed and loads faster. Working offline (saving
without a connection) was not proposed: a posting must reach the server
to be checked (UX_ROUND2.md, item 34).

## Today

- **The shell.** `public/index.html` (about 197 KB; the Employee Portal
  `public/ess.html`, 138 KB) is served by Hosting with `Cache-Control:
  no-cache`, so it is checked with the server on every load.
- **The styles are built in the browser.** The shell loads Tailwind's Play
  CDN (`cdn.tailwindcss.com`): a few hundred KB of script that compiles the
  styles in the browser on every page load. Tailwind says it is not for
  production. The same styles built ahead of time (tools/ui-tailwind.sh,
  which the UI tests already use) are about 40 KB.
- **Font Awesome** comes from cdnjs.
- **Each screen** is fetched from `getModuleFragment` when opened. It is
  behind the access check, and screens are never put in public/ (owner,
  2026-09-26). A function that has been idle starts cold, which is what a
  user feels most.
- **There is no web app manifest and no service worker**, so the app
  can't be installed.

## Proposed

1. **Installable.**
   - A web app manifest for the ERP and one for the Employee Portal (Q333),
     each with its name, icons, theme colour and start page.
   - A small service worker per app, so the browser offers **Install**: on
     a phone "Add to Home screen", on a computer the install icon in the
     address bar.
   - The app then opens in its own window, without the browser's bars.
2. **Faster to load.**
   - **Styles built ahead of time.** The Play CDN is replaced by the
     prebuilt Tailwind file, built from the shell and every screen when
     Hosting is deployed. A screens release rebuilds it too, so a new
     screen's classes are never missing.
   - **The shell from the device's cache.** The service worker keeps the
     shell, the styles, Font Awesome and the Help. A page opens at once
     from the cache, and the server is asked for a newer version in the
     background; a new deploy is used from the next opening. HTML stays
     network-first when online, so a deploy is never hidden for long.
   - **Screens** stay fetched from the server each time (Q332 (a)). With
     (b), they would also be kept on the device.
3. **Offline.** Without a connection the app shows "You're offline", not
   the browser's error page. Nothing is saved offline.
4. **What doesn't change.**
   - Every function call still goes to the server, with its checks.
   - Sign-in is as today.
   - Screens stay behind getModuleFragment, never in public/.

## The owner's decisions (2026-10-30)

| # | Decision |
|---|---|
| Q332 | **(a)**: the installable app, the shell cached on the device, the styles built ahead of time; screens still fetched from the server each time. |
| Q333 | The Employee Portal is **installable as its own app**. |
| Q334 | **"ERP" and "Employee Portal"**, with plain generated icons, replaceable later by a logo. |

## The questions as asked

| # | Question | Recommendation |
|---|---|---|
| Q332 | What "faster" covers: **(a)** the installable app, the shell cached on the device and the styles built ahead of time, screens still fetched from the server each time; or **(b)** also each screen kept on the device after its first opening, per user, cleared at sign-out (opening it again then needs no server call; its data is still checked by the server)? | **(a)** first: it removes the slowest part (styles compiled in the browser) with no change to how screens are protected. (b) gains less than it seems, because a screen's data still needs the server, and it keeps screens on shared devices between sign-outs. |
| Q333 | The Employee Portal: **(a)** installable as its own app ("Employee Portal" icon), or **(b)** only the ERP? | **(a)**: phones mostly use the portal (sales reps, leave, requests). |
| Q334 | The name under the icon: **(a)** "ERP" and "Employee Portal", with a plain generated icon (the letters on the theme colour), replaceable later by your logo; or **(b)** a name and logo you give now? | **(a)**, unless the product has a name already: the icon files can be swapped without code. |

## As built (2026-10-30)

- **Styles** (`tools/build-styles.sh`): Tailwind 3.4.17 builds
  `public/css/erp.css` (from public/index.html and every screen) and
  `public/css/ess.css` (the portal, dark mode by class), minified, about
  30 KB and 25 KB, in place of the Play CDN.
  - They are not committed (.gitignore).
  - `tools/deploy-hosting.sh` builds them before its checks and refuses to
    deploy if the build fails.
  - `tools/release-screens.sh` runs `tools/deploy-hosting.sh` after a
    release, so the styles follow the screens. A screens rollback keeps
    today's styles, which cover the current screens.
  - No class is assembled at run time in the shell or the screens (checked
    when built). Write whole class names.
- **Pages**: index.html and ess.html link their styles, their manifest,
  the theme colour and the home-screen icon. The worker is registered on
  https only, so local test servers are untouched.
- **Manifests**: `public/manifest.webmanifest` (ERP: start and scope `/`,
  #2563eb) and `public/ess.webmanifest` (Employee Portal: `/ess.html`,
  #4f46e5). Each has a 192 and a 512 icon and a maskable 512 (letters on
  the colour, `public/icons/`, drawn once; a logo can replace the files).
- **Worker** (`public/sw.js`):
  - **Pages, styles, manifests, icons and Help:** the network first, so a
    deploy shows at once. The kept copy is used when the network fails or
    takes over 4 s, and a page never seen offline gets "You're offline".
    **Help** waits for the network however slow, and uses its kept copy
    only without one (owner, 2026-10-30: a slow start showed a kept Help
    page from before Back to the ERP). The cache is `erp-shell-v2`; the
    new name drops what v1 kept. ui/pwa checks a slow network both ways.
  - **Font Awesome and the Firebase SDK:** their versioned addresses are
    kept once fetched.
  - **Untouched:** non-GET requests, and every other address (the
    functions, sign-in, Firestore).
  - **Updates:** the cache name is the worker's version; an older cache is
    dropped when a new worker activates.
- **Hosting**: `.css`, `.webmanifest` and `.js` are served `no-cache` like
  the pages, so the network answer is a quick "unchanged". The deploy guard
  (`tools/deploy-hosting.sh`) and unit/hostingGuards allow exactly these
  new files in public/; screens still may not go there.
- **Tests:**
  - unit/pwa (3): the manifests and icon sizes, the pages' links, the
    worker's kept files;
  - ui/pwa (2): registered; with the server stopped, the ERP and the portal
    open from the kept copy and an unseen page shows "You're offline";
    online again, a new deploy shows at once;
  - tools/test-deploy-hosting.sh (17): a failed style build stops the
    deploy; the app's files deploy; a stray file doesn't.
  - The UI helpers (`_cdnStyles.js`, `_essPage.js`) serve the built styles
    for `/css/*.css`.
- **Negative controls**, each caught and restored:
  - the pages kept-copy first: a new deploy not shown;
  - no offline page.
- **Results:** UI suites pass with the built styles, among them home 18/18
  (which failed 2 checks before, on the Play CDN's stand-in), help,
  corporateSignIn, essPortal, essRequests, essClaims, salesRepPortal,
  appDialogs, dateFormat, lineGrids, searchPicker, singleCompany and smoke.
  essPortal failed its first two runs here, then passed three in a row with
  the same code: its sign-in step is sensitive to what ran before it.

