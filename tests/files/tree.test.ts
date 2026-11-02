import { expect, test } from "bun:test";
import { fileTree } from "../../src/files/tree";

test("tree is directory-first, expands only selected folders and leaves inputs unchanged", () => {
  const paths = Object.freeze(["src/z.ts", "README.md", "src/nested/a.ts", "tests/a.ts", "src/z.ts"]);
  const expanded = new Set(["src"]);
  expect(fileTree(paths, expanded)).toEqual([
    { path: "src", name: "src", kind: "directory", depth: 0 },
    { path: "src/nested", name: "nested", kind: "directory", depth: 1 },
    { path: "src/z.ts", name: "z.ts", kind: "file", depth: 1 },
    { path: "tests", name: "tests", kind: "directory", depth: 0 },
    { path: "README.md", name: "README.md", kind: "file", depth: 0 },
  ]);
  expect(fileTree(paths, new Set(["src", "src/nested"])).some((row) => row.path === "src/nested/a.ts")).toBe(true);
  expect([...expanded]).toEqual(["src"]); expect(paths).toHaveLength(5);
});
