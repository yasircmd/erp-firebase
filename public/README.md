# public/

Firebase Hosting's serving root. It holds only `index.html`, the app shell
(login, session, menu tree, home tasks and the `rpc` bridge to the callable
functions). Module screens are not here, and must never be: they're in `screens/`,
released to Firestore, and `getModuleFragment` serves them only after its
access check. See the
[README](../README.md) for the layout, and [docs/MIGRATION.md](../docs/MIGRATION.md)
for how the shell was ported.
