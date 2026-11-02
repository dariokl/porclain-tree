import { bold, BoxRenderable, EmbeddedTerminalRenderable, fg, KeyEvent, StyledText, TextRenderable } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { CommandSpec } from "../command";
import type { ChangesState } from "../git/status";
import { startPty } from "./pty";
import type { PtySession } from "./pty";
import { formatSidebar, reduceSidebar, sidebarColumns } from "./sidebar";
import type { SidebarState } from "./sidebar";
import { sidebarTheme } from "./theme";
import type { SidebarTheme } from "./theme";

function sidebarText(changes: ChangesState, projectName: string, rows: number, width: number, palette: SidebarTheme): StyledText {
  const lines = formatSidebar(changes, projectName, rows, Math.max(0, width - 5));
  return new StyledText(lines.flatMap((line, index) => [
    ...(index > 0 ? [fg(palette.text)("\n")] : []),
    ...line.map((span) => {
      const chunk = fg(palette[span.tone])(span.text);
      return span.bold ? bold(chunk) : chunk;
    }),
  ]));
}

type MountedTerminal = Readonly<{
  exited: Promise<number>;
  setChanges: (state: ChangesState) => void;
  dispose: () => Promise<void>;
}>;

export function mountTerminal(
  renderer: CliRenderer,
  command: CommandSpec,
  cwd: string,
  initialChanges: ChangesState,
  projectName: string,
): MountedTerminal {
  let state: SidebarState = { visible: true, lastToggleAt: null };
  let changes = initialChanges;
  let palette = sidebarTheme(renderer.themeMode);
  let child: PtySession | undefined;
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
    flexShrink: 0, border: ["right"], borderColor: palette.border,
    backgroundColor: palette.background, paddingLeft: 2, paddingRight: 2, overflow: "hidden",
  });
  const instructions = new TextRenderable(renderer, {
    id: "changes", width: "100%", height: "100%", wrapMode: "none",
    fg: palette.text, bg: palette.background,
    content: sidebarText(changes, projectName, renderer.height, sidebarColumns(renderer.width, true), palette),
  });
  sidebar.add(instructions);
  layout.add(sidebar);
  layout.add(terminal);
  renderer.root.add(layout);

  const resize = () => {
    const width = sidebarColumns(renderer.width, state.visible);
    sidebar.width = width;
    sidebar.visible = width > 0;
    terminal.width = Math.max(1, renderer.width - width);
    terminal.height = Math.max(1, renderer.height);
    instructions.content = sidebarText(changes, projectName, renderer.height, width, palette);
    child?.resize(Math.max(1, renderer.width - width), Math.max(1, renderer.height));
  };
  const onTheme = (mode: "light" | "dark") => {
    palette = sidebarTheme(mode);
    sidebar.backgroundColor = palette.background;
    sidebar.borderColor = palette.border;
    instructions.bg = palette.background;
    instructions.fg = palette.text;
    instructions.content = sidebarText(changes, projectName, renderer.height, sidebarColumns(renderer.width, state.visible), palette);
  };
  const ordinaryInput = () => { state = reduceSidebar(state, { type: "input" }).state; };
  const keypress = (key: KeyEvent) => {
    if (key.name === "linefeed") {
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
    layout.destroyRecursively();
    throw error;
  }
  const session = child;
  renderer.on("resize", resize);
  renderer.on("theme_mode", onTheme);
  renderer.keyInput.on("keypress", keypress);
  renderer.keyInput.on("paste", ordinaryInput);
  resize();
  terminal.focus();

  let disposal: Promise<void> | undefined;
  async function shutdown(): Promise<void> {
    renderer.off("resize", resize);
    renderer.off("theme_mode", onTheme);
    renderer.keyInput.off("keypress", keypress);
    renderer.keyInput.off("paste", ordinaryInput);
    try {
      await session.dispose();
    } finally {
      layout.destroyRecursively();
    }
  }
  return {
    exited: session.exited,
    setChanges(nextState) {
      if (disposal) return;
      changes = nextState;
      instructions.content = sidebarText(changes, projectName, renderer.height, sidebarColumns(renderer.width, state.visible), palette);
    },
    dispose: () => disposal ??= shutdown(),
  };
}
