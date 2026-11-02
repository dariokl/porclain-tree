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

function clip(text: string, columns: number, keep: "start" | "end" = "start"): string {
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

type Entry = Readonly<{ change: Change; status: string }>;
type Group = Readonly<{ title: string; detail: string; entries: readonly Entry[] }>;

function line(text: string, tone: SidebarTone = "text", bold = false): SidebarLine {
  return [{ text, tone, bold }];
}

function continuation(text = "", tone: SidebarTone = "muted"): SidebarLine {
  return [{ text: text ? "┆  " : "┆", tone: "border" }, ...line(text, tone)];
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
      conflicts.push({ change, status: pair });
    } else if (pair === "??") {
      untracked.push({ change, status: "?" });
    } else {
      if (change.worktreeStatus !== " ") unstaged.push({ change, status: change.worktreeStatus });
      if (change.indexStatus !== " ") staged.push({ change, status: change.indexStatus });
    }
  }
  return [
    { title: "Conflicts", detail: "unmerged paths", entries: conflicts },
    { title: "Unstaged", detail: "vs index", entries: unstaged },
    { title: "Staged", detail: "vs HEAD", entries: staged },
    { title: "Untracked", detail: "outside the index", entries: untracked },
  ].filter((group) => group.entries.length > 0);
}

function entryLines(entry: Entry, initialPaths: ReadonlySet<string>, columns: number): readonly SidebarLine[] {
  const { change, status } = entry;
  const separator = parentSeparator(change.path);
  const name = safeDisplay(change.path.slice(separator + 1));
  const directory = safeDisplay(change.path.slice(0, separator + 1));
  const prefixWidth = 3 + status.length + 2;
  const filename = clip(name, Math.max(0, columns - prefixWidth), "end");
  const tone: SidebarTone = status.length > 1 ? "warning" : status === "D" ? "deleted"
    : status === "?" || status === "A" ? "added" : status === "R" || status === "C" ? "accent" : "modified";
  const rows: SidebarLine[] = [[
    { text: "┆  ", tone: "border" },
    { text: status, tone },
    { text: initialPaths.has(change.path) ? "* " : "  ", tone: "muted" },
    { text: filename, tone: "text" },
  ]];
  if (directory) rows.push([
    { text: "┆" + " ".repeat(prefixWidth - 1), tone: "border" },
    { text: clip(directory, Math.max(0, columns - prefixWidth), "end"), tone: "muted" },
  ]);
  return rows;
}

function parentSeparator(path: string): number {
  return path.lastIndexOf("/", path.length - (path.endsWith("/") ? 2 : 1));
}

function changeLines(state: ChangesState, available: number, columns: number): readonly SidebarLine[] {
  if (available <= 0) return [];
  if (state.changes.length === 0) {
    if (state.error) return [continuation("Last result: clean")];
    return [
      ...(available >= 3 ? [continuation("·", "accent")] : []),
      continuation("Working tree clean", "text"), continuation("Changes will appear here."),
    ].slice(0, available);
  }
  const groups = groupChanges(state.changes);
  const totalEntries = groups.reduce((count, group) => count + group.entries.length, 0);
  const totalRows = groups.reduce((count, group) => count + 2
    + group.entries.reduce((size, entry) => size + (parentSeparator(entry.change.path) >= 0 ? 2 : 1), 0), 0)
    + Math.max(0, groups.length - 1);
  const limit = totalRows > available ? available - 1 : available;
  const body: SidebarLine[] = [];
  let shown = 0;
  outer: for (const group of groups) {
    const gap = body.length > 0 ? 1 : 0;
    const first = group.entries[0];
    const firstHeight = first && parentSeparator(first.change.path) >= 0 ? 2 : 1;
    if (!first || body.length + gap + 2 + firstHeight > limit) break;
    if (gap) body.push(continuation());
    body.push([
      { text: "├─ ", tone: "accent" },
      { text: `${group.title.toLowerCase()} · ${group.entries.length}`, tone: "accent" },
    ], continuation(group.detail));
    for (const entry of group.entries) {
      const needed = parentSeparator(entry.change.path) >= 0 ? 2 : 1;
      if (body.length + needed > limit) break outer;
      body.push(...entryLines(entry, state.initialPaths, columns));
      shown++;
    }
  }
  if (shown < totalEntries) body.push(continuation(`+ ${totalEntries - shown} more entries`));
  return body;
}

export function formatSidebar(
  state: ChangesState,
  projectName: string,
  rows: number,
  columns: number,
): readonly SidebarLine[] {
  const height = Math.max(0, Math.floor(rows));
  const width = Math.max(0, Math.floor(columns));
  if (height === 0) return [];
  const title: SidebarLine = [
    { text: "╭─ ", tone: "accent" },
    { text: "porclain", tone: "text", bold: true },
    { text: "/", tone: "accent", bold: true },
    { text: "tree", tone: "text", bold: true },
  ];
  const count = String(new Set(state.changes.map((change) => change.path)).size);
  const shortcut: SidebarLine = [{ text: "╰─ ", tone: "accent" }, { text: "Ctrl+G", tone: "text" }, { text: "  hide sidebar", tone: "muted" }];
  if (height < 5) {
    if (height === 1) return [fitLine(title, width)];
    if (state.error && height >= 3) {
      return [line("╭─ stale / last result", "warning"),
        ...(height === 4 ? [continuation("△ Git unavailable", "warning")] : []),
        continuation(safeDisplay(state.error), "warning"), shortcut].map((row) => fitLine(row, width));
    }
    const top = [title, continuation(state.error ? "Git stale" : `${count} Git changes`, state.error ? "warning" : "muted")].slice(0, height - 1);
    const gap = Array.from({ length: height - top.length - 1 }, () => continuation(state.error ? safeDisplay(state.error) : "", "warning"));
    return [...top, ...gap, shortcut].map((row) => fitLine(row, width));
  }
  const compact = height < 16;
  const heading = continuation(state.error && height < 8 ? `last result · ${count}` : `${count} changed path${count === "1" ? "" : "s"}`);
  const project = safeDisplay(projectName);
  const header = compact ? [title, heading] : [line(""), title,
    continuation(project.endsWith("/") ? project : `${project}/`), continuation(), heading, continuation()];
  const hasInitial = state.changes.some((change) => state.initialPaths.has(change.path));
  const footer: SidebarLine[] = [];
  if (hasInitial && height >= 8) footer.push(continuation(compact || width < 26 ? "* before launch" : "* changed before launch"));
  if (state.error) {
    footer.push(continuation("△ Git unavailable", "warning"));
    if (height >= 8) footer.push(continuation("Showing last result"));
    footer.push(continuation(safeDisplay(state.error), "warning"));
  } else if (!compact) {
    footer.push(continuation("Git refresh · ~1s"));
  }
  footer.push(shortcut);
  if (!compact) footer.push(line(""));
  const available = Math.max(0, height - header.length - footer.length);
  const body = changeLines(state, available, width);
  const padding = Array.from({ length: Math.max(0, available - body.length) }, () => continuation());
  return [...header, ...body, ...padding, ...footer].slice(0, height).map((row) => fitLine(row, width));
}
