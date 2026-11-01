import { describe, expect, test } from "bun:test";
import { parseStatus } from "../../src/git/status";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("Git porcelain parsing", () => {
  test("reads index and working-tree status without losing literal filenames", () => {
    expect(parseStatus(bytes(" M src/a.ts\0M  staged.ts\0 D removed.ts\0?? space č\nfile.txt\0?? new-folder/\0"))).toEqual({
      ok: true,
      changes: [
        { path: "src/a.ts", indexStatus: " ", worktreeStatus: "M" },
        { path: "staged.ts", indexStatus: "M", worktreeStatus: " " },
        { path: "removed.ts", indexStatus: " ", worktreeStatus: "D" },
        { path: "space č\nfile.txt", indexStatus: "?", worktreeStatus: "?" },
        { path: "new-folder/", indexStatus: "?", worktreeStatus: "?" },
      ],
    });
  });

  test("consumes rename/copy pairs in destination-then-source order", () => {
    expect(parseStatus(bytes("R  new name.ts\0old name.ts\0 C copied.ts\0source.ts\0UU conflict.ts\0"))).toEqual({
      ok: true,
      changes: [
        { path: "new name.ts", previousPath: "old name.ts", indexStatus: "R", worktreeStatus: " " },
        { path: "copied.ts", previousPath: "source.ts", indexStatus: " ", worktreeStatus: "C" },
        { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U" },
      ],
    });
  });

  test("an empty complete snapshot means no changes", () => {
    expect(parseStatus(bytes(""))).toEqual({ ok: true, changes: [] });
  });

  test.each([
    { value: " M incomplete.ts" },
    { value: "R  missing-source.ts\0" },
    { value: "XX unknown.ts\0" },
    { value: " M \0" },
    { value: " M ../outside.ts\0" },
    { value: " M /absolute.ts\0" },
    { value: " M good.ts\0broken\0" },
  ])("rejects malformed snapshots instead of returning a partial success: %j", ({ value }) => {
    expect(parseStatus(bytes(value)).ok).toBe(false);
  });
});
