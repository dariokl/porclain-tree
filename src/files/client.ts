import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "../git/client";
import { isGitPath } from "../git/status";

export type FileListResult = Readonly<{ ok: true; paths: readonly string[] }> | Readonly<{ ok: false; error: string }>;
export type FileReadResult = Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; error: string }>;
const maxBytes = 1024 * 1024;
const unavailable = { ok: false, error: "File unavailable; select an existing regular file inside this repository." } as const;

function decodePaths(output: Uint8Array): readonly string[] | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(output);
    if (text && !text.endsWith("\0")) return null;
    const paths = text ? text.slice(0, -1).split("\0") : [];
    return paths.every((path) => isGitPath(path) && !path.endsWith("/")) ? paths : null;
  } catch { return null; }
}

export async function listProjectFiles(root: string, signal?: AbortSignal): Promise<FileListResult> {
  const listed = await runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], root, signal);
  if (!listed.ok) return listed;
  const deleted = await runGit(["ls-files", "--deleted", "-z"], root, signal);
  if (!deleted.ok) return deleted;
  const paths = decodePaths(listed.output);
  const removed = decodePaths(deleted.output);
  if (!paths || !removed) return { ok: false, error: "File list contains invalid or non-UTF-8 paths." };
  const excluded = new Set(removed);
  const visible = [...new Set(paths)].filter((path) => !excluded.has(path)).sort();
  if (visible.length > 10_000) return { ok: false, error: "File list exceeds the 10,000-file limit." };
  return { ok: true, paths: visible };
}

export async function readProjectFile(root: string, path: string, signal?: AbortSignal): Promise<FileReadResult> {
  if (!isGitPath(path) || path.includes("\0")) return unavailable;
  if (signal?.aborted) return { ok: false, error: "File read cancelled." };
  const started = performance.now();
  try {
    const candidate = join(root, path);
    if ((await lstat(candidate)).isSymbolicLink()) return { ok: false, error: "Symlink previews are unavailable." };
    const base = await realpath(root);
    const resolved = await realpath(candidate);
    if (resolved !== join(base, path)) return { ok: false, error: "Symlink paths cannot be previewed." };
    const allowed = await runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", `:(literal)${path}`], root, signal);
    if (!allowed.ok) return allowed;
    if (!decodePaths(allowed.output)?.includes(path)) return { ok: false, error: "File is excluded or no longer listed in this repository." };
    if (signal?.aborted) return { ok: false, error: "File read cancelled." };
    const file = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      // Linux /proc identifies the opened object even if a parent directory was replaced during open.
      if (await realpath(`/proc/self/fd/${file.fd}`) !== resolved) return unavailable;
      const stat = await file.stat();
      if (!stat.isFile()) return unavailable;
      if (stat.size > maxBytes) return { ok: false, error: "File exceeds the 1 MiB preview limit." };
      const buffer = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        if (signal?.aborted) return { ok: false, error: "File read cancelled." };
        if (performance.now() - started > 2000) return { ok: false, error: "File read timed out after 2 seconds." };
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        length += bytesRead;
        if (!bytesRead) break;
      }
      if (signal?.aborted) return { ok: false, error: "File read cancelled." };
      if (length > maxBytes) return { ok: false, error: "File exceeds the 1 MiB preview limit." };
      if (buffer.subarray(0, length).includes(0)) return { ok: false, error: "Binary file; text preview unavailable." };
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
      catch { return { ok: false, error: "File is not UTF-8 text; preview unavailable." }; }
      if (text.replace(/\n$/, "").split("\n").length > 10_000) return { ok: false, error: "File exceeds the 10,000-line preview limit." };
      return { ok: true, text };
    } finally { await file.close(); }
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "ENXIO", "ENAMETOOLONG"].includes(String(error.code))) return unavailable;
    throw error;
  }
}
