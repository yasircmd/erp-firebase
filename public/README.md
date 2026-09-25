# public/

Firebase Hosting's serving root. It holds only `index.html`, the app shell
(login, session, menu tree, home tasks and the `rpc` bridge to the callable
functions). Module screens are not here: `getModuleFragment` serves them
from `functions/modules/` after an access check. See the
[README](../README.md) for the layout, and [docs/MIGRATION.md](../docs/MIGRATION.md)
for how the shell was ported.
