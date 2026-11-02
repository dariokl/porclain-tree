import { describe, expect, test } from "bun:test";
import { changesRows, reduceSidebar, sidebarColumns } from "../../src/terminal/sidebar";
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
  test("partially staged files retain exact comparison targets for both filename and directory rows", () => {
    const value = changesRows(createChangesState([{ path: "src/both.ts", indexStatus: "M", worktreeStatus: "M" }]), 23);
    for (const comparison of ["staged", "unstaged"]) {
      const targets = value.targets.filter((target) => target.selection.comparison === comparison);
      expect(targets).toHaveLength(2);
      expect(targets.every((target) => target.selection.path === "src/both.ts")).toBe(true);
    }
    expect(plain(createChangesState([{ path: "src/both.ts", indexStatus: "M", worktreeStatus: "M" }]))).toContain("├─ staged · 1\n┆  vs HEAD");
  });
  test("conflicts, untracked directories and deletions keep their status and broken rail", () => {
    const value = plain(createChangesState([
      { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U" },
      { path: "src/new-folder/", indexStatus: "?", worktreeStatus: "?" },
      { path: "gone.ts", indexStatus: " ", worktreeStatus: "D" },
    ]));
    expect(value).toContain("├─ conflicts · 1"); expect(value).toContain("┆  UU* conflict.ts");
    expect(value).toContain("new-folder/"); expect(value).toContain("src/"); expect(value).toContain("D* gone.ts");
  });
  test("launch markers stay separate from later changes without mutating inputs", () => {
    const original = Object.freeze(createChangesState([{ path: "old.ts", indexStatus: " ", worktreeStatus: "M" }]));
    const updated = applyStatus(original, { ok: true, changes: [...original.changes, { path: "new.ts", indexStatus: "?", worktreeStatus: "?" }] });
    expect(plain(updated)).toContain("M* old.ts"); expect(plain(updated)).toContain("?  new.ts");
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
    expect(plain(state, 23)).toContain("UU* …onflict-name.ts");
    expect(plain(state, 23)).toContain("name\\n\\u001b.ts");
    expect(value.lines.every((line) => Bun.stringWidth(line.map((span) => span.text).join("")) <= 23)).toBe(true);
    expect(plain(state, 23)).not.toContain("\x1b");
  });
});
