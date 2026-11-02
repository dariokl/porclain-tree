import { bg, BoxRenderable, CodeRenderable, fg, LineNumberRenderable, StyledText, SyntaxStyle, TextRenderable, treeSitterToTextChunks } from "@opentui/core";
import type { CliRenderer, KeyEvent, SimpleHighlight, TextChunk } from "@opentui/core";
import type { PreviewState } from "../preview";
import { safeDisplay } from "./sidebar";
import { sidebarTheme } from "./theme";
import type { SidebarTheme } from "./theme";
import { createPreviewSyntax, previewLanguage } from "./syntax";
import { diffPreview } from "./diff-preview";
import type { DiffPreview } from "./diff-preview";

const comparisons = {
  file: "Working-tree contents",
  staged: "Staged · index vs HEAD", unstaged: "Unstaged · worktree vs index",
  untracked: "Untracked · file vs empty", conflict: "Conflict · combined diff",
} as const;

function chunkLines(chunks: readonly TextChunk[]): readonly (readonly TextChunk[])[] {
  const result: TextChunk[][] = [[]];
  for (const chunk of chunks) {
    const parts = chunk.text.split("\n");
    parts.forEach((text, index) => {
      if (index) result.push([]);
      if (text) result[result.length - 1]?.push({ ...chunk, text });
    });
  }
  return result;
}

// Clip the complete line by grapheme, then retain each token's style. A token
// boundary must never split a combining mark or half of a wide terminal cell.
function chunkViewport(chunks: readonly TextChunk[], left: number, width: number): readonly TextChunk[] {
  const result: TextChunk[] = [];
  let column = 0, index = 0, end = chunks[0]?.text.length ?? 0;
  for (const part of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(chunks.map((chunk) => chunk.text).join(""))) {
    if (column >= left + width) break;
    while (part.index >= end && index < chunks.length - 1) { index++; end += chunks[index]?.text.length ?? 0; }
    const size = Bun.stringWidth(part.segment);
    const text = column >= left && column + size <= left + width ? part.segment
      : column < left && column + size > left ? " ".repeat(Math.min(width, column + size - left)) : "";
    const chunk = chunks[index];
    if (text && chunk) {
      const previous = result.at(-1);
      if (previous && previous.fg === chunk.fg && previous.attributes === chunk.attributes) previous.text += text;
      else result.push({ ...chunk, text });
    }
    column += size;
  }
  return result;
}

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

type MountedPreview = Readonly<{
  isOpen: () => boolean;
  setState: (state: PreviewState) => void;
  setTheme: (palette: SidebarTheme) => void;
  resize: (left: number, width: number, height: number) => void;
  handleKey: (key: KeyEvent) => void;
  dispose: () => Promise<void>;
}>;

