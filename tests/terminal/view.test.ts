import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { startPty } from "../../src/terminal/pty";
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

async function clickTheme(setup: Awaited<ReturnType<typeof createTestRenderer>>, button: 0 | 2 = 0) {
  const rows = setup.captureCharFrame().split("\n");
  const y = rows.findIndex((row) => row.includes("Dark ["));
  const x = (rows[y]?.indexOf("[") ?? -2) + 1;
  await setup.mockMouse.click(x, y, button);
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
    const projectRow = setup.captureCharFrame().split("\n").find((row) => row.includes("fixture"));
    expect(projectRow).toBeDefined();
    expect(projectRow?.indexOf("fixture")).toBeLessThan(34);
    expect(setup.captureCharFrame()).not.toContain("porclain/tree");
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
    expect(setup.captureCharFrame()).toContain("Unstaged · vs index");
    expect(setup.captureCharFrame()).toContain("vs index");
    const fileRow = setup.captureCharFrame().split("\n").find((row) => row.includes("view.ts"));
    expect(fileRow).toContain("view.ts");
    expect(fileRow?.slice(0, 34)).toContain("M*");
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const filename = spans.find((span) => span.text.includes("view.ts"));
    const directory = spans.find((span) => span.text.includes("src/terminal/"));
    const child = spans.find((span) => span.text.includes("CHILD_READY"));
    expect(filename).toBeDefined();
    expect(directory).toBeDefined();
    expect(child).toBeDefined();
    expect(filename?.fg.equals(directory?.fg)).toBe(false);
    expect(filename?.bg.toInts()).toEqual([0, 0, 0, 255]);
    expect(setup.captureCharFrame().split("\n")[29]?.slice(0, 34)).toContain("Ctrl+G");
    setup.resize(110, 18);
    await setup.renderOnce();
    expect(setup.captureCharFrame().split("\n")[17]?.slice(0, 28)).toContain("Ctrl+G");
    expect(setup.captureCharFrame()).toContain("before launch");
    session.setChanges(createChangesState([]));
    await waitForFrame(setup, "Working tree clean");
    expect(setup.captureCharFrame()).not.toContain("changed before launch");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("project-name");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("clicking the sidebar switch changes light/dark without altering child colors or focus", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c",
    "stty -echo; printf 'DEFAULT\\033[48;2;70;80;90mCHILD_PANEL\\033[0mREADY\\n'; while read -r line; do printf 'reply:%s\\n' \"$line\"; done",
  ] }, process.cwd(), createChangesState([{ path: "view.ts", indexStatus: " ", worktreeStatus: "M" }]), "fixture");
  const colors = (text: string) => {
    const span = setup.captureSpans().lines.flatMap((line) => line.spans).find((part) => part.text.includes(text));
    return { fg: span?.fg.toInts(), bg: span?.bg.toInts() };
  };
  try {
    await waitForFrame(setup, "READY");
    expect(setup.captureCharFrame()).toContain("Dark [●──] Light");
    const child = colors("DEFAULT");
    const panel = colors("CHILD_PANEL");
    await clickTheme(setup);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Dark [──●] Light");
    expect(colors("view.ts").bg).toEqual([255, 255, 255, 255]);
    expect(colors("DEFAULT")).toEqual(child);
    expect(colors("CHILD_PANEL")).toEqual(panel);
    await setup.mockInput.typeText("still-working");
    setup.mockInput.pressEnter();
    await waitForFrame(setup, "reply:still-working");
    await clickTheme(setup, 2);
    await setup.renderOnce();
    expect(colors("view.ts").bg).toEqual([255, 255, 255, 255]);
    await clickTheme(setup);
    await setup.renderOnce();
    expect(colors("view.ts").bg).toEqual([0, 0, 0, 255]);
    expect(colors("CHILD_PANEL")).toEqual(panel);
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("PORCLAINTREE_THEME forces a white sidebar in the actual CLI without a light hint", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  let child: ReturnType<typeof startPty> | undefined;
  const host = new EmbeddedTerminalRenderable(setup.renderer, { width: 120, height: 30, onData: (bytes) => child?.write(bytes) });
  setup.renderer.root.add(host);
  child = startPty({ executable: "env", args: ["PORCLAINTREE_THEME=light", process.execPath,
    new URL("../../src/cli.ts", import.meta.url).pathname, "--", "sh", "-c", "printf 'CHILD_READY\\n'; read -r line",
  ] }, { cwd: process.cwd(), cols: 120, rows: 30, onData: (bytes) => host.write(bytes) });
  try {
    await waitForFrame(setup, "CHILD_READY");
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    expect(spans.find((span) => span.text.includes("porcelain"))?.bg.toInts()).toEqual([255, 255, 255, 255]);
    expect(spans.find((span) => span.text.includes("CHILD_READY"))?.bg.toInts()).toEqual([0, 0, 0, 255]);
  } finally {
    await child.dispose();
    await setup.dispose();
  }
});

