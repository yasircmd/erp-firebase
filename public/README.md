# public/

Firebase Hosting's serving root. Once the shell's own backend calls
(login, tree-building, home tasks) are ported to Cloud Functions,
`Index.html` (the real shell, not the current `<iframe>` wrapper)
lands here as `index.html`, followed by each of the 46 module HTML
files as they're individually ported — see the top-level README for
the current migration status.
