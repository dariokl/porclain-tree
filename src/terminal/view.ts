import { bg, bold, BoxRenderable, EmbeddedTerminalRenderable, fg, InputRenderable, KeyEvent, StyledText, TextRenderable } from "@opentui/core";
import type { CliRenderer, PasteEvent } from "@opentui/core";
import type { PreviewState, PreviewSelection } from "../preview";
import type { FileListState } from "../files/tree";
import { createExplorerState, explorerLayout, reduceExplorer } from "./explorer";
import type { ExplorerLayout } from "./explorer";
import { mountPreview } from "./preview";
import type { CommandSpec } from "../command";
import type { ChangesState } from "../git/status";
import { startPty } from "./pty";
import type { PtySession } from "./pty";
import { reduceSidebar, sidebarColumns } from "./sidebar";
import type { SidebarState } from "./sidebar";
import { sidebarTheme } from "./theme";
import type { SidebarTheme } from "./theme";

function sidebarText(content: ExplorerLayout, palette: SidebarTheme, active: PreviewSelection | null, width: number): StyledText {
  const activeRows = new Set(content.targets.filter(({ selection }) => active !== null && selection.path === active.path
    && selection.comparison === active.comparison).map(({ row }) => row));
  return new StyledText(content.lines.flatMap((line, index) => {
    const selected = activeRows.has(index);
    const spans = line.map((span) => {
      const chunk = fg(palette[span.tone])(span.text);
      const styled = span.bold || (selected && span.tone === "text") ? bold(chunk) : chunk;
      return selected ? bg(palette.activeBackground)(styled) : styled;
    });
    const padding = selected ? Math.max(0, width - line.reduce((sum, span) => sum + Bun.stringWidth(span.text), 0)) : 0;
    return [
      ...(index > 0 ? [fg(palette.text)("\n")] : []), ...spans,
      ...(padding ? [bg(palette.activeBackground)(" ".repeat(padding))] : []),
    ];
  }));
}

type MountedTerminal = Readonly<{
  exited: Promise<number>;
  setChanges: (state: ChangesState) => void;
  setFiles: (state: FileListState) => void;
  setPreview: (state: PreviewState) => void;
  dispose: () => Promise<void>;
}>;

