import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGitProject, readGitStatus, runGit } from "../../src/git/client";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "porclaintree-git-"));
  directories.push(path);
  return path;
}

async function git(root: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(error);
}

async function repo(): Promise<string> {
  const root = await directory();
  await git(root, "init", "-q");
  for (const name of ["modified.txt", "staged.txt", "deleted.txt", "original.txt"]) {
    await writeFile(join(root, name), "original\n");
  }
  await writeFile(join(root, ".gitignore"), "ignored.txt\n");
  await git(root, "add", ".");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  return root;
}

test("reads a real repository with staged, unstaged, deleted, renamed, and untracked paths", async () => {
  const root = await repo();
  await writeFile(join(root, "modified.txt"), "modified\n");
  await writeFile(join(root, "staged.txt"), "staged\n");
  await git(root, "add", "staged.txt");
  await unlink(join(root, "deleted.txt"));
  await git(root, "mv", "original.txt", "renamed.txt");
  await writeFile(join(root, "space č\nfile.txt"), "new\n");
  await writeFile(join(root, "ignored.txt"), "ignored\n");
  await mkdir(join(root, "new-directory"));
  await writeFile(join(root, "new-directory", "inside.txt"), "new\n");
  const indexBefore = await readFile(join(root, ".git/index"));
  const result = await readGitStatus(root);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.changes).toContainEqual({ path: "modified.txt", indexStatus: " ", worktreeStatus: "M" });
  expect(result.changes).toContainEqual({ path: "staged.txt", indexStatus: "M", worktreeStatus: " " });
  expect(result.changes).toContainEqual({ path: "deleted.txt", indexStatus: " ", worktreeStatus: "D" });
  expect(result.changes).toContainEqual({ path: "renamed.txt", previousPath: "original.txt", indexStatus: "R", worktreeStatus: " " });
  expect(result.changes).toContainEqual({ path: "space č\nfile.txt", indexStatus: "?", worktreeStatus: "?" });
  expect(result.changes).toContainEqual({ path: "new-directory/", indexStatus: "?", worktreeStatus: "?" });
  expect(result.changes.some((change) => change.path === "ignored.txt")).toBe(false);
  expect(await readFile(join(root, ".git/index"))).toEqual(indexBefore);
});

test("finds the root from a nested launch directory and captures a clean initial snapshot", async () => {
  const root = await repo();
  const nested = join(root, "nested");
  await mkdir(nested);
  expect(await loadGitProject(nested)).toEqual({ ok: true, root, changes: [] });
});

test("reports a non-Git directory without inventing an empty successful snapshot", async () => {
  const result = await loadGitProject(await directory());
  expect(result.ok).toBe(false);
});

test("aborts an in-flight Git process", async () => {
  const root = await repo();
  const controller = new AbortController();
  const pending = runGit(["hash-object", "--stdin"], root, controller.signal);
  controller.abort();
  const result = await pending;
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("cancelled");
});

test("times out a blocked Git command instead of leaving it running", async () => {
  const result = await runGit(["hash-object", "--stdin"], await repo());
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("timed out");
});

test("rejects output over the capture limit instead of returning partial bytes", async () => {
  const root = await repo();
  const config = join(root, "large.config");
  await writeFile(config, `[large]\n value = ${"x".repeat(1024 * 1024 + 1)}\n`);
  const result = await runGit(["config", "--file", config, "--list"], root);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("1 MiB");
});
