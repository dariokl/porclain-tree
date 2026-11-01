import { BoxRenderable, EmbeddedTerminalRenderable, KeyEvent, TextRenderable } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { CommandSpec } from "../command";
import type { ChangesState } from "../git/status";
import { startPty } from "./pty";
import type { PtySession } from "./pty";
import { formatChanges, reduceSidebar, sidebarColumns } from "./sidebar";
import type { SidebarState } from "./sidebar";

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
): MountedTerminal {
  let state: SidebarState = { visible: true, lastToggleAt: null };
  let changes = initialChanges;
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
    flexShrink: 0, border: ["right"], borderColor: "#666666", paddingLeft: 1,
  });
  const instructions = new TextRenderable(renderer, {
    id: "changes", width: "100%", height: "100%", wrapMode: "none",
    content: formatChanges(changes, renderer.height),
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
    instructions.content = formatChanges(changes, renderer.height);
    child?.resize(Math.max(1, renderer.width - width), Math.max(1, renderer.height));
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
  renderer.keyInput.on("keypress", keypress);
  renderer.keyInput.on("paste", ordinaryInput);
  resize();
  terminal.focus();

  let disposal: Promise<void> | undefined;
  async function shutdown(): Promise<void> {
    renderer.off("resize", resize);
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
      instructions.content = formatChanges(changes, renderer.height);
    },
    dispose: () => disposal ??= shutdown(),
  };
}
