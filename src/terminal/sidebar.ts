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
  return row([{ text: "  ", tone: "border" }, { text, tone }]);
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
    { title: "Conflicts", detail: "combined diff", entries: conflicts },
    { title: "Unstaged", detail: "vs index", entries: unstaged },
    { title: "Staged", detail: "vs HEAD", entries: staged },
    { title: "Untracked", detail: "vs empty", entries: untracked },
  ].filter((group) => group.entries.length > 0);
}

export type PathBadge = Readonly<{ status: string; tone: SidebarTone; initial: boolean }>;

function statusTone(status: string): SidebarTone {
  if (status.includes("U") || status === "AA" || status === "DD") return "warning";
  if (status.includes("D")) return "deleted";
  if (status === "?" || status === "A") return "added";
  if (/[RC]/.test(status)) return "accent";
  return "modified";
}

export function changeBadge(change: Change, initial: boolean): PathBadge {
  const pair = change.indexStatus + change.worktreeStatus;
  const status = pair === "??" ? "?" : pair.trim();
  return { status, tone: statusTone(status), initial };
}

export function pathRow(name: string, directory: string, columns: number, badge?: PathBadge, prefix = "    ", tone: SidebarTone = "text"): SidebarLine {
  const width = Math.max(0, columns);
  const badgeWidth = badge ? Bun.stringWidth(badge.status) + (badge.initial ? 1 : 0) : 0;
  const contentWidth = Math.max(0, width - badgeWidth - (badge ? 1 : 0));
  const leading = clip(prefix, contentWidth);
  const filename = clip(safeDisplay(name), Math.max(0, contentWidth - Bun.stringWidth(leading)), "end");
  const spans = [{ text: leading, tone: "muted" as const }, { text: filename, tone }];
  let used = Bun.stringWidth(leading + filename);
  if (directory && contentWidth - used >= 4) {
    const parent = " " + clip(safeDisplay(directory), contentWidth - used - 1, "end");
    spans.push({ text: parent, tone: "muted" }); used += Bun.stringWidth(parent);
  }
  if (badge) {
    spans.push({ text: " ".repeat(Math.max(0, width - used - badgeWidth)), tone: "muted" });
    spans.push({ text: clip(badge.status, width), tone: badge.tone });
    if (badge.initial && width > Bun.stringWidth(badge.status)) spans.push({ text: "*", tone: "muted" });
  }
  return spans;
}

function entryLines(entry: Entry, initialPaths: ReadonlySet<string>, columns: number): readonly Row[] {
  const { change, status } = entry;
  const separator = parentSeparator(change.path);
  const selection: DiffSelection = { path: change.path, comparison: entry.comparison,
    ...(change.previousPath === undefined ? {} : { previousPath: change.previousPath }) };
  return [row(pathRow(change.path.slice(separator + 1), change.path.slice(0, separator + 1), columns,
    { status, tone: statusTone(status), initial: initialPaths.has(change.path) }), selection)];
}

function parentSeparator(path: string): number {
  return path.lastIndexOf("/", path.length - (path.endsWith("/") ? 2 : 1));
}

function changeLines(state: ChangesState, columns: number): readonly Row[] {
  if (state.changes.length === 0) return state.error ? [continuation("Last result: clean")]
    : [continuation("Working tree clean", "text"), continuation("Changes will appear here.")];
  return groupChanges(state.changes).flatMap((group, index) => [
    ...(index ? [continuation()] : []),
    row([{ text: `  ${group.title} · ${group.detail}`, tone: "muted" }]),
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
