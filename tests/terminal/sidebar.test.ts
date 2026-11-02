import { describe, expect, test } from "bun:test";
import { formatSidebar, sidebarLayout, reduceSidebar, sidebarColumns } from "../../src/terminal/sidebar";
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

const plain = (state: ReturnType<typeof createChangesState>, rows = 30, columns = 29) =>
  formatSidebar(state, "porcelain", rows, columns).map((line) => line.map((span) => span.text).join("")).join("\n");

describe("sidebar presentation", () => {
  const oldChange = Object.freeze({ path: "old.ts", indexStatus: " ", worktreeStatus: "M" });
  const newChange = Object.freeze({ path: "new.ts", indexStatus: "?", worktreeStatus: "?" });

  test("visible filename and directory rows retain exact comparison targets through clipping", () => {
    const layout = sidebarLayout(createChangesState([
      { path: "long-directory/both.ts", indexStatus: "M", worktreeStatus: "M" },
    ]), "fixture", 30, 23);
    for (const comparison of ["staged", "unstaged"]) {
      const rows = layout.targets.filter((target) => target.selection.comparison === comparison);
      expect(rows).toHaveLength(2);
      expect(rows.every((target) => target.selection.path === "long-directory/both.ts")).toBe(true);
      expect(rows.some((target) => layout.lines[target.row]?.some((span) => span.text.includes("both.ts")))).toBe(true);
    }
    const short = sidebarLayout(createChangesState(Array.from({ length: 20 }, (_, i) => ({ path: `dir/file-${i}`, indexStatus: "?", worktreeStatus: "?" }))), "fixture", 12, 23);
    expect(short.targets.length).toBeLessThan(20);
    expect(short.targets.every((target) => !short.lines[target.row]?.some((span) => /more entries|Ctrl\+G/.test(span.text)))).toBe(true);
  });

  test("groups both sides of a partially staged file with explicit baselines", () => {
    const state = createChangesState([{ path: "src/both.ts", indexStatus: "M", worktreeStatus: "M" }]);
    const text = plain(state);
    expect(text).toContain("├─ unstaged · 1\n┆  vs index");
    expect(text).toContain("├─ staged · 1\n┆  vs HEAD");
    expect(text.match(/both\.ts/g)).toHaveLength(2);
    expect(text).toContain("1 changed path");
  });

  test("conflicts appear once in their own group rather than as staged success", () => {
    const text = plain(createChangesState([
      { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U" },
      { path: "added-both.ts", indexStatus: "A", worktreeStatus: "A" },
    ]));
    expect(text).toContain("├─ conflicts · 2");
    expect(text).toMatch(/┆ {2}UU\* conflict\.ts/);
    expect(text).toMatch(/┆ {2}AA\* added-both\.ts/);
    expect(text).not.toContain("├─ staged");
    expect(text.match(/conflict\.ts/g)).toHaveLength(1);
  });

  test("directory summaries retain their trailing slash and parent path", () => {
    const text = plain(createChangesState([{ path: "src/new-folder/", indexStatus: "?", worktreeStatus: "?" }]));
    expect(text).toContain("├─ untracked · 1");
    expect(text).toContain("new-folder/");
    expect(text).toContain("src/");
    expect(text).toContain("?");
  });

  test("long paths show truncation while retaining distinguishing filenames", () => {
    const changes = ["FirstButton.ts", "SecondButton.ts"].map((name) => ({
      path: `src/components/a-very-long-directory/${name}`, indexStatus: "?", worktreeStatus: "?",
    }));
    const text = plain(createChangesState(changes), 30, 23);
    expect(text).toContain("…");
    expect(text).toContain("FirstButton.ts");
    expect(text).toContain("SecondButton.ts");
    expect(text.split("\n").every((line) => Bun.stringWidth(line) <= 23)).toBe(true);
  });

  test("keeps launch-dirty paths distinct from later additions without mutating inputs", () => {
    const initial = Object.freeze(createChangesState(Object.freeze([oldChange])));
    const updated = applyStatus(initial, { ok: true, changes: Object.freeze([oldChange, newChange]) });
    const text = plain(updated);
    expect(text).toMatch(/┆ {2}M\* old\.ts/);
    expect(text).toMatch(/┆ {2}\? {2}new\.ts/);
    expect(text).toContain("* changed before launch");
    expect(initial.changes).toEqual([oldChange]);
    expect(initial.initialPaths.has("new.ts")).toBe(false);
  });

  test("a failed refresh preserves the last good list and recovery clears stale status", () => {
    const initial = createChangesState([oldChange]);
    const stale = applyStatus(initial, { ok: false, error: "Git timed out" });
    expect(plain(stale)).toContain("Git unavailable");
    expect(plain(stale)).toContain("Showing last result");
    expect(plain(stale)).toContain("Git timed out");
    expect(plain(stale)).toContain("old.ts");
    const recovered = applyStatus(stale, { ok: true, changes: [] });
    expect(plain(recovered)).toContain("Working tree clean");
    expect(plain(recovered)).not.toContain("unavailable");
    expect(plain(recovered)).not.toContain("* changed before launch");
  });

  test("a stale clean result never claims the current working tree is clean", () => {
    const state = applyStatus(createChangesState([]), { ok: false, error: "offline" });
    expect(plain(state)).toContain("Last result: clean");
    expect(plain(state)).not.toContain("Working tree clean");
    expect(plain(state)).toContain("Git unavailable");
  });

  test("compact stale layouts keep the last-result label, diagnostic, and bottom shortcut", () => {
    const state = applyStatus(createChangesState([oldChange]), { ok: false, error: "Git timed out" });
    for (const height of [5, 8, 15]) {
      const text = plain(state, height, 23);
      expect(text.split("\n")).toHaveLength(height);
      expect(text).toContain("Git unavailable");
      expect(text).toContain("Git timed out");
      expect(text.toLowerCase()).toContain("last");
      expect(text.split("\n").at(-1)).toContain("Ctrl+G");
      if (height === 15) {
        expect(text).toContain("Showing last result");
        expect(text).toContain("old.ts");
      }
    }
  });

  test("a four-row fallback keeps its shortcut on the fourth row", () => {
    const text = plain(createChangesState([]), 4);
    expect(text.split("\n")).toHaveLength(4);
    expect(text.split("\n")[3]).toContain("Ctrl+G");
  });

  test("tiny stale windows prioritize the last-result label and diagnostic over branding", () => {
    for (const changes of [[], [oldChange]]) {
      const state = applyStatus(createChangesState(changes), { ok: false, error: "Git timed out" });
      for (const height of [3, 4]) {
        const text = plain(state, height, 23);
        const lines = text.split("\n");
        expect(lines).toHaveLength(height);
        expect(text).toContain("stale");
        expect(text).toContain("last result");
        expect(text).toContain("Git timed out");
        expect(text).not.toContain("Working tree clean");
        expect(lines.at(-1)).toBe("╰─ Ctrl+G  hide sidebar");
        expect(lines.every((row) => Bun.stringWidth(row) <= 23)).toBe(true);
      }
    }
  });

  test("the rail connects header, group, file, continuation, and closing shortcut", () => {
    const text = plain(createChangesState([
      { path: "src/terminal/view.ts", indexStatus: " ", worktreeStatus: "M" },
    ]));
    const lines = text.split("\n");
    expect(lines[1]).toBe("╭─ porclain/tree");
    expect(lines[2]).toBe("┆  porcelain/");
    expect(text).toContain("┆  M* view.ts\n┆     src/terminal/");
    expect(lines.slice(1, -1).every((row) => /^[╭├┆╰]/u.test(row))).toBe(true);
    expect(lines[28]).toBe("╰─ Ctrl+G  hide sidebar");
  });

  test("file suffixes survive the rail and two-character conflict marker at narrow width", () => {
    const text = plain(createChangesState([
      { path: "deep/directory/a-very-long-conflict-name.ts", indexStatus: "U", worktreeStatus: "U" },
    ]), 30, 23);
    const fileRow = text.split("\n").find((row) => row.includes("UU*"));
    expect(fileRow).toBeDefined();
    expect(fileRow).toContain("…");
    expect(fileRow).toEndWith("…onflict-name.ts");
    expect(Bun.stringWidth(fileRow ?? "")).toBeLessThanOrEqual(23);
  });

  test("escapes controls in filenames, project identity, and Git diagnostics", () => {
    const state = applyStatus(createChangesState([
      { path: "name\n\x1b.ts", indexStatus: "?", worktreeStatus: "?" },
    ]), { ok: false, error: "bad\r\x1b[31m" });
    const text = formatSidebar(state, "project\n\x1b", 30, 29)
      .map((line) => line.map((span) => span.text).join("")).join("\n");
    expect(text).toContain("name\\n\\u001b.ts");
    expect(text).toContain("project\\n\\u001b");
    expect(text).toContain("bad\\r\\u001b[31m");
    expect(text).not.toContain("\x1b");
  });

  test("overflow stays bounded and the shortcut footer remains at the bottom", () => {
    const changes = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file-${i}.ts`, indexStatus: "?", worktreeStatus: "?",
    }));
    for (const height of [8, 12, 20, 30]) {
      const text = plain(createChangesState(changes), height, 23);
      const lines = text.split("\n");
      expect(lines).toHaveLength(height);
      expect(text).toContain("more entries");
      expect(text).toContain("Ctrl+G");
      expect(text).toContain("before launch");
      expect(lines.slice(-2).join("\n")).toContain("Ctrl+G");
      expect(lines.every((line) => Bun.stringWidth(line) <= 23)).toBe(true);
    }
  });

  test("tiny heights and Unicode graphemes stay inside the available cells", () => {
    const state = createChangesState([{ path: "src/👨‍👩‍👧‍👦-é-文件-very-long-name.ts", indexStatus: "?", worktreeStatus: "?" }]);
    for (const height of [0, 1, 2, 4, 8, 16]) {
      const lines = formatSidebar(state, "porcelain", height, 12);
      expect(lines.length).toBeLessThanOrEqual(height);
      expect(lines.every((line) => Bun.stringWidth(line.map((span) => span.text).join("")) <= 12)).toBe(true);
      expect(lines.flatMap((line) => line).every((span) => !span.text.includes("\ufffd"))).toBe(true);
    }
  });
});
