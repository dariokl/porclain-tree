import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "./client";
import { isGitPath } from "./status";

export type DiffSelection = Readonly<{
  path: string;
  previousPath?: string;
  comparison: "staged" | "unstaged" | "untracked" | "conflict";
}>;
export type GitDiffResult = Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; error: string }>;

async function untrackedIdentity(path: string): Promise<Readonly<{ ok: true; identity: string }> | Readonly<{ ok: false; error: string }>> {
  try {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile() && !stat.isSymbolicLink()) return { ok: false, error: "This path is no longer an individual file. Refresh the changes list." };
    return { ok: true, identity: `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(String(error.code))) {
      return { ok: false, error: "The selected file is unavailable. Refresh the changes list." };
    }
    throw error;
  }
}

export async function readGitDiff(root: string, selection: DiffSelection, signal?: AbortSignal): Promise<GitDiffResult> {
  if (!isGitPath(selection.path) || (selection.previousPath !== undefined && !isGitPath(selection.previousPath))) {
    return { ok: false, error: "Invalid Git-relative path" };
  }
  if (selection.path.endsWith("/")) return { ok: false, error: "This is a directory summary. Preview individual files with Git." };
  if (selection.previousPath && (selection.path.startsWith(selection.previousPath + "/") || selection.previousPath.startsWith(selection.path + "/"))) {
    return { ok: false, error: "This rename crosses a file/directory transition. Inspect it with Git." };
  }
  const before = selection.comparison === "untracked" ? await untrackedIdentity(join(root, selection.path)) : null;
  if (before && !before.ok) return before;
  const args = ["--no-pager", "-c", "core.quotePath=true", "diff", "--no-color", "--no-ext-diff", "--no-textconv"];
  if (selection.comparison === "untracked") args.push("--no-index", "--", "/dev/null", `./${selection.path}`);
  else {
    if (selection.comparison === "staged") args.push("--cached");
    if (selection.comparison === "conflict") args.push("--cc");
    const paths = selection.previousPath === undefined ? [selection.path] : [selection.previousPath, selection.path];
    // A literal pathspec still selects descendants when a former file becomes a directory.
    args.push("--", ...paths.map((path) => `:(literal)${path}`), ...paths.map((path) => `:(exclude,literal)${path}/`));
  }
  const result = await runGit(args, root, signal, selection.comparison === "untracked" ? [0, 1] : [0]);
  if (!result.ok) return result;
  if (before?.ok) {
    // --no-index can append "null" when its second operand becomes a directory.
    const after = await untrackedIdentity(join(root, selection.path));
    if (!after.ok) return after;
    if (before.identity !== after.identity) return { ok: false, error: "The file changed while loading. Select it again for a new snapshot." };
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(result.output); }
  catch { return { ok: false, error: "Diff contains non-UTF-8 text; inspect it with Git." }; }
  if (text.split("\n").length > 10_000) return { ok: false, error: "Diff exceeds the 10,000-line preview limit." };
  return { ok: true, text };
}
