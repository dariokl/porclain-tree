import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readGitDiff } from "../../src/git/diff";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function git(root: string, ...args: string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], { stdout: "ignore", stderr: "pipe" });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(error);
}
async function repo() {
  const root = await mkdtemp("/tmp/porclaintree-diff-"); roots.push(root);
  await git(root, "init", "-q");
  for (const name of ["file.txt", "old.txt", "gone.txt", ":literal[*]\nč.txt"]) await writeFile(join(root, name), "base\n");
  await git(root, "add", ".");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  return root;
}
function text(result: Awaited<ReturnType<typeof readGitDiff>>) {
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

test("staged and unstaged reads use different baselines without changing files or index", async () => {
  const root = await repo();
  await writeFile(join(root, "file.txt"), "index\n"); await git(root, "add", "file.txt");
  await writeFile(join(root, "file.txt"), "working\n");
  const index = await readFile(join(root, ".git/index"));
  const staged = text(await readGitDiff(root, { path: "file.txt", comparison: "staged" }));
  const working = text(await readGitDiff(root, { path: "file.txt", comparison: "unstaged" }));
  expect(staged).toContain("-base\n+index"); expect(staged).not.toContain("working");
  expect(working).toContain("-index\n+working"); expect(working).not.toContain("-base");
  expect(await readFile(join(root, ".git/index"))).toEqual(index);
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("working\n");
});

test("rename, deletion and literal pathspec characters select exactly their file", async () => {
  const root = await repo(); await git(root, "mv", "old.txt", "renamed.txt"); await unlink(join(root, "gone.txt"));
  expect(text(await readGitDiff(root, { path: "renamed.txt", previousPath: "old.txt", comparison: "staged" }))).toContain("rename from old.txt");
  expect(text(await readGitDiff(root, { path: "gone.txt", comparison: "unstaged" }))).toContain("deleted file mode");
  await writeFile(join(root, ":literal[*]\nč.txt"), "literal change\n");
  await writeFile(join(root, "file.txt"), "unrelated\n");
  const diff = text(await readGitDiff(root, { path: ":literal[*]\nč.txt", comparison: "unstaged" }));
  expect(diff).toContain("+literal change"); expect(diff).not.toContain("unrelated");
});

test("untracked text and empty files preview, while missing files and directory summaries report errors", async () => {
  const root = await repo(); await writeFile(join(root, "new č.txt"), "new content\n");
  expect(text(await readGitDiff(root, { path: "new č.txt", comparison: "untracked" }))).toContain("+new content");
  await writeFile(join(root, "empty.txt"), "");
  expect(text(await readGitDiff(root, { path: "empty.txt", comparison: "untracked" }))).toContain("new file mode");
  expect((await readGitDiff(root, { path: "missing", comparison: "untracked" })).ok).toBe(false);
  await mkdir(join(root, "folder"));
  expect((await readGitDiff(root, { path: "folder/", comparison: "untracked" })).ok).toBe(false);
  expect((await readGitDiff(root, { path: "../outside", comparison: "unstaged" })).ok).toBe(false);
});

test("binary summaries stay textual and external diff/textconv helpers stay disabled", async () => {
  const root = await repo();
  await writeFile(join(root, ".gitattributes"), "*.txt diff=custom\n");
  await git(root, "config", "diff.custom.textconv", "definitely-not-a-real-textconv");
  await git(root, "config", "diff.external", "definitely-not-a-real-diff");
  await writeFile(join(root, "file.txt"), "updated\n");
  expect(text(await readGitDiff(root, { path: "file.txt", comparison: "unstaged" }))).toContain("+updated");
  await writeFile(join(root, "file.txt"), new Uint8Array([0, 1, 2, 3]));
  expect(text(await readGitDiff(root, { path: "file.txt", comparison: "unstaged" }))).toContain("Binary files");
});

test("invalid UTF-8, excessive output/lines and cancellation are explicit failures", async () => {
  const root = await repo();
  await writeFile(join(root, "file.txt"), new Uint8Array([255, 10]));
  expect((await readGitDiff(root, { path: "file.txt", comparison: "unstaged" })).ok).toBe(false);
  await writeFile(join(root, "file.txt"), "x".repeat(1024 * 1024));
  expect((await readGitDiff(root, { path: "file.txt", comparison: "unstaged" })).ok).toBe(false);
  await writeFile(join(root, "file.txt"), "line\n".repeat(10_001));
  expect((await readGitDiff(root, { path: "file.txt", comparison: "unstaged" })).ok).toBe(false);
  const controller = new AbortController(); controller.abort();
  expect((await readGitDiff(root, { path: "file.txt", comparison: "unstaged" }, controller.signal)).ok).toBe(false);
});

test("conflicted files show a combined diff", async () => {
  const root = await repo();
  await git(root, "checkout", "-qb", "other");
  await writeFile(join(root, "file.txt"), "other\n");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qam", "other");
  await git(root, "checkout", "-q", "-");
  await writeFile(join(root, "file.txt"), "ours\n");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qam", "ours");
  const merge = Bun.spawn(["git", "-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "merge", "other"], { stdout: "ignore", stderr: "ignore" });
  expect(await merge.exited).toBe(1);
  const diff = text(await readGitDiff(root, { path: "file.txt", comparison: "conflict" }));
  expect(diff).toContain("diff --cc file.txt"); expect(diff).toContain("<<<<<<< HEAD");
});

test("a deleted file preview excludes new descendants at its former path", async () => {
  const root = await repo();
  await unlink(join(root, "file.txt")); await mkdir(join(root, "file.txt"));
  await writeFile(join(root, "file.txt", "child.txt"), "unrelated-descendant\n");
  await git(root, "add", "-A");
  const diff = text(await readGitDiff(root, { path: "file.txt", comparison: "staged" }));
  expect(diff).toContain("deleted file mode");
  expect(diff).not.toContain("unrelated-descendant");
  expect(diff).not.toContain("child.txt");
});

test("a stale untracked file selection never previews a directory's null child", async () => {
  const root = await repo();
  await mkdir(join(root, "stale"));
  await writeFile(join(root, "stale", "null"), "unrelated-null-content\n");
  const result = await readGitDiff(root, { path: "stale", comparison: "untracked" });
  expect(result.ok).toBe(false);
});

test("overlapping rename paths report an unavailable comparison rather than a partial diff", async () => {
  const root = await repo();
  await unlink(join(root, "file.txt")); await mkdir(join(root, "file.txt"));
  await writeFile(join(root, "file.txt", "renamed.txt"), "base\n");
  await git(root, "add", "-A");
  expect((await readGitDiff(root, { path: "file.txt/renamed.txt", previousPath: "file.txt", comparison: "staged" })).ok).toBe(false);
});
