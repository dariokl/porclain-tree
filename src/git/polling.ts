import { setTimeout as delay } from "node:timers/promises";
import { readGitStatus } from "./client";
import type { GitStatusResult } from "./status";

export function pollGitStatus(
  root: string,
  onStatus: (result: GitStatusResult) => void,
  readStatus: (root: string, signal: AbortSignal) => Promise<GitStatusResult> = readGitStatus,
  intervalMs = 1000,
): Readonly<{ done: Promise<void>; stop: () => Promise<void> }> {
  const controller = new AbortController();
  const { signal } = controller;
  async function run(): Promise<void> {
    while (!signal.aborted) {
      try {
        await delay(intervalMs, undefined, { signal });
      } catch (error: unknown) {
        if (signal.aborted) return;
        throw error;
      }
      if (signal.aborted) return;
      const result = await readStatus(root, signal);
      if (!signal.aborted) onStatus(result);
    }
  }
  const done = run();
  return { done, stop: () => { controller.abort(); return done; } };
}
