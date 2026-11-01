import { describe, expect, test } from "bun:test";
import { formatChanges, reduceSidebar, sidebarColumns } from "../../src/terminal/sidebar";
import { applyStatus, createChangesState } from "../../src/git/status";

describe("sidebar controls", () => {
  test("collapses in narrow terminals and restores the requested visibility", () => {
    expect(sidebarColumns(99, true)).toBe(0);
    expect(sidebarColumns(100, true)).toBe(28);
    expect(sidebarColumns(120, false)).toBe(0);
    expect(sidebarColumns(120, true)).toBe(28);
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

describe("changes sidebar state", () => {
  const oldChange = Object.freeze({ path: "old.ts", indexStatus: " ", worktreeStatus: "M" });
  const newChange = Object.freeze({ path: "new.ts", indexStatus: "?", worktreeStatus: "?" });

  test("identifies the comparison baseline of each status column", () => {
    const text = formatChanges(createChangesState([oldChange]), 20);
    expect(text).toContain("X: index vs HEAD");
    expect(text).toContain("Y: worktree vs index");
  });

  test("long paths show truncation while retaining distinguishing filenames", () => {
    const changes = ["FirstButton.ts", "SecondButton.ts"].map((name) => ({
      path: `src/components/a-very-long-directory/${name}`, indexStatus: "?", worktreeStatus: "?",
    }));
    const text = formatChanges(createChangesState(changes), 12);
    expect(text).toContain("…");
    expect(text).toContain("FirstButton.ts");
    expect(text).toContain("SecondButton.ts");
    expect(text.split("\n").every((line) => Bun.stringWidth(line) <= 26)).toBe(true);
  });

  test("keeps launch-dirty paths distinct from later additions without mutating inputs", () => {
    const initial = Object.freeze(createChangesState(Object.freeze([oldChange])));
    const updated = applyStatus(initial, { ok: true, changes: Object.freeze([oldChange, newChange]) });
    const text = formatChanges(updated, 20);
    expect(text).toContain(" M* old.ts");
    expect(text).toContain("??  new.ts");
    expect(text).toContain("* dirty at launch");
    expect(initial.changes).toEqual([oldChange]);
    expect(initial.initialPaths.has("new.ts")).toBe(false);
  });

  test("a failed refresh preserves the last good list and recovery clears stale status", () => {
    const initial = createChangesState([oldChange]);
    const stale = applyStatus(initial, { ok: false, error: "Git timed out" });
    expect(formatChanges(stale, 20)).toContain("Git changes (stale)");
    expect(formatChanges(stale, 20)).toContain("old.ts");
    const recovered = applyStatus(stale, { ok: true, changes: [] });
    expect(formatChanges(recovered, 20)).toContain("No Git changes");
    expect(formatChanges(recovered, 20)).not.toContain("stale");
  });

  test("escapes filename controls and reports entries hidden by the panel height", () => {
    const changes = Array.from({ length: 20 }, (_, i) => ({
      path: i === 0 ? "name\n\x1b[31m.ts" : `file-${i}.ts`, indexStatus: "?", worktreeStatus: "?",
    }));
    const text = formatChanges(createChangesState(changes), 8);
    expect(text).toContain("name\\n\\u001b[31m.ts");
    expect(text).not.toContain("\x1b");
    expect(text).toContain("more");
    expect(text.split("\n").length).toBeLessThanOrEqual(8);
    expect(formatChanges(createChangesState(changes), 1).split("\n").length).toBeLessThanOrEqual(1);
  });
});