export function mountTerminal(
  renderer: CliRenderer,
  command: CommandSpec,
  cwd: string,
  initialChanges: ChangesState,
  projectName: string,
  themeMode: "light" | "dark" = "dark",
  selectPreview: (selection: PreviewSelection | null) => void = () => {},
  initialFiles: FileListState = { paths: [], error: null },
): MountedTerminal {
  let state: SidebarState = { visible: true, lastToggleAt: null };
  let changes = initialChanges;
  let files = initialFiles;
  let explorer = createExplorerState();
  let active: PreviewSelection | null = null;
  let selectedTheme = themeMode;
  let palette = sidebarTheme(selectedTheme);
  let child: PtySession | undefined;
  let content = explorerLayout(changes, files, projectName, Math.max(0, renderer.height - 1), Math.max(0, sidebarColumns(renderer.width, true) - 5), explorer);
  const layout = new BoxRenderable(renderer, {
    id: "workspace", width: "100%", height: "100%", flexDirection: "row",
  });
  const terminal = new EmbeddedTerminalRenderable(renderer, {
    id: "child", width: Math.max(1, renderer.width - sidebarColumns(renderer.width, true)),
    height: Math.max(1, renderer.height), maxScrollback: 10_000,
    onData: (bytes) => child?.write(bytes),
    onTerminalResize: (cols, rows) => child?.resize(cols, rows),
  });
  const sidebar = new BoxRenderable(renderer, {
    id: "sidebar", width: sidebarColumns(renderer.width, true), height: "100%",
    flexDirection: "column",
    flexShrink: 0, border: ["right"], borderColor: palette.border,
    backgroundColor: palette.background, paddingLeft: 2, paddingRight: 2, overflow: "hidden",
  });
  const switchText = () => new StyledText([
    fg(selectedTheme === "dark" ? palette.text : palette.muted)("Dark "),
    fg(palette.accent)(selectedTheme === "dark" ? "[●──]" : "[──●]"),
    fg(selectedTheme === "light" ? palette.text : palette.muted)(" Light"),
  ]);
  const themeSwitch = new TextRenderable(renderer, {
    id: "theme-switch", width: 16, height: 1, flexShrink: 0,
    content: switchText(), bg: palette.background, selectable: false,
    onMouseDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectedTheme = selectedTheme === "dark" ? "light" : "dark";
      updateTheme();
      terminal.focus();
    },
  });
  function scrollExplorer(row: number, delta: number): boolean {
    const section = content.sections.find((section) => row >= section.header && row < section.top + section.height);
    if (!section || !section.height) return false;
    const current = section.name === "files" ? { ...explorer, filesOffset: section.offset } : { ...explorer, changesOffset: section.offset };
    explorer = reduceExplorer(current, { type: "scroll", section: section.name, delta });
    refreshSidebar();
    return true;
  }
  const instructions = new TextRenderable(renderer, {
    id: "changes", width: "100%", height: Math.max(0, renderer.height - 1), flexShrink: 0, wrapMode: "none",
    fg: palette.text, bg: palette.background,
    content: sidebarText(content, palette, active, Math.max(0, sidebarColumns(renderer.width, state.visible) - 5)), selectable: false,
    onMouseDown(event) {
      if (event.button !== 0) return;
      const control = content.controls.find((control) => control.row === event.y - instructions.y);
      if (control) {
        event.preventDefault(); event.stopPropagation();
        explorer = reduceExplorer(explorer, control.action); refreshSidebar(); terminal.focus(); return;
      }
      const target = content.targets.find((target) => target.row === event.y - instructions.y);
      if (!target) return;
      event.preventDefault(); event.stopPropagation(); terminal.focus(); selectPreview(target.selection);
    },
    onMouseScroll(event) {
      if (!event.scroll || !["up", "down"].includes(event.scroll.direction)) return;
      if (scrollExplorer(event.y - instructions.y, event.scroll.direction === "up" ? -3 : 3)) {
        event.preventDefault(); event.stopPropagation();
      }
    },
  });
  const search = new InputRenderable(renderer, {
    id: "file-search", position: "absolute", left: 2, top: content.searchRow ?? 0,
    width: Math.max(0, sidebarColumns(renderer.width, true) - 5), zIndex: 2,
    visible: content.searchRow !== null && sidebarColumns(renderer.width, true) > 0,
    placeholder: "Search files…", maxLength: 200,
    backgroundColor: palette.background, textColor: palette.text,
    focusedBackgroundColor: palette.activeBackground, focusedTextColor: palette.text, placeholderColor: palette.muted,
    onMouseDown(event) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      if (preview.isOpen()) selectPreview(null);
      search.focus();
    },
    onMouseScroll(event) {
      if (!event.scroll || !["up", "down"].includes(event.scroll.direction)) return;
      if (scrollExplorer(event.y - instructions.y, event.scroll.direction === "up" ? -3 : 3)) {
        event.preventDefault(); event.stopPropagation();
      }
    },
  });
  const footer = new BoxRenderable(renderer, {
    id: "sidebar-footer", width: "100%", height: 1, flexShrink: 0,
    flexDirection: "row", justifyContent: "space-between", backgroundColor: palette.background,
  });
  const shortcut = new TextRenderable(renderer, {
    id: "sidebar-shortcut", width: 6, height: 1, selectable: false,
    content: "Ctrl+G", fg: palette.muted, bg: palette.background,
  });
  footer.add(shortcut); footer.add(themeSwitch);
  sidebar.add(instructions); sidebar.add(footer); sidebar.add(search);
  layout.add(sidebar);
  layout.add(terminal);
  renderer.root.add(layout);
  const preview = mountPreview(renderer, palette, () => selectPreview(null));
  const refreshSidebar = () => {
    content = explorerLayout(changes, files, projectName, Math.max(0, renderer.height - 1), Math.max(0, sidebarColumns(renderer.width, state.visible) - 5), explorer);
    instructions.content = sidebarText(content, palette, active, Math.max(0, sidebarColumns(renderer.width, state.visible) - 5));
    const visible = content.searchRow !== null && sidebarColumns(renderer.width, state.visible) > 0;
    if (!visible && search.focused) terminal.focus();
    search.top = content.searchRow ?? 0;
    search.width = Math.max(0, sidebarColumns(renderer.width, state.visible) - 5);
    search.visible = visible;
  };

  const resize = () => {
    const width = sidebarColumns(renderer.width, state.visible);
    if (!width && search.focused) terminal.focus();
    sidebar.width = width;
    sidebar.visible = width > 0;
    terminal.width = Math.max(1, renderer.width - width);
    terminal.height = Math.max(1, renderer.height);
    instructions.height = Math.max(0, renderer.height - 1);
    refreshSidebar();
    preview.resize(width, renderer.width - width, renderer.height);
    child?.resize(Math.max(1, renderer.width - width), Math.max(1, renderer.height));
  };
  const updateTheme = () => {
    palette = sidebarTheme(selectedTheme);
    sidebar.backgroundColor = palette.background;
    sidebar.borderColor = palette.border;
    footer.backgroundColor = palette.background;
    shortcut.bg = palette.background; shortcut.fg = palette.muted;
    themeSwitch.bg = palette.background;
    themeSwitch.content = switchText();
    instructions.bg = palette.background;
    instructions.fg = palette.text;
    search.backgroundColor = palette.background; search.textColor = palette.text;
    search.focusedBackgroundColor = palette.activeBackground; search.focusedTextColor = palette.text; search.placeholderColor = palette.muted;
    refreshSidebar();
    preview.setTheme(palette);
  };
  const ordinaryInput = () => { state = reduceSidebar(state, { type: "input" }).state; };
  const updateSearch = () => {
    if (search.value === explorer.query) return;
    explorer = reduceExplorer(explorer, { type: "search", query: search.value }); refreshSidebar();
  };
  const keypress = (key: KeyEvent) => {
    if (preview.isOpen() && !(key.ctrl && key.name === "g" && !key.meta && !key.shift)) {
      key.preventDefault(); key.stopPropagation(); ordinaryInput();
      if (key.ctrl && key.name === "c") child?.write(terminal.encodeKey(key));
      else preview.handleKey(key);
    } else if (search.focused && !(key.ctrl && key.name === "g" && !key.meta && !key.shift)) {
      key.preventDefault(); key.stopPropagation(); ordinaryInput();
      if (key.eventType === "release") return;
      if (key.ctrl && key.name === "c") child?.write(terminal.encodeKey(key));
      else if (key.name === "escape") {
        search.value = ""; updateSearch(); terminal.focus();
      } else if (key.name === "return" || key.name === "linefeed") {
        const target = content.targets.find((target) => target.selection.comparison === "file");
        if (explorer.query.trim() && target) { terminal.focus(); selectPreview(target.selection); }
        else if (!explorer.query.trim()) terminal.focus();
      } else { search.handleKeyPress(key); updateSearch(); }
    } else if (key.name === "linefeed") {
      // OpenTUI 0.8.1 parses LF but its embedded encoder has no linefeed key.
      // Encode the equivalent Ctrl+J through the child's negotiated keyboard mode.
      key.preventDefault();
      key.stopPropagation();
      ordinaryInput();
      child?.write(terminal.encodeKey(new KeyEvent({ ...key, name: "j", ctrl: true })));
    } else if (key.ctrl && key.name === "g" && !key.meta && !key.shift && key.eventType !== "release") {
      key.preventDefault();
      key.stopPropagation();
      const next = reduceSidebar(state, { type: "toggle", at: performance.now() });
      state = next.state;
      resize();
      if (next.sendControlG) child?.write("\x07");
    } else {
      ordinaryInput();
    }
  };

  try {
    child = startPty(command, {
      cwd, cols: terminal.width, rows: terminal.height,
      onData: (bytes) => terminal.write(bytes),
    });
  } catch (error: unknown) {
    preview.dispose();
    layout.destroyRecursively();
    throw error;
  }
  const paste = (event: PasteEvent) => {
    ordinaryInput();
    if (preview.isOpen()) { event.preventDefault(); event.stopPropagation(); }
    else if (search.focused) { event.preventDefault(); event.stopPropagation(); search.handlePaste(event); updateSearch(); }
  };
  const session = child;
  renderer.on("resize", resize);
  renderer.keyInput.on("keypress", keypress);
  renderer.keyInput.on("paste", paste);
  resize();
  terminal.focus();

  let disposal: Promise<void> | undefined;
  async function shutdown(): Promise<void> {
    renderer.off("resize", resize);
    renderer.keyInput.off("keypress", keypress);
    renderer.keyInput.off("paste", paste);
    try {
      await session.dispose();
    } finally {
      preview.dispose();
      layout.destroyRecursively();
    }
  }
  return {
    exited: session.exited,
    setChanges(nextState) {
      if (disposal) return;
      changes = nextState;
      refreshSidebar();
    },
    setFiles(next) {
      if (disposal) return;
      files = next; refreshSidebar();
    },
    setPreview(next) {
      if (disposal) return;
      active = next.kind === "closed" ? null : next.selection;
      refreshSidebar();
      preview.setState(next);
      if (next.kind === "closed") terminal.focus();
    },
    dispose: () => disposal ??= shutdown(),
  };
}