test("clicking a file opens a scrollable preview without leaking typing or paste to the child", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24, exitOnCtrlC: false });
  const selected: import("../../src/preview").PreviewSelection[] = [];
  const change = { path: "both.ts", indexStatus: "M", worktreeStatus: "M" };
  const session = mountTerminal(setup.renderer, {
    executable: process.execPath,
    args: ["-e", 'process.stdin.setRawMode(true); process.stdout.write("raw-ready\\r\\n"); process.stdin.on("data", b => process.stdout.write("BYTES:" + b.toString("hex") + "\\r\\n"));'],
  }, process.cwd(), createChangesState([change]), "fixture", "dark", (selection) => {
    if (!selection) session.setPreview({ kind: "closed" });
    else {
      selected.push(selection);
      session.setPreview({ kind: "ready", selection, text: Array.from({ length: 60 }, (_, i) => `+preview-line-${i}`).join("\n") + "\n+escaped\x1b[31m\n+" + " ".repeat(100) + "right-edge" });
    }
  });
  try {
    await waitForFrame(setup, "raw-ready");
    const rows = setup.captureCharFrame().split("\n");
    const fileRows = rows.flatMap((row, index) => row.includes("both.ts") ? [index] : []);
    expect(fileRows).toHaveLength(2);
    await setup.mockMouse.click(10, fileRows[1] ?? -1);
    await waitForFrame(setup, "Staged · index vs HEAD");
    expect(selected).toEqual([{ path: "both.ts", comparison: "staged" }]);
    await setup.mockInput.typeText("x");
    await setup.mockInput.pasteBracketedText("secret");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressKey("END");
    await waitForFrame(setup, "preview-line-59");
    expect(setup.captureCharFrame()).toContain("escaped\\u001b[31m");
    for (let i = 0; i < 5; i++) setup.mockInput.pressArrow("right");
    await waitForFrame(setup, "right-edge");
    setup.mockInput.pressCtrlC();
    setup.mockInput.pressKey("ESCAPE");
    await waitForFrame(setup, "BYTES:03");
    expect(setup.captureCharFrame()).not.toContain("BYTES:78");
    expect(setup.captureCharFrame()).not.toContain("736563726574");
    await setup.mockInput.typeText("y");
    await waitForFrame(setup, "BYTES:79");
    await setup.mockMouse.click(10, fileRows[0] ?? -1);
    await waitForFrame(setup, "Unstaged · worktree vs index");
    await setup.mockMouse.click(114, 0);
    await waitForFrame(setup, "raw-ready");
    expect(setup.captureCharFrame()).not.toContain("Diff snapshot");
  } finally { await session.dispose(); await setup.dispose(); }
});

test("preview stays aligned through resize, theme switching, and refreshed file targets", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c", "echo child-ready; read -r line"] },
    process.cwd(), createChangesState([{ path: "old.ts", indexStatus: " ", worktreeStatus: "M" }]), "fixture", "dark", (selection) => {
      session.setPreview(selection ? { kind: "loading", selection } : { kind: "closed" });
    });
  try {
    await waitForFrame(setup, "child-ready");
    session.setChanges(createChangesState([{ path: "dir/new.ts", indexStatus: "?", worktreeStatus: "?" }]));
    await waitForFrame(setup, "new.ts");
    const y = setup.captureCharFrame().split("\n").findIndex((row) => row.includes("dir/"));
    await setup.mockMouse.click(11, y);
    await waitForFrame(setup, "Loading diff");
    expect(setup.captureCharFrame()).toContain("dir/new.ts");
    await clickTheme(setup);
    await setup.renderOnce();
    const previewSpan = setup.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("Diff snapshot"));
    expect(previewSpan?.bg.toInts()).toEqual([255, 255, 255, 255]);
    setup.resize(80, 16);
    await setup.renderOnce();
    expect(setup.captureCharFrame().split("\n")[0]?.startsWith("Diff snapshot")).toBe(true);
    session.setPreview({ kind: "error", selection: { path: "dir/new.ts", comparison: "untracked" }, error: "File disappeared\x1b[2J" });
    await waitForFrame(setup, "File disappeared\\u001b[2J");
    setup.mockInput.pressKey("q");
    await waitForFrame(setup, "child-ready");
  } finally { await session.dispose(); await setup.dispose(); }
});

