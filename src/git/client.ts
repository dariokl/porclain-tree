import { spawn } from "node:child_process";
import { parseStatus } from "./status";
import type { Change, GitStatusResult } from "./status";

type GitOutputResult = Readonly<{ ok: true; output: Uint8Array }> | Readonly<{ ok: false; error: string }>;
export type GitProject = Readonly<{ root: string; changes: readonly Change[] }>;
type ProjectResult = Readonly<{ ok: true } & GitProject> | Readonly<{ ok: false; error: string }>;

export function runGit(args: readonly string[], cwd: string, signal?: AbortSignal, successCodes: readonly number[] = [0]): Promise<GitOutputResult> {
  if (signal?.aborted) return Promise.resolve({ ok: false, error: "Git read cancelled" });
  return new Promise((resolve) => {
    const child = spawn("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
      cwd, detached: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let length = 0;
    let failure: string | undefined;
    const fail = (message: string) => {
      failure ??= message;
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch (error: unknown) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) child.kill("SIGKILL");
        }
      }
    };
    const receive = (target: Buffer[], chunk: Buffer) => {
      if (failure) return;
      length += chunk.byteLength;
      if (length > 1024 * 1024) fail("Git output exceeded 1 MiB");
      else target.push(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => receive(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => receive(stderr, chunk));
    child.once("error", (error) => { failure ??= error.message; });
    const timeout = setTimeout(() => fail("Git timed out after 2 seconds"), 2000);
    const cancel = () => fail("Git read cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.once("close", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      if (failure) resolve({ ok: false, error: failure });
      else if (code === null || !successCodes.includes(code) || (code !== 0 && stdout.length === 0)) {
        const message = Buffer.concat(stderr).toString("utf8").trim();
        resolve({ ok: false, error: message || `Git failed with exit code ${code}` });
      } else resolve({ ok: true, output: Buffer.concat(stdout) });
    });
  });
}

export async function readGitStatus(root: string, signal?: AbortSignal): Promise<GitStatusResult> {
  const result = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=normal"], root, signal);
  return result.ok ? parseStatus(result.output) : result;
}

export async function loadGitProject(cwd: string): Promise<ProjectResult> {
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!result.ok) return result;
  let root: string;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(result.output);
    root = text.endsWith("\n") ? text.slice(0, -1) : text;
  } catch {
    return { ok: false, error: "The Git root is not a valid UTF-8 path" };
  }
  if (!root.startsWith("/")) return { ok: false, error: "Could not determine the Git working-tree root" };
  const status = await readGitStatus(root);
  return status.ok ? { ok: true, root, changes: status.changes } : status;
}
