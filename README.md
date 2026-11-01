# PorclainTree

A TypeScript terminal-wrapper prototype. It runs your existing CLI beside a passive sidebar so we can test terminal compatibility before building project-awareness features.

## Run locally

Tested on Linux with Bun 1.3.14 and `@opentui/core` 0.8.1. Install [Bun](https://bun.com/docs/installation), then:

```sh
bun install --frozen-lockfile
bun run src/cli.ts -- bash
bun run src/cli.ts -- codex
```

Use an interactive terminal. The child receives your current working directory, environment, and literal arguments. To start it from another project, use the absolute path to this repository's `src/cli.ts`.

- **Ctrl+G:** hide/show the 28-column sidebar.
- **Ctrl+G twice within 300 ms:** restore the previous sidebar state and send one literal Ctrl+G to the child.
- Below 100 terminal columns, the sidebar automatically collapses; widening restores your selected visibility.
- All other input stays with the child. Exit using the child's normal command or shortcut.

The sidebar is a compatibility placeholder. Git changes, file browsing, and persistent logs are not implemented yet. Read-only exploration rules do not restrict the commands you intentionally run inside the child CLI.

## Checks

```sh
bun run typecheck
bun test
```

The suite includes real POSIX PTYs and native OpenTUI rendering, not only mocked processes. Current cleanup checks target Linux process groups; deliberately detached processes and other platforms are outside this prototype's verified scope.

## First personal check

Use your normal coding CLI for 10 minutes. Try multiline/Unicode paste, cursor movement, shortcuts, scrolling/copying, resizing, toggling the sidebar, Ctrl+C, and normal exit. Confirm the host terminal returns to normal afterward.

Record what worked and any problems before adding features. The Git sidebar and later enhancements come after this compatibility checkpoint passes.
