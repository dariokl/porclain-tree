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

test("Files and Changes use compact rows with the same right-aligned Git badges", () => {
  const value = explorerLayout(createChangesState([
    { path: "src/app.ts", indexStatus: " ", worktreeStatus: "M" },
  ]), { paths: ["src/app.ts"], error: null }, "fixture", 24, 29, reduceExplorer(createExplorerState(), { type: "toggle-folder", path: "src" }));
  const targets = value.targets.filter((target) => target.selection.path === "src/app.ts");
  expect(targets).toHaveLength(2);
  for (const target of targets) {
    const spans = value.lines[target.row] ?? [];
    const row = spans.map((span) => span.text).join("");
    expect(row).toContain("app.ts"); expect(row).toEndWith("M*");
    expect(Bun.stringWidth(row)).toBe(29);
    expect(spans.some((span) => span.text === "M" && span.tone === "modified")).toBe(true);
  }
  const headers = value.controls.filter((control) => control.action.type === "toggle-section");
  expect(headers.every((header) => value.lines[header.row]?.some((span) => span.bold && /Files|Changes/.test(span.text)))).toBe(true);
  expect(text(value)).not.toContain("┆");
  expect(text(value)).toContain("Unstaged · vs index");
});


test("cached Git badges in Files are explicitly stale even when its file listing is current", () => {
  const state = { ...createChangesState([{ path: "app.ts", indexStatus: " ", worktreeStatus: "M" }]), error: "Git offline" };
  const value = explorerLayout(state, { paths: ["app.ts"], error: null }, "fixture", 25, 29, createExplorerState());
  const header = value.sections.find((section) => section.name === "files")?.header;
  expect(header).toBeDefined();
  expect(value.lines[header ?? -1]?.map((span) => span.text).join("")).toContain("stale");
});

test("deep tree indentation leaves readable filenames beside combined status badges", () => {
  const paths = ["a/b/c/d/e/f/g/important.ts", "a/b/c/d/e/f/g/different.ts"];
  const expanded = new Set(["a", "a/b", "a/b/c", "a/b/c/d", "a/b/c/d/e", "a/b/c/d/e/f", "a/b/c/d/e/f/g"]);
  const state = { ...createExplorerState(), expanded };
  const changes = createChangesState(paths.map((path) => ({ path, indexStatus: "M", worktreeStatus: "M" })));
  const value = explorerLayout(changes, { paths, error: null }, "fixture", 40, 23, state);
  const rows = value.targets.filter((target) => target.selection.comparison === "file").map((target) => value.lines[target.row]?.map((span) => span.text).join(""));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("fferent.ts"); expect(rows[1]).toContain("portant.ts");
  expect(rows.every((row) => row?.endsWith("MM*") && Bun.stringWidth(row) <= 23)).toBe(true);
});
