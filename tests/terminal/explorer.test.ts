import { expect, test } from "bun:test";
import { createExplorerState, explorerLayout, reduceExplorer } from "../../src/terminal/explorer";
import { createChangesState } from "../../src/git/status";

const files = { paths: Array.from({ length: 60 }, (_, i) => `file-${String(i).padStart(2, "0")}.ts`), error: null };
const changes = createChangesState(Array.from({ length: 30 }, (_, i) => ({ path: `change-${i}.ts`, indexStatus: " ", worktreeStatus: "M" })));
const render = (state = createExplorerState(), rows = 30) => explorerLayout(changes, files, "fixture", rows, 29, state);
const text = (value: ReturnType<typeof render>) => value.lines.map((line) => line.map((span) => span.text).join("")).join("\n");

test("stacked sections share about60/40 and a collapsed section donates its height", () => {
  const state = createExplorerState();
  const initial = render(state);
  const [filePanel, changePanel] = initial.sections;
  expect(filePanel?.height).toBeGreaterThan(changePanel?.height ?? 0);
  expect(initial.lines).toHaveLength(30);
  const collapsed = render(reduceExplorer(state, { type: "toggle-section", section: "files" }));
  expect(collapsed.sections[0]?.height).toBe(0);
  expect(collapsed.sections[1]?.height).toBeGreaterThan(changePanel?.height ?? 0);
  expect(text(collapsed)).toContain("▸ Files");
  expect(state.filesOpen).toBe(true);
  const sparse = explorerLayout(changes, { paths: ["one.ts"], error: null }, "fixture", 30, 29, state);
  expect(sparse.sections[0]?.height).toBe(1);
  expect(sparse.sections[1]?.height).toBeGreaterThan(changePanel?.height ?? 0);
});

test("independent scrolling preserves the other section and exposes only visible click targets", () => {
  const state = reduceExplorer(createExplorerState(), { type: "scroll", section: "files", delta: 30 });
  const value = render(state);
  expect(value.targets.some((target) => target.selection.path === "file-00.ts")).toBe(false);
  expect(value.targets.some((target) => target.selection.path === "file-30.ts")).toBe(true);
  expect(state.changesOffset).toBe(0);
  expect(value.targets.every((target) => target.row >= 0 && target.row < 30)).toBe(true);
  expect(value.controls.every((control) => !value.targets.some((target) => target.row === control.row))).toBe(true);
});

test("folder controls expand tree entries with escaped labels and exact raw preview paths", () => {
  const state = reduceExplorer(createExplorerState(), { type: "toggle-folder", path: "src" });
  const value = explorerLayout(createChangesState([]), { paths: ["src/a\n.ts"], error: null }, "project\x1b", 20, 23, state);
  expect(text(value)).toContain("a\\n.ts"); expect(text(value)).not.toContain("\x1b");
  expect(value.targets.some((target) => target.selection.path === "src/a\n.ts" && target.selection.comparison === "file")).toBe(true);
  expect(value.controls.some((control) => control.action.type === "toggle-folder" && control.action.path === "src")).toBe(true);
});

test("tiny windows and stale sections stay bounded with distinct controls and diagnostics", () => {
  for (let height = 0; height < 35; height++) {
    const value = render(createExplorerState(), height);
    expect(value.lines).toHaveLength(height);
    expect(value.lines.every((line) => Bun.stringWidth(line.map((span) => span.text).join("")) <= 29)).toBe(true);
    if (height >= 3) expect(value.controls.filter((control) => control.action.type === "toggle-section")).toHaveLength(2);
  }
  const stale = explorerLayout({ ...changes, error: "Git failed\x1b" }, { ...files, error: "Files failed\x1b" }, "fixture", 30, 29, createExplorerState());
  expect(text(stale)).toContain("Git failed\\u001b"); expect(text(stale)).toContain("Files failed\\u001b");
});
