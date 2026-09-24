# modules/

`getModuleFragment` reads each module's HTML/JS from this folder via
`fs.readFileSync`, mirroring exactly what
`HtmlService.createHtmlOutputFromFile(id)` did in the old Apps Script
project — reading a file bundled alongside the function's own code,
not a network fetch.

**What goes here:** a copy of each of the 46 module `.html` files
(GRN.html, JV.html, PURCHASEORDER.html, etc.), named to match their
`id` in `MODULE_REGISTRY` exactly (case-sensitive on most deployment
platforms, even though the function itself uppercases the incoming
request — the bundled filename must already be uppercase).

This is a deliberate copy, not a symlink to `public/` — the versions
in `public/` (served statically by Firebase Hosting) and the versions
here (served only after the access-control check in
`getModuleFragment`) will diverge over time as modules get ported to
call Cloud Functions instead of `google.script.run`. Keeping them
separate from day one avoids a footgun where updating one silently
updates the other.
