# screens/

One file per module screen, `<ID>.html`, named exactly as the module's
`id` in `functions/src/moduleRegistry.js` (uppercase). Each is HTML plus
an inline `<script>` defining `window.initModule(token, canWrite)`, which
the shell injects after `getModuleFragment`'s access check.

**How they reach users** ([docs/modules/SCREENS_ON_HOSTING.md](../docs/modules/SCREENS_ON_HOSTING.md)):
`tools/release-screens.sh` writes every file here to Firestore as one
release, verifies it and makes it active. `getModuleFragment` serves the
active release. A screen change needs no function deploy, only a release.
The folder is deliberately outside `functions/` (not bundled into any
function) and outside `public/` (Hosting never publishes it).

- **Screen and server change together:** deploy the functions first,
  then release, or run `tools/deploy-functions.sh <set> --screens`.
- **Undo:** `tools/release-screens.sh list`, then
  `tools/release-screens.sh rollback <ID>`.
- **A release is refused** if a registry module has no screen, a screen
  isn't in the registry, or a screen still calls `google.script.run`.
- **Generated or built files:** the ported screens come from
  `tools/legacy-port/generate.js`, `CUSTOMERSOA.html` from
  `tools/build-soa-screens.js`, and `PDCISSUED.html` from
  `tools/build-pdc-screens.js`. Edit their sources, not the output.
