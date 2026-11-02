import { BoxRenderable, fg, StyledText, TextRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { DiffPreviewState } from "../diff-preview";
import { safeDisplay } from "./sidebar";
import type { SidebarTheme } from "./theme";

const comparisons = {
  staged: "Staged · index vs HEAD", unstaged: "Unstaged · worktree vs index",
  untracked: "Untracked · file vs empty", conflict: "Conflict · combined diff",
} as const;

function viewport(text: string, left: number, width: number): string {
  let column = 0;
  let visible = "";
  for (const part of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) {
    const size = Bun.stringWidth(part.segment);
    if (column >= left + width) return visible;
    if (column >= left && column + size <= left + width) visible += part.segment;
    else if (column < left && column + size > left) visible += " ".repeat(column + size - left);
    column += size;
  }
  return visible;
}

type MountedDiffPreview = Readonly<{
  isOpen: () => boolean;
  setState: (state: DiffPreviewState) => void;
  setTheme: (palette: SidebarTheme) => void;
  resize: (left: number, width: number, height: number) => void;
  handleKey: (key: KeyEvent) => void;
  dispose: () => void;
}>;

export function mountDiffPreview(renderer: CliRenderer, initialPalette: SidebarTheme, close: () => void): MountedDiffPreview {
  let state: DiffPreviewState = { kind: "closed" };
  let palette = initialPalette;
  let lines: readonly string[] = [];
  let offset = 0;
  let horizontal = 0;
  let maxWidth = 0;
  let columns = renderer.width;
  let rows = renderer.height;
  const box = new BoxRenderable(renderer, {
    id: "diff-preview", position: "absolute", left: 0, top: 0,
    width: renderer.width, height: renderer.height, zIndex: 20, visible: false,
    backgroundColor: palette.background, overflow: "hidden",
  });
  const heading = new TextRenderable(renderer, { id: "diff-heading", height: 3, width: "100%", wrapMode: "none", selectable: false });
  const body = new TextRenderable(renderer, { id: "diff-body", height: Math.max(0, renderer.height - 4), width: "100%", wrapMode: "none", selectable: false });
  const footer = new TextRenderable(renderer, { id: "diff-footer", height: 1, width: "100%", wrapMode: "none", selectable: false });
  const closeButton = new TextRenderable(renderer, {
    id: "diff-close", position: "absolute", right: 1, top: 0, width: 9, height: 1,
    content: "[ Close ]", selectable: false,
    onMouseDown(event) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); close();
    },
  });
  box.add(heading); box.add(body); box.add(footer); box.add(closeButton);
  renderer.root.add(box);
  const pageSize = () => Math.max(1, rows - 4);
  function render(): void {
    box.visible = state.kind !== "closed";
    if (state.kind === "closed") return;
    offset = Math.min(Math.max(0, lines.length - pageSize()), Math.max(0, offset));
    horizontal = Math.min(Math.max(0, maxWidth - columns), Math.max(0, horizontal));
    heading.content = new StyledText([
      fg(palette.text)("Diff snapshot\n"), fg(palette.accent)(comparisons[state.selection.comparison] + "\n"),
      fg(palette.muted)(safeDisplay(state.selection.path)),
    ]);
    body.content = new StyledText(lines.slice(offset, offset + pageSize()).flatMap((line, i) => {
      const color = state.kind === "error" ? palette.warning : line.startsWith("+") ? palette.added
        : line.startsWith("-") ? palette.deleted : line.startsWith("@@") ? palette.accent : palette.text;
      return [...(i ? [fg(palette.text)("\n")] : []), fg(color)(viewport(line, horizontal, columns))];
    }));
    footer.content = `Esc/q close · arrows scroll · ${lines.length ? offset + 1 : 0}–${Math.min(lines.length, offset + pageSize())}/${lines.length}`;
    box.backgroundColor = palette.background;
    for (const text of [heading, body, footer, closeButton]) { text.bg = palette.background; text.fg = palette.text; }
  }
  return {
    isOpen: () => state.kind !== "closed",
    setState(next: DiffPreviewState) {
      state = next; offset = 0; horizontal = 0;
      lines = next.kind === "ready" ? (next.text ? next.text.replace(/\n$/, "").split("\n").map((line) => safeDisplay(line.replace(/\t/g, "    "))) : ["No differences in this snapshot."])
        : next.kind === "loading" ? ["Loading diff…"] : next.kind === "error" ? [safeDisplay(next.error)] : [];
      maxWidth = lines.reduce((width, line) => Math.max(width, Bun.stringWidth(line)), 0);
      render();
    },
    setTheme(next: SidebarTheme) { palette = next; render(); },
    resize(left: number, width: number, height: number) {
      columns = Math.max(1, width); rows = Math.max(1, height);
      box.left = left; box.width = columns; box.height = rows;
      heading.height = Math.min(3, height); body.height = Math.max(0, height - 4); render();
    },
    handleKey(key: KeyEvent) {
      if (key.eventType === "release") return;
      if (key.name === "escape" || (!key.ctrl && !key.meta && key.name === "q")) close();
      else if (key.name === "left") { horizontal -= 16; render(); }
      else if (key.name === "right") { horizontal += 16; render(); }
      else if (key.name === "up") { offset--; render(); }
      else if (key.name === "down") { offset++; render(); }
      else if (key.name === "pageup") { offset -= pageSize(); render(); }
      else if (key.name === "pagedown") { offset += pageSize(); render(); }
      else if (key.name === "home") { offset = 0; render(); }
      else if (key.name === "end") { offset = lines.length; render(); }
    },
    dispose: () => box.destroyRecursively(),
  };
}
