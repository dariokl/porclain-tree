# PorclainTree

A terminal wrapper that runs your CLI beside a live, read-only Git changes list. Use it with a coding assistant, a shell, or another interactive command.

## Getting started

Requires Linux, [Bun](https://bun.com/docs/installation) 1.3.14 or newer, Git, and an interactive terminal.

From this checkout, install dependencies and launch a command:

```sh
bun install --frozen-lockfile
bun start -- bash
bun start -- codex
```

The command keeps your working directory, environment, and arguments. To work in another Git repository, launch using the absolute path to this checkout's entry point:

```sh
cd /path/to/your/git-project
bun run /absolute/path/to/porcelain/src/cli.ts -- codex
```

Start inside a Git working tree, including any subfolder. If the initial Git read fails, PorclainTree reports the error before launching your command.

## Controls

- **Ctrl+G:** hide/show the 28-column sidebar.
- **Ctrl+G twice within 300 ms:** restore the previous sidebar state and send one literal Ctrl+G to the child.
- Below 100 terminal columns, the sidebar automatically collapses; widening restores your selected visibility.
- Exit using your command's normal controls. PorclainTree returns its exit code.

## Git sidebar

The sidebar sits on the left and refreshes about once per second. Paths are relative to the Git repository root.

- `*` marks paths that already had changes when you started. The list shows current Git changes; it does not attribute edits to a particular session or assistant.
- Untracked folders may appear as a single entry. Ignored untracked files stay excluded.
- Long paths show `…` and retain the filename end. An overflow count reports entries that do not fit vertically.
- A failed refresh labels the last successful list as stale. The child stays usable, and a successful refresh clears the warning.

## Development

```sh
bun run typecheck
bun test
```

The project uses TypeScript, Bun, and OpenTUI. Process cleanup targets Linux; commands that deliberately detach into their own session are outside the wrapper's cleanup scope.
