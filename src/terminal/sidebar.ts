import type { DiffSelection } from "../git/diff";
import type { Change, ChangesState } from "../git/status";

export type SidebarState = Readonly<{
  visible: boolean;
  lastToggleAt: number | null;
}>;

type SidebarAction = Readonly<{ type: "toggle"; at: number }> | Readonly<{ type: "input" }>;

export function sidebarColumns(columns: number, visible: boolean): number {
  return !visible || columns < 100 ? 0 : columns >= 120 ? 34 : 28;
}

export function reduceSidebar(
  state: SidebarState,
  action: SidebarAction,
): Readonly<{ state: SidebarState; sendControlG: boolean }> {
  if (action.type === "input") {
    return { state: { ...state, lastToggleAt: null }, sendControlG: false };
  }
  const doubleToggle = state.lastToggleAt !== null
    && action.at - state.lastToggleAt <= 300;
  return {
    state: { visible: !state.visible, lastToggleAt: doubleToggle ? null : action.at },
    sendControlG: doubleToggle,
  };
}

export function safeDisplay(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`;
  });
}

export function clip(text: string, columns: number, keep: "start" | "end" = "start"): string {
  if (columns <= 0) return "";
  if (Bun.stringWidth(text) <= columns) return text;
  const segments = Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text), (part) => part.segment);
  if (keep === "end") segments.reverse();
  let visible = "";
  for (const segment of segments) {
    const next = keep === "end" ? segment + visible : visible + segment;
    if (Bun.stringWidth(next) > columns - 1) break;
    visible = next;
  }
  return keep === "end" ? `…${visible}` : `${visible}…`;
}

export type SidebarTone = "text" | "muted" | "border" | "accent" | "added" | "modified" | "deleted" | "warning";
type SidebarSpan = Readonly<{ text: string; tone: SidebarTone; bold?: boolean }>;
export type SidebarLine = readonly SidebarSpan[];

type Entry = Readonly<{ change: Change; status: string; comparison: DiffSelection["comparison"] }>;
type Group = Readonly<{ title: string; detail: string; entries: readonly Entry[] }>;

type Row = Readonly<{ spans: SidebarLine; selection: DiffSelection | null }>;
export type SidebarLayout = Readonly<{
  lines: readonly SidebarLine[];
  targets: readonly Readonly<{ row: number; selection: DiffSelection }>[];
}>;
function row(spans: SidebarLine, selection: DiffSelection | null = null): Row { return { spans, selection }; }
function layout(rows: readonly Row[], columns: number): SidebarLayout {
  return {
    lines: rows.map((value) => fitLine(value.spans, columns)),
    targets: rows.flatMap((value, index) => value.selection ? [{ row: index, selection: value.selection }] : []),
  };
}

function continuation(text = "", tone: SidebarTone = "muted"): Row {
  return row([{ text: text ? "┆  " : "┆", tone: "border" }, { text, tone }]);
}

function fitLine(spans: SidebarLine, columns: number): SidebarLine {
  const fitted: SidebarSpan[] = [];
  let remaining = columns;
  for (const span of spans) {
    if (remaining <= 0) break;
    const text = clip(span.text, remaining);
    fitted.push({ ...span, text });
    remaining -= Bun.stringWidth(text);
    if (text !== span.text) break;
  }
  return fitted;
}

function groupChanges(changes: readonly Change[]): readonly Group[] {
  const conflicts: Entry[] = [];
  const unstaged: Entry[] = [];
  const staged: Entry[] = [];
  const untracked: Entry[] = [];
  for (const change of changes) {
    const pair = change.indexStatus + change.worktreeStatus;
    if (pair.includes("U") || pair === "AA" || pair === "DD") {
      conflicts.push({ change, status: pair, comparison: "conflict" });
    } else if (pair === "??") {
      untracked.push({ change, status: "?", comparison: "untracked" });
    } else {
      if (change.worktreeStatus !== " ") unstaged.push({ change, status: change.worktreeStatus, comparison: "unstaged" });
      if (change.indexStatus !== " ") staged.push({ change, status: change.indexStatus, comparison: "staged" });
    }
  }
  return [
    { title: "Conflicts", detail: "unmerged paths", entries: conflicts },
    { title: "Unstaged", detail: "vs index", entries: unstaged },
    { title: "Staged", detail: "vs HEAD", entries: staged },
    { title: "Untracked", detail: "outside the index", entries: untracked },
  ].filter((group) => group.entries.length > 0);
}

function entryLines(entry: Entry, initialPaths: ReadonlySet<string>, columns: number): readonly Row[] {
  const { change, status } = entry;
  const separator = parentSeparator(change.path);
  const name = safeDisplay(change.path.slice(separator + 1));
  const directory = safeDisplay(change.path.slice(0, separator + 1));
  const prefixWidth = 3 + status.length + 2;
  const filename = clip(name, Math.max(0, columns - prefixWidth), "end");
  const tone: SidebarTone = status.length > 1 ? "warning" : status === "D" ? "deleted"
    : status === "?" || status === "A" ? "added" : status === "R" || status === "C" ? "accent" : "modified";
  const selection: DiffSelection = { path: change.path, comparison: entry.comparison,
    ...(change.previousPath === undefined ? {} : { previousPath: change.previousPath }) };
  const rows: Row[] = [row([
    { text: "┆  ", tone: "border" },
    { text: status, tone },
    { text: initialPaths.has(change.path) ? "* " : "  ", tone: "muted" },
    { text: filename, tone: "text" },
  ], selection)];
  if (directory) rows.push(row([
    { text: "┆" + " ".repeat(prefixWidth - 1), tone: "border" },
    { text: clip(directory, Math.max(0, columns - prefixWidth), "end"), tone: "muted" },
  ], selection));
  return rows;
}

function parentSeparator(path: string): number {
  return path.lastIndexOf("/", path.length - (path.endsWith("/") ? 2 : 1));
}

function changeLines(state: ChangesState, columns: number): readonly Row[] {
  if (state.changes.length === 0) return state.error ? [continuation("Last result: clean")]
    : [continuation("Working tree clean", "text"), continuation("Changes will appear here.")];
  return groupChanges(state.changes).flatMap((group, index) => [
    ...(index ? [continuation()] : []),
    row([{ text: "├─ ", tone: "accent" }, { text: `${group.title.toLowerCase()} · ${group.entries.length}`, tone: "accent" }]),
    continuation(group.detail),
    ...group.entries.flatMap((entry) => entryLines(entry, state.initialPaths, columns)),
  ]);
}

export function changesRows(state: ChangesState, columns: number): SidebarLayout {
  const bounded = { ...state, changes: state.changes.slice(0, 10_000) };
  return layout([
    ...(state.error ? [continuation("△ Git unavailable", "warning"), continuation("Showing last result"), continuation(safeDisplay(state.error), "warning")] : []),
    ...changeLines(bounded, columns),
    ...(state.changes.length > bounded.changes.length ? [continuation(`+ ${state.changes.length - bounded.changes.length} entries beyond limit`, "warning")] : []),
  ], columns);
}
