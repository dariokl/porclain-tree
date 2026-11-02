import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { listProjectFiles, readProjectFile } from "../../src/files/client";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function repo() {
  const root = await mkdtemp("/tmp/porclaintree-files-"); roots.push(root);
  const git = async (...args: string[]) => {
    const process = Bun.spawn(["git", "-C", root, ...args], { stdout: "ignore", stderr: "pipe" });
    const error = await new Response(process.stderr).text();
    if (await process.exited !== 0) throw new Error(error);
  };
  await git("init", "-q");
  return { root, git };
}

test("listing includes tracked and non-ignored new files, excluding deleted and ignored paths", async () => {
  const { root, git } = await repo();
  await writeFile(join(root, ".gitignore"), "secret/\nIDEA.md\n");
  await writeFile(join(root, "gone.txt"), "old"); await git("add", "."); await unlink(join(root, "gone.txt"));
  await mkdir(join(root, "src")); await writeFile(join(root, "src", "č\n[*].ts"), "text");
  await mkdir(join(root, "secret")); await writeFile(join(root, "secret", "private"), "secret");
  await writeFile(join(root, "IDEA.md"), "private");
  expect(await listProjectFiles(root)).toEqual({ ok: true, paths: [".gitignore", "src/č\n[*].ts"] });
});

test("file snapshots preserve text, empty files and literal special names", async () => {
  const { root } = await repo();
  await writeFile(join(root, "č[*]\n.txt"), "hello\tworld\n+source text\n");
  expect(await readProjectFile(root, "č[*]\n.txt")).toEqual({ ok: true, text: "hello\tworld\n+source text\n" });
  await writeFile(join(root, "empty"), "");
  expect(await readProjectFile(root, "empty")).toEqual({ ok: true, text: "" });
});

test("missing, traversal, symlink and directory selections report unavailable content", async () => {
  const { root } = await repo();
  await writeFile(join(root, "file"), "safe");
  await symlink("file", join(root, "link"));
  await symlink("/etc", join(root, "outside"));
  for (const path of ["missing", "../outside", "/etc/passwd", "link", "outside/passwd", ".git", ""]) {
    expect((await readProjectFile(root, path)).ok).toBe(false);
  }
});

test("binary, non-UTF-8, oversized, excessive-line and cancelled snapshots are bounded errors", async () => {
  const { root } = await repo();
  for (const content of [new Uint8Array([0, 1]), new Uint8Array([255]), "a".repeat(1024 * 1024 + 1), "line\n".repeat(10_001)]) {
    await writeFile(join(root, "file"), content);
    expect((await readProjectFile(root, "file")).ok).toBe(false);
  }
  const controller = new AbortController(); controller.abort();
  expect((await readProjectFile(root, "file", controller.signal)).ok).toBe(false);
  expect((await listProjectFiles(root, controller.signal)).ok).toBe(false);
});

test("stale directory entries cannot follow an intermediate symlink into ignored files", async () => {
  const { root } = await repo();
  await mkdir(join(root, "visible")); await mkdir(join(root, "ignored"));
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await writeFile(join(root, "visible", "file.txt"), "visible");
  await writeFile(join(root, "ignored", "file.txt"), "private");
  const listed = await listProjectFiles(root);
  expect(listed.ok && listed.paths.includes("visible/file.txt")).toBe(true);
  await rm(join(root, "visible"), { recursive: true });
  await symlink("ignored", join(root, "visible"));
  expect((await readProjectFile(root, "visible/file.txt")).ok).toBe(false);
});

test("exactly10,000 terminated lines fit the file limit but10,001 do not", async () => {
  const { root } = await repo();
  await writeFile(join(root, "lines.txt"), "line\n".repeat(10_000));
  expect((await readProjectFile(root, "lines.txt")).ok).toBe(true);
  await writeFile(join(root, "lines.txt"), "line\n".repeat(10_001));
  expect((await readProjectFile(root, "lines.txt")).ok).toBe(false);
});

test("a newly ignored file from a stale tree is not opened", async () => {
  const { root } = await repo();
  await writeFile(join(root, "private.txt"), "private");
  const before = await listProjectFiles(root);
  expect(before.ok && before.paths.includes("private.txt")).toBe(true);
  await writeFile(join(root, ".gitignore"), "private.txt\n");
  expect((await readProjectFile(root, "private.txt")).ok).toBe(false);
});