export function mountPreview(renderer: CliRenderer, initialPalette: SidebarTheme, close: () => void): MountedPreview {
  let state: PreviewState = { kind: "closed" };
  let palette = initialPalette;
  let lines: readonly string[] = [];
  let offset = 0;
  let horizontal = 0;
  let maxWidth = 0;
  let columns = renderer.width;
  let rows = renderer.height;
  let generation = 0;
  let disposed = false;
  let rich: CodeRenderable | undefined;
  let numbered: LineNumberRenderable | undefined;
  let code: CodeRenderable | undefined;
  let syntaxUnavailable = false;
  let diff: DiffPreview | undefined;
  let diffDigits = 1;
  let diffHighlights: Readonly<{ old: SimpleHighlight[]; next: SimpleHighlight[] }> = { old: [], next: [] };
  let oldRows: readonly (readonly TextChunk[])[] = [], newRows: readonly (readonly TextChunk[])[] = [];
  const syntax = createPreviewSyntax();
  const styles = new Map(["dark", "light"].map((mode) => {
    const theme = sidebarTheme(mode === "light" ? "light" : "dark");
    return [theme.background, SyntaxStyle.fromStyles(Object.fromEntries(Object.entries(theme.syntax).map(([name, color]) => [name, { fg: color }])), renderer.nativeScene)] as const;
  }));
  function syntaxStyle(): SyntaxStyle {
    const style = styles.get(palette.background);
    if (!style) throw new Error("Unknown preview theme");
    return style;
  }
  const box = new BoxRenderable(renderer, {
    id: "preview-preview", position: "absolute", left: 0, top: 0,
    width: renderer.width, height: renderer.height, zIndex: 20, visible: false,
    backgroundColor: palette.background, overflow: "hidden",
  });
  const heading = new TextRenderable(renderer, { id: "preview-heading", height: 3, width: "100%", wrapMode: "none", selectable: false });
  const content = new BoxRenderable(renderer, { id: "preview-content", height: Math.max(0, renderer.height - 4), width: "100%", overflow: "hidden" });
  const body = new TextRenderable(renderer, { id: "preview-body", height: "100%", width: "100%", wrapMode: "none", selectable: false });
  content.add(body);
  content.onMouseScroll = (event) => {
    if (!event.scroll) return;
    const { direction, delta } = event.scroll;
    if (code) {
      // Code consumes wheel events before they bubble here. The gutter needs
      // the same movement; then keep keyboard navigation and the footer in sync.
      if (event.target !== code) {
        if (direction === "up") code.scrollY -= delta;
        else if (direction === "down") code.scrollY += delta;
        else if (direction === "left") code.scrollX -= delta;
        else if (direction === "right") code.scrollX += delta;
      }
      offset = code.scrollY; horizontal = code.scrollX;
    } else {
      if (direction === "up") offset -= delta;
      else if (direction === "down") offset += delta;
      else if (direction === "left") horizontal -= delta;
      else if (direction === "right") horizontal += delta;
    }
    event.preventDefault(); event.stopPropagation(); render();
  };
  const footer = new TextRenderable(renderer, { id: "preview-footer", height: 1, width: "100%", wrapMode: "none", selectable: false });
  const closeButton = new TextRenderable(renderer, {
    id: "preview-close", position: "absolute", right: 1, top: 0, width: 9, height: 1,
    content: "[ Close ]", selectable: false,
    onMouseDown(event) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); close();
    },
  });
  box.add(heading); box.add(content); box.add(footer); box.add(closeButton);
  renderer.root.add(box);
  const pageSize = () => Math.max(1, rows - 4);
  function render(): void {
    box.visible = state.kind !== "closed";
    if (state.kind === "closed") return;
    const comparison = state.selection.comparison;
    const total = code?.lineCount ?? lines.length;
    offset = Math.min(Math.max(0, total - pageSize()), Math.max(0, offset));
    horizontal = Math.max(0, horizontal);
    if (code) {
      code.scrollY = offset; code.scrollX = horizontal;
      offset = code.scrollY; horizontal = code.scrollX;
    } else horizontal = Math.min(Math.max(0, maxWidth - columns + (diff ? diffDigits + 4 : 0)), horizontal);
    const language = previewLanguage(state.selection.path);
    const label = syntaxUnavailable ? "Plain text · highlighting unavailable" : language?.name ?? "Plain text";
    heading.content = new StyledText([
      fg(palette.text)(comparison === "file" ? `File snapshot · ${label}\n` : `Diff snapshot · ${diff ? label : "Raw diff"}\n`), fg(palette.accent)(comparisons[state.selection.comparison] + "\n"),
      fg(palette.muted)(safeDisplay(state.selection.path)),
    ]);
    body.content = diff ? new StyledText(diff.rows.slice(offset, offset + pageSize()).flatMap((row, i) => {
      const background = row.kind === "added" ? palette.addedBackground : row.kind === "deleted" ? palette.deletedBackground : palette.background;
      const sign = row.kind === "added" ? "+" : row.kind === "deleted" ? "-" : " ";
      const prefix = row.number === null ? "" : ` ${String(row.number).padStart(diffDigits)} ${sign} `;
      const color = row.kind === "meta" ? row.text.startsWith("@@") ? palette.accent : palette.muted : palette.text;
      const source = row.sourceLine === null ? undefined : (row.kind === "deleted" ? oldRows : newRows)[row.sourceLine];
      const visible = chunkViewport(source ?? [fg(color)(row.text)], horizontal, Math.max(0, columns - prefix.length));
      const used = prefix.length + visible.reduce((sum, chunk) => sum + Bun.stringWidth(chunk.text), 0);
      const signColor = row.kind === "added" ? palette.added : row.kind === "deleted" ? palette.deleted : palette.muted;
      return [...(i ? [fg(palette.text)("\n")] : []), bg(background)(fg(signColor)(prefix)),
        ...visible.map((chunk) => bg(background)(chunk.fg ? chunk : fg(color)(chunk))), bg(background)(fg(color)(" ".repeat(Math.max(0, columns - used))))];
    })) : new StyledText(lines.slice(offset, offset + pageSize()).flatMap((line, i) => {
      const color = state.kind === "error" ? palette.warning : comparison === "file" ? palette.text : line.startsWith("+") ? palette.added
        : line.startsWith("-") ? palette.deleted : line.startsWith("@@") ? palette.accent : palette.text;
      return [...(i ? [fg(palette.text)("\n")] : []), fg(color)(viewport(line, horizontal, columns))];
    }));
    footer.content = `Esc/q close · arrows scroll · ${total ? offset + 1 : 0}–${Math.min(total, offset + pageSize())}/${total}`;
    box.backgroundColor = palette.background;
    for (const text of [heading, body, footer, closeButton]) { text.bg = palette.background; text.fg = palette.text; }
  }
  function clearRich(): void {
    if (numbered) numbered.destroyRecursively();
    else rich?.destroyRecursively();
    numbered = undefined; rich = undefined; code = undefined; body.visible = true;
    diff = undefined; oldRows = []; newRows = []; diffHighlights = { old: [], next: [] };
    syntax.clearPending();
  }
  function styleDiff(): void {
    if (!diff) return;
    oldRows = chunkLines(treeSitterToTextChunks(diff.oldText, diffHighlights.old, syntaxStyle(), { enabled: false }));
    newRows = chunkLines(treeSitterToTextChunks(diff.newText, diffHighlights.next, syntaxStyle(), { enabled: false }));
  }
  function mountRich(): void {
    if (state.kind !== "ready" || !state.text) return;
    const options = { id: "preview-code", width: "100%" as const, height: "100%" as const, wrapMode: "none" as const,
      syntaxStyle: syntaxStyle(), treeSitterClient: syntax.client, conceal: false, fg: palette.text };
    if (state.selection.comparison === "file") {
      rich = new CodeRenderable(renderer, { ...options, content: lines.join("\n"), bg: palette.background, selectable: false });
      numbered = new LineNumberRenderable(renderer, { id: "preview-numbers", width: "100%", height: "100%", target: rich, fg: palette.muted, bg: palette.background });
      content.add(numbered);
      code = rich; body.visible = false;
    } else if (state.selection.comparison !== "conflict") {
      diff = diffPreview(lines);
      if (diff) {
        diffDigits = diff.rows.reduce((digits, row) => Math.max(digits, String(row.number ?? "").length), 1);
        styleDiff();
      }
    }
    if (!rich && !diff) return;
    const language = previewLanguage(state.selection.path);
    if (!language) return;
    const current = generation;
    // First paint stays plain and usable while the local parser initializes.
    void syntax.initialize().then(async () => {
      if (disposed || current !== generation) return;
      if (rich) { rich.filetype = language.filetype; return; }
      const document = diff;
      if (!document) return;
      const old = document.oldText ? await syntax.client.highlightOnce(document.oldText, language.filetype) : { highlights: [] };
      if (disposed || current !== generation) return;
      const next = document.newText ? await syntax.client.highlightOnce(document.newText, language.filetype) : { highlights: [] };
      if (disposed || current !== generation) return;
      syntaxUnavailable = Boolean(old.error || old.warning || next.error || next.warning);
      diffHighlights = { old: old.highlights ?? [], next: next.highlights ?? [] };
      styleDiff(); render();
    }).catch(() => {
      if (!disposed && current === generation) { syntaxUnavailable = true; render(); }
    });
  }
  return {
    isOpen: () => state.kind !== "closed",
    setState(next: PreviewState) {
      if (disposed) return;
      generation++; clearRich(); syntaxUnavailable = false;
      state = next; offset = 0; horizontal = 0;
      lines = next.kind === "ready" ? (next.text ? next.text.replace(/\n$/, "").split("\n").map((line) => safeDisplay(line.replace(/\t/g, "    "))) : [next.selection.comparison === "file" ? "(Empty file.)" : "No differences in this snapshot."])
        : next.kind === "loading" ? [next.selection.comparison === "file" ? "Loading file…" : "Loading diff…"] : next.kind === "error" ? [safeDisplay(next.error)] : [];
      maxWidth = lines.reduce((width, line) => Math.max(width, Bun.stringWidth(line)), 0);
      mountRich();
      render();
    },
    setTheme(next: SidebarTheme) {
      if (disposed) return;
      palette = next;
      if (rich) { rich.syntaxStyle = syntaxStyle(); rich.fg = palette.text; }
      if (rich) rich.bg = palette.background;
      if (code) code.fg = palette.text;
      if (numbered) { numbered.fg = palette.muted; numbered.bg = palette.background; }
      styleDiff();
      render();
    },
    resize(left: number, width: number, height: number) {
      columns = Math.max(1, width); rows = Math.max(1, height);
      box.left = left; box.width = columns; box.height = rows;
      heading.height = Math.min(3, height); content.height = Math.max(0, height - 4); render();
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
    async dispose() {
      if (disposed) return;
      disposed = true; generation++;
      syntax.clearPending();
      box.destroyRecursively();
      await syntax.client.destroy();
      for (const style of styles.values()) style.destroy();
    },
  };
}
