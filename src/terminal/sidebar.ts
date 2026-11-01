import type { ChangesState } from "../git/status";

export type SidebarState = Readonly<{
  visible: boolean;
  lastToggleAt: number | null;
}>;

type SidebarAction = Readonly<{ type: "toggle"; at: number }> | Readonly<{ type: "input" }>;

export function sidebarColumns(columns: number, visible: boolean): number {
  return visible && columns >= 100 ? 28 : 0;
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

export function formatChanges(state: ChangesState, rows: number, columns = 26): string {
  const height = Math.max(0, Math.floor(rows));
  const header = ["PorclainTree", state.error ? "Git changes (stale)" : "Git changes", "X: index vs HEAD", "Y: worktree vs index"];
  if (state.error) header.push(safeDisplay(state.error));
  const footer = ["* dirty at launch", "Ctrl+G hide/show"];
  const available = Math.max(0, height - header.length - footer.length);
  const body: string[] = [];
  if (state.changes.length === 0) {
    if (available > 0) body.push(state.error ? "Last result: clean" : "No Git changes");
  } else {
    const visible = state.changes.length > available ? Math.max(0, available - 1) : available;
    for (const change of state.changes.slice(0, visible)) {
      const marker = state.initialPaths.has(change.path) ? "*" : " ";
      body.push(`${change.indexStatus}${change.worktreeStatus}${marker} ${clip(safeDisplay(change.path), columns - 4, "end")}`);
    }
    if (state.changes.length > visible && available > 0) body.push(`+ ${state.changes.length - visible} more`);
  }
  return [...header, ...body, ...footer].slice(0, height).map((line) => clip(line, columns)).join("\n");
}
