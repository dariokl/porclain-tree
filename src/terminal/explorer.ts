import type { FileListState } from "../files/tree";
import { fileTree } from "../files/tree";
import type { ChangesState } from "../git/status";
import type { PreviewSelection } from "../preview";
import { changeBadge, changesRows, clip, pathRow, safeDisplay } from "./sidebar";
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
const rail = (text = "", tone: SidebarTone = "muted"): SidebarLine => [{ text: text ? "  " : "", tone: "muted" }, { text, tone }];
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
  const badges = new Map(changes.changes.map((change) => [change.path, changeBadge(change, changes.initialPaths.has(change.path))]));
  const fileLines = [...diagnostics, ...entries.map((entry) => {
    const folder = entry.kind === "directory";
    // Reserve a readable filename plus the widest Git/launch badge before nesting.
    const indent = "  ".repeat(Math.min(entry.depth, Math.max(0, Math.floor((width - 18) / 2))));
    const prefix = folder ? `  ${indent}${state.expanded.has(entry.path) ? "▾" : "▸"} ` : `    ${indent}`;
    return pathRow(entry.name, "", width, folder ? undefined : badges.get(entry.path), prefix, folder ? "accent" : "text");
  })];
  if (!fileLines.length) fileLines.push(rail("No project files"));
  const changeContent = changesRows(changes, width);
  const lines: SidebarLine[] = [];
  const targets: { row: number; selection: PreviewSelection }[] = [];
  const controls: { row: number; action: ExplorerAction }[] = [];
  const sections: { name: Section; header: number; top: number; height: number; total: number; offset: number }[] = [];
  if (height >= 7) lines.push(line(safeDisplay(projectName), "muted"));
  const hasInitial = changes.changes.some((change) => changes.initialPaths.has(change.path));
  const footer = hasInitial && height >= 8 ? [rail("* before launch")] : [];
  const separator = height >= 8 ? 1 : 0;
  const space = Math.max(0, height - lines.length - footer.length - 2 - separator);
  let filesHeight = state.filesOpen ? Math.min(fileLines.length, state.changesOpen ? Math.round(space * 0.6) : space) : 0;
  let changesHeight = state.changesOpen ? Math.min(changeContent.lines.length, space - filesHeight) : 0;
  filesHeight = state.filesOpen ? Math.min(fileLines.length, space - changesHeight) : 0;
  changesHeight = state.changesOpen ? Math.min(changeContent.lines.length, space - filesHeight) : 0;
  for (const name of ["files", "changes"] as const) {
    if (name === "changes" && separator) lines.push(line(""));
    if (lines.length >= height - footer.length) break;
    const open = name === "files" ? state.filesOpen : state.changesOpen;
    const content = name === "files" ? fileLines : changeContent.lines;
    const size = name === "files" ? filesHeight : changesHeight;
    const offset = Math.min(Math.max(0, content.length - size), name === "files" ? state.filesOffset : state.changesOffset);
    const header = lines.length;
    const count = name === "files" ? files.paths.length : new Set(changes.changes.map((change) => change.path)).size;
    const stale = (name === "files" ? files.error || changes.error : changes.error) ? " · stale" : "";
    const range = open && size && content.length > size ? ` · ${offset + 1}–${offset + size}/${content.length}` : "";
    const label = `${open ? "▾" : "▸"} ${name === "files" ? "Files" : "Changes"}`;
    const countText = String(count);
    const left = fit([{ text: label, tone: "text", bold: true }, { text: stale, tone: "warning" }, { text: range, tone: "muted" }], Math.max(0, width - countText.length - 1));
    const used = left.reduce((sum, span) => sum + Bun.stringWidth(span.text), 0);
    lines.push([...left, { text: " ".repeat(Math.max(0, width - used - countText.length)) + countText, tone: "muted" }]);
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
