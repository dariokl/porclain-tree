# PorclainTree

A terminal wrapper that runs your CLI beside a read-only file explorer and live Git changes list. Use it with a coding assistant, a shell, or another interactive command.

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
- **Click Files or Changes:** collapse/expand that section; the other gets the freed space.
- **Click Search files under Files:** type part of a filename or path to filter the list. Click a result to preview it, or press **Enter** to open the first visible match. **Esc** clears the search and returns typing to the CLI.
- **Mouse wheel over a section:** scroll that section independently.
- **Click a folder in Files:** expand/collapse it. Click a file to preview its full working-tree contents.
- **Click a row in Changes:** open a read-only diff snapshot. The selected entry stays highlighted until you close the preview.
- **In the preview:** arrows scroll vertically/horizontally; Page Up/Down and Home/End move through the preview. **Esc**, **q**, or **Close** returns to the CLI. Typing and paste stay out of the child while the preview is open; **Ctrl+C** still reaches it.
- Exit using your command's normal controls. PorclainTree returns its exit code.

## Sidebar

The sidebar sits on the left and refreshes about once per second. It uses 34 columns in terminals at least 120 columns wide, and 28 columns at widths of 100–119.

Files and Changes are stacked and open by default. When both lists need room, Files gets about 60% and Changes 40%; shorter lists give unused space to the other. Section headers show the visible row range when scrolling is needed.

Files shows tracked and non-ignored untracked paths in expandable folders. Deleted paths and empty directories are omitted; submodule contents are not traversed. The file list is limited to 10,000 paths. A failed refresh keeps the last tree and marks it stale.

File search matches literal filename or repository-relative path fragments without regard to case. Results appear as a flat list, including matches inside collapsed folders, and the Files header shows matches/total. Clearing the query restores the tree's expanded folders. Search uses the current file list and its exclusions; it searches names and paths, not file contents. Clicking search closes an open preview. Typing and paste stay in the search field while it has focus. Click the CLI or press Esc to resume child input; Ctrl+C still reaches the child.

Files and Changes share compact rows with filenames and right-aligned colored Git badges. Changes shows the parent folder beside the filename when space allows; group labels identify the comparison. Filenames and folders are relative to the Git repository root.

The sidebar uses a black or white background with neutral gray text and restrained green, amber, and red status colors. Click the small **Dark/Light switch** in the footer beside **Ctrl+G** to change it. This affects the sidebar and preview; the child CLI keeps its own rendering and theme.

The sidebar starts dark. Optionally set `PORCLAINTREE_THEME=light` or `PORCLAINTREE_THEME=dark` to choose its initial theme:

```sh
PORCLAINTREE_THEME=light bun start -- codex
```

Changes are grouped into unstaged, staged, untracked, and conflicted entries. A file with both staged and unstaged edits appears in both groups. Its Files badge can contain both index and worktree status characters. The Changes header counts distinct paths.

- `*` marks paths that already had changes when you started. The list shows current Git changes; it does not attribute edits to a particular session or assistant.
- Untracked folders may appear as a single entry. Ignored untracked files stay excluded.
- Long names and paths show `…`. Scroll within each section to reach entries that do not fit vertically.
- A failed refresh labels the last successful list as stale. The child stays usable, and a successful refresh clears the warning.

## File and diff previews

The preview covers the right pane while your command keeps running underneath. Files opens the full UTF-8 working-tree file, including unchanged files. Changes opens the selected Git comparison: staged changes against HEAD, unstaged changes against the index, untracked files against empty content, or a combined conflict diff. Click another entry to load a new snapshot; previews do not refresh automatically.

Previews never stage or edit files. Binary files show Git's summary in diff previews and an explanation in file previews. Symlinks and non-regular files cannot be opened as text; directory summaries cannot be expanded, and renames into or out of their own former directory path require direct Git inspection. Reads are limited to two seconds, 1 MiB, and 10,000 lines. Unsupported encoding or an unavailable file shows an explanation. Control characters are displayed as escaped text, tabs as four spaces, and long lines can be scrolled horizontally. Preview colors follow the sidebar switch without changing the child CLI's theme.

## Development

```sh
bun run typecheck
bun test
```

The project uses TypeScript, Bun, and OpenTUI. Process cleanup targets Linux; commands that deliberately detach into their own session are outside the wrapper's cleanup scope.
