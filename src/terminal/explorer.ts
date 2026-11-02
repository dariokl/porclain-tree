import type { FileListState } from "../files/tree";
import { fileTree } from "../files/tree";
import type { ChangesState } from "../git/status";
import type { PreviewSelection } from "../preview";
import { changesRows, clip, safeDisplay } from "./sidebar";
import type { SidebarLine, SidebarTone } from "./sidebar";

type Section = "files" | "changes";
export type ExplorerState = Readonly<{
  filesOpen: boolean; changesOpen: boolean; expanded: ReadonlySet<string>;
  filesOffset: number; changesOffset: number;
}>;
export type ExplorerAction = Readonly<{ type: "toggle-section"; section: Section }>
  | Readonly<{ type: "toggle-folder"; path: string }>
  | Readonly<{ type: "scroll"; section: Section; delta: number }>;
export type ExplorerLayout = Readonly<{
  lines: readonly SidebarLine[];
  targets: readonly Readonly<{ row: number; selection: PreviewSelection }>[];
  controls: readonly Readonly<{ row: number; action: ExplorerAction }>[];
  sections: readonly Readonly<{ name: Section; header: number; top: number; height: number; total: number; offset: number }>[];
}>;
export function createExplorerState(): ExplorerState {
  return { filesOpen: true, changesOpen: true, expanded: new Set(), filesOffset: 0, changesOffset: 0 };
}
export function reduceExplorer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  if (action.type === "toggle-section") return action.section === "files" ? { ...state, filesOpen: !state.filesOpen } : { ...state, changesOpen: !state.changesOpen };
  if (action.type === "scroll") return action.section === "files" ? { ...state, filesOffset: Math.max(0, state.filesOffset + action.delta) }
    : { ...state, changesOffset: Math.max(0, state.changesOffset + action.delta) };
  const expanded = new Set(state.expanded);
  if (!expanded.delete(action.path)) expanded.add(action.path);
  return { ...state, expanded, filesOffset: 0 };
}
const line = (text: string, tone: SidebarTone = "text"): SidebarLine => [{ text, tone }];
const rail = (text = "", tone: SidebarTone = "muted"): SidebarLine => [{ text: "┆  ", tone: "border" }, { text, tone }];
function fit(spans: SidebarLine, width: number): SidebarLine {
  let remaining = width;
  const result = [];
  for (const span of spans) {
    const text = clip(span.text, remaining);
    result.push({ ...span, text }); remaining -= Bun.stringWidth(text);
    if (text !== span.text || remaining <= 0) break;
  }
  return result;
}
export function explorerLayout(changes: ChangesState, files: FileListState, projectName: string, rows: number, columns: number, state: ExplorerState): ExplorerLayout {
  const height = Math.max(0, Math.floor(rows));
  const width = Math.max(0, Math.floor(columns));
  const entries = fileTree(files.paths, state.expanded);
  const diagnostics = files.error ? [rail("△ Files stale", "warning"), rail(safeDisplay(files.error), "warning")] : [];
  const fileLines = [...diagnostics, ...entries.map((entry) => rail(`${"  ".repeat(Math.min(entry.depth, Math.max(0, Math.floor((width - 8) / 2))))}${entry.kind === "directory" ? (state.expanded.has(entry.path) ? "▾ " : "▸ ") : "  "}${safeDisplay(entry.name)}`, entry.kind === "directory" ? "accent" : "text"))];
  if (!fileLines.length) fileLines.push(rail("No project files"));
  const changeContent = changesRows(changes, width);
  const lines: SidebarLine[] = [];
  const targets: { row: number; selection: PreviewSelection }[] = [];
  const controls: { row: number; action: ExplorerAction }[] = [];
  const sections: { name: Section; header: number; top: number; height: number; total: number; offset: number }[] = [];
  const branded = height >= 7;
  if (branded) lines.push(line("╭─ porclain/tree", "accent"), rail(safeDisplay(projectName) + "/"));
  const hasInitial = changes.changes.some((change) => changes.initialPaths.has(change.path));
  const footer = height >= 3 ? [
    ...(hasInitial && height >= 9 ? [rail(width < 26 ? "* before launch" : "* changed before launch")] : []),
    line("╰─ Ctrl+G  hide sidebar", "muted"),
  ] : [];
  const space = Math.max(0, height - lines.length - footer.length - 2);
  let filesHeight = state.filesOpen ? Math.min(fileLines.length, state.changesOpen ? Math.round(space * 0.6) : space) : 0;
  let changesHeight = state.changesOpen ? Math.min(changeContent.lines.length, space - filesHeight) : 0;
  filesHeight = state.filesOpen ? Math.min(fileLines.length, space - changesHeight) : 0;
  changesHeight = state.changesOpen ? Math.min(changeContent.lines.length, space - filesHeight) : 0;
  for (const name of ["files", "changes"] as const) {
    if (lines.length >= height - footer.length) break;
    const open = name === "files" ? state.filesOpen : state.changesOpen;
    const content = name === "files" ? fileLines : changeContent.lines;
    const size = name === "files" ? filesHeight : changesHeight;
    const offset = Math.min(Math.max(0, content.length - size), name === "files" ? state.filesOffset : state.changesOffset);
    const header = lines.length;
    const count = name === "files" ? files.paths.length : new Set(changes.changes.map((change) => change.path)).size;
    const stale = (name === "files" ? files.error : changes.error) ? " · stale" : "";
    const range = open && size && content.length > size ? ` · ${offset + 1}–${offset + size}/${content.length}` : "";
    lines.push(line(`${open ? "▾" : "▸"} ${name === "files" ? "Files" : "Changes"} · ${count}${stale}${range}`, "accent"));
    controls.push({ row: header, action: { type: "toggle-section", section: name } });
    const top = lines.length;
    sections.push({ name, header, top, height: size, total: content.length, offset });
    for (let index = offset; index < offset + size; index++) {
      const spans = content[index];
      if (!spans) continue;
      const row = lines.length; lines.push(spans);
      if (name === "changes") {
        const target = changeContent.targets.find((target) => target.row === index);
        if (target) targets.push({ row, selection: target.selection });
      } else {
        const entry = entries[index - diagnostics.length];
        if (entry?.kind === "directory") controls.push({ row, action: { type: "toggle-folder", path: entry.path } });
        else if (entry) targets.push({ row, selection: { path: entry.path, comparison: "file" } });
      }
    }
  }
  while (lines.length < height - footer.length) lines.push(rail());
  lines.push(...footer);
  return { lines: lines.slice(0, height).map((spans) => fit(spans, width)), targets, controls, sections };
}
