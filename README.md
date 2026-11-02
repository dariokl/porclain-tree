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

- **Ctrl+G:** hide/show the sidebar.
- **Ctrl+G twice within 300 ms:** restore the previous sidebar state and send one literal Ctrl+G to the child.
- Below 100 terminal columns, the sidebar automatically collapses; widening restores your selected visibility.
- Exit using your command's normal controls. PorclainTree returns its exit code.

## Git sidebar

The sidebar sits on the left and refreshes about once per second. It uses 34 columns in terminals at least 120 columns wide, and 28 columns at widths of 100–119.

The Margin layout connects the project header, change groups, and shortcut footer with a quiet rail. Status markers precede filenames, with directory paths shown below, relative to the Git repository root.

The sidebar uses a black or white background with neutral gray text and restrained green, amber, and red status colors. Click the small **Dark/Light switch** at the top of the sidebar to change it. This affects only the sidebar; the child CLI keeps its own rendering and theme.

The sidebar starts dark. Optionally set `PORCLAINTREE_THEME=light` or `PORCLAINTREE_THEME=dark` to choose its initial theme:

```sh
PORCLAINTREE_THEME=light bun start -- codex
```

Changes are grouped into unstaged, staged, untracked, and conflicted entries. A file with both staged and unstaged edits appears in both groups. The header counts distinct paths.

- `*` marks paths that already had changes when you started. The list shows current Git changes; it does not attribute edits to a particular session or assistant.
- Untracked folders may appear as a single entry. Ignored untracked files stay excluded.
- Long names and paths show `…`. An overflow count reports entries that do not fit vertically.
- A failed refresh labels the last successful list as stale. The child stays usable, and a successful refresh clears the warning.

## Development

```sh
bun run typecheck
bun test
```

The project uses TypeScript, Bun, and OpenTUI. Process cleanup targets Linux; commands that deliberately detach into their own session are outside the wrapper's cleanup scope.
