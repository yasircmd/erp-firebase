# public/

Firebase Hosting's serving root. It holds only `index.html`, the app shell
(login, session, menu tree, home tasks and the `rpc` bridge to the callable
functions), and `ess.html`, the Employee Portal
([docs/modules/EMPLOYEE_PORTAL.md](../docs/modules/EMPLOYEE_PORTAL.md)), which
like the shell holds no data: everything comes through the `essPortal` function. Module screens are not here, and must never be: they're in `screens/`,
released to Firestore, and `getModuleFragment` serves them only after its
access check. See the
[README](../README.md) for the layout, and [docs/MIGRATION.md](../docs/MIGRATION.md)
for how the shell was ported.

`help/` and `robots.txt` are the public Help
([docs/modules/HELP.md](../docs/modules/HELP.md)): built from `help/pages/`
by `node tools/help/build.js`, never edited here. Help holds no data and
needs no sign-in.
