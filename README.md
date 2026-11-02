# PorclainTree

Run your CLI beside a read-only file explorer and live Git changes list. Use it with a coding assistant, a shell, or another interactive command, and inspect files and diffs without leaving the terminal.

## Screenshots

> Screenshot placeholder: sidebar beside a running CLI.
>
> Screenshot placeholder: highlighted file and diff previews in Dark and Light themes.

## Requirements

- Linux, the currently supported platform. File-preview checks and child-process cleanup use Linux's `/proc` filesystem; macOS and Windows support is not implemented or verified.
- [Bun](https://bun.com/docs/installation) 1.3.14 or newer.
- Git and an interactive terminal with stdin and stdout attached.

Python highlighting uses a bundled parser. No Python installation or runtime parser download is needed.

## Quick start

From this checkout:

```sh
bun install --frozen-lockfile
bun start -- bash
```

Replace `bash` with the command you want to run, including its arguments:

```sh
bun start -- codex
```

Start inside a Git working tree, including any subfolder. To use PorclainTree in another repository:

```sh
cd /path/to/your/git-project
bun run /absolute/path/to/porcelain/src/cli.ts -- codex
```

Your command keeps its working directory, environment, and arguments. Exit using its normal controls; PorclainTree returns its exit code. An initial Git failure is reported before the command starts.

## Controls

| Control | Action |
| --- | --- |
| **Ctrl+G** | Hide or show the sidebar. |
| **Ctrl+G twice within 300 ms** | Restore the previous sidebar state and send one literal Ctrl+G to the command. |
| Click **Files** or **Changes** | Collapse or expand that section. |
| Click a folder | Expand or collapse it. |
| Click a file or change | Open a file or diff snapshot. |
| Click **Search files** | Focus filename/path search; typing and paste stay in the search field. |
| **Enter** in search | Preview the first visible match. |
| **Esc** in search | Clear the query and return typing to the command. Clicking the command also returns typing to it. |
| Mouse wheel over a section | Scroll Files or Changes independently. |
| Arrows or mouse wheel in a preview | Scroll vertically or horizontally. |
| **Page Up/Down**, **Home/End** in a preview | Move through the snapshot. |
| **Esc**, **q**, or **Close** in a preview | Close it and return to the command. |
| **Ctrl+C** | Reach the command, including while search or a preview is active. |
| Click **Dark/Light** in the footer | Switch the sidebar and preview theme. |

The sidebar collapses below 100 terminal columns and restores your selected visibility when widened. While a preview is open, ordinary typing and paste are captured so they do not reach the command.

## Files and changes

Files lists tracked and non-ignored untracked paths in expandable folders. Search matches filename or repository-relative path fragments without regard to case, including inside collapsed folders. It searches names and paths, not file contents. Clearing the query restores your expanded folders.

Changes groups unstaged, staged, untracked, and conflicted paths, with Git badges beside filenames. A `*` marks paths already dirty at launch. These are current Git changes, not changes attributed to a particular session or assistant.

The sections share the sidebar's height, scroll independently, and refresh about once per second. A failed refresh retains the previous list and marks it stale while your command stays usable.

## File and diff previews

Previews cover the right pane while your command keeps running underneath. Files shows full UTF-8 working-tree contents with line numbers. JavaScript/JSX, TypeScript/TSX, and Python receive syntax highlighting; other files remain numbered plain text.

Diff headings identify the comparison: staged against HEAD, unstaged against the index, untracked against empty content, or a combined conflict diff. Ordinary text diffs show syntax colors, line numbers, `+`/`−` signs, and subtle added/deleted backgrounds. Numbers refer to the new file for additions and context, and the old file for deletions. Patch metadata, hunk labels, and no-final-newline markers remain visible. Combined conflicts, binary summaries, metadata-only changes, and incomplete patches use the raw diff view.

Previews never stage or edit files. They are snapshots: select an entry again to reload it. Control characters are escaped, tabs appear as four spaces, and long lines scroll horizontally.

The **Dark/Light** switch affects only the sidebar and preview. The command keeps its own colors. Dark is the default; optionally choose the initial theme:

```sh
PORCLAINTREE_THEME=light bun start -- codex
```

## Limitations

- Reads are bounded to two seconds, 1 MiB, and 10,000 lines; unsupported encoding or unavailable content shows an explanation.
- The file list is limited to 10,000 paths. Deleted paths and empty directories are omitted, and submodule contents are not traversed.
- Binary files show an explanation in file previews and Git's summary in diffs. Symlinks and non-regular files cannot be previewed as text.
- Untracked directories may appear as summaries in Changes; those summaries cannot be expanded. Renames into or out of their own former directory path require direct Git inspection.
- Commands that deliberately detach into their own session are outside the wrapper's cleanup scope.

## Development

The project uses TypeScript, Bun, and OpenTUI. Run the configured checks with:

```sh
bun run typecheck
bun test
```

## License

PorclainTree is available under the [MIT License](LICENSE).

The bundled Python parser retains its [upstream MIT license](src/terminal/parsers/python/LICENSE).
