import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mountTerminal } from "../../src/terminal/view";
import { applyStatus, createChangesState } from "../../src/git/status";
import type { GitStatusResult } from "../../src/git/status";

async function waitForFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await setup.renderOnce();
    if (setup.captureCharFrame().includes(text)) return;
    // The upstream helper settles render tasks; real PTY I/O also needs an OS turn.
    await Bun.sleep(10);
  }
  throw new Error(`Missing ${JSON.stringify(text)} in frame:\n${setup.captureCharFrame()}`);
}

test("sidebar toggle and narrow-terminal collapse resize the actual child", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, {
    executable: "sh",
    args: ["-c", "stty -echo; echo ready; while read -r line; do stty size; done"],
  }, process.cwd(), createChangesState([]), "fixture");
  async function askSize(expected: string) {
    await setup.mockInput.typeText("size");
    setup.mockInput.pressEnter();
    await waitForFrame(setup, expected);
  }
  try {
    await waitForFrame(setup, "ready");
    await askSize("30 86");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    await askSize("30 120");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    await askSize("30 86");
    setup.resize(110, 25);
    await setup.renderOnce();
    await askSize("25 82");
    setup.resize(80, 20);
    await setup.renderOnce();
    await askSize("20 80");
    setup.resize(120, 30);
    await setup.renderOnce();
    await askSize("30 86");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("ordinary keys, arrows, Ctrl+C, Unicode paste, and literal Ctrl+G reach the child", async () => {
  const setup = await createTestRenderer({ width: 140, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, {
    executable: process.execPath,
    args: ["-e", `
      process.stdin.setRawMode(true);
      process.stdout.write("\\x1b[?2004hraw-ready\\r\\n");
      process.stdin.on("data", bytes => process.stdout.write("BYTES:" + bytes.toString("hex") + "\\r\\n"));
    `],
  }, process.cwd(), createChangesState([]), "fixture");
  try {
    await waitForFrame(setup, "raw-ready");
    await setup.mockInput.typeText("x");
    await waitForFrame(setup, "BYTES:78");
    setup.mockInput.pressArrow("up");
    await waitForFrame(setup, "BYTES:1b5b41");
    setup.mockInput.pressCtrlC();
    await waitForFrame(setup, "BYTES:03");
    setup.mockInput.pressKey("j", { ctrl: true });
    await waitForFrame(setup, "BYTES:0a");
    await setup.mockInput.pasteBracketedText("č\none");
    await waitForFrame(setup, "1b5b3230307ec48d0a6f6e651b5b3230317e");
    setup.mockInput.pressKey("g", { ctrl: true });
    setup.mockInput.pressKey("g", { ctrl: true });
    await waitForFrame(setup, "BYTES:07");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("Git status updates on the left while errors leave child input usable", async () => {
  const setup = await createTestRenderer({ width: 120, height: 20, exitOnCtrlC: false });
  const oldChange = { path: "old.ts", indexStatus: " ", worktreeStatus: "M" };
  let state = createChangesState([oldChange]);
  const session = mountTerminal(setup.renderer, {
    executable: "sh", args: ["-c", "stty -echo; while read -r line; do printf 'reply:%s\\n' \"$line\"; done"],
  }, process.cwd(), state, "fixture");
  const updateStatus = (result: GitStatusResult) => {
    state = applyStatus(state, result);
    session.setChanges(state);
  };
  try {
    await waitForFrame(setup, "old.ts");
    const brandRow = setup.captureCharFrame().split("\n").find((row) => row.includes("porclain/tree"));
    expect(brandRow).toBeDefined();
    expect(brandRow?.indexOf("porclain/tree")).toBeLessThan(34);
    updateStatus({ ok: true, changes: [oldChange, { path: "new.ts", indexStatus: "?", worktreeStatus: "?" }] });
    await waitForFrame(setup, "new.ts");
    updateStatus({ ok: false, error: "Git timed out" });
    await waitForFrame(setup, "Git unavailable");
    expect(setup.captureCharFrame()).toContain("old.ts");
    await setup.mockInput.typeText("still-working");
    setup.mockInput.pressEnter();
    await waitForFrame(setup, "reply:still-working");
    updateStatus({ ok: true, changes: [] });
    await waitForFrame(setup, "Working tree clean");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("native sidebar distinguishes filenames from paths and keeps its footer after resize", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, {
    executable: "sh", args: ["-c", "printf 'CHILD_READY\\n'; read -r line"],
  }, process.cwd(), createChangesState([
    { path: "src/terminal/view.ts", indexStatus: " ", worktreeStatus: "M" },
  ]), "project-name");
  try {
    await waitForFrame(setup, "CHILD_READY");
    expect(setup.captureCharFrame()).toContain("project-name");
    expect(setup.captureCharFrame()).toContain("├─ unstaged · 1");
    expect(setup.captureCharFrame()).toContain("┆  vs index");
    const fileRow = setup.captureCharFrame().split("\n").find((row) => row.includes("view.ts"));
    expect(fileRow).toContain("┆  M* view.ts");
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const filename = spans.find((span) => span.text.includes("view.ts"));
    const directory = spans.find((span) => span.text.includes("src/terminal/"));
    const child = spans.find((span) => span.text.includes("CHILD_READY"));
    expect(filename).toBeDefined();
    expect(directory).toBeDefined();
    expect(child).toBeDefined();
    expect(filename?.fg.equals(directory?.fg)).toBe(false);
    expect(filename?.bg.equals(child?.bg)).toBe(false);
    expect(setup.captureCharFrame().split("\n")[28]?.slice(0, 34)).toContain("╰─ Ctrl+G");
    setup.resize(110, 18);
    await setup.renderOnce();
    expect(setup.captureCharFrame().split("\n")[16]?.slice(0, 28)).toContain("Ctrl+G");
    expect(setup.captureCharFrame()).toContain("before launch");
    session.setChanges(createChangesState([]));
    await waitForFrame(setup, "Working tree clean");
    expect(setup.captureCharFrame()).not.toContain("changed before launch");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("porclain/tree");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("passive light/dark hints restyle the sidebar without altering child colors", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c",
    "printf 'DEFAULT\\033[48;2;70;80;90mCHILD_PANEL\\033[0mREADY\\n'; read -r line",
  ] }, process.cwd(), createChangesState([{ path: "view.ts", indexStatus: " ", worktreeStatus: "M" }]), "fixture");
  const colors = (text: string) => {
    const span = setup.captureSpans().lines.flatMap((line) => line.spans).find((part) => part.text.includes(text));
    return { fg: span?.fg.toInts(), bg: span?.bg.toInts() };
  };
  try {
    await waitForFrame(setup, "READY");
    const child = colors("DEFAULT");
    const panel = colors("CHILD_PANEL");
    setup.renderer.emit("theme_mode", "light");
    await setup.renderOnce();
    expect(colors("view.ts").bg).toEqual([241, 241, 237, 255]);
    expect(colors("DEFAULT")).toEqual(child);
    expect(colors("CHILD_PANEL")).toEqual(panel);
    setup.renderer.emit("theme_mode", "dark");
    await setup.renderOnce();
    expect(colors("view.ts").bg).toEqual([20, 22, 21, 255]);
    expect(colors("DEFAULT")).toEqual(child);
    expect(colors("CHILD_PANEL")).toEqual(panel);
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});
