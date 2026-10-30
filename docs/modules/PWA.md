# An installable app that loads faster (UX round 2, item 34)

Status: **proposed** (2026-10-30). Q332-Q334 open.

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

## Open questions (the owner's)

| # | Question | Recommendation |
|---|---|---|
| Q332 | What "faster" covers: **(a)** the installable app, the shell cached on the device and the styles built ahead of time, screens still fetched from the server each time; or **(b)** also each screen kept on the device after its first opening, per user, cleared at sign-out (opening it again then needs no server call; its data is still checked by the server)? | **(a)** first: it removes the slowest part (styles compiled in the browser) with no change to how screens are protected. (b) gains less than it seems, because a screen's data still needs the server, and it keeps screens on shared devices between sign-outs. |
| Q333 | The Employee Portal: **(a)** installable as its own app ("Employee Portal" icon), or **(b)** only the ERP? | **(a)**: phones mostly use the portal (sales reps, leave, requests). |
| Q334 | The name under the icon: **(a)** "ERP" and "Employee Portal", with a plain generated icon (the letters on the theme colour), replaceable later by your logo; or **(b)** a name and logo you give now? | **(a)**, unless the product has a name already: the icon files can be swapped without code. |
