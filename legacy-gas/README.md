# legacy-gas/ — read-only reference copy of the old Apps Script project

Snapshot (via `clasp clone`) of the live Google Apps Script ERP that this
repo is porting to Firebase: `Code.js` (the old Code.gs) and every module
screen. It was the source of truth for the module ports (the migration is
complete; see docs/MIGRATION.md, "Remaining modules: generated port").

- This folder is **not** a clasp project on purpose (`.clasp.json` omitted),
  so nobody can `clasp push` from here and overwrite the live script.
- `Temp.js` from the live project is **deliberately excluded**: it contains
  hard-coded account passwords.
- To refresh: `clasp clone <scriptId>` into a temp dir and copy
  `Code.js`, `appsscript.json` and `*.html` over this folder.
