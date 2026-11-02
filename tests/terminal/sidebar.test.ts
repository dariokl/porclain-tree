import { describe, expect, test } from "bun:test";
import { changeBadge, changesRows, pathRow, reduceSidebar, sidebarColumns } from "../../src/terminal/sidebar";
import { applyStatus, createChangesState } from "../../src/git/status";

describe("sidebar controls", () => {
  test("collapses in narrow terminals and restores the requested visibility", () => {
    expect(sidebarColumns(99, true)).toBe(0);
    expect(sidebarColumns(100, true)).toBe(28);
    expect(sidebarColumns(120, false)).toBe(0);
    expect(sidebarColumns(119, true)).toBe(28);
    expect(sidebarColumns(120, true)).toBe(34);
  });

  test("a single toggle hides the sidebar without forwarding a control key", () => {
    const state = Object.freeze({ visible: true, lastToggleAt: null });
    expect(reduceSidebar(state, { type: "toggle", at: 100 })).toEqual({
      state: { visible: false, lastToggleAt: 100 },
      sendControlG: false,
    });
    expect(state.visible).toBe(true);
  });

  test("a double toggle restores visibility and forwards exactly one literal Ctrl+G", () => {
    expect(reduceSidebar({ visible: false, lastToggleAt: 100 }, { type: "toggle", at: 400 })).toEqual({
      state: { visible: true, lastToggleAt: null },
      sendControlG: true,
    });
  });

  test("a late toggle changes visibility without sending Ctrl+G", () => {
    expect(reduceSidebar({ visible: false, lastToggleAt: 100 }, { type: "toggle", at: 401 })).toEqual({
      state: { visible: true, lastToggleAt: 401 },
      sendControlG: false,
    });
  });

  test("ordinary input breaks the double-toggle sequence without toggling", () => {
    expect(reduceSidebar({ visible: false, lastToggleAt: 100 }, { type: "input" })).toEqual({
      state: { visible: false, lastToggleAt: null },
      sendControlG: false,
    });
  });
});

const plain = (state: ReturnType<typeof createChangesState>, columns = 29) => changesRows(state, columns).lines.map((line) => line.map((span) => span.text).join("")).join("\n");

describe("change rows", () => {
  test("partially staged files retain exact comparison targets for both filename and inline parents", () => {
    const value = changesRows(createChangesState([{ path: "src/both.ts", indexStatus: "M", worktreeStatus: "M" }]), 23);
    for (const comparison of ["staged", "unstaged"]) {
      const targets = value.targets.filter((target) => target.selection.comparison === comparison);
      expect(targets).toHaveLength(1);
      expect(targets.every((target) => target.selection.path === "src/both.ts")).toBe(true);
    }
    expect(plain(createChangesState([{ path: "src/both.ts", indexStatus: "M", worktreeStatus: "M" }]))).toContain("Staged · vs HEAD");
  });
  test("conflicts, untracked directories and deletions keep their status in compact rows", () => {
    const value = plain(createChangesState([
      { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U" },
      { path: "src/new-folder/", indexStatus: "?", worktreeStatus: "?" },
      { path: "gone.ts", indexStatus: " ", worktreeStatus: "D" },
    ]));
    expect(value).toContain("Conflicts · combined diff"); expect(value).toMatch(/conflict\.ts +UU\*/);
    expect(value).toContain("new-folder/"); expect(value).toContain("src/"); expect(value).toMatch(/gone\.ts +D\*/);
  });
  test("launch markers stay separate from later changes without mutating inputs", () => {
    const original = Object.freeze(createChangesState([{ path: "old.ts", indexStatus: " ", worktreeStatus: "M" }]));
    const updated = applyStatus(original, { ok: true, changes: [...original.changes, { path: "new.ts", indexStatus: "?", worktreeStatus: "?" }] });
    expect(plain(updated)).toMatch(/old\.ts +M\*/); expect(plain(updated)).toMatch(/new\.ts +\?\n?$/);
    expect(original.initialPaths.has("new.ts")).toBe(false); expect(original.changes).toHaveLength(1);
  });
  test("stale results retain paths and diagnostics, including a previously clean result", () => {
    for (const changes of [[], [{ path: "old.ts", indexStatus: " ", worktreeStatus: "M" }]]) {
      const stale = applyStatus(createChangesState(changes), { ok: false, error: "Git timed out\x1b" });
      const value = plain(stale);
      expect(value).toContain("Git unavailable"); expect(value).toContain("Showing last result");
      expect(value).toContain("Git timed out\\u001b"); expect(value).not.toContain("Working tree clean");
      if (changes.length) expect(value).toContain("old.ts"); else expect(value).toContain("Last result: clean");
      expect(plain(applyStatus(stale, { ok: true, changes: [] }))).toContain("Working tree clean");
    }
  });
  test("control escaping and grapheme clipping retain filename suffixes and marker cells", () => {
    const state = createChangesState([
      { path: "deep/directory/a-very-long-conflict-name.ts", indexStatus: "U", worktreeStatus: "U" },
      { path: "src/name\n\x1b.ts", indexStatus: "?", worktreeStatus: "?" },
    ]);
    const value = changesRows(state, 23);
    expect(plain(state, 23)).toContain("…nflict-name.ts UU*");
    expect(plain(state, 23)).toContain("name\\n\\u001b.ts");
    expect(value.lines.every((line) => Bun.stringWidth(line.map((span) => span.text).join("")) <= 23)).toBe(true);
    expect(plain(state, 23)).not.toContain("\x1b");
  });
});


test("shared rows keep status and launch markers aligned through Unicode clipping", () => {
  const badge = changeBadge({ path: "long.ts", indexStatus: "U", worktreeStatus: "U" }, true);
  for (const width of [0, 1, 3, 12, 23, 29]) {
    const spans = pathRow("👨‍👩‍👧‍👦-é-文件-very-long-name.ts", "src/terminal/", width, badge);
    const value = spans.map((span) => span.text).join("");
    expect(Bun.stringWidth(value)).toBeLessThanOrEqual(width);
    if (width >= 3) expect(value).toEndWith("UU*");
    expect(value).not.toContain("�");
  }
  expect(changeBadge({ path: "both.ts", indexStatus: "M", worktreeStatus: "M" }, false).status).toBe("MM");
  expect(changeBadge({ path: "new.ts", indexStatus: "?", worktreeStatus: "?" }, false).status).toBe("?");
});