test("active file highlights only its comparison and follows preview lifetime and sidebar theme", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const changes = createChangesState([{ path: "dir/both.ts", indexStatus: "M", worktreeStatus: "M" }]);
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c", "echo child-ready; read -r line"] },
    process.cwd(), changes, "fixture", "dark", (selection) => {
      session.setPreview(selection ? { kind: "loading", selection } : { kind: "closed" });
    });
  const fileRows = () => setup.captureCharFrame().split("\n").flatMap((line, i) => line.slice(0, 28).includes("both.ts") ? [i] : []);
  const background = (row: number) => setup.captureSpans().lines[row]?.spans.find((span) => span.text.includes("both.ts") || span.text.includes("dir/"))?.bg.toInts();
  try {
    await waitForFrame(setup, "child-ready");
    const [unstaged, staged] = fileRows();
    if (unstaged === undefined || staged === undefined) throw new Error("Missing comparisons");
    await setup.mockMouse.click(10, staged);
    await waitForFrame(setup, "Loading diff");
    expect(background(staged)).toEqual([28, 28, 28, 255]);
    expect(background(unstaged)).toEqual([0, 0, 0, 255]);
    session.setPreview({ kind: "error", selection: { path: "dir/both.ts", comparison: "staged" }, error: "unavailable" });
    session.setChanges(changes);
    await clickTheme(setup);
    await setup.renderOnce();
    expect(background(staged)).toEqual([237, 237, 237, 255]);
    expect(background(unstaged)).toEqual([255, 255, 255, 255]);
    await setup.mockMouse.click(10, unstaged);
    await setup.renderOnce();
    expect(background(unstaged)).toEqual([237, 237, 237, 255]);
    expect(background(staged)).toEqual([255, 255, 255, 255]);
    session.setPreview({ kind: "ready", selection: { path: "dir/both.ts", comparison: "unstaged" }, text: "+content" });
    setup.resize(110, 28);
    await setup.renderOnce();
    const current = fileRows()[0];
    if (current === undefined) throw new Error("Missing resized file");
    expect(background(current)).toEqual([237, 237, 237, 255]);
    setup.mockInput.pressKey("q");
    await waitForFrame(setup, "child-ready");
    expect(background(current)).toEqual([255, 255, 255, 255]);
  } finally { await session.dispose(); await setup.dispose(); }
});

test("stacked explorer expands folders, previews full files, and reclaims collapsed section space without resizing the child", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, {
    executable: "sh", args: ["-c", "stty -echo; echo child-ready; while read -r line; do stty size; done"],
  }, process.cwd(), createChangesState([{ path: "modified.ts", indexStatus: " ", worktreeStatus: "M" }]), "fixture", "dark", (selection) => {
    session.setPreview(selection ? { kind: "ready", selection, text: "+source-is-not-a-diff\nwhole file" } : { kind: "closed" });
  }, { paths: ["src/inside.ts", ...Array.from({ length: 40 }, (_, i) => `root-${i}.ts`)], error: null });
  const row = (text: string) => setup.captureCharFrame().split("\n").findIndex((line) => line.slice(0, 34).includes(text));
  try {
    await waitForFrame(setup, "child-ready");
    expect(row("▾ Files")).toBeGreaterThan(0); expect(row("▾ Changes")).toBeGreaterThan(row("▾ Files"));
    await setup.mockMouse.click(10, row("▸ src"));
    await waitForFrame(setup, "inside.ts");
    await setup.mockMouse.click(12, row("inside.ts"));
    await waitForFrame(setup, "File snapshot");
    expect(setup.captureCharFrame()).toContain("Working-tree contents");
    const source = setup.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("+source-is-not-a-diff"));
    expect(source?.fg.toInts()).toEqual([229, 229, 229, 255]);
    await setup.mockMouse.click(10, row("▾ Files"));
    await setup.renderOnce();
    expect(row("▸ Files")).toBeGreaterThan(0); expect(row("inside.ts")).toBe(-1);
    setup.mockInput.pressKey("q");
    await setup.mockInput.typeText("size"); setup.mockInput.pressEnter();
    await waitForFrame(setup, "30 86");
    await setup.mockMouse.click(10, row("▸ Files"));
    await waitForFrame(setup, "inside.ts");
    await setup.mockMouse.click(10, row("▾ Changes"));
    await setup.renderOnce();
    expect(row("▸ Changes")).toBeGreaterThan(0);
    expect(row("root-15.ts")).toBeGreaterThan(0);
  } finally { await session.dispose(); await setup.dispose(); }
});

test("wheel scrolling stays in its section and selects the currently visible file after refresh", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const selections: import("../../src/preview").PreviewSelection[] = [];
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c", "echo ready; read -r line"] }, process.cwd(),
    createChangesState(Array.from({ length: 30 }, (_, i) => ({ path: `change-${i}.ts`, indexStatus: " ", worktreeStatus: "M" }))),
    "fixture", "dark", (selection) => { if (selection) selections.push(selection); },
    { paths: Array.from({ length: 50 }, (_, i) => `file-${String(i).padStart(2, "0")}.ts`), error: null });
  const row = (text: string) => setup.captureCharFrame().split("\n").findIndex((line) => line.slice(0, 34).includes(text));
  try {
    await waitForFrame(setup, "ready");
    const changeRow = row("change-0.ts");
    await setup.mockMouse.scroll(12, row("file-00.ts"), "down");
    await setup.renderOnce();
    expect(row("file-00.ts")).toBe(-1); expect(row("change-0.ts")).toBe(changeRow);
    await setup.mockMouse.click(12, row("file-03.ts"));
    expect(selections.at(-1)).toEqual({ path: "file-03.ts", comparison: "file" });
    const fileRow = row("file-03.ts");
    await setup.mockMouse.scroll(12, changeRow, "down"); await setup.renderOnce();
    expect(row("file-03.ts")).toBe(fileRow); expect(row("change-0.ts")).toBe(-1);
    session.setFiles({ paths: ["replacement.ts"], error: null });
    await waitForFrame(setup, "replacement.ts");
    await setup.mockMouse.click(12, row("replacement.ts"));
    expect(selections.at(-1)).toEqual({ path: "replacement.ts", comparison: "file" });
  } finally { await session.dispose(); await setup.dispose(); }
});

test("collapsing another section preserves scroll position and scrolling uses the visible offset", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c", "echo ready; read -r line"] }, process.cwd(),
    createChangesState(Array.from({ length: 30 }, (_, i) => ({ path: `change-${i}.ts`, indexStatus: " ", worktreeStatus: "M" }))),
    "fixture", "dark", () => {}, { paths: Array.from({ length: 50 }, (_, i) => `file-${String(i).padStart(2, "0")}.ts`), error: null });
  const row = (label: string) => setup.captureCharFrame().split("\n").findIndex((line) => line.slice(0, 34).includes(label));
  const firstFile = () => setup.captureCharFrame().split("\n").find((line) => /file-\d+\.ts/.test(line.slice(0, 34)))?.match(/file-(\d+)\.ts/)?.[1];
  try {
    await waitForFrame(setup, "ready");
    for (let i = 0; i < 18; i++) { await setup.mockMouse.scroll(12, row("▾ Files") + 1, "down"); await setup.renderOnce(); }
    const original = firstFile(); expect(Number(original)).toBeGreaterThan(20);
    await setup.mockMouse.click(10, row("▾ Changes")); await setup.renderOnce();
    await setup.mockMouse.click(10, row("▸ Changes")); await setup.renderOnce();
    expect(firstFile()).toBe(original);
    await setup.mockMouse.click(10, row("▾ Changes")); await setup.renderOnce();
    const expandedOffset = Number(firstFile());
    await setup.mockMouse.scroll(12, row("▾ Files") + 1, "up"); await setup.renderOnce();
    expect(Number(firstFile())).toBe(expandedOffset - 3);
  } finally { await session.dispose(); await setup.dispose(); }
});

test("compact controls live in the footer and the theme switch stays clickable there", async () => {
  const setup = await createTestRenderer({ width: 120, height: 24, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, { executable: "sh", args: ["-c", "echo child-ready; read -r line"] },
    process.cwd(), createChangesState([{ path: "app.ts", indexStatus: " ", worktreeStatus: "M" }]), "fixture");
  try {
    await waitForFrame(setup, "child-ready");
    let rows = setup.captureCharFrame().split("\n");
    expect(rows[0]?.slice(0, 33).trim()).toBe("fixture");
    expect(setup.captureCharFrame()).not.toContain("porclain/tree");
    expect(rows[23]?.slice(0, 34)).toContain("Ctrl+G");
    expect(rows[23]?.slice(0, 34)).toContain("Dark [●──] Light");
    const x = (rows[23]?.indexOf("[●") ?? -2) + 1;
    await setup.mockMouse.click(x, 23); await setup.renderOnce();
    rows = setup.captureCharFrame().split("\n");
    expect(rows[23]).toContain("Dark [──●] Light");
    const span = setup.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("app.ts"));
    expect(span?.bg.toInts()).toEqual([255, 255, 255, 255]);
  } finally { await session.dispose(); await setup.dispose(); }
});
